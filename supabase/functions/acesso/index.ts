// ═══════════════════════════════════════════════════════════════
//  Edge Function: acesso (v2 — Router Pattern)
//  Controle de acesso: Face Control ID (iDFace) + RFID
//  Reconhecimento facial, presença automática, alertas
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, authProfessora, successResponse, AppError, resolveEscolaId } from "../_shared/mod.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const router = new Router("acesso");
router.useGlobal(rateLimit());

// ═══════════════════════════════════════════════════════════════
//  Auth: Gerente OR Secretaria (unified sessions)
// ═══════════════════════════════════════════════════════════════
const authGerenteOrSecretaria: import("../_shared/router.ts").Middleware = async (ctx, next) => {
  const token = (ctx.body._token as string) || null;
  if (!token) throw new AppError("AUTH_REQUIRED", "Token de sessão obrigatório.");

  // Try 1: gerente_sessoes → gerentes
  const { data: gs } = await ctx.sb
    .from("gerente_sessoes")
    .select("*, gerentes(id, nome, email, escola_id)")
    .eq("token", token)
    .single();

  if (gs && new Date(gs.expira_em) >= new Date()) {
    const user = (gs as Any).gerentes;
    ctx.user = { ...user, tipo: "gerente" };
    if (user?.escola_id) ctx.escola_id = user.escola_id as string;
    return next();
  }

  // Try 2: sessoes → usuarios
  const { data: su } = await ctx.sb
    .from("sessoes")
    .select("*, usuarios(id, nome, email, papeis, escola_id)")
    .eq("token", token)
    .single();

  if (su && new Date(su.expira_em) >= new Date()) {
    const usuario = (su as Any).usuarios;
    const allowed = ["gerente", "diretor", "secretaria", "comercial", "financeiro"];
    const papeis: string[] = usuario?.papeis || [];
    if (papeis.some((p: string) => allowed.includes(p))) {
      ctx.user = { ...usuario, tipo: papeis[0] };
      if (usuario?.escola_id) ctx.escola_id = usuario.escola_id as string;
      return next();
    }
  }

  throw new AppError("AUTH_INVALID", "Sessão inválida ou sem permissão.");
};

// ═══════════════════════════════════════════════════════════════
//  Auth: Pais (Supabase Auth JWT from Authorization: Bearer header)
//  Returns the authenticated user's email (lowercased).
//  Throws AUTH_REQUIRED (401) if token is missing/invalid.
// ═══════════════════════════════════════════════════════════════
async function getAuthenticatedPaiEmail(ctx: { req: Request; sb: Any }): Promise<string> {
  const authHeader = ctx.req.headers.get("authorization") || ctx.req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new AppError("AUTH_REQUIRED", "Token de autenticação obrigatório (Authorization: Bearer).");
  }
  const token = match[1].trim();
  if (!token) {
    throw new AppError("AUTH_REQUIRED", "Token de autenticação obrigatório.");
  }

  // Validate JWT via Supabase Auth
  const { data, error } = await ctx.sb.auth.getUser(token);
  if (error || !data?.user?.email) {
    throw new AppError("AUTH_REQUIRED", "Token inválido ou expirado.");
  }
  return String(data.user.email).toLowerCase();
}

/** Verify the authenticated user owns the familia (by email). Returns the familia row. */
async function assertFamiliaOwnership(ctx: { req: Request; sb: Any }, email: string): Promise<Any> {
  const authedEmail = await getAuthenticatedPaiEmail(ctx);
  if (authedEmail !== String(email || "").toLowerCase()) {
    throw new AppError("FORBIDDEN", "Você não tem permissão para acessar dados desta família.");
  }
  const { data: familia } = await ctx.sb.from("familias").select("id, nome_responsavel, email").eq("email", authedEmail).maybeSingle();
  return familia;
}

// ═══════════════════════════════════════════════════════════════
//  Helper: HTTP call to Control iD device with timeout
// ═══════════════════════════════════════════════════════════════
async function deviceFetch(
  ip: string,
  porta: number,
  path: string,
  options: RequestInit = {},
  timeoutMs = 5000
): Promise<Response> {
  const url = `https://${ip}:${porta}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Helper: get session from device (login or cached)
async function getDeviceSession(sb: Any, device: Any): Promise<string> {
  // If we have a cached session, try to use it (heartbeat test)
  if (device.api_session) {
    try {
      const res = await deviceFetch(device.ip, device.porta, `/system_information.fcgi?session=${device.api_session}`);
      if (res.ok) return device.api_session;
    } catch { /* session expired, re-login */ }
  }
  // Login to device — credenciais vêm do próprio registro do dispositivo ou de env var por segurança
  const deviceLogin = device.api_login || Deno.env.get("CONTROLID_DEFAULT_LOGIN") || "admin";
  const devicePassword = device.api_password || Deno.env.get("CONTROLID_DEFAULT_PASSWORD");
  if (!devicePassword) {
    throw new AppError("BAD_REQUEST", `Senha do dispositivo ${device.nome} não configurada. Defina acesso_dispositivos.api_password ou env CONTROLID_DEFAULT_PASSWORD.`);
  }
  const res = await deviceFetch(device.ip, device.porta, "/login.fcgi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: deviceLogin, password: devicePassword }),
  });
  if (!res.ok) throw new AppError("BAD_REQUEST", `Falha ao autenticar no dispositivo ${device.nome}: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.session) throw new AppError("BAD_REQUEST", `Dispositivo ${device.nome} não retornou session token.`);
  // Save session
  await sb.from("acesso_dispositivos").update({ api_session: data.session, ultimo_heartbeat: new Date().toISOString() }).eq("id", device.id).eq("escola_id", device.escola_id);
  return data.session;
}

// Helper: generate a numeric device_user_id from UUID
function uuidToDeviceId(uuid: string): number {
  // Use first 8 hex chars of UUID as a number (fits in 32 bits)
  return parseInt(uuid.replace(/-/g, "").substring(0, 8), 16);
}

// Helper: get config value
async function getConfig(sb: Any, chave: string): Promise<string | null> {
  const { data } = await sb.from("acesso_config").select("valor").eq("chave", chave).single();
  return data?.valor ?? null;
}

// ═══════════════════════════════════════════════════════════════
//  Lumied Bridge — dispatch via Cloudflare gateway (Fase 3)
//  Quando dispositivo.via_bridge = true, comandos passam pelo
//  daemon "Lumied Bridge" rodando na LAN da escola (sem IP público).
// ═══════════════════════════════════════════════════════════════

interface BridgeResult {
  ok: boolean;
  status: number;
  error?: string;
  body?: Any;
  comando_id?: string;
}

async function bridgeDispatch(
  sb: Any,
  device: Any,
  tipo: "http_proxy" | "enroll_user" | "enroll_face" | "delete_user" | "enroll_card" | "ping" | "sync_all",
  payload: Any,
  waitMs = 8000,
): Promise<BridgeResult> {
  const gatewayUrl = Deno.env.get("BRIDGE_GATEWAY_URL");
  const gatewaySecret = Deno.env.get("BRIDGE_GATEWAY_SECRET");
  if (!gatewayUrl || !gatewaySecret) {
    return { ok: false, status: 500, error: "Bridge gateway não configurado (BRIDGE_GATEWAY_URL/SECRET)." };
  }

  // Embute device address no payload para o daemon saber a qual iDFace falar
  const fullPayload = {
    device: { id: device.id, ip: device.ip, porta: device.porta || 443 },
    ...payload,
  };

  const { data: cmd, error: insErr } = await sb.from("acesso_bridge_comandos").insert({
    escola_id: device.escola_id,
    dispositivo_id: device.id,
    tipo,
    payload: fullPayload,
  }).select("id").single();
  if (insErr || !cmd) {
    return { ok: false, status: 500, error: `Erro enfileirando comando: ${insErr?.message || "desconhecido"}` };
  }

  let res: Response;
  try {
    res = await fetch(`${gatewayUrl}/dispatch/${device.escola_id}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${gatewaySecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ req_id: cmd.id, wait_ms: waitMs, tipo, payload: fullPayload }),
      signal: AbortSignal.timeout(waitMs + 5000),
    });
  } catch (e) {
    await sb.from("acesso_bridge_comandos").update({
      status: "erro",
      resultado: { error: `Gateway unreachable: ${String(e)}` },
      concluido_em: new Date().toISOString(),
    }).eq("id", cmd.id);
    return { ok: false, status: 502, error: `Gateway unreachable: ${String(e)}`, comando_id: cmd.id };
  }

  let data: Any = null;
  try { data = await res.json(); } catch { /* ignore */ }

  if (res.status === 503) {
    await sb.from("acesso_bridge_comandos").update({
      status: "erro",
      resultado: { error: "Bridge offline" },
      concluido_em: new Date().toISOString(),
    }).eq("id", cmd.id);
    return { ok: false, status: 503, error: "Bridge offline", comando_id: cmd.id };
  }

  if (data?.timeout) {
    return { ok: false, status: 504, error: "Timeout aguardando bridge", comando_id: cmd.id };
  }

  return {
    ok: !!data?.ok,
    status: data?.ok ? 200 : 502,
    error: data?.error,
    body: data?.payload ?? data,
    comando_id: cmd.id,
  };
}

async function bridgeStatus(escolaId: string): Promise<{ connected: boolean; last_heartbeat: number | null; pending: number; error?: string }> {
  const gatewayUrl = Deno.env.get("BRIDGE_GATEWAY_URL");
  const gatewaySecret = Deno.env.get("BRIDGE_GATEWAY_SECRET");
  if (!gatewayUrl || !gatewaySecret) return { connected: false, last_heartbeat: null, pending: 0, error: "gateway não configurado" };
  try {
    const res = await fetch(`${gatewayUrl}/status/${escolaId}`, {
      headers: { "Authorization": `Bearer ${gatewaySecret}` },
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return {
      connected: !!data.connected,
      last_heartbeat: data.last_heartbeat ?? null,
      pending: data.pending ?? 0,
    };
  } catch (e) {
    return { connected: false, last_heartbeat: null, pending: 0, error: String(e) };
  }
}

// ── Operações de dispositivo (transparente: bridge ou direto) ──
function uint8ToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

interface DeviceOpResult { ok: boolean; status: number; error?: string }

async function deviceEnrollUser(sb: Any, device: Any, user: { id: number; name: string; registration: string }): Promise<DeviceOpResult> {
  if (device.via_bridge) {
    const r = await bridgeDispatch(sb, device, "enroll_user", { user });
    return { ok: r.ok, status: r.status, error: r.error };
  }
  const session = await getDeviceSession(sb, device);
  const res = await deviceFetch(device.ip, device.porta, `/create_objects.fcgi?session=${session}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ object: "users", values: [user] }),
  });
  return { ok: res.ok, status: res.status };
}

async function deviceEnrollUsers(sb: Any, device: Any, users: Array<{ id: number; name: string; registration: string }>): Promise<DeviceOpResult> {
  if (device.via_bridge) {
    const r = await bridgeDispatch(sb, device, "enroll_user", { users });
    return { ok: r.ok, status: r.status, error: r.error };
  }
  const session = await getDeviceSession(sb, device);
  const res = await deviceFetch(device.ip, device.porta, `/create_objects.fcgi?session=${session}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ object: "users", values: users }),
  });
  return { ok: res.ok, status: res.status };
}

async function deviceSetFaceImage(sb: Any, device: Any, deviceUserId: number, photoBytes: Uint8Array): Promise<DeviceOpResult> {
  if (device.via_bridge) {
    const r = await bridgeDispatch(sb, device, "enroll_face", { user_id: deviceUserId, photo_b64: uint8ToBase64(photoBytes) }, 15000);
    return { ok: r.ok, status: r.status, error: r.error };
  }
  const session = await getDeviceSession(sb, device);
  const ts = Math.floor(Date.now() / 1000);
  const res = await deviceFetch(device.ip, device.porta, `/user_set_image.fcgi?session=${session}&user_id=${deviceUserId}&timestamp=${ts}`, {
    method: "POST", body: photoBytes,
  });
  return { ok: res.ok, status: res.status };
}

async function deviceEnrollCard(sb: Any, device: Any, card_value: number, deviceUserId: number): Promise<DeviceOpResult> {
  if (device.via_bridge) {
    const r = await bridgeDispatch(sb, device, "enroll_card", { card_value, user_id: deviceUserId });
    return { ok: r.ok, status: r.status, error: r.error };
  }
  const session = await getDeviceSession(sb, device);
  const res = await deviceFetch(device.ip, device.porta, `/create_objects.fcgi?session=${session}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ object: "cards", values: [{ value: card_value, user_id: deviceUserId }] }),
  });
  return { ok: res.ok, status: res.status };
}

