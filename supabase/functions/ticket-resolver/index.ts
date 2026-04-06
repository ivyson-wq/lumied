// ═══════════════════════════════════════════════════════════════
//  Lumied — Edge Function: ticket-resolver
//  Chamada via pg_cron a cada 15 min. Resolve tickets automaticamente.
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Base de conhecimento para auto-resposta ──
const FAQ: Array<{ keywords: string[]; resposta: string }> = [
  {
    keywords: ["login", "entrar", "senha", "password", "acesso negado", "nao consigo entrar", "não consigo entrar"],
    resposta: "Tente as seguintes soluções:\n1. Limpe o cache do navegador (Ctrl+Shift+Del)\n2. Tente em uma aba anônima\n3. Verifique se o email está correto\n4. Use a opção 'Magic Link' para receber um link de acesso por email\n5. Se usa biometria, tente desativar e reativar nas configurações do navegador\n\nSe o problema persistir, nossa equipe irá analisar.",
  },
  {
    keywords: ["lento", "devagar", "carregando", "loading", "demora", "travando"],
    resposta: "Algumas dicas para melhorar a performance:\n1. Verifique sua conexão de internet\n2. Limpe o cache do navegador\n3. Feche outras abas desnecessárias\n4. Tente usar o Chrome ou Edge atualizados\n5. Em mobile, feche e reabra o app\n\nSe o problema persistir com boa internet, nossa equipe irá investigar.",
  },
  {
    keywords: ["boleto", "pagamento", "cobranca", "cobranc", "fatura", "pagar"],
    resposta: "Sobre boletos e pagamentos:\n1. Os boletos podem levar até 24h para aparecer após emissão\n2. Após pagamento, o status atualiza em até 48h úteis\n3. Para segunda via, acesse a aba 'Boletos' no portal dos pais\n4. Se o boleto não aparece, verifique se a escola ativou o módulo financeiro\n\nPara questões específicas de valores, entre em contato com a secretaria da escola.",
  },
  {
    keywords: ["turno", "horario", "horário", "mudanca de turno", "mudança de turno"],
    resposta: "Para mudança de turno:\n1. Acesse o portal dos pais\n2. Clique na aba 'Mudança de Turno'\n3. Selecione o novo turno desejado\n4. A solicitação será analisada pela escola\n5. Você receberá uma notificação quando for aprovada/recusada\n\nAs vagas dependem da disponibilidade de cada turno.",
  },
  {
    keywords: ["pickup", "buscar", "estou a caminho", "chegando", "fila"],
    resposta: "Sobre o Pickup:\n1. O botão 'Estou a Caminho' só aparece quando você está próximo da escola (raio configurado)\n2. Ative a localização (GPS) no navegador\n3. Em iOS, permita o acesso à localização para o Safari/Chrome\n4. A fila é atualizada em tempo real para a escola\n\nSe o GPS não funciona, verifique as permissões do navegador.",
  },
  {
    keywords: ["biometria", "face id", "fingerprint", "digital", "reconhecimento facial", "webauthn"],
    resposta: "Sobre login biométrico:\n1. A biometria precisa ser cadastrada primeiro fazendo login normal\n2. Após o login, o sistema oferece cadastrar Face ID/fingerprint\n3. Funciona apenas no mesmo dispositivo onde foi cadastrada\n4. Se mudou de celular, faça login normal e cadastre novamente\n5. Em desktop, precisa de Windows Hello ou Touch ID (Mac)\n\nPara resetar, faça login com email/senha e recadastre.",
  },
  {
    keywords: ["erro", "error", "bug", "quebrado", "nao funciona", "não funciona", "tela branca", "500"],
    resposta: "Identificamos seu relato de erro. Algumas soluções rápidas:\n1. Atualize a página (F5 ou Ctrl+R)\n2. Limpe o cache (Ctrl+Shift+Del)\n3. Tente em aba anônima\n4. Verifique se o JavaScript está habilitado\n\nNossa equipe técnica foi notificada e irá investigar o problema específico.",
  },
  {
    keywords: ["impressao", "impressão", "imprimir", "pdf", "relatorio", "relatório"],
    resposta: "Para impressão/PDF:\n1. Use o botão de impressão/PDF na tela desejada\n2. O PDF é gerado no navegador — aguarde o processamento\n3. Se não gera, verifique se pop-ups estão permitidos\n4. Em mobile, o PDF é baixado automaticamente\n5. Para relatórios grandes, pode levar alguns segundos\n\nSe o PDF aparece em branco, tente em outro navegador.",
  },
  {
    keywords: ["material", "almoxarifado", "insumo", "requisicao", "requisição", "estoque"],
    resposta: "Sobre materiais/almoxarifado:\n1. Navegue pelo mês desejado usando as setas\n2. Selecione os itens e quantidade na tela de requisição\n3. Itens aparecem com preço unitário (fracionado da embalagem)\n4. Após requisitar, o gerente aprova e desconta do estoque\n5. Para ver histórico, use os filtros de data\n\nSe um item não aparece, verifique com o gerente se está cadastrado.",
  },
];

