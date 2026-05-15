// ═══════════════════════════════════════════════════════════════
//  Edge Function: api (v2 — Onda 3 do refator)
//  6255 → ~140 linhas. Dispatch procedural preservado verbatim
//  em 4 handlers de domínio (handlers/{public,gerente-A,B,C}.ts).
//  Comportamento idêntico ao monolito original — cada handler returns
//  Response se matchou uma action, null pra fall-through pro próximo.
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getCorsHeaders,
  checkRateLimit, getClientIP,
  sanitizeBody,
} from "../_shared/mod.ts";

import { type BaseCtx, type GerenteCtx, validarSessao } from "./_lib.ts";
import { handle as handlePublic } from "./handlers/public.ts";
import { handle as handleGerenteA } from "./handlers/gerente-A.ts";
import { handle as handleGerenteB } from "./handlers/gerente-B.ts";
import { handle as handleGerenteC } from "./handlers/gerente-C.ts";
import { handle as handleCrmV2 } from "./handlers/crm-v2.ts";

serve(async (req: Request) => {
  const CORS = getCorsHeaders(req);
  const startTime = Date.now();
  let currentAction = "unknown";
  const timingHeader = () => {
    const ms = Date.now() - startTime;
    if (ms > 1000) console.warn(`[slow] ${currentAction} ${ms}ms`);
    return { "X-Response-Time": String(ms) };
  };
  const ok = (data: unknown, extraHeaders: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), {
      headers: { ...CORS, "Content-Type": "application/json", ...timingHeader(), ...extraHeaders },
    });
  const err = (msg: string, s = 400, code?: string) =>
    new Response(JSON.stringify({ error: msg, ...(code ? { code } : {}) }), {
      status: s,
      headers: { ...CORS, "Content-Type": "application/json", ...timingHeader() },
    });
  const PUBLIC_CACHE = { "Cache-Control": "public, max-age=60, s-maxage=60" };

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Parse body once
  const bodyText = await req.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(bodyText); } catch { return err("Body inválido"); }

  // Rate limiting
  const reqAction = (body.action as string) || "";
  const ip = getClientIP(req);
  const rl = checkRateLimit(ip, reqAction.startsWith("login") ? "login" : "api");
  if (!rl.allowed) return err(`Tente novamente em ${rl.retryAfterSeconds}s.`, 429);

  // Sanitize body
  body = sanitizeBody(body) as Record<string, unknown>;

  const { action } = body;
  currentAction = String(action || "unknown");

  // ══ Dispatch público ════════════════════════════════════════
  const baseCtx: BaseCtx = {
    req, admin, body: body as Record<string, unknown>,
    action: action as string, ip, cors: CORS,
    ok, err, PUBLIC_CACHE,
  };
  const pubRes = await handlePublic(baseCtx);
  if (pubRes) return pubRes;

  // ══ Auth gate (gerente OR sessão unificada com papel autorizado) ══
  const authHeader = req.headers.get("authorization")?.replace("Bearer ", "") ?? null;
  const token = (body._token as string) || authHeader;
  const gerente = await validarSessao(admin, token);
  if (!gerente) return err("Sessão inválida ou expirada. Faça login novamente.", 401);
  // TENANT ISOLATION GUARD — defesa em profundidade contra leaks.
  // deno-lint-ignore no-explicit-any
  if (!(gerente as any).escola_id) return err("Sessão sem escola associada. Contate o suporte.", 403);
  // deno-lint-ignore no-explicit-any
  const sessionEscolaId = (gerente as any).escola_id as string;

  // ── Role check for sensitive financial actions ────────────────
  const sensitiveActions = ["staff_alterar_resp_financeiro", "financeiro_decisao_aprovar", "financeiro_decisao_rejeitar", "indicacao_b2b_config_salvar"];
  if (sensitiveActions.includes(action as string)) {
    const { data: usr } = await admin.from("usuarios").select("papeis").eq("email", gerente.email).maybeSingle();
    const roles = usr?.papeis || [];
    if (!roles.includes("gerente") && !roles.includes("diretor")) {
      return err("Apenas gerentes e diretores podem realizar esta ação.", 403);
    }
  }

  // ══ Dispatch gerente (em 3 chunks A/B/C) ════════════════════
  const gerCtx: GerenteCtx = { ...baseCtx, gerente, sessionEscolaId, token };
  const a = await handleGerenteA(gerCtx);
  if (a) return a;
  const b = await handleGerenteB(gerCtx);
  if (b) return b;
  const c = await handleGerenteC(gerCtx);
  if (c) return c;
  const crmV2 = await handleCrmV2(gerCtx);
  if (crmV2) return crmV2;

  return err("Ação desconhecida.");
});
