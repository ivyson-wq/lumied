// ═══════════════════════════════════════════════════════════════
//  Shared: Resolução de escola por request (multi-tenant)
// ═══════════════════════════════════════════════════════════════
//
//  Ordem de resolução (primeira que responder):
//    1. Sessão autenticada (session.escola_id)
//    2. Subdomínio da request (Origin/Referer/Host → escolas.slug)
//    3. Escola default (primeira ativa) — fallback para single-tenant legado
//
//  Use em qualquer edge function que precise filtrar dados por escola.
// ═══════════════════════════════════════════════════════════════

import { SupabaseClient } from "@supabase/supabase-js";
import { getEscolaPadrao } from "./modulos.ts";

/**
 * Resolve escola_id da request.
 * Ordem:
 *   1. session.escola_id passado explicitamente
 *   2. Token em body._token / body._prof_token / body._staff_token / Authorization header
 *      → busca em gerente_sessoes / professora_sessoes / secretaria_sessoes / sessoes
 *   3. Subdomínio da request (Origin/Referer/Host → escolas.slug)
 *   4. Single-tenant fallback (`getEscolaPadrao` retorna null se >1 escola)
 */
export async function resolveEscolaId(
  req: Request,
  sb: SupabaseClient,
  session?: { escola_id?: string | null } | null,
  body?: Record<string, unknown> | null,
): Promise<string | null> {
  // 1. Sessão explícita
  if (session?.escola_id) return session.escola_id;

  // 2. Token (body ou Authorization header) → deriva escola_id da sessão
  const token = extractToken(req, body);
  if (token) {
    const escolaFromToken = await resolveFromToken(sb, token);
    if (escolaFromToken) return escolaFromToken;
  }

  // 3. Subdomínio
  const host = extractHost(req);
  if (host) {
    const slug = extractSlug(host);
    if (slug) {
      const { data } = await sb.from("escolas").select("id").eq("slug", slug).eq("ativo", true).maybeSingle();
      if (data?.id) return data.id;
    }
  }

  // 4. Fallback (single-tenant legado apenas)
  return getEscolaPadrao(sb);
}

function extractToken(req: Request, body?: Record<string, unknown> | null): string | null {
  if (body) {
    const t = (body._token as string) || (body._prof_token as string) || (body._staff_token as string) || (body._aluno_token as string);
    if (t && typeof t === "string" && t.length > 0 && t.length < 200) return t;
  }
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  // Ignorar anon/service-role JWTs do Supabase (começam com eyJ e são longos)
  if (m && m[1] && m[1].length < 200 && !m[1].startsWith("eyJ")) return m[1];
  return null;
}

async function resolveFromToken(sb: SupabaseClient, token: string): Promise<string | null> {
  const now = new Date();
  const isExp = (s: unknown) => !!s && new Date(s as string) >= now;

  // gerente_sessoes → gerentes.escola_id
  const { data: gs } = await sb.from("gerente_sessoes")
    .select("expira_em, gerentes(escola_id)")
    .eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const g = gs as any;
  if (g && isExp(g.expira_em) && g.gerentes?.escola_id) return g.gerentes.escola_id as string;

  // professora_sessoes
  const { data: ps } = await sb.from("professora_sessoes")
    .select("expira_em, professoras(escola_id)")
    .eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const p = ps as any;
  if (p && isExp(p.expira_em) && p.professoras?.escola_id) return p.professoras.escola_id as string;

  // secretaria_sessoes
  const { data: ss } = await sb.from("secretaria_sessoes")
    .select("expira_em, secretarias(escola_id)")
    .eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const s = ss as any;
  if (s && isExp(s.expira_em) && s.secretarias?.escola_id) return s.secretarias.escola_id as string;

  // sessoes (unificada) → usuarios.escola_id
  const { data: us } = await sb.from("sessoes")
    .select("expira_em, usuarios(escola_id)")
    .eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const u = us as any;
  if (u && isExp(u.expira_em) && u.usuarios?.escola_id) return u.usuarios.escola_id as string;

  return null;
}

export function extractHost(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin) try { return new URL(origin).hostname; } catch { /* */ }
  const referer = req.headers.get("referer");
  if (referer) try { return new URL(referer).hostname; } catch { /* */ }
  const host = req.headers.get("host") || req.headers.get("x-forwarded-host");
  if (host) return host.split(":")[0];
  return null;
}

/**
 * Extrai slug do subdomínio. Ex:
 *   maplebearcaxias.lumied.com.br → "maplebearcaxias"
 *   demo.lumied.com.br            → "demo"
 *   lumied.com.br                 → null (landing)
 *   localhost                     → null
 */
export function extractSlug(host: string): string | null {
  const h = host.toLowerCase();
  // Ignorar landing, admin central, API
  if (h === "lumied.com.br" || h === "www.lumied.com.br") return null;
  if (h === "admin.lumied.com.br") return null;
  if (h.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+/.test(h)) return null;

  // Para *.lumied.com.br extrai o primeiro segmento
  const m = h.match(/^([a-z0-9-]+)\.lumied\.com\.br$/);
  if (m) return m[1];

  // Custom domains (ex: portal.suaescola.com.br) — retorna o primeiro segmento
  // (a lookup buscará por slug; se a escola tem custom domain, precisa cadastrá-lo separado)
  return null;
}
