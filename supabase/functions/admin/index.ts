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
import type { Schema } from "../_shared/validation.ts";

const log = createLogger("admin");

// ── Crypto helpers ──
async function hashSenha(senha: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return `${saltHex}:${Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("")}`;
}

async function verificarSenha(senha: string, stored: string): Promise<boolean> {
  try {
    const [saltHex, storedHash] = stored.split(":");
    const salt = Uint8Array.from((saltHex.match(/.{2}/g) || []).map(h => parseInt(h, 16)));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("") === storedHash;
  } catch { return false; }
}

function gerarToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("");
}

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
  if (!(await verificarSenha(senha, admin.senha_hash))) throw new AppError("AUTH_INVALID", "Credenciais inválidas.");
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

// ═══ SERVE ═══
serve(async (req: Request) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
