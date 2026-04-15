// Budget guard para chamadas Anthropic — verifica e registra uso.
// Combina com feature flag kill_switch_ia para shutdown global.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isFlagOn } from "./flags.ts";

// Preços Claude (USD / 1M tokens). Mantém conservador; pode ajustar.
const PRECO = {
  'claude-opus-4-6':        { input: 15,  output: 75  },
  'claude-sonnet-4-6':      { input: 3,   output: 15  },
  'claude-haiku-4-5':       { input: 0.8, output: 4   },
  // Fallback para versões antigas
  'default':                { input: 3,   output: 15  },
};

export function estimarCustoUsd(model: string, tokensIn: number, tokensOut: number): number {
  const key = Object.keys(PRECO).find(k => model.includes(k)) || 'default';
  const p = (PRECO as Record<string, { input: number; output: number }>)[key];
  return (tokensIn / 1_000_000) * p.input + (tokensOut / 1_000_000) * p.output;
}

export type IACheckResult = {
  ok: boolean;
  motivo?: 'kill_switch' | 'cap_atingido';
  custo_mes?: number;
  cap?: number | null;
};

// Pré-chamada: checa kill-switch e se escola não está bloqueada.
export async function checkIAQuota(sb: SupabaseClient, escolaId: string | null | undefined): Promise<IACheckResult> {
  if (await isFlagOn(sb, 'kill_switch_ia')) {
    return { ok: false, motivo: 'kill_switch' };
  }
  if (!escolaId) return { ok: true };
  const mes = new Date().toISOString().slice(0, 7) + '-01';
  const { data } = await sb.from("escola_ia_uso")
    .select("bloqueado, custo_usd, cap_usd")
    .eq("escola_id", escolaId)
    .eq("mes", mes)
    .maybeSingle();
  if (data?.bloqueado) return { ok: false, motivo: 'cap_atingido', custo_mes: Number(data.custo_usd), cap: Number(data.cap_usd) };
  return { ok: true, custo_mes: Number(data?.custo_usd ?? 0), cap: data?.cap_usd ? Number(data.cap_usd) : null };
}

// Pós-chamada: registra tokens consumidos. Fire-and-forget.
export function registrarIAUso(
  sb: SupabaseClient,
  escolaId: string | null | undefined,
  model: string,
  tokensIn: number,
  tokensOut: number,
): void {
  if (!escolaId) return;
  const custo = estimarCustoUsd(model, tokensIn, tokensOut);
  sb.rpc('registrar_ia_uso', {
    p_escola_id: escolaId,
    p_input: tokensIn,
    p_output: tokensOut,
    p_custo: custo,
  }).then(({ error }: { error: { message: string } | null }) => {
    if (error) console.error('[ia_budget] falha ao registrar:', error.message);
  });
}
