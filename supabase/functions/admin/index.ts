// ═══════════════════════════════════════════════════════════════
//  Maple Bear RS — Edge Function: admin (v2 — Router Pattern)
//  Superadmin: gestão de escolas, planos, módulos
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, validateInput, auth, type Context } from "../_shared/router.ts";
import { successResponse, errorResponse, AppError } from "../_shared/errors.ts";
import { getModulosResolvidos } from "../_shared/modulos.ts";
import { createLogger } from "../_shared/logger.ts";
import { hashSenha, verificarSenhaAuto, gerarToken, criarSessao } from "../_shared/auth.ts";
import type { Schema } from "../_shared/validation.ts";

const log = createLogger("admin");

// ── Admin auth middleware ──
const authAdmin = auth("admin_sessoes", "admins", "id, nome, email");

// ── Validation schemas ──
const loginSchema: Schema = { email: { required: true, type: 'email' }, senha: { required: true, type: 'string', minLength: 6 } };
const setupSchema: Schema = { nome: { required: true, type: 'string', minLength: 2 }, email: { required: true, type: 'email' }, senha: { required: true, type: 'string', minLength: 6 } };
const idSchema: Schema = { id: { required: true, type: 'uuid' } };
const escolaIdSchema: Schema = { escola_id: { required: true, type: 'uuid' } };

// ═══ ROUTER ═══
const router = new Router("admin");
router.useGlobal(rateLimit());

// ── Public: Setup check ──
router.on("admin_setup_check", async (ctx) => {
  const { count } = await ctx.sb.from("admins").select("*", { count: "exact", head: true });
  return successResponse({ needs_setup: (count ?? 0) === 0 });
});

// ── Public: Setup ──
router.on("admin_setup", validateInput(setupSchema), async (ctx) => {
  const { nome, email, senha } = ctx.body as { nome: string; email: string; senha: string };
  const { count } = await ctx.sb.from("admins").select("*", { count: "exact", head: true });
  if ((count ?? 0) > 0) throw new AppError("CONFLICT", "Setup já realizado. Faça login.");
  const senha_hash = await hashSenha(senha);
  const { data: admin, error } = await ctx.sb.from("admins").insert({ nome, email, senha_hash }).select("id").single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  const tkn = gerarToken();
  await ctx.sb.from("admin_sessoes").insert({ admin_id: admin.id, token: tkn, expira_em: new Date(Date.now() + 7 * 86400000).toISOString() });
  log.info("Admin setup completed", { user_id: admin.id });
  return successResponse({ token: tkn, nome, email });
});

// ── Public: Login ──
router.on("admin_login", rateLimit({ windowMs: 60000, maxRequests: 5 }), validateInput(loginSchema), async (ctx) => {
  const { email, senha } = ctx.body as { email: string; senha: string };
  const { data: admin } = await ctx.sb.from("admins").select("id, nome, email, senha_hash, ativo").eq("email", email).single();
  if (!admin) throw new AppError("AUTH_INVALID", "Credenciais inválidas.");
  if (!admin.ativo) throw new AppError("FORBIDDEN", "Conta desativada.");
  if (!(await verificarSenhaAuto(senha, admin.senha_hash))) throw new AppError("AUTH_INVALID", "Credenciais inválidas.");
  const tkn = gerarToken();
  await ctx.sb.from("admin_sessoes").insert({ admin_id: admin.id, token: tkn, expira_em: new Date(Date.now() + 7 * 86400000).toISOString() });
  log.info("Admin login", { user_id: admin.id, action: "admin_login" });
  return successResponse({ token: tkn, nome: admin.nome, email: admin.email });
});

// ── Auth: Logout ──
router.on("admin_logout", authAdmin, async (ctx) => {
  await ctx.sb.from("admin_sessoes").delete().eq("token", ctx.body._token);
  return successResponse({ success: true });
});

// ── Auth: Perfil ──
router.on("admin_perfil", authAdmin, async (ctx) => {
  return successResponse({ nome: ctx.user!.nome, email: ctx.user!.email });
});

// ── Auth: Módulos list ──
router.on("modulos_list", authAdmin, async (ctx) => {
  const { data } = await ctx.sb.from("modulos").select("id, slug, nome, descricao, icone, grupo, ordem, portais, ativo").order("ordem", { ascending: true });
  return successResponse(data ?? []);
});

// ── Auth: Planos ──
router.on("planos_list", authAdmin, async (ctx) => {
  const { data } = await ctx.sb.from("planos").select("id, slug, nome, descricao, preco_mensal, preco_anual, ordem, ativo").order("ordem", { ascending: true });
  return successResponse(data ?? []);
});

