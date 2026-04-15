// ═══════════════════════════════════════════════════════════════
//  MCP Tools — Cozinha (Merenda escolar)
//
//  Tools que o Lumi (IA) usa para responder sobre cardápio,
//  estoque, compras, alergias e custos de refeição.
// ═══════════════════════════════════════════════════════════════

import type { McpTool } from "../_shared/mcp.ts";

async function getEscola(sb: any, user: any): Promise<string | null> {
  if (user?.escola_id) return user.escola_id;
  const { data } = await sb.from("escolas").select("id").limit(1).single();
  return data?.id ?? null;
}

export const cozinhaTools: McpTool[] = [
  {
    name: "cardapio_proximos_dias",
    description:
      "Cardápio aprovado dos próximos N dias (padrão 7). Use quando o gerente perguntar " +
      "'o que tem para comer amanhã', 'cardápio da semana' ou pedidos similares.",
    scope: "gerente",
    inputSchema: {
      type: "object",
      properties: { dias: { type: "number", default: 7 } },
    },
    handler: async ({ dias = 7 }, { sb, user }) => {
      const escola = await getEscola(sb, user);
      const hoje = new Date().toISOString().split("T")[0];
      const fim = new Date(Date.now() + Number(dias) * 86400000).toISOString().split("T")[0];
      const { data } = await sb.from("cozinha_cardapios")
        .select("data, refeicao, faixa_etaria, descricao_livre, aprovado_em, publicado, cozinha_receitas(nome)")
        .eq("escola_id", escola)
        .gte("data", hoje).lte("data", fim)
        .order("data").order("refeicao");
      return { dias, total: data?.length ?? 0, cardapios: data ?? [] };
    },
  },
  {
    name: "compras_projetar",
    description:
      "Projeta lista de compras necessárias para os próximos dias com base no cardápio aprovado " +
      "e estoque atual. Retorna itens, quantidades e preço estimado. Use quando o gerente perguntar " +
      "'o que precisamos comprar' ou 'quanto vou gastar com merenda essa semana'.",
    scope: "gerente",
    inputSchema: {
      type: "object",
      properties: {
        dias: { type: "number", default: 7 },
        porcoes: { type: "number", default: 100, description: "porções previstas por refeição" },
      },
    },
    handler: async ({ dias = 7, porcoes = 100 }, { sb, user }) => {
      const escola = await getEscola(sb, user);
      const { data } = await sb.rpc("cozinha_projetar_compras", {
        p_escola: escola, p_dias: Number(dias), p_porcoes_padrao: Number(porcoes),
      });
      const total = (data ?? []).reduce((s: number, i: any) => s + Number(i.preco_estimado || 0), 0);
      return { dias, porcoes, total_estimado: total.toFixed(2), itens: data ?? [] };
    },
  },
  {
    name: "alergias_conflito_dia",
    description:
      "Verifica conflitos entre cardápio do dia e alergias/restrições cadastradas. " +
      "Retorna lista de alunos em risco com refeição, receita e alergeno. Use ANTES de cada " +
      "refeição ou quando o gerente perguntar sobre segurança alimentar.",
    scope: "gerente",
    inputSchema: {
      type: "object",
      properties: { data: { type: "string", description: "YYYY-MM-DD (default: hoje)" } },
    },
    handler: async ({ data: dt }, { sb, user }) => {
      const escola = await getEscola(sb, user);
      const dia = dt || new Date().toISOString().split("T")[0];
      const { data: cards } = await sb.from("cozinha_cardapios")
        .select("id, refeicao, receita_id, cozinha_receitas(nome, cozinha_receita_ingredientes(cozinha_alimentos(nome, alergenos)))")
        .eq("escola_id", escola).eq("data", dia);
      const { data: rest } = await sb.from("cantina_restricoes")
        .select("*").eq("escola_id", escola);
      const conflitos: any[] = [];
      for (const c of cards ?? []) {
        const alergenos = new Set<string>();
        const ings = (c as any).cozinha_receitas?.cozinha_receita_ingredientes || [];
        for (const i of ings) (i.cozinha_alimentos?.alergenos || []).forEach((a: string) => alergenos.add(a.toLowerCase()));
        for (const r of rest ?? []) {
          const rd = String((r as any).descricao || "").toLowerCase();
          const rt = String((r as any).tipo || "").toLowerCase();
          for (const a of alergenos) {
            if (rd.includes(a) || rt.includes(a)) conflitos.push({
              aluno: (r as any).aluno_nome || (r as any).aluno_email,
              severidade: (r as any).severidade,
              refeicao: (c as any).refeicao,
              receita: (c as any).cozinha_receitas?.nome,
              alergeno: a,
            });
          }
        }
      }
      return { data: dia, total_conflitos: conflitos.length, conflitos };
    },
  },
  {
    name: "custo_refeicao_periodo",
    description:
      "Custo real de merenda no período (baseado em consumo registrado). " +
      "Retorna total gasto, porções servidas e custo médio por porção. Use quando perguntarem " +
      "'quanto gastamos com merenda' ou 'custo por aluno'.",
    scope: "gerente",
    inputSchema: {
      type: "object",
      properties: {
        dias: { type: "number", default: 30 },
      },
    },
    handler: async ({ dias = 30 }, { sb, user }) => {
      const escola = await getEscola(sb, user);
      const desde = new Date(Date.now() - Number(dias) * 86400000).toISOString().split("T")[0];
      const { data: consumo } = await sb.from("cozinha_consumo")
        .select("custo_total, data").eq("escola_id", escola).gte("data", desde);
      const { data: desp } = await sb.from("cozinha_desperdicio")
        .select("porcoes_servidas, data").eq("escola_id", escola).gte("data", desde);
      const total = (consumo ?? []).reduce((s: number, c: any) => s + Number(c.custo_total || 0), 0);
      const porcoes = (desp ?? []).reduce((s: number, d: any) => s + Number(d.porcoes_servidas || 0), 0);
      return {
        periodo_dias: dias,
        custo_total: total.toFixed(2),
        porcoes_servidas: porcoes,
        custo_medio_porcao: porcoes > 0 ? (total / porcoes).toFixed(2) : null,
      };
    },
  },
  {
    name: "estoque_critico",
    description:
      "Alimentos abaixo do estoque mínimo OU com lotes vencendo em 7 dias. Use para alertas " +
      "proativos. Gatilho: 'o que está acabando', 'vencimentos', 'alertas de cozinha'.",
    scope: "gerente",
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, { sb, user }) => {
      const escola = await getEscola(sb, user);
      const sete = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
      const [est, venc] = await Promise.all([
        sb.from("v_cozinha_estoque").select("nome, estoque_valido, estoque_minimo, unidade_uso, categoria")
          .eq("escola_id", escola),
        sb.from("cozinha_alimento_lotes")
          .select("quantidade, validade, cozinha_alimentos(nome)")
          .eq("escola_id", escola).gt("quantidade", 0)
          .not("validade", "is", null).lte("validade", sete).order("validade"),
      ]);
      const abaixoMin = (est.data ?? []).filter((e: any) => Number(e.estoque_valido) < Number(e.estoque_minimo || 0));
      return {
        abaixo_minimo: abaixoMin,
        vencendo_7d: venc.data ?? [],
      };
    },
  },
];
