// ═══════════════════════════════════════════════════════════════
//  Maple Bear RS — Edge Function: admin (v2 — Router Pattern)
//  Superadmin: gestão de escolas, planos, módulos
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, validateInput, auth, type Context, successResponse, errorResponse, AppError, getModulosResolvidos, createLogger, hashSenha, verificarSenhaAuto, gerarToken, criarSessao, type Schema, logAudit } from "../_shared/mod.ts";

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

// ═══ EMAIL LAYOUT ═══
const LOGO_URL = "https://lumied.com.br/lumied-logo-branco.png";
const LOGO_DARK_URL = "https://lumied.com.br/lumied-logo.png";
const BRAND_COLOR = "#6C63FF";
const BRAND_GRADIENT = "linear-gradient(135deg,#6C63FF,#3B82F6)";
const BRAND_PURPLE = "#2D1B4E";

function emailLayout(body: string, options?: { preheader?: string }): string {
  const preheader = options?.preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${options.preheader}</div>` : "";
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
${preheader}
<table role="presentation" width="100%" style="background:#F3F4F6;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" style="max-width:600px;width:100%;">
  <!-- HEADER -->
  <tr><td style="background:${BRAND_PURPLE};padding:0;border-radius:16px 16px 0 0;overflow:hidden;">
    <table role="presentation" width="100%" style="border-collapse:collapse;">
      <tr><td style="padding:40px 32px 12px;text-align:center;background:linear-gradient(180deg,rgba(108,99,255,0.15) 0%,transparent 100%);">
        <img src="${LOGO_URL}" alt="Lumied" width="200" style="display:inline-block;height:auto;max-width:200px;" />
      </td></tr>
      <tr><td style="text-align:center;padding:0 32px 28px;">
        <p style="font-size:14px;color:rgba(255,255,255,.55);margin:0;letter-spacing:0.5px;">Gest\u00e3o escolar inteligente com IA</p>
      </td></tr>
      <tr><td style="height:4px;background:linear-gradient(90deg,#C4963C,#D4A84E,#C4963C);font-size:0;line-height:0;">&nbsp;</td></tr>
    </table>
  </td></tr>
  <!-- BODY -->
  <tr><td style="background:#FFFFFF;padding:36px 32px;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;">
    ${body}
  </td></tr>
  <!-- FOOTER -->
  <tr><td style="background:${BRAND_PURPLE};padding:28px 32px;border-radius:0 0 16px 16px;">
    <table role="presentation" width="100%" style="border-collapse:collapse;">
      <tr><td style="border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:20px;margin-bottom:16px;text-align:center;">
        <img src="${LOGO_URL}" alt="Lumied" width="100" style="display:inline-block;height:auto;max-width:100px;opacity:.7;" />
      </td></tr>
      <tr><td style="padding-top:16px;text-align:center;">
        <p style="font-size:13px;color:rgba(255,255,255,.5);margin:0 0 10px;line-height:1.6;">
          <a href="https://lumied.com.br" style="color:#C4963C;text-decoration:none;font-weight:600;">lumied.com.br</a> &nbsp;\u00b7&nbsp;
          <a href="https://lumied.com.br/blog/" style="color:rgba(255,255,255,.6);text-decoration:none;">Blog</a> &nbsp;\u00b7&nbsp;
          <a href="https://www.instagram.com/lumi.ed/" style="color:rgba(255,255,255,.6);text-decoration:none;">Instagram</a> &nbsp;\u00b7&nbsp;
          <a href="https://www.linkedin.com/company/lumied/" style="color:rgba(255,255,255,.6);text-decoration:none;">LinkedIn</a>
        </p>
        <p style="font-size:11px;color:rgba(255,255,255,.35);margin:0;line-height:1.6;">
          contato@lumied.com.br<br>
          Lumied Tecnologia \u00b7 Caxias do Sul, RS \u00b7 Brasil<br>
          <a href="https://lumied.com.br/privacidade/" style="color:rgba(255,255,255,.35);text-decoration:underline;">Pol\u00edtica de Privacidade</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

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
          subject: `Novo Lead: ${nome_escola}`,
          html: emailLayout(`
            <h2 style="font-size:20px;color:#1E1B4B;margin:0 0 20px;">Novo Lead Comercial</h2>
            <table style="width:100%;border-collapse:collapse;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;">
              <tr><td style="padding:12px 16px;font-weight:bold;background:#F9FAFB;width:140px;">Escola:</td><td style="padding:12px 16px;">${nome_escola}</td></tr>
              <tr><td style="padding:12px 16px;font-weight:bold;background:#F9FAFB;">Email:</td><td style="padding:12px 16px;">${email}</td></tr>
              <tr><td style="padding:12px 16px;font-weight:bold;background:#F9FAFB;">WhatsApp:</td><td style="padding:12px 16px;">${telefone || '\u2014'}</td></tr>
              ${mensagem ? `<tr><td style="padding:12px 16px;font-weight:bold;background:#F9FAFB;">Mensagem:</td><td style="padding:12px 16px;">${mensagem}</td></tr>` : ''}
              <tr><td style="padding:12px 16px;font-weight:bold;background:#F9FAFB;">Origem:</td><td style="padding:12px 16px;">${utm_source || 'site'}</td></tr>
            </table>
            <div style="text-align:center;margin-top:24px;">
              <a href="https://admin.lumied.com.br" style="display:inline-block;background:${BRAND_GRADIENT};color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Abrir Painel Central \u2192</a>
            </div>
          `, { preheader: `Novo lead: ${nome_escola} - ${email}` }),
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) { console.error("[LEAD] Email error:", e); }
  }

  // Auto-resposta WhatsApp (requer WHATSAPP_TOKEN permanente + template aprovado)
  const waToken = Deno.env.get("WHATSAPP_TOKEN");
  const waPhoneId = Deno.env.get("META_PHONE_NUMBER_ID");
  if (waToken && waPhoneId && telefone) {
    try {
      const cleanPhone = telefone.replace(/\D/g, "").replace(/^0+/, "");
      const fullPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;
      await fetch(`https://graph.facebook.com/v21.0/${waPhoneId}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${waToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: fullPhone,
          type: "template",
          template: {
            name: "lead_boas_vindas",
            language: { code: "pt_BR" },
            components: [{ type: "body", parameters: [{ type: "text", text: nome_escola || "sua escola" }] }],
          },
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) { console.error("[LEAD] WhatsApp auto-reply error:", e); }
  }

  return successResponse({ success: true, lead_id: lead?.id, message: "Obrigado! Entraremos em contato em até 24h." });
});

