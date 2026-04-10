// ═══════════════════════════════════════════════════════════════
//  MCP Tools — Compliance / Ponto CLT
//
//  Analytical tools for compliance: hora extra, score, quiz generation,
//  alertas, certificações vencendo.
// ═══════════════════════════════════════════════════════════════

import type { McpTool } from "../_shared/mcp.ts";
import { askClaude } from "../_shared/ai.ts";

export const complianceTools: McpTool[] = [
  // ─── Score de compliance ──────────────────────────────────────
  {
    name: "compliance_score",
    description:
      "Score de compliance 0-100 da escola. Considera: problemas abertos em " +
      "inspeções, certificações vencendo, políticas sem aceite, prazos regulatórios próximos. " +
      "Use quando o gerente perguntar 'como está a compliance' ou 'qual nosso score'.",
    scope: "gerente",
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, { sb }) => {
      const hoje = new Date().toISOString().split("T")[0];
      const em30d = new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .split("T")[0];
      const [incidentes, certs, inspecoes, prazos] = await Promise.all([
        sb
          .from("compliance_ocorrencias")
          .select("id", { count: "exact", head: true })
          .eq("status", "aberta"),
        sb
          .from("compliance_certificacoes")
          .select("id, data_vencimento, status")
          .lte("data_vencimento", em30d),
        sb
          .from("compliance_inspecoes")
          .select("score_conformidade")
          .not("score_conformidade", "is", null)
          .order("criado_em", { ascending: false })
          .limit(5),
        sb
          .from("compliance_calendario")
          .select("id", { count: "exact", head: true })
          .eq("status", "pendente")
          .lte("data_limite", em30d),
      ]);

      // Score calculation: start 100, deduct for each issue
      let score = 100;
      const incCount = incidentes.count || 0;
      const certVencidas = (certs.data || []).filter(
        // deno-lint-ignore no-explicit-any
        (c: any) => c.data_vencimento < hoje,
      ).length;
      const certProximas = (certs.data || []).length - certVencidas;
      const prazosCount = prazos.count || 0;
      score -= Math.min(incCount * 5, 25);
      score -= certVencidas * 10;
      score -= certProximas * 3;
      score -= Math.min(prazosCount * 2, 15);
      // deno-lint-ignore no-explicit-any
      const inspMedia = (inspecoes.data || []).reduce((s, i: any) => s + Number(i.score_conformidade || 0), 0) /
        Math.max((inspecoes.data || []).length, 1);
      if (inspMedia > 0 && inspMedia < 80) score -= (80 - inspMedia) / 4;
      score = Math.max(0, Math.round(score));

      return {
        score,
        interpretacao:
          score >= 90
            ? "Excelente"
            : score >= 75
              ? "Bom"
              : score >= 60
                ? "Atenção"
                : "Crítico",
        detalhes: {
          incidentes_abertos: incCount,
          certificacoes_vencidas: certVencidas,
          certificacoes_vencendo_30d: certProximas,
          prazos_regulatorios_30d: prazosCount,
          score_inspecoes_media: Math.round(inspMedia),
        },
      };
    },
  },

  // ─── Analisar ponto do mês ────────────────────────────────────
  {
    name: "analisar_ponto_mes",
    description:
      "Analisa registros de ponto de uma professora no mês: total horas, " +
      "horas extras 50%/100%, hora noturna, banco de horas, ocorrências. " +
      "Use para compliance CLT e fechamento mensal.",
    scope: "gerente",
    inputSchema: {
      type: "object",
      required: ["professora_id"],
      properties: {
        professora_id: { type: "string" },
        mes: { type: "string", description: "YYYY-MM, default mês atual" },
      },
    },
    handler: async ({ professora_id, mes }, { sb }) => {
      const agora = new Date();
      const mesRef = mes ||
        `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
      const inicio = `${mesRef}-01`;
      const [ano, m] = mesRef.split("-").map(Number);
      const fim = new Date(ano, m, 0).toISOString().split("T")[0];

      const { data: registros, error } = await sb
        .from("compliance_ponto_registros")
        .select(
          "data, minutos_trabalhados, minutos_he_50, minutos_he_100, minutos_noturno, atraso_minutos",
        )
        .eq("professora_id", professora_id)
        .gte("data", inicio)
        .lte("data", fim);
      if (error) throw new Error(error.message);

      // deno-lint-ignore no-explicit-any
      const totais = (registros || []).reduce((acc: any, r: any) => ({
        trabalhados: acc.trabalhados + (r.minutos_trabalhados || 0),
        he_50: acc.he_50 + (r.minutos_he_50 || 0),
        he_100: acc.he_100 + (r.minutos_he_100 || 0),
        noturno: acc.noturno + (r.minutos_noturno || 0),
        atrasos: acc.atrasos + (r.atraso_minutos || 0),
      }), { trabalhados: 0, he_50: 0, he_100: 0, noturno: 0, atrasos: 0 });

      const { data: ocorrencias } = await sb
        .from("compliance_ocorrencias")
        .select("tipo, status")
        .eq("professora_id", professora_id)
        .gte("criado_em", inicio);

      const toH = (min: number) =>
        `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;

      return {
        professora_id,
        mes: mesRef,
        registros_count: registros?.length || 0,
        horas: {
          trabalhadas: toH(totais.trabalhados),
          he_50_pct: toH(totais.he_50),
          he_100_pct: toH(totais.he_100),
          noturna: toH(totais.noturno),
          atrasos: toH(totais.atrasos),
        },
        minutos: totais,
        ocorrencias: ocorrencias || [],
      };
    },
  },

  // ─── Certificações vencendo ───────────────────────────────────
  {
    name: "certificacoes_vencendo",
    description:
      "Lista certificações obrigatórias que estão vencidas ou vencem em N dias (default 60).",
    scope: "gerente",
    inputSchema: {
      type: "object",
      properties: {
        dias: { type: "integer", default: 60 },
      },
    },
    handler: async ({ dias = 60 }, { sb }) => {
      const limite = new Date(Date.now() + (dias as number) * 86400000)
        .toISOString()
        .split("T")[0];
      const { data, error } = await sb
        .from("compliance_certificacoes")
        .select("id, tipo, titulo, data_vencimento, responsavel, status")
        .lte("data_vencimento", limite)
        .order("data_vencimento", { ascending: true });
      if (error) throw new Error(error.message);
      const hoje = new Date().toISOString().split("T")[0];
      return {
        total: data?.length || 0,
        // deno-lint-ignore no-explicit-any
        vencidas: (data || []).filter((c: any) => c.data_vencimento < hoje),
        // deno-lint-ignore no-explicit-any
        proximas: (data || []).filter((c: any) => c.data_vencimento >= hoje),
      };
    },
  },

  // ─── Gerar quiz de política ───────────────────────────────────
  {
    name: "gerar_quiz_politica",
    description:
      "Gera um quiz de compliance automaticamente a partir do texto de uma política/protocolo. " +
      "Retorna 5-8 perguntas de múltipla escolha com resposta correta marcada. " +
      "Use quando o gerente quer criar treinamento baseado em um documento.",
    scope: "gerente",
    inputSchema: {
      type: "object",
      required: ["tema"],
      properties: {
        tema: {
          type: "string",
          description: "Tema do quiz (ex: 'evacuação', 'bullying', 'LGPD')",
        },
        num_perguntas: { type: "integer", default: 6, minimum: 3, maximum: 10 },
        texto_politica: {
          type: "string",
          description: "Texto da política para gerar perguntas (opcional)",
        },
      },
    },
    handler: async ({ tema, num_perguntas = 6, texto_politica }) => {
      const prompt = `Gere um quiz de compliance sobre "${tema}" com ${num_perguntas} perguntas de múltipla escolha (4 alternativas cada).
${texto_politica ? `Use como base este texto:\n${texto_politica.slice(0, 3000)}\n` : ""}
Retorne APENAS JSON válido no formato:
{
  "titulo": "...",
  "perguntas": [
    {"pergunta": "...", "alternativas": ["a", "b", "c", "d"], "correta": 0, "explicacao": "..."}
  ]
}`;
      const ai = await askClaude(prompt, {
        system:
          "Você é especialista em compliance escolar. Retorne apenas JSON válido, sem markdown.",
        maxTokens: 1500,
      });
      if (!ai) throw new Error("IA indisponível");
      try {
        const cleaned = ai.text
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
        return JSON.parse(cleaned);
      } catch {
        return { raw: ai.text, warning: "JSON parse falhou — retornando texto bruto" };
      }
    },
  },

  // ─── Alertas de compliance ───────────────────────────────────
  {
    name: "alertas_compliance",
    description:
      "Lista alertas de compliance ativos: HE não autorizada, ciências pendentes, " +
      "quizzes vencidos, políticas sem aceite.",
    scope: "gerente",
    inputSchema: { type: "object", properties: {} },
    handler: async (_args, { sb }) => {
      const { data, error } = await sb
        .from("compliance_alertas")
        .select("*")
        .eq("ativo", true)
        .order("criado_em", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return { total: data?.length || 0, alertas: data || [] };
    },
  },
];