async function devicePing(sb: Any, device: Any): Promise<DeviceOpResult> {
  if (device.via_bridge) {
    const r = await bridgeDispatch(sb, device, "ping", {}, 5000);
    return { ok: r.ok, status: r.status, error: r.error };
  }
  try {
    const res = await deviceFetch(device.ip, device.porta, "/login.fcgi");
    return { ok: res.status < 500, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

async function deviceUnregisterUser(sb: Any, device: Any, deviceUserId: number): Promise<DeviceOpResult> {
  if (device.via_bridge) {
    const r = await bridgeDispatch(sb, device, "delete_user", { user_id: deviceUserId });
    return { ok: r.ok, status: r.status, error: r.error };
  }
  try {
    const session = await getDeviceSession(sb, device);
    const res = await deviceFetch(device.ip, device.porta, `/destroy_objects.fcgi?session=${session}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object: "users", where: { users: { id: deviceUserId } } }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

// ═══════════════════════════════════════════════════════════════
//  DEVICE MANAGEMENT (authGerente)
// ═══════════════════════════════════════════════════════════════

router.on("acesso_dispositivos_list", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb
    .from("acesso_dispositivos")
    .select("*")
    .eq("escola_id", ctx.escola_id)
    .eq("ativo", true)
    .order("criado_em", { ascending: false });
  return successResponse(data ?? []);
});

router.on("acesso_dispositivo_save", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id, nome, ip, porta, tipo, localizacao, modelo, via_bridge, api_login, api_password } = ctx.body as Any;
  if (!nome || !ip || !tipo) throw new AppError("VALIDATION_FAILED", "nome, ip e tipo são obrigatórios.");

  const row: Any = {
    nome, ip,
    porta: porta || 443,
    tipo,
    localizacao: localizacao || null,
    modelo: modelo || "iDFace",
  };
  if (typeof via_bridge === "boolean") row.via_bridge = via_bridge;
  if (api_login) row.api_login = api_login;
  if (api_password) row.api_password = api_password; // só persiste se veio (não apaga existente)

  if (id) {
    const { data, error } = await ctx.sb.from("acesso_dispositivos").update(row).eq("id", id).eq("escola_id", ctx.escola_id).select().single();
    if (error) throw new AppError("BAD_REQUEST", error.message);
    return successResponse(data);
  }
  const { data, error } = await ctx.sb.from("acesso_dispositivos").insert({ ...row, escola_id: ctx.escola_id }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("acesso_dispositivo_delete", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id } = ctx.body as Any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  await ctx.sb.from("acesso_dispositivos").update({ ativo: false }).eq("id", id).eq("escola_id", ctx.escola_id);
  return successResponse({ ok: true });
});

router.on("acesso_dispositivo_ping", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id } = ctx.body as Any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");

  const { data: device } = await ctx.sb.from("acesso_dispositivos").select("*").eq("id", id).eq("escola_id", ctx.escola_id).single();
  if (!device) throw new AppError("NOT_FOUND", "Dispositivo não encontrado.");

  const r = await devicePing(ctx.sb, device);
  return successResponse({
    online: r.ok,
    status: r.status,
    error: r.error,
    ip: device.ip,
    porta: device.porta,
    via_bridge: !!device.via_bridge,
  });
});

router.on("acesso_dispositivo_sync", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id } = ctx.body as Any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");

  const { data: device } = await ctx.sb.from("acesso_dispositivos").select("*").eq("id", id).eq("escola_id", ctx.escola_id).single();
  if (!device) throw new AppError("NOT_FOUND", "Dispositivo não encontrado.");

  if (device.via_bridge) {
    const r = await devicePing(ctx.sb, device);
    return successResponse({ ok: r.ok, error: r.error, device_nome: device.nome, via_bridge: true });
  }

  try {
    const session = await getDeviceSession(ctx.sb, device);
    return successResponse({ ok: true, session, device_nome: device.nome });
  } catch (err) {
    return successResponse({ ok: false, error: err instanceof AppError ? err.message : String(err) });
  }
});

// ═══════════════════════════════════════════════════════════════
//  FACE ENROLLMENT (authGerente)
// ═══════════════════════════════════════════════════════════════

router.on("acesso_face_cadastrar", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { pessoa_tipo, pessoa_id, pessoa_nome, foto } = ctx.body as Any;
  if (!pessoa_tipo || !pessoa_id || !pessoa_nome) {
    throw new AppError("VALIDATION_FAILED", "pessoa_tipo, pessoa_id e pessoa_nome são obrigatórios.");
  }

  const deviceUserId = uuidToDeviceId(pessoa_id);

  // Store photo in Supabase Storage if provided
  let fotoUrl: string | null = null;
  let fotoBinary: Uint8Array | null = null;
  if (foto) {
    try {
      // foto is base64
      const raw = atob(foto.replace(/^data:image\/\w+;base64,/, ""));
      fotoBinary = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) fotoBinary[i] = raw.charCodeAt(i);

      const path = `acesso/faces/${pessoa_id}_${Date.now()}.jpg`;
      const { error: upErr } = await ctx.sb.storage.from("wa-documentos").upload(path, fotoBinary, {
        contentType: "image/jpeg", upsert: true,
      });
      if (!upErr) {
        // Bucket privado (mig 279): signed URL com TTL 7d, regenerada nos handlers de listagem
        const { data: signed } = await ctx.sb.storage.from("wa-documentos").createSignedUrl(path, 60 * 60 * 24 * 7);
        fotoUrl = signed?.signedUrl || null;
      }
    } catch (e) {
      console.error("Erro ao processar foto:", e);
    }
  }

  // Create/update acesso_faces record
  const { data: existing } = await ctx.sb
    .from("acesso_faces")
    .select("id")
    .eq("escola_id", ctx.escola_id)
    .eq("pessoa_tipo", pessoa_tipo)
    .eq("pessoa_id", pessoa_id)
    .eq("ativo", true)
    .maybeSingle();

  let faceRecord;
  if (existing) {
    const { data, error } = await ctx.sb.from("acesso_faces").update({
      pessoa_nome, foto_url: fotoUrl, device_user_id: deviceUserId,
      sync_status: "pendente", sync_erro: null, atualizado_em: new Date().toISOString(),
    }).eq("id", existing.id).eq("escola_id", ctx.escola_id).select().single();
    if (error) throw new AppError("BAD_REQUEST", error.message);
    faceRecord = data;
  } else {
    const { data, error } = await ctx.sb.from("acesso_faces").insert({
      escola_id: ctx.escola_id, pessoa_tipo, pessoa_id, pessoa_nome, foto_url: fotoUrl,
      device_user_id: deviceUserId, sync_status: "pendente",
    }).select().single();
    if (error) throw new AppError("BAD_REQUEST", error.message);
    faceRecord = data;
  }

  // Sync to all active devices
  const { data: devices } = await ctx.sb.from("acesso_dispositivos").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true);
  const syncResults: Any[] = [];

  for (const dev of devices ?? []) {
    try {
      const userRes = await deviceEnrollUser(ctx.sb, dev, { id: deviceUserId, name: pessoa_nome, registration: pessoa_id });
      if (!userRes.ok) {
        syncResults.push({ device: dev.nome, ok: false, error: userRes.error || `enroll_user HTTP ${userRes.status}` });
        continue;
      }

      if (fotoBinary) {
        const imgRes = await deviceSetFaceImage(ctx.sb, dev, deviceUserId, fotoBinary);
        syncResults.push({ device: dev.nome, ok: imgRes.ok, status: imgRes.status, error: imgRes.error });
      } else {
        syncResults.push({ device: dev.nome, ok: true, note: "Sem foto para enviar" });
      }
    } catch (err) {
      syncResults.push({ device: dev.nome, ok: false, error: String(err) });
    }
  }

  // Update sync status
  const allOk = syncResults.length > 0 && syncResults.every((r) => r.ok);
  const anyErr = syncResults.some((r) => !r.ok);
  await ctx.sb.from("acesso_faces").update({
    sync_status: allOk ? "sincronizado" : anyErr ? "erro" : "pendente",
    sync_erro: anyErr ? syncResults.filter((r) => !r.ok).map((r) => `${r.device}: ${r.error}`).join("; ") : null,
    atualizado_em: new Date().toISOString(),
  }).eq("id", faceRecord.id).eq("escola_id", ctx.escola_id);

  return successResponse({ face: faceRecord, sync: syncResults });
});

// Search for a person (aluno/professora/funcionario) by name — used for face/RFID registration
router.on("acesso_buscar_pessoa", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { tipo, busca } = ctx.body as Any;
  if (!busca || String(busca).length < 2) return successResponse([]);
  const term = `%${String(busca).trim()}%`;
  let data: Any[] = [];
  if (tipo === 'aluno' || !tipo) {
    const { data: alunos } = await ctx.sb.from("familias").select("id, nome_aluno, email").eq("escola_id", ctx.escola_id).ilike("nome_aluno", term).limit(10);
    data = data.concat((alunos ?? []).map((a: Any) => ({ id: a.id, nome: a.nome_aluno, email: a.email, tipo: 'aluno' })));
  }
  if (tipo === 'professora' || !tipo) {
    const { data: profs } = await ctx.sb.from("professoras").select("id, nome, email").eq("escola_id", ctx.escola_id).ilike("nome", term).limit(10);
    data = data.concat((profs ?? []).map((p: Any) => ({ ...p, tipo: 'professora' })));
  }
  if (tipo === 'funcionario' || !tipo) {
    const { data: funcs } = await ctx.sb.from("usuarios").select("id, nome, email").eq("escola_id", ctx.escola_id).ilike("nome", term).limit(10);
    data = data.concat((funcs ?? []).map((f: Any) => ({ ...f, tipo: 'funcionario' })));
  }
  return successResponse(data);
});

router.on("acesso_faces_list", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { pessoa_tipo } = ctx.body as Any;
  let q = ctx.sb.from("acesso_faces").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true).order("criado_em", { ascending: false });
  if (pessoa_tipo) q = q.eq("pessoa_tipo", pessoa_tipo);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("acesso_face_delete", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id } = ctx.body as Any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  await ctx.sb.from("acesso_faces").update({ ativo: false, atualizado_em: new Date().toISOString() }).eq("id", id).eq("escola_id", ctx.escola_id);
  return successResponse({ ok: true });
});

router.on("acesso_face_sync_all", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data: faces } = await ctx.sb.from("acesso_faces").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true);
  const { data: devices } = await ctx.sb.from("acesso_dispositivos").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true);

  if (!faces?.length) return successResponse({ synced: 0, message: "Nenhuma face cadastrada." });
  if (!devices?.length) return successResponse({ synced: 0, message: "Nenhum dispositivo ativo." });

  const results: Any[] = [];

  for (const dev of devices) {
    try {
      const users = faces.map((f: Any) => ({ id: f.device_user_id, name: f.pessoa_nome, registration: f.pessoa_id }));
      const usersRes = await deviceEnrollUsers(ctx.sb, dev, users);
      if (!usersRes.ok) {
        results.push({ device: dev.nome, ok: false, error: usersRes.error || `enroll_user HTTP ${usersRes.status}` });
        continue;
      }

      for (const face of faces) {
        if (!face.foto_url) continue;
        try {
          const photoRes = await fetch(face.foto_url, { signal: AbortSignal.timeout(5000) });
          if (!photoRes.ok) continue;
          const photoBytes = new Uint8Array(await photoRes.arrayBuffer());

          const r = await deviceSetFaceImage(ctx.sb, dev, face.device_user_id, photoBytes);
          if (r.ok) {
            await ctx.sb.from("acesso_faces").update({
              sync_status: "sincronizado", sync_erro: null, atualizado_em: new Date().toISOString(),
            }).eq("id", face.id).eq("escola_id", ctx.escola_id);
          } else {
            await ctx.sb.from("acesso_faces").update({
              sync_status: "erro", sync_erro: `${dev.nome}: ${r.error || `HTTP ${r.status}`}`, atualizado_em: new Date().toISOString(),
            }).eq("id", face.id).eq("escola_id", ctx.escola_id);
          }
        } catch (err) {
          await ctx.sb.from("acesso_faces").update({
            sync_status: "erro", sync_erro: `${dev.nome}: ${String(err)}`, atualizado_em: new Date().toISOString(),
          }).eq("id", face.id).eq("escola_id", ctx.escola_id);
        }
      }

      results.push({ device: dev.nome, ok: true });
    } catch (err) {
      results.push({ device: dev.nome, ok: false, error: String(err) });
    }
  }

  return successResponse({ synced: faces.length, devices: results });
});

// ═══════════════════════════════════════════════════════════════
//  RFID CARD MANAGEMENT (authGerente)
// ═══════════════════════════════════════════════════════════════

router.on("acesso_rfid_cadastrar", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { card_uid, pessoa_tipo, pessoa_id, pessoa_nome } = ctx.body as Any;
  if (!card_uid || !pessoa_tipo || !pessoa_id || !pessoa_nome) {
    throw new AppError("VALIDATION_FAILED", "card_uid, pessoa_tipo, pessoa_id e pessoa_nome são obrigatórios.");
  }

  const { data, error } = await ctx.sb.from("acesso_rfid").insert({
    escola_id: ctx.escola_id, card_uid, pessoa_tipo, pessoa_id, pessoa_nome,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.code === "23505" ? "Cartão já cadastrado." : error.message);

  // Sync card to all active devices
  const { data: devices } = await ctx.sb.from("acesso_dispositivos").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true);
  const deviceUserId = uuidToDeviceId(pessoa_id);
  for (const dev of devices ?? []) {
    try {
      const r = await deviceEnrollCard(ctx.sb, dev, Number(card_uid), deviceUserId);
      if (!r.ok) console.error(`Erro sync RFID → ${dev.nome}: ${r.error || `HTTP ${r.status}`}`);
    } catch (err) {
      console.error(`Erro sync RFID → ${dev.nome}:`, err);
    }
  }

  return successResponse(data);
});

router.on("acesso_rfid_list", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb.from("acesso_rfid").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true).order("criado_em", { ascending: false });
  return successResponse(data ?? []);
});

router.on("acesso_rfid_delete", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id } = ctx.body as Any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  await ctx.sb.from("acesso_rfid").update({ ativo: false }).eq("id", id).eq("escola_id", ctx.escola_id);
  return successResponse({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  PICKUP PERMISSIONS (authGerente)
// ═══════════════════════════════════════════════════════════════

router.on("acesso_permissoes_list", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { aluno_id, busca } = ctx.body as Any;

  // Modo 1: filtro por aluno_id específico → retorna lista flat (compat antiga)
  if (aluno_id) {
    const { data } = await ctx.sb
      .from("acesso_permissoes_retirada")
      .select("*")
      .eq("escola_id", ctx.escola_id)
      .eq("aluno_id", aluno_id)
      .eq("autorizado", true)
      .order("criado_em", { ascending: false });
    return successResponse(data ?? []);
  }

  // Modo 2: lista alunos com seus autorizados aninhados (UI gerente)
  let alq = ctx.sb.from("alunos")
    .select("id, nome, serie")
    .eq("escola_id", ctx.escola_id)
    .eq("ativo", true)
    .order("nome")
    .limit(busca ? 100 : 50);
  if (busca && String(busca).trim().length >= 2) {
    alq = alq.ilike("nome", `%${String(busca).trim()}%`);
  }
  const { data: alunos } = await alq;
  if (!alunos?.length) return successResponse([]);

  const alunoIds = alunos.map((a: Any) => a.id);
  const { data: perms } = await ctx.sb
    .from("acesso_permissoes_retirada")
    .select("*")
    .eq("escola_id", ctx.escola_id)
    .in("aluno_id", alunoIds)
    .order("criado_em", { ascending: false });

  const byAluno = new Map<string, Any[]>();
  for (const p of perms ?? []) {
    const list = byAluno.get(p.aluno_id) || [];
    list.push({
      id: p.id,
      nome: p.responsavel_nome,
      parentesco: p.parentesco,
      validade: p.validade,
      ativo: p.autorizado,
      foto_url: p.responsavel_foto_url,
    });
    byAluno.set(p.aluno_id, list);
  }

  return successResponse(alunos.map((a: Any) => ({
    id: a.id, nome: a.nome, serie: a.serie,
    autorizados: byAluno.get(a.id) || [],
  })));
});

router.on("acesso_permissao_save", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id, aluno_id, aluno_nome, responsavel_id, responsavel_nome, responsavel_email, responsavel_foto_url, parentesco, validade } = ctx.body as Any;
  if (!aluno_id || !aluno_nome || !responsavel_nome) {
    throw new AppError("VALIDATION_FAILED", "aluno_id, aluno_nome e responsavel_nome são obrigatórios.");
  }

  const row = {
    aluno_id, aluno_nome, responsavel_id: responsavel_id || null,
    responsavel_nome, responsavel_email: responsavel_email || null,
    responsavel_foto_url: responsavel_foto_url || null,
    parentesco: parentesco || null,
    autorizado: true,
    autorizado_por: ctx.user?.nome || "Gerente",
    validade: validade || null,
  };

  if (id) {
    const { data, error } = await ctx.sb.from("acesso_permissoes_retirada").update(row).eq("id", id).eq("escola_id", ctx.escola_id).select().single();
    if (error) throw new AppError("BAD_REQUEST", error.message);
    return successResponse(data);
  }
  const { data, error } = await ctx.sb.from("acesso_permissoes_retirada").insert({ ...row, escola_id: ctx.escola_id }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("acesso_permissao_delete", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id } = ctx.body as Any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  await ctx.sb.from("acesso_permissoes_retirada").update({ autorizado: false }).eq("id", id).eq("escola_id", ctx.escola_id);
  return successResponse({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  DEVICE CALLBACK (Sem session token — autenticado por:
//  (a) IP origem registrado em acesso_dispositivos (modo direto), ou
//  (b) Bearer = BRIDGE_GATEWAY_SECRET + escola_id no body (via gateway))
// ═══════════════════════════════════════════════════════════════

router.on("acesso_evento_callback", async (ctx) => {
  const { user_id, device_id, timestamp, method, card_value, direction, confidence, photo, escola_id: bodyEscolaId } = ctx.body as Any;

  // Bridge-authenticated path: gateway forwarded a `type:event` from a daemon
  const authHeader = ctx.req.headers.get("authorization") || ctx.req.headers.get("Authorization") || "";
  const bridgeSecret = Deno.env.get("BRIDGE_GATEWAY_SECRET");
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const fromBridge = !!(bridgeSecret && bearerMatch && bearerMatch[1].trim() === bridgeSecret);

  let dispositivo: Any = null;

  if (fromBridge && bodyEscolaId) {
    // Trust escola_id from body (gateway already validated bridge_token on WS connect)
    if (device_id) {
      const { data } = await ctx.sb.from("acesso_dispositivos")
        .select("*").eq("id", device_id).eq("escola_id", bodyEscolaId).eq("ativo", true).maybeSingle();
      dispositivo = data;
    }
    if (!dispositivo) {
      console.warn(`[acesso_evento_callback] Bridge event sem device_id válido. escola=${bodyEscolaId} device_id=${device_id}`);
      throw new AppError("FORBIDDEN", "Evento bridge: dispositivo não encontrado nessa escola.");
    }
  } else {
    // Direct mode: device IP must match a registered device
    const sourceIp = ctx.ip;
    const { data: devices } = await ctx.sb.from("acesso_dispositivos").select("*").eq("ativo", true);
    if (device_id) {
      dispositivo = (devices ?? []).find((d: Any) => d.id === device_id);
    }
    if (!dispositivo) {
      dispositivo = (devices ?? []).find((d: Any) => d.ip === sourceIp);
    }
    if (!dispositivo) {
      console.warn(`[acesso_evento_callback] Rejeitado: origem não reconhecida. sourceIp=${sourceIp} device_id=${device_id}`);
      throw new AppError("FORBIDDEN", "Evento rejeitado: dispositivo não registrado.");
    }
  }

  // Determine direction from device type
  let direcao = direction || "entrada";
  if (dispositivo) {
    if (dispositivo.tipo === "catraca_entrada" || dispositivo.tipo === "terminal_entrada") direcao = "entrada";
    else if (dispositivo.tipo === "catraca_saida" || dispositivo.tipo === "terminal_saida") direcao = "saida";
    // terminal_bidirecional uses the direction from the device payload
  }

  // Look up person
  let pessoa: Any = null;

  if (method === "card" && card_value) {
    // RFID lookup
    const { data } = await ctx.sb.from("acesso_rfid").select("*").eq("card_uid", String(card_value)).eq("ativo", true).eq("escola_id", dispositivo.escola_id).single();
    if (data) pessoa = { tipo: data.pessoa_tipo, id: data.pessoa_id, nome: data.pessoa_nome };
  } else if (user_id) {
    // Face recognition lookup by device_user_id
    const { data } = await ctx.sb.from("acesso_faces").select("*").eq("device_user_id", Number(user_id)).eq("ativo", true).eq("escola_id", dispositivo.escola_id).single();
    if (data) pessoa = { tipo: data.pessoa_tipo, id: data.pessoa_id, nome: data.pessoa_nome };
  }

  // Save capture photo if provided
  let fotoCapturaUrl: string | null = null;
  if (photo) {
    try {
      const raw = atob(photo.replace(/^data:image\/\w+;base64,/, ""));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const path = `acesso/capturas/${Date.now()}_${user_id || "unknown"}.jpg`;
      const { error: upErr } = await ctx.sb.storage.from("wa-documentos").upload(path, bytes, {
        contentType: "image/jpeg", upsert: true,
      });
      if (!upErr) {
        const { data: signed } = await ctx.sb.storage.from("wa-documentos").createSignedUrl(path, 60 * 60 * 24 * 7);
        fotoCapturaUrl = signed?.signedUrl || null;
      }
    } catch (e) {
      console.error("Erro ao salvar foto captura:", e);
    }
  }

  // Derive escola_id from the registered device
  const eventoEscolaId = dispositivo.escola_id;
  if (!eventoEscolaId) {
    console.warn(`[acesso_evento_callback] Dispositivo ${dispositivo.id} sem escola_id.`);
    throw new AppError("BAD_REQUEST", "Dispositivo sem escola associada.");
  }

  // Unknown person
  if (!pessoa) {
    // Create event for unknown person
    const { data: evento } = await ctx.sb.from("acesso_eventos").insert({
      escola_id: eventoEscolaId,
      dispositivo_id: dispositivo?.id || null,
      pessoa_tipo: "desconhecido",
      pessoa_id: "00000000-0000-0000-0000-000000000000",
      pessoa_nome: "Desconhecido",
      metodo: method === "card" ? "rfid" : "face",
      direcao,
      foto_captura_url: fotoCapturaUrl,
      confianca: confidence || null,
      card_uid: card_value ? String(card_value) : null,
    }).select().single();

    // Generate alert
    const alertaDesconhecido = await getConfig(ctx.sb, "alerta_desconhecido");
    if (alertaDesconhecido !== "false") {
      await ctx.sb.from("acesso_alertas").insert({
        escola_id: eventoEscolaId,
        evento_id: evento?.id,
        tipo: "desconhecido",
        pessoa_nome: "Pessoa não identificada",
        mensagem: `Pessoa não identificada detectada no ${dispositivo?.nome || "dispositivo desconhecido"} (${direcao}).`,
        destinatario_tipo: "recepcao",
      });
    }

    return successResponse({ ok: true, recognized: false });
  }

  // ── BLOQUEIO DE SAÍDA SOLO ──────────────────────────────
  // Aluno só pode sair se houver alerta 'chegada_responsavel' aberto (aguardando/encaminhado) hoje.
  // Caso contrário: registra como 'saida_negada', cria alerta urgente, e responde ao iDFace
  // com {result:false, message:"Aguardando responsavel"} pra negar a abertura da catraca.
  let saidaNegada = false;
  if (pessoa.tipo === "aluno" && direcao === "saida") {
    const hojeIso = new Date().toISOString().split("T")[0];
    const { data: alertaAberto } = await ctx.sb.from("acesso_alertas")
      .select("id")
      .eq("escola_id", eventoEscolaId)
      .eq("aluno_id", pessoa.id)
      .eq("tipo", "chegada_responsavel")
      .in("status", ["aguardando", "encaminhado"])
      .gte("criado_em", `${hojeIso}T00:00:00`)
      .limit(1)
      .maybeSingle();
    if (!alertaAberto) {
      saidaNegada = true;
      direcao = "saida_negada";
    }
  }

  // Create event
  const metodo = method === "card" ? "rfid" : "face";
  const { data: evento } = await ctx.sb.from("acesso_eventos").insert({
    escola_id: eventoEscolaId,
    dispositivo_id: dispositivo?.id || null,
    pessoa_tipo: pessoa.tipo,
    pessoa_id: pessoa.id,
    pessoa_nome: pessoa.nome,
    metodo,
    direcao,
    foto_captura_url: fotoCapturaUrl,
    confianca: confidence || null,
    card_uid: card_value ? String(card_value) : null,
  }).select().single();

  if (saidaNegada) {
    // Alerta urgente interno (NÃO notifica família — feedback_incidentes_internos)
    await ctx.sb.from("acesso_alertas").insert({
      escola_id: eventoEscolaId,
      evento_id: evento?.id,
      tipo: "tentativa_saida_solo",
      pessoa_nome: pessoa.nome,
      aluno_id: pessoa.id,
      aluno_nome: pessoa.nome,
      urgente: true,
      mensagem: `${pessoa.nome} tentou sair sem responsável presente.`,
      destinatario_tipo: "recepcao",
    });
    // Resposta síncrona pro iDFace: nega + mensagem no display (sem acentos, max 64 chars)
    return new Response(JSON.stringify({
      result: false,
      message: "Aguardando responsavel",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // ── ALUNO: update presence ──────────────────────────────
  if (pessoa.tipo === "aluno") {
    const hoje = new Date().toISOString().split("T")[0];
    const agora = new Date().toTimeString().split(" ")[0]; // HH:MM:SS

    if (direcao === "entrada") {
      // Upsert presence (entrada)
      const { data: existing } = await ctx.sb.from("acesso_presenca")
        .select("id").eq("escola_id", eventoEscolaId).eq("aluno_id", pessoa.id).eq("data", hoje).maybeSingle();

      if (existing) {
        await ctx.sb.from("acesso_presenca").update({
          hora_entrada: agora, entrada_metodo: metodo, entrada_evento_id: evento?.id, status: "presente",
        }).eq("id", existing.id).eq("escola_id", eventoEscolaId);
      } else {
        // Get aluno_nome
        await ctx.sb.from("acesso_presenca").insert({
          escola_id: eventoEscolaId, aluno_id: pessoa.id, aluno_nome: pessoa.nome, data: hoje,
          hora_entrada: agora, entrada_metodo: metodo, entrada_evento_id: evento?.id, status: "presente",
        });
      }

      // Alert: aluno entered
      await ctx.sb.from("acesso_alertas").insert({
        escola_id: eventoEscolaId,
        evento_id: evento?.id,
        tipo: "entrada_aluno",
        pessoa_nome: pessoa.nome,
        aluno_nome: pessoa.nome,
        mensagem: `${pessoa.nome} chegou na escola via ${metodo}.`,
        destinatario_tipo: "recepcao",
      });

    } else {
      // Saida
      const { data: existing } = await ctx.sb.from("acesso_presenca")
        .select("id").eq("escola_id", eventoEscolaId).eq("aluno_id", pessoa.id).eq("data", hoje).maybeSingle();

      if (existing) {
        await ctx.sb.from("acesso_presenca").update({
          hora_saida: agora, saida_metodo: metodo, saida_evento_id: evento?.id, status: "saiu",
        }).eq("id", existing.id).eq("escola_id", eventoEscolaId);
      } else {
        await ctx.sb.from("acesso_presenca").insert({
          escola_id: eventoEscolaId, aluno_id: pessoa.id, aluno_nome: pessoa.nome, data: hoje,
          hora_saida: agora, saida_metodo: metodo, saida_evento_id: evento?.id, status: "saiu",
        });
      }

      // Alert: aluno leaving
      await ctx.sb.from("acesso_alertas").insert({
        escola_id: eventoEscolaId,
        evento_id: evento?.id,
        tipo: "saida_aluno",
        pessoa_nome: pessoa.nome,
        aluno_id: pessoa.id,
        aluno_nome: pessoa.nome,
        mensagem: `${pessoa.nome} saiu da escola via ${metodo}.`,
        destinatario_tipo: "recepcao",
      });

      // Auto-fecha alertas 'chegada_responsavel' abertos pra esse aluno hoje
      // (sec/profa veem o card mudar pra ✓ saiu)
      await ctx.sb.from("acesso_alertas")
        .update({
          status: "concluido",
          concluido_em: new Date().toISOString(),
          concluido_evento_id: evento?.id,
        })
        .eq("escola_id", eventoEscolaId)
        .eq("aluno_id", pessoa.id)
        .eq("tipo", "chegada_responsavel")
        .in("status", ["aguardando", "encaminhado"])
        .gte("criado_em", `${hoje}T00:00:00`);
    }
  }

  // ── RESPONSAVEL: check permissions + alert teacher ──────
  if (pessoa.tipo === "responsavel") {
    // Find which alunos this person can pick up
    const { data: perms } = await ctx.sb.from("acesso_permissoes_retirada")
      .select("*")
      .eq("escola_id", eventoEscolaId)
      .eq("responsavel_id", pessoa.id)
      .eq("autorizado", true);

    // Filter by validade
    const hoje = new Date().toISOString().split("T")[0];
    const validPerms = (perms ?? []).filter((p: Any) => !p.validade || p.validade >= hoje);

    if (validPerms.length === 0) {
      // Not authorized
      const alertaNaoAut = await getConfig(ctx.sb, "alerta_nao_autorizado");
      if (alertaNaoAut !== "false") {
        await ctx.sb.from("acesso_alertas").insert({
          escola_id: eventoEscolaId,
          evento_id: evento?.id,
          tipo: "nao_autorizado",
          pessoa_nome: pessoa.nome,
          mensagem: `${pessoa.nome} tentou acessar mas NÃO está autorizado(a) a retirar nenhum aluno.`,
          destinatario_tipo: "todos",
        });
      }
    } else {
      // For each authorized aluno, find turma and professora, create alerts
      for (const perm of validPerms) {
        // Get aluno info (turma/serie)
        const { data: aluno } = await ctx.sb.from("alunos")
          .select("id, nome, serie, serie_id")
          .eq("id", perm.aluno_id)
          .eq("escola_id", eventoEscolaId)
          .maybeSingle();

        const turma = aluno?.serie || "Sem turma";

        // Find professora assigned to this turma/serie
        let professoraId: string | null = null;
        if (aluno?.serie_id) {
          const { data: prof } = await ctx.sb.from("professoras")
            .select("id, nome")
            .eq("serie_id", aluno.serie_id)
            .eq("ativo", true)
            .maybeSingle();
          professoraId = prof?.id || null;
        }

        // Alert for reception
        await ctx.sb.from("acesso_alertas").insert({
          escola_id: eventoEscolaId,
          evento_id: evento?.id,
          responsavel_evento_id: evento?.id,
          aluno_id: perm.aluno_id,
          tipo: "chegada_responsavel",
          pessoa_nome: pessoa.nome,
          aluno_nome: perm.aluno_nome,
          turma,
          mensagem: `${pessoa.nome} (${perm.parentesco || "responsavel"}) chegou para buscar ${perm.aluno_nome} (${turma}).`,
          destinatario_tipo: "recepcao",
          status: "aguardando",
        });

        // Alert for professora (if found)
        if (professoraId) {
          await ctx.sb.from("acesso_alertas").insert({
            escola_id: eventoEscolaId,
            evento_id: evento?.id,
            responsavel_evento_id: evento?.id,
            aluno_id: perm.aluno_id,
            tipo: "chegada_responsavel",
            pessoa_nome: pessoa.nome,
            aluno_nome: perm.aluno_nome,
            turma,
            mensagem: `${pessoa.nome} (${perm.parentesco || "responsavel"}) chegou para buscar ${perm.aluno_nome}.`,
            destinatario_tipo: "professora",
            destinatario_id: professoraId,
            status: "aguardando",
          });
        }
      }
    }
  }

  // ── FUNCIONARIO: just log event, no special alert ───────
  // (already logged above as acesso_eventos)

  return successResponse({ ok: true, recognized: true, pessoa_nome: pessoa.nome, direcao });
});

// ═══════════════════════════════════════════════════════════════
//  EVENT QUERIES (authGerenteOrSecretaria)
// ═══════════════════════════════════════════════════════════════

router.on("acesso_eventos_list", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data_inicio, data_fim, pessoa_tipo, direcao, limit: lim } = ctx.body as Any;
  let q = ctx.sb.from("acesso_eventos").select("*, acesso_dispositivos(nome, localizacao)")
    .eq("escola_id", ctx.escola_id)
    .order("criado_em", { ascending: false })
    .limit(lim || 100);

  if (pessoa_tipo) q = q.eq("pessoa_tipo", pessoa_tipo);
  if (direcao) q = q.eq("direcao", direcao);
  if (data_inicio) q = q.gte("criado_em", `${data_inicio}T00:00:00`);
  if (data_fim) q = q.lte("criado_em", `${data_fim}T23:59:59`);

  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("acesso_presenca_list", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data: dataFiltro, turma, status } = ctx.body as Any;
  const hoje = dataFiltro || new Date().toISOString().split("T")[0];

  let q = ctx.sb.from("acesso_presenca").select("*").eq("escola_id", ctx.escola_id).eq("data", hoje).order("aluno_nome");
  if (status) q = q.eq("status", status);

  const { data } = await q;

  // If turma filter, we need to cross-reference with alunos
  if (turma && data) {
    const alunoIds = data.map((p: Any) => p.aluno_id);
    if (alunoIds.length > 0) {
      const { data: alunos } = await ctx.sb.from("alunos").select("id, serie").eq("escola_id", ctx.escola_id).in("id", alunoIds);
      const alunoSerie = new Map((alunos ?? []).map((a: Any) => [a.id, a.serie]));
      const filtered = data.filter((p: Any) => alunoSerie.get(p.aluno_id) === turma);
      return successResponse(filtered);
    }
  }

  return successResponse(data ?? []);
});

router.on("acesso_alertas_list", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { lido, limit: lim } = ctx.body as Any;
  let q = ctx.sb.from("acesso_alertas").select("*")
    .eq("escola_id", ctx.escola_id)
    .order("lido", { ascending: true })
    .order("criado_em", { ascending: false })
    .limit(lim || 50);

  if (lido !== undefined && lido !== null) q = q.eq("lido", lido);

  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("acesso_alerta_marcar_lido", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id, ids } = ctx.body as Any;
  if (ids && Array.isArray(ids)) {
    await ctx.sb.from("acesso_alertas").update({ lido: true }).in("id", ids).eq("escola_id", ctx.escola_id);
  } else if (id) {
    await ctx.sb.from("acesso_alertas").update({ lido: true }).eq("id", id).eq("escola_id", ctx.escola_id);
  } else {
    throw new AppError("VALIDATION_FAILED", "id ou ids obrigatório.");
  }
  return successResponse({ ok: true });
});

router.on("acesso_dashboard", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const hoje = new Date().toISOString().split("T")[0];

  // Alunos presentes hoje
  const { data: presentes } = await ctx.sb.from("acesso_presenca")
    .select("id", { count: "exact" }).eq("escola_id", ctx.escola_id).eq("data", hoje).eq("status", "presente");

  // Alunos que saíram
  const { data: sairam } = await ctx.sb.from("acesso_presenca")
    .select("id", { count: "exact" }).eq("escola_id", ctx.escola_id).eq("data", hoje).eq("status", "saiu");

  // Total alunos ativos
  const { count: totalAlunos } = await ctx.sb.from("alunos")
    .select("id", { count: "exact", head: true }).eq("escola_id", ctx.escola_id).eq("ativo", true);

  // Alertas não lidos
  const { count: alertasNaoLidos } = await ctx.sb.from("acesso_alertas")
    .select("id", { count: "exact", head: true }).eq("escola_id", ctx.escola_id).eq("lido", false);

  // Eventos hoje
  const { count: eventosHoje } = await ctx.sb.from("acesso_eventos")
    .select("id", { count: "exact", head: true }).eq("escola_id", ctx.escola_id).gte("criado_em", `${hoje}T00:00:00`);

  // Devices online (heartbeat within last 2 minutes)
  const twoMinAgo = new Date(Date.now() - 120000).toISOString();
  const { count: devicesOnline } = await ctx.sb.from("acesso_dispositivos")
    .select("id", { count: "exact", head: true }).eq("escola_id", ctx.escola_id).eq("ativo", true).gte("ultimo_heartbeat", twoMinAgo);

  const { count: devicesTotal } = await ctx.sb.from("acesso_dispositivos")
    .select("id", { count: "exact", head: true }).eq("escola_id", ctx.escola_id).eq("ativo", true);

  return successResponse({
    presentes: presentes?.length ?? 0,
    sairam: sairam?.length ?? 0,
    ausentes: (totalAlunos ?? 0) - (presentes?.length ?? 0) - (sairam?.length ?? 0),
    total_alunos: totalAlunos ?? 0,
    alertas_nao_lidos: alertasNaoLidos ?? 0,
    eventos_hoje: eventosHoje ?? 0,
    devices_online: devicesOnline ?? 0,
    devices_total: devicesTotal ?? 0,
  });
});

// ═══════════════════════════════════════════════════════════════
//  CONFIG CRUD
// ═══════════════════════════════════════════════════════════════

router.on("acesso_config_list", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb.from("acesso_config").select("*").eq("escola_id", ctx.escola_id).order("chave");
  return successResponse(data ?? []);
});

router.on("acesso_config_save", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { chave, valor, descricao } = ctx.body as Any;
  if (!chave || valor === undefined) throw new AppError("VALIDATION_FAILED", "chave e valor são obrigatórios.");

  const { data, error } = await ctx.sb.from("acesso_config").upsert(
    { escola_id: ctx.escola_id, chave, valor: String(valor), descricao: descricao || null },
    { onConflict: "escola_id,chave" }
  ).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

// ═══════════════════════════════════════════════════════════════
//  PROFESSORA ACTIONS
// ═══════════════════════════════════════════════════════════════

router.on("acesso_alertas_professora", authProfessora, async (ctx) => {
  const professoraId = ctx.user?.id;
  if (!professoraId) throw new AppError("AUTH_REQUIRED", "Professora ID não encontrado.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");

  const hojeIso = new Date().toISOString().split("T")[0];

  // Alertas da professora: hoje, em fluxo aberto OU concluídos há menos de 5min
  const { data: alertas } = await ctx.sb.from("acesso_alertas")
    .select("*")
    .eq("escola_id", ctx.escola_id)
    .eq("destinatario_tipo", "professora")
    .eq("destinatario_id", professoraId)
    .eq("tipo", "chegada_responsavel")
    .gte("criado_em", `${hojeIso}T00:00:00`)
    .order("criado_em", { ascending: false })
    .limit(20);

  // Filtra: aguardando, encaminhado, ou concluído há <5min (pra mostrar ✓ saiu por um tempinho)
  const cincoMinAtras = Date.now() - 5 * 60 * 1000;
  const visiveis = (alertas ?? []).filter((a: Any) => {
    if (a.status === "aguardando" || a.status === "encaminhado") return true;
    if (a.status === "concluido" && a.concluido_em) {
      return new Date(a.concluido_em).getTime() > cincoMinAtras;
    }
    return false;
  });

  // Enriquece com foto do aluno (cadastrada) + foto do pai (capturada no evento)
  const alunoIds = Array.from(new Set(visiveis.map((a: Any) => a.aluno_id).filter(Boolean)));
  const eventoIds = Array.from(new Set(visiveis.map((a: Any) => a.responsavel_evento_id).filter(Boolean)));

  const alunoFotoMap = new Map<string, string>();
  if (alunoIds.length > 0) {
    const { data: faces } = await ctx.sb.from("acesso_faces")
      .select("pessoa_id, foto_url")
      .eq("escola_id", ctx.escola_id)
      .eq("pessoa_tipo", "aluno")
      .eq("ativo", true)
      .in("pessoa_id", alunoIds);
    for (const f of faces ?? []) if (f.pessoa_id && f.foto_url) alunoFotoMap.set(f.pessoa_id, f.foto_url);
  }

  const eventoFotoMap = new Map<string, string>();
  if (eventoIds.length > 0) {
    const { data: evts } = await ctx.sb.from("acesso_eventos")
      .select("id, foto_captura_url")
      .eq("escola_id", ctx.escola_id)
      .in("id", eventoIds);
    for (const e of evts ?? []) if (e.id && e.foto_captura_url) eventoFotoMap.set(e.id, e.foto_captura_url);
  }

  const enriched = visiveis.map((a: Any) => ({
    ...a,
    aluno_foto_url: a.aluno_id ? (alunoFotoMap.get(a.aluno_id) || null) : null,
    pai_foto_captura_url: a.responsavel_evento_id ? (eventoFotoMap.get(a.responsavel_evento_id) || null) : null,
  }));

  return successResponse(enriched);
});

router.on("acesso_chegada_encaminhar", authProfessora, async (ctx) => {
  const professoraId = ctx.user?.id;
  if (!professoraId) throw new AppError("AUTH_REQUIRED", "Professora ID não encontrado.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { alerta_id } = ctx.body as Any;
  if (!alerta_id) throw new AppError("VALIDATION_FAILED", "alerta_id obrigatório.");

  // Confirma ownership: o alerta é dessa professora
  const { data: alerta } = await ctx.sb.from("acesso_alertas")
    .select("*")
    .eq("id", alerta_id)
    .eq("escola_id", ctx.escola_id)
    .eq("destinatario_tipo", "professora")
    .eq("destinatario_id", professoraId)
    .maybeSingle();
  if (!alerta) throw new AppError("NOT_FOUND", "Alerta não encontrado.");
  if (alerta.status !== "aguardando") {
    throw new AppError("BAD_REQUEST", `Alerta já está em status '${alerta.status}'.`);
  }

  const agora = new Date().toISOString();

  // Marca o alerta da professora
  await ctx.sb.from("acesso_alertas")
    .update({ status: "encaminhado", encaminhado_em: agora, encaminhado_por: professoraId, lido: true })
    .eq("id", alerta_id)
    .eq("escola_id", ctx.escola_id);

  // Marca também o alerta-irmão da recepção (mesmo evento de chegada + mesmo aluno)
  if (alerta.responsavel_evento_id && alerta.aluno_id) {
    await ctx.sb.from("acesso_alertas")
      .update({ status: "encaminhado", encaminhado_em: agora, encaminhado_por: professoraId })
      .eq("escola_id", ctx.escola_id)
      .eq("responsavel_evento_id", alerta.responsavel_evento_id)
      .eq("aluno_id", alerta.aluno_id)
      .eq("destinatario_tipo", "recepcao")
      .eq("status", "aguardando");
  }

  return successResponse({ ok: true });
});

router.on("acesso_chegadas_portaria", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const hojeIso = new Date().toISOString().split("T")[0];

  // Chegadas + tentativas de saída solo do dia, destinatário recepção
  const { data: alertas } = await ctx.sb.from("acesso_alertas")
    .select("*")
    .eq("escola_id", ctx.escola_id)
    .eq("destinatario_tipo", "recepcao")
    .in("tipo", ["chegada_responsavel", "tentativa_saida_solo"])
    .gte("criado_em", `${hojeIso}T00:00:00`)
    .order("criado_em", { ascending: false });

  // Filtra: abertos OU concluídos há <5min OU urgentes não-lidos
  const cincoMinAtras = Date.now() - 5 * 60 * 1000;
  const visiveis = (alertas ?? []).filter((a: Any) => {
    if (a.status === "aguardando" || a.status === "encaminhado") return true;
    if (a.urgente && !a.lido) return true;
    if (a.status === "concluido" && a.concluido_em) {
      return new Date(a.concluido_em).getTime() > cincoMinAtras;
    }
    return false;
  });

  const alunoIds = Array.from(new Set(visiveis.map((a: Any) => a.aluno_id).filter(Boolean)));
  const eventoIds = Array.from(new Set(visiveis.map((a: Any) => a.responsavel_evento_id).filter(Boolean)));

  const alunoFotoMap = new Map<string, string>();
  if (alunoIds.length > 0) {
    const { data: faces } = await ctx.sb.from("acesso_faces")
      .select("pessoa_id, foto_url")
      .eq("escola_id", ctx.escola_id)
      .eq("pessoa_tipo", "aluno")
      .eq("ativo", true)
      .in("pessoa_id", alunoIds);
    for (const f of faces ?? []) if (f.pessoa_id && f.foto_url) alunoFotoMap.set(f.pessoa_id, f.foto_url);
  }

  const eventoFotoMap = new Map<string, string>();
  if (eventoIds.length > 0) {
    const { data: evts } = await ctx.sb.from("acesso_eventos")
      .select("id, foto_captura_url")
      .eq("escola_id", ctx.escola_id)
      .in("id", eventoIds);
    for (const e of evts ?? []) if (e.id && e.foto_captura_url) eventoFotoMap.set(e.id, e.foto_captura_url);
  }

  // Mapeia professora vinculada via alerta-irmão (destinatario_tipo='professora', mesmo responsavel_evento_id+aluno_id)
  const profMap = new Map<string, { id: string; nome: string | null }>();
  if (eventoIds.length > 0) {
    const { data: profAlertas } = await ctx.sb.from("acesso_alertas")
      .select("responsavel_evento_id, aluno_id, destinatario_id")
      .eq("escola_id", ctx.escola_id)
      .eq("destinatario_tipo", "professora")
      .eq("tipo", "chegada_responsavel")
      .in("responsavel_evento_id", eventoIds);

    const profIds = Array.from(new Set((profAlertas ?? []).map((a: Any) => a.destinatario_id).filter(Boolean)));
    const profNomeMap = new Map<string, string>();
    if (profIds.length > 0) {
      const { data: profs } = await ctx.sb.from("professoras")
        .select("id, nome")
        .in("id", profIds);
      for (const p of profs ?? []) profNomeMap.set(p.id, p.nome || "");
    }

    for (const pa of profAlertas ?? []) {
      if (pa.responsavel_evento_id && pa.aluno_id && pa.destinatario_id) {
        profMap.set(`${pa.responsavel_evento_id}:${pa.aluno_id}`, {
          id: pa.destinatario_id,
          nome: profNomeMap.get(pa.destinatario_id) || null,
        });
      }
    }
  }

  const enriched = visiveis.map((a: Any) => {
    const profKey = `${a.responsavel_evento_id}:${a.aluno_id}`;
    const prof = profMap.get(profKey) || null;
    return {
      alerta_id: a.id,
      tipo: a.tipo,
      pessoa_nome: a.pessoa_nome,
      aluno_id: a.aluno_id,
      aluno_nome: a.aluno_nome,
      aluno_foto_url: a.aluno_id ? (alunoFotoMap.get(a.aluno_id) || null) : null,
      pai_foto_captura_url: a.responsavel_evento_id ? (eventoFotoMap.get(a.responsavel_evento_id) || null) : null,
      turma: a.turma,
      professora_id: prof?.id || null,
      professora_nome: prof?.nome || null,
      status: a.status,
      urgente: !!a.urgente,
      lido: !!a.lido,
      mensagem: a.mensagem,
      responsavel_evento_id: a.responsavel_evento_id,
      criado_em: a.criado_em,
      encaminhado_em: a.encaminhado_em,
      concluido_em: a.concluido_em,
    };
  });

  return successResponse(enriched);
});

router.on("acesso_presenca_turma", authProfessora, async (ctx) => {
  const professoraId = ctx.user?.id;
  if (!professoraId) throw new AppError("AUTH_REQUIRED", "Professora ID não encontrado.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");

  // Get professora's serie_id
  const { data: prof } = await ctx.sb.from("professoras")
    .select("serie_id").eq("id", professoraId).eq("escola_id", ctx.escola_id).single();

  if (!prof?.serie_id) return successResponse([]);

  // Get alunos from that serie
  const { data: alunos } = await ctx.sb.from("alunos")
    .select("id, nome").eq("escola_id", ctx.escola_id).eq("serie_id", prof.serie_id).eq("ativo", true);

  if (!alunos?.length) return successResponse([]);

  const hoje = new Date().toISOString().split("T")[0];
  const alunoIds = alunos.map((a: Any) => a.id);

  const { data: presenca } = await ctx.sb.from("acesso_presenca")
    .select("*").eq("escola_id", ctx.escola_id).eq("data", hoje).in("aluno_id", alunoIds);

  // Merge: for each aluno, attach their presence status
  const presMap = new Map((presenca ?? []).map((p: Any) => [p.aluno_id, p]));
  const resultado = alunos.map((a: Any) => {
    const p = presMap.get(a.id);
    return {
      aluno_id: a.id,
      aluno_nome: a.nome,
      status: p?.status || "ausente",
      hora_entrada: p?.hora_entrada || null,
      hora_saida: p?.hora_saida || null,
      entrada_metodo: p?.entrada_metodo || null,
      saida_metodo: p?.saida_metodo || null,
    };
  });

  return successResponse(resultado);
});

// ═══════════════════════════════════════════════════════════════
//  Actions PÚBLICAS para portal dos pais (auth via email)
// ═══════════════════════════════════════════════════════════════

router.on("acesso_minha_face", async (ctx) => {
  const { email } = ctx.body as Any;
  if (!email) throw new AppError("VALIDATION_FAILED", "Email obrigatório.");
  // AUTH: verificar JWT e conferir que email autenticado bate com o email solicitado
  const familia = await assertFamiliaOwnership(ctx, email);
  if (!familia) return successResponse(null);
  const { data: face } = await ctx.sb.from("acesso_faces")
    .select("*").eq("pessoa_tipo", "responsavel").eq("pessoa_id", familia.id).eq("ativo", true).maybeSingle();
  return successResponse(face);
});

router.on("acesso_presenca_filhos", async (ctx) => {
  const { email } = ctx.body as Any;
  if (!email) throw new AppError("VALIDATION_FAILED", "Email obrigatório.");
  // AUTH: verificar JWT e conferir que email autenticado bate com o email solicitado
  const familiaAuth = await assertFamiliaOwnership(ctx, email);
  if (!familiaAuth) return successResponse([]);
  const hoje = new Date().toISOString().split("T")[0];
  // Buscar alunos vinculados a esta familia (inclui coluna `filhos` se disponível)
  const { data: familia } = await ctx.sb.from("familias").select("id, filhos").eq("id", familiaAuth.id).maybeSingle();
  if (!familia) return successResponse([]);
  // filhos pode ser array de objetos com nome, ou buscar na tabela alunos
  const { data: alunos } = await ctx.sb.from("alunos").select("id, nome, serie").eq("familia_id", familia.id);
  if (!alunos?.length) return successResponse([]);
  // Buscar presença de cada aluno hoje
  const result = [];
  for (const a of alunos) {
    const { data: p } = await ctx.sb.from("acesso_presenca")
      .select("*").eq("aluno_id", a.id).eq("data", hoje).maybeSingle();
    result.push({
      aluno_id: a.id, aluno_nome: a.nome, serie: a.serie,
      status: p?.status || "ausente", hora_entrada: p?.hora_entrada, hora_saida: p?.hora_saida,
    });
  }
  return successResponse(result);
});

router.on("acesso_meus_autorizados", async (ctx) => {
  const { email } = ctx.body as Any;
  if (!email) throw new AppError("VALIDATION_FAILED", "Email obrigatório.");
  // AUTH: verificar JWT e conferir que email autenticado bate com o email solicitado
  const familia = await assertFamiliaOwnership(ctx, email);
  if (!familia) return successResponse([]);
  const { data } = await ctx.sb.from("acesso_permissoes_retirada")
    .select("*").eq("responsavel_id", familia.id).order("criado_em", { ascending: false });
  return successResponse(data ?? []);
});

router.on("acesso_adicionar_autorizado", async (ctx) => {
  const { email_responsavel, aluno_id, aluno_nome, responsavel_nome, parentesco, foto, validade } = ctx.body as Any;
  if (!email_responsavel || !aluno_id || !responsavel_nome || !parentesco) {
    throw new AppError("VALIDATION_FAILED", "Campos obrigatórios: email, aluno_id, nome, parentesco.");
  }
  // AUTH: verificar JWT e conferir que email autenticado bate com o email_responsavel informado
  const familia = await assertFamiliaOwnership(ctx, email_responsavel);
  if (!familia) throw new AppError("NOT_FOUND", "Família não encontrada.");

  // Processar foto se fornecida
  let fotoUrl: string | null = null;
  let fotoBinary: Uint8Array | null = null;
  if (foto) {
    const raw = atob(foto.replace(/^data:image\/\w+;base64,/, ""));
    fotoBinary = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) fotoBinary[i] = raw.charCodeAt(i);
    if (fotoBinary.length > 2 * 1024 * 1024) throw new AppError("VALIDATION_FAILED", "Foto deve ter no máximo 2MB.");

    // Validar qualidade
    const qualidade = await validarQualidadeFoto(ctx.sb, fotoBinary);
    if (!qualidade.ok) {
      return successResponse({ ok: false, qualidade_erros: qualidade.errors });
    }

    // Salvar no storage
    const path = `acesso/autorizados/${aluno_id}_${Date.now()}.jpg`;
    await ctx.sb.storage.from("wa-documentos").upload(path, fotoBinary, { contentType: "image/jpeg", upsert: true });
    const { data: signed } = await ctx.sb.storage.from("wa-documentos").createSignedUrl(path, 60 * 60 * 24 * 7);
    fotoUrl = signed?.signedUrl || null;
  }

  // Resolve escola_id from request origin
  const paiEscolaId = await resolveEscolaId(ctx.req, ctx.sb, null, ctx.body);
  if (!paiEscolaId) throw new AppError("BAD_REQUEST", "Não foi possível determinar a escola.");

  // Criar permissão de retirada
  const { error: permErr } = await ctx.sb.from("acesso_permissoes_retirada").insert({
    escola_id: paiEscolaId, aluno_id, aluno_nome: aluno_nome || "", responsavel_id: familia.id,
    responsavel_nome, responsavel_email: email_responsavel,
    responsavel_foto_url: fotoUrl, parentesco, validade: validade || null,
    autorizado: true, autorizado_por: "auto (portal pais)",
  });
  if (permErr) throw new AppError("BAD_REQUEST", permErr.message);

  // Criar face com status aguardando_aprovacao (gera ID único para o autorizado)
  const pessoaId = crypto.randomUUID();
  const deviceUserId = uuidToDeviceId(pessoaId);
  await ctx.sb.from("acesso_faces").insert({
    escola_id: paiEscolaId, pessoa_tipo: "responsavel", pessoa_id: pessoaId,
    pessoa_nome: responsavel_nome, foto_url: fotoUrl,
    device_user_id: deviceUserId, sync_status: "aguardando_aprovacao",
  });

  return successResponse({ ok: true });
});

router.on("acesso_cancelar_autorizado", async (ctx) => {
  const { id } = ctx.body as Any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");

  // AUTH: verificar JWT do responsável
  const authedEmail = await getAuthenticatedPaiEmail(ctx);

  // Resolve escola_id for tenant scoping on lookup
  const lookupEscolaId = await resolveEscolaId(ctx.req, ctx.sb, null, ctx.body);

  // OWNERSHIP: verificar que o autorizado pertence a uma família cujo email bate com o usuário autenticado
  let qPerm = ctx.sb.from("acesso_permissoes_retirada")
    .select("id, responsavel_id, responsavel_email")
    .eq("id", id);
  if (lookupEscolaId) qPerm = qPerm.eq("escola_id", lookupEscolaId);
  const { data: perm } = await qPerm.maybeSingle();
  if (!perm) throw new AppError("NOT_FOUND", "Autorização não encontrada.");

  // Buscar família dona do autorizado (responsavel_id aponta para familias.id)
  let qFam = ctx.sb.from("familias")
    .select("id, email")
    .eq("id", perm.responsavel_id);
  if (lookupEscolaId) qFam = qFam.eq("escola_id", lookupEscolaId);
  const { data: familia } = await qFam.maybeSingle();

  const familiaEmail = String(familia?.email || perm.responsavel_email || "").toLowerCase();
  if (!familiaEmail || familiaEmail !== authedEmail) {
    throw new AppError("FORBIDDEN", "Você não tem permissão para cancelar esta autorização.");
  }

  // Update with tenant scoping
  if (lookupEscolaId) {
    await ctx.sb.from("acesso_permissoes_retirada").update({ autorizado: false }).eq("id", id).eq("escola_id", lookupEscolaId);
  } else {
    await ctx.sb.from("acesso_permissoes_retirada").update({ autorizado: false }).eq("id", id);
  }
  return successResponse({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  Portal dos pais — autorização de retirada provisória
// ═══════════════════════════════════════════════════════════════

function _onlyDigits(s: string): string { return String(s || "").replace(/\D/g, ""); }
function _isValidCpf(cpf: string): boolean {
  const d = _onlyDigits(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false; // todos iguais
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i);
  let v1 = (sum * 10) % 11; if (v1 === 10) v1 = 0;
  if (v1 !== parseInt(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i);
  let v2 = (sum * 10) % 11; if (v2 === 10) v2 = 0;
  return v2 === parseInt(d[10]);
}

async function _resolveFamiliasDoPai(ctx: Any, email: string): Promise<Any[]> {
  const escolaId = await resolveEscolaId(ctx.req, ctx.sb, null, ctx.body);
  let q = ctx.sb.from("familias").select("id, nome_aluno, nome_responsavel, email, escola_id").eq("email", email);
  if (escolaId) q = q.eq("escola_id", escolaId);
  const { data } = await q;
  return data || [];
}

// ─── Lista filhos + autorizados existentes
router.on("acesso_pai_meus_autorizados", async (ctx) => {
  const email = await getAuthenticatedPaiEmail(ctx);
  const familias = await _resolveFamiliasDoPai(ctx, email);
  if (!familias.length) return successResponse({ filhos: [] });

  // Cada familia.id é o aluno (mig 109 sincroniza). Buscar alunos com mesmo nome+escola pra cobrir caso de id divergente
  const alunoIds: string[] = [];
  const familiaByAlunoId = new Map<string, Any>();
  const escolasIds = new Set<string>();
  for (const f of familias) {
    if (f.escola_id) escolasIds.add(f.escola_id);
    if (f.id) { alunoIds.push(f.id); familiaByAlunoId.set(f.id, f); }
  }

  // Buscar alunos por nome também (defensivo)
  let alunosPorNome: Any[] = [];
  if (escolasIds.size && familias.length) {
    const nomes = familias.map((f: Any) => f.nome_aluno).filter(Boolean);
    const { data } = await ctx.sb.from("alunos").select("id, nome, escola_id").in("escola_id", Array.from(escolasIds)).in("nome", nomes);
    alunosPorNome = data || [];
  }
  for (const a of alunosPorNome) {
    if (!alunoIds.includes(a.id)) alunoIds.push(a.id);
  }

  if (!alunoIds.length) return successResponse({ filhos: [] });

  const { data: perms } = await ctx.sb.from("acesso_permissoes_retirada")
    .select("id, aluno_id, aluno_nome, responsavel_id, responsavel_nome, responsavel_email, responsavel_cpf, responsavel_foto_url, parentesco, validade, autorizado, criado_por_familia, criado_em")
    .in("aluno_id", alunoIds)
    .order("criado_em", { ascending: false });

  // Faces dos responsáveis
  const respIds = (perms ?? []).map((p: Any) => p.responsavel_id).filter(Boolean);
  const facesMap = new Map<string, Any>();
  if (respIds.length) {
    const { data: faces } = await ctx.sb.from("acesso_faces")
      .select("pessoa_id, sync_status").eq("ativo", true).eq("pessoa_tipo", "responsavel").in("pessoa_id", respIds);
    for (const f of faces || []) facesMap.set(f.pessoa_id, f);
  }

  // Tokens ativos
  const { data: tokens } = await ctx.sb.from("acesso_cadastro_tokens")
    .select("pessoa_id, expira_em, usado").eq("pessoa_tipo", "responsavel").in("pessoa_id", respIds);
  const tokenMap = new Map<string, Any>();
  for (const t of tokens || []) tokenMap.set(t.pessoa_id, t);

  // Agrupa por aluno
  const filhosOut: Any = {};
  for (const aid of alunoIds) {
    const fam = familiaByAlunoId.get(aid) || familias[0];
    filhosOut[aid] = { aluno_id: aid, aluno_nome: fam?.nome_aluno || "—", autorizados: [] };
  }
  for (const p of perms || []) {
    if (!filhosOut[p.aluno_id]) continue;
    const face = p.responsavel_id ? facesMap.get(p.responsavel_id) : null;
    const tk = p.responsavel_id ? tokenMap.get(p.responsavel_id) : null;
    let face_status = "sem_face";
    if (face?.sync_status === "sincronizado") face_status = "cadastrada";
    else if (face?.sync_status === "aguardando_aprovacao") face_status = "aguardando_aprovacao";
    else if (face?.sync_status === "erro") face_status = "erro";
    else if (tk && !tk.usado && new Date(tk.expira_em) > new Date()) face_status = "link_enviado";
    filhosOut[p.aluno_id].autorizados.push({
      id: p.id,
      responsavel_id: p.responsavel_id,
      nome: p.responsavel_nome,
      cpf: p.responsavel_cpf,
      email: p.responsavel_email,
      parentesco: p.parentesco,
      foto_url: p.responsavel_foto_url,
      validade: p.validade,
      ativo: !!p.autorizado,
      criado_por_familia: !!p.criado_por_familia,
      face_status,
    });
  }

  return successResponse({ filhos: Object.values(filhosOut) });
});

// ─── Cria autorização provisória (pelo pai)
router.on("acesso_pai_autorizar_create", async (ctx) => {
  const email = await getAuthenticatedPaiEmail(ctx);
  const { aluno_id, responsavel_nome, responsavel_cpf, responsavel_email, parentesco, validade } = ctx.body as Any;

  if (!aluno_id || !responsavel_nome || !responsavel_cpf || !responsavel_email) {
    throw new AppError("VALIDATION_FAILED", "aluno_id, responsavel_nome, responsavel_cpf e responsavel_email são obrigatórios.");
  }
  const cpfDigits = _onlyDigits(responsavel_cpf);
  if (!_isValidCpf(cpfDigits)) throw new AppError("VALIDATION_FAILED", "CPF inválido.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsavel_email)) throw new AppError("VALIDATION_FAILED", "Email inválido.");
  if (validade && new Date(validade) < new Date(new Date().toDateString())) {
    throw new AppError("VALIDATION_FAILED", "Validade não pode ser no passado.");
  }

  // OWNERSHIP: o pai só autoriza pra filhos da sua família
  const familias = await _resolveFamiliasDoPai(ctx, email);
  const escolaId = familias[0]?.escola_id;
  if (!escolaId) throw new AppError("FORBIDDEN", "Família não encontrada para esse email.");

  // Confirma que o aluno_id pertence a essa família
  const { data: aluno } = await ctx.sb.from("alunos").select("id, nome, escola_id, familia_email").eq("id", aluno_id).maybeSingle();
  if (!aluno) throw new AppError("NOT_FOUND", "Aluno não encontrado.");
  if (aluno.escola_id !== escolaId) throw new AppError("FORBIDDEN", "Esse aluno não pertence à sua família.");
  // Aluno deve ter familia_email ou nome batendo
  const matchPorEmail = String(aluno.familia_email || "").toLowerCase() === email;
  const matchPorNome = familias.some((f: Any) => String(f.nome_aluno || "").trim() === String(aluno.nome || "").trim());
  if (!matchPorEmail && !matchPorNome) throw new AppError("FORBIDDEN", "Esse aluno não pertence à sua família.");

  // LIMITE: max autorizações ativas por aluno (configurável em escola_config)
  const { data: cfgRows } = await ctx.sb.from("escola_config")
    .select("chave, valor").eq("escola_id", escolaId).eq("chave", "max_autorizados_por_aluno");
  const maxAutorizados = Number(cfgRows?.[0]?.valor ?? 10) || 10;
  const { count: ativosCount } = await ctx.sb.from("acesso_permissoes_retirada")
    .select("id", { count: "exact", head: true })
    .eq("aluno_id", aluno_id)
    .eq("autorizado", true);
  if ((ativosCount ?? 0) >= maxAutorizados) {
    throw new AppError("VALIDATION_FAILED", `Limite de ${maxAutorizados} autorizações ativas atingido para esse aluno. Revogue alguma antes de adicionar.`);
  }

  // Anti-duplicação: bloqueia se já existe autorização ativa com mesmo CPF + aluno
  const { data: dupCheck } = await ctx.sb.from("acesso_permissoes_retirada")
    .select("id").eq("aluno_id", aluno_id).eq("autorizado", true)
    .eq("responsavel_cpf", cpfDigits).maybeSingle();
  if (dupCheck?.id) {
    throw new AppError("VALIDATION_FAILED", "Já existe uma autorização ativa para essa pessoa. Revogue antes de criar nova.");
  }

  // Cria autorização
  const responsavel_id = crypto.randomUUID();
  const { data: perm, error } = await ctx.sb.from("acesso_permissoes_retirada").insert({
    escola_id: escolaId,
    aluno_id,
    aluno_nome: aluno.nome,
    responsavel_id,
    responsavel_nome,
    responsavel_email,
    responsavel_cpf: cpfDigits,
    parentesco: parentesco || "outro",
    validade: validade || null,
    autorizado: true,
    autorizado_por: `Pai/Mãe (${email})`,
    criado_por_familia: true,
    criado_por_pai_email: email,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);

  // Gera link + envia email automaticamente
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  await ctx.sb.from("acesso_cadastro_tokens").insert({
    escola_id: escolaId,
    token,
    pessoa_tipo: "responsavel",
    pessoa_id: responsavel_id,
    pessoa_nome: responsavel_nome,
    email: responsavel_email,
    gerado_por: `pai:${email}`,
    expira_em: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  });

  const appUrl = Deno.env.get("APP_URL") || "https://maplebearcaxias.lumied.com.br";
  const link = `${appUrl}/cadastro-face.html?token=${token}`;

  // Envia email
  let emailSent = false; let emailReason: string | null = null;
  try {
    const sendUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`;
    const sr = await fetch(sendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        tipo: "cadastro_face",
        escola_id: escolaId,
        to: responsavel_email,
        pessoa_nome: responsavel_nome,
        pessoa_tipo: "responsavel",
        link,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const sb: Any = await sr.json().catch(() => ({}));
    emailSent = !!sb?.sent;
    if (!emailSent) emailReason = sb?.reason || `HTTP ${sr.status}`;
  } catch (e) { emailReason = String(e); }

  // Fire-and-forget: notifica a secretaria/gerente
  try {
    const sendUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`;
    fetch(sendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        tipo: "notif_pai_autorizou",
        escola_id: escolaId,
        aluno_nome: aluno.nome,
        responsavel_nome,
        responsavel_cpf: cpfDigits,
        responsavel_email,
        parentesco: parentesco || "outro",
        validade,
        pai_email: email,
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch((e) => console.warn("[notif_pai_autorizou] Falhou:", String(e)));
  } catch (_) { /* ignore */ }

  return successResponse({ ok: true, permissao_id: perm.id, responsavel_id, link, email_enviado: emailSent, email_reason: emailReason });
});

// ─── Revoga autorização (pelo pai, somente se ele criou)
router.on("acesso_pai_autorizar_revogar", async (ctx) => {
  const email = await getAuthenticatedPaiEmail(ctx);
  const { id } = ctx.body as Any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");

  const { data: perm } = await ctx.sb.from("acesso_permissoes_retirada")
    .select("id, criado_por_pai_email, autorizado, responsavel_id, escola_id").eq("id", id).maybeSingle();
  if (!perm) throw new AppError("NOT_FOUND", "Autorização não encontrada.");
  if (perm.criado_por_pai_email !== email) {
    throw new AppError("FORBIDDEN", "Você só pode revogar autorizações criadas por você. Outras devem ser revogadas pela escola.");
  }

  await ctx.sb.from("acesso_permissoes_retirada").update({ autorizado: false }).eq("id", id);

  // Se o responsável NÃO tiver mais nenhuma autorização ativa, marca face pra remoção
  if (perm.responsavel_id) {
    const { count: outrasAtivas } = await ctx.sb.from("acesso_permissoes_retirada")
      .select("id", { count: "exact", head: true })
      .eq("responsavel_id", perm.responsavel_id)
      .eq("autorizado", true);
    if ((outrasAtivas ?? 0) === 0) {
      await ctx.sb.from("acesso_faces").update({
        sync_status: "aguardando_remocao",
        atualizado_em: new Date().toISOString(),
      })
        .eq("escola_id", perm.escola_id)
        .eq("pessoa_tipo", "responsavel")
        .eq("pessoa_id", perm.responsavel_id)
        .eq("ativo", true);
    }
  }

  return successResponse({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  Worker: processa fila de remoção de faces (cron a cada 15min)
// ═══════════════════════════════════════════════════════════════

router.on("acesso_processar_remocoes_face", async (ctx) => {
  // Auth: cron internal key OU service role
  const auth = ctx.req.headers.get("authorization") || ctx.req.headers.get("Authorization") || "";
  const cronKey = Deno.env.get("CRON_INTERNAL_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const tk = m ? m[1].trim() : "";
  const valid = (cronKey && tk === cronKey) || (serviceKey && tk === serviceKey);
  if (!valid) throw new AppError("AUTH_INVALID", "Internal call only.");

  const { data: faces } = await ctx.sb.from("acesso_faces")
    .select("id, escola_id, device_user_id, pessoa_nome, pessoa_id")
    .eq("sync_status", "aguardando_remocao")
    .eq("ativo", true)
    .limit(50);

  if (!faces?.length) return successResponse({ processadas: 0, ok: 0, err: 0 });

  // Cache devices por escola
  const devicesByEscola = new Map<string, Any[]>();
  let okCount = 0; let errCount = 0;
  const erros: Any[] = [];

  for (const f of faces) {
    let devices = devicesByEscola.get(f.escola_id);
    if (!devices) {
      const { data: ds } = await ctx.sb.from("acesso_dispositivos")
        .select("*").eq("escola_id", f.escola_id).eq("ativo", true);
      devices = ds || [];
      devicesByEscola.set(f.escola_id, devices);
    }

    let allOk = true;
    const devResults: Any[] = [];
    for (const dev of devices) {
      try {
        const r = await deviceUnregisterUser(ctx.sb, dev, f.device_user_id);
        if (!r.ok) { allOk = false; devResults.push({ device: dev.nome, ok: false, error: r.error || `HTTP ${r.status}` }); }
        else devResults.push({ device: dev.nome, ok: true });
      } catch (e) {
        allOk = false; devResults.push({ device: dev.nome, ok: false, error: String(e) });
      }
    }

    if (allOk) {
      await ctx.sb.from("acesso_faces").update({
        sync_status: "removido",
        ativo: false,
        sync_erro: null,
        atualizado_em: new Date().toISOString(),
      }).eq("id", f.id);
      okCount++;
    } else {
      await ctx.sb.from("acesso_faces").update({
        sync_erro: devResults.filter((r: Any) => !r.ok).map((r: Any) => `${r.device}: ${r.error}`).join("; "),
        atualizado_em: new Date().toISOString(),
      }).eq("id", f.id);
      errCount++;
      erros.push({ face_id: f.id, devices: devResults });
    }
  }

  return successResponse({ processadas: faces.length, ok: okCount, err: errCount, erros: erros.slice(0, 5) });
});

// ═══════════════════════════════════════════════════════════════
//  Validação de qualidade de foto (Control iD)
// ═══════════════════════════════════════════════════════════════

/** Valida qualidade da foto usando o primeiro dispositivo ativo (prefere não-bridge para evitar latência) */
async function validarQualidadeFoto(
  sb: ReturnType<typeof createClient>,
  fotoBinary: Uint8Array,
): Promise<{ ok: boolean; scores: Any; errors: string[] }> {
  const { data: devices } = await sb.from("acesso_dispositivos").select("*").eq("ativo", true);
  if (!devices?.length) {
    return { ok: true, scores: null, errors: ["Nenhum dispositivo ativo para validação. Foto salva sem validação."] };
  }
  // Prefere dispositivo direto; se só houver via_bridge, ignora validação (iDFace test_image
  // não é um comando padrão do bridge — daemon não suporta atualmente).
  const dev = devices.find((d: Any) => !d.via_bridge);
  if (!dev) {
    return { ok: true, scores: null, errors: ["Apenas dispositivos via bridge — validação de qualidade pulada."] };
  }
  try {
    const session = await getDeviceSession(sb, dev);
    const res = await deviceFetch(dev.ip, dev.porta, `/user_test_image.fcgi?session=${session}`, {
      method: "POST", body: fotoBinary,
    });
    const data = await res.json();
    if (data.success === false || data.error) {
      const erros: string[] = [];
      for (const e of data.errors || []) {
        switch (e.code) {
          case 2: erros.push("Nenhum rosto detectado na foto."); break;
          case 4: erros.push("Rosto não está centralizado."); break;
          case 5: erros.push("Rosto muito longe — aproxime-se da câmera."); break;
          case 6: erros.push("Rosto muito perto — afaste-se da câmera."); break;
          case 7: erros.push("Pose inadequada — olhe diretamente para a câmera."); break;
          case 8: erros.push("Foto sem nitidez — melhore a iluminação."); break;
          case 9: erros.push("Rosto muito perto da borda da foto."); break;
          default: erros.push(e.message || `Erro de qualidade (código ${e.code}).`);
        }
      }
      return { ok: false, scores: data.scores || null, errors: erros };
    }
    return { ok: true, scores: data.scores || null, errors: [] };
  } catch (err) {
    return { ok: true, scores: null, errors: ["Dispositivo offline — foto salva sem validação de qualidade."] };
  }
}

// ═══════════════════════════════════════════════════════════════
//  Validar foto (action pública para preview de qualidade)
// ═══════════════════════════════════════════════════════════════

router.on("acesso_validar_foto", async (ctx) => {
  const { foto } = ctx.body as Any;
  if (!foto) throw new AppError("VALIDATION_FAILED", "foto (base64) é obrigatória.");
  const raw = atob(foto.replace(/^data:image\/\w+;base64,/, ""));
  const binary = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) binary[i] = raw.charCodeAt(i);
  if (binary.length > 2 * 1024 * 1024) throw new AppError("VALIDATION_FAILED", "Foto deve ter no máximo 2MB.");
  const result = await validarQualidadeFoto(ctx.sb, binary);
  return successResponse(result);
});

// ═══════════════════════════════════════════════════════════════
//  Cadastro de face PÚBLICO (link para famílias)
// ═══════════════════════════════════════════════════════════════

// ─── acesso_cadastro_token_info: retorna info do token sem consumir ───
//     Sem auth — usado pela página pública pra mostrar nome da pessoa
router.on("acesso_cadastro_token_info", async (ctx) => {
  const { token_cadastro } = ctx.body as Any;
  if (!token_cadastro || typeof token_cadastro !== "string") {
    throw new AppError("VALIDATION_FAILED", "token_cadastro obrigatório.");
  }
  if (!/^[a-f0-9]{32,128}$/i.test(token_cadastro)) {
    throw new AppError("AUTH_INVALID", "Token inválido.");
  }

  const { data: tk } = await ctx.sb.from("acesso_cadastro_tokens")
    .select("pessoa_tipo, pessoa_nome, expira_em, usado, escola_id")
    .eq("token", token_cadastro).maybeSingle();
  if (!tk) throw new AppError("AUTH_INVALID", "Link inválido ou já utilizado.");
  if (tk.usado) throw new AppError("AUTH_INVALID", "Este link já foi utilizado.");
  if (tk.expira_em && new Date(tk.expira_em) < new Date()) {
    throw new AppError("AUTH_EXPIRED", "Link expirado. Solicite um novo à escola.");
  }

  // Branding da escola
  let escolaNome = "Lumied";
  let escolaIcone = "🎓";
  let corPrimaria = "#C8102E";
  if (tk.escola_id) {
    const { data: cfgRows } = await ctx.sb.from("escola_config")
      .select("chave, valor").eq("escola_id", tk.escola_id);
    const cfg: Any = {};
    for (const r of cfgRows ?? []) cfg[r.chave] = r.valor;
    escolaNome = cfg.escola_nome || escolaNome;
    escolaIcone = cfg.escola_icone || escolaIcone;
    corPrimaria = cfg.cor_primaria || corPrimaria;
  }

  return successResponse({
    pessoa_nome: tk.pessoa_nome,
    pessoa_tipo: tk.pessoa_tipo,
    expira_em: tk.expira_em,
    escola_nome: escolaNome,
    escola_icone: escolaIcone,
    cor_primaria: corPrimaria,
  });
});

router.on("acesso_face_cadastro_publico", async (ctx) => {
  const { token_cadastro, pessoa_nome, foto } = ctx.body as Any;
  if (!token_cadastro || !foto) throw new AppError("VALIDATION_FAILED", "token_cadastro e foto são obrigatórios.");

  // Validar token
  const { data: tk } = await ctx.sb
    .from("acesso_cadastro_tokens")
    .select("*")
    .eq("token", token_cadastro)
    .eq("usado", false)
    .maybeSingle();

  if (!tk) throw new AppError("AUTH_INVALID", "Link inválido ou já utilizado.");
  if (tk.expira_em && new Date(tk.expira_em) < new Date()) throw new AppError("AUTH_EXPIRED", "Link expirado.");

  // Processar foto
  const raw = atob(foto.replace(/^data:image\/\w+;base64,/, ""));
  const binary = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) binary[i] = raw.charCodeAt(i);
  if (binary.length > 2 * 1024 * 1024) throw new AppError("VALIDATION_FAILED", "Foto deve ter no máximo 2MB.");

  // Validar qualidade
  const qualidade = await validarQualidadeFoto(ctx.sb, binary);
  if (!qualidade.ok) {
    return successResponse({ ok: false, qualidade_erros: qualidade.errors, scores: qualidade.scores });
  }

  // Salvar foto no storage (bucket privado)
  const path = `acesso/faces/${tk.pessoa_id}_${Date.now()}.jpg`;
  await ctx.sb.storage.from("wa-documentos").upload(path, binary, { contentType: "image/jpeg", upsert: true });
  const { data: signed } = await ctx.sb.storage.from("wa-documentos").createSignedUrl(path, 60 * 60 * 24 * 7);
  const fotoUrl = signed?.signedUrl || null;

  const deviceUserId = uuidToDeviceId(tk.pessoa_id);

  // Resolve escola_id from token record or request origin
  const publicEscolaId = tk.escola_id || await resolveEscolaId(ctx.req, ctx.sb, null, ctx.body);
  if (!publicEscolaId) throw new AppError("BAD_REQUEST", "Não foi possível determinar a escola.");

  // Criar/atualizar face com status 'aguardando_aprovacao'
  const { data: existing } = await ctx.sb
    .from("acesso_faces")
    .select("id")
    .eq("escola_id", publicEscolaId)
    .eq("pessoa_tipo", tk.pessoa_tipo)
    .eq("pessoa_id", tk.pessoa_id)
    .maybeSingle();

  if (existing) {
    await ctx.sb.from("acesso_faces").update({
      pessoa_nome: pessoa_nome || tk.pessoa_nome,
      foto_url: fotoUrl,
      device_user_id: deviceUserId,
      sync_status: "aguardando_aprovacao",
      atualizado_em: new Date().toISOString(),
    }).eq("id", existing.id).eq("escola_id", publicEscolaId);
  } else {
    await ctx.sb.from("acesso_faces").insert({
      escola_id: publicEscolaId,
      pessoa_tipo: tk.pessoa_tipo,
      pessoa_id: tk.pessoa_id,
      pessoa_nome: pessoa_nome || tk.pessoa_nome,
      foto_url: fotoUrl,
      device_user_id: deviceUserId,
      sync_status: "aguardando_aprovacao",
    });
  }

  // Marcar token como usado
  await ctx.sb.from("acesso_cadastro_tokens").update({ usado: true, usado_em: new Date().toISOString() }).eq("id", tk.id);

  return successResponse({ ok: true, qualidade_erros: qualidade.errors, mensagem: "Foto enviada! Aguarde aprovação da escola." });
});

// ═══════════════════════════════════════════════════════════════
//  Gerar link de cadastro (gerente cria link para família)
// ═══════════════════════════════════════════════════════════════

router.on("acesso_gerar_link_cadastro", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { pessoa_tipo, pessoa_id, pessoa_nome, email } = ctx.body as Any;
  if (!pessoa_tipo || !pessoa_id || !pessoa_nome) {
    throw new AppError("VALIDATION_FAILED", "pessoa_tipo, pessoa_id e pessoa_nome são obrigatórios.");
  }

  // Gerar token único
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  const { data, error } = await ctx.sb.from("acesso_cadastro_tokens").insert({
    escola_id: ctx.escola_id,
    token,
    pessoa_tipo,
    pessoa_id,
    pessoa_nome,
    email: email || null,
    gerado_por: ctx.user?.nome || "sistema",
    expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 dias
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);

  const appUrl = Deno.env.get("APP_URL") || "https://maplebearcaxias.lumied.com.br";
  const link = `${appUrl}/cadastro-face.html?token=${token}`;

  return successResponse({ token, link, expira_em: data.expira_em });
});

// ═══════════════════════════════════════════════════════════════
//  Status de responsáveis por aluno (slots: 1 obrigatório + 2 opc)
// ═══════════════════════════════════════════════════════════════

router.on("acesso_alunos_responsaveis_status", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { busca } = ctx.body as Any;

  let aq = ctx.sb.from("alunos")
    .select("id, nome, serie_id, familia_email, email")
    .eq("escola_id", ctx.escola_id).eq("ativo", true)
    .order("nome");
  if (busca && String(busca).trim().length >= 2) {
    aq = aq.ilike("nome", `%${String(busca).trim()}%`);
  }
  aq = aq.limit(busca ? 100 : 200);
  const { data: alunos } = await aq;
  if (!alunos?.length) {
    return successResponse({ alunos: [], total: 0, com_min_obrigatorio: 0, min_responsaveis: 1, recomendado: 3 });
  }

  const alunoIds = alunos.map((a: Any) => a.id);

  // Autorizados de retirada (responsáveis cadastrados pelo gerente)
  const { data: perms } = await ctx.sb.from("acesso_permissoes_retirada")
    .select("id, aluno_id, responsavel_id, responsavel_nome, responsavel_email, responsavel_foto_url, parentesco, validade")
    .eq("escola_id", ctx.escola_id)
    .in("aluno_id", alunoIds)
    .eq("autorizado", true)
    .order("criado_em", { ascending: true });

  // Faces cadastradas (com sync_status — pra mostrar pendente/aprovado/erro)
  const responsavelIds = (perms ?? []).map((p: Any) => p.responsavel_id).filter((x: Any) => x);
  let facesByPid = new Map<string, Any>();
  if (responsavelIds.length) {
    const { data: faces } = await ctx.sb.from("acesso_faces")
      .select("pessoa_id, sync_status, atualizado_em")
      .eq("escola_id", ctx.escola_id).eq("ativo", true).eq("pessoa_tipo", "responsavel")
      .in("pessoa_id", responsavelIds);
    for (const f of faces ?? []) facesByPid.set(f.pessoa_id, f);
  }

  // Tokens ativos (link enviado, ainda não usado, não expirou) por responsavel_id
  const { data: tokens } = await ctx.sb.from("acesso_cadastro_tokens")
    .select("pessoa_id, criado_em, expira_em, usado")
    .eq("escola_id", ctx.escola_id).eq("pessoa_tipo", "responsavel");
  const tokenByPid = new Map<string, Any>();
  for (const t of tokens ?? []) {
    const cur = tokenByPid.get(t.pessoa_id);
    if (!cur || new Date(t.criado_em) > new Date(cur.criado_em)) tokenByPid.set(t.pessoa_id, t);
  }

  // Agrupa por aluno
  const permsByAluno = new Map<string, Any[]>();
  for (const p of perms ?? []) {
    const list = permsByAluno.get(p.aluno_id) || [];
    list.push(p);
    permsByAluno.set(p.aluno_id, list);
  }

  const min = 1;       // obrigatório
  const recomendado = 3; // 1 + 2 opcionais

  const alunosOut = alunos.map((a: Any) => {
    const responsaveis = (permsByAluno.get(a.id) || []).map((p: Any) => {
      const face = p.responsavel_id ? facesByPid.get(p.responsavel_id) : null;
      const tk = p.responsavel_id ? tokenByPid.get(p.responsavel_id) : null;
      const linkAtivo = tk && !tk.usado && new Date(tk.expira_em) > new Date();
      let face_status: "cadastrada" | "aguardando_aprovacao" | "erro" | "link_enviado" | "sem_face" = "sem_face";
      if (face) {
        if (face.sync_status === "sincronizado") face_status = "cadastrada";
        else if (face.sync_status === "aguardando_aprovacao") face_status = "aguardando_aprovacao";
        else if (face.sync_status === "erro") face_status = "erro";
        else face_status = "cadastrada";
      } else if (linkAtivo) face_status = "link_enviado";
      return {
        id: p.id,
        responsavel_id: p.responsavel_id,
        nome: p.responsavel_nome,
        email: p.responsavel_email,
        parentesco: p.parentesco,
        foto_url: p.responsavel_foto_url,
        validade: p.validade,
        face_status,
        link_expira_em: linkAtivo ? tk.expira_em : null,
      };
    });
    const cadastrados = responsaveis.filter((r: Any) => r.face_status === "cadastrada" || r.face_status === "aguardando_aprovacao").length;
    return {
      id: a.id,
      nome: a.nome,
      familia_email: a.familia_email || a.email || null,
      responsaveis,
      slots_preenchidos: responsaveis.length,
      faces_ok: cadastrados,
      atende_minimo: cadastrados >= min,
      atende_recomendado: cadastrados >= recomendado,
    };
  });

  const comMin = alunosOut.filter((a: Any) => a.atende_minimo).length;

  return successResponse({
    alunos: alunosOut,
    total: alunos.length,
    com_min_obrigatorio: comMin,
    min_responsaveis: min,
    recomendado,
  });
});

// ═══════════════════════════════════════════════════════════════
//  Cadastrar responsável + opcionalmente já gerar link de face
// ═══════════════════════════════════════════════════════════════

router.on("acesso_responsavel_create", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { aluno_id, responsavel_nome, parentesco, responsavel_email, validade, gerar_link } = ctx.body as Any;
  if (!aluno_id || !responsavel_nome) {
    throw new AppError("VALIDATION_FAILED", "aluno_id e responsavel_nome são obrigatórios.");
  }
  const { data: aluno } = await ctx.sb.from("alunos").select("id, nome").eq("id", aluno_id).eq("escola_id", ctx.escola_id).maybeSingle();
  if (!aluno) throw new AppError("NOT_FOUND", "Aluno não encontrado.");

  const responsavel_id = crypto.randomUUID();
  const { data: perm, error } = await ctx.sb.from("acesso_permissoes_retirada").insert({
    escola_id: ctx.escola_id,
    aluno_id,
    aluno_nome: aluno.nome,
    responsavel_id,
    responsavel_nome,
    responsavel_email: responsavel_email || null,
    parentesco: parentesco || null,
    validade: validade || null,
    autorizado: true,
    autorizado_por: ctx.user?.nome || "Gerente",
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);

  let linkData: Any = null;
  if (gerar_link) {
    const innerCtx: Any = { ...ctx, body: { pessoa_tipo: "responsavel", pessoa_id: responsavel_id, pessoa_nome: responsavel_nome, email: responsavel_email } };
    const lr: Any = await router.dispatch("acesso_gerar_link_cadastro", innerCtx);
    try { const j = await lr.json(); linkData = j?.data || j; } catch (_) { /* */ }
  }

  return successResponse({ permissao: perm, responsavel_id, link: linkData });
});

// ═══════════════════════════════════════════════════════════════
//  Pendências de cadastro facial — alunos sem face cadastrada
// ═══════════════════════════════════════════════════════════════

router.on("acesso_pendencias_face", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");

  const { data: alunos } = await ctx.sb.from("alunos")
    .select("id, nome, serie_id, familia_email, email")
    .eq("escola_id", ctx.escola_id).eq("ativo", true)
    .order("nome");

  const alunoIds = (alunos ?? []).map((a: Any) => a.id);
  let comFace = new Set<string>();
  if (alunoIds.length) {
    const { data: faces } = await ctx.sb.from("acesso_faces")
      .select("pessoa_id, sync_status")
      .eq("escola_id", ctx.escola_id).eq("ativo", true).eq("pessoa_tipo", "aluno")
      .in("pessoa_id", alunoIds);
    comFace = new Set((faces ?? []).map((f: Any) => f.pessoa_id));
  }

  // Tokens já enviados (não consumidos, não expirados) — pra exibir "Já enviado"
  const { data: tokens } = await ctx.sb.from("acesso_cadastro_tokens")
    .select("pessoa_id, criado_em, expira_em, usado")
    .eq("escola_id", ctx.escola_id).eq("pessoa_tipo", "aluno");
  const tokenByAluno = new Map<string, Any>();
  for (const t of tokens ?? []) {
    const cur = tokenByAluno.get(t.pessoa_id);
    if (!cur || new Date(t.criado_em) > new Date(cur.criado_em)) tokenByAluno.set(t.pessoa_id, t);
  }

  // Whatsapp do responsável via wa_familias (matching por aluno_nome)
  const { data: waFams } = await ctx.sb.from("wa_familias")
    .select("aluno_nome, whatsapp, opt_in")
    .eq("escola_id", ctx.escola_id);
  const waByNome = new Map<string, string>();
  for (const w of waFams ?? []) {
    if (w.aluno_nome && w.whatsapp) waByNome.set(String(w.aluno_nome).toLowerCase().trim(), w.whatsapp);
  }

  const pendentes = (alunos ?? []).filter((a: Any) => !comFace.has(a.id)).map((a: Any) => {
    const tk = tokenByAluno.get(a.id);
    const linkAtivo = tk && !tk.usado && new Date(tk.expira_em) > new Date();
    return {
      id: a.id,
      nome: a.nome,
      email: a.familia_email || a.email || null,
      whatsapp: waByNome.get(String(a.nome || "").toLowerCase().trim()) || null,
      tem_link_ativo: !!linkAtivo,
      link_expira_em: linkAtivo ? tk.expira_em : null,
    };
  });

  return successResponse({
    total_alunos: alunos?.length || 0,
    com_face: comFace.size,
    pendentes,
  });
});

// ═══════════════════════════════════════════════════════════════
//  Envio do link por email (Resend via send-email)
// ═══════════════════════════════════════════════════════════════

router.on("acesso_enviar_link_email", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { pessoa_tipo, pessoa_id, pessoa_nome, email } = ctx.body as Any;
  if (!pessoa_tipo || !pessoa_id || !pessoa_nome || !email) {
    throw new AppError("VALIDATION_FAILED", "pessoa_tipo, pessoa_id, pessoa_nome e email são obrigatórios.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("VALIDATION_FAILED", "Email inválido.");
  }

  // Reutiliza acesso_gerar_link_cadastro internamente
  const innerCtx: Any = { ...ctx, body: { pessoa_tipo, pessoa_id, pessoa_nome, email } };
  const linkRes: Any = await router.dispatch("acesso_gerar_link_cadastro", innerCtx);
  let linkData: Any = null;
  try { linkData = await linkRes.json(); } catch (_) { /* ignore */ }
  const link = linkData?.data?.link || linkData?.link;
  if (!link) throw new AppError("BAD_REQUEST", "Não consegui gerar o link.");

  // Chama send-email com tipo='cadastro_face'
  const sendUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`;
  const r = await fetch(sendUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      tipo: "cadastro_face",
      escola_id: ctx.escola_id,
      to: email,
      pessoa_nome,
      pessoa_tipo,
      link,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const sendBody: Any = await r.json().catch(() => ({}));
  if (!r.ok || sendBody?.sent === false) {
    return successResponse({ ok: false, link, sent: false, reason: sendBody?.reason || `HTTP ${r.status}` });
  }
  return successResponse({ ok: true, link, sent: true });
});

// ═══════════════════════════════════════════════════════════════
//  WhatsApp helper — retorna URL wa.me e telefone do responsável
// ═══════════════════════════════════════════════════════════════

router.on("acesso_link_whatsapp_info", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { pessoa_tipo, pessoa_id, pessoa_nome, link } = ctx.body as Any;
  if (!pessoa_tipo || !pessoa_id || !pessoa_nome || !link) {
    throw new AppError("VALIDATION_FAILED", "pessoa_tipo, pessoa_id, pessoa_nome e link são obrigatórios.");
  }

  // Buscar telefone via wa_familias (apenas pra alunos)
  let phone: string | null = null;
  if (pessoa_tipo === "aluno") {
    const { data: aluno } = await ctx.sb.from("alunos").select("nome").eq("id", pessoa_id).maybeSingle();
    if (aluno?.nome) {
      const { data: wa } = await ctx.sb.from("wa_familias")
        .select("whatsapp")
        .eq("escola_id", ctx.escola_id)
        .ilike("aluno_nome", aluno.nome)
        .maybeSingle();
      phone = wa?.whatsapp || null;
    }
  }

  // Branding pra mensagem
  const { data: cfgRows } = await ctx.sb.from("escola_config")
    .select("chave, valor").eq("escola_id", ctx.escola_id);
  const cfg: Any = {};
  for (const r of cfgRows ?? []) cfg[r.chave] = r.valor;
  const escolaNome = cfg.escola_nome || "a escola";

  const msg = `Olá! ${escolaNome} preparou um cadastro facial para ${pessoa_nome}. ` +
    `Use o link abaixo (válido por 7 dias) pra enviar uma foto. ` +
    `Tudo é feito do celular, leva menos de 1 minuto:\n\n${link}\n\n` +
    `Dicas: boa iluminação, rosto centralizado, sem óculos escuros ou máscara. ` +
    `Após o envio, a escola revisa e aprova.`;

  const phoneClean = phone ? phone.replace(/[^\d]/g, "") : null;
  const waUrl = phoneClean
    ? `https://wa.me/${phoneClean}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;

  return successResponse({ whatsapp: phone, wa_url: waUrl, mensagem: msg });
});

// ═══════════════════════════════════════════════════════════════
//  Aprovar face cadastrada pela família
// ═══════════════════════════════════════════════════════════════

router.on("acesso_face_aprovar", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id } = ctx.body as Any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");

  const { data: face } = await ctx.sb.from("acesso_faces").select("*").eq("id", id).eq("escola_id", ctx.escola_id).single();
  if (!face) throw new AppError("NOT_FOUND", "Face não encontrada.");

  // Baixar foto do storage para sincronizar
  let fotoBinary: Uint8Array | null = null;
  if (face.foto_url) {
    try {
      const res = await fetch(face.foto_url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) fotoBinary = new Uint8Array(await res.arrayBuffer());
    } catch (e) { console.warn('[acesso] Face photo download failed:', (e as Error).message) }
  }

  // Sincronizar com todos os dispositivos
  const { data: devices } = await ctx.sb.from("acesso_dispositivos").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true);
  const syncResults: Any[] = [];

  for (const dev of devices ?? []) {
    try {
      const userRes = await deviceEnrollUser(ctx.sb, dev, { id: face.device_user_id, name: face.pessoa_nome, registration: face.pessoa_id });
      if (!userRes.ok) {
        syncResults.push({ device: dev.nome, ok: false, error: userRes.error || `enroll_user HTTP ${userRes.status}` });
        continue;
      }
      if (fotoBinary) {
        const r = await deviceSetFaceImage(ctx.sb, dev, face.device_user_id, fotoBinary);
        if (!r.ok) {
          syncResults.push({ device: dev.nome, ok: false, error: r.error || `set_image HTTP ${r.status}` });
          continue;
        }
      }
      syncResults.push({ device: dev.nome, ok: true });
    } catch (err) {
      syncResults.push({ device: dev.nome, ok: false, error: String(err) });
    }
  }

  const allOk = syncResults.every(r => r.ok);
  await ctx.sb.from("acesso_faces").update({
    sync_status: allOk ? "sincronizado" : "erro",
    sync_erro: allOk ? null : syncResults.filter(r => !r.ok).map(r => `${r.device}: ${r.error}`).join("; "),
    atualizado_em: new Date().toISOString(),
  }).eq("id", id).eq("escola_id", ctx.escola_id);

  return successResponse({ aprovado: true, sync: syncResults });
});

// ═══════════════════════════════════════════════════════════════
//  UI ALIASES + ACTIONS QUE FALTAVAM
//  (mapeiam nomes que a UI já chama → handlers existentes ou novos)
// ═══════════════════════════════════════════════════════════════

// Helper: faz upload base64 → storage e retorna URL pública.
async function uploadBase64Photo(sb: Any, base64: string, prefix: string): Promise<string | null> {
  if (!base64) return null;
  try {
    const raw = atob(String(base64).replace(/^data:image\/\w+;base64,/, ""));
    const bin = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
    if (bin.length > 2 * 1024 * 1024) throw new AppError("VALIDATION_FAILED", "Foto deve ter no máximo 2MB.");
    const path = `acesso/${prefix}/${Date.now()}_${crypto.randomUUID()}.jpg`;
    const { error } = await sb.storage.from("wa-documentos").upload(path, bin, { contentType: "image/jpeg", upsert: true });
    if (error) return null;
    const { data: signed } = await sb.storage.from("wa-documentos").createSignedUrl(path, 60 * 60 * 24 * 7);
    return signed?.signedUrl || null;
  } catch (_) {
    return null;
  }
}

// ─── Buscar pessoa (alunos / responsaveis / funcionarios) ───────
router.on("acesso_buscar_pessoa", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { tipo, busca } = ctx.body as Any;
  const term = String(busca || "").trim();
  if (term.length < 2) return successResponse([]);

  const like = `%${term}%`;

  if (tipo === "aluno") {
    const { data } = await ctx.sb.from("alunos")
      .select("id, nome, serie")
      .eq("escola_id", ctx.escola_id)
      .eq("ativo", true)
      .ilike("nome", like)
      .order("nome")
      .limit(20);
    return successResponse(data ?? []);
  }

  if (tipo === "responsavel") {
    // Responsáveis não têm UUID em `familias` (PK é CPF). Para cadastro de
    // face de responsável, use o fluxo de link público (acesso_gerar_link_cadastro).
    // Aqui retornamos apenas responsáveis JÁ cadastrados em acesso_faces — útil
    // para re-cadastro / atualização de foto.
    const { data } = await ctx.sb.from("acesso_faces")
      .select("pessoa_id, pessoa_nome")
      .eq("escola_id", ctx.escola_id)
      .eq("pessoa_tipo", "responsavel")
      .eq("ativo", true)
      .ilike("pessoa_nome", like)
      .order("pessoa_nome")
      .limit(20);
    return successResponse((data ?? []).map((f: Any) => ({ id: f.pessoa_id, nome: f.pessoa_nome })));
  }

  if (tipo === "funcionario") {
    const { data } = await ctx.sb.from("usuarios")
      .select("id, nome, email, papeis")
      .eq("escola_id", ctx.escola_id)
      .eq("ativo", true)
      .ilike("nome", like)
      .order("nome")
      .limit(20);
    return successResponse(data ?? []);
  }

  throw new AppError("VALIDATION_FAILED", "tipo deve ser 'aluno', 'responsavel' ou 'funcionario'.");
});

// ─── acesso_face_create: gerente cadastra face direto (alias com mapeamento) ───
router.on("acesso_face_create", authGerente, async (ctx) => {
  const { pessoa_id, pessoa_tipo, foto_base64, foto, pessoa_nome: nomeOverride } = ctx.body as Any;
  if (!pessoa_id || !pessoa_tipo) {
    throw new AppError("VALIDATION_FAILED", "pessoa_id e pessoa_tipo são obrigatórios.");
  }

  // Resolve pessoa_nome se não veio
  let pessoa_nome = nomeOverride || null;
  if (!pessoa_nome) {
    if (pessoa_tipo === "aluno") {
      const { data } = await ctx.sb.from("alunos").select("nome").eq("id", pessoa_id).maybeSingle();
      pessoa_nome = data?.nome || null;
    } else if (pessoa_tipo === "responsavel") {
      // Responsáveis vivem em acesso_faces (UUID gerado pelo link público).
      const { data } = await ctx.sb.from("acesso_faces").select("pessoa_nome").eq("pessoa_id", pessoa_id).eq("pessoa_tipo", "responsavel").maybeSingle();
      pessoa_nome = data?.pessoa_nome || null;
    } else if (pessoa_tipo === "funcionario") {
      const { data } = await ctx.sb.from("usuarios").select("nome").eq("id", pessoa_id).maybeSingle();
      pessoa_nome = data?.nome || null;
    }
  }
  if (!pessoa_nome) throw new AppError("NOT_FOUND", "Pessoa não encontrada.");

  // Re-injeta no body com nomes esperados por acesso_face_cadastrar e dispatcha
  (ctx.body as Any).pessoa_nome = pessoa_nome;
  (ctx.body as Any).foto = foto || foto_base64 || null;
  return router.dispatch("acesso_face_cadastrar", ctx);
});

// ─── acesso_dispositivo_create: alias para _save (UI usa _create) ───
router.on("acesso_dispositivo_create", authGerente, async (ctx) => {
  return router.dispatch("acesso_dispositivo_save", ctx);
});

// ─── acesso_dispositivo_sync_faces: sincroniza todas faces para UM dispositivo ───
router.on("acesso_dispositivo_sync_faces", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id } = ctx.body as Any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");

  const { data: device } = await ctx.sb.from("acesso_dispositivos")
    .select("*")
    .eq("id", id)
    .eq("escola_id", ctx.escola_id)
    .maybeSingle();
  if (!device) throw new AppError("NOT_FOUND", "Dispositivo não encontrado.");

  const { data: faces } = await ctx.sb.from("acesso_faces").select("*")
    .eq("escola_id", ctx.escola_id).eq("ativo", true).neq("sync_status", "aguardando_aprovacao");
  if (!faces?.length) return successResponse({ synced: 0, message: "Nenhuma face sincronizável." });

  let okCount = 0;
  let errCount = 0;
  const errors: string[] = [];

  try {
    const users = faces.map((f: Any) => ({ id: f.device_user_id, name: f.pessoa_nome, registration: f.pessoa_id }));
    const usersRes = await deviceEnrollUsers(ctx.sb, device, users);
    if (!usersRes.ok) {
      return successResponse({ ok: false, error: usersRes.error || `enroll_user HTTP ${usersRes.status}` });
    }

    for (const face of faces) {
      if (!face.foto_url) continue;
      try {
        const photoRes = await fetch(face.foto_url, { signal: AbortSignal.timeout(5000) });
        if (!photoRes.ok) { errCount++; continue; }
        const bytes = new Uint8Array(await photoRes.arrayBuffer());
        const r = await deviceSetFaceImage(ctx.sb, device, face.device_user_id, bytes);
        if (r.ok) okCount++; else { errCount++; errors.push(`${face.pessoa_nome}: ${r.error || `HTTP ${r.status}`}`); }
      } catch (err) {
        errCount++;
        errors.push(`${face.pessoa_nome}: ${String(err)}`);
      }
    }
  } catch (err) {
    return successResponse({ ok: false, error: err instanceof AppError ? err.message : String(err) });
  }

  return successResponse({ ok: true, device_nome: device.nome, sincronizadas: okCount, erros: errCount, detalhes: errors });
});

// ─── acesso_sync_all_faces: alias para _face_sync_all ───
router.on("acesso_sync_all_faces", authGerente, async (ctx) => {
  return router.dispatch("acesso_face_sync_all", ctx);
});

// ─── acesso_rfid_create: alias para _rfid_cadastrar com lookup de nome ───
router.on("acesso_rfid_create", authGerente, async (ctx) => {
  const { pessoa_id, pessoa_tipo, pessoa_nome: nomeOverride } = ctx.body as Any;
  let pessoa_nome = nomeOverride || null;
  if (!pessoa_nome && pessoa_id && pessoa_tipo) {
    if (pessoa_tipo === "aluno") {
      const { data } = await ctx.sb.from("alunos").select("nome").eq("id", pessoa_id).maybeSingle();
      pessoa_nome = data?.nome || null;
    } else if (pessoa_tipo === "responsavel") {
      // Responsáveis vivem em acesso_faces (UUID gerado pelo link público).
      const { data } = await ctx.sb.from("acesso_faces").select("pessoa_nome").eq("pessoa_id", pessoa_id).eq("pessoa_tipo", "responsavel").maybeSingle();
      pessoa_nome = data?.pessoa_nome || null;
    } else if (pessoa_tipo === "funcionario") {
      const { data } = await ctx.sb.from("usuarios").select("nome").eq("id", pessoa_id).maybeSingle();
      pessoa_nome = data?.nome || null;
    }
  }
  if (!pessoa_nome) throw new AppError("NOT_FOUND", "Pessoa não encontrada.");
  (ctx.body as Any).pessoa_nome = pessoa_nome;
  return router.dispatch("acesso_rfid_cadastrar", ctx);
});

// ─── acesso_rfid_update: toggle ativo/inativo ───
router.on("acesso_rfid_update", authGerente, async (ctx) => {
  const { id, ativo } = ctx.body as Any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  const { error } = await ctx.sb.from("acesso_rfid").update({ ativo: !!ativo }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ ok: true });
});

// ─── acesso_permissao_create: cria autorizado de retirada com upload de foto ───
router.on("acesso_permissao_create", authGerente, async (ctx) => {
  const { aluno_id, responsavel_nome, parentesco, foto_base64, validade, responsavel_email, responsavel_id } = ctx.body as Any;
  if (!aluno_id || !responsavel_nome) {
    throw new AppError("VALIDATION_FAILED", "aluno_id e responsavel_nome são obrigatórios.");
  }

  // Lookup aluno_nome
  const { data: aluno } = await ctx.sb.from("alunos").select("id, nome").eq("id", aluno_id).maybeSingle();
  if (!aluno) throw new AppError("NOT_FOUND", "Aluno não encontrado.");

  // Upload foto se veio
  const fotoUrl = await uploadBase64Photo(ctx.sb, foto_base64, "autorizados");

  // Re-injeta no body com nomes esperados por acesso_permissao_save
  (ctx.body as Any).aluno_nome = aluno.nome;
  (ctx.body as Any).responsavel_foto_url = fotoUrl;
  if (responsavel_id) (ctx.body as Any).responsavel_id = responsavel_id;
  if (responsavel_email) (ctx.body as Any).responsavel_email = responsavel_email;
  return router.dispatch("acesso_permissao_save", ctx);
});

// ─── acesso_faces_pendentes: lista faces aguardando aprovação ───
router.on("acesso_faces_pendentes", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb.from("acesso_faces")
    .select("*")
    .eq("escola_id", ctx.escola_id)
    .eq("ativo", true)
    .eq("sync_status", "aguardando_aprovacao")
    .order("criado_em", { ascending: false });
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  Setup Face ID — checklist agregado (tudo que precisa pra funcionar)
// ═══════════════════════════════════════════════════════════════

router.on("acesso_setup_checklist", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");

  const eid = ctx.escola_id;

  // 1. Token bridge
  const { data: escola } = await ctx.sb.from("escolas")
    .select("bridge_token, bridge_ultimo_heartbeat, nome")
    .eq("id", eid).maybeSingle();
  const tokenOk = !!escola?.bridge_token;

  // 2. Daemon online (heartbeat < 5min OU gateway diz connected)
  const gw = await bridgeStatus(eid);
  const hbDate = escola?.bridge_ultimo_heartbeat ? new Date(escola.bridge_ultimo_heartbeat) : null;
  const hbFresh = hbDate ? (Date.now() - hbDate.getTime() < 5 * 60 * 1000) : false;
  const daemonOnline = !!gw.connected || hbFresh;

  // 3. Dispositivos cadastrados
  const { data: devices } = await ctx.sb.from("acesso_dispositivos")
    .select("id, nome, ip, porta, tipo, ativo, via_bridge, api_password, ultimo_heartbeat")
    .eq("escola_id", eid).eq("ativo", true);
  const totalDevices = devices?.length || 0;

  // 4. Cada device tem credenciais
  const devicesSemSenha = (devices ?? []).filter((d: Any) => !d.api_password).map((d: Any) => d.nome);
  const credsOk = totalDevices > 0 && devicesSemSenha.length === 0;

  // 5. Cada device alcançável (último heartbeat < 24h ou aceita ping)
  const devicesAlcancaveis = (devices ?? []).filter((d: Any) => {
    if (!d.ultimo_heartbeat) return false;
    return (Date.now() - new Date(d.ultimo_heartbeat).getTime()) < 24 * 3600 * 1000;
  }).length;

  // 6. Faces cadastradas (cobertura de alunos)
  const { count: alunosTotal } = await ctx.sb.from("alunos")
    .select("id", { count: "exact", head: true })
    .eq("escola_id", eid).eq("ativo", true);
  const { count: facesAlunos } = await ctx.sb.from("acesso_faces")
    .select("id", { count: "exact", head: true })
    .eq("escola_id", eid).eq("ativo", true).eq("pessoa_tipo", "aluno");

  // 7. Faces aguardando aprovação
  const { count: facesPendentes } = await ctx.sb.from("acesso_faces")
    .select("id", { count: "exact", head: true })
    .eq("escola_id", eid).eq("ativo", true).eq("sync_status", "aguardando_aprovacao");

  // 8. Permissões de retirada (cada aluno deveria ter pelo menos 1)
  const { count: permissoes } = await ctx.sb.from("acesso_permissoes_retirada")
    .select("id", { count: "exact", head: true })
    .eq("escola_id", eid).eq("autorizado", true);

  // 9. Faces com erro de sync (precisa atenção)
  const { count: facesErro } = await ctx.sb.from("acesso_faces")
    .select("id", { count: "exact", head: true })
    .eq("escola_id", eid).eq("ativo", true).eq("sync_status", "erro");

  // 10. Eventos recentes (sinal de que tá funcionando de verdade)
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: eventos24h } = await ctx.sb.from("acesso_eventos")
    .select("id", { count: "exact", head: true })
    .eq("escola_id", eid).gte("criado_em", since);

  const items = [
    {
      id: "token",
      label: "Token do bridge gerado",
      ok: tokenOk,
      detail: tokenOk ? "Token configurado." : "Sem token. Painel Lumied Bridge → Rotacionar.",
      action: tokenOk ? null : { label: "Gerar token", panel: "acessoBridge" },
      blocking: false, // Só é bloqueante se algum device for via_bridge
      severity: tokenOk ? "ok" : "warn",
    },
    {
      id: "devices_cadastrados",
      label: "Dispositivos iDFace cadastrados",
      ok: totalDevices > 0,
      detail: totalDevices > 0 ? `${totalDevices} dispositivo(s) ativo(s).` : "Nenhum iDFace cadastrado.",
      action: totalDevices > 0 ? null : { label: "Cadastrar dispositivo", panel: "acessoDispositivos" },
      blocking: true,
      severity: totalDevices > 0 ? "ok" : "error",
    },
    {
      id: "creds",
      label: "Credenciais dos iDFace",
      ok: credsOk,
      detail: totalDevices === 0 ? "—" : (credsOk ? "Todos os dispositivos têm senha API configurada." : `Sem senha: ${devicesSemSenha.join(", ")}`),
      action: credsOk ? null : { label: "Configurar credenciais", panel: "acessoDispositivos" },
      blocking: totalDevices > 0,
      severity: credsOk ? "ok" : (totalDevices === 0 ? "muted" : "error"),
    },
    {
      id: "daemon",
      label: "Lumied Bridge daemon conectado",
      ok: daemonOnline,
      detail: daemonOnline
        ? (gw.connected ? "WS ativo no gateway." : `Heartbeat há ${hbDate ? Math.round((Date.now() - hbDate.getTime())/60000) : "?"}min.`)
        : (escola?.bridge_token ? "Token ok mas daemon nunca conectou. Instale na escola." : "Token ainda não foi gerado."),
      action: daemonOnline ? null : { label: "Ver instalação", panel: "acessoBridge" },
      blocking: (devices ?? []).some((d: Any) => d.via_bridge),
      severity: daemonOnline ? "ok" : ((devices ?? []).some((d: Any) => d.via_bridge) ? "error" : "warn"),
    },
    {
      id: "devices_online",
      label: "Dispositivos respondendo",
      ok: totalDevices > 0 && devicesAlcancaveis === totalDevices,
      detail: totalDevices === 0 ? "—" : `${devicesAlcancaveis}/${totalDevices} com heartbeat nas últimas 24h.`,
      action: null,
      blocking: false,
      severity: totalDevices === 0 ? "muted" : (devicesAlcancaveis === totalDevices ? "ok" : (devicesAlcancaveis > 0 ? "warn" : "error")),
    },
    {
      id: "faces",
      label: "Faces cadastradas (alunos)",
      ok: (facesAlunos ?? 0) > 0,
      detail: (alunosTotal ?? 0) === 0 ? "Nenhum aluno ativo." : `${facesAlunos ?? 0} face(s) de ${alunosTotal} aluno(s) ativos. (${alunosTotal ? Math.round(((facesAlunos || 0) / alunosTotal) * 100) : 0}% cobertura)`,
      action: { label: "Cadastrar face", panel: "acessoFaces" },
      blocking: false,
      severity: (facesAlunos ?? 0) === 0 ? "warn" : "ok",
    },
    {
      id: "faces_pendentes",
      label: "Faces aguardando aprovação",
      ok: (facesPendentes ?? 0) === 0,
      detail: (facesPendentes ?? 0) === 0 ? "Nenhuma pendente." : `${facesPendentes} face(s) aguardando você aprovar.`,
      action: (facesPendentes ?? 0) > 0 ? { label: "Revisar", panel: "acessoFaces" } : null,
      blocking: false,
      severity: (facesPendentes ?? 0) === 0 ? "ok" : "warn",
    },
    {
      id: "faces_erro",
      label: "Faces com erro de sync",
      ok: (facesErro ?? 0) === 0,
      detail: (facesErro ?? 0) === 0 ? "Nenhum erro." : `${facesErro} face(s) com erro — investigar.`,
      action: (facesErro ?? 0) > 0 ? { label: "Ver erros", panel: "acessoFaces" } : null,
      blocking: false,
      severity: (facesErro ?? 0) === 0 ? "ok" : "warn",
    },
    {
      id: "permissoes",
      label: "Permissões de retirada",
      ok: (permissoes ?? 0) > 0,
      detail: (permissoes ?? 0) > 0 ? `${permissoes} autorização(ões) ativas.` : "Nenhuma autorização cadastrada.",
      action: (permissoes ?? 0) === 0 ? { label: "Cadastrar", panel: "acessoPermissoes" } : null,
      blocking: false,
      severity: (permissoes ?? 0) > 0 ? "ok" : "warn",
    },
    {
      id: "responsaveis_face",
      label: "Responsáveis com face cadastrada",
      ok: false, // computed below
      detail: "—",
      action: { label: "Cadastrar", panel: "acessoPermissoes" },
      blocking: false,
      severity: "muted",
    },
    {
      id: "autorizacoes_pais_mes",
      label: "Autorizações criadas pelos pais (mês)",
      ok: true, // sempre ok — é informativo
      detail: "—",
      action: null,
      blocking: false,
      severity: "muted",
    },
    {
      id: "remocoes_pendentes",
      label: "Remoções de face pendentes",
      ok: true,
      detail: "—",
      action: null,
      blocking: false,
      severity: "muted",
    },
    {
      id: "eventos",
      label: "Eventos nas últimas 24h",
      ok: (eventos24h ?? 0) > 0,
      detail: (eventos24h ?? 0) > 0 ? `${eventos24h} reconhecimento(s) registrado(s).` : "Nenhum evento — ninguém passou ainda ou callback não está configurado.",
      action: null,
      blocking: false,
      severity: (eventos24h ?? 0) > 0 ? "ok" : (totalDevices === 0 ? "muted" : "warn"),
    },
  ];

  // Compute responsaveis_face item: % de alunos com pelo menos 1 responsável com face cadastrada
  if ((alunosTotal ?? 0) > 0) {
    const { data: rfRows } = await ctx.sb.rpc("count_alunos_com_responsavel_face", { p_escola_id: eid }).maybeSingle();
    let comResp = rfRows?.count;
    if (typeof comResp !== "number") {
      // Fallback sem RPC: query inline
      const { data: permsRf } = await ctx.sb.from("acesso_permissoes_retirada")
        .select("aluno_id, responsavel_id")
        .eq("escola_id", eid).eq("autorizado", true);
      const respIds = (permsRf ?? []).map((p: Any) => p.responsavel_id).filter((x: Any) => x);
      let facesSet = new Set<string>();
      if (respIds.length) {
        const { data: faces } = await ctx.sb.from("acesso_faces")
          .select("pessoa_id").eq("escola_id", eid).eq("ativo", true).eq("pessoa_tipo", "responsavel")
          .in("pessoa_id", respIds);
        facesSet = new Set((faces ?? []).map((f: Any) => f.pessoa_id));
      }
      const alunosComFaceResp = new Set<string>();
      for (const p of permsRf ?? []) {
        if (p.responsavel_id && facesSet.has(p.responsavel_id)) alunosComFaceResp.add(p.aluno_id);
      }
      comResp = alunosComFaceResp.size;
    }
    const respItem = items.find((i) => i.id === "responsaveis_face");
    if (respItem) {
      const pct = Math.round(((comResp || 0) / alunosTotal) * 100);
      respItem.ok = (comResp || 0) === alunosTotal;
      respItem.detail = `${comResp || 0} de ${alunosTotal} aluno(s) com pelo menos 1 responsável com face. (${pct}% cobertura)`;
      respItem.severity = respItem.ok ? "ok" : (pct >= 50 ? "warn" : "error");
      respItem.blocking = false;
    }
  } else {
    const respItem = items.find((i) => i.id === "responsaveis_face");
    if (respItem) {
      respItem.detail = "Nenhum aluno ativo.";
      respItem.severity = "muted";
      respItem.ok = true;
    }
  }

  // Compute autorizacoes_pais_mes — informativo (sempre ok)
  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
  const { count: autPaisMes } = await ctx.sb.from("acesso_permissoes_retirada")
    .select("id", { count: "exact", head: true })
    .eq("escola_id", eid)
    .eq("criado_por_familia", true)
    .gte("criado_em", inicioMes.toISOString());
  const { count: autPaisAtivas } = await ctx.sb.from("acesso_permissoes_retirada")
    .select("id", { count: "exact", head: true })
    .eq("escola_id", eid)
    .eq("criado_por_familia", true)
    .eq("autorizado", true);
  const autItem = items.find((i) => i.id === "autorizacoes_pais_mes");
  if (autItem) {
    if ((autPaisMes ?? 0) === 0 && (autPaisAtivas ?? 0) === 0) {
      autItem.detail = "Nenhuma autorização de pai criada ainda este mês.";
      autItem.severity = "muted";
    } else {
      autItem.detail = `${autPaisMes || 0} criada(s) este mês • ${autPaisAtivas || 0} ativa(s) no total.`;
      autItem.severity = "ok";
    }
  }

  // Compute remocoes_pendentes — alerta se acumulou
  const { count: remPend } = await ctx.sb.from("acesso_faces")
    .select("id", { count: "exact", head: true })
    .eq("escola_id", eid)
    .eq("sync_status", "aguardando_remocao")
    .eq("ativo", true);
  const remItem = items.find((i) => i.id === "remocoes_pendentes");
  if (remItem) {
    const n = remPend ?? 0;
    if (n === 0) {
      remItem.detail = "Nenhuma remoção pendente.";
      remItem.severity = "ok";
      remItem.ok = true;
    } else if (n < 5) {
      remItem.detail = `${n} face(s) na fila pra remover do iDFace (cron processa a cada 15min).`;
      remItem.severity = "warn";
      remItem.ok = false;
    } else {
      remItem.detail = `${n} face(s) acumuladas — possível erro no Bridge. Verificar logs do daemon.`;
      remItem.severity = "error";
      remItem.ok = false;
    }
  }

  const blockers = items.filter((i) => i.blocking && !i.ok).length;
  const totalOk = items.filter((i) => i.ok).length;

  return successResponse({
    escola_nome: escola?.nome || "",
    score: items.length === 0 ? 0 : Math.round((totalOk / items.length) * 100),
    blockers,
    pode_operar: blockers === 0,
    items,
    devices: (devices ?? []).map((d: Any) => ({
      id: d.id, nome: d.nome, ip: d.ip, porta: d.porta, tipo: d.tipo,
      via_bridge: d.via_bridge, tem_senha: !!d.api_password,
      ultimo_heartbeat: d.ultimo_heartbeat,
    })),
  });
});

// ═══════════════════════════════════════════════════════════════
//  Lumied Bridge — gestão de token e status (gerente)
// ═══════════════════════════════════════════════════════════════

// ─── acesso_bridge_devices: daemon busca devices da escola via bridge_token ───
//     Sem session token. Body: { bridge_token }. Sem rate limit (chamada pontual no startup).
router.on("acesso_bridge_devices", async (ctx) => {
  const { bridge_token } = ctx.body as Any;
  if (!bridge_token || typeof bridge_token !== "string" || !/^lbr_[0-9a-f]{32,128}$/i.test(bridge_token)) {
    throw new AppError("AUTH_REQUIRED", "bridge_token inválido.");
  }
  const { data: escola } = await ctx.sb.from("escolas")
    .select("id, bridge_token")
    .eq("bridge_token", bridge_token)
    .maybeSingle();
  if (!escola?.id) throw new AppError("AUTH_INVALID", "Token de bridge não reconhecido.");

  const { data: devices } = await ctx.sb.from("acesso_dispositivos")
    .select("id, nome, ip, porta, tipo, via_bridge, ativo")
    .eq("escola_id", escola.id)
    .eq("ativo", true)
    .eq("via_bridge", true);

  // Atualiza heartbeat no DB (esse endpoint serve como sinal de "daemon vivo")
  await ctx.sb.from("escolas")
    .update({ bridge_ultimo_heartbeat: new Date().toISOString() })
    .eq("id", escola.id);

  return successResponse({
    escola_id: escola.id,
    devices: devices ?? [],
    daemon_event_path: "/event",
  });
});

// ─── acesso_bridge_status: liveness + heartbeat do bridge da escola ───
router.on("acesso_bridge_status", authGerenteOrSecretaria, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data: escola } = await ctx.sb.from("escolas")
    .select("bridge_token, bridge_ultimo_heartbeat")
    .eq("id", ctx.escola_id).maybeSingle();
  const status = await bridgeStatus(ctx.escola_id);
  const { data: pendentes } = await ctx.sb.from("acesso_bridge_comandos")
    .select("id, tipo, status, criado_em")
    .eq("escola_id", ctx.escola_id)
    .in("status", ["pendente", "em_execucao"])
    .order("criado_em", { ascending: false })
    .limit(20);
  return successResponse({
    token_configurado: !!escola?.bridge_token,
    ultimo_heartbeat_db: escola?.bridge_ultimo_heartbeat || null,
    gateway: status,
    comandos_em_voo: pendentes ?? [],
  });
});

// ─── acesso_bridge_token_get: revela token (gerente apenas, para instalação do daemon) ───
router.on("acesso_bridge_token_get", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data: escola } = await ctx.sb.from("escolas")
    .select("bridge_token")
    .eq("id", ctx.escola_id).maybeSingle();
  return successResponse({ bridge_token: escola?.bridge_token || null });
});

// ─── acesso_bridge_token_rotate: gera novo token (invalida o anterior) ───
router.on("acesso_bridge_token_rotate", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const token = `lbr_${hex}`;
  const { error } = await ctx.sb.from("escolas")
    .update({ bridge_token: token, bridge_ultimo_heartbeat: null })
    .eq("id", ctx.escola_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ bridge_token: token });
});

// ═══════════════════════════════════════════════════════════════
//  Server
// ═══════════════════════════════════════════════════════════════
serve(async (req) => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return router.handle(req, sb);
});