// ── Public: Newsletter subscribe ──
router.on("newsletter_subscribe", rateLimit({ windowMs: 60000, maxRequests: 5 }), async (ctx) => {
  const { email, origem, utm_source, utm_medium, utm_campaign } = ctx.body as any;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("VALIDATION_FAILED", "Email inválido.");

  const cleanEmail = email.toLowerCase().trim();

  // Check if already subscribed (don't re-send welcome)
  const { data: existing } = await ctx.sb.from("newsletter_subscribers").select("id").eq("email", cleanEmail).maybeSingle();

  const { error } = await ctx.sb.from("newsletter_subscribers").upsert(
    { email: cleanEmail, origem: origem || "blog", utm_source, utm_medium, utm_campaign, confirmado: true },
    { onConflict: "email" }
  );
  if (error) throw new AppError("BAD_REQUEST", error.message);

  // Welcome email (only for new subscribers)
  if (!existing) {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Lumied Blog <blog@lumied.com.br>",
            to: [cleanEmail],
            subject: "Bem-vindo ao blog Lumied + Checklist Compliance 2026",
            html: emailLayout(`
              <h2 style="font-size:22px;color:#1E1B4B;margin:0 0 16px;text-align:center;">Bem-vindo ao Blog Lumied!</h2>
              <p style="font-size:15px;line-height:1.7;color:#475569;">Obrigado por se inscrever! A partir de agora voc\u00ea receber\u00e1 conte\u00fados pr\u00e1ticos sobre gest\u00e3o escolar, compliance e EdTech.</p>
              <div style="background:#F0EDFF;border:1px solid #D4CAFE;border-radius:12px;padding:24px;margin:24px 0;">
                <h3 style="font-size:18px;margin:0 0 12px;color:#1E1B4B;">\u{1F4CB} Checklist Compliance Escolar 2026</h3>
                <p style="font-size:14px;color:#475569;margin:0 0 16px;">Os 6 itens obrigat\u00f3rios que toda escola precisa cumprir:</p>
                <ol style="font-size:14px;color:#1E1B4B;line-height:2.2;padding-left:20px;margin:0;">
                  <li><strong>Ponto CLT</strong> \u2014 Registro eletr\u00f4nico, hora extra 50%/100%, intervalo intrajornada</li>
                  <li><strong>LGPD</strong> \u2014 Consentimento, tratamento de dados de menores, DPO</li>
                  <li><strong>eSocial</strong> \u2014 Folha eletr\u00f4nica, eventos trabalhistas em tempo real</li>
                  <li><strong>AVCB</strong> \u2014 Corpo de Bombeiros, Vigil\u00e2ncia Sanit\u00e1ria, inspe\u00e7\u00f5es</li>
                  <li><strong>MEC</strong> \u2014 Censo Escolar, autoriza\u00e7\u00e3o de funcionamento, PPP</li>
                  <li><strong>Contratos</strong> \u2014 Assinatura eletr\u00f4nica v\u00e1lida (Lei 14.063/2020)</li>
                </ol>
              </div>
              <h3 style="font-size:16px;color:#1E1B4B;margin:24px 0 12px;">Artigos mais lidos:</h3>
              <ul style="list-style:none;padding:0;margin:0;">
                <li style="margin-bottom:12px;"><a href="https://lumied.com.br/blog/compliance-escolar/" style="color:${BRAND_COLOR};font-weight:600;text-decoration:none;">Compliance Escolar 2026: Guia Completo \u2192</a></li>
                <li style="margin-bottom:12px;"><a href="https://lumied.com.br/blog/inadimplencia-escolar/" style="color:${BRAND_COLOR};font-weight:600;text-decoration:none;">Inadimpl\u00eancia Escolar: Como Reduzir 40% em 90 Dias \u2192</a></li>
                <li style="margin-bottom:12px;"><a href="https://lumied.com.br/blog/lgpd-escola-guia-definitivo/" style="color:${BRAND_COLOR};font-weight:600;text-decoration:none;">LGPD na Escola: Guia Definitivo \u2192</a></li>
              </ul>
              <div style="text-align:center;margin-top:28px;">
                <a href="https://lumied.com.br/blog/" style="display:inline-block;padding:12px 28px;background:${BRAND_GRADIENT};color:#fff;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px;">Ver todos os artigos \u2192</a>
              </div>
            `, { preheader: "Checklist Compliance 2026 + artigos mais lidos" }),
          }),
          signal: AbortSignal.timeout(8000),
        });
      } catch (e) { console.error("[NEWSLETTER] Welcome email error:", e); }
    }
  }

  return successResponse({ success: true, message: "Inscrito com sucesso!" });
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
  const { data: admin } = await ctx.sb.from("admins").select("id, nome, email, senha_hash, ativo").eq("email", email).maybeSingle();
  if (admin) {
    if (!admin.ativo) throw new AppError("AUTH_USER_DISABLED", "Conta desativada.");
    if (!(await verificarSenhaAuto(senha, admin.senha_hash))) throw new AppError("AUTH_BAD_CREDENTIALS", "Credenciais inválidas.");
    const tkn = gerarToken();
    await ctx.sb.from("admin_sessoes").insert({ admin_id: admin.id, token: tkn, expira_em: new Date(Date.now() + 7 * 86400000).toISOString() });
    log.info("Admin login", { user_id: admin.id, action: "admin_login" });
    return successResponse({ token: tkn, nome: admin.nome, email: admin.email });
  }

  // 2. Fallback: try staff (fundador) credentials
  const { data: staff } = await ctx.sb.from("lumied_staff").select("id, nome, email, senha_hash, cargo, ativo").eq("email", email.toLowerCase().trim()).maybeSingle();
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

