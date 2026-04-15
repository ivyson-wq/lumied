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
import { logAudit } from "../_shared/audit.ts";

const log = createLogger("admin");

// ── Admin auth middleware (also accepts staff tokens as fundador override) ──
async function authAdmin(ctx: Context, next: () => Promise<Response>): Promise<Response> {
  // 1. Try normal admin token
  const token = (ctx.body._token as string) || null;
  if (token) {
    const { data } = await ctx.sb.from("admin_sessoes")
      .select("*, admins(id, nome, email)")
      .eq("token", token).single();
    if (data && new Date(data.expira_em) >= new Date()) {
      // deno-lint-ignore no-explicit-any
      ctx.user = { ...(data as any).admins, tipo: 'admin' };
      return next();
    }
  }
  // 2. Fallback: accept staff token (fundador can access any admin panel)
  const staffToken = (ctx.body._staff_token as string) || token;
  if (staffToken) {
    const { data } = await ctx.sb.from("lumied_staff_sessoes")
      .select("staff_id, expira_em, lumied_staff(id, nome, email, cargo, ativo)")
      .eq("token", staffToken).single();
    if (data && new Date(data.expira_em) >= new Date()) {
      // deno-lint-ignore no-explicit-any
      const staff = (data as any).lumied_staff;
      if (staff?.ativo) {
        ctx.user = { ...staff, tipo: 'staff' };
        return next();
      }
    }
  }
  throw new AppError("AUTH_INVALID", "Sessão inválida.");
}

// ── Validation schemas ──
const loginSchema: Schema = { email: { required: true, type: 'email' }, senha: { required: true, type: 'string', minLength: 6 } };
const setupSchema: Schema = { nome: { required: true, type: 'string', minLength: 2 }, email: { required: true, type: 'email' }, senha: { required: true, type: 'string', minLength: 6 } };
const idSchema: Schema = { id: { required: true, type: 'uuid' } };
const escolaIdSchema: Schema = { escola_id: { required: true, type: 'uuid' } };

// ═══ ROUTER ═══
const router = new Router("admin");
router.useGlobal(rateLimit());

// ── Public: Capturar lead do site comercial ──
router.on("lead_submit", rateLimit({ windowMs: 60000, maxRequests: 5 }), async (ctx) => {
  const { nome_escola, email, telefone, mensagem, utm_source, utm_medium, utm_campaign } = ctx.body as any;
  if (!nome_escola || !email) throw new AppError("VALIDATION_FAILED", "Nome da escola e email são obrigatórios.");

  const ip = ctx.req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ua = ctx.req.headers.get('user-agent') || '';

  // Salvar lead
  const { data: lead, error } = await ctx.sb.from("leads_comerciais").insert({
    nome_escola, email: email.toLowerCase().trim(), telefone: telefone || null,
    mensagem: mensagem || null, utm_source, utm_medium, utm_campaign,
    ip, user_agent: ua, origem: 'site', status: 'novo',
  }).select("id").single();

  if (error) throw new AppError("BAD_REQUEST", error.message);

  // Notificar equipe Lumied por email via Resend
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Lumied Leads <noreply@lumied.com.br>",
          to: ["ivyson@gmail.com"],
          subject: `🔔 Novo Lead: ${nome_escola}`,
          html: `<div style="font-family:sans-serif;max-width:600px;">
            <h2 style="color:#6C63FF;">Novo Lead Comercial</h2>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px;font-weight:bold;">Escola:</td><td style="padding:8px;">${nome_escola}</td></tr>
              <tr><td style="padding:8px;font-weight:bold;">Email:</td><td style="padding:8px;">${email}</td></tr>
              <tr><td style="padding:8px;font-weight:bold;">WhatsApp:</td><td style="padding:8px;">${telefone || '—'}</td></tr>
              ${mensagem ? `<tr><td style="padding:8px;font-weight:bold;">Mensagem:</td><td style="padding:8px;">${mensagem}</td></tr>` : ''}
              <tr><td style="padding:8px;font-weight:bold;">Origem:</td><td style="padding:8px;">${utm_source || 'site'}</td></tr>
            </table>
            <p style="margin-top:16px;"><a href="https://admin.lumied.com.br" style="background:#6C63FF;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Abrir Painel Central</a></p>
          </div>`,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) { console.error("[LEAD] Email error:", e); }
  }

  return successResponse({ success: true, lead_id: lead?.id, message: "Obrigado! Entraremos em contato em até 24h." });
});

// ── Staff: listar leads ──
router.on("leads_list", async (ctx) => {
  const token = (ctx.body._staff_token as string) || null;
  if (!token) throw new AppError("AUTH_REQUIRED", "Token obrigatório.");
  const { data: sess } = await ctx.sb.from("lumied_staff_sessoes").select("expira_em").eq("token", token).single();
  if (!sess || new Date(sess.expira_em) < new Date()) throw new AppError("AUTH_INVALID", "Sessão inválida.");
  const { data } = await ctx.sb.from("leads_comerciais").select("*").order("criado_em", { ascending: false }).limit(100);
  return successResponse(data ?? []);
});

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

// ── Public: Login (admins table + staff fallback) ──
router.on("admin_login", rateLimit({ windowMs: 60000, maxRequests: 5 }), validateInput(loginSchema), async (ctx) => {
  const { email, senha } = ctx.body as { email: string; senha: string };

  // 1. Try admins table
  const { data: admin } = await ctx.sb.from("admins").select("id, nome, email, senha_hash, ativo").eq("email", email).single();
  if (admin) {
    if (!admin.ativo) throw new AppError("AUTH_USER_DISABLED", "Conta desativada.");
    if (!(await verificarSenhaAuto(senha, admin.senha_hash))) throw new AppError("AUTH_BAD_CREDENTIALS", "Credenciais inválidas.");
    const tkn = gerarToken();
    await ctx.sb.from("admin_sessoes").insert({ admin_id: admin.id, token: tkn, expira_em: new Date(Date.now() + 7 * 86400000).toISOString() });
    log.info("Admin login", { user_id: admin.id, action: "admin_login" });
    return successResponse({ token: tkn, nome: admin.nome, email: admin.email });
  }

  // 2. Fallback: try staff (fundador) credentials
  const { data: staff } = await ctx.sb.from("lumied_staff").select("id, nome, email, senha_hash, cargo, ativo").eq("email", email.toLowerCase().trim()).single();
  if (!staff) throw new AppError("AUTH_BAD_CREDENTIALS", "Credenciais inválidas.");
  if (!staff.ativo) throw new AppError("AUTH_USER_DISABLED", "Conta desativada.");
  if (!(await verificarSenhaAuto(senha, staff.senha_hash))) throw new AppError("AUTH_BAD_CREDENTIALS", "Credenciais inválidas.");
  const tkn = gerarToken();
  await ctx.sb.from("lumied_staff_sessoes").insert({ staff_id: staff.id, token: tkn, expira_em: new Date(Date.now() + 7 * 86400000).toISOString() });
  log.info("Staff login via admin panel", { user_id: staff.id, action: "admin_login_staff" });
  // Return _staff_token so frontend stores it and authAdmin can find it
  return successResponse({ token: tkn, nome: staff.nome, email: staff.email, _is_staff: true });
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
  const body = ctx.body as any;
  const { id } = body;
  const ALLOWED = ["slug", "nome", "descricao", "preco_mensal", "preco_anual", "max_alunos", "max_storage_gb", "cor", "ativo", "ordem", "tier"];
  const update: Record<string, unknown> = {};
  for (const k of ALLOWED) if (k in body) update[k] = body[k];
  const { error } = await ctx.sb.from("planos").update(update).eq("id", id);
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
  logAudit(ctx.sb, { ator_tipo: 'gerente', ator_email: ctx.user?.email, recurso: 'plano', recurso_id: plano_id, acao: 'modulos_set', depois: { modulo_ids } });
  return successResponse({ success: true });
});