router.on("planos_create", authAdmin, async (ctx) => {
  const { slug, nome, descricao, preco_mensal, preco_anual, ordem } = ctx.body as any;
  if (!slug || !nome) throw new AppError("VALIDATION_FAILED", "Slug e nome obrigatórios.");
  const { data, error } = await ctx.sb.from("planos").insert({ slug, nome, descricao, preco_mensal, preco_anual, ordem: ordem ?? 0 }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("planos_update", authAdmin, validateInput(idSchema), async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  delete fields.action; delete fields._token;
  const { error } = await ctx.sb.from("planos").update(fields).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ── Auth: Plano módulos ──
router.on("plano_modulos_list", authAdmin, async (ctx) => {
  const { plano_id } = ctx.body as any;
  if (!plano_id) throw new AppError("VALIDATION_FAILED", "plano_id obrigatório.");
  const { data } = await ctx.sb.from("plano_modulos").select("modulo_id, modulos(slug, nome, icone, grupo)").eq("plano_id", plano_id);
  return successResponse(data ?? []);
});

router.on("plano_modulos_set", authAdmin, async (ctx) => {
  const { plano_id, modulo_ids } = ctx.body as { plano_id: string; modulo_ids: string[] };
  if (!plano_id || !Array.isArray(modulo_ids)) throw new AppError("VALIDATION_FAILED", "plano_id e modulo_ids obrigatórios.");
  await ctx.sb.from("plano_modulos").delete().eq("plano_id", plano_id);
  if (modulo_ids.length > 0) {
    const { error } = await ctx.sb.from("plano_modulos").insert(modulo_ids.map(mid => ({ plano_id, modulo_id: mid })));
    if (error) throw new AppError("BAD_REQUEST", error.message);
  }
  return successResponse({ success: true });
});

// ── Auth: Escolas ──
router.on("escolas_list", authAdmin, async (ctx) => {
  const { data } = await ctx.sb.from("escolas").select("id, nome, cnpj, slug, plano_id, plano_inicio, plano_fim, contato_nome, contato_email, contato_telefone, tema, ativo, criado_em, planos(slug, nome)").order("criado_em", { ascending: true });
  return successResponse(data ?? []);
});

router.on("escolas_create", authAdmin, async (ctx) => {
  const { nome, cnpj, slug, plano_id, contato_nome, contato_email, contato_telefone, tema } = ctx.body as any;
  if (!nome) throw new AppError("VALIDATION_FAILED", "Nome obrigatório.");
  const { data, error } = await ctx.sb.from("escolas").insert({ nome, cnpj, slug, plano_id, contato_nome, contato_email, contato_telefone, tema, plano_inicio: plano_id ? new Date().toISOString().split("T")[0] : null }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("Escola criada", { metadata: { escola: nome } });
  return successResponse(data);
});

router.on("escolas_update", authAdmin, validateInput(idSchema), async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  delete fields.action; delete fields._token;
  const { error } = await ctx.sb.from("escolas").update(fields).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("escolas_delete", authAdmin, validateInput(idSchema), async (ctx) => {
  const { error } = await ctx.sb.from("escolas").update({ ativo: false }).eq("id", (ctx.body as any).id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ── Auth: Escola módulos ──
router.on("escola_modulos_get", authAdmin, validateInput(escolaIdSchema), async (ctx) => {
  const resolvidos = await getModulosResolvidos(ctx.sb, (ctx.body as any).escola_id);
  return successResponse(resolvidos);
});

router.on("escola_modulos_set", authAdmin, async (ctx) => {
  const { escola_id, modulos: moduloToggles } = ctx.body as { escola_id: string; modulos: Record<string, boolean> };
  if (!escola_id || !moduloToggles) throw new AppError("VALIDATION_FAILED", "escola_id e modulos obrigatórios.");
  const slugs = Object.keys(moduloToggles);
  const { data: modulosDb } = await ctx.sb.from("modulos").select("id, slug").in("slug", slugs);
  if (!modulosDb) throw new AppError("NOT_FOUND", "Nenhum módulo encontrado.");
  const { data: escola } = await ctx.sb.from("escolas").select("plano_id").eq("id", escola_id).single();
  let planoSlugs = new Set<string>();
  if (escola?.plano_id) {
    const { data: pm } = await ctx.sb.from("plano_modulos").select("modulos(slug)").eq("plano_id", escola.plano_id);
    planoSlugs = new Set((pm || []).map((r: any) => r.modulos?.slug).filter(Boolean));
  }
  const moduloIds = modulosDb.map(m => m.id);
  await ctx.sb.from("escola_modulos").delete().eq("escola_id", escola_id).in("modulo_id", moduloIds);
  const inserts: Array<{ escola_id: string; modulo_id: string; habilitado: boolean }> = [];
  for (const m of modulosDb) {
    if (moduloToggles[m.slug] !== planoSlugs.has(m.slug)) {
      inserts.push({ escola_id, modulo_id: m.id, habilitado: moduloToggles[m.slug] });
    }
  }
  if (inserts.length > 0) {
    const { error } = await ctx.sb.from("escola_modulos").insert(inserts);
    if (error) throw new AppError("BAD_REQUEST", error.message);
  }
  log.info("Escola módulos atualizados", { metadata: { escola_id, overrides: inserts.length } });
  return successResponse({ success: true, overrides: inserts.length });
});

router.on("escola_modulos_reset", authAdmin, validateInput(escolaIdSchema), async (ctx) => {
  await ctx.sb.from("escola_modulos").delete().eq("escola_id", (ctx.body as any).escola_id);
  return successResponse({ success: true });
});

// ── Auth: Admins CRUD ──
router.on("admins_list", authAdmin, async (ctx) => {
  const { data } = await ctx.sb.from("admins").select("id, nome, email, ativo, criado_em").order("criado_em");
  return successResponse(data ?? []);
});

router.on("admins_create", authAdmin, validateInput(setupSchema), async (ctx) => {
  const { nome, email, senha } = ctx.body as { nome: string; email: string; senha: string };
  const senha_hash = await hashSenha(senha);
  const { data, error } = await ctx.sb.from("admins").insert({ nome, email, senha_hash }).select("id, nome, email").single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("Admin criado", { metadata: { email } });
  return successResponse(data);
});

router.on("admins_update", authAdmin, validateInput(idSchema), async (ctx) => {
  const { id, nome, email, senha, ativo } = ctx.body as any;
  const fields: any = {};
  if (nome !== undefined) fields.nome = nome;
  if (email !== undefined) fields.email = email;
  if (ativo !== undefined) fields.ativo = ativo;
  if (senha) fields.senha_hash = await hashSenha(senha);
  const { error } = await ctx.sb.from("admins").update(fields).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ── Auth: Dashboard stats ──
router.on("dashboard_stats", authAdmin, async (ctx) => {
  const [escolasRes, usoRes, modulosRes, lgpdRes, ticketsRes] = await Promise.all([
    ctx.sb.from("escolas").select("id, nome, slug, plano_id, plano_fim, ativo, criado_em, planos(nome, preco_mensal)"),
    ctx.sb.from("escola_uso").select("escola_id, recurso, uso_atual"),
    ctx.sb.from("escola_modulos").select("modulo_id, modulos(nome)").eq("habilitado", true),
    ctx.sb.from("lgpd_solicitacoes").select("id", { count: "exact", head: true }).eq("status", "pendente"),
    ctx.sb.from("tickets").select("id", { count: "exact", head: true }).eq("status", "aberto"),
  ]);
  const escolas = escolasRes.data ?? [];
  const uso = usoRes.data ?? [];
  const ativas = escolas.filter((e: any) => e.ativo);
  const totalAlunos = uso.filter((u: any) => u.recurso === "max_alunos").reduce((s: number, u: any) => s + (u.uso_atual || 0), 0);
  const mrr = ativas.reduce((s: number, e: any) => s + ((e.planos as any)?.preco_mensal || 0), 0);
  // Módulos mais usados
  const modCount: Record<string, { nome: string; count: number }> = {};
  for (const m of (modulosRes.data ?? [])) {
    const nome = (m.modulos as any)?.nome || "?";
    modCount[nome] = modCount[nome] || { nome, count: 0 };
    modCount[nome].count++;
  }
  const topModulos = Object.values(modCount).sort((a, b) => b.count - a.count).slice(0, 5);
  // Alertas
  const now = Date.now();
  const d30 = 30 * 86400000;
  const expirando = ativas.filter((e: any) => e.plano_fim && (new Date(e.plano_fim).getTime() - now) < d30 && (new Date(e.plano_fim).getTime() - now) > 0);
  const expirado = ativas.filter((e: any) => e.plano_fim && new Date(e.plano_fim).getTime() < now);
  return successResponse({
    total_escolas: ativas.length,
    total_alunos: totalAlunos,
    mrr,
    top_modulos: topModulos,
    tickets_abertos: ticketsRes.count ?? 0,
    lgpd_pendentes: lgpdRes.count ?? 0,
    escolas_expirando: expirando.map((e: any) => ({ id: e.id, nome: e.nome, plano_fim: e.plano_fim })),
    escolas_expiradas: expirado.map((e: any) => ({ id: e.id, nome: e.nome, plano_fim: e.plano_fim })),
  });
});

// ── Auth: Escola uso list ──
router.on("escola_uso_list", authAdmin, async (ctx) => {
  const [escolasRes, usoRes, limitesRes] = await Promise.all([
    ctx.sb.from("escolas").select("id, nome, slug, subdominio, supabase_url, plano_id, plano_fim, ativo, planos(nome, slug)").order("nome"),
    ctx.sb.from("escola_uso").select("escola_id, recurso, uso_atual, atualizado_em"),
    ctx.sb.from("plano_limites").select("plano_id, recurso, limite"),
  ]);
  const escolas = escolasRes.data ?? [];
  const usoMap: Record<string, Record<string, any>> = {};
  for (const u of (usoRes.data ?? [])) {
    usoMap[u.escola_id] = usoMap[u.escola_id] || {};
    usoMap[u.escola_id][u.recurso] = u;
  }
  const limMap: Record<string, Record<string, number>> = {};
  for (const l of (limitesRes.data ?? [])) {
    limMap[l.plano_id] = limMap[l.plano_id] || {};
    limMap[l.plano_id][l.recurso] = l.limite;
  }
  const result = escolas.map((e: any) => ({
    ...e,
    uso: usoMap[e.id] || {},
    limites: e.plano_id ? (limMap[e.plano_id] || {}) : {},
  }));
  return successResponse(result);
});

// ── Auth: LGPD solicitações ──
router.on("lgpd_solicitacoes_list", authAdmin, async (ctx) => {
  const { status: filtro } = ctx.body as any;
  let q = ctx.sb.from("lgpd_solicitacoes").select("*").order("solicitado_em", { ascending: false });
  if (filtro) q = q.eq("status", filtro);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("lgpd_solicitacoes_process", authAdmin, async (ctx) => {
  const { id, acao, motivo_recusa } = ctx.body as any;
  if (!id || !acao) throw new AppError("VALIDATION_FAILED", "id e acao obrigatórios.");
  const { data: sol } = await ctx.sb.from("lgpd_solicitacoes").select("*").eq("id", id).single();
  if (!sol) throw new AppError("NOT_FOUND", "Solicitação não encontrada.");
  if (sol.status !== "pendente") throw new AppError("CONFLICT", "Solicitação já processada.");
  if (acao === "aprovar") {
    let dados_exportados = null;
    if (sol.tipo === "exportar_dados") {
      const { data } = await ctx.sb.rpc("lgpd_exportar_dados", { p_email: sol.email });
      dados_exportados = data;
    } else if (sol.tipo === "excluir_dados") {
      await ctx.sb.rpc("lgpd_anonimizar", { p_email: sol.email });
    }
    await ctx.sb.from("lgpd_solicitacoes").update({ status: "concluida", dados_exportados, processado_por: ctx.user!.email, processado_em: new Date().toISOString() }).eq("id", id);
  } else {
    await ctx.sb.from("lgpd_solicitacoes").update({ status: "recusada", motivo_recusa, processado_por: ctx.user!.email, processado_em: new Date().toISOString() }).eq("id", id);
  }
  log.info("LGPD solicitação processada", { metadata: { id, acao } });
  return successResponse({ success: true });
});

// ── Auth: System health ──
router.on("system_health", authAdmin, async (ctx) => {
  const { data: escolas } = await ctx.sb.from("escolas").select("id, nome, slug, supabase_url, ativo").eq("ativo", true).not("supabase_url", "is", null);
  const checks = await Promise.allSettled((escolas ?? []).map(async (e: any) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(`${e.supabase_url}/functions/v1/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      const body = await r.json();
      return { escola_id: e.id, nome: e.nome, slug: e.slug, ...body };
    } catch (err) {
      clearTimeout(timer);
      return { escola_id: e.id, nome: e.nome, slug: e.slug, status: "unhealthy", error: (err as Error).message };
    }
  }));
  return successResponse(checks.map((c) => c.status === "fulfilled" ? c.value : { status: "unhealthy", error: "timeout" }));
});

// ── Auth: Tickets ──
router.on("tickets_list", authAdmin, async (ctx) => {
  const { status: filtro, escola_id } = ctx.body as any;
  let q = ctx.sb.from("tickets").select("*, escolas(nome)").order("criado_em", { ascending: false });
  if (filtro) q = q.eq("status", filtro);
  if (escola_id) q = q.eq("escola_id", escola_id);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("ticket_respond", authAdmin, async (ctx) => {
  const { id, resposta } = ctx.body as any;
  if (!id || !resposta) throw new AppError("VALIDATION_FAILED", "id e resposta obrigatórios.");
  const { error } = await ctx.sb.from("tickets").update({ resposta, respondido_por: ctx.user!.email, status: "respondido" }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("Ticket respondido", { metadata: { id } });
  return successResponse({ success: true });
});

router.on("ticket_close", authAdmin, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  const { error } = await ctx.sb.from("tickets").update({ status: "fechado" }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ═══ SERVE ═══
serve(async (req: Request) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
