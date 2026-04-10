// ═══════════════════════════════════════════════════════════════
//  Lumied — Edge Function: ticket-resolver (v2 — MCP-powered)
//
//  Chamada via pg_cron. Resolve tickets automaticamente usando
//  Claude com tool use via o MCP server interno.
//
//  Fluxo:
//  1. Busca tickets abertos
//  2. Para cada ticket, pede ao Claude para analisar e decidir ação
//  3. Claude tem acesso às MCP tools (ticket_get, ticket_respond,
//     sentry_recent_errors, sql_query, escola_status, etc.)
//  4. Claude responde ou escala baseado no diagnóstico
//
//  Substitui o Remote Trigger (trig_01PTaCsfDfdNrUGwfUeZJZ96)
//  que rodava Claude Code cego a cada 1h.
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { askClaudeWithTools } from "../_shared/ai.ts";
import { McpServer, type McpContext } from "../_shared/mcp.ts";
import { staffTools } from "../mcp/tools_staff.ts";
import { devTools } from "../mcp/tools_dev.ts";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// FAQ fallback for quick-match before involving LLM (saves tokens)
const FAQ: Array<{ keywords: string[]; resposta: string }> = [
  {
    keywords: ["login", "entrar", "senha", "password", "acesso negado", "nao consigo entrar"],
    resposta:
      "Tente as seguintes soluções:\n1. Limpe o cache do navegador (Ctrl+Shift+Del)\n2. Tente em uma aba anônima\n3. Verifique se o email está correto\n4. Use a opção 'Magic Link' para receber um link de acesso por email\n5. Se usa biometria, tente desativar e reativar nas configurações do navegador",
  },
  {
    keywords: ["lento", "devagar", "carregando", "loading", "demora", "travando"],
    resposta:
      "Algumas dicas para melhorar a performance:\n1. Verifique sua conexão de internet\n2. Limpe o cache do navegador\n3. Feche outras abas desnecessárias\n4. Tente usar o Chrome ou Edge atualizados\n5. Em mobile, feche e reabra o app",
  },
  {
    keywords: ["boleto", "pagamento", "cobranca", "cobranc", "fatura", "pagar"],
    resposta:
      "Sobre boletos e pagamentos:\n1. Os boletos podem levar até 24h para aparecer após emissão\n2. Após pagamento, o status atualiza em até 48h úteis\n3. Para segunda via, acesse a aba 'Boletos' no portal dos pais",
  },
];

function findFaqMatch(descricao: string): string | null {
  const text = (descricao || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const faq of FAQ) {
    if (faq.keywords.some((kw) => text.includes(
      kw.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
    ))) {
      return faq.resposta;
    }
  }
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Service role authentication check
  const authHeader = req.headers.get("authorization")?.replace("Bearer ", "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (authHeader !== serviceKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Buscar tickets abertos
    const { data: tickets, error } = await sb
      .from("tickets")
      .select(
        "id, numero, email, nome, portal, tipo, descricao, url_pagina, user_agent, criado_em",
      )
      .eq("status", "aberto")
      .order("criado_em", { ascending: true })
      .limit(10);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: CORS,
      });
    }
    if (!tickets || tickets.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: "Nenhum ticket aberto." }),
        { headers: CORS },
      );
    }

    // Build MCP server with staff + dev tools (ticket-resolver runs as staff)
    const server = new McpServer("lumied-ticket-resolver", "2.0.0");
    server.registerAll(staffTools);
    server.registerAll(devTools);

    const ctx: McpContext = {
      sb,
      user: {
        id: "ticket-resolver",
        nome: "Lumied AI",
        email: "lumied-auto@lumied.com.br",
        tipo: "staff",
      },
      scope: "staff",
      req,
    };

    const tools = server.asClaudeTools("staff");
    // deno-lint-ignore no-explicit-any
    const executor = async (name: string, args: Record<string, any>) => {
      const tool = server.getTool(name);
      if (!tool) throw new Error(`Tool not found: ${name}`);
      return await tool.handler(args, ctx);
    };

    let resolved = 0;
    let escalated = 0;
    let ai_resolved = 0;
    const details: Array<{ id: string; numero: number; action: string; tools_used?: string[] }> = [];

    for (const ticket of tickets) {
      // Fast path: FAQ pattern match
      const faqResp = findFaqMatch(ticket.descricao);
      if (faqResp) {
        await sb.from("tickets").update({
          status: "respondido",
          resposta: faqResp,
          respondido_por: "lumied-auto@lumied.com.br",
          tratamento: "FAQ match automático (sem IA)",
        }).eq("id", ticket.id);
        resolved++;
        details.push({ id: ticket.id, numero: ticket.numero, action: "faq_match" });
        continue;
      }

      // Slow path: Claude + MCP tools
      const prompt = `Novo ticket de suporte recebido:

ID: ${ticket.id}
Número: #${ticket.numero}
De: ${ticket.nome || "?"} (${ticket.email})
Portal: ${ticket.portal}
Tipo: ${ticket.tipo}
URL da página: ${ticket.url_pagina || "—"}
User-Agent: ${ticket.user_agent || "—"}

Descrição:
${ticket.descricao}

Sua tarefa:
1. Use as tools disponíveis para diagnosticar o problema (ex: sentry_recent_errors para buscar erros recentes do mesmo portal, escola_status se o problema é de uma escola específica).
2. Decida: você consegue resolver/explicar? Ou precisa escalar para um humano?
3. Chame ticket_respond com uma resposta clara e útil se puder resolver, OU deixe para escalar (não chame ticket_respond — apenas escreva um resumo do que encontrou).

Seja direto e útil. Use tools antes de chutar.`;

      const ai = await askClaudeWithTools(prompt, tools, executor, {
        system:
          "Você é um agente de suporte técnico da Lumied (plataforma SaaS de gestão escolar). " +
          "Tem acesso a tools de diagnóstico e ao banco de dados. " +
          "Sempre diagnostique antes de responder. Responda em português brasileiro. " +
          "Nunca invente informações — use as tools.",
        maxTokens: 1024,
        maxTurns: 5,
      });

      if (ai && ai.tool_calls.some((t) => t.name === "ticket_respond")) {
        // IA resolveu o ticket via tool use
        ai_resolved++;
        details.push({
          id: ticket.id,
          numero: ticket.numero,
          action: "ai_resolved",
          tools_used: ai.tool_calls.map((t) => t.name),
        });
      } else {
        // IA não conseguiu resolver — escalar
        const diagnostico = ai?.text ||
          "Sistema de IA indisponível. Ticket encaminhado para análise humana.";
        await sb.from("tickets").update({
          status: "escalado",
          resposta:
            "Olá! Sua solicitação foi analisada pela nossa equipe de IA e encaminhada para um atendente humano. Você receberá um retorno em breve.",
          tratamento: `Diagnóstico IA: ${diagnostico.slice(0, 500)}`,
          respondido_por: "lumied-auto@lumied.com.br",
        }).eq("id", ticket.id);
        escalated++;
        details.push({
          id: ticket.id,
          numero: ticket.numero,
          action: "escalated",
          tools_used: ai?.tool_calls.map((t) => t.name) || [],
        });
      }
    }

    return new Response(
      JSON.stringify({
        processed: tickets.length,
        resolved_faq: resolved,
        resolved_ai: ai_resolved,
        escalated,
        details,
      }),
      { headers: CORS },
    );
  } catch (e) {
    console.error("[ticket-resolver]", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: CORS },
    );
  }
});