// ═══════════════════════════════════════════════════════
//  CS — Saúde das escolas (sinais-gatilho 🟡/🔴)
//  Fonte: CS_PLAYBOOK.md §4.3
// ═══════════════════════════════════════════════════════
router.on("cs_saude_list", authAdmin, async (ctx) => {
  const hoje = new Date();
  const ms = (d: number) => new Date(hoje.getTime() - d * 86400000).toISOString();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString();

  // safeQuery — retorna { data, count, error } sem lançar
  const safe = async <T = any>(q: any): Promise<{ data: T[] | null; count: number | null; ok: boolean }> => {
    try { const r = await q; return { data: (r as any).data || null, count: (r as any).count ?? null, ok: !(r as any).error }; }
    catch { return { data: null, count: null, ok: false }; }
  };

  const { data: escolas } = await ctx.sb.from("escolas").select("id, nome, slug, plano_id, plano, ativo, criado_em").eq("ativo", true);
  if (!escolas || escolas.length === 0) return successResponse({ escolas: [] });

  const escolaIds = escolas.map((e: any) => e.id);
  const inicioMesIso = inicioMes;
  const ms30 = ms(30);
  const ms10 = ms(10).slice(0, 10);
  const ms7 = ms(7).slice(0, 10);
  const ms2 = ms(2);

  // 7 queries agregadas (em paralelo) cobrem todas as escolas — antes era 7 × N.
  const [
    usuariosRes,
    boletosRes,
    faturasRes,
    profsRes,
    freqRes,
    ticketsRes,
  ] = await Promise.all([
    safe(ctx.sb.from("usuarios").select("id, escola_id").in("escola_id", escolaIds)),
    safe(ctx.sb.from("boletos").select("escola_id").in("escola_id", escolaIds).gte("criado_em", inicioMesIso)),
    safe(ctx.sb.from("saas_faturas").select("escola_id").in("escola_id", escolaIds).in("status", ["PENDING", "OVERDUE"]).lte("data_vencimento", ms10)),
    safe(ctx.sb.from("professoras").select("escola_id").in("escola_id", escolaIds).eq("ativa", true)),
    safe(ctx.sb.from("frequencia").select("escola_id, professora_id").in("escola_id", escolaIds).gte("data", ms7)),
    safe(ctx.sb.from("tickets").select("escola_id").in("escola_id", escolaIds).eq("status", "aberto").lte("criado_em", ms2)),
  ]);

  const usuarioToEscola = new Map<string, string>();
  for (const u of (usuariosRes.data ?? []) as any[]) usuarioToEscola.set(u.id, u.escola_id);
  const allUsuarioIds = (usuariosRes.data ?? []).map((u: any) => u.id);

  // Última sessão dos usuários das escolas ativas (1 query a mais — total 7)
  const sessoesRes = allUsuarioIds.length > 0
    ? await safe(ctx.sb.from("sessoes").select("criado_em, usuario_id").in("usuario_id", allUsuarioIds).gte("criado_em", ms30).order("criado_em", { ascending: false }))
    : { data: [] as any[], count: null, ok: true };

  const ultimaSessaoPorEscola = new Map<string, number>();
  for (const s of (sessoesRes.data ?? []) as any[]) {
    const eid = usuarioToEscola.get(s.usuario_id);
    if (!eid) continue;
    const ts = new Date(s.criado_em).getTime();
    if (ts > (ultimaSessaoPorEscola.get(eid) ?? 0)) ultimaSessaoPorEscola.set(eid, ts);
  }

  const boletosCountPorEscola = new Map<string, number>();
  for (const b of (boletosRes.data ?? []) as any[]) {
    boletosCountPorEscola.set(b.escola_id, (boletosCountPorEscola.get(b.escola_id) ?? 0) + 1);
  }

  const escolasComFaturaVencida = new Set<string>((faturasRes.data ?? []).map((f: any) => f.escola_id));

  const profsCountPorEscola = new Map<string, number>();
  for (const p of (profsRes.data ?? []) as any[]) {
    profsCountPorEscola.set(p.escola_id, (profsCountPorEscola.get(p.escola_id) ?? 0) + 1);
  }

  const profsComChamadaPorEscola = new Map<string, Set<string>>();
  for (const f of (freqRes.data ?? []) as any[]) {
    if (!f.professora_id) continue;
    let set = profsComChamadaPorEscola.get(f.escola_id);
    if (!set) { set = new Set(); profsComChamadaPorEscola.set(f.escola_id, set); }
    set.add(f.professora_id);
  }

  const ticketsAbertosPorEscola = new Map<string, number>();
  for (const t of (ticketsRes.data ?? []) as any[]) {
    ticketsAbertosPorEscola.set(t.escola_id, (ticketsAbertosPorEscola.get(t.escola_id) ?? 0) + 1);
  }

  const resultado = escolas.map((e: any) => {
    const eid = e.id;
    const sinais: Array<{ cor: 'verde'|'amarelo'|'vermelho'; nome: string; detalhe: string }> = [];

    const ultLoginMs = ultimaSessaoPorEscola.get(eid) ?? 0;
    const diasSemLogin = ultLoginMs ? Math.floor((hoje.getTime() - ultLoginMs) / 86400000) : 999;
    if (diasSemLogin >= 14) sinais.push({ cor: 'vermelho', nome: 'login_gestor', detalhe: `Sem login há ${diasSemLogin === 999 ? '30+' : diasSemLogin} dias` });

    if ((boletosCountPorEscola.get(eid) ?? 0) === 0) {
      sinais.push({ cor: 'vermelho', nome: 'zero_boletos_mes', detalhe: 'Nenhum boleto emitido este mês' });
    }

    if (escolasComFaturaVencida.has(eid)) {
      sinais.push({ cor: 'vermelho', nome: 'fatura_saas_atrasada', detalhe: 'Fatura SaaS atrasada há 10+ dias' });
    }

    const totalProfs = profsCountPorEscola.get(eid) ?? 0;
    const profsAtivasChamada = profsComChamadaPorEscola.get(eid)?.size ?? 0;
    if (totalProfs > 0 && (profsAtivasChamada / totalProfs) < 0.5) {
      const pct = Math.round((profsAtivasChamada / totalProfs) * 100);
      sinais.push({ cor: 'amarelo', nome: 'chamada_baixa', detalhe: `${pct}% das professoras (${profsAtivasChamada}/${totalProfs}) usaram chamada em 7d` });
    }

    const ticketsCount = ticketsAbertosPorEscola.get(eid) ?? 0;
    if (ticketsCount > 0) {
      sinais.push({ cor: 'amarelo', nome: 'ticket_parado', detalhe: `${ticketsCount} ticket(s) aberto(s) há mais de 48h` });
    }

    const piorCor = sinais.some(s => s.cor === 'vermelho') ? 'vermelho' : sinais.some(s => s.cor === 'amarelo') ? 'amarelo' : 'verde';
    return {
      escola_id: eid,
      escola_nome: e.nome,
      escola_slug: e.slug,
      plano: e.plano || e.plano_id,
      status: piorCor,
      dias_sem_login: diasSemLogin,
      sinais,
    };
  });

  // Ordena: vermelho > amarelo > verde, depois por mais dias sem login
  const ord = { vermelho: 0, amarelo: 1, verde: 2 } as const;
  resultado.sort((a, b) => (ord[a.status as keyof typeof ord] - ord[b.status as keyof typeof ord]) || (b.dias_sem_login - a.dias_sem_login));
  return successResponse({ escolas: resultado, gerado_em: hoje.toISOString() });
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
    .select("staff_id, expira_em, lumied_staff(id, nome, email, cargo, ativo, papel_id)")
    .eq("token", token).single();
  if (!data) throw new AppError("AUTH_INVALID", "Sessão de staff inválida.");
  if (new Date(data.expira_em) < new Date()) throw new AppError("AUTH_EXPIRED", "Sessão expirada.");
  // deno-lint-ignore no-explicit-any
  const staff = (data as any).lumied_staff;
  if (!staff?.ativo) throw new AppError("FORBIDDEN", "Conta desativada.");
  ctx.user = { ...staff, tipo: 'staff' };
  return next();
}

// Checa permissão granular via papel. Fundador ou admin têm bypass total.
async function requirePerm(ctx: Context, recurso: string, acao: string): Promise<void> {
  const user = ctx.user as any;
  if (!user) throw new AppError("AUTH_REQUIRED", "Sessão obrigatória.");
  if (user.tipo === 'admin') return;              // admin de escola: bypass (é outro contexto)
  if (user.cargo === 'fundador') return;          // fundador: bypass
  const { data } = await ctx.sb.rpc("staff_tem_permissao", {
    p_staff_id: user.id, p_recurso: recurso, p_acao: acao,
  });
  if (!data) throw new AppError("FORBIDDEN", `Sem permissão: ${recurso}/${acao}.`);
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

  // 4. Criar gerente com escola_id (crítico — rollback escola se falhar)
  const gerenteSenhaHash = await hashSenha(gerente_senha);
  const emailNorm = gerente_email.toLowerCase().trim();
  const { error: errGerente } = await ctx.sb.from("gerentes").insert({ nome: gerente_nome, email: emailNorm, senha_hash: gerenteSenhaHash, escola_id: escola.id });
  if (errGerente) {
    await ctx.sb.from("escola_config").delete().eq("escola_id", escola.id);
    await ctx.sb.from("escolas").delete().eq("id", escola.id);
    throw new AppError("BAD_REQUEST", `Erro ao criar gerente: ${errGerente.message}. Escola removida.`);
  }
  const { error: errUsuario } = await ctx.sb.from("usuarios").insert({ nome: gerente_nome, email: emailNorm, senha_hash: gerenteSenhaHash, papel: 'gerente', papeis: ['gerente'], escola_id: escola.id, ativo: true });
  if (errUsuario) {
    log.error("Falha ao criar usuario unificado (gerente já criado)", { error: errUsuario.message, escola_id: escola.id });
  }

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

  // 10. Seed workflow templates
  try {
    await ctx.sb.from("workflows").insert([
      { escola_id: escola.id, nome: 'Alerta 3 Faltas Consecutivas', descricao: 'Envia WhatsApp ao responsável quando aluno acumula 3+ faltas consecutivas.', ativo: true, trigger_tipo: 'evento', trigger_config: { evento: 'aluno_falta', condicao: { faltas_consecutivas: 3 } }, condicoes: [], acoes: [{ tipo: 'enviar_whatsapp', template: 'lembrete_falta', para: 'responsavel', mensagem: 'Prezado(a) {{responsavel_nome}}, informamos que {{aluno_nome}} acumula {{faltas_consecutivas}} falta(s) consecutiva(s). Por favor, entre em contato com a escola.' }, { tipo: 'criar_notificacao', para: 'coordenadora', mensagem: 'Aluno {{aluno_nome}} ({{serie}}) acumula {{faltas_consecutivas}} faltas consecutivas.', prioridade: 'alta' }] },
      { escola_id: escola.id, nome: 'Lembrete Boleto 3 Dias', descricao: 'Envia e-mail ao responsável 3 dias antes do vencimento do boleto.', ativo: true, trigger_tipo: 'cron', trigger_config: { cron: '0 8 * * *', antecedencia_dias: 3 }, condicoes: [], acoes: [{ tipo: 'enviar_email', assunto: 'Lembrete de Vencimento', para: 'responsavel', template: 'lembrete_boleto', vars: { vencimento: '{{vencimento}}', valor: '{{valor}}', aluno: '{{crianca_nome}}' } }] },
      { escola_id: escola.id, nome: 'Boas-vindas Nova Matrícula', descricao: 'Envia e-mail de boas-vindas à família quando uma nova matrícula é criada.', ativo: true, trigger_tipo: 'evento', trigger_config: { evento: 'matricula_criada' }, condicoes: [], acoes: [{ tipo: 'enviar_email', assunto: 'Bem-vindo(a)!', para: 'responsavel', template: 'boas_vindas_matricula', vars: { aluno: '{{aluno_nome}}', turma: '{{turma_nome}}' } }, { tipo: 'criar_notificacao', para: 'secretaria', mensagem: 'Nova matrícula: {{aluno_nome}} na turma {{turma_nome}}.', prioridade: 'normal' }] },
      { escola_id: escola.id, nome: 'Aniversariante do Dia', descricao: 'Notifica a professora todos os dias com os aniversariantes.', ativo: true, trigger_tipo: 'cron', trigger_config: { cron: '0 8 * * *' }, condicoes: [], acoes: [{ tipo: 'criar_notificacao', para: 'professora', mensagem: 'Hoje fazem aniversário: {{aniversariantes_lista}}.', prioridade: 'normal' }] },
      { escola_id: escola.id, nome: 'Follow-up Lead Parado (7 dias)', descricao: 'Notifica o comercial quando um lead fica sem movimentação por 7+ dias.', ativo: true, trigger_tipo: 'evento', trigger_config: { evento: 'lead_sem_atividade', condicao: { dias_inativo: 7 } }, condicoes: [], acoes: [{ tipo: 'criar_notificacao', para: 'comercial', mensagem: 'Lead {{lead_nome}} ({{lead_email}}) está sem movimentação há {{dias_inativo}} dias. Agende um contato!', prioridade: 'alta' }] },
    ]);
  } catch (e) { console.warn('[staff_criar_escola] falha ao seed workflows:', e); }

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
    .select("id, nome, subdominio, slug, plano, plano_id, plano_fim, ativo, supabase_url, supabase_anon_key, saas_backup_incluir_faces, saas_retention_dias_override, saas_backup_alert_email, planos(id, slug, nome, preco_mensal, preco_anual)")
    .eq("subdominio", subdominio).single();
  if (!data) throw new AppError("NOT_FOUND", "Escola não encontrada: " + subdominio);
  return data;
}

// ── Save backup preferences (per-escola admin) ──
router.on("escola_prefs_backup_save", authAdmin, async (ctx) => {
  const { subdominio, prefs } = ctx.body as { subdominio: string; prefs: Record<string, unknown> };
  if (!subdominio) throw new AppError("VALIDATION_FAILED", "subdominio obrigatório.");
  const escola = await resolveEscola(ctx.sb, subdominio) as { id: string };
  const ALLOWED = ["saas_backup_incluir_faces", "saas_retention_dias_override", "saas_backup_alert_email"];
  const update: Record<string, unknown> = {};
  for (const k of ALLOWED) if (k in prefs) update[k] = prefs[k];
  if (!Object.keys(update).length) return successResponse({ ok: true, noop: true });
  const { error } = await ctx.sb.from("escolas").update(update).eq("id", escola.id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ ok: true });
});

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
      aluno: `https://${escola.subdominio}.lumied.com.br/familia.html`,
    },
  });
});

// ═══════════════════════════════════════════════════════════════
//  STAFF — Papéis & Permissões granulares
// ═══════════════════════════════════════════════════════════════