// ── Auth: Escolas ──
router.on("escolas_list", authAdmin, async (ctx) => {
  const { data } = await ctx.sb.from("escolas").select("id, nome, cnpj, slug, plano_id, plano_inicio, plano_fim, contato_nome, contato_email, contato_telefone, tema, ativo, criado_em, planos(slug, nome)").order("criado_em", { ascending: true });
  return successResponse(data ?? []);
});

router.on("backups_resumo", authAdmin, async (ctx) => {
  // Resumo consolidado: últimos 30 dias, joined com nome da escola
  const dias = Math.min(Number((ctx.body as any).dias || 30), 180);
  const desde = new Date(); desde.setDate(desde.getDate() - dias);
  const { data } = await ctx.sb
    .from("backups_log")
    .select("id, escola_id, data_backup, status, tamanho_bytes, tabelas_inc, linhas_total, iniciado_em, concluido_em, escolas(nome)")
    .gte("data_backup", desde.toISOString().slice(0, 10))
    .order("data_backup", { ascending: false })
    .order("escola_id")
    .limit(500);
  const backups = (data ?? []).map((b: any) => ({ ...b, escola_nome: b.escolas?.nome || null }));
  return successResponse({ backups });
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
  const body = ctx.body as any;
  const { id } = body;
  const ALLOWED = [
    "nome", "cnpj", "slug", "subdominio", "plano_id", "plano",
    "contato_nome", "contato_email", "contato_telefone",
    "telefone", "endereco", "email_contato",
    "tema", "ativo", "plano_inicio", "plano_fim", "expira_em", "status",
  ];
  const update: Record<string, unknown> = {};
  for (const k of ALLOWED) if (k in body) update[k] = body[k];
  const { error } = await ctx.sb.from("escolas").update(update).eq("id", id);
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

  // Get all module IDs by slug
  const slugs = Object.keys(moduloToggles);
  const { data: modulosDb } = await ctx.sb.from("modulos").select("id, slug").in("slug", slugs);
  if (!modulosDb || modulosDb.length === 0) throw new AppError("NOT_FOUND", "Nenhum módulo encontrado.");

  // Delete all existing overrides for this escola, then insert fresh
  await ctx.sb.from("escola_modulos").delete().eq("escola_id", escola_id);

  // Insert all toggles as explicit overrides
  const inserts = modulosDb.map((m: any) => ({
    escola_id,
    modulo_id: m.id,
    habilitado: !!moduloToggles[m.slug],
  }));

  if (inserts.length > 0) {
    const { error } = await ctx.sb.from("escola_modulos").insert(inserts);
    if (error) throw new AppError("BAD_REQUEST", error.message);
  }

  log.info("Escola módulos atualizados", { metadata: { escola_id, total: inserts.length } });
  return successResponse({ success: true, modulos_salvos: inserts.length });
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
  logAudit(ctx.sb, {
    ator_tipo: 'gerente', ator_email: ctx.user?.email,
    recurso: 'lgpd_solicitacao', recurso_id: id,
    acao: acao === 'aprovar' ? `lgpd_${sol.tipo}` : 'lgpd_recusar',
    depois: { email_alvo: sol.email, tipo: sol.tipo, motivo_recusa: motivo_recusa ?? null },
  });
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
  logAudit(ctx.sb, { ator_tipo: 'gerente', ator_email: ctx.user!.email, recurso: 'ticket', recurso_id: id, acao: 'respond' });
  return successResponse({ success: true });
});

