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
  const { data: familia } = await ctx.sb.from("familias").select("id, nome_resp, email").eq("email", authedEmail).maybeSingle();
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
  const { id, nome, ip, porta, tipo, localizacao, modelo } = ctx.body as Any;
  if (!nome || !ip || !tipo) throw new AppError("VALIDATION_FAILED", "nome, ip e tipo são obrigatórios.");

  const row = { nome, ip, porta: porta || 443, tipo, localizacao: localizacao || null, modelo: modelo || "iDFace" };

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

  try {
    const res = await deviceFetch(device.ip, device.porta, "/login.fcgi");
    return successResponse({ online: res.status < 500, status: res.status, ip: device.ip, porta: device.porta });
  } catch (err) {
    return successResponse({ online: false, error: String(err), ip: device.ip, porta: device.porta });
  }
});

router.on("acesso_dispositivo_sync", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { id } = ctx.body as Any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");

  const { data: device } = await ctx.sb.from("acesso_dispositivos").select("*").eq("id", id).eq("escola_id", ctx.escola_id).single();
  if (!device) throw new AppError("NOT_FOUND", "Dispositivo não encontrado.");

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
        const { data: urlData } = ctx.sb.storage.from("wa-documentos").getPublicUrl(path);
        fotoUrl = urlData?.publicUrl || null;
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
      const session = await getDeviceSession(ctx.sb, dev);

      // Create user on device
      await deviceFetch(dev.ip, dev.porta, `/create_objects.fcgi?session=${session}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object: "users",
          values: [{ id: deviceUserId, name: pessoa_nome, registration: pessoa_id }],
        }),
      });

      // Send face image if available
      if (fotoBinary) {
        const ts = Math.floor(Date.now() / 1000);
        const imgRes = await deviceFetch(
          dev.ip, dev.porta,
          `/user_set_image.fcgi?session=${session}&user_id=${deviceUserId}&timestamp=${ts}`,
          { method: "POST", body: fotoBinary }
        );
        syncResults.push({ device: dev.nome, ok: imgRes.ok, status: imgRes.status });
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
      const session = await getDeviceSession(ctx.sb, dev);

      // Create all users on device
      const users = faces.map((f: Any) => ({ id: f.device_user_id, name: f.pessoa_nome, registration: f.pessoa_id }));
      await deviceFetch(dev.ip, dev.porta, `/create_objects.fcgi?session=${session}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object: "users", values: users }),
      });

      // Send faces with photos
      for (const face of faces) {
        if (!face.foto_url) continue;
        try {
          // Download photo from storage
          const photoRes = await fetch(face.foto_url, { signal: AbortSignal.timeout(5000) });
          if (!photoRes.ok) continue;
          const photoBytes = new Uint8Array(await photoRes.arrayBuffer());

          const ts = Math.floor(Date.now() / 1000);
          await deviceFetch(dev.ip, dev.porta,
            `/user_set_image.fcgi?session=${session}&user_id=${face.device_user_id}&timestamp=${ts}`,
            { method: "POST", body: photoBytes }
          );

          await ctx.sb.from("acesso_faces").update({
            sync_status: "sincronizado", sync_erro: null, atualizado_em: new Date().toISOString(),
          }).eq("id", face.id).eq("escola_id", ctx.escola_id);
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
      const session = await getDeviceSession(ctx.sb, dev);
      await deviceFetch(dev.ip, dev.porta, `/create_objects.fcgi?session=${session}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object: "cards", values: [{ value: Number(card_uid), user_id: deviceUserId }] }),
      });
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
  const { aluno_id } = ctx.body as Any;
  let q = ctx.sb.from("acesso_permissoes_retirada").select("*").eq("escola_id", ctx.escola_id).eq("autorizado", true).order("criado_em", { ascending: false });
  if (aluno_id) q = q.eq("aluno_id", aluno_id);
  const { data } = await q;
  return successResponse(data ?? []);
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
//  DEVICE CALLBACK (NO auth — called by Face Control ID devices)
// ═══════════════════════════════════════════════════════════════

router.on("acesso_evento_callback", async (ctx) => {
  const { user_id, device_id, timestamp, method, card_value, direction, confidence, photo } = ctx.body as Any;

  // Validate request comes from a registered device
  const sourceIp = ctx.ip;
  const { data: devices } = await ctx.sb.from("acesso_dispositivos").select("*").eq("ativo", true);

  // Find device by device_id or by source IP
  let dispositivo: Any = null;
  if (device_id) {
    dispositivo = (devices ?? []).find((d: Any) => d.id === device_id);
  }
  if (!dispositivo) {
    dispositivo = (devices ?? []).find((d: Any) => d.ip === sourceIp);
  }

  // SECURITY: reject events that did not come from a registered device
  if (!dispositivo) {
    console.warn(`[acesso_evento_callback] Rejeitado: origem não reconhecida. sourceIp=${sourceIp} device_id=${device_id}`);
    throw new AppError("FORBIDDEN", "Evento rejeitado: dispositivo não registrado.");
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
        const { data: urlData } = ctx.sb.storage.from("wa-documentos").getPublicUrl(path);
        fotoCapturaUrl = urlData?.publicUrl || null;
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
        aluno_nome: pessoa.nome,
        mensagem: `${pessoa.nome} saiu da escola via ${metodo}.`,
        destinatario_tipo: "recepcao",
      });
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
          tipo: "chegada_responsavel",
          pessoa_nome: pessoa.nome,
          aluno_nome: perm.aluno_nome,
          turma,
          mensagem: `${pessoa.nome} (${perm.parentesco || "responsavel"}) chegou para buscar ${perm.aluno_nome} (${turma}).`,
          destinatario_tipo: "recepcao",
        });

        // Alert for professora (if found)
        if (professoraId) {
          await ctx.sb.from("acesso_alertas").insert({
            escola_id: eventoEscolaId,
            evento_id: evento?.id,
            tipo: "chegada_responsavel",
            pessoa_nome: pessoa.nome,
            aluno_nome: perm.aluno_nome,
            turma,
            mensagem: `${pessoa.nome} (${perm.parentesco || "responsavel"}) chegou para buscar ${perm.aluno_nome}.`,
            destinatario_tipo: "professora",
            destinatario_id: professoraId,
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

  const { data } = await ctx.sb.from("acesso_alertas")
    .select("*")
    .eq("escola_id", ctx.escola_id)
    .eq("destinatario_tipo", "professora")
    .eq("destinatario_id", professoraId)
    .eq("lido", false)
    .order("criado_em", { ascending: false })
    .limit(20);

  return successResponse(data ?? []);
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
    const { data: urlData } = ctx.sb.storage.from("wa-documentos").getPublicUrl(path);
    fotoUrl = urlData?.publicUrl || null;
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
//  Validação de qualidade de foto (Control iD)
// ═══════════════════════════════════════════════════════════════

/** Valida qualidade da foto usando o primeiro dispositivo ativo */
async function validarQualidadeFoto(
  sb: ReturnType<typeof createClient>,
  fotoBinary: Uint8Array,
): Promise<{ ok: boolean; scores: Any; errors: string[] }> {
  const { data: devices } = await sb.from("acesso_dispositivos").select("*").eq("ativo", true).limit(1);
  if (!devices?.length) {
    return { ok: true, scores: null, errors: ["Nenhum dispositivo ativo para validação. Foto salva sem validação."] };
  }
  const dev = devices[0];
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

  // Salvar foto no storage
  const path = `acesso/faces/${tk.pessoa_id}_${Date.now()}.jpg`;
  await ctx.sb.storage.from("wa-documentos").upload(path, binary, { contentType: "image/jpeg", upsert: true });
  const { data: urlData } = ctx.sb.storage.from("wa-documentos").getPublicUrl(path);
  const fotoUrl = urlData?.publicUrl || null;

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
      const session = await getDeviceSession(ctx.sb, dev);
      await deviceFetch(dev.ip, dev.porta, `/create_objects.fcgi?session=${session}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object: "users", values: [{ id: face.device_user_id, name: face.pessoa_nome, registration: face.pessoa_id }] }),
      });
      if (fotoBinary) {
        const ts = Math.floor(Date.now() / 1000);
        await deviceFetch(dev.ip, dev.porta, `/user_set_image.fcgi?session=${session}&user_id=${face.device_user_id}&timestamp=${ts}`, {
          method: "POST", body: fotoBinary,
        });
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
