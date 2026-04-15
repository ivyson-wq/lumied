// Feature flags — cache in-memory por instância de edge function.
// TTL 30s: balanceia rollout rápido vs. DB load.

import type { SupabaseClient } from "@supabase/supabase-js";

type FlagRow = { chave: string; ativo: boolean; escolas: string[] | null; rollout_pct: number };
let cache: { at: number; rows: FlagRow[] } | null = null;
const TTL_MS = 30_000;

async function load(sb: SupabaseClient): Promise<FlagRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const { data } = await sb.from("feature_flags").select("chave, ativo, escolas, rollout_pct");
  cache = { at: Date.now(), rows: (data as FlagRow[]) ?? [] };
  return cache.rows;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export async function isFlagOn(sb: SupabaseClient, chave: string, escolaId?: string | null): Promise<boolean> {
  const rows = await load(sb);
  const f = rows.find(r => r.chave === chave);
  if (!f) return false;
  if (!f.ativo) return false;
  if (f.escolas && f.escolas.length && escolaId && !f.escolas.includes(escolaId)) return false;
  if (f.rollout_pct >= 100) return true;
  if (!escolaId) return f.rollout_pct >= 100;
  return (hash(chave + ':' + escolaId) % 100) < f.rollout_pct;
}

export function invalidateFlagsCache() { cache = null; }