// Catálogo de recursos × ações (usado pela UI matriz). Manter sincronizado
// com seed da migration 246. É declarado no server para a UI não precisar
// adivinhar.
const RECURSOS_CATALOGO = [
  { recurso: 'escolas',           nome: 'Escolas',              acoes: ['ver','criar','editar','suspender'] },
  { recurso: 'staff',              nome: 'Staff Lumied',        acoes: ['ver','criar','editar','desativar','gerenciar_papeis'] },
  { recurso: 'tickets',            nome: 'Tickets de Suporte',  acoes: ['ver','responder','fechar','escalar'] },
  { recurso: 'crm',                nome: 'CRM / Funil',         acoes: ['ver','editar','mover_funil'] },
  { recurso: 'saas_billing',       nome: 'Cobrança SaaS',       acoes: ['ver','criar_fatura','cancelar','registrar_pagto'] },
  { recurso: 'financeiro_lumied',  nome: 'Financeiro Interno',  acoes: ['ver_cp','criar_cp','editar_cp','pagar_cp','ver_cr','criar_cr','editar_cr'] },
  { recurso: 'centros_custo',      nome: 'Centros de Custo',    acoes: ['ver','gerenciar'] },
  { recurso: 'backups',            nome: 'Backups',             acoes: ['ver','restaurar','download'] },
  { recurso: 'audit',              nome: 'Audit Log',           acoes: ['ver'] },
  { recurso: 'governance',         nome: 'Governance',          acoes: ['ver','editar_flags'] },
  { recurso: 'saude_cs',           nome: 'Saúde CS',            acoes: ['ver','ack_alerta'] },
  { recurso: 'playbooks',          nome: 'Playbooks',           acoes: ['ver','executar'] },
  { recurso: 'ia_uso',             nome: 'Uso de IA',           acoes: ['ver','ajustar_budget'] },
];

router.on("staff_recursos_catalogo", authStaff, async (_ctx) => {
  return successResponse({ recursos: RECURSOS_CATALOGO });
});

router.on("staff_papeis_list", authStaff, async (ctx) => {
  const { data: papeis } = await ctx.sb.from("lumied_staff_papeis")
    .select("id, slug, nome, descricao, sistema, criado_em")
    .order("nome");
  const { data: perms } = await ctx.sb.from("lumied_staff_permissoes")
    .select("papel_id, recurso, acao");
  const { data: staffs } = await ctx.sb.from("lumied_staff")
    .select("papel_id")
    .eq("ativo", true);
  const byPapel: Record<string, { recurso: string; acao: string }[]> = {};
  // deno-lint-ignore no-explicit-any
  (perms || []).forEach((p: any) => {
    if (!byPapel[p.papel_id]) byPapel[p.papel_id] = [];
    byPapel[p.papel_id].push({ recurso: p.recurso, acao: p.acao });
  });
  const countByPapel: Record<string, number> = {};
  // deno-lint-ignore no-explicit-any
  (staffs || []).forEach((s: any) => { if (s.papel_id) countByPapel[s.papel_id] = (countByPapel[s.papel_id] || 0) + 1; });
  return successResponse({
    papeis: (papeis || []).map((p: any) => ({
      ...p,
      permissoes: byPapel[p.id] || [],
      staff_count: countByPapel[p.id] || 0,
    })),
  });
});

router.on("staff_papel_upsert", authStaff, async (ctx) => {
  await requirePerm(ctx, 'staff', 'gerenciar_papeis');
  const { id, slug, nome, descricao, permissoes } = ctx.body as any;
  if (!nome) throw new AppError("VALIDATION_FAILED", "Nome obrigatório.");
  if (!Array.isArray(permissoes)) throw new AppError("VALIDATION_FAILED", "permissoes deve ser array.");

  let papelId = id as string | null;
  if (papelId) {
    // Update
    const { data: existing } = await ctx.sb.from("lumied_staff_papeis").select("sistema, slug").eq("id", papelId).single();
    if (!existing) throw new AppError("NOT_FOUND", "Papel não encontrado.");
    const patch: any = { nome, descricao: descricao || null, atualizado_em: new Date().toISOString() };
    // Slug de papéis sistema não pode mudar
    if (!(existing as any).sistema && slug) patch.slug = slug;
    await ctx.sb.from("lumied_staff_papeis").update(patch).eq("id", papelId);
  } else {
    // Insert
    if (!slug) throw new AppError("VALIDATION_FAILED", "Slug obrigatório para papel novo.");
    const { data: novo, error } = await ctx.sb.from("lumied_staff_papeis")
      .insert({ slug, nome, descricao: descricao || null, sistema: false })
      .select("id").single();
    if (error) throw new AppError("BAD_REQUEST", error.message);
    papelId = (novo as any).id;
  }

  // Sincroniza permissões (substitui inteira a matriz do papel)
  await ctx.sb.from("lumied_staff_permissoes").delete().eq("papel_id", papelId);
  if (permissoes.length > 0) {
    const rows = (permissoes as { recurso: string; acao: string }[]).map(p => ({ papel_id: papelId, recurso: p.recurso, acao: p.acao }));
    const { error } = await ctx.sb.from("lumied_staff_permissoes").insert(rows);
    if (error) throw new AppError("BAD_REQUEST", error.message);
  }
  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'staff_papel', recurso_id: papelId, acao: id ? 'editar' : 'criar', depois: { nome, permissoes: permissoes.length } });
  return successResponse({ success: true, id: papelId });
});

router.on("staff_papel_delete", authStaff, async (ctx) => {
  await requirePerm(ctx, 'staff', 'gerenciar_papeis');
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  const { data: p } = await ctx.sb.from("lumied_staff_papeis").select("sistema, nome").eq("id", id).single();
  if (!p) throw new AppError("NOT_FOUND", "Papel não encontrado.");
  if ((p as any).sistema) throw new AppError("FORBIDDEN", "Papel do sistema não pode ser deletado.");
  // Staff com esse papel passam a papel_id=null (não bloqueia — mas ficarão sem acesso)
  await ctx.sb.from("lumied_staff").update({ papel_id: null }).eq("papel_id", id);
  await ctx.sb.from("lumied_staff_papeis").delete().eq("id", id);
  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'staff_papel', recurso_id: id, acao: 'deletar', antes: { nome: (p as any).nome } });
  return successResponse({ success: true });
});

router.on("staff_set_papel", authStaff, async (ctx) => {
  await requirePerm(ctx, 'staff', 'gerenciar_papeis');
  const { staff_id, papel_id } = ctx.body as any;
  if (!staff_id) throw new AppError("VALIDATION_FAILED", "staff_id obrigatório.");
  // papel_id pode ser null (remover vínculo)
  await ctx.sb.from("lumied_staff").update({ papel_id: papel_id || null }).eq("id", staff_id);
  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'lumied_staff', recurso_id: staff_id, acao: 'set_papel', depois: { papel_id } });
  return successResponse({ success: true });
});

router.on("staff_minhas_permissoes", authStaff, async (ctx) => {
  const user = ctx.user as any;
  if (user.cargo === 'fundador') {
    // Fundador tem tudo
    const all: { recurso: string; acao: string }[] = [];
    RECURSOS_CATALOGO.forEach(r => r.acoes.forEach(a => all.push({ recurso: r.recurso, acao: a })));
    return successResponse({ fundador: true, permissoes: all });
  }
  if (!user.papel_id) return successResponse({ fundador: false, permissoes: [] });
  const { data } = await ctx.sb.from("lumied_staff_permissoes")
    .select("recurso, acao")
    .eq("papel_id", user.papel_id);
  return successResponse({ fundador: false, permissoes: data || [] });
});

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD — Alertas (CS + Contas a Receber vencidas)
// ═══════════════════════════════════════════════════════════════
router.on("staff_dashboard_alertas", authStaff, async (ctx) => {
  const hoje = new Date().toISOString().slice(0, 10);

  // Saúde CS: escolas com sinais vermelho/amarelo (reusa os sinais da cs_saude_list)
  const { data: escolas } = await ctx.sb.from("escolas")
    .select("id, nome, subdominio, saas_status, saas_proximo_vencimento")
    .eq("ativo", true).limit(200);

  // Consultas que podem falhar se a tabela ainda não existir (ex: antes da mig 247 aplicar) — tolerar.
  const safeSelect = async <T>(fn: () => Promise<{ data: T[] | null }>): Promise<T[]> => {
    try { const r = await fn(); return r.data || []; } catch { return []; }
  };
  const [gerentesRes, faturasVenRes, cpVenData, crVenData] = await Promise.all([
    ctx.sb.from("gerentes").select("escola_id, ultimo_login"),
    ctx.sb.from("saas_faturas").select("escola_id, valor, data_vencimento, escolas(nome)").eq("status","OVERDUE").order("data_vencimento").limit(50),
    safeSelect<any>(() => ctx.sb.from("lumied_contas_pagar").select("id, fornecedor, valor, data_vencimento").eq("status","aberto").lt("data_vencimento", hoje).limit(20)),
    safeSelect<any>(() => ctx.sb.from("lumied_contas_receber").select("id, origem, valor, data_vencimento").eq("status","aberto").lt("data_vencimento", hoje).limit(20)),
  ]);

  // deno-lint-ignore no-explicit-any
  const gerMap: Record<string, string> = {};
  (gerentesRes.data || []).forEach((g: any) => { if (g.escola_id && g.ultimo_login) gerMap[g.escola_id] = g.ultimo_login; });

  const saudeAlertas: any[] = [];
  (escolas || []).forEach((e: any) => {
    const sinais: { cor: string; texto: string }[] = [];
    const ult = gerMap[e.id];
    const diasSemLogin = ult ? Math.floor((Date.now() - new Date(ult).getTime()) / 86400000) : 999;
    if (diasSemLogin > 14) sinais.push({ cor: 'vermelho', texto: `Gestor sem login há ${diasSemLogin}d` });
    if (e.saas_status === 'atraso') sinais.push({ cor: 'amarelo', texto: 'Fatura SaaS em atraso' });
    if (e.saas_status === 'suspenso' || e.saas_status === 'bloqueado') sinais.push({ cor: 'vermelho', texto: `SaaS ${e.saas_status}` });
    if (sinais.length > 0) {
      const cor = sinais.some(s => s.cor === 'vermelho') ? 'vermelho' : 'amarelo';
      saudeAlertas.push({ escola_id: e.id, escola_nome: e.nome, subdominio: e.subdominio, cor, sinais, dias_sem_login: diasSemLogin });
    }
  });
  saudeAlertas.sort((a, b) => (a.cor === 'vermelho' ? -1 : 1) - (b.cor === 'vermelho' ? -1 : 1) || b.dias_sem_login - a.dias_sem_login);

  // deno-lint-ignore no-explicit-any
  const crSaas: any[] = (faturasVenRes.data || []).map((f: any) => ({
    tipo: 'saas', escola_id: f.escola_id, escola_nome: f.escolas?.nome,
    valor: Number(f.valor), data_vencimento: f.data_vencimento,
    dias_atraso: Math.floor((new Date(hoje).getTime() - new Date(f.data_vencimento).getTime()) / 86400000),
  }));
  const crLumied = (crVenData || []).map((c: any) => ({
    tipo: 'lumied', id: c.id, origem: c.origem, valor: Number(c.valor), data_vencimento: c.data_vencimento,
    dias_atraso: Math.floor((new Date(hoje).getTime() - new Date(c.data_vencimento).getTime()) / 86400000),
  }));
  const cpVencidas = (cpVenData || []).map((c: any) => ({
    id: c.id, fornecedor: c.fornecedor, valor: Number(c.valor), data_vencimento: c.data_vencimento,
    dias_atraso: Math.floor((new Date(hoje).getTime() - new Date(c.data_vencimento).getTime()) / 86400000),
  }));

  return successResponse({
    saude_cs: {
      total: saudeAlertas.length,
      vermelho: saudeAlertas.filter(a => a.cor === 'vermelho').length,
      amarelo: saudeAlertas.filter(a => a.cor === 'amarelo').length,
      top10: saudeAlertas.slice(0, 10),
    },
    contas_receber_vencidas: {
      total: crSaas.length + crLumied.length,
      total_valor: [...crSaas, ...crLumied].reduce((s, c) => s + c.valor, 0),
      itens: [...crSaas, ...crLumied].slice(0, 15),
    },
    contas_pagar_vencidas: {
      total: cpVencidas.length,
      total_valor: cpVencidas.reduce((s, c) => s + c.valor, 0),
      itens: cpVencidas.slice(0, 15),
    },
  });
});

