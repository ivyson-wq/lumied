// ═══════════════════════════════════════════════════════════════
//  Shared: server-side product event emission (LAP)
//
//  Use em edge functions / webhooks / crons pra emitir eventos
//  de produto direto em product_events sem passar pela edge fn
//  track-event (que é pra cliente web/mobile).
//
//  IMPORTANTE: sempre fire-and-forget. Telemetria nunca quebra
//  fluxo do produto. Falha silenciosa com log no console.
//
//  Exemplos:
//    await trackEvent(sb, {
//      escola_id, event_name: 'financeiro.baixa.automatica',
//      module: 'financeiro', persona: 'sistema',
//      payload: { valor_cents }, idempotency_key: txId,
//    });
// ═══════════════════════════════════════════════════════════════

import { SupabaseClient } from "@supabase/supabase-js";

export type TrackEventInput = {
  escola_id: string;
  event_name: string;
  module?: string;
  persona?: string;
  user_id?: string | null;
  payload?: Record<string, unknown>;
  session_id?: string;
  source?: "edge" | "webhook" | "cron" | "test";
  idempotency_key?: string;
};

const VALID_NAME = /^[a-z_]+(\.[a-z_]+)+$/;

/**
 * Emite 1 evento. Não-bloqueante: erros vão pro console e seguem.
 * Retorna boolean indicando sucesso aparente.
 */
export async function trackEvent(
  sb: SupabaseClient,
  ev: TrackEventInput,
): Promise<boolean> {
  if (!ev.escola_id) {
    console.warn("[track] escola_id required, evento descartado:", ev.event_name);
    return false;
  }
  if (!VALID_NAME.test(ev.event_name)) {
    console.warn("[track] event_name inválido:", ev.event_name);
    return false;
  }

  try {
    const row = {
      escola_id: ev.escola_id,
      user_id: ev.user_id ?? null,
      persona: ev.persona ?? "sistema",
      module: ev.module ?? null,
      event_name: ev.event_name,
      payload: ev.payload ?? {},
      session_id: ev.session_id ?? null,
      source: ev.source ?? "edge",
      idempotency_key: ev.idempotency_key ?? null,
    };

    const { error } = await sb
      .from("product_events")
      .upsert([row], { onConflict: "escola_id,idempotency_key", ignoreDuplicates: true });

    if (error) {
      console.warn("[track] insert failed:", error.message, "event:", ev.event_name);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[track] threw:", (e as Error).message, "event:", ev.event_name);
    return false;
  }
}

/** Versão batch — mais eficiente quando há vários eventos relacionados. */
export async function trackEvents(
  sb: SupabaseClient,
  evs: TrackEventInput[],
): Promise<number> {
  const rows = evs
    .filter((ev) => ev.escola_id && VALID_NAME.test(ev.event_name))
    .map((ev) => ({
      escola_id: ev.escola_id,
      user_id: ev.user_id ?? null,
      persona: ev.persona ?? "sistema",
      module: ev.module ?? null,
      event_name: ev.event_name,
      payload: ev.payload ?? {},
      session_id: ev.session_id ?? null,
      source: ev.source ?? "edge",
      idempotency_key: ev.idempotency_key ?? null,
    }));
  if (rows.length === 0) return 0;
  try {
    const { error, count } = await sb
      .from("product_events")
      .upsert(rows, { onConflict: "escola_id,idempotency_key", ignoreDuplicates: true, count: "exact" });
    if (error) {
      console.warn("[track] batch insert failed:", error.message);
      return 0;
    }
    return count ?? rows.length;
  } catch (e) {
    console.warn("[track] batch threw:", (e as Error).message);
    return 0;
  }
}
