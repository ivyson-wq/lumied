// ═══════════════════════════════════════════════════════════════
//  MCP Tools — Gerente scope (Direção escolar)
//
//  Tools que o Lumi (assistente IA) usa para responder perguntas
//  do gerente com dados reais da escola.
// ═══════════════════════════════════════════════════════════════

import type { McpTool } from "../_shared/mcp.ts";
import { askClaude, SYSTEM_PROMPTS } from "../_shared/ai.ts";

export const gerenteTools: McpTool[] = [
  // ─── KPIs / Dashboard ─────────────────────────────────────────
  {
    name: "kpis_resumo_dia",
    description:
      "Resumo do dia da escola: total alunos ativos, presentes hoje, " +
      "boletos vencendo esta semana, leads no CRM, tickets abertos, " +
      "próximos eventos. Use quando o gerente pedir 'resumo' ou 'como está o dia'.",
    scope: "gerente",
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, { sb }) => {
      const hoje = new Date().toISOString().split("T")[0];
      const semanaFrente = new Date(Date.now() + 7 * 86400000)
        .toISOString()
        .split("T")[0];

      const [alunos, presentes, boletos, leads, tickets] = await Promise.all([
        sb.from("alunos").select("id", { count: "exact", head: true }).eq("ativo", true),
        sb.from("frequencia").select("presente").eq("data", hoje),
        sb
          .from("boletos")
          .select("valor")
          .eq("status", "pendente")
          .lte("vencimento", semanaFrente),
        sb
          .from("crm_leads")
          .select("id", { count: "exact", head: true })
          .eq("status", "novo"),
        sb
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .in("status", ["aberto", "escalado"]),
      ]);

      const presData = presentes.data || [];
      const boletosData = boletos.data || [];
      const totalBoletos = boletosData.reduce(
        (s, b) => s + (Number((b as { valor: number }).valor) || 0),
        0,
      );

      return {
        data: hoje,
        total_alunos_ativos: alunos.count || 0,
        presentes_hoje: presData.filter((f) => (f as { presente: boolean }).presente).length,
        ausentes_hoje: presData.filter((f) => !(f as { presente: boolean }).presente).length,
        boletos_vencendo_7d: {
          quantidade: boletosData.length,
          total_valor: totalBoletos.toFixed(2),
        },
        leads_novos: leads.count || 0,
        tickets_abertos: tickets.count || 0,
      };
    },
  },

  // ─── Buscar aluno ─────────────────────────────────────────────
  {
    name: "buscar_aluno",
    description:
      "Busca ficha de um aluno por nome (busca parcial). Retorna dados pessoais, " +
      "turma, responsável, status financeiro, frequência recente.",
    scope: "gerente",
    inputSchema: {
      type: "object",
      required: ["nome"],
      properties: {
        nome: { type: "string", description: "Nome ou parte do nome" },
      },
    },
    handler: async ({ nome }, { sb }) => {
      const { data, error } = await sb
        .from("alunos")
        .select(
          "id, nome, responsavel_nome, cpf, serie, data_nascimento, turno, atividades_ids, ativo",
        )
        .ilike("nome", `%${nome}%`)
        .eq("ativo", true)
        .limit(10);
      if (error) throw new Error(error.message);
      return { encontrados: data?.length || 0, alunos: data || [] };
    },
  },

  // ─── Inadimplência ────────────────────────────────────────────
  {
    name: "analise_inadimplencia",
    description:
      "Análise detalhada da inadimplência: total em aberto, número de famílias, " +
      "boletos vencidos há mais de 30/60/90 dias, top devedores. " +
      "Use quando o gerente perguntar sobre 'inadimplência', 'atrasados', 'devedores'.",
    scope: "gerente",
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, { sb }) => {
      const { data: boletos, error } = await sb
        .from("boletos")
        .select("id, valor, vencimento, familia_nome, status")
        .in("status", ["pendente", "vencido"]);
      if (error) throw new Error(error.message);

      const hoje = new Date();
      const vencidos = (boletos || []).filter(
        (b) => new Date((b as { vencimento: string }).vencimento) < hoje,
      );
      // deno-lint-ignore no-explicit-any
      const faixa = (dias: number) => vencidos.filter((b: any) => {
        const diff = (hoje.getTime() - new Date(b.vencimento).getTime()) / 86400000;
        return diff > dias;
      });

      // deno-lint-ignore no-explicit-any
      const porFamilia = new Map<string, any>();
      for (const b of vencidos) {
        // deno-lint-ignore no-explicit-any
        const bb = b as any;
        const key = bb.familia_nome || "?";
        const cur = porFamilia.get(key) || { nome: key, total: 0, qtd: 0 };
        cur.total += Number(bb.valor || 0);
        cur.qtd += 1;
        porFamilia.set(key, cur);
      }
      const topDevedores = [...porFamilia.values()]
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      return {
        total_vencidos: vencidos.length,
        // deno-lint-ignore no-explicit-any
        total_valor: vencidos.reduce((s, b: any) => s + Number(b.valor || 0), 0).toFixed(2),
        vencidos_30d_plus: faixa(30).length,
        vencidos_60d_plus: faixa(60).length,
        vencidos_90d_plus: faixa(90).length,
        top_devedores: topDevedores,
      };
    },
  },

  // ─── Frequência crítica ───────────────────────────────────────
  {
    name: "alunos_frequencia_critica",
    description:
      "Lista alunos com frequência abaixo de um limiar (default 75%) no mês atual. " +
      "Útil para identificar risco de evasão ou problemas.",
    scope: "gerente",
    inputSchema: {
      type: "object",
      properties: {
        limiar_pct: { type: "integer", default: 75, minimum: 0, maximum: 100 },
      },
    },
    handler: async ({ limiar_pct = 75 }, { sb }) => {
      const mesAtual = new Date();
      const primeiroDia = new Date(mesAtual.getFullYear(), mesAtual.getMonth(), 1)
        .toISOString()
        .split("T")[0];
      const { data, error } = await sb
        .from("frequencia")
        .select("aluno_id, aluno_nome, presente")
        .gte("data", primeiroDia);
      if (error) throw new Error(error.message);

      // deno-lint-ignore no-explicit-any
      const porAluno = new Map<string, any>();
      for (const r of data || []) {
        // deno-lint-ignore no-explicit-any
        const rr = r as any;
        const cur = porAluno.get(rr.aluno_id) || {
          aluno_id: rr.aluno_id,
          nome: rr.aluno_nome,
          total: 0,
          presentes: 0,
        };
        cur.total += 1;
        if (rr.presente) cur.presentes += 1;
        porAluno.set(rr.aluno_id, cur);
      }
      const criticos = [...porAluno.values()]
        .map((a) => ({ ...a, pct: a.total > 0 ? Math.round((a.presentes / a.total) * 100) : 0 }))
        .filter((a) => a.pct < (limiar_pct as number))
        .sort((a, b) => a.pct - b.pct);
      return { limiar_pct, total: criticos.length, alunos: criticos };
    },
  },

  // ─── CRM: leads parados ───────────────────────────────────────
  {
    name: "leads_parados",
    description:
      "Lista leads do CRM sem follow-up há mais de N dias (default 7). " +
      "Cada dia sem contato reduz a conversão — use para alertar o gerente.",
    scope: "gerente",
    inputSchema: {
      type: "object",
      properties: {
        dias: { type: "integer", default: 7, minimum: 1 },
      },
    },
    handler: async ({ dias = 7 }, { sb }) => {
      const limite = new Date(Date.now() - (dias as number) * 86400000)
        .toISOString();
      const { data, error } = await sb
        .from("crm_leads")
        .select("id, nome, email, telefone, status, atualizado_em, origem")
        .lt("atualizado_em", limite)
        .not("status", "in", "(convertido,perdido)")
        .order("atualizado_em", { ascending: true })
        .limit(50);
      if (error) throw new Error(error.message);
      return { dias, total: data?.length || 0, leads: data || [] };
    },
  },

  // ─── Redigir comunicado ───────────────────────────────────────
  {
    name: "redigir_comunicado",
    description:
      "Gera o texto de um comunicado escolar via IA. NÃO envia — apenas retorna " +
      "o texto para o gerente revisar. Tom: profissional e amigável por padrão.",
    scope: "gerente",
    inputSchema: {
      type: "object",
      required: ["assunto"],
      properties: {
        assunto: { type: "string", description: "Tema do comunicado" },
        tom: {
          type: "string",
          enum: ["formal", "profissional_amigavel", "urgente", "comemorativo"],
          default: "profissional_amigavel",
        },
        contexto: { type: "string", description: "Informações adicionais" },
      },
    },
    handler: async ({ assunto, tom = "profissional_amigavel", contexto }) => {
      const ai = await askClaude(
        `Redija um comunicado escolar para os pais sobre: "${assunto}". ${contexto || ""}
Tom: ${tom}. Máximo 5 linhas. Comece com saudação. Termine com assinatura "Equipe [escola]".`,
        {
          system:
            "Você é redator de comunicados escolares. Escreva em português brasileiro.",
          maxTokens: 300,
        },
      );
      if (!ai) throw new Error("IA indisponível no momento");
      return { texto: ai.text, tokens: ai.tokens_input + ai.tokens_output };
    },
  },

  // ─── Analisar turma (para professora) ─────────────────────────
  {
    name: "analisar_turma",
    description:
      "Análise de uma turma: pontos fortes, pontos de atenção, sugestão pedagógica. " +
      "Gerada via IA com base em dados reais (alunos, frequência).",
    scope: "professora",
    inputSchema: {
      type: "object",
      properties: {
        serie_id: { type: "string", description: "ID da turma (opcional, usa a do usuário se omitido)" },
      },
    },
    handler: async ({ serie_id }, { sb, user }) => {
      let turmaId = serie_id;
      if (!turmaId && user?.id) {
        const { data: prof } = await sb
          .from("professoras")
          .select("serie_id")
          .eq("id", user.id)
          .maybeSingle();
        // deno-lint-ignore no-explicit-any
        turmaId = (prof as any)?.serie_id;
      }
      if (!turmaId) throw new Error("serie_id não informado e usuário sem turma");

      const [alunos, turma] = await Promise.all([
        sb.from("alunos").select("id", { count: "exact", head: true }).eq("serie_id", turmaId),
        sb.from("series").select("nome").eq("id", turmaId).maybeSingle(),
      ]);
      const contexto = {
        turma: (turma.data as { nome?: string } | null)?.nome || "?",
        total_alunos: alunos.count || 0,
      };
      const ai = await askClaude(
        `Dados da turma: ${JSON.stringify(contexto)}. Faça uma análise breve: pontos fortes, pontos de atenção e 1 sugestão pedagógica.`,
        { system: SYSTEM_PROMPTS.professora, maxTokens: 300 },
      );
      if (!ai) throw new Error("IA indisponível");
      return { turma: contexto, analise: ai.text };
    },
  },

  // ─── Módulos ativos ───────────────────────────────────────────
  {
    name: "modulos_ativos",
    description:
      "Lista os módulos habilitados para a escola. Útil para entender o que a escola tem contratado.",
    scope: "gerente",
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, { sb }) => {
      const { data: escola } = await sb
        .from("escolas")
        .select("id, nome, plano")
        .eq("ativo", true)
        .limit(1)
        .maybeSingle();
      if (!escola) throw new Error("Escola não encontrada");
      const { data: modulos, error } = await sb
        .from("escola_modulos")
        .select("modulo_id, habilitado, modulos(slug, nome, categoria)")
        .eq("escola_id", (escola as { id: string }).id)
        .eq("habilitado", true);
      if (error) throw new Error(error.message);
      return {
        escola: (escola as { nome: string; plano: string }).nome,
        plano: (escola as { nome: string; plano: string }).plano,
        total_modulos: modulos?.length || 0,
        // deno-lint-ignore no-explicit-any
        modulos: (modulos || []).map((m: any) => m.modulos),
      };
    },
  },
];
