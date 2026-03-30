// ═══════════════════════════════════════════════════════════════
//  Shared: Authentication helpers — hashing, tokens, sessions
// ═══════════════════════════════════════════════════════════════

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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
export async function verificarSenhaAuto(senha: string, stored: string): Promise<boolean> {
  if (stored.startsWith("v1:")) return verificarSenhaV1(senha, stored);
  return verificarSenha(senha, stored);
}

// ── Generate session token (64 hex chars) ──
export function gerarToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Create session in a table ──
export async function criarSessao(
  sb: SupabaseClient,
  table: string,
  userIdField: string,
  userId: string,
  days = 7
): Promise<string> {
  const token = gerarToken();
  await sb.from(table).insert({
    [userIdField]: userId,
    token,
    expira_em: new Date(Date.now() + days * 86400000).toISOString(),
  });
  return token;
}

// ── Validate session from a table ──
export async function validarSessao(
  sb: SupabaseClient,
  table: string,
  userTable: string,
  userIdField: string,
  token: string | null,
  userFields = "id, nome, email"
): Promise<{ id: string; nome: string; email: string } | null> {
  if (!token) return null;
  const { data } = await sb
    .from(table)
    .select(`${userIdField}, expira_em, ${userTable}(${userFields})`)
    .eq("token", token)
    .single();
  if (!data) return null;
  if (new Date(data.expira_em) < new Date()) return null;
  return (data as any)[userTable] as { id: string; nome: string; email: string };
}

// ── Upload file to Supabase Storage ──
export async function uploadArquivo(
  sb: SupabaseClient,
  bucket: string,
  ownerId: string,
  base64: string,
  mime: string
): Promise<{ url: string } | { error: string }> {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1] || "jpg";
  const fileName = `${ownerId}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(fileName, bytes, { contentType: mime, upsert: false });
  if (error) return { error: error.message };
  const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(fileName);
  return { url: publicUrl };
}
