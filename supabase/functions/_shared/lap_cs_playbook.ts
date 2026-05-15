// ═══════════════════════════════════════════════════════════════
//  LAP — CS Playbook tier-based (Sprint 13)
//
//  Segmenta escolas em Starter / Growth / Premium baseado em ACV.
//  Para cada tier + estado de saúde, retorna próximas ações sugeridas.
// ═══════════════════════════════════════════════════════════════

import { SupabaseClient } from "@supabase/supabase-js";

export type Tier = "starter" | "growth" | "premium" | "enterprise";

export type CsActionItem = {
  prioridade: "alta" | "media" | "baixa";
  acao: string;
  porque: string;
  prazo_dias: number;
  owner: "csm" | "implementation" | "produto" | "fundador";
};

const TIER_BY_PLANO: Record<string, Tier> = {
  starter: "starter",
  gestao: "starter",
  start: "starter",
  basico: "starter",

  evolucao: "growth",
  growth: "growth",
  pro: "growth",

  prestige: "premium",
  premium: "premium",
  enterprise: "enterprise",
  rede: "enterprise",
};

export function detectTier(plano: string | null | undefined): Tier {
  if (!plano) return "starter";
  return TIER_BY_PLANO[plano.toLowerCase()] || "starter";
}

const CADENCIA_BASE = {
  starter:    { call_kickoff: 1, calls_followup: 0, qbr_dias: 90,  cs_ratio: "1:50" },
  growth:     { call_kickoff: 1, calls_followup: 3, qbr_dias: 60,  cs_ratio: "1:25" },
  premium:    { call_kickoff: 2, calls_followup: 6, qbr_dias: 30,  cs_ratio: "1:8" },
  enterprise: { call_kickoff: 3, calls_followup: 12, qbr_dias: 30, cs_ratio: "dedicado" },
};

export type CsPlaybook = {
  escola_id: string;
  escola_nome: string;
  tier: Tier;
  cadencia: typeof CADENCIA_BASE[Tier];
  dias_desde_d0: number | null;
  health_score: number | null;
  health_color: string | null;
  amps_atual: number;
  amps_d60: number | null;
  delta_30d: number;
  proximas_acoes: CsActionItem[];
};

export async function buildPlaybook(
  sb: SupabaseClient,
  escolaIds?: string[],
): Promise<CsPlaybook[]> {
  // Carrega escolas ativas + health cache
  let q = sb.from("escolas")
    .select("id, nome, slug, plano, criado_em, ativo")
    .eq("ativo", true);
  if (escolaIds && escolaIds.length) q = q.in("id", escolaIds);

  const { data: escolas } = await q;
  if (!escolas) return [];

  const ids = (escolas as Array<{ id: string }>).map((e) => e.id);
  if (ids.length === 0) return [];

  const { data: caches } = await sb.from("escola_health_score_cache")
    .select("*").in("escola_id", ids);
  const cacheMap = new Map<string, any>();
  for (const c of (caches ?? []) as any[]) cacheMap.set(c.escola_id, c);

  const now = Date.now();
  const out: CsPlaybook[] = [];

  for (const e of escolas as any[]) {
    const tier = detectTier(e.plano);
    const cache = cacheMap.get(e.id) || {};
    const diasDesdeD0 = e.criado_em
      ? Math.floor((now - new Date(e.criado_em).getTime()) / 86400000)
      : null;

    const acoes = computeAcoes({
      tier,
      diasDesdeD0,
      score: cache.score ?? null,
      color: cache.color ?? null,
      ampsAtual: cache.amps_atual ?? 0,
      ampsD60: cache.amps_d60 ?? null,
      delta30: cache.delta_30d ?? 0,
      stakeholders: cache.breakdown?.stakeholders?.count ?? 0,
    });

    out.push({
      escola_id: e.id,
      escola_nome: e.nome,
      tier,
      cadencia: CADENCIA_BASE[tier],
      dias_desde_d0: diasDesdeD0,
      health_score: cache.score ?? null,
      health_color: cache.color ?? null,
      amps_atual: cache.amps_atual ?? 0,
      amps_d60: cache.amps_d60 ?? null,
      delta_30d: cache.delta_30d ?? 0,
      proximas_acoes: acoes,
    });
  }

  // Ordena: vermelhas (alta prioridade) primeiro
  out.sort((a, b) => {
    const aMax = Math.max(0, ...a.proximas_acoes.map(x => prioOrd(x.prioridade)));
    const bMax = Math.max(0, ...b.proximas_acoes.map(x => prioOrd(x.prioridade)));
    return bMax - aMax;
  });

  return out;
}

