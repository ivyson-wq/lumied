// ═══════════════════════════════════════════════════════════════
//  Acesso — helpers, middleware e device wrappers compartilhados
//  (Onda 3 do refator — extraídos do index.ts monolítico)
// ═══════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AppError, type Middleware } from "../_shared/mod.ts";

// deno-lint-ignore no-explicit-any
export type Any = any;

// ═══════════════════════════════════════════════════════════════
//  Auth: Gerente OR Secretaria (unified sessions)
// ═══════════════════════════════════════════════════════════════
export const authGerenteOrSecretaria: Middleware = async (ctx, next) => {
  const token = (ctx.body._token as string) || null;
  if (!token) throw new AppError("AUTH_REQUIRED", "Token de sessão obrigatório.");

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
//  Auth: Pais (Supabase Auth JWT do Authorization: Bearer)
// ═══════════════════════════════════════════════════════════════
export async function getAuthenticatedPaiEmail(ctx: { req: Request; sb: Any }): Promise<string> {
  const authHeader = ctx.req.headers.get("authorization") || ctx.req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AppError("AUTH_REQUIRED", "Token de autenticação obrigatório (Authorization: Bearer).");
  const token = match[1].trim();
  if (!token) throw new AppError("AUTH_REQUIRED", "Token de autenticação obrigatório.");
  const { data, error } = await ctx.sb.auth.getUser(token);
  if (error || !data?.user?.email) throw new AppError("AUTH_REQUIRED", "Token inválido ou expirado.");
  return String(data.user.email).toLowerCase();
}

/** Confere ownership da família pelo email autenticado. Retorna a row de familias ou null. */
export async function assertFamiliaOwnership(ctx: { req: Request; sb: Any }, email: string): Promise<Any> {
  const authedEmail = await getAuthenticatedPaiEmail(ctx);
  if (authedEmail !== String(email || "").toLowerCase()) {
    throw new AppError("FORBIDDEN", "Você não tem permissão para acessar dados desta família.");
  }
  const { data: familia } = await ctx.sb.from("familias")
    .select("id, cpf, escola_id, nome_responsavel, email")
    .eq("email", authedEmail).maybeSingle();
  return familia;
}

// ═══════════════════════════════════════════════════════════════
//  HTTP fetch para iDFace (modo direto, sem bridge)
// ═══════════════════════════════════════════════════════════════
export async function deviceFetch(
  ip: string,
  porta: number,
  path: string,
  options: RequestInit = {},
  timeoutMs = 5000,
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

export async function getDeviceSession(sb: Any, device: Any): Promise<string> {
  if (device.api_session) {
    try {
      const res = await deviceFetch(device.ip, device.porta, `/system_information.fcgi?session=${device.api_session}`);
      if (res.ok) return device.api_session;
    } catch { /* session expired, re-login */ }
  }
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
  await sb.from("acesso_dispositivos").update({ api_session: data.session, ultimo_heartbeat: new Date().toISOString() }).eq("id", device.id).eq("escola_id", device.escola_id);
  return data.session;
}

export function uuidToDeviceId(uuid: string): number {
  return parseInt(uuid.replace(/-/g, "").substring(0, 8), 16);
}

export async function getConfig(sb: Any, chave: string): Promise<string | null> {
  const { data } = await sb.from("acesso_config").select("valor").eq("chave", chave).single();
  return data?.valor ?? null;
}

// ═══════════════════════════════════════════════════════════════
//  Lumied Bridge — dispatch via Cloudflare gateway (Fase 3)
// ═══════════════════════════════════════════════════════════════

export interface BridgeResult {
  ok: boolean;
  status: number;
  error?: string;
  body?: Any;
  comando_id?: string;
}

export async function bridgeDispatch(
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

// Dispatch sem device-target — usado pra diagnóstico (hardware do Pi, LPR sync etc).
export async function bridgeDispatchEphemeral(
  escolaId: string,
  tipo: string,
  payload: Any = {},
  waitMs = 8000,
): Promise<BridgeResult> {
  const gatewayUrl = Deno.env.get("BRIDGE_GATEWAY_URL");
  const gatewaySecret = Deno.env.get("BRIDGE_GATEWAY_SECRET");
  if (!gatewayUrl || !gatewaySecret) {
    return { ok: false, status: 500, error: "Bridge gateway não configurado." };
  }
  let res: Response;
  try {
    res = await fetch(`${gatewayUrl}/dispatch/${escolaId}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${gatewaySecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ req_id: crypto.randomUUID(), wait_ms: waitMs, tipo, payload }),
      signal: AbortSignal.timeout(waitMs + 5000),
    });
  } catch (e) {
    return { ok: false, status: 502, error: `Gateway unreachable: ${String(e)}` };
  }
  let data: Any = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (res.status === 503) return { ok: false, status: 503, error: "Bridge offline" };
  if (data?.timeout) return { ok: false, status: 504, error: "Timeout aguardando bridge" };
  return {
    ok: !!data?.ok,
    status: data?.ok ? 200 : 502,
    error: data?.error,
    body: data?.payload ?? data,
  };
}

export async function bridgeStatus(escolaId: string): Promise<{ connected: boolean; last_heartbeat: number | null; pending: number; error?: string }> {
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

// ═══════════════════════════════════════════════════════════════
//  Operações de dispositivo (transparente: bridge ou direto)
// ═══════════════════════════════════════════════════════════════

function uint8ToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export interface DeviceOpResult { ok: boolean; status: number; error?: string }

export async function deviceEnrollUser(sb: Any, device: Any, user: { id: number; name: string; registration: string }): Promise<DeviceOpResult> {
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

export async function deviceEnrollUsers(sb: Any, device: Any, users: Array<{ id: number; name: string; registration: string }>): Promise<DeviceOpResult> {
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

export async function deviceSetFaceImage(sb: Any, device: Any, deviceUserId: number, photoBytes: Uint8Array): Promise<DeviceOpResult> {
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

export async function deviceEnrollCard(sb: Any, device: Any, card_value: number, deviceUserId: number): Promise<DeviceOpResult> {
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

export async function devicePing(sb: Any, device: Any): Promise<DeviceOpResult> {
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

export async function deviceUnregisterUser(sb: Any, device: Any, deviceUserId: number): Promise<DeviceOpResult> {
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
//  Validação de qualidade de foto (Control iD)
// ═══════════════════════════════════════════════════════════════

/** Valida qualidade da foto usando o primeiro dispositivo ativo (prefere não-bridge). */
export async function validarQualidadeFoto(
  sb: ReturnType<typeof createClient>,
  fotoBinary: Uint8Array,
): Promise<{ ok: boolean; scores: Any; errors: string[] }> {
  const { data: devices } = await sb.from("acesso_dispositivos").select("*").eq("ativo", true);
  if (!devices?.length) {
    return { ok: true, scores: null, errors: ["Nenhum dispositivo ativo para validação. Foto salva sem validação."] };
  }
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
  } catch (_err) {
    return { ok: true, scores: null, errors: ["Dispositivo offline — foto salva sem validação de qualidade."] };
  }
}

// ═══════════════════════════════════════════════════════════════
//  Helpers de upload base64 e CPF
// ═══════════════════════════════════════════════════════════════

export async function uploadBase64Photo(sb: Any, base64: string, prefix: string): Promise<string | null> {
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

export function onlyDigits(s: string): string { return String(s || "").replace(/\D/g, ""); }

export function isValidCpf(cpf: string): boolean {
  const d = onlyDigits(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i);
  let v1 = (sum * 10) % 11; if (v1 === 10) v1 = 0;
  if (v1 !== parseInt(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i);
  let v2 = (sum * 10) % 11; if (v2 === 10) v2 = 0;
  return v2 === parseInt(d[10]);
}

// ═══════════════════════════════════════════════════════════════
//  Simpax CSV — parser e classificador
// ═══════════════════════════════════════════════════════════════

export function parseSimpaxLine(rawLine: string): Record<string, string> | null {
  const cells = rawLine.split(";").map((c) => c.trim());
  if (cells.length < 5 || !cells[0]) return null;
  return {
    identificacao: cells[0],
    descricao: cells[1] ?? "",
    contratante: cells[2] ?? "",
    refeitorio: cells[3] ?? "",
    coletor_671: cells[4] ?? "",
    exige_bio: cells[5] ?? "",
    local: cells[6] ?? "",
    estado: cells[7] ?? "",
    impressora: cells[8] ?? "",
    ultima_comunicacao: cells[9] ?? "",
    tipo_equipamento: cells[10] ?? "",
    tipo_registro: cells[11] ?? "",
    ultimo_registro: cells[12] ?? "",
    data_ultimo_registro: cells[13] ?? "",
    atestado: cells[14] ?? "",
    tamanho_lbr: cells[15] ?? "",
    ativo: cells[16] ?? "",
    possui_atualizacao: cells[17] ?? "",
  };
}

export function parseSimpaxDate(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss ?? "00"}-03:00`;
}

export function classificarSimpax(descricao: string, modeloDetalhe: string): {
  tipo: string;
  grupo_mapa: string;
  lado: "esquerdo" | "direito" | null;
} {
  const d = descricao.toLowerCase();
  const m = modeloDetalhe.toLowerCase();

  let lado: "esquerdo" | "direito" | null = null;
  if (d.includes("esquerd")) lado = "esquerdo";
  else if (d.includes("direit")) lado = "direito";

  if (m.includes("simpax") && !m.includes("idface")) {
    return { tipo: "terminal_bidirecional", grupo_mapa: "app_mobile", lado: null };
  }
  if (d.startsWith("catraca") && d.includes("sa")) {
    return { tipo: "catraca_saida", grupo_mapa: "catraca_saida", lado };
  }
  if (d.startsWith("catraca") && d.includes("entrada")) {
    return { tipo: "catraca_entrada", grupo_mapa: "catraca_entrada", lado };
  }
  if (d.includes("entrada respons")) {
    return { tipo: "terminal_entrada", grupo_mapa: "entrada_resp", lado };
  }
  if (d.includes("sa") && d.includes("infantil")) {
    return { tipo: "terminal_saida", grupo_mapa: "saida_infantil", lado };
  }
  if (d.includes("entrada fund")) {
    return { tipo: "terminal_entrada", grupo_mapa: "entrada_fundamental", lado };
  }
  return { tipo: "terminal_bidirecional", grupo_mapa: "outros", lado };
}

// ═══════════════════════════════════════════════════════════════
//  LPR helpers
// ═══════════════════════════════════════════════════════════════

export function normalizarPlaca(p: string): string {
  return String(p || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

export async function syncLprPlatesToBridge(sb: Any, escolaId: string): Promise<void> {
  const { data } = await sb.from("acesso_lpr_placas")
    .select("id, placa, ativo, validade_inicio, validade_fim, janela_horaria, apelido")
    .eq("escola_id", escolaId);
  const plates = data ?? [];
  await bridgeDispatchEphemeral(escolaId, "lpr_sync", { plates }, 3000).catch(() => { /* offline ok */ });
}

export async function syncCamerasToBridge(sb: Any, escolaId: string): Promise<void> {
  const { data } = await sb.from("acesso_lpr_cameras")
    .select("id, nome, rtsp_url, alpr_url, scan_interval_ms, confidence_min, roi_polygon, gate_webhook_url, gate_webhook_token, gpio_pin, gpio_pulse_ms, ativa")
    .eq("escola_id", escolaId);
  const cameras = data ?? [];
  await bridgeDispatchEphemeral(escolaId, "lpr_cameras_sync", { cameras }, 5000).catch(() => { /* offline ok */ });
}

// Lookup família + auth check pelo email autenticado.
export async function lprGetFamiliaByEmail(ctx: Any, email: string): Promise<Any> {
  const authedEmail = await getAuthenticatedPaiEmail(ctx);
  if (authedEmail !== String(email || "").toLowerCase()) {
    throw new AppError("FORBIDDEN", "Você não tem permissão para acessar dados desta família.");
  }
  const { data } = await ctx.sb.from("familias")
    .select("cpf, escola_id, nome_responsavel, email")
    .eq("email", authedEmail).maybeSingle();
  return data;
}

// ═══════════════════════════════════════════════════════════════
//  Resolver famílias por email (portal pai — multi-aluno)
// ═══════════════════════════════════════════════════════════════
import { resolveEscolaId } from "../_shared/mod.ts";

export async function resolveFamiliasDoPai(ctx: Any, email: string): Promise<Any[]> {
  const escolaId = await resolveEscolaId(ctx.req, ctx.sb, null, ctx.body);
  let q = ctx.sb.from("familias").select("id, nome_aluno, nome_responsavel, email, escola_id").eq("email", email);
  if (escolaId) q = q.eq("escola_id", escolaId);
  const { data } = await q;
  return data || [];
}