// ═══════════════════════════════════════════════════════════════
//  FINANCEIRO INTERNO — Contas a Pagar / Receber da própria Lumied
// ═══════════════════════════════════════════════════════════════

// Centros de Custo
router.on("cc_list", authStaff, async (ctx) => {
  await requirePerm(ctx, 'centros_custo', 'ver');
  const { data } = await ctx.sb.from("lumied_centros_custo").select("*").order("nome");
  return successResponse(data ?? []);
});

router.on("cc_upsert", authStaff, async (ctx) => {
  await requirePerm(ctx, 'centros_custo', 'gerenciar');
  const { id, nome, codigo, descricao, ativo } = ctx.body as any;
  if (!nome) throw new AppError("VALIDATION_FAILED", "Nome obrigatório.");
  if (id) {
    const { error } = await ctx.sb.from("lumied_centros_custo").update({ nome, codigo: codigo || null, descricao: descricao || null, ativo: ativo !== false }).eq("id", id);
    if (error) throw new AppError("BAD_REQUEST", error.message);
  } else {
    const { error } = await ctx.sb.from("lumied_centros_custo").insert({ nome, codigo: codigo || null, descricao: descricao || null, ativo: ativo !== false });
    if (error) throw new AppError("BAD_REQUEST", error.message);
  }
  return successResponse({ success: true });
});

// Categorias de Despesa (hierárquica)
router.on("categoria_list", authStaff, async (ctx) => {
  await requirePerm(ctx, 'financeiro_lumied', 'ver_cp');
  const { data } = await ctx.sb.from("lumied_categorias_despesa")
    .select("id, nome, parent_id, tipo, ativo").order("nome");
  return successResponse(data ?? []);
});

router.on("categoria_upsert", authStaff, async (ctx) => {
  await requirePerm(ctx, 'financeiro_lumied', 'criar_cp');
  const { id, nome, parent_id, tipo, ativo } = ctx.body as any;
  if (!nome) throw new AppError("VALIDATION_FAILED", "Nome obrigatório.");
  const payload = { nome, parent_id: parent_id || null, tipo: tipo || 'despesa', ativo: ativo !== false };
  if (id) {
    const { error } = await ctx.sb.from("lumied_categorias_despesa").update(payload).eq("id", id);
    if (error) throw new AppError("BAD_REQUEST", error.message);
  } else {
    const { error } = await ctx.sb.from("lumied_categorias_despesa").insert(payload);
    if (error) throw new AppError("BAD_REQUEST", error.message);
  }
  return successResponse({ success: true });
});

// Contas a Pagar
router.on("cp_list", authStaff, async (ctx) => {
  await requirePerm(ctx, 'financeiro_lumied', 'ver_cp');
  const { status, centro_custo_id, categoria_id, desde, ate } = ctx.body as any;
  let q = ctx.sb.from("lumied_contas_pagar")
    .select("*, centro:centro_custo_id(id,nome,codigo), categoria:categoria_id(id,nome,parent_id)")
    .order("data_vencimento", { ascending: true }).limit(500);
  if (status) q = q.eq("status", status);
  if (centro_custo_id) q = q.eq("centro_custo_id", centro_custo_id);
  if (categoria_id) q = q.eq("categoria_id", categoria_id);
  if (desde) q = q.gte("data_vencimento", desde);
  if (ate) q = q.lte("data_vencimento", ate);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("cp_upsert", authStaff, async (ctx) => {
  const { id, fornecedor, documento, descricao, valor, data_emissao, data_vencimento, centro_custo_id, categoria_id, forma_pagamento, anexo_url, observacao } = ctx.body as any;
  await requirePerm(ctx, 'financeiro_lumied', id ? 'editar_cp' : 'criar_cp');
  if (!fornecedor || !valor || !data_vencimento) throw new AppError("VALIDATION_FAILED", "Fornecedor, valor e vencimento obrigatórios.");
  const payload: any = {
    fornecedor, documento: documento || null, descricao: descricao || null,
    valor: Number(valor), data_emissao: data_emissao || null,
    data_vencimento, centro_custo_id: centro_custo_id || null,
    categoria_id: categoria_id || null, forma_pagamento: forma_pagamento || null,
    anexo_url: anexo_url || null, observacao: observacao || null,
  };
  if (id) {
    const { error } = await ctx.sb.from("lumied_contas_pagar").update(payload).eq("id", id);
    if (error) throw new AppError("BAD_REQUEST", error.message);
  } else {
    payload.criado_por_staff_id = ctx.user!.id;
    payload.status = 'aberto';
    const { error } = await ctx.sb.from("lumied_contas_pagar").insert(payload);
    if (error) throw new AppError("BAD_REQUEST", error.message);
  }
  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'contas_pagar', recurso_id: id, acao: id ? 'editar' : 'criar', depois: { fornecedor, valor } });
  return successResponse({ success: true });
});

router.on("cp_pagar", authStaff, async (ctx) => {
  await requirePerm(ctx, 'financeiro_lumied', 'pagar_cp');
  const { id, data_pagamento, valor_pago, forma_pagamento, observacao } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  const { data: c } = await ctx.sb.from("lumied_contas_pagar").select("valor").eq("id", id).single();
  if (!c) throw new AppError("NOT_FOUND", "Conta não encontrada.");
  await ctx.sb.from("lumied_contas_pagar").update({
    status: 'pago',
    data_pagamento: data_pagamento || new Date().toISOString().slice(0, 10),
    valor_pago: Number(valor_pago) || Number((c as any).valor),
    forma_pagamento: forma_pagamento || null,
    observacao: observacao || null,
    pago_por_staff_id: ctx.user!.id,
  }).eq("id", id);
  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'contas_pagar', recurso_id: id, acao: 'pagar', depois: { valor_pago } });
  return successResponse({ success: true });
});

router.on("cp_delete", authStaff, async (ctx) => {
  await requirePerm(ctx, 'financeiro_lumied', 'editar_cp');
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  await ctx.sb.from("lumied_contas_pagar").delete().eq("id", id);
  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'contas_pagar', recurso_id: id, acao: 'deletar' });
  return successResponse({ success: true });
});