function prioOrd(p: "alta" | "media" | "baixa"): number {
  return { alta: 3, media: 2, baixa: 1 }[p];
}

function computeAcoes(s: {
  tier: Tier;
  diasDesdeD0: number | null;
  score: number | null;
  color: string | null;
  ampsAtual: number;
  ampsD60: number | null;
  delta30: number;
  stakeholders: number;
}): CsActionItem[] {
  const acoes: CsActionItem[] = [];
  const dias = s.diasDesdeD0 ?? 0;
  const isPremium = s.tier === "premium" || s.tier === "enterprise";

  // Onboarding (D0 → D14)
  if (dias <= 14) {
    if (dias < 1) {
      acoes.push({
        prioridade: "alta",
        acao: isPremium ? "Agendar kickoff completo (bootcamp 2h)" : "Agendar kickoff 30min ou enviar Welcome Kit",
        porque: "Escola recém-provisionada, ainda não logou.",
        prazo_dias: 1,
        owner: isPremium ? "implementation" : "csm",
      });
    } else if (s.stakeholders === 0) {
      acoes.push({
        prioridade: "alta",
        acao: "Ligar pra escola — ninguém logou ainda",
        porque: `${dias} dias desde D0 sem qualquer login. Risco de churn imediato.`,
        prazo_dias: 1,
        owner: "csm",
      });
    } else if (s.stakeholders < 2) {
      acoes.push({
        prioridade: "media",
        acao: "Lembrar de convidar 2º usuário",
        porque: "Escolas com 1 usuário só churnam 3× mais.",
        prazo_dias: 3,
        owner: "csm",
      });
    }
  }

  // D14 → D30: cobertura de stakeholders
  if (dias > 14 && dias <= 30 && s.stakeholders < 3) {
    acoes.push({
      prioridade: "media",
      acao: "Garantir cobertura de personas críticas",
      porque: `Apenas ${s.stakeholders}/4 personas logaram (diretor/financeiro/secretaria/manut). Sem cobertura, LHS fica baixo.`,
      prazo_dias: 7,
      owner: "csm",
    });
  }

  // D30 → D60: ativação de módulos
  if (dias > 30 && dias <= 60 && s.ampsAtual < 3) {
    acoes.push({
      prioridade: "alta",
      acao: "Empurrar ativação de módulo 2 e 3",
      porque: `AMPS atual ${s.ampsAtual}. Meta D60 é 3+. Sem isso, AMPS@D60 (NSM) não bate.`,
      prazo_dias: 14,
      owner: "csm",
    });
  }

  // Health vermelho ou amarelo em qualquer momento
  if (s.color === "red") {
    acoes.push({
      prioridade: "alta",
      acao: "Reunião de revisão obrigatória (vermelho)",
      porque: `Health Score ${s.score}. Escola em risco crítico — entender se é técnico, processo ou cliente desengajado.`,
      prazo_dias: 3,
      owner: isPremium ? "implementation" : "csm",
    });
  } else if (s.color === "yellow" && s.delta30 < -10) {
    acoes.push({
      prioridade: "media",
      acao: "Acompanhar tendência negativa",
      porque: `Score caiu ${Math.abs(s.delta30)} pontos nos últimos 30d. Investigar causa antes de virar vermelho.`,
      prazo_dias: 7,
      owner: "csm",
    });
  }

  // QBR cadenciado por tier
  if (dias > 0 && dias % CADENCIA_BASE[s.tier].qbr_dias === 0) {
    acoes.push({
      prioridade: "media",
      acao: `QBR (Quarterly Business Review) — ${CADENCIA_BASE[s.tier].qbr_dias} dias`,
      porque: `Cadência ${s.tier}: review programado a cada ${CADENCIA_BASE[s.tier].qbr_dias} dias.`,
      prazo_dias: 7,
      owner: "csm",
    });
  }

  // Expansion (Starter elegível pra Growth)
  if (s.tier === "starter" && s.ampsAtual >= 5 && (s.score ?? 0) >= 70) {
    acoes.push({
      prioridade: "media",
      acao: "Oferta de upgrade pra Growth",
      porque: `Escola Starter com ${s.ampsAtual} módulos ativos + LHS ${s.score}. Sinal positivo de expansão.`,
      prazo_dias: 14,
      owner: "fundador",
    });
  }

  if (acoes.length === 0) {
    acoes.push({
      prioridade: "baixa",
      acao: "Manter contato mensal",
      porque: "Escola saudável sem flags imediatos. Cadência normal do tier.",
      prazo_dias: 30,
      owner: "csm",
    });
  }

  return acoes;
}