// ── Detectar FAQ match ──
function findFaqMatch(descricao: string, portal: string): string | null {
  const text = (descricao + " " + portal).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const faq of FAQ) {
    const matched = faq.keywords.some(kw => {
      const kwNorm = kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return text.includes(kwNorm);
    });
    if (matched) return faq.resposta;
  }
  return null;
}

// ── Enviar email de escalação ──
async function sendEscalationEmail(
  resendKey: string,
  ticket: { id: string; email: string; nome: string; portal: string; tipo: string; descricao: string; url_pagina: string; criado_em: string }
) {
  const tipoLabel: Record<string, string> = { bug: "Bug/Erro", duvida: "Dúvida", sugestao: "Sugestão", urgente: "URGENTE" };
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Lumied Tickets <noreply@lumied.com.br>",
      to: ["ivyson@gmail.com"],
      subject: `[Ticket ${tipoLabel[ticket.tipo] || ticket.tipo}] Precisa de atenção manual`,
      html: `<div style="font-family:sans-serif;max-width:600px;">
        <h2 style="color:#C8102E;">Ticket não resolvido automaticamente</h2>
        <p style="color:#666;font-size:13px;">O sistema tentou resolver mas precisa de intervenção humana.</p>
        <table style="border-collapse:collapse;width:100%;margin-top:16px;">
          <tr><td style="padding:8px;font-weight:bold;color:#7a7169;border-bottom:1px solid #eee;">Tipo</td><td style="padding:8px;border-bottom:1px solid #eee;">${tipoLabel[ticket.tipo] || ticket.tipo}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;color:#7a7169;border-bottom:1px solid #eee;">De</td><td style="padding:8px;border-bottom:1px solid #eee;">${ticket.nome || '—'} (${ticket.email})</td></tr>
          <tr><td style="padding:8px;font-weight:bold;color:#7a7169;border-bottom:1px solid #eee;">Portal</td><td style="padding:8px;border-bottom:1px solid #eee;">${ticket.portal}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;color:#7a7169;border-bottom:1px solid #eee;">URL</td><td style="padding:8px;border-bottom:1px solid #eee;">${ticket.url_pagina || '—'}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;color:#7a7169;">Descrição</td><td style="padding:8px;">${ticket.descricao}</td></tr>
        </table>
        <p style="margin-top:20px;font-size:12px;color:#999;">Acesse o painel admin Lumied para responder.</p>
      </div>`,
    }),
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Service role authentication check
  const authHeader = req.headers.get("authorization")?.replace("Bearer ", "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (authHeader !== serviceKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Buscar tickets abertos
    const { data: tickets, error } = await sb
      .from("tickets")
      .select("id, email, nome, portal, tipo, descricao, url_pagina, user_agent, criado_em")
      .eq("status", "aberto")
      .order("criado_em", { ascending: true })
      .limit(20);

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    if (!tickets || tickets.length === 0) return new Response(JSON.stringify({ processed: 0, message: "Nenhum ticket aberto." }), { headers: { ...CORS, "Content-Type": "application/json" } });

    const resendKey = Deno.env.get("RESEND_API_KEY") || "";
    let resolved = 0;
    let escalated = 0;

    for (const ticket of tickets) {
      const faqResp = findFaqMatch(ticket.descricao, ticket.portal);

      if (faqResp) {
        // Auto-resposta via FAQ
        await sb.from("tickets").update({
          status: "respondido",
          resposta: faqResp,
          respondido_por: "lumied-auto@lumied.com.br",
        }).eq("id", ticket.id);
        resolved++;
      } else {
        // Não conseguiu resolver — escalar
        if (resendKey) {
          await sendEscalationEmail(resendKey, ticket);
        }
        await sb.from("tickets").update({
          status: "escalado",
          resposta: "Obrigado pelo seu contato! Sua solicitação foi encaminhada para nossa equipe técnica e será analisada em breve. Você receberá um retorno por email.",
          respondido_por: "lumied-auto@lumied.com.br",
        }).eq("id", ticket.id);
        escalated++;
      }
    }

    return new Response(
      JSON.stringify({ processed: tickets.length, resolved, escalated }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