router.on("ticket_close", authAdmin, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  const { error } = await ctx.sb.from("tickets").update({ status: "fechado" }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  logAudit(ctx.sb, { ator_tipo: 'gerente', ator_email: ctx.user!.email, recurso: 'ticket', recurso_id: id, acao: 'close' });
  return successResponse({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  LUMIED STAFF — Superusuários (painel central)
// ═══════════════════════════════════════════════════════════════

// Staff auth middleware
async function authStaff(ctx: Context, next: () => Promise<Response>): Promise<Response> {
  const token = (ctx.body._staff_token as string) || null;
  if (!token) throw new AppError("AUTH_REQUIRED", "Token de staff obrigatório.");
  const { data } = await ctx.sb.from("lumied_staff_sessoes")
    .select("staff_id, expira_em, lumied_staff(id, nome, email, cargo, ativo)")
    .eq("token", token).single();
  if (!data) throw new AppError("AUTH_INVALID", "Sessão de staff inválida.");
  if (new Date(data.expira_em) < new Date()) throw new AppError("AUTH_EXPIRED", "Sessão expirada.");
  // deno-lint-ignore no-explicit-any
  const staff = (data as any).lumied_staff;
  if (!staff?.ativo) throw new AppError("FORBIDDEN", "Conta desativada.");
  ctx.user = { ...staff, tipo: 'staff' };
  return next();
}

// Staff login
router.on("staff_login", rateLimit({ windowMs: 60000, maxRequests: 5 }), async (ctx) => {
  const { email, senha } = ctx.body as { email: string; senha: string };
  if (!email || !senha) throw new AppError("VALIDATION_FAILED", "Email e senha obrigatórios.");
  const { data: staff } = await ctx.sb.from("lumied_staff").select("id, nome, email, senha_hash, cargo, ativo").eq("email", email.toLowerCase().trim()).single();
  if (!staff) throw new AppError("AUTH_INVALID", "Credenciais inválidas.");
  if (!staff.ativo) throw new AppError("FORBIDDEN", "Conta desativada.");
  if (!(await verificarSenhaAuto(senha, staff.senha_hash))) throw new AppError("AUTH_INVALID", "Credenciais inválidas.");
  const tkn = gerarToken();
  await ctx.sb.from("lumied_staff_sessoes").insert({ staff_id: staff.id, token: tkn, expira_em: new Date(Date.now() + 7 * 86400000).toISOString() });
  await ctx.sb.from("lumied_staff").update({ ultimo_acesso: new Date().toISOString() }).eq("id", staff.id);
  log.info("Staff login", { staff_id: staff.id, cargo: staff.cargo });
  return successResponse({ token: tkn, nome: staff.nome, email: staff.email, cargo: staff.cargo });
});

// Staff perfil
router.on("staff_perfil", authStaff, async (ctx) => {
  return successResponse({ nome: ctx.user!.nome, email: ctx.user!.email, cargo: (ctx.user as any).cargo });
});

// Staff alterar senha
router.on("staff_alterar_senha", authStaff, async (ctx) => {
  const { senha_atual, senha_nova } = ctx.body as { senha_atual: string; senha_nova: string };
  if (!senha_atual || !senha_nova) throw new AppError("VALIDATION_FAILED", "Senha atual e nova são obrigatórias.");
  if (senha_nova.length < 6) throw new AppError("VALIDATION_FAILED", "Nova senha deve ter no mínimo 6 caracteres.");
  const { data: staff } = await ctx.sb.from("lumied_staff").select("id, senha_hash").eq("id", ctx.user!.id).single();
  if (!staff) throw new AppError("NOT_FOUND", "Staff não encontrado.");
  if (!(await verificarSenhaAuto(senha_atual, staff.senha_hash))) throw new AppError("AUTH_INVALID", "Senha atual incorreta.");
  const novaHash = await hashSenha(senha_nova);
  await ctx.sb.from("lumied_staff").update({ senha_hash: novaHash }).eq("id", staff.id);
  log.info("Staff password changed", { staff_id: staff.id });
  return successResponse({ success: true });
});

// Staff recuperar senha (public — envia código por email)
router.on("staff_recuperar_senha", rateLimit({ windowMs: 300000, maxRequests: 3 }), async (ctx) => {
  const { email } = ctx.body as { email: string };
  if (!email) throw new AppError("VALIDATION_FAILED", "Email obrigatório.");
  const { data: staff } = await ctx.sb.from("lumied_staff").select("id, nome, email, ativo").eq("email", email.toLowerCase().trim()).single();
  // Always return success to prevent email enumeration
  if (!staff || !staff.ativo) return successResponse({ success: true });
  // Generate 6-digit code with 15min expiry
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  const codigoHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codigo)))).map(b => b.toString(16).padStart(2, "0")).join("");
  const expiraEm = new Date(Date.now() + 15 * 60000).toISOString();
  await ctx.sb.from("lumied_staff").update({ reset_codigo_hash: codigoHash, reset_expira_em: expiraEm, reset_tentativas: 0 }).eq("id", staff.id);
  // Send email via Resend
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Lumied <noreply@lumied.com.br>",
          to: [staff.email],
          subject: "Código de recuperação — Lumied",
          html: `<div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px;">
            <div style="text-align:center;margin-bottom:24px;">
              <span style="font-size:28px;font-weight:700;color:#6C63FF;">Lumied</span>
            </div>
            <h2 style="font-size:18px;color:#1a1a1a;margin-bottom:8px;">Recuperação de senha</h2>
            <p style="color:#5a5249;font-size:14px;line-height:1.6;">Olá, <strong>${staff.nome}</strong>. Use o código abaixo para redefinir sua senha no Painel Central:</p>
            <div style="background:#f3f0ff;border:2px solid #6C63FF;border-radius:12px;padding:20px;text-align:center;margin:24px 0;">
              <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#6C63FF;">${codigo}</span>
            </div>
            <p style="color:#5a5249;font-size:13px;">Este código expira em <strong>15 minutos</strong>. Se você não solicitou, ignore este email.</p>
            <hr style="border:none;border-top:1px solid #e2dbd1;margin:24px 0;">
            <p style="color:#999;font-size:11px;text-align:center;">Lumied — Gestão Escolar Inteligente</p>
          </div>`,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) { log.error("Recovery email error", { error: String(e) }); }
  }
  log.info("Password recovery requested", { staff_id: staff.id });
  return successResponse({ success: true });
});

// Staff resetar senha (public — valida código e seta nova senha)
router.on("staff_resetar_senha", rateLimit({ windowMs: 300000, maxRequests: 5 }), async (ctx) => {
  const { email, codigo, senha_nova } = ctx.body as { email: string; codigo: string; senha_nova: string };
  if (!email || !codigo || !senha_nova) throw new AppError("VALIDATION_FAILED", "Email, código e nova senha são obrigatórios.");
  if (senha_nova.length < 6) throw new AppError("VALIDATION_FAILED", "Nova senha deve ter no mínimo 6 caracteres.");
  const { data: staff } = await ctx.sb.from("lumied_staff").select("id, reset_codigo_hash, reset_expira_em, reset_tentativas").eq("email", email.toLowerCase().trim()).single();
  if (!staff || !staff.reset_codigo_hash || !staff.reset_expira_em) throw new AppError("AUTH_INVALID", "Código inválido ou expirado.");
  if ((staff.reset_tentativas || 0) >= 5) {
    await ctx.sb.from("lumied_staff").update({ reset_codigo_hash: null, reset_expira_em: null, reset_tentativas: 0 }).eq("id", staff.id);
    throw new AppError("AUTH_INVALID", "Muitas tentativas. Solicite um novo código.");
  }
  if (new Date(staff.reset_expira_em) < new Date()) {
    await ctx.sb.from("lumied_staff").update({ reset_codigo_hash: null, reset_expira_em: null, reset_tentativas: 0 }).eq("id", staff.id);
    throw new AppError("AUTH_INVALID", "Código expirado. Solicite um novo.");
  }
  // Timing-safe compare via hash
  const codigoHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codigo)))).map(b => b.toString(16).padStart(2, "0")).join("");
  if (codigoHash !== staff.reset_codigo_hash) {
    await ctx.sb.from("lumied_staff").update({ reset_tentativas: (staff.reset_tentativas || 0) + 1 }).eq("id", staff.id);
    throw new AppError("AUTH_INVALID", "Código incorreto.");
  }
  const novaHash = await hashSenha(senha_nova);
  await ctx.sb.from("lumied_staff").update({ senha_hash: novaHash, reset_codigo_hash: null, reset_expira_em: null, reset_tentativas: 0 }).eq("id", staff.id);
  // Invalidate all existing sessions
  await ctx.sb.from("lumied_staff_sessoes").delete().eq("staff_id", staff.id);
  log.info("Password reset completed", { staff_id: staff.id });
  return successResponse({ success: true });
});