// Contas a Receber
router.on("cr_list", authStaff, async (ctx) => {
  await requirePerm(ctx, 'financeiro_lumied', 'ver_cr');
  const { status, desde, ate } = ctx.body as any;
  let q = ctx.sb.from("lumied_contas_receber")
    .select("*, escola:escola_id(id,nome,subdominio)")
    .order("data_vencimento", { ascending: true }).limit(500);
  if (status) q = q.eq("status", status);
  if (desde) q = q.gte("data_vencimento", desde);
  if (ate) q = q.lte("data_vencimento", ate);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("cr_upsert", authStaff, async (ctx) => {
  const { id, origem, escola_id, descricao, valor, data_emissao, data_vencimento, forma_pagamento, observacao } = ctx.body as any;
  await requirePerm(ctx, 'financeiro_lumied', id ? 'editar_cr' : 'criar_cr');
  if (!origem || !valor || !data_vencimento) throw new AppError("VALIDATION_FAILED", "Origem, valor e vencimento obrigatórios.");
  const payload: any = {
    origem, escola_id: escola_id || null, descricao: descricao || null,
    valor: Number(valor), data_emissao: data_emissao || null, data_vencimento,
    forma_pagamento: forma_pagamento || null, observacao: observacao || null,
  };
  if (id) {
    const { error } = await ctx.sb.from("lumied_contas_receber").update(payload).eq("id", id);
    if (error) throw new AppError("BAD_REQUEST", error.message);
  } else {
    payload.criado_por_staff_id = ctx.user!.id;
    payload.status = 'aberto';
    const { error } = await ctx.sb.from("lumied_contas_receber").insert(payload);
    if (error) throw new AppError("BAD_REQUEST", error.message);
  }
  return successResponse({ success: true });
});

router.on("cr_receber", authStaff, async (ctx) => {
  await requirePerm(ctx, 'financeiro_lumied', 'editar_cr');
  const { id, data_recebimento, valor_recebido, forma_pagamento, observacao } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  const { data: c } = await ctx.sb.from("lumied_contas_receber").select("valor, origem, saas_fatura_id").eq("id", id).single();
  if (!c) throw new AppError("NOT_FOUND", "Conta não encontrada.");
  if ((c as any).origem === 'saas' && (c as any).saas_fatura_id) {
    throw new AppError("FORBIDDEN", "Fatura SaaS — registre o pagamento em 'Cobrança SaaS' (o valor aparecerá aqui automaticamente).");
  }
  await ctx.sb.from("lumied_contas_receber").update({
    status: 'recebido',
    data_recebimento: data_recebimento || new Date().toISOString().slice(0, 10),
    valor_recebido: Number(valor_recebido) || Number((c as any).valor),
    forma_pagamento: forma_pagamento || null,
    observacao: observacao || null,
  }).eq("id", id);
  return successResponse({ success: true });
});

router.on("cr_delete", authStaff, async (ctx) => {
  await requirePerm(ctx, 'financeiro_lumied', 'editar_cr');
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  // Bloqueia deleção de linhas origem=saas (espelho de saas_faturas)
  const { data: cr } = await ctx.sb.from("lumied_contas_receber").select("origem, saas_fatura_id").eq("id", id).maybeSingle();
  if (cr && (cr as any).origem === 'saas' && (cr as any).saas_fatura_id) {
    throw new AppError("FORBIDDEN", "Esta linha é um espelho de uma fatura SaaS. Gerencie em 'Cobrança SaaS'.");
  }
  await ctx.sb.from("lumied_contas_receber").delete().eq("id", id);
  return successResponse({ success: true });
});

// Fluxo de caixa consolidado + por centro de custo
router.on("financeiro_resumo", authStaff, async (ctx) => {
  await requirePerm(ctx, 'financeiro_lumied', 'ver_cp');
  const hoje = new Date().toISOString().slice(0, 10);
  const ini = new Date(); ini.setDate(1); const inicioMes = ini.toISOString().slice(0, 10);
  const [cpAb, cpPg, crAb, crRec, porCentro] = await Promise.all([
    ctx.sb.from("lumied_contas_pagar").select("valor, data_vencimento").eq("status","aberto"),
    ctx.sb.from("lumied_contas_pagar").select("valor_pago, data_pagamento").eq("status","pago").gte("data_pagamento", inicioMes),
    ctx.sb.from("lumied_contas_receber").select("valor, data_vencimento").eq("status","aberto"),
    ctx.sb.from("lumied_contas_receber").select("valor_recebido, data_recebimento").eq("status","recebido").gte("data_recebimento", inicioMes),
    ctx.sb.from("v_cp_por_centro_mes").select("*"),
  ]);
  // deno-lint-ignore no-explicit-any
  const cpAberto: any[] = cpAb.data || [];
  const cpVencido = cpAberto.filter(c => c.data_vencimento < hoje).reduce((s, c) => s + Number(c.valor || 0), 0);
  const cpAbTotal = cpAberto.reduce((s, c) => s + Number(c.valor || 0), 0);
  // deno-lint-ignore no-explicit-any
  const cpPgMes = (cpPg.data || []).reduce((s, c: any) => s + Number(c.valor_pago || 0), 0);
  // deno-lint-ignore no-explicit-any
  const crAberto: any[] = crAb.data || [];
  const crVencido = crAberto.filter(c => c.data_vencimento < hoje).reduce((s, c) => s + Number(c.valor || 0), 0);
  const crAbTotal = crAberto.reduce((s, c) => s + Number(c.valor || 0), 0);
  // deno-lint-ignore no-explicit-any
  const crRecMes = (crRec.data || []).reduce((s, c: any) => s + Number(c.valor_recebido || 0), 0);

  return successResponse({
    cp: { aberto_total: cpAbTotal, vencido: cpVencido, pago_mes: cpPgMes },
    cr: { aberto_total: crAbTotal, vencido: crVencido, recebido_mes: crRecMes },
    saldo_mes: crRecMes - cpPgMes,
    por_centro_mes: porCentro.data || [],
  });
});

// ── Cron: Reativação de leads frios (7+ dias sem contato) ──
router.on("cron_reativar_leads", async (ctx) => {
  const cronKey = Deno.env.get("CRON_INTERNAL_KEY") || "";
  const token = (ctx.body._cron_key as string) || "";
  if (!cronKey || token !== cronKey) throw new AppError("AUTH_INVALID", "Chave de cron inválida.");

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return successResponse({ skipped: true, reason: "RESEND_API_KEY not set" });

  // Leads com status 'novo' criados há 7-14 dias que ainda não receberam reativação
  const { data: leads } = await ctx.sb.from("leads_comerciais")
    .select("id, email, nome_escola")
    .eq("status", "novo")
    .is("reativado_em", null)
    .lt("criado_em", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .gt("criado_em", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
    .limit(20);

  if (!leads?.length) return successResponse({ enviados: 0 });

  let enviados = 0;
  for (const lead of leads) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Lumied <contato@lumied.com.br>",
          to: [lead.email],
          subject: `${lead.nome_escola || "Sua escola"} \u2014 veja o que mudou para a Maple Bear em 90 dias`,
          html: emailLayout(`
            <h2 style="font-size:22px;color:#1E1B4B;margin:0 0 8px;text-align:center;">Ainda pensando?</h2>
            <p style="font-size:14px;color:#475569;text-align:center;margin:0 0 24px;">Veja o que aconteceu com uma escola que deu o passo.</p>
            <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:20px;margin-bottom:24px;">
              <h3 style="font-size:16px;color:#166534;margin:0 0 12px;">Maple Bear Caxias do Sul \u2014 90 dias com Lumied</h3>
              <ul style="list-style:none;padding:0;margin:0;font-size:14px;color:#1E1B4B;line-height:2;">
                <li>\u2705 Inadimpl\u00eancia: <strong>14% \u2192 8,3%</strong> (-40%)</li>
                <li>\u2705 Tempo economizado: <strong>12h/semana</strong></li>
                <li>\u2705 Receita recuperada: <strong>R$ 31k/m\u00eas</strong></li>
                <li>\u2705 Tempo de resposta: <strong>4h \u2192 8min</strong></li>
              </ul>
            </div>
            <p style="font-size:14px;color:#475569;line-height:1.7;">Se ${lead.nome_escola || "sua escola"} est\u00e1 enfrentando desafios semelhantes, podemos mostrar exatamente como o Lumied resolve \u2014 em uma demo de 20 minutos, sem compromisso.</p>
            <div style="text-align:center;margin-top:24px;">
              <a href="https://lumied.com.br/demo/?utm_source=reativacao&utm_medium=email&utm_campaign=lead_frio" style="display:inline-block;padding:14px 32px;background:${BRAND_GRADIENT};color:#fff;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">Agendar Demo Gratuita \u2192</a>
            </div>
          `, { preheader: "Maple Bear reduziu inadimpl\u00eancia em 40% em 90 dias. Sua escola pode ser a pr\u00f3xima." }),
        }),
        signal: AbortSignal.timeout(8000),
      });
      await ctx.sb.from("leads_comerciais").update({ reativado_em: new Date().toISOString() }).eq("id", lead.id);
      enviados++;
    } catch (e) { console.error(`[REATIVACAO] Error for ${lead.id}:`, e); }
  }

  return successResponse({ enviados, total: leads.length });
});

