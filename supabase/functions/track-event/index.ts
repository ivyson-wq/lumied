// ═══════════════════════════════════════════════════════════════
//  Edge Function: track-event
//
//  Recebe eventos de produto do cliente (web/mobile) e grava em
//  product_events (mig 342). Pré-requisito do Lumied Health Score
//  (LHS) e da métrica AMPS — Pilar 4 do [[project_lumied_activation_program]].
//
//  Princípios:
//   - escola_id SEMPRE resolvido server-side via resolveEscolaId
//     (NUNCA do body, vide [[tenant-audit]] + [[edge-fn-authz]])
//   - user_id e persona inferidos da sessão (não do body)
//   - Fire-and-forget: retorna 204 No Content; cliente não bloqueia
//   - Aceita event único OU batch (events: [...]) até 50
//   - Idempotency key opcional por evento (dedup janela 60s)
//   - Falha silenciosa em telemetria: nunca quebra fluxo do usuário
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsResponse, getCorsHeaders } from "../_shared/cors.ts";
import { resolveEscolaId } from "../_shared/tenant.ts";
import { runWithCors } from "../_shared/errors.ts";
import { validate, Schema } from "../_shared/validation.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Reutiliza o cliente entre requests do mesmo isolate (perf).
const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type IncomingEvent = {
  event_name: string;
  module?: string;
  payload?: Record<string, unknown>;
  source?: string;
  session_id?: string;
  idempotency_key?: string;
};

type ResolvedSession = {
  escola_id: string;
  user_id: string | null;
  persona: string | null;
};

const VALID_PERSONAS = new Set([
  "diretor","financeiro","secretaria","manutencao","almoxarife",
  "comercial","coord_pedagogico","professora","professora_assistente",
  "nutricionista","impressao","pais","aluno","staff_lumied","sistema",
]);

const VALID_MODULES = new Set([
  "auth","onboarding","dashboard","financeiro","manutencao","almoxarifado",
  "ponto","compliance","crm","academico","comunicacao","cobranca","pickup",
  "agenda","contratos","rh","loja","ia","admin","operacional","outro",
]);

const VALID_SOURCES = new Set(["web","mobile","edge","cron","webhook","test"]);

const EVENT_SCHEMA: Schema = {
  event_name: { required: true, type: "string", maxLength: 80, pattern: /^[a-z_]+(\.[a-z_]+)+$/ },
  module: { type: "string", maxLength: 40 },
  source: { type: "string", maxLength: 16 },
  session_id: { type: "string", maxLength: 64 },
  idempotency_key: { type: "string", maxLength: 64 },
};

const MAX_PAYLOAD_BYTES = 10 * 1024;     // 10KB por evento
const MAX_BATCH = 50;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse(req);
  const cors = getCorsHeaders(req);

  return await runWithCors(req, async () => {
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405, cors);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400, cors);
    }

    // Resolve escola + sessão server-side. Nunca confiar em body pra isso.
    const escola_id = await resolveEscolaId(req, sb, null, body);
    if (!escola_id) {
      // Sem escola: descarta silencioso (telemetria não pode quebrar UX).
      // Status 204 mesmo: cliente não precisa saber que dropamos.
      return new Response(null, { status: 204, headers: cors });
    }

    const sessionInfo = await resolveSessionInfo(req, body, escola_id);

    // Normaliza pra array
    const items: IncomingEvent[] = Array.isArray(body.events)
      ? (body.events as IncomingEvent[])
      : [body as unknown as IncomingEvent];

    if (items.length === 0) return new Response(null, { status: 204, headers: cors });
    if (items.length > MAX_BATCH) {
      return json({ error: "batch_too_large", max: MAX_BATCH }, 400, cors);
    }

    const rows: Record<string, unknown>[] = [];
    const errors: { index: number; reason: string }[] = [];

    items.forEach((ev, idx) => {
      const validErrors = validate(ev as unknown as Record<string, unknown>, EVENT_SCHEMA);
      if (validErrors.length > 0) {
        errors.push({ index: idx, reason: validErrors[0].code });
        return;
      }

      const module = ev.module && VALID_MODULES.has(ev.module) ? ev.module : null;
      const source = ev.source && VALID_SOURCES.has(ev.source) ? ev.source : "web";
      const payload = ev.payload && typeof ev.payload === "object" ? ev.payload : {};

      // Tamanho do payload
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
      if (payloadBytes > MAX_PAYLOAD_BYTES) {
        errors.push({ index: idx, reason: "payload_too_large" });
        return;
      }

      rows.push({
        escola_id,
        user_id: sessionInfo.user_id,
        persona: sessionInfo.persona,
        module,
        event_name: ev.event_name,
        payload,
        session_id: ev.session_id?.slice(0, 64) ?? null,
        source,
        idempotency_key: ev.idempotency_key?.slice(0, 64) ?? null,
      });
    });

    if (rows.length === 0) {
      return json({ ok: false, errors }, 400, cors);
    }

    // INSERT em lote. onConflict=idempotency_key dedup janela (constraint unique).
    const { error } = await sb
      .from("product_events")
      .upsert(rows, { onConflict: "escola_id,idempotency_key", ignoreDuplicates: true });

    if (error) {
      // Telemetria não pode quebrar app. Log no console (vai pro Sentry edge),
      // mas devolve 204 pro cliente.
      console.warn("[track-event] insert failed:", error.message);
      return new Response(null, { status: 204, headers: cors });
    }

    return new Response(null, { status: 204, headers: cors });
  });
});

