// API Handlers: Auth (login, logout, setup, webauthn)
import { type Context } from "../../_shared/router.ts";
import { successResponse, AppError } from "../../_shared/errors.ts";
import { hashSenhaV1, verificarSenhaAuto, gerarToken, criarSessao } from "../../_shared/auth.ts";
import { generateChallenge, verifyRegistration, verifyAuthentication, b64urlEncode } from "../../_shared/webauthn.ts";
import { createLogger } from "../../_shared/logger.ts";

const log = createLogger("api/auth");

export async function setupCheck(ctx: Context) {
  const { count } = await ctx.sb.from("gerentes").select("*", { count: "exact", head: true });
  return successResponse({ needs_setup: (count ?? 0) === 0 });
}

export async function setup(ctx: Context) {
  const { nome, email, senha } = ctx.body as any;
  if (!nome || !email || !senha) throw new AppError("VALIDATION_FAILED", "Nome, email e senha obrigatórios.");
  const { count } = await ctx.sb.from("gerentes").select("*", { count: "exact", head: true });
  if ((count ?? 0) > 0) throw new AppError("CONFLICT", "Já existe um gerente cadastrado.");
  const senha_hash = await hashSenhaV1(senha);
  const { data: g, error } = await ctx.sb.from("gerentes").insert({ nome, email, senha_hash }).select("id, nome, email").single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  const token = await criarSessao(ctx.sb, "gerente_sessoes", "gerente_id", g.id);
  log.info("Setup completed", { user_id: g.id });
  return successResponse({ token, nome: g.nome, email: g.email });
}

export async function login(ctx: Context) {
  const { email, senha } = ctx.body as any;
  if (!email || !senha) throw new AppError("VALIDATION_FAILED", "Email e senha obrigatórios.");
  const { data: g } = await ctx.sb.from("gerentes").select("id, nome, email, senha_hash").eq("email", email).single();
  if (!g) throw new AppError("AUTH_INVALID", "Credenciais inválidas.");
  if (!(await verificarSenhaAuto(senha, g.senha_hash))) throw new AppError("AUTH_INVALID", "Credenciais inválidas.");
  const token = await criarSessao(ctx.sb, "gerente_sessoes", "gerente_id", g.id);
  log.info("Login", { user_id: g.id, action: "login" });
  return successResponse({ token, nome: g.nome, email: g.email });
}

export async function logout(ctx: Context) {
  if (ctx.body._token) await ctx.sb.from("gerente_sessoes").delete().eq("token", ctx.body._token);
  return successResponse({ success: true });
}

export async function webauthnLoginChallenge(ctx: Context) {
  const { email, portal, rp_id } = ctx.body as any;
  if (!email) throw new AppError("VALIDATION_FAILED", "Email obrigatório.");
  const { data: creds } = await ctx.sb.from("webauthn_credentials").select("credential_id, public_key").eq("email", email).eq("portal", portal || "gerente");
  if (!creds?.length) throw new AppError("NOT_FOUND", "Nenhuma credencial biométrica.");
  const challenge = generateChallenge();
  await ctx.sb.from("webauthn_challenges").insert({ challenge, email, portal: portal || "gerente" });
  return successResponse({
    challenge,
    rpId: rp_id || new URL(ctx.req.headers.get("origin") || "https://lumied.com.br").hostname,
    allowCredentials: creds.map((c: any) => ({ id: c.credential_id, type: "public-key" })),
    timeout: 60000,
  });
}

export async function webauthnLoginVerify(ctx: Context) {
  const { credential, rp_id } = ctx.body as any;
  if (!credential) throw new AppError("VALIDATION_FAILED", "Credential obrigatória.");
  const { data: ch } = await ctx.sb.from("webauthn_challenges").select("*").eq("challenge", credential.challenge).single();
  if (!ch) throw new AppError("AUTH_INVALID", "Challenge inválido ou expirado.");
  await ctx.sb.from("webauthn_challenges").delete().eq("id", ch.id);
  const { data: cred } = await ctx.sb.from("webauthn_credentials").select("*").eq("credential_id", credential.id).eq("email", ch.email).single();
  if (!cred) throw new AppError("AUTH_INVALID", "Credencial não encontrada.");
  const rpId = rp_id || new URL(ctx.req.headers.get("origin") || "https://lumied.com.br").hostname;
  const origin = `https://${rpId}`;
  try {
    await verifyAuthentication(credential, cred.public_key, ch.challenge, origin, rpId, cred.sign_count);
  } catch (e) {
    throw new AppError("AUTH_INVALID", "Verificação biométrica falhou: " + (e as Error).message);
  }
  await ctx.sb.from("webauthn_credentials").update({ sign_count: (cred.sign_count || 0) + 1 }).eq("id", cred.id);
  // Create session based on portal
  const portal = ch.portal || "gerente";
  let sessionData: any = {};
  if (portal === "gerente") {
    const { data: g } = await ctx.sb.from("gerentes").select("id, nome, email").eq("email", ch.email).single();
    if (!g) throw new AppError("NOT_FOUND", "Gerente não encontrado.");
    const token = await criarSessao(ctx.sb, "gerente_sessoes", "gerente_id", g.id);
    sessionData = { token, nome: g.nome, email: g.email, portal };
  }
  log.info("WebAuthn login", { action: "webauthn_login", metadata: { portal, email: ch.email } });
  return successResponse(sessionData);
}

export async function webauthnRegisterChallenge(ctx: Context) {
  const { email, portal, rp_id } = ctx.body as any;
  if (!email) throw new AppError("VALIDATION_FAILED", "Email obrigatório.");
  const challenge = generateChallenge();
  await ctx.sb.from("webauthn_challenges").insert({ challenge, email, portal: portal || "gerente" });
  return successResponse({
    challenge,
    rp: { name: "Lumied", id: rp_id || new URL(ctx.req.headers.get("origin") || "https://lumied.com.br").hostname },
    user: { id: b64urlEncode(new TextEncoder().encode(email)), name: email, displayName: email },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    timeout: 60000,
    attestation: "none",
  });
}

export async function webauthnRegisterVerify(ctx: Context) {
  const { credential, email, portal, rp_id } = ctx.body as any;
  if (!credential || !email) throw new AppError("VALIDATION_FAILED", "Credential e email obrigatórios.");
  const { data: ch } = await ctx.sb.from("webauthn_challenges").select("*").eq("email", email).order("criado_em", { ascending: false }).limit(1).single();
  if (!ch) throw new AppError("AUTH_INVALID", "Challenge não encontrado.");
  await ctx.sb.from("webauthn_challenges").delete().eq("id", ch.id);
  const rpId = rp_id || new URL(ctx.req.headers.get("origin") || "https://lumied.com.br").hostname;
  const origin = `https://${rpId}`;
  try {
    const result = await verifyRegistration(credential, ch.challenge, origin, rpId);
    await ctx.sb.from("webauthn_credentials").insert({
      email, portal: portal || "gerente",
      credential_id: credential.id,
      public_key: result.publicKey,
      sign_count: 0,
    });
    return successResponse({ success: true, registered: true });
  } catch (e) {
    throw new AppError("AUTH_INVALID", "Registro falhou: " + (e as Error).message);
  }
}