// ── Cron: Distribuir novo artigo do blog para newsletter ──
router.on("cron_newsletter_artigo", async (ctx) => {
  const cronKey = Deno.env.get("CRON_INTERNAL_KEY") || "";
  const token = (ctx.body._cron_key as string) || "";
  if (!cronKey || token !== cronKey) throw new AppError("AUTH_INVALID", "Chave de cron inválida.");

  const { titulo, url, excerpt, categoria } = ctx.body as any;
  if (!titulo || !url) throw new AppError("VALIDATION_FAILED", "titulo e url obrigatórios.");

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return successResponse({ skipped: true, reason: "RESEND_API_KEY not set" });

  const { data: subs } = await ctx.sb.from("newsletter_subscribers")
    .select("email")
    .eq("confirmado", true)
    .limit(500);

  if (!subs?.length) return successResponse({ enviados: 0 });

  const emails = subs.map((s: any) => s.email);

  // Resend batch (max 100 per call)
  let enviados = 0;
  for (let i = 0; i < emails.length; i += 50) {
    const batch = emails.slice(i, i + 50);
    try {
      await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(batch.map((email: string) => ({
          from: "Lumied Blog <blog@lumied.com.br>",
          to: email,
          subject: `Novo artigo: ${titulo}`,
          html: emailLayout(`
            <p style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:${BRAND_COLOR};font-weight:700;margin:0 0 8px;">Novo no blog \u00b7 ${categoria || "Gest\u00e3o Escolar"}</p>
            <h1 style="font-size:22px;line-height:1.3;margin:0 0 12px;color:#1E1B4B;">${titulo}</h1>
            <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px;">${excerpt || "Leia o artigo completo no blog do Lumied."}</p>
            <div style="text-align:center;">
              <a href="${url}?utm_source=newsletter&utm_medium=email&utm_campaign=novo_artigo" style="display:inline-block;padding:12px 28px;background:${BRAND_GRADIENT};color:#fff;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px;">Ler artigo completo \u2192</a>
            </div>
          `, { preheader: titulo }),
        }))),
        signal: AbortSignal.timeout(15000),
      });
      enviados += batch.length;
    } catch (e) { console.error("[NEWSLETTER_ARTIGO] Batch error:", e); }
  }

  return successResponse({ enviados, total: subs.length });
});

// ── Cron: Lead scoring automático ──
router.on("cron_lead_scoring", async (ctx) => {
  const cronKey = Deno.env.get("CRON_INTERNAL_KEY") || "";
  const token = (ctx.body._cron_key as string) || "";
  if (!cronKey || token !== cronKey) throw new AppError("AUTH_INVALID", "Chave de cron inválida.");

  // Score leads based on available data
  const { data: leads } = await ctx.sb.from("leads_comerciais")
    .select("id, nome_escola, email, telefone, mensagem, utm_source, utm_campaign, status")
    .is("score", null)
    .limit(50);

  if (!leads?.length) return successResponse({ scored: 0 });

  let scored = 0;
  for (const lead of leads) {
    let score = 10; // base score
    // Has phone → more serious
    if (lead.telefone) score += 15;
    // Has message → engaged
    if (lead.mensagem && lead.mensagem.length > 20) score += 10;
    // From comparison page → high intent
    if (lead.utm_source === "vs_page" || lead.utm_campaign?.includes("vs_")) score += 20;
    // From exit intent → lower intent
    if (lead.utm_source === "exit_intent") score -= 5;
    // From ROI calculator → high intent
    if (lead.utm_source === "roi_calc") score += 20;
    // School name suggests real school
    if (lead.nome_escola && !lead.nome_escola.includes("test") && lead.nome_escola.length > 5) score += 10;
    // Email domain (not gmail/hotmail = school email = higher intent)
    const domain = lead.email?.split("@")[1] || "";
    if (domain && !["gmail.com","hotmail.com","outlook.com","yahoo.com","icloud.com"].includes(domain)) score += 15;
    // Already progressed in funnel
    if (lead.status === "demo_agendada") score += 30;
    else if (lead.status === "qualificado") score += 20;
    else if (lead.status === "contatado") score += 10;

    score = Math.max(0, Math.min(100, score));

    await ctx.sb.from("leads_comerciais").update({ score }).eq("id", lead.id);
    scored++;
  }

  return successResponse({ scored, total: leads.length });
});

// ── Cron: Follow-up pós-demo ──
router.on("cron_followup_demo", async (ctx) => {
  const cronKey = Deno.env.get("CRON_INTERNAL_KEY") || "";
  const token = (ctx.body._cron_key as string) || "";
  if (!cronKey || token !== cronKey) throw new AppError("AUTH_INVALID", "Chave de cron inválida.");

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return successResponse({ skipped: true, reason: "RESEND_API_KEY not set" });

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // Find leads with demo_agendada that need follow-up
  const { data: leads } = await ctx.sb.from("leads_comerciais")
    .select("id, email, nome_escola, status, demo_em, followup_passo")
    .eq("status", "demo_agendada")
    .not("demo_em", "is", null)
    .limit(20);

  if (!leads?.length) return successResponse({ enviados: 0 });

  let enviados = 0;
  for (const lead of leads) {
    const demoDate = new Date(lead.demo_em).getTime();
    const daysSince = Math.floor((now - demoDate) / day);
    const passo = lead.followup_passo || 0;

    let subject = "", html = "", nextPasso = passo;

    if (daysSince >= 1 && passo < 1) {
      nextPasso = 1;
      subject = `Obrigado pela demo, ${lead.nome_escola || "equipe"}!`;
      html = emailLayout(`
        <h2 style="font-size:20px;color:#1E1B4B;margin:0 0 16px;">Obrigado por assistir a demo!</h2>
        <p style="font-size:14px;color:#475569;line-height:1.7;">Foi \u00f3timo conversar sobre as necessidades de ${lead.nome_escola || "sua escola"}. Aqui est\u00e1 um resumo do que vimos:</p>
        <ul style="font-size:14px;color:#1E1B4B;line-height:2;padding-left:20px;">
          <li>23 m\u00f3dulos integrados em uma \u00fanica plataforma</li>
          <li>IA que analisa os dados da escola e sugere a\u00e7\u00f5es</li>
          <li>WhatsApp oficial integrado</li>
          <li>Compliance CLT e LGPD automatizado</li>
        </ul>
        <p style="font-size:14px;color:#475569;">Alguma d\u00favida? Responda este email ou fale conosco no WhatsApp.</p>
        <div style="text-align:center;margin-top:24px;">
          <a href="https://lumied.com.br/#pricing" style="display:inline-block;padding:12px 28px;background:${BRAND_GRADIENT};color:#fff;border-radius:8px;font-weight:700;text-decoration:none;">Ver planos e pre\u00e7os \u2192</a>
        </div>
      `, { preheader: "Resumo da demo + pr\u00f3ximos passos" });
    } else if (daysSince >= 3 && passo < 2) {
      nextPasso = 2;
      subject = `Proposta comercial para ${lead.nome_escola || "sua escola"}`;
      html = emailLayout(`
        <h2 style="font-size:20px;color:#1E1B4B;margin:0 0 16px;">Pronto para dar o pr\u00f3ximo passo?</h2>
        <p style="font-size:14px;color:#475569;line-height:1.7;">Com base na nossa conversa, o <strong>plano Evolu\u00e7\u00e3o</strong> parece ideal para ${lead.nome_escola || "sua escola"}:</p>
        <div style="background:#F0EDFF;border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
          <p style="font-size:28px;font-weight:800;color:${BRAND_COLOR};margin:0;">R$ 997<span style="font-size:14px;font-weight:400;color:#475569;">/m\u00eas (anual)</span></p>
          <p style="font-size:13px;color:#475569;margin:8px 0 0;">23 m\u00f3dulos \u00b7 at\u00e9 800 alunos \u00b7 WhatsApp 500 msgs/m\u00eas \u00b7 IA inclusa</p>
        </div>
        <p style="font-size:14px;color:#475569;">Implanta\u00e7\u00e3o em 7-15 dias \u00fateis, com migra\u00e7\u00e3o de dados e treinamento inclu\u00eddo.</p>
        <div style="text-align:center;margin-top:24px;">
          <a href="https://lumied.com.br/#contact" style="display:inline-block;padding:12px 28px;background:${BRAND_GRADIENT};color:#fff;border-radius:8px;font-weight:700;text-decoration:none;">Come\u00e7ar agora \u2192</a>
        </div>
      `, { preheader: "Plano Evolu\u00e7\u00e3o: R$ 997/m\u00eas com IA + WhatsApp + Compliance" });
    } else if (daysSince >= 7 && passo < 3) {
      nextPasso = 3;
      subject = `\u00daltima chance: condi\u00e7\u00e3o especial para ${lead.nome_escola || "sua escola"}`;
      html = emailLayout(`
        <h2 style="font-size:20px;color:#1E1B4B;margin:0 0 16px;">Condi\u00e7\u00e3o especial expira em breve</h2>
        <p style="font-size:14px;color:#475569;line-height:1.7;">Para escolas que agendam a implanta\u00e7\u00e3o esta semana, estamos oferecendo:</p>
        <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:12px;padding:20px;margin:20px 0;">
          <ul style="list-style:none;padding:0;margin:0;font-size:14px;color:#92400E;line-height:2;">
            <li>\u2B50 <strong>1 m\u00eas gr\u00e1tis</strong> no plano escolhido</li>
            <li>\u2B50 <strong>Migra\u00e7\u00e3o express</strong> (7 dias \u00fateis)</li>
            <li>\u2B50 <strong>Treinamento extra</strong> (+1 sess\u00e3o individual)</li>
          </ul>
        </div>
        <div style="text-align:center;margin-top:24px;">
          <a href="https://lumied.com.br/demo/?utm_source=followup&utm_campaign=oferta_especial" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#F59E0B,#F97316);color:#fff;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">Garantir condi\u00e7\u00e3o especial \u2192</a>
        </div>
      `, { preheader: "1 m\u00eas gr\u00e1tis + migra\u00e7\u00e3o express \u2014 s\u00f3 esta semana" });
    } else {
      continue;
    }

    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Lumied <contato@lumied.com.br>", to: [lead.email], subject, html }),
        signal: AbortSignal.timeout(8000),
      });
      await ctx.sb.from("leads_comerciais").update({ followup_passo: nextPasso }).eq("id", lead.id);
      enviados++;
    } catch (e) { console.error(`[FOLLOWUP] Error for ${lead.id}:`, e); }
  }

  return successResponse({ enviados, total: leads.length });
});