// Staff logout
router.on("staff_logout", authStaff, async (ctx) => {
  await ctx.sb.from("lumied_staff_sessoes").delete().eq("token", ctx.body._staff_token);
  return successResponse({ success: true });
});

// Staff setup (primeiro superusuário)
router.on("staff_setup_check", async (ctx) => {
  const { count } = await ctx.sb.from("lumied_staff").select("*", { count: "exact", head: true });
  return successResponse({ needs_setup: (count ?? 0) === 0 });
});

router.on("staff_setup", async (ctx) => {
  const { nome, email, senha } = ctx.body as { nome: string; email: string; senha: string };
  if (!nome || !email || !senha) throw new AppError("VALIDATION_FAILED", "Dados obrigatórios.");
  const { count } = await ctx.sb.from("lumied_staff").select("*", { count: "exact", head: true });
  if ((count ?? 0) > 0) throw new AppError("CONFLICT", "Setup já realizado.");
  const senha_hash = await hashSenha(senha);
  const { data: staff } = await ctx.sb.from("lumied_staff").insert({ nome, email: email.toLowerCase().trim(), senha_hash, cargo: 'fundador' }).select("id").single();
  if (!staff) throw new AppError("BAD_REQUEST", "Erro ao criar staff.");
  const tkn = gerarToken();
  await ctx.sb.from("lumied_staff_sessoes").insert({ staff_id: staff.id, token: tkn, expira_em: new Date(Date.now() + 7 * 86400000).toISOString() });
  return successResponse({ token: tkn, nome, email });
});

// ── Painel Central: KPIs globais ──
router.on("staff_dashboard", authStaff, async (ctx) => {
  const [escolas, alunos, tickets, staff] = await Promise.all([
    ctx.sb.from("escolas").select("id, nome, subdominio, plano, plano_fim, ativo, criado_em", { count: "exact" }),
    ctx.sb.from("alunos").select("*", { count: "exact", head: true }).eq("ativo", true),
    ctx.sb.from("tickets").select("*", { count: "exact", head: true }).eq("status", "aberto"),
    ctx.sb.from("lumied_staff").select("*", { count: "exact", head: true }).eq("ativo", true),
  ]);
  const escolasData = escolas.data || [];
  const ativas = escolasData.filter((e: any) => e.ativo);
  // MRR simples: sum based on plano
  const PRECOS: Record<string, number> = { starter: 259, gestao: 649, automacao: 1249, avancado: 2079, rede: 2939 };
  const mrr = ativas.reduce((s: number, e: any) => s + (PRECOS[e.plano?.toLowerCase()] || 0), 0);
  return successResponse({
    escolas_ativas: ativas.length,
    escolas_total: escolasData.length,
    total_alunos: alunos.count || 0,
    mrr,
    tickets_abertos: tickets.count || 0,
    staff_count: staff.count || 0,
    escolas: escolasData.map((e: any) => ({
      id: e.id, nome: e.nome, subdominio: e.subdominio, plano: e.plano,
      plano_fim: e.plano_fim, ativo: e.ativo, criado_em: e.criado_em,
      url_admin: `https://${e.subdominio}.lumied.com.br/admin.html`,
      url_gerente: `https://${e.subdominio}.lumied.com.br/gerente.html`,
    })),
  });
});

// ── Staff CRUD ──
router.on("staff_list", authStaff, async (ctx) => {
  const { data } = await ctx.sb.from("lumied_staff").select("id, nome, email, cargo, ativo, ultimo_acesso, criado_em").order("nome");
  return successResponse(data ?? []);
});

router.on("staff_criar", authStaff, async (ctx) => {
  const { nome, email, senha, cargo } = ctx.body as any;
  if (!nome || !email || !senha) throw new AppError("VALIDATION_FAILED", "Dados obrigatórios.");
  const senha_hash = await hashSenha(senha);
  const { error } = await ctx.sb.from("lumied_staff").insert({ nome, email: email.toLowerCase().trim(), senha_hash, cargo: cargo || 'suporte' });
  if (error) throw new AppError("BAD_REQUEST", error.message);
  // Audit (legacy + unificado)
  await ctx.sb.from("lumied_staff_audit").insert({ staff_id: ctx.user!.id, staff_nome: ctx.user!.nome, acao: 'staff_criar', detalhes: { email } });
  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'lumied_staff', acao: 'criar', depois: { email, cargo: cargo || 'suporte' } });
  return successResponse({ success: true });
});

router.on("staff_desativar", authStaff, async (ctx) => {
  const { id } = ctx.body as any;
  if (id === ctx.user!.id) throw new AppError("FORBIDDEN", "Não pode desativar a si mesmo.");
  await ctx.sb.from("lumied_staff").update({ ativo: false }).eq("id", id);
  await ctx.sb.from("lumied_staff_audit").insert({ staff_id: ctx.user!.id, staff_nome: ctx.user!.nome, acao: 'staff_desativar', detalhes: { target_id: id } });
  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'lumied_staff', recurso_id: id, acao: 'desativar' });
  return successResponse({ success: true });
});

// ── Audit log ──
router.on("staff_audit_log", authStaff, async (ctx) => {
  const { data } = await ctx.sb.from("lumied_staff_audit").select("*").order("criado_em", { ascending: false }).limit(100);
  return successResponse(data ?? []);
});

// ── Governance: audit unificado (audit_eventos) ──
router.on("staff_audit_eventos", authStaff, async (ctx) => {
  const { limit = 100, recurso, escola_id } = ctx.body as any;
  let q = ctx.sb.from("audit_eventos").select("*").order("at", { ascending: false }).limit(Math.min(Number(limit) || 100, 500));
  if (recurso) q = q.eq("recurso", recurso);
  if (escola_id) q = q.eq("escola_id", escola_id);
  const { data } = await q;
  return successResponse(data ?? []);
});

// ── Governance: cobertura RLS (lacunas em tabelas tenant) ──
router.on("staff_rls_coverage", authStaff, async (ctx) => {
  const { data } = await ctx.sb.from("v_rls_coverage").select("*");
  const rows = data ?? [];
  const tenant = rows.filter((r: any) => r.is_tenant);
  const lacunas = tenant.filter((r: any) => !r.rls_enabled || r.policy_count === 0);
  return successResponse({
    total_tabelas: rows.length,
    tenant_tables: tenant.length,
    cobertura_ok: tenant.length - lacunas.length,
    lacunas,
  });
});

