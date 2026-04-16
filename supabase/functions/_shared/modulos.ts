// ═══════════════════════════════════════════════════════════════
//  Shared: Resolução de módulos habilitados por escola
//  Lógica: plano_modulos (template) + escola_modulos (override)
// ═══════════════════════════════════════════════════════════════

import { SupabaseClient } from "@supabase/supabase-js";
import { getCorsHeaders } from "./cors.ts";

/**
 * Retorna o Set de slugs de módulos habilitados para uma escola.
 *
 * Lógica:
 * 1. Busca o plano da escola
 * 2. Busca módulos incluídos no plano (via plano_modulos)
 * 3. Aplica overrides da escola (escola_modulos tem prioridade)
 *
 * Se a escola não tem plano, retorna apenas os overrides habilitados.
 */
export async function getModulosHabilitados(
  sb: SupabaseClient,
  escolaId: string
): Promise<Set<string>> {
  // 1. Busca escola + plano
  const { data: escola } = await sb
    .from("escolas")
    .select("plano_id")
    .eq("id", escolaId)
    .single();

  const result = new Set<string>();

  // 2. Módulos do plano (template)
  if (escola?.plano_id) {
    const { data: planoModulos } = await sb
      .from("plano_modulos")
      .select("modulo_id, modulos(slug)")
      .eq("plano_id", escola.plano_id);

    for (const pm of planoModulos || []) {
      // deno-lint-ignore no-explicit-any
      const slug = (pm as any).modulos?.slug;
      if (slug) result.add(slug);
    }
  }

  // 3. Overrides da escola (prioridade sobre plano)
  const { data: overrides } = await sb
    .from("escola_modulos")
    .select("habilitado, modulos(slug)")
    .eq("escola_id", escolaId);

  for (const ov of overrides || []) {
    // deno-lint-ignore no-explicit-any
    const slug = (ov as any).modulos?.slug;
    if (!slug) continue;
    if (ov.habilitado) result.add(slug);
    else result.delete(slug);
  }

  return result;
}

/**
 * Busca a escola padrão (única ativa em single-tenant).
 *
 * SEGURANÇA: Em multi-tenant (>1 escolas ativas), esta função retorna `null`
 * para forçar o caller a usar autenticação/Origin header. Retornar a primeira
 * escola ativa cegamente causaria vazamento cross-tenant (incidente 16/04/2026).
 *
 * Callers devem:
 *   1. Preferir session.escola_id quando autenticado
 *   2. Usar resolveEscolaId() que já faz Origin → slug → escola_id
 *   3. Se nada resolver, retornar 400 "Escola não identificada"
 */
export async function getEscolaPadrao(sb: SupabaseClient): Promise<string | null> {
  const { data, count } = await sb
    .from("escolas")
    .select("id", { count: "exact" })
    .eq("ativo", true)
    .limit(2); // precisa saber se é 1 ou 2+
  if (!data?.length) return null;
  if ((count ?? data.length) > 1) {
    // Multi-tenant: não retorna fallback para evitar leak cross-tenant.
    return null;
  }
  return data[0].id;
}

/**
 * Verifica se um módulo está habilitado. Retorna erro 403 se não estiver.
 */
export function requireModulo(
  modulos: Set<string>,
  slug: string
): Response | null {
  if (modulos.has(slug)) return null;
  return new Response(
    JSON.stringify({
      error: "Este recurso não está disponível no plano atual.",
      modulo_required: slug,
    }),
    {
      status: 403,
      headers: getCorsHeaders(),
    }
  );
}

/**
 * Retorna todos os módulos resolvidos para uma escola (para o frontend).
 * Inclui informação de cada módulo + se está habilitado.
 */
export async function getModulosResolvidos(
  sb: SupabaseClient,
  escolaId: string
): Promise<Array<{ slug: string; nome: string; icone: string; grupo: string; portais: string[]; habilitado: boolean }>> {
  const habilitados = await getModulosHabilitados(sb, escolaId);

  const { data: todosModulos } = await sb
    .from("modulos")
    .select("slug, nome, icone, grupo, portais, ordem")
    .eq("ativo", true)
    .order("ordem", { ascending: true });

  // deno-lint-ignore no-explicit-any
  return (todosModulos || []).map((m: any) => ({
    slug: m.slug,
    nome: m.nome,
    icone: m.icone,
    grupo: m.grupo,
    portais: m.portais || [],
    habilitado: habilitados.has(m.slug),
  }));
}
