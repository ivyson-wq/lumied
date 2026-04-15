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

export async function resolveEscolaId(
  req: Request,
  sb: SupabaseClient,
  session?: { escola_id?: string | null } | null,
): Promise<string | null> {
  // 1. Sessão
  if (session?.escola_id) return session.escola_id;

  // 2. Subdomínio
  const host = extractHost(req);
  if (host) {
    const slug = extractSlug(host);
    if (slug) {
      const { data } = await sb.from("escolas").select("id").eq("slug", slug).eq("ativo", true).maybeSingle();
      if (data?.id) return data.id;
    }
  }

  // 3. Fallback
  return getEscolaPadrao(sb);
}

function extractHost(req: Request): string | null {
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
function extractSlug(host: string): string | null {
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