// ═══════════════════════════════════════════════════════════════
//  BANCOS — config bancária por escola (multi-banco)
//  Sprint 0 do plano de expansão. Adapters em _shared/banks/.
// ═══════════════════════════════════════════════════════════════

router.on("staff_bancos_providers", authStaff, async (_ctx) => {
  const { bancosImplementados } = await import("../_shared/banks/registry.ts");
  return successResponse({
    implementados: bancosImplementados(),
    todos: ['inter', 'sicredi', 'bb', 'itau', 'bradesco'],
  });
});

router.on("staff_bancos_list", authStaff, async (ctx) => {
  const { escola_id } = ctx.body as any;
  let q = ctx.sb.from("escola_banco_config")
    .select("*, escolas(id, nome, slug)")
    .order("criado_em", { ascending: false });
  if (escola_id) q = q.eq("escola_id", escola_id);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("staff_banco_save", authStaff, async (ctx) => {
  const b = ctx.body as any;
  if (!b.escola_id || !b.banco) throw new AppError("VALIDATION_FAILED", "escola_id e banco são obrigatórios.");
  if (!['inter', 'sicredi', 'bb', 'itau', 'bradesco'].includes(b.banco)) throw new AppError("VALIDATION_FAILED", "Banco inválido.");
  if (!b.agencia || !b.conta || !b.beneficiario_cnpj || !b.beneficiario_nome) {
    throw new AppError("VALIDATION_FAILED", "agencia, conta, beneficiario_cnpj e beneficiario_nome obrigatórios.");
  }

  const cnpjLimpo = String(b.beneficiario_cnpj).replace(/\D/g, '');
  const payload: Record<string, unknown> = {
    escola_id: b.escola_id,
    banco: b.banco,
    agencia: b.agencia,
    conta: b.conta,
    conta_digito: b.conta_digito || null,
    convenio: b.convenio || null,
    carteira: b.carteira || null,
    beneficiario_cnpj: cnpjLimpo,
    beneficiario_nome: b.beneficiario_nome,
    client_id: b.client_id || null,
    client_secret_name: b.client_secret_name || null,
    pix_chave: b.pix_chave || null,
    pix_tipo: b.pix_tipo || null,
    webhook_secret: b.webhook_secret || null,
    webhook_url: b.webhook_url || null,
    cert_storage_path: b.cert_storage_path || null,
    cert_secret_key: b.cert_secret_key || null,
    cert_validade: b.cert_validade || null,
    ativo: b.ativo ?? true,
    created_by: ctx.user!.id,
  };

  // Upsert por (escola_id, banco)
  const { data: existing } = await ctx.sb.from("escola_banco_config")
    .select("id").eq("escola_id", b.escola_id).eq("banco", b.banco).maybeSingle();

  let id: string;
  if (existing) {
    delete (payload as any).created_by;
    const { error } = await ctx.sb.from("escola_banco_config").update(payload).eq("id", (existing as any).id);
    if (error) throw new AppError("BAD_REQUEST", error.message);
    id = (existing as any).id;
  } else {
    const { data: inserted, error } = await ctx.sb.from("escola_banco_config").insert(payload).select("id").single();
    if (error) throw new AppError("BAD_REQUEST", error.message);
    id = (inserted as any).id;
  }

  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'escola_banco_config', recurso_id: id, escola_id: b.escola_id, acao: existing ? 'editar' : 'criar', depois: { banco: b.banco } });
  return successResponse({ id, success: true });
});

router.on("staff_banco_set_padrao", authStaff, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");

  const { data: cfg } = await ctx.sb.from("escola_banco_config").select("escola_id, banco").eq("id", id).maybeSingle();
  if (!cfg) throw new AppError("NOT_FOUND", "Config não encontrada.");

  // Desmarca outros bancos padrão da mesma escola
  await ctx.sb.from("escola_banco_config").update({ padrao: false }).eq("escola_id", (cfg as any).escola_id);
  // Marca este como padrão
  await ctx.sb.from("escola_banco_config").update({ padrao: true }).eq("id", id);

  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'escola_banco_config', recurso_id: id, escola_id: (cfg as any).escola_id, acao: 'set_padrao', depois: { banco: (cfg as any).banco } });
  return successResponse({ success: true });
});

router.on("staff_banco_delete", authStaff, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  const { data: cfg } = await ctx.sb.from("escola_banco_config").select("escola_id, banco, padrao").eq("id", id).maybeSingle();
  if (!cfg) throw new AppError("NOT_FOUND", "Config não encontrada.");
  if ((cfg as any).padrao) throw new AppError("FORBIDDEN", "Banco padrão não pode ser desativado. Defina outro como padrão antes.");
  await ctx.sb.from("escola_banco_config").update({ ativo: false }).eq("id", id);
  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'escola_banco_config', recurso_id: id, escola_id: (cfg as any).escola_id, acao: 'desativar' });
  return successResponse({ success: true });
});

router.on("staff_banco_upload_cert", authStaff, async (ctx) => {
  const { id, cert_base64, filename } = ctx.body as any;
  if (!id || !cert_base64) throw new AppError("VALIDATION_FAILED", "id e cert_base64 obrigatórios.");

  const { data: cfg } = await ctx.sb.from("escola_banco_config").select("escola_id, banco").eq("id", id).maybeSingle();
  if (!cfg) throw new AppError("NOT_FOUND", "Config não encontrada.");

  const path = `${(cfg as any).escola_id}/${(cfg as any).banco}.pfx`;
  const ext = (filename || '').toLowerCase().endsWith('.pem') ? 'pem' : 'pfx';
  const finalPath = `${(cfg as any).escola_id}/${(cfg as any).banco}.${ext}`;

  const binary = Uint8Array.from(atob(cert_base64), c => c.charCodeAt(0));
  const { error: upErr } = await ctx.sb.storage.from('bank-certs').upload(finalPath, binary, { upsert: true, contentType: 'application/x-pkcs12' });
  if (upErr) throw new AppError("BAD_REQUEST", `Upload cert falhou: ${upErr.message}`);

  await ctx.sb.from("escola_banco_config").update({ cert_storage_path: finalPath }).eq("id", id);
  logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'escola_banco_config', recurso_id: id, escola_id: (cfg as any).escola_id, acao: 'upload_cert', depois: { path: finalPath } });
  return successResponse({ success: true, path: finalPath });
});

router.on("staff_banco_test_emissao", authStaff, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");

  const { getBankAdapter } = await import("../_shared/banks/registry.ts");
  const { BankError } = await import("../_shared/banks/errors.ts");

  const { data: cfg } = await ctx.sb.from("escola_banco_config").select("*").eq("id", id).maybeSingle();
  if (!cfg) throw new AppError("NOT_FOUND", "Config não encontrada.");

  try {
    const adapter = getBankAdapter((cfg as any).banco);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 7);
    const result = await adapter.emitirBoleto({
      pagador: {
        cpf_cnpj: '11144477735',  // CPF de teste padrão
        nome: 'TESTE LUMIED',
        email: 'teste@lumied.com.br',
      },
      valor: 0.01,
      vencimento: tomorrow.toISOString().slice(0, 10),
      descricao: 'Boleto de teste — homologação Lumied',
    }, cfg as any);

    // Marca como homologado
    await ctx.sb.from("escola_banco_config").update({
      homologado: true,
      ultima_emissao: new Date().toISOString(),
      ultimo_erro: null,
      ultimo_erro_em: null,
    }).eq("id", id);

    logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'escola_banco_config', recurso_id: id, escola_id: (cfg as any).escola_id, acao: 'test_emissao_ok', depois: { nosso_numero: result.nosso_numero } });

    return successResponse({
      success: true,
      nosso_numero: result.nosso_numero,
      codigo_solicitacao: result.codigo_solicitacao,
      banco: (cfg as any).banco,
    });
  } catch (e) {
    const msg = e instanceof BankError ? `${e.code}: ${e.message}` : String(e);
    await ctx.sb.from("escola_banco_config").update({
      ultimo_erro: msg.slice(0, 500),
      ultimo_erro_em: new Date().toISOString(),
    }).eq("id", id);
    logAudit(ctx.sb, { ator_tipo: 'staff', ator_id: ctx.user?.id, ator_email: ctx.user?.email, recurso: 'escola_banco_config', recurso_id: id, escola_id: (cfg as any).escola_id, acao: 'test_emissao_falha', depois: { erro: msg.slice(0, 200) } });
    if (e instanceof BankError) {
      return successResponse({ success: false, ...e.toJSON() });
    }
    throw new AppError("BAD_REQUEST", msg);
  }
});

// ═══ SERVE ═══
serve(async (req: Request) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
