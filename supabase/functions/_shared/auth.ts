// ═══════════════════════════════════════════════════════════════
//  Shared: Authentication helpers — hashing, tokens, sessions
// ═══════════════════════════════════════════════════════════════

import { SupabaseClient } from "@supabase/supabase-js";

// ── Password hashing (PBKDF2 hex:hex, 100k iterations) ──
export async function hashSenha(senha: string, iterations = 100000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${saltHex}:${hashHex}`;
}

// ── Password hashing v1 (base64:base64, 120k — gerentes legacy) ──
export async function hashSenhaV1(senha: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, key, 256);
  return `v1:${btoa(String.fromCharCode(...salt))}:${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
}

// ── Verify password (hex:hex format) ──
export async function verificarSenha(senha: string, stored: string, iterations = 100000): Promise<boolean> {
  try {
    const [saltHex, storedHash] = stored.split(":");
    const salt = Uint8Array.from((saltHex.match(/.{2}/g) || []).map(h => parseInt(h, 16)));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("") === storedHash;
  } catch { return false; }
}

// ── Verify password v1 (base64, 120k — gerentes legacy) ──
export async function verificarSenhaV1(senha: string, stored: string): Promise<boolean> {
  try {
    const [, sB64, hB64] = stored.split(":");
    const salt = Uint8Array.from(atob(sB64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, key, 256);
    return btoa(String.fromCharCode(...new Uint8Array(bits))) === hB64;
  } catch { return false; }
}

// ── Auto-detect password format and verify ──
export function verificarSenhaAuto(senha: string, stored: string): Promise<boolean> {
  if (stored.startsWith("v1:")) return verificarSenhaV1(senha, stored);
  return verificarSenha(senha, stored);
}

// ── Generate session token (64 hex chars) ──
export function gerarToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Create session in a table ──
// `meta` é opcional; quando vier com escola_id, emite product_event LAP
// `auth.user.logged_in` (fire-and-forget, não bloqueia auth).
export async function criarSessao(
  sb: SupabaseClient,
  table: string,
  userIdField: string,
  userId: string,
  days = 7,
  meta?: { escola_id?: string | null; persona?: string }
): Promise<string> {
  const token = gerarToken();
  await sb.from(table).insert({
    [userIdField]: userId,
    token,
    expira_em: new Date(Date.now() + days * 86400000).toISOString(),
  });

  // LAP: emite evento de login (cobertura de stakeholders no LHS)
  if (meta?.escola_id) {
    try {
      const { trackEvent } = await import("./track.ts");
      // Não aguarda — fire-and-forget pra não atrasar login
      trackEvent(sb, {
        escola_id: meta.escola_id,
        user_id: userId,
        event_name: "auth.user.logged_in",
        module: "auth",
        persona: meta.persona ?? "sistema",
        payload: { sessao_table: table },
      });
    } catch (_) { /* silent */ }
  }

  return token;
}

// ── Validate session from a table ──
// Retorna usuário com escola_id para permitir que callers escopem writes por tenant.
export async function validarSessao(
  sb: SupabaseClient,
  table: string,
  userTable: string,
  userIdField: string,
  token: string | null,
  userFields = "id, nome, email, escola_id"
): Promise<{ id: string; nome: string; email: string; escola_id?: string } | null> {
  if (!token) return null;
  const { data: raw } = await sb
    .from(table)
    .select(`${userIdField}, expira_em, ${userTable}(${userFields})`)
    .eq("token", token)
    .single();
  // deno-lint-ignore no-explicit-any
  const data = raw as any;
  if (!data) return null;
  if (new Date(data.expira_em) < new Date()) return null;
  return data[userTable] as { id: string; nome: string; email: string; escola_id?: string };
}

// ═══════════════════════════════════════════════════════════════
//  Consolidated Session Resolvers
//  Eliminam duplicação que existia em api/, diplomas/, academico/
// ═══════════════════════════════════════════════════════════════

/** Resolve sessão unificada (tabela sessoes → usuarios) */
export async function resolveUsuario(
  sb: SupabaseClient,
  token: string | null,
): Promise<{ id: string; nome: string; email: string; papel?: string; papeis?: string[]; escola_id?: string } | null> {
  if (!token) return null;
  const { data: sessao } = await sb
    .from("sessoes").select("usuario_id, expira_em")
    .eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const s = sessao as any;
  if (!s || new Date(s.expira_em) < new Date()) return null;
  const { data } = await sb
    .from("usuarios").select("id, nome, email, papel, papeis, escola_id")
    .eq("id", s.usuario_id).maybeSingle();
  return data ?? null;
}

/**
 * Resolve sessão de qualquer tipo: legacy tables + unificada.
 * Probes em paralelo para performance. Usado pelo hub_whoami e resolveEscolaId.
 */
export async function resolveAnySession(
  sb: SupabaseClient,
  token: string | null,
): Promise<{ id: string; nome: string; email: string; tipo: string; escola_id?: string } | null> {
  if (!token) return null;
  const now = new Date();
  const isValid = (s: { expira_em: string } | null) => s && new Date(s.expira_em) >= now;

  const [gs, ps, ss, us] = await Promise.all([
    sb.from("gerente_sessoes").select("expira_em, gerentes(id, nome, email, escola_id)").eq("token", token).maybeSingle(),
    sb.from("professora_sessoes").select("expira_em, professoras(id, nome, email, escola_id)").eq("token", token).maybeSingle(),
    sb.from("secretaria_sessoes").select("expira_em, secretarias(id, nome, email, escola_id)").eq("token", token).maybeSingle(),
    sb.from("sessoes").select("usuario_id, expira_em").eq("token", token).maybeSingle(),
  ]);

  // deno-lint-ignore no-explicit-any
  const g = gs.data as any;
  if (isValid(g) && g?.gerentes) return { ...g.gerentes, tipo: "gerente" };

  // deno-lint-ignore no-explicit-any
  const p = ps.data as any;
  if (isValid(p) && p?.professoras) return { ...p.professoras, tipo: "professora" };

  // deno-lint-ignore no-explicit-any
  const s = ss.data as any;
  if (isValid(s) && s?.secretarias) return { ...s.secretarias, tipo: "secretaria" };

  // deno-lint-ignore no-explicit-any
  const u = us.data as any;
  if (isValid(u)) {
    const { data: user } = await sb.from("usuarios").select("id, nome, email, papeis, papel, escola_id").eq("id", u.usuario_id).maybeSingle();
    if (user) {
      // deno-lint-ignore no-explicit-any
      const papeis: string[] = (user as any).papeis?.length ? (user as any).papeis : ((user as any).papel ? [(user as any).papel] : []);
      // deno-lint-ignore no-explicit-any
      return { id: user.id, nome: user.nome, email: user.email, tipo: papeis[0] || "usuario", escola_id: (user as any).escola_id };
    }
  }
  return null;
}

/**
 * Resolve sessão de professora: legacy professora_sessoes + fallback unificada.
 * Usado por diplomas e academico. Auto-provision se necessário.
 */
export async function resolveProfessora(
  sb: SupabaseClient,
  token: string | null,
): Promise<{ id: string; nome: string; email: string; escola_id?: string; serie_id?: string } | null> {
  if (!token) return null;
  const FIELDS = "id, nome, email, escola_id, serie_id";

  // 1. Legacy professora_sessoes
  const { data: sessao } = await sb
    .from("professora_sessoes").select("professora_id, expira_em")
    .eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const s = sessao as any;
  if (s && new Date(s.expira_em) >= new Date()) {
    const { data } = await sb.from("professoras").select(FIELDS).eq("id", s.professora_id).maybeSingle();
    if (data) return data as { id: string; nome: string; email: string; escola_id?: string; serie_id?: string };
  }

  // 2. Sessão unificada
  const user = await resolveUsuario(sb, token);
  if (!user) return null;
  const roles: string[] = user.papeis?.length ? user.papeis : (user.papel ? [user.papel] : []);
  if (!roles.includes("professora") && !roles.includes("professora_assistente")) return null;

  // Busca por ID, depois por email
  const { data: prof } = await sb.from("professoras").select(FIELDS).eq("id", user.id).maybeSingle();
  if (prof) return prof as { id: string; nome: string; email: string; escola_id?: string; serie_id?: string };

  const { data: profByEmail } = await sb.from("professoras").select(FIELDS).eq("email", user.email).maybeSingle();
  if (profByEmail) return profByEmail as { id: string; nome: string; email: string; escola_id?: string; serie_id?: string };

  // Auto-provision (escopado por escola)
  if (!user.escola_id) return null;
  const { data: nova } = await sb.from("professoras")
    .insert({ nome: user.nome, email: user.email, escola_id: user.escola_id })
    .select(FIELDS).single();
  return nova as { id: string; nome: string; email: string; escola_id?: string; serie_id?: string } | null;
}

/**
 * Resolve sessão de gerente: legacy gerente_sessoes + fallback unificada.
 */
export async function resolveGerente(
  sb: SupabaseClient,
  token: string | null,
): Promise<{ id: string; nome: string; email: string; escola_id?: string } | null> {
  if (!token) return null;

  // 1. Legacy gerente_sessoes
  const { data: sessao } = await sb
    .from("gerente_sessoes").select("gerente_id, expira_em")
    .eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const s = sessao as any;
  if (s && new Date(s.expira_em) >= new Date()) {
    const { data } = await sb.from("gerentes").select("id, nome, email, escola_id").eq("id", s.gerente_id).maybeSingle();
    if (data) return data as { id: string; nome: string; email: string; escola_id?: string };
  }

  // 2. Sessão unificada
  const user = await resolveUsuario(sb, token);
  if (!user) return null;
  const roles: string[] = user.papeis?.length ? user.papeis : (user.papel ? [user.papel] : []);
  if (!roles.includes("gerente") && !roles.includes("diretor") && !roles.includes("financeiro")) return null;

  const { data: ger } = await sb.from("gerentes").select("id, nome, email, escola_id").eq("email", user.email).maybeSingle();
  if (ger) return ger as { id: string; nome: string; email: string; escola_id?: string };
  return { id: user.id, nome: user.nome, email: user.email, escola_id: user.escola_id };
}

/**
 * Resolve sessão de secretaria/equipe: legacy + fallback unificada.
 * Inclui features baseadas nos papéis do usuário.
 */
export async function resolveSecretaria(
  sb: SupabaseClient,
  token: string | null,
): Promise<{ id: string; nome: string; email: string; escola_id?: string; features: string[] } | null> {
  if (!token) return null;

  // 1. Legacy secretaria_sessoes
  const { data: sessao } = await sb
    .from("secretaria_sessoes").select("secretaria_id, expira_em")
    .eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const s = sessao as any;
  if (s && new Date(s.expira_em) >= new Date()) {
    const { data } = await sb.from("secretarias").select("id, nome, email, features, escola_id").eq("id", s.secretaria_id).maybeSingle();
    // deno-lint-ignore no-explicit-any
    if (data) return { ...data, features: (data as any).features || ["atestados"] } as any;
  }

  // 2. Sessão unificada
  const user = await resolveUsuario(sb, token);
  if (!user) return null;
  const roles: string[] = user.papeis?.length ? user.papeis : (user.papel ? [user.papel] : []);
  const secRoles = ["secretaria", "comercial", "financeiro", "diretor", "manutencao", "impressao", "nutricionista", "almoxarifado"];
  if (!roles.some(r => secRoles.includes(r))) return null;

  // Tenta registro legado
  const { data: sec } = await sb.from("secretarias").select("id, nome, email, features, escola_id").eq("email", user.email).maybeSingle();
  if (sec) {
    // deno-lint-ignore no-explicit-any
    const feats = new Set<string>((sec as any).features || ["atestados"]);
    if (roles.includes("nutricionista")) feats.add("cozinha");
    if (roles.includes("almoxarifado")) feats.add("almoxarifado");
    return { ...sec, features: Array.from(feats) } as { id: string; nome: string; email: string; escola_id?: string; features: string[] };
  }

  // Constrói features a partir dos papéis
  const features: string[] = [];
  if (roles.includes("secretaria")) features.push("atestados");
  if (roles.includes("comercial")) features.push("crm", "templates", "metas");
  if (roles.includes("financeiro") || roles.includes("diretor")) features.push("financeiro");
  if (roles.includes("manutencao")) features.push("manutencao");
  if (roles.includes("impressao")) features.push("impressao");
  if (roles.includes("nutricionista")) features.push("cozinha");
  if (roles.includes("almoxarifado")) features.push("almoxarifado");
  return { id: user.id, nome: user.nome, email: user.email, escola_id: user.escola_id, features: features.length ? features : ["atestados"] };
}

/**
 * Resolve almoxarifado (secretaria com feature 'almoxarifado').
 */
export async function resolveAlmoxarifado(
  sb: SupabaseClient,
  token: string | null,
): Promise<{ id: string; nome: string; email: string; escola_id?: string; features: string[] } | null> {
  const sec = await resolveSecretaria(sb, token);
  if (sec && sec.features.includes("almoxarifado")) return sec;
  return null;
}

// ── Upload file to Supabase Storage ──
export async function uploadArquivo(
  sb: SupabaseClient,
  bucket: string,
  ownerId: string,
  base64: string,
  mime: string,
  opts?: { private?: boolean; ttlSeconds?: number }
): Promise<{ url: string; path: string } | { error: string }> {
  // Validate file size before decoding (max 10MB)
  const estimatedBytes = (base64.length * 3) / 4;
  if (estimatedBytes > 10 * 1024 * 1024) {
    return { error: 'Arquivo muito grande (máx 10MB)' };
  }
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1] || "jpg";
  const fileName = `${ownerId}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(fileName, bytes, { contentType: mime, upsert: false });
  if (error) return { error: error.message };
  // Bucket privado: retorna signed URL com TTL configurável (default 7 dias).
  // Caller deve guardar o `path` e regenerar URL via getSignedFileUrl quando expirar.
  if (opts?.private) {
    const ttl = opts.ttlSeconds ?? 60 * 60 * 24 * 7;
    const { data: signed, error: errSign } = await sb.storage.from(bucket).createSignedUrl(fileName, ttl);
    if (errSign) return { error: errSign.message };
    return { url: signed.signedUrl, path: fileName };
  }
  const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(fileName);
  return { url: publicUrl, path: fileName };
}

/**
 * Gera signed URL fresh para um arquivo em bucket privado.
 * Use no read-side (handlers que listam) pra que UI sempre receba URL válida.
 */
export async function getSignedFileUrl(
  sb: SupabaseClient,
  bucket: string,
  path: string,
  ttlSeconds = 60 * 60 * 24 * 7,
): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