// ── Governance: consumo de IA por escola (mês corrente) ──
router.on("staff_ia_uso", authStaff, async (ctx) => {
  const mes = new Date().toISOString().slice(0, 7) + '-01';
  const { data } = await ctx.sb.from("escola_ia_uso")
    .select("escola_id, custo_usd, cap_usd, bloqueado, requests, tokens_input, tokens_output, escolas(nome, subdominio)")
    .eq("mes", mes)
    .order("custo_usd", { ascending: false });
  return successResponse({ mes, escolas: data ?? [] });
});

// ── Governance: feature flags CRUD ──
router.on("staff_flags_list", authStaff, async (ctx) => {
  const { data } = await ctx.sb.from("feature_flags").select("*").order("chave");
  return successResponse(data ?? []);
});

router.on("staff_flag_set", authStaff, async (ctx) => {
  const { chave, ativo, rollout_pct, escolas } = ctx.body as any;
  if (!chave) throw new AppError("VALIDATION_FAILED", "chave obrigatória.");
  const patch: any = { atualizado_por: ctx.user?.email, atualizado_em: new Date().toISOString() };
  if (typeof ativo === 'boolean') patch.ativo = ativo;
  if (typeof rollout_pct === 'number') patch.rollout_pct = Math.max(0, Math.min(100, rollout_pct));
  if (Array.isArray(escolas) || escolas === null) patch.escolas = escolas;
  const { error } = await ctx.sb.from("feature_flags").update(patch).eq("chave", chave);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'feature_flag', recurso_id: chave, acao: 'set', depois: patch });
  return successResponse({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  TICKETS — Staff Lumied (todas as escolas)
// ═══════════════════════════════════════════════════════════════

router.on("staff_tickets_list", authStaff, async (ctx) => {
  const { status: filtro } = ctx.body as any;
  let q = ctx.sb.from("tickets").select("*, escolas(nome)").order("criado_em", { ascending: false }).limit(200);
  if (filtro) q = q.eq("status", filtro);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("staff_ticket_respond", authStaff, async (ctx) => {
  const { ticket_id, resposta } = ctx.body as any;
  if (!ticket_id || !resposta) throw new AppError("VALIDATION_FAILED", "ticket_id e resposta obrigatórios.");
  const { error } = await ctx.sb.from("tickets").update({
    resposta, respondido_por: ctx.user!.email, status: "respondido", atualizado_em: new Date().toISOString()
  }).eq("id", ticket_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user!.email, recurso: 'ticket', recurso_id: ticket_id, acao: 'respond' });
  return successResponse({ success: true });
});

router.on("staff_ticket_close", authStaff, async (ctx) => {
  const { ticket_id } = ctx.body as any;
  if (!ticket_id) throw new AppError("VALIDATION_FAILED", "ticket_id obrigatório.");
  const { error } = await ctx.sb.from("tickets").update({ status: "fechado", atualizado_em: new Date().toISOString() }).eq("id", ticket_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user!.email, recurso: 'ticket', recurso_id: ticket_id, acao: 'close' });
  return successResponse({ success: true });
});

router.on("staff_ticket_update", authStaff, async (ctx) => {
  const { ticket_id, tratamento, proximos_passos, resposta, status } = ctx.body as any;
  if (!ticket_id) throw new AppError("VALIDATION_FAILED", "ticket_id obrigatório.");
  const updates: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if (tratamento !== undefined) updates.tratamento = tratamento;
  if (proximos_passos !== undefined) updates.proximos_passos = proximos_passos;
  if (resposta !== undefined) { updates.resposta = resposta; updates.respondido_por = ctx.user!.email; }
  if (status) updates.status = status;
  const { error } = await ctx.sb.from("tickets").update(updates).eq("id", ticket_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("staff_ticket_get", authStaff, async (ctx) => {
  const { ticket_id } = ctx.body as any;
  if (!ticket_id) throw new AppError("VALIDATION_FAILED", "ticket_id obrigatório.");
  const { data } = await ctx.sb.from("tickets").select("*, escolas(nome)").eq("id", ticket_id).single();
  if (!data) throw new AppError("NOT_FOUND", "Ticket não encontrado.");
  return successResponse(data);
});

// ═══════════════════════════════════════════════════════════════
//  ONBOARDING — Criar novo cliente automaticamente
// ═══════════════════════════════════════════════════════════════

router.on("staff_criar_escola", authStaff, async (ctx) => {
  const { nome, subdominio, plano, gerente_nome, gerente_email, gerente_senha,
    cnpj, telefone, endereco, cor_primaria, escola_icone, escola_logo_url,
    series_tipo } = ctx.body as any;

  if (!nome || !subdominio || !gerente_nome || !gerente_email || !gerente_senha) {
    throw new AppError("VALIDATION_FAILED", "nome, subdominio, gerente_nome, gerente_email e gerente_senha são obrigatórios.");
  }

  const slug = subdominio.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (slug.length < 3) throw new AppError("VALIDATION_FAILED", "Subdomínio muito curto (min 3 caracteres).");

  const { data: existing } = await ctx.sb.from("escolas").select("id").eq("subdominio", slug).maybeSingle();
  if (existing) throw new AppError("CONFLICT", `Subdomínio "${slug}" já está em uso.`);

  const planoSlug = plano || 'gestao';
  const agora = new Date().toISOString();
  const planoFim = new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0];

  // 1. Resolver plano_id a partir do slug
  const { data: planoRow } = await ctx.sb.from("planos").select("id").eq("slug", planoSlug).maybeSingle();
  if (!planoRow) throw new AppError("VALIDATION_FAILED", `Plano "${planoSlug}" não encontrado.`);

  // 2. Criar escola com plano_id (UUID FK) + plano (text)
  const { data: escola, error: errEscola } = await ctx.sb.from("escolas").insert({
    nome, subdominio: slug, plano: planoSlug, plano_id: planoRow.id,
    plano_inicio: agora.split('T')[0], plano_fim: planoFim,
    cnpj: cnpj || null, contato_nome: gerente_nome,
    contato_email: gerente_email.toLowerCase().trim(),
    contato_telefone: telefone || null,
    ativo: true, modulo_whatsapp: false, tema: 'corporativo',
  }).select("id").single();
  if (errEscola || !escola) throw new AppError("BAD_REQUEST", errEscola?.message || "Erro ao criar escola.");

  // 3. Configurações (multi-tenant desde mig 236: PK composta chave+escola_id)
  const configs: Array<{ chave: string; valor: unknown }> = [
    { chave: 'escola_nome', valor: nome },
    { chave: 'escola_icone', valor: escola_icone || '🏫' },
    { chave: 'cor_primaria', valor: cor_primaria || '#C8102E' },
    { chave: 'cor_escura', valor: '#a00d24' },
    { chave: 'cor_cream', valor: '#f8f5f0' },
    { chave: 'escola_url', valor: `https://${slug}.lumied.com.br` },
    { chave: 'escola_email_domain', valor: 'lumied.com.br' },
    { chave: 'escola_email_sender', valor: 'onboarding@resend.dev' },
    { chave: 'superusuario_email', valor: gerente_email.toLowerCase().trim() },
  ];
  if (cnpj) configs.push({ chave: 'escola_cnpj', valor: cnpj });
  if (escola_logo_url) configs.push({ chave: 'escola_logo_url', valor: escola_logo_url });
  for (const cfg of configs) {
    await ctx.sb.from("escola_config").upsert({
      chave: cfg.chave,
      valor: cfg.valor,
      escola_id: escola.id,
    }, { onConflict: "chave,escola_id" }).catch((e: unknown) => {
      console.warn(`[staff_criar_escola] falha ao upsert config ${cfg.chave}:`, e);
    });
  }

  // 4. Criar gerente com escola_id
  const gerenteSenhaHash = await hashSenha(gerente_senha);
  const emailNorm = gerente_email.toLowerCase().trim();
  await ctx.sb.from("gerentes").insert({ nome: gerente_nome, email: emailNorm, senha_hash: gerenteSenhaHash, escola_id: escola.id });
  await ctx.sb.from("usuarios").insert({ nome: gerente_nome, email: emailNorm, senha_hash: gerenteSenhaHash, papel: 'gerente', papeis: ['gerente'], escola_id: escola.id, ativo: true });

  // 5. Ativar módulos do plano (usa plano_modulos do banco, não hardcoded)
  const { data: planoModulos } = await ctx.sb.from("plano_modulos").select("modulo_id").eq("plano_id", planoRow.id);
  const modulosAtivados = planoModulos || [];
  for (const pm of modulosAtivados) {
    await ctx.sb.from("escola_modulos").upsert(
      { escola_id: escola.id, modulo_id: pm.modulo_id, habilitado: true },
      { onConflict: "escola_id,modulo_id" }
    ).catch(() => {});
  }

  // 6. Séries padrão (configurável por tipo de escola)
  const SERIES: Record<string, string[]> = {
    maple_bear: ['Bear Care', 'Toddler', 'Nursery', 'Junior Kindergarten (JK)', 'Senior Kindergarten (SK)', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5'],
    educacao_infantil: ['Berçário', 'Maternal I', 'Maternal II', 'Jardim I', 'Jardim II', 'Pré I', 'Pré II'],
    fundamental: ['1º Ano', '2º Ano', '3º Ano', '4º Ano', '5º Ano', '6º Ano', '7º Ano', '8º Ano', '9º Ano'],
    completa: ['Berçário', 'Maternal I', 'Maternal II', 'Jardim I', 'Jardim II', 'Pré I', 'Pré II', '1º Ano', '2º Ano', '3º Ano', '4º Ano', '5º Ano', '6º Ano', '7º Ano', '8º Ano', '9º Ano'],
  };
  const seriesEscolhidas = SERIES[series_tipo || 'maple_bear'] || SERIES.maple_bear;
  for (const serie of seriesEscolhidas) {
    await ctx.sb.from("series").insert({ nome: serie, escola_id: escola.id }).catch(() => {});
  }

  // 7. Registrar subdomínio no Vercel (SSL automático)
  const VERCEL_TOKEN = Deno.env.get("VERCEL_API_TOKEN");
  const VERCEL_PROJECT = Deno.env.get("VERCEL_PROJECT_ID") || "prj_6uDL0URPHd5DiMj5ahaZcEltRfSL";
  const VERCEL_TEAM = Deno.env.get("VERCEL_TEAM_ID") || "team_k3kAHF00rep1GFrBRA53OmGg";
  let vercelOk = false;
  if (VERCEL_TOKEN) {
    try {
      const domainRes = await fetch(`https://api.vercel.com/v10/projects/${VERCEL_PROJECT}/domains?teamId=${VERCEL_TEAM}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${slug}.lumied.com.br` }),
      });
      const domainData = await domainRes.json();
      vercelOk = domainRes.ok;
      log.info("Vercel domain added", { domain: `${slug}.lumied.com.br`, ok: domainRes.ok, verified: domainData.verified });
    } catch (e) {
      log.error("Vercel domain error", { error: (e as Error).message });
    }
  }

  // 8. Audit log
  await ctx.sb.from("lumied_staff_audit").insert({
    staff_id: ctx.user!.id, staff_nome: ctx.user!.nome,
    acao: 'escola_criada',
    detalhes: { nome, subdominio: slug, plano: planoSlug, gerente_email: emailNorm, modulos: modulosAtivados.length, series: seriesEscolhidas.length, vercel: vercelOk },
    escola_id: escola.id,
  });

  // 9. Checklist de pendências
  const pendencias: string[] = [];
  if (!vercelOk) pendencias.push('Subdomínio Vercel — registrar manualmente ou verificar VERCEL_API_TOKEN');
  // Resolve module slugs for checklist
  const { data: moduloSlugs } = await ctx.sb.from("escola_modulos").select("modulos(slug)").eq("escola_id", escola.id).eq("habilitado", true);
  const slugsAtivos = (moduloSlugs || []).map((m: any) => m.modulos?.slug).filter(Boolean);
  if (slugsAtivos.includes('whatsapp_departamental') || slugsAtivos.includes('whatsapp_gateway')) {
    pendencias.push('WhatsApp — META_APP_SECRET, WHATSAPP_TOKEN, META_PHONE_NUMBER_ID');
  }
  if (slugsAtivos.includes('financeiro')) {
    pendencias.push('Banco Inter — INTER_CLIENT_ID/SECRET (se usar boletos)');
  }
  pendencias.push('Verificar SSL em https://' + slug + '.lumied.com.br (~1 min)');
  pendencias.push('Testar login do gerente em https://' + slug + '.lumied.com.br/gerente.html');

  log.info("Nova escola criada", { escola_id: escola.id, nome, slug, plano: planoSlug, modulos: modulosAtivados.length });

  logAudit(ctx.sb, {
    escola_id: escola.id,
    ator_tipo: 'staff',
    ator_id: ctx.user?.id,
    ator_email: ctx.user?.email,
    recurso: 'escola',
    recurso_id: escola.id,
    acao: 'criar',
    depois: { nome, subdominio: slug, plano: planoSlug, modulos: modulosAtivados.length },
  });

  return successResponse({
    success: true,
    escola_id: escola.id,
    url: `https://${slug}.lumied.com.br`,
    url_admin: `https://${slug}.lumied.com.br/admin.html`,
    url_gerente: `https://${slug}.lumied.com.br/gerente.html`,
    modulos_ativados: modulosAtivados.length,
    series_criadas: seriesEscolhidas.length,
    gerente_email: emailNorm,
    pendencias,
  });
});

// ═══════════════════════════════════════════════════════════════
//  PER-SCHOOL ADMIN PANEL — Actions for escola-scoped admin.html
// ═══════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
async function resolveEscola(sb: any, subdominio: string) {
  const { data } = await sb.from("escolas")
    .select("id, nome, subdominio, slug, plano, plano_id, plano_fim, ativo, supabase_url, supabase_anon_key, planos(id, slug, nome, preco_mensal, preco_anual)")
    .eq("subdominio", subdominio).single();
  if (!data) throw new AppError("NOT_FOUND", "Escola não encontrada: " + subdominio);
  return data;
}

// ── School Dashboard ──
router.on("escola_dashboard", authAdmin, async (ctx) => {
  const { subdominio } = ctx.body as { subdominio: string };
  if (!subdominio) throw new AppError("VALIDATION_FAILED", "subdominio obrigatório.");
  // deno-lint-ignore no-explicit-any
  const escola = await resolveEscola(ctx.sb, subdominio) as any;
  const [usoRes, limitesRes, ticketsRes, modulosRes, decisoesRes] = await Promise.all([
    ctx.sb.from("escola_uso").select("recurso, uso_atual").eq("escola_id", escola.id),
    escola.plano_id ? ctx.sb.from("plano_limites").select("recurso, limite").eq("plano_id", escola.plano_id) : Promise.resolve({ data: [] }),
    ctx.sb.from("tickets").select("id", { count: "exact", head: true }).eq("escola_id", escola.id).eq("status", "aberto"),
    ctx.sb.from("escola_modulos").select("modulo_id").eq("escola_id", escola.id).eq("habilitado", true),
    ctx.sb.from("escola_decisoes_financeiras").select("id", { count: "exact", head: true }).eq("escola_id", escola.id).eq("status", "pendente"),
  ]);
  const uso: Record<string, number> = {};
  for (const u of (usoRes.data || [])) uso[u.recurso] = u.uso_atual;
  const limites: Record<string, number> = {};
  for (const l of (limitesRes.data || [])) limites[l.recurso] = l.limite;
  const alerts: Array<{type: string; msg: string}> = [];
  if (escola.plano_fim) {
    const dias = Math.ceil((new Date(escola.plano_fim).getTime() - Date.now()) / 86400000);
    if (dias < 0) alerts.push({ type: "error", msg: "Plano expirado!" });
    else if (dias <= 30) alerts.push({ type: "warn", msg: `Plano expira em ${dias} dias` });
  }
  if (limites.max_alunos && limites.max_alunos > 0) {
    const pct = ((uso.max_alunos || 0) / limites.max_alunos) * 100;
    if (pct >= 90) alerts.push({ type: "warn", msg: `${Math.round(pct)}% do limite de alunos` });
  }
  return successResponse({
    escola: { id: escola.id, nome: escola.nome, subdominio: escola.subdominio },
    plano: escola.planos, plano_fim: escola.plano_fim, uso, limites, alerts,
    tickets_abertos: ticketsRes.count || 0,
    modulos_ativos: (modulosRes.data || []).length,
    decisoes_pendentes: decisoesRes.count || 0,
  });
});

// ── Plan Info ──
router.on("escola_plano_info", authAdmin, async (ctx) => {
  const { subdominio } = ctx.body as { subdominio: string };
  if (!subdominio) throw new AppError("VALIDATION_FAILED", "subdominio obrigatório.");
  // deno-lint-ignore no-explicit-any
  const escola = await resolveEscola(ctx.sb, subdominio) as any;
  const [usoRes, limitesRes, extrasRes, decisoesRes, planosRes] = await Promise.all([
    ctx.sb.from("escola_uso").select("recurso, uso_atual").eq("escola_id", escola.id),
    escola.plano_id ? ctx.sb.from("plano_limites").select("recurso, limite").eq("plano_id", escola.plano_id) : Promise.resolve({ data: [] }),
    ctx.sb.from("escola_extras_contratados").select("*, escola_extras(nome, slug, unidade, quantidade, preco)").eq("escola_id", escola.id).eq("ativo", true),
    ctx.sb.from("escola_decisoes_financeiras").select("*").eq("escola_id", escola.id).eq("status", "pendente"),
    ctx.sb.from("planos").select("id, slug, nome, descricao, preco_mensal, preco_anual, ordem").eq("ativo", true).order("ordem"),
  ]);
  const uso: Record<string, number> = {};
  for (const u of (usoRes.data || [])) uso[u.recurso] = u.uso_atual;
  const limites: Record<string, number> = {};
  for (const l of (limitesRes.data || [])) limites[l.recurso] = l.limite;
  return successResponse({
    escola_id: escola.id, nome: escola.nome,
    plano: escola.planos, plano_fim: escola.plano_fim,
    uso, limites,
    extras_ativos: extrasRes.data || [],
    decisoes_pendentes: decisoesRes.data || [],
    todos_planos: planosRes.data || [],
  });
});

// ─�� Upgrade/Downgrade ──
router.on("escola_solicitar_upgrade", authAdmin, async (ctx) => {
  const { subdominio, plano_solicitado } = ctx.body as { subdominio: string; plano_solicitado: string };
  if (!subdominio || !plano_solicitado) throw new AppError("VALIDATION_FAILED", "subdominio e plano_solicitado obrigatórios.");
  // deno-lint-ignore no-explicit-any
  const escola = await resolveEscola(ctx.sb, subdominio) as any;
  const { data: planoNovo } = await ctx.sb.from("planos").select("slug, nome, preco_mensal").eq("slug", plano_solicitado).single();
  if (!planoNovo) throw new AppError("NOT_FOUND", "Plano não encontrado.");
  const { error } = await ctx.sb.from("escola_decisoes_financeiras").insert({
    escola_id: escola.id, tipo: "upgrade_tier",
    descricao: `Upgrade de ${escola.planos?.nome || "?"} para ${planoNovo.nome}`,
    valor_estimado: planoNovo.preco_mensal, recorrente: true,
    plano_atual: escola.planos?.slug, plano_solicitado: planoNovo.slug,
    solicitado_por: ctx.user!.nome,
  });
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("escola_solicitar_downgrade", authAdmin, async (ctx) => {
  const { subdominio, plano_solicitado } = ctx.body as { subdominio: string; plano_solicitado: string };
  if (!subdominio || !plano_solicitado) throw new AppError("VALIDATION_FAILED", "subdominio e plano_solicitado obrigatórios.");
  // deno-lint-ignore no-explicit-any
  const escola = await resolveEscola(ctx.sb, subdominio) as any;
  const { data: planoNovo } = await ctx.sb.from("planos").select("slug, nome, preco_mensal").eq("slug", plano_solicitado).single();
  if (!planoNovo) throw new AppError("NOT_FOUND", "Plano não encontrado.");
  const { error } = await ctx.sb.from("escola_decisoes_financeiras").insert({
    escola_id: escola.id, tipo: "downgrade_tier",
    descricao: `Downgrade de ${escola.planos?.nome || "?"} para ${planoNovo.nome}`,
    valor_estimado: planoNovo.preco_mensal, recorrente: true,
    plano_atual: escola.planos?.slug, plano_solicitado: planoNovo.slug,
    solicitado_por: ctx.user!.nome,
  });
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ── Extras ──
router.on("escola_extras_list", authAdmin, async (ctx) => {
  const { subdominio } = ctx.body as { subdominio: string };
  if (!subdominio) throw new AppError("VALIDATION_FAILED", "subdominio obrigatório.");
  // deno-lint-ignore no-explicit-any
  const escola = await resolveEscola(ctx.sb, subdominio) as any;
  const [extrasRes, contratadosRes] = await Promise.all([
    ctx.sb.from("escola_extras").select("*").eq("ativo", true).order("slug"),
    ctx.sb.from("escola_extras_contratados").select("*, escola_extras(slug, nome, preco, unidade)").eq("escola_id", escola.id).eq("ativo", true),
  ]);
  return successResponse({ disponiveis: extrasRes.data || [], contratados: contratadosRes.data || [] });
});

router.on("escola_extra_contratar", authAdmin, async (ctx) => {
  const { subdominio, extra_id } = ctx.body as { subdominio: string; extra_id: string };
  if (!subdominio || !extra_id) throw new AppError("VALIDATION_FAILED", "subdominio e extra_id obrigatórios.");
  // deno-lint-ignore no-explicit-any
  const escola = await resolveEscola(ctx.sb, subdominio) as any;
  const { data: extra } = await ctx.sb.from("escola_extras").select("*").eq("id", extra_id).single();
  if (!extra) throw new AppError("NOT_FOUND", "Extra não encontrado.");
  await ctx.sb.from("escola_decisoes_financeiras").insert({
    escola_id: escola.id, tipo: `addon_${extra.unidade || "outro"}`,
    descricao: `Contratar ${extra.nome} (R$ ${extra.preco}/mês)`,
    valor_estimado: extra.preco, recorrente: extra.recorrente,
    solicitado_por: ctx.user!.nome,
  });
  return successResponse({ success: true });
});

router.on("escola_extra_cancelar", authAdmin, async (ctx) => {
  const { subdominio, contratado_id } = ctx.body as { subdominio: string; contratado_id: string };
  if (!subdominio || !contratado_id) throw new AppError("VALIDATION_FAILED", "subdominio e contratado_id obrigatórios.");
  // deno-lint-ignore no-explicit-any
  const escola = await resolveEscola(ctx.sb, subdominio) as any;
  const { error } = await ctx.sb.from("escola_extras_contratados")
    .update({ ativo: false, cancelado_em: new Date().toISOString() })
    .eq("id", contratado_id).eq("escola_id", escola.id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ─�� Config ──
router.on("escola_config_list", authAdmin, async (ctx) => {
  const { subdominio } = ctx.body as { subdominio: string };
  if (!subdominio) throw new AppError("VALIDATION_FAILED", "subdominio obrigatório.");
  // deno-lint-ignore no-explicit-any
  const escola = await resolveEscola(ctx.sb, subdominio) as any;
  const { data } = await ctx.sb.from("escola_config").select("chave, valor, descricao, categoria").eq("escola_id", escola.id).order("chave");
  return successResponse(data || []);
});

router.on("escola_config_update", authAdmin, async (ctx) => {
  const { subdominio, chave, valor } = ctx.body as { subdominio: string; chave: string; valor: string };
  if (!subdominio || !chave) throw new AppError("VALIDATION_FAILED", "subdominio e chave obrigatórios.");
  // deno-lint-ignore no-explicit-any
  const escola = await resolveEscola(ctx.sb, subdominio) as any;
  const { error } = await ctx.sb.from("escola_config").upsert({ chave, valor, escola_id: escola.id }, { onConflict: "chave,escola_id" });
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ── API & Integration Info ──
router.on("escola_api_info", authAdmin, async (ctx) => {
  const { subdominio } = ctx.body as { subdominio: string };
  if (!subdominio) throw new AppError("VALIDATION_FAILED", "subdominio obrigatório.");
  // deno-lint-ignore no-explicit-any
  const escola = await resolveEscola(ctx.sb, subdominio) as any;
  const baseUrl = escola.supabase_url || Deno.env.get("SUPABASE_URL");
  return successResponse({
    escola_id: escola.id, nome: escola.nome, subdominio: escola.subdominio,
    supabase_url: baseUrl,
    supabase_anon_key: escola.supabase_anon_key || "(use a anon key do projeto)",
    edge_functions: {
      admin: `${baseUrl}/functions/v1/admin`,
      api: `${baseUrl}/functions/v1/api`,
      academico: `${baseUrl}/functions/v1/academico`,
      comunicacao: `${baseUrl}/functions/v1/comunicacao`,
      diplomas: `${baseUrl}/functions/v1/diplomas`,
      health: `${baseUrl}/functions/v1/health`,
    },
    portal_urls: {
      admin: `https://${escola.subdominio}.lumied.com.br/admin.html`,
      gerente: `https://${escola.subdominio}.lumied.com.br/gerente.html`,
      professora: `https://${escola.subdominio}.lumied.com.br/professora.html`,
      pais: `https://${escola.subdominio}.lumied.com.br/`,
      aluno: `https://${escola.subdominio}.lumied.com.br/aluno.html`,
    },
  });
});

// ═══ SERVE ═══
serve(async (req: Request) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