// ─── Helpers ───────────────────────────────────────────────────

async function resolveSessionInfo(
  req: Request,
  body: Record<string, unknown> | null,
  escola_id: string,
): Promise<ResolvedSession> {
  const token = extractToken(req, body);
  if (!token) return { escola_id, user_id: null, persona: "sistema" };

  // Tenta cada tabela de sessão. Persona inferida da fonte.
  // gerente_sessoes → diretor (fallback gerente)
  const { data: gs } = await sb.from("gerente_sessoes")
    .select("expira_em, gerentes(id, escola_id, papeis)")
    .eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const g = gs as any;
  if (g && new Date(g.expira_em) >= new Date() && g.gerentes?.escola_id === escola_id) {
    return {
      escola_id,
      user_id: g.gerentes.id ?? null,
      persona: inferPersonaFromPapeis(g.gerentes.papeis) ?? "diretor",
    };
  }

  // professora_sessoes
  const { data: ps } = await sb.from("professora_sessoes")
    .select("expira_em, professoras(id, escola_id)")
    .eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const p = ps as any;
  if (p && new Date(p.expira_em) >= new Date() && p.professoras?.escola_id === escola_id) {
    return { escola_id, user_id: p.professoras.id ?? null, persona: "professora" };
  }

  // secretaria_sessoes — pode ser secretaria, financeiro, manutencao, etc.
  const { data: ss } = await sb.from("secretaria_sessoes")
    .select("expira_em, secretarias(id, escola_id, papeis)")
    .eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const s = ss as any;
  if (s && new Date(s.expira_em) >= new Date() && s.secretarias?.escola_id === escola_id) {
    return {
      escola_id,
      user_id: s.secretarias.id ?? null,
      persona: inferPersonaFromPapeis(s.secretarias.papeis) ?? "secretaria",
    };
  }

  // sessoes (unificada)
  const { data: us } = await sb.from("sessoes")
    .select("expira_em, usuarios(id, escola_id, papeis)")
    .eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const u = us as any;
  if (u && new Date(u.expira_em) >= new Date() && u.usuarios?.escola_id === escola_id) {
    return {
      escola_id,
      user_id: u.usuarios.id ?? null,
      persona: inferPersonaFromPapeis(u.usuarios.papeis) ?? "sistema",
    };
  }

  return { escola_id, user_id: null, persona: "sistema" };
}

function inferPersonaFromPapeis(papeis: unknown): string | null {
  if (!Array.isArray(papeis)) return null;
  const set = new Set(papeis.map(String));
  // Ordem de precedência (mais específico primeiro)
  if (set.has("diretor")) return "diretor";
  if (set.has("financeiro")) return "financeiro";
  if (set.has("comercial")) return "comercial";
  if (set.has("nutricionista")) return "nutricionista";
  if (set.has("almoxarifado")) return "almoxarife";
  if (set.has("manutencao")) return "manutencao";
  if (set.has("impressao")) return "impressao";
  if (set.has("coord_pedagogico")) return "coord_pedagogico";
  if (set.has("professora_assistente")) return "professora_assistente";
  if (set.has("professora")) return "professora";
  if (set.has("secretaria")) return "secretaria";
  if (set.has("gerente")) return "diretor";
  return null;
}

function extractToken(req: Request, body?: Record<string, unknown> | null): string | null {
  if (body) {
    const t = (body._token as string) || (body._prof_token as string) || (body._staff_token as string) || (body._aluno_token as string);
    if (t && typeof t === "string" && t.length > 0 && t.length < 200) return t;
  }
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1] && m[1].length < 200 && !m[1].startsWith("eyJ")) return m[1];
  return null;
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
