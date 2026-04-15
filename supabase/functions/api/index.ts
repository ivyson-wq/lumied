// ═══════════════════════════════════════════════════════════════
//  Maple Bear RS — Edge Function: api (v2 — Hybrid Router + Legacy)
//  Router para actions migradas, fallback para actions legadas
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateChallenge, verifyRegistration, verifyAuthentication, b64urlEncode } from "../_shared/webauthn.ts";
import { getModulosHabilitados, getEscolaPadrao } from "../_shared/modulos.ts";
import { resolveEscolaId } from "../_shared/tenant.ts";
import { checkRateLimit, getClientIP } from "../_shared/ratelimit.ts";
import { sanitizeBody } from "../_shared/validation.ts";
import { getCorsHeaders, corsResponse } from "../_shared/cors.ts";
import { createLogger } from "../_shared/logger.ts";
import { hashSenhaV1 as hashSenha, hashSenha as hashSenhaProf, verificarSenhaAuto, gerarToken, validarSessao as _validarSessao } from "../_shared/auth.ts";
import { sanitizePgError } from "../_shared/errors.ts";
import { logAudit } from "../_shared/audit.ts";

const log = createLogger("api");

// ── Helpers de segurança para emails (XSS / header injection / brute force) ──
function escapeHtml(s: unknown): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function sanitizeHeaderValue(s: unknown): string {
  if (s == null) return '';
  return String(s).replace(/[\r\n\x00-\x1f\x7f]/g, '').substring(0, 200);
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Validar sessão (gerente ou sessão unificada com papel gerente/secretaria/comercial) ──
async function validarSessao(admin: ReturnType<typeof createClient>, token: string | null) {
  // Tenta gerente_sessoes primeiro (legado)
  const gerente = await _validarSessao(admin, "gerente_sessoes", "gerentes", "gerente_id", token);
  if (gerente) return gerente;
  // Fallback: sessão unificada (permite todos os papéis acessarem actions da API)
  if (!token) return null;
  const { data: sessao } = await admin.from("sessoes").select("usuario_id, expira_em").eq("token", token).maybeSingle();
  if (sessao && new Date(sessao.expira_em) >= new Date()) {
    const { data: user } = await admin.from("usuarios").select("id, nome, email, papeis, papel").eq("id", sessao.usuario_id).maybeSingle();
    if (user) {
      const roles: string[] = user.papeis?.length ? user.papeis : (user.papel ? [user.papel] : []);
      const allowedRoles = ["gerente", "diretor", "financeiro", "secretaria", "comercial", "professora", "professora_assistente", "impressao"];
      if (roles.some((r: string) => allowedRoles.includes(r))) return { id: user.id, nome: user.nome, email: user.email };
    }
  }
  // Fallback: professora_sessoes (legado — professoras que logaram via professora_login)
  const prof = await _validarSessao(admin, "professora_sessoes", "professoras", "professora_id", token);
  if (prof) return prof;
  return null;
}

serve(async (req: Request) => {
  // Dynamic CORS based on request origin
  const CORS = getCorsHeaders(req);
  const startTime = Date.now();
  let currentAction = 'unknown';
  const timingHeader = () => {
    const ms = Date.now() - startTime;
    if (ms > 1000) console.warn(`[slow] ${currentAction} ${ms}ms`);
    return { "X-Response-Time": String(ms) };
  };
  const ok  = (data: unknown, extraHeaders: Record<string, string> = {}) => new Response(JSON.stringify(data), { headers: { ...CORS, "Content-Type": "application/json", ...timingHeader(), ...extraHeaders } });
  const err = (msg: string, s = 400, code?: string) => new Response(JSON.stringify({ error: msg, ...(code ? { code } : {}) }), { status: s, headers: { ...CORS, "Content-Type": "application/json", ...timingHeader() } });
  const PUBLIC_CACHE = { "Cache-Control": "public, max-age=60, s-maxage=60" };

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Parse body once
  const bodyText = await req.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(bodyText); } catch { return err("Body inválido"); }

  // Apply rate limiting
  const reqAction = (body.action as string) || '';
  const ip = getClientIP(req);
  const rl = checkRateLimit(ip, reqAction.startsWith("login") ? "login" : "api");
  if (!rl.allowed) return err(`Tente novamente em ${rl.retryAfterSeconds}s.`, 429);

  // Sanitize body
  body = sanitizeBody(body) as Record<string, unknown>;

  const { action } = body;
  currentAction = String(action || 'unknown');

  // ════════════════════════════════════════════════════════════
  //  AÇÕES PÚBLICAS (sem autenticação)
  // ════════════════════════════════════════════════════════════

  // ── Validar superusuário (admin.html) ──
  if (action === "admin_check") {
    const authHeader = req.headers.get("authorization") ?? ""
    const userToken = authHeader.replace("Bearer ", "")
    if (!userToken) return err("Token não fornecido.", 401)
    // Valida o JWT do Supabase Auth para pegar o email do usuário
    const { data: { user }, error: authErr } = await admin.auth.getUser(userToken)
    if (authErr || !user) return err("Sessão inválida.", 401)
    const userEmail = (user.email || "").toLowerCase().trim()
    // Busca email do superusuário no banco (config da escola atual)
    const escolaIdAdmin = await resolveEscolaId(req, admin)
    const { data: cfgRow } = await admin.from("escola_config").select("valor").eq("chave", "superusuario_email").eq("escola_id", escolaIdAdmin).maybeSingle()
    const superEmail = cfgRow?.valor?.toLowerCase().trim() || ''
    if (!superEmail || userEmail !== superEmail) return err("Acesso negado. Apenas o superusuário pode acessar esta página.", 403)
    return ok({ ok: true, email: userEmail })
  }

  // ── Salvar config (superusuário autenticado via Supabase Auth) ──
  if (action === "config_escola_admin") {
    const authHeader = req.headers.get("authorization") ?? ""
    const userToken = authHeader.replace("Bearer ", "")
    const { data: { user }, error: authErr } = await admin.auth.getUser(userToken)
    if (authErr || !user) return err("Sessão inválida.", 401)
    const userEmail = (user.email || "").toLowerCase().trim()
    const escolaIdAdmin = await resolveEscolaId(req, admin)
    if (!escolaIdAdmin) return err("Escola não resolvida.", 400)
    const { data: cfgRow } = await admin.from("escola_config").select("valor").eq("chave", "superusuario_email").eq("escola_id", escolaIdAdmin).maybeSingle()
    const superEmail = cfgRow?.valor?.toLowerCase().trim() || ''
    if (!superEmail || userEmail !== superEmail) return err("Acesso negado.", 403)
    const { configs } = body as { configs: { chave: string; valor: unknown; descricao?: string; categoria?: string }[] }
    if (!configs?.length) return err("Nenhuma config fornecida.")
    for (const c of configs) {
      await admin.from("escola_config").upsert({
        chave: c.chave,
        valor: typeof c.valor === 'string' ? JSON.stringify(c.valor) : c.valor,
        descricao: c.descricao || null,
        categoria: c.categoria || 'geral',
        escola_id: escolaIdAdmin,
      }, { onConflict: 'chave,escola_id' })
    }
    return ok({ ok: true, saved: configs.length })
  }

  // ── Hub: identifica usuário por qualquer token ativo (4 probes em paralelo) ──
  if (action === "hub_whoami") {
    const hubToken = (body._token as string) || (body._prof_token as string) || req.headers.get("authorization")?.replace("Bearer ", "") || null;
    if (!hubToken) return ok({ logged: false });
    const [gs, ss, ps, us] = await Promise.all([
      admin.from("gerente_sessoes").select("gerente_id, expira_em, gerentes(email)").eq("token", hubToken).maybeSingle(),
      admin.from("secretaria_sessoes").select("secretaria_id, expira_em, secretarias(email)").eq("token", hubToken).maybeSingle(),
      admin.from("professora_sessoes").select("professora_id, expira_em, professoras(email)").eq("token", hubToken).maybeSingle(),
      admin.from("sessoes").select("usuario_id, expira_em").eq("token", hubToken).maybeSingle(),
    ]);
    const now = new Date();
    const resolveByEmail = async (email: string, fallbackRole: string) => {
      const { data: u } = await admin.from("usuarios").select("nome, email, papeis, papel").eq("email", email).maybeSingle();
      if (u) return ok({ logged: true, nome: u.nome, email: u.email, papeis: u.papeis?.length ? u.papeis : [u.papel] });
      return ok({ logged: true, email, papeis: [fallbackRole] });
    };
    if (gs.data && new Date(gs.data.expira_em) >= now && (gs.data as any).gerentes?.email) return resolveByEmail((gs.data as any).gerentes.email, "gerente");
    if (ss.data && new Date(ss.data.expira_em) >= now && (ss.data as any).secretarias?.email) return resolveByEmail((ss.data as any).secretarias.email, "secretaria");
    if (ps.data && new Date(ps.data.expira_em) >= now && (ps.data as any).professoras?.email) return resolveByEmail((ps.data as any).professoras.email, "professora");
    if (us.data && new Date(us.data.expira_em) >= now) {
      const { data: u } = await admin.from("usuarios").select("nome, email, papeis, papel").eq("id", us.data.usuario_id).maybeSingle();
      if (u) return ok({ logged: true, nome: u.nome, email: u.email, papeis: u.papeis?.length ? u.papeis : [u.papel] });
    }
    return ok({ logged: false });
  }

  // ── Magic Link customizado (com branding da escola) ──
  if (action === "send_magic_link") {
    const email = ((body.email as string) || "").toLowerCase().trim();
    const redirectTo = (body.redirect_to as string) || "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("E-mail inválido.");

    // Rate limit
    const rlMagic = checkRateLimit(ip, "login");
    if (!rlMagic.allowed) return err(`Tente novamente em ${rlMagic.retryAfterSeconds}s.`, 429);

    // Busca config da escola atual
    const escolaIdCfg = await resolveEscolaId(req, admin);
    const { data: cfgRows } = await admin.from("escola_config").select("chave, valor").eq("escola_id", escolaIdCfg);
    const cfg: Record<string, string> = {};
    for (const r of cfgRows ?? []) cfg[r.chave] = typeof r.valor === "string" ? r.valor.replace(/^"|"$/g, "") : (r.valor ?? "");
    const escolaNome = cfg.escola_nome || "Escola";
    const logoUrl = cfg.escola_logo_url || "";
    const cor = cfg.cor_primaria || "#C8102E";

    // Gera magic link via Supabase Auth Admin
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (linkErr) return err("Erro ao gerar link: " + linkErr.message);
    const magicUrl = linkData?.properties?.action_link || "";
    if (!magicUrl) return err("Erro interno: link não gerado.");

    // Envia email via Resend com branding da escola
    const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_KEY) return err("Serviço de e-mail não configurado.");

    const escolaNomeSafe = escapeHtml(escolaNome);
    const escolaNomeHeader = sanitizeHeaderValue(escolaNome) || 'Lumied';
    const corSafe = escapeHtml(cor);
    const iconeSafe = escapeHtml(cfg.escola_icone || "🎓");
    const logoHtml = logoUrl
      ? `<img src="${escapeHtml(logoUrl)}" alt="${escolaNomeSafe}" style="max-height:60px;max-width:200px;object-fit:contain;margin-bottom:16px;">`
      : `<div style="font-size:32px;margin-bottom:16px;">${iconeSafe}</div>`;

    const html = `
      <div style="font-family:'Segoe UI',Tahoma,sans-serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#fff;">
        <div style="text-align:center;margin-bottom:24px;">
          ${logoHtml}
          <h2 style="color:${corSafe};margin:0;font-size:20px;">${escolaNomeSafe}</h2>
          <p style="color:#888;font-size:12px;margin:4px 0 0;">by <strong>Lumied</strong></p>
        </div>
        <div style="background:#f8f5f0;border-radius:12px;padding:24px;text-align:center;">
          <p style="font-size:15px;color:#333;margin:0 0 16px;">Clique no botão abaixo para acessar o portal:</p>
          <a href="${escapeHtml(magicUrl)}" style="display:inline-block;padding:14px 32px;background:${corSafe};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">Acessar Portal</a>
        </div>
        <p style="font-size:12px;color:#999;text-align:center;margin-top:20px;line-height:1.5;">
          Se você não solicitou este acesso, ignore este e-mail.<br>
          Este link expira em 1 hora.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
        <p style="font-size:11px;color:#bbb;text-align:center;">
          Sistema ${escolaNomeSafe} by Lumied
        </p>
      </div>`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: `${escolaNomeHeader} <onboarding@resend.dev>`,
        to: [email],
        subject: `Seu acesso ao ${escolaNomeHeader}`,
        html,
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[magic-link] Resend error:", resp.status, errBody);
      return err("Erro ao enviar e-mail. Tente novamente.");
    }
    return ok({ sent: true });
  }

  // ── Bootstrap do hub (área-restrita): config + módulos + whoami em 1 request ──
  if (action === "hub_bootstrap") {
    const tokens: string[] = Array.isArray(body._tokens) ? (body._tokens as string[]).filter(Boolean) : [];
    const escolaIdHub = await resolveEscolaId(req, admin);
    const [cfgRes, escolaIdRes, ...sessionProbes] = await Promise.all([
      admin.from("escola_config").select("chave, valor, categoria").eq("escola_id", escolaIdHub),
      Promise.resolve(escolaIdHub),
      ...tokens.map(t => Promise.all([
        admin.from("gerente_sessoes").select("gerente_id, expira_em, gerentes(email)").eq("token", t).maybeSingle(),
        admin.from("secretaria_sessoes").select("secretaria_id, expira_em, secretarias(email)").eq("token", t).maybeSingle(),
        admin.from("professora_sessoes").select("professora_id, expira_em, professoras(email)").eq("token", t).maybeSingle(),
        admin.from("sessoes").select("usuario_id, expira_em").eq("token", t).maybeSingle(),
      ])),
    ]);

    const cfg: Record<string, unknown> = {};
    for (const r of (cfgRes as any).data ?? []) cfg[r.chave] = r.valor;

    let modulos: string[] = [];
    let tema = 'corporativo';
    const escolaId = escolaIdRes as string | null;
    if (escolaId) {
      const [mods, escRes] = await Promise.all([
        getModulosHabilitados(admin, escolaId).catch(() => new Set<string>()),
        admin.from("escolas").select("tema").eq("id", escolaId).single(),
      ]);
      modulos = [...mods];
      tema = (escRes.data as any)?.tema || 'corporativo';
    }

    let whoami: any = { logged: false };
    const emailsToResolve: string[] = [];
    const uidsToResolve: string[] = [];
    for (const [gs, ss, ps, us] of sessionProbes as any[]) {
      const now = new Date();
      if (gs?.data && new Date(gs.data.expira_em) >= now && gs.data.gerentes?.email) { emailsToResolve.push(gs.data.gerentes.email); break; }
      if (ss?.data && new Date(ss.data.expira_em) >= now && ss.data.secretarias?.email) { emailsToResolve.push(ss.data.secretarias.email); break; }
      if (ps?.data && new Date(ps.data.expira_em) >= now && ps.data.professoras?.email) { emailsToResolve.push(ps.data.professoras.email); break; }
      if (us?.data && new Date(us.data.expira_em) >= now) { uidsToResolve.push(us.data.usuario_id); break; }
    }
    if (emailsToResolve.length) {
      const { data: u } = await admin.from("usuarios").select("nome, email, papeis, papel").eq("email", emailsToResolve[0]).maybeSingle();
      if (u) whoami = { logged: true, nome: u.nome, email: u.email, papeis: u.papeis?.length ? u.papeis : [u.papel] };
      else whoami = { logged: true, email: emailsToResolve[0] };
    } else if (uidsToResolve.length) {
      const { data: u } = await admin.from("usuarios").select("nome, email, papeis, papel").eq("id", uidsToResolve[0]).maybeSingle();
      if (u) whoami = { logged: true, nome: u.nome, email: u.email, papeis: u.papeis?.length ? u.papeis : [u.papel] };
    }

    const hasToken = tokens.length > 0;
    return ok({ config: cfg, modulos, tema, whoami }, hasToken ? {} : PUBLIC_CACHE);
  }

  // ── Config pública da escola (carregada por todos os portais) ──
  // ── Consumo IA da própria escola (gerente) ──
  if (action === "ia_uso_self") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const escolaId = await getEscolaPadrao(admin);
    if (!escolaId) return ok({ custo_usd: 0, cap_usd: null, bloqueado: false, requests: 0 });
    const mes = new Date().toISOString().slice(0, 7) + '-01';
    const { data } = await admin.from("escola_ia_uso")
      .select("custo_usd, cap_usd, bloqueado, requests, tokens_input, tokens_output")
      .eq("escola_id", escolaId).eq("mes", mes).maybeSingle();
    return ok(data ?? { custo_usd: 0, cap_usd: null, bloqueado: false, requests: 0, tokens_input: 0, tokens_output: 0 });
  }

  // ── Onboarding + Billing SaaS ──
  if (action === "onboarding_status") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const escolaId = await getEscolaPadrao(admin);
    if (!escolaId) return ok({ checklist: {}, saas: { estado: 'ativo' }, etapas: [] });
    const { data: e } = await admin.from("escolas")
      .select("id, nome, onboarding_checklist, onboarding_dismissed_em, saas_proximo_vencimento, saas_ultimo_pagamento, saas_valor_mensal, saas_forma_pagamento, saas_grace_ate, saas_status")
      .eq("id", escolaId).maybeSingle();
    if (!e) return ok({ checklist: {}, saas: { estado: 'ativo' }, etapas: [] });

    // Compute SaaS state
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const toDate = (d: string | null) => d ? new Date(d + 'T00:00:00') : null;
    const venc = toDate(e.saas_proximo_vencimento);
    const grace = toDate(e.saas_grace_ate);
    const dias = venc ? Math.ceil((venc.getTime() - hoje.getTime()) / 86400000) : null;
    let estado = e.saas_status || 'ativo';
    if (!['cancelado', 'bloqueado'].includes(estado) && venc) {
      if (dias! > 7) estado = 'ativo';
      else if (dias! >= 0) estado = 'aviso';
      else if (grace && hoje <= grace) estado = 'grace';
      else if (dias! >= -7) estado = 'atraso';
      else if (dias! >= -15) estado = 'suspenso';
      else estado = 'bloqueado';
    }

    // Compute etapas automáticas (derivadas de dados reais)
    const [{ count: alunosN }, { count: profsN }, { count: mensN }, { count: comunicN }] = await Promise.all([
      admin.from("alunos").select("*", { count: 'exact', head: true }),
      admin.from("professoras").select("*", { count: 'exact', head: true }),
      admin.from("fin_mensalidades").select("*", { count: 'exact', head: true }),
      admin.from("comunicados").select("*", { count: 'exact', head: true }).catch(() => ({ count: 0 })),
    ]);
    const manual = (e.onboarding_checklist || {}) as Record<string, any>;
    const etapas = [
      { id: 'cadastrar_alunos',      titulo: 'Cadastrar alunos',           descricao: 'Importe sua planilha ou cadastre manualmente.',         concluido: (alunosN ?? 0) > 0 || !!manual.cadastrar_alunos,      link: '/gerente.html#alunos' },
      { id: 'cadastrar_professoras', titulo: 'Cadastrar professoras',      descricao: 'Convide sua equipe docente.',                             concluido: (profsN ?? 0) > 0 || !!manual.cadastrar_professoras, link: '/gerente.html#professoras' },
      { id: 'configurar_financeiro', titulo: 'Configurar financeiro',      descricao: 'Defina valores de mensalidade e integre o Banco Inter.', concluido: (mensN ?? 0) > 0 || !!manual.configurar_financeiro,  link: '/gerente.html#financeiro' },
      { id: 'configurar_comunicacao',titulo: 'Configurar WhatsApp/Email',  descricao: 'Habilite comunicação oficial com as famílias.',           concluido: !!manual.configurar_comunicacao,                     link: '/gerente.html#comunicacao' },
      { id: 'primeiro_comunicado',   titulo: 'Enviar primeiro comunicado', descricao: 'Teste o envio para sua equipe.',                          concluido: (comunicN ?? 0) > 0 || !!manual.primeiro_comunicado, link: '/gerente.html#comunicacao' },
      { id: 'aceitar_termos_dpa',    titulo: 'Aceitar Termos + DPA (LGPD)',descricao: 'Formalize o acordo de tratamento de dados.',              concluido: !!manual.aceitar_termos_dpa,                         link: '/dpa/' },
      { id: 'convidar_familias',     titulo: 'Convidar famílias',          descricao: 'Envie o link de acesso ao portal dos pais.',              concluido: !!manual.convidar_familias,                          link: '/gerente.html#alunos' },
    ];
    const total = etapas.length;
    const feitas = etapas.filter(x => x.concluido).length;

    return ok({
      escola_id: e.id,
      escola_nome: e.nome,
      dismissed: !!e.onboarding_dismissed_em,
      checklist: { etapas, total, feitas, completo: feitas === total },
      saas: {
        estado,
        dias_para_vencimento: dias,
        proximo_vencimento: e.saas_proximo_vencimento,
        valor_mensal: e.saas_valor_mensal,
        forma_pagamento: e.saas_forma_pagamento,
      },
    });
  }

  if (action === "onboarding_marcar") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { etapa, concluido } = body as any;
    if (!etapa) return err("etapa obrigatória.");
    const escolaId = await getEscolaPadrao(admin);
    if (!escolaId) return err("Escola não encontrada.");
    const { data: e } = await admin.from("escolas").select("onboarding_checklist").eq("id", escolaId).maybeSingle();
    const cur = (e?.onboarding_checklist || {}) as Record<string, any>;
    if (concluido === false) {
      delete cur[etapa];
    } else {
      cur[etapa] = { concluido_em: new Date().toISOString(), por: (gerente as any)?.nome || null };
    }
    await admin.from("escolas").update({ onboarding_checklist: cur }).eq("id", escolaId);
    return ok({ success: true });
  }

  if (action === "onboarding_dismiss") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const escolaId = await getEscolaPadrao(admin);
    if (!escolaId) return err("Escola não encontrada.");
    await admin.from("escolas").update({ onboarding_dismissed_em: new Date().toISOString() }).eq("id", escolaId);
    return ok({ success: true });
  }

  if (action === "config_publica") {
    const escolaIdPub = await resolveEscolaId(req, admin)
    const { data: rows } = await admin.from("escola_config").select("chave, valor, categoria").eq("escola_id", escolaIdPub)
    const cfg: Record<string, unknown> = {}
    for (const r of rows ?? []) {
      cfg[r.chave] = r.valor
    }
    return ok(cfg, PUBLIC_CACHE)
  }

  // ── Salvar config (gerente autenticado) ──
  if (action === "config_escola_save") {
    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "")
    const gerente = await validarSessao(admin, token)
    if (!gerente) return err("Sessão inválida.", 401)
    const escolaIdSave = (gerente as any)?.escola_id || await resolveEscolaId(req, admin, gerente as any)
    if (!escolaIdSave) return err("Escola não resolvida.", 400)
    const { configs } = body as { configs: { chave: string; valor: unknown; descricao?: string; categoria?: string }[] }
    if (!configs?.length) return err("Nenhuma config fornecida.")

    // Chaves sensíveis que gerentes NÃO podem setar — só lumied_staff via admin-central.
    // superusuario_email era uma via de escalação (gerente podia se promover a superuser).
    // API keys, webhook secrets e tokens de serviço devem vir só via ambiente/staff.
    const CHAVES_PROTEGIDAS = new Set([
      "superusuario_email",
      "meta_app_secret",
      "whatsapp_token",
      "whatsapp_verify_token",
      "inter_client_id",
      "inter_client_secret",
      "anthropic_api_key",
      "resend_api_key",
      "google_service_account",
      "sentry_auth_token",
      "supabase_service_key",
      "app_internal_secret",
      "relay_secret",
    ]);
    const bloqueadas = configs.filter(c => CHAVES_PROTEGIDAS.has(String(c.chave).toLowerCase())).map(c => c.chave);
    if (bloqueadas.length) {
      return err(`Chaves protegidas só podem ser alteradas por staff Lumied: ${bloqueadas.join(", ")}`, 403);
    }

    for (const c of configs) {
      await admin.from("escola_config").upsert({
        chave: c.chave,
        valor: typeof c.valor === 'string' ? JSON.stringify(c.valor) : c.valor,
        descricao: c.descricao || null,
        categoria: c.categoria || 'geral',
        escola_id: escolaIdSave,
      }, { onConflict: 'chave,escola_id' })
    }
    return ok({ ok: true, saved: configs.length })
  }

  // ── config_escola_setup REMOVIDA (2026-04-10) ──
  // Esta action permitia setar configs arbitrárias (incluindo superusuario_email)
  // sem autenticação quando a tabela gerentes estava vazia — permitia escalação
  // de privilégio. Setup de escolas agora é exclusivo via admin/staff_criar_escola.
  if (action === "config_escola_setup") {
    return err("Action descontinuada. Use staff_criar_escola (admin-central.html).", 410)
  }

  // Verifica se é o primeiro acesso (nenhum gerente cadastrado)
  if (action === "setup_check") {
    const { count } = await admin.from("gerentes").select("*", { count: "exact", head: true });
    return ok({ needs_setup: (count ?? 0) === 0 });
  }

  // Cria o primeiro gerente (só funciona se não houver nenhum)
  if (action === "setup") {
    const { count } = await admin.from("gerentes").select("*", { count: "exact", head: true });
    if ((count ?? 0) > 0) return err("Já existe um gerente cadastrado.", 403);
    const { nome, email, senha } = body as { nome: string; email: string; senha: string };
    if (!nome || !email || !senha) return err("Nome, e-mail e senha são obrigatórios.");
    if ((senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const senha_hash = await hashSenha(senha as string);
    const { data: g, error } = await admin.from("gerentes").insert({ nome, email, senha_hash }).select().single();
    if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "E-mail já cadastrado." : sanitizePgError(error)); }
    const { data: sessao, error: sErr } = await admin.from("gerente_sessoes").insert({ gerente_id: g.id }).select().single();
    if (sErr || !sessao?.token) {
      console.error("[auth] setup AUTH_SESSION_FAILED", { email: g.email, err: sErr });
      return err("Não foi possível criar a sessão.", 500, "AUTH_SESSION_FAILED");
    }
    return ok({ token: sessao.token, nome: g.nome, email: g.email });
  }

  // Login
  if (action === "login") {
    const { email, senha } = body as { email: string; senha: string };
    if (!email || !senha) return err("E-mail e senha são obrigatórios.", 400, "VALIDATION_FAILED");
    const { data: g } = await admin.from("gerentes").select("id, nome, email, senha_hash").eq("email", email).single();
    if (!g) return err("E-mail ou senha incorretos.", 401, "AUTH_BAD_CREDENTIALS");
    const ok2 = await verificarSenhaAuto(senha as string, g.senha_hash);
    if (!ok2) return err("E-mail ou senha incorretos.", 401, "AUTH_BAD_CREDENTIALS");
    await admin.from("gerente_sessoes").delete().lt("expira_em", new Date().toISOString());
    const { data: sessao, error: sErr } = await admin.from("gerente_sessoes").insert({ gerente_id: g.id }).select().single();
    if (sErr || !sessao?.token) {
      console.error("[auth] gerente login AUTH_SESSION_FAILED", { email, err: sErr });
      return err("Não foi possível criar a sessão. Tente novamente.", 500, "AUTH_SESSION_FAILED");
    }
    return ok({ token: sessao.token, nome: g.nome, email: g.email });
  }

  // Logout
  if (action === "logout") {
    const logoutToken = (body._token as string) || req.headers.get("authorization")?.replace("Bearer ", "");
    if (logoutToken) await admin.from("gerente_sessoes").delete().eq("token", logoutToken);
    return ok({ success: true });
  }

  // WebAuthn login (público)
  if (action === "webauthn_login_challenge") {
    const { email, rp_id } = body as { email: string; rp_id: string };
    if (!email || !rp_id) return err("email e rp_id obrigatórios.", 400);
    const { data: g } = await admin.from("gerentes").select("id").eq("email", email).maybeSingle();
    if (!g) return err("Usuário não encontrado.", 404);
    const { data: creds } = await admin.from("webauthn_credentials").select("credential_id, transports").eq("usuario_tipo", "gerente").eq("usuario_id", g.id);
    if (!creds?.length) return err("Nenhuma biometria cadastrada.", 404);
    const challenge = generateChallenge();
    await admin.from("webauthn_challenges").insert({ challenge, usuario_tipo: "gerente", usuario_id: g.id, email, tipo: "login", rp_id });
    return ok({ challenge, rp_id, allowCredentials: creds.map(c => ({ id: c.credential_id, transports: c.transports })) });
  }
  if (action === "webauthn_login_verify") {
    const { credential, rp_id } = body as { credential: any; rp_id: string };
    if (!credential || !rp_id) return err("Dados incompletos.", 400);
    const { data: cred } = await admin.from("webauthn_credentials").select("*").eq("credential_id", credential.id).maybeSingle();
    if (!cred || cred.usuario_tipo !== "gerente") return err("Credencial não encontrada.", 404);
    const { data: ch } = await admin.from("webauthn_challenges").select("*").eq("tipo", "login").eq("usuario_id", cred.usuario_id).gt("expira_em", new Date().toISOString()).order("criado_em", { ascending: false }).limit(1).maybeSingle();
    if (!ch) return err("Challenge expirado.", 400);
    await admin.from("webauthn_challenges").delete().eq("id", ch.id);
    try {
      const result = await verifyAuthentication(credential.response.clientDataJSON, credential.response.authenticatorData, credential.response.signature, ch.challenge, rp_id, cred.public_key, cred.sign_count);
      await admin.from("webauthn_credentials").update({ sign_count: result.newSignCount }).eq("id", cred.id);
      const { data: g } = await admin.from("gerentes").select("nome, email").eq("id", cred.usuario_id).maybeSingle();
      if (!g) return err("Gerente não encontrado.", 404);
      const { data: sess, error: sErr } = await admin.from("gerente_sessoes").insert({ gerente_id: cred.usuario_id }).select("token").single();
      if (sErr || !sess?.token) {
        console.error("[auth] webauthn gerente AUTH_SESSION_FAILED", { user: cred.usuario_id, err: sErr });
        return err("Não foi possível criar a sessão.", 500, "AUTH_SESSION_FAILED");
      }
      return ok({ token: sess.token, nome: g.nome, email: g.email });
    } catch (e) { return err("Verificação falhou: " + (e as Error).message, 400); }
  }

  // Leitura pública de séries (para o formulário)
  if (action === "series_list") {
    const { data } = await admin.from("series").select("*").eq("ativo", true).order("ordem");
    return ok(data ?? []);
  }

  // Leitura pública de atividades (para o formulário) — com contagem de inscritos por turma
  if (action === "atividades_list") {
    const { data: atividades } = await admin.from("atividades").select("*").eq("ativo", true).order("ordem");
    if (!atividades?.length) return ok([]);

    // Busca turmas_selecionadas dos alunos para contar por atividade+turma
    const { data: alunosAtiv } = await admin.from("alunos").select("turmas_selecionadas").not("turmas_selecionadas", "is", null);

    // Monta mapa: "atividade_id|turma_nome" → contagem
    const ocupacao: Record<string, number> = {};
    for (const al of alunosAtiv ?? []) {
      for (const ts of (al.turmas_selecionadas ?? [])) {
        const key = `${ts.atividade_id}|${ts.turma}`;
        ocupacao[key] = (ocupacao[key] || 0) + 1;
      }
    }

    // Injeta inscritos e vagas_disponiveis em cada turma
    const resultado = atividades.map(a => ({
      ...a,
      horarios: (a.horarios ?? []).map((t: Record<string, unknown>) => {
        const inscritos = ocupacao[`${a.id}|${t.turma}`] || 0;
        const vagas = Number(t.vagas ?? 999);
        return { ...t, inscritos, vagas_disponiveis: Math.max(0, vagas - inscritos) };
      })
    }));

    return ok(resultado);
  }

  // Agenda do responsável (turno + atividades + ausências)
  if (action === "minha_agenda") {
    const { email } = body as { email: string };
    if (!email) return err("E-mail obrigatório.");
    // Validate email to prevent PostgREST .or() injection.
    const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
    if (!EMAIL_RE.test(email)) return err("E-mail inválido.");
    // Run two separate queries (email match + familia_email match) and merge in code
    // to avoid PostgREST .or() string interpolation.
    const alunoCols = "id, nome, email, serie, turma, responsavel_nome, resp_nome, atividades_ids, turmas_selecionadas, almoco_dias, criado_em";
    const [solicitacoes, alunosA, alunosB, ausencias] = await Promise.all([
      admin.from("solicitacoes").select("*").eq("email", email).order("criado_em", { ascending: false }),
      admin.from("alunos").select(alunoCols).eq("email", email).not("atividades_ids", "is", null),
      admin.from("alunos").select(alunoCols).eq("familia_email", email).not("atividades_ids", "is", null),
      admin.from("ausencias").select("*").eq("email_resp", email).gte("data_ausencia", new Date().toISOString().split("T")[0]),
    ]);
    const alunosMerged: any[] = [...(alunosA.data ?? []), ...(alunosB.data ?? [])];
    const seenAlunoIds = new Set<string>();
    const alunosAtiv = { data: alunosMerged.filter(a => { if (seenAlunoIds.has(a.id)) return false; seenAlunoIds.add(a.id); return true; }) };
    // Map alunos to inscricoes format for backwards compat
    const inscricoes = (alunosAtiv.data ?? []).map(a => ({
      id: a.id, email: a.email, nome_crianca: a.nome,
      nome_resp: a.responsavel_nome || a.resp_nome || '',
      serie: a.serie || a.turma || '',
      atividades_ids: a.atividades_ids, turmas_selecionadas: a.turmas_selecionadas,
      almoco_dias: a.almoco_dias, criado_em: a.criado_em,
    }));
    return ok({
      solicitacoes: solicitacoes.data ?? [],
      inscricoes,
      ausencias: ausencias.data ?? [],
    });
  }

  // Registrar ausência (check-out)
  if (action === "ausencia_submit") {
    const { email_resp, nome_crianca, data_ausencia, tipo, observacao } = body as Record<string, unknown>;
    if (!email_resp || !nome_crianca || !data_ausencia) return err("Campos obrigatórios ausentes.");
    // Verifica se já existe ausência para esse dia e criança
    const { data: exist } = await admin.from("ausencias")
      .select("id").eq("email_resp", email_resp).eq("nome_crianca", nome_crianca as string).eq("data_ausencia", data_ausencia as string).single();
    if (exist) return ok({ success: true, already: true });
    const { error } = await admin.from("ausencias").insert({ email_resp, nome_crianca, data_ausencia, tipo: tipo ?? "turno", observacao: observacao ?? null });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // Remover ausência (criança vai comparecer afinal)
  if (action === "ausencia_delete") {
    const { id, email_resp } = body as { id: string; email_resp: string };
    if (!id || !email_resp) return err("ID e email_resp obrigatórios.");
    const { data: ausencia } = await admin.from("ausencias").select("id").eq("id", id).eq("email_resp", email_resp).maybeSingle();
    if (!ausencia) return err("Ausência não encontrada ou não pertence a este responsável.", 404);
    await admin.from("ausencias").delete().eq("id", id).eq("email_resp", email_resp);
    return ok({ success: true });
  }

  // Leitura pública de configurações (logo)
  if (action === "config_get") {
    const { chave } = body as { chave: string };
    const { data } = await admin.from("configuracoes").select("valor").eq("chave", chave).single();
    return ok({ valor: data?.valor ?? null });
  }

  // Envio público do formulário de turno
  if (action === "public_submit") {
    const { email, nome_resp, nome_crianca, serie, turno, dias_semana } = body as Record<string, unknown>;
    if (!email || !nome_resp || !nome_crianca || !turno) return err("Campos obrigatórios ausentes.");
    const { error } = await admin.from("solicitacoes").insert({ email, nome_resp, nome_crianca, serie, turno, dias_semana: dias_semana ?? null });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // Inscrição pública em atividades — grava na tabela alunos
  if (action === "inscricao_atividade_submit") {
    const { email, nome_resp, nome_crianca, serie, atividades_ids, atividades_detalhe, turmas_selecionadas } = body as Record<string, unknown>;
    if (!email || !nome_resp || !nome_crianca || !atividades_ids) return err("Campos obrigatórios ausentes.");
    // Busca aluno pelo nome (ilike)
    const { data: found } = await admin.from("alunos").select("id").ilike("nome", nome_crianca as string).limit(1).single();
    if (found) {
      const { error } = await admin.from("alunos").update({
        atividades_ids: atividades_ids as string[],
        turmas_selecionadas: turmas_selecionadas ?? [],
      }).eq("id", found.id);
      if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    } else {
      // Aluno não cadastrado — cria na tabela alunos
      const { error } = await admin.from("alunos").insert({
        nome: nome_crianca, email: email || null, serie: serie || null,
        responsavel_nome: nome_resp,
        atividades_ids: atividades_ids as string[],
        turmas_selecionadas: turmas_selecionadas ?? [],
        ativo: true,
      });
      if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    }
    return ok({ success: true });
  }

  // ── Manutenção — envio público (qualquer portal) ─────────────
  if (action === "manutencao_submit") {
    const { descricao, localizacao, urgencia, usuario_id, _email, base64, mime } = body as Record<string, unknown>;
    if (!descricao || !localizacao || !urgencia) return err("Descrição, localização e urgência são obrigatórios.");
    const urgencias = ["baixa", "media", "alta", "critica"];
    if (!urgencias.includes(urgencia as string)) return err("Urgência inválida. Use: baixa, media, alta, critica.");
    let foto_url: string | null = null;
    if (base64 && mime) {
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(mime as string)) return err("Tipo de imagem não permitido.");
      const bytes = Uint8Array.from(atob(base64 as string), c => c.charCodeAt(0));
      if (bytes.length > 10 * 1024 * 1024) return err("Imagem muito grande (máx. 10MB).");
      const ext = (mime as string).split("/")[1];
      const path = `fotos/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      await admin.storage.createBucket("manutencoes", { public: true }).catch(() => {});
      const { error: upErr } = await admin.storage.from("manutencoes").upload(path, bytes, { contentType: mime as string, upsert: false });
      if (upErr) return err("Erro ao enviar foto: " + upErr.message);
      const { data: { publicUrl } } = admin.storage.from("manutencoes").getPublicUrl(path);
      foto_url = publicUrl;
    }
    const insert: Record<string, unknown> = { descricao, localizacao, urgencia, foto_url };
    if (usuario_id) insert.usuario_id = usuario_id;
    else if (_email) {
      const { data: u } = await admin.from("usuarios").select("id").eq("email", _email as string).maybeSingle();
      if (u) insert.usuario_id = u.id;
    }
    const { error } = await admin.from("manutencoes").insert(insert);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // ── Manutenção — meus chamados (professora/equipe) ──
  if (action === "manutencao_minhas") {
    const email = ((body._email as string) || "").toLowerCase().trim();
    if (!email) return err("E-mail obrigatório.");
    const { data: user } = await admin.from("usuarios").select("id").eq("email", email).maybeSingle();
    if (!user) return ok([]);
    const { data } = await admin.from("manutencoes").select("*, usuarios(nome, email)")
      .eq("usuario_id", user.id).order("criado_em", { ascending: false });
    return ok(data ?? []);
  }

  // ── Contratos PÚBLICOS (família acessa sem login) ──
  if (action === "contrato_publico_get") {
    const { contrato_id } = body as any;
    if (!contrato_id) return err("contrato_id obrigatório.");
    const { data } = await admin.from("contratos").select("id, familia_nome, familia_email, html_renderizado, status, codigo_verificacao, assinado_em, contrato_templates(nome, tipo), contrato_assinaturas(nome_signatario, assinado_em, ip)").eq("id", contrato_id).single();
    if (!data) return err("Contrato não encontrado.", 404);
    if (data.status === 'rascunho') return err("Contrato ainda não foi enviado.");
    if (data.status === 'enviado') {
      await admin.from("contratos").update({ status: 'visualizado', visualizado_em: new Date().toISOString() }).eq("id", contrato_id);
    }
    return ok(data);
  }

  // Upload PDF do contrato assinado (chamado pelo browser após assinatura completa)
  if (action === "contrato_salvar_pdf") {
    const { contrato_id, pdf_base64 } = body as any;
    if (!contrato_id || !pdf_base64) return err("contrato_id e pdf_base64 obrigatórios.");
    const { data: c } = await admin.from("contratos").select("id, status").eq("id", contrato_id).maybeSingle();
    if (!c) return err("Contrato não encontrado.", 404);
    if (c.status !== "assinado") return err("Só é possível salvar PDF de contrato assinado.");
    try {
      // Decode base64 (strip possible data URL prefix)
      const clean = String(pdf_base64).replace(/^data:application\/pdf;base64,/, "");
      const bin = atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const path = `${contrato_id}.pdf`;
      const { error: upErr } = await admin.storage
        .from("contratos-pdf")
        .upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (upErr) return err("Falha no upload: " + upErr.message);
      await admin.from("contratos").update({
        pdf_path: path,
        pdf_gerado_em: new Date().toISOString(),
      }).eq("id", contrato_id);
      return ok({ success: true, pdf_path: path });
    } catch (e) {
      return err("Erro ao processar PDF: " + (e as Error).message);
    }
  }

  // Verificar autenticidade de contrato por código
  if (action === "contrato_verificar") {
    const { codigo } = body as any;
    if (!codigo) return err("Código de verificação obrigatório.");
    const { data } = await admin.from("contratos").select("id, familia_nome, status, assinado_em, codigo_verificacao, documento_hash, contrato_templates(nome), contrato_assinaturas(nome_signatario, assinado_em, ip, documento_hash)").eq("codigo_verificacao", codigo.toUpperCase()).single();
    if (!data) return err("Código não encontrado. Verifique e tente novamente.", 404);
    return ok({ valido: data.status === 'assinado', contrato: data });
  }

  // Enviar código de verificação por email antes de assinar
  if (action === "contrato_enviar_codigo") {
    const { contrato_id } = body as any;
    if (!contrato_id) return err("contrato_id obrigatório.");
    const { data: contrato } = await admin.from("contratos").select("familia_email, familia_nome, status").eq("id", contrato_id).single();
    if (!contrato) return err("Contrato não encontrado.", 404);
    if (contrato.status === 'assinado') return err("Contrato já foi assinado.");

    // Gerar código de 6 dígitos
    const codigo = Array.from(crypto.getRandomValues(new Uint8Array(3))).map(b => (b % 10).toString()).join('') +
                   Array.from(crypto.getRandomValues(new Uint8Array(3))).map(b => (b % 10).toString()).join('');

    // Recuperar dados_preenchidos atual para não sobrescrever campos do contrato
    const { data: contratoDados } = await admin.from("contratos").select("dados_preenchidos").eq("id", contrato_id).single();
    const dadosAtual = (contratoDados?.dados_preenchidos && typeof contratoDados.dados_preenchidos === 'object') ? contratoDados.dados_preenchidos : {};
    // Remove plaintext legado caso exista e grava apenas o hash + expira + tentativas
    const { _codigo_email: _oldPlain, _codigo_expira: _oldExp, _codigo_email_hash: _oldHash, _codigo_email_expira: _oldExp2, _codigo_email_tentativas: _oldTent, ...dadosLimpo } = dadosAtual as Record<string, unknown>;

    const codigoHash = await sha256Hex(codigo);

    // Salvar hash do código (expira em 15 min) — nunca armazenar o código em plaintext
    await admin.from("contratos").update({
      dados_preenchidos: {
        ...dadosLimpo,
        _codigo_email_hash: codigoHash,
        _codigo_email_expira: new Date(Date.now() + 15 * 60000).toISOString(),
        _codigo_email_tentativas: 0,
      }
    }).eq("id", contrato_id);

    // Enviar por email via Resend
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      try {
        const familiaNomeSafe = escapeHtml(contrato.familia_nome || '');
        const codigoSafe = escapeHtml(codigo);
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Lumied Contratos <onboarding@resend.dev>",
            to: [contrato.familia_email],
            subject: `Código de verificação: ${codigo}`,
            html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
              <h2 style="color:#C8102E;margin-bottom:16px;">Código de Verificação</h2>
              <p style="font-size:15px;margin-bottom:20px;">Olá, ${familiaNomeSafe}! Para assinar o contrato, use o código abaixo:</p>
              <div style="background:#f5f3ee;border:2px solid #C8102E;border-radius:12px;padding:24px;text-align:center;margin-bottom:20px;">
                <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#C8102E;font-family:monospace;">${codigoSafe}</span>
              </div>
              <p style="font-size:13px;color:#7a7169;">Este código expira em <strong>15 minutos</strong>.</p>
              <p style="font-size:12px;color:#999;margin-top:20px;">Se você não solicitou este código, ignore este e-mail.</p>
              <hr style="border:none;border-top:1px solid #e2dbd1;margin:20px 0;">
              <p style="font-size:10px;color:#999;">Lumied Gestão Escolar — Assinatura Eletrônica</p>
            </div>`,
          }),
          signal: AbortSignal.timeout(8000),
        });
      } catch (e) { console.error("[CONTRATO] Email error:", e); }
    }

    // Ofuscar email para o frontend
    const emailParts = contrato.familia_email.split('@');
    const maskedEmail = emailParts[0].substring(0, 2) + '***@' + emailParts[1];

    return ok({ success: true, email_enviado: maskedEmail });
  }

  // Validar código de email antes de assinar
  if (action === "contrato_validar_codigo") {
    const { contrato_id, codigo } = body as any;
    if (!contrato_id || !codigo) return err("contrato_id e codigo obrigatórios.");
    const { data: contrato } = await admin.from("contratos").select("dados_preenchidos").eq("id", contrato_id).single();
    if (!contrato) return err("Contrato não encontrado.", 404);
    const dados = (contrato.dados_preenchidos && typeof contrato.dados_preenchidos === 'object') ? contrato.dados_preenchidos as Record<string, unknown> : {};
    const storedHash = dados._codigo_email_hash as string | undefined;
    const expira = dados._codigo_email_expira as string | undefined;
    const tentativas = typeof dados._codigo_email_tentativas === 'number' ? dados._codigo_email_tentativas : 0;
    if (!storedHash) return err("Nenhum código foi enviado. Solicite um novo.");
    if (tentativas >= 5) return err("Muitas tentativas incorretas. Solicite um novo código.");
    if (!expira || new Date(expira) < new Date()) return err("Código expirado. Solicite um novo.");

    const codigoHash = await sha256Hex(String(codigo).trim());
    if (!timingSafeEqual(codigoHash, storedHash)) {
      // Incrementa contador de tentativas
      await admin.from("contratos").update({
        dados_preenchidos: { ...dados, _codigo_email_tentativas: tentativas + 1 }
      }).eq("id", contrato_id);
      return err("Código incorreto.");
    }
    // Sucesso — limpa hash e contador para impedir reuso
    const { _codigo_email_hash: _h, _codigo_email_expira: _e, _codigo_email_tentativas: _t, ...dadosLimpo } = dados;
    await admin.from("contratos").update({
      dados_preenchidos: { ...dadosLimpo, _codigo_email_verificado: true, _codigo_email_verificado_em: new Date().toISOString() }
    }).eq("id", contrato_id);
    return ok({ success: true, verificado: true });
  }

  if (action === "contrato_assinar") {
    const { contrato_id, nome_signatario, assinatura_base64, aceite_termos, geolocation, codigo_email } = body as any;
    if (!contrato_id || !nome_signatario || !assinatura_base64) return err("contrato_id, nome_signatario e assinatura_base64 obrigatórios.");
    if (!codigo_email) return err("Código de verificação por e-mail obrigatório.");

    const { data: contrato } = await admin.from("contratos").select("status, html_renderizado, dados_preenchidos").eq("id", contrato_id).single();
    if (!contrato) return err("Contrato não encontrado.", 404);
    if (contrato.status === 'assinado') return err("Contrato já foi assinado.");
    if (contrato.status === 'cancelado') return err("Contrato foi cancelado.");

    // Validar código de email
    const dados = (contrato.dados_preenchidos && typeof contrato.dados_preenchidos === 'object') ? contrato.dados_preenchidos as Record<string, unknown> : {};
    // Aceita tanto verificação prévia (via contrato_validar_codigo) quanto o código enviado junto
    if (dados._codigo_email_verificado) {
      // já verificado previamente — segue em frente
    } else {
      const storedHash = dados._codigo_email_hash as string | undefined;
      const expira = dados._codigo_email_expira as string | undefined;
      const tentativas = typeof dados._codigo_email_tentativas === 'number' ? dados._codigo_email_tentativas : 0;
      if (!storedHash) return err("Código de e-mail não enviado. Solicite um novo.");
      if (tentativas >= 5) return err("Muitas tentativas incorretas. Solicite um novo código.");
      if (!expira || new Date(expira) < new Date()) return err("Código expirado. Solicite um novo.");
      const codigoHash = await sha256Hex(String(codigo_email).trim());
      if (!timingSafeEqual(codigoHash, storedHash)) {
        await admin.from("contratos").update({
          dados_preenchidos: { ...dados, _codigo_email_tentativas: tentativas + 1 }
        }).eq("id", contrato_id);
        return err("Código de e-mail incorreto.");
      }
    }

    // Gerar hash SHA-256 do documento para garantir integridade
    const docBytes = new TextEncoder().encode(contrato.html_renderizado || '');
    const hashBuffer = await crypto.subtle.digest('SHA-256', docBytes);
    const docHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    // Gerar código de verificação único (8 caracteres alfanuméricos)
    const codigoBytes = crypto.getRandomValues(new Uint8Array(5));
    const codigoVerificacao = 'LUM-' + Array.from(codigoBytes).map(b => b.toString(36).toUpperCase()).join('').substring(0, 8);

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ua = req.headers.get('user-agent') || '';
    const agora = new Date().toISOString();

    // Determinar tipo do signatário baseado em quantas assinaturas já existem
    // Ordem: contratante (família) → contratado (escola) → testemunha 1 → testemunha 2
    const { data: existingSignatures } = await admin.from("contrato_assinaturas").select("id").eq("contrato_id", contrato_id);
    const sigCount = (existingSignatures || []).length;
    const tipoMap = ['contratante', 'contratado', 'testemunha1', 'testemunha2'];
    const tipoSig = tipoMap[sigCount] || 'testemunha';

    // Registrar assinatura com evidências probatórias
    await admin.from("contrato_assinaturas").insert({
      contrato_id, tipo: tipoSig, nome_signatario,
      assinatura_base64, ip, user_agent: ua,
      documento_hash: docHash, aceite_termos: true,
      geolocation: geolocation || null,
    });

    // Verificar se todos assinaram (contratante + contratado + 2 testemunhas = 4)
    const totalAssinaturas = sigCount + 1;
    const totalNecessario = 4;
    const completo = totalAssinaturas >= totalNecessario;

    if (completo) {
      // Atualizar contrato como ASSINADO
      await admin.from("contratos").update({
        status: 'assinado',
        assinado_em: agora,
        documento_hash: docHash,
        codigo_verificacao: codigoVerificacao,
      }).eq("id", contrato_id);

      // Enviar cópia do contrato por email a todas as partes
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        try {
          const { data: contratoFull } = await admin.from("contratos").select("familia_email, familia_nome, html_renderizado, contrato_assinaturas(nome_signatario, tipo, assinado_em)").eq("id", contrato_id).single();
          if (contratoFull) {
            const signatarios = (contratoFull.contrato_assinaturas || []).map((s: any) => `${escapeHtml(s.nome_signatario)} (${escapeHtml(s.tipo)}) — ${escapeHtml(new Date(s.assinado_em).toLocaleString('pt-BR'))}`).join('<br>');
            const codigoVerificacaoSafe = escapeHtml(codigoVerificacao);
            const docHashSafe = escapeHtml(docHash);
            const emailHtml = `<div style="font-family:sans-serif;max-width:700px;margin:0 auto;">
              <h2 style="color:#2d7a3a;">✅ Contrato Assinado</h2>
              <p>Todas as partes assinaram o contrato eletronicamente.</p>
              <div style="background:#f5f3ee;border:1px solid #e2dbd1;border-radius:8px;padding:16px;margin:16px 0;">
                <strong>Código de Verificação:</strong> <code style="font-size:16px;color:#C8102E;">${codigoVerificacaoSafe}</code><br>
                <strong>Hash SHA-256:</strong> <code style="font-size:10px;">${docHashSafe}</code><br><br>
                <strong>Signatários:</strong><br>${signatarios}
              </div>
              <div style="border:1px solid #e2dbd1;border-radius:8px;padding:16px;margin-top:16px;">
                ${contratoFull.html_renderizado || ''}
              </div>
              <p style="font-size:11px;color:#999;margin-top:16px;">Verifique a autenticidade em: lumied.com.br/verificar?c=${codigoVerificacaoSafe}<br>Assinatura eletrônica válida conforme Lei 14.063/2020 e MP 2.200-2/2001.</p>
            </div>`;
            // Coletar emails de todos os signatários (se tiverem)
            const destinatarios = [contratoFull.familia_email];
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from: "Lumied Contratos <onboarding@resend.dev>",
                to: destinatarios,
                subject: `Contrato Assinado — ${codigoVerificacao}`,
                html: emailHtml,
              }),
              signal: AbortSignal.timeout(8000),
            });
          }
        } catch (e) { console.error("[CONTRATO] Email error:", e); }
      }
    } else {
      // Parcialmente assinado — atualizar hash mas manter status como 'visualizado'
      await admin.from("contratos").update({ documento_hash: docHash }).eq("id", contrato_id);
    }

    logAudit(admin, {
      ator_tipo: 'pai',
      ator_email: (body.email as string) || null,
      recurso: 'contrato',
      recurso_id: contrato_id,
      acao: completo ? 'assinar_completo' : 'assinar_parcial',
      ip,
      user_agent: ua,
      metadata: { codigo_verificacao: codigoVerificacao, assinaturas_registradas: totalAssinaturas, assinaturas_necessarias: totalNecessario },
    });

    return ok({
      success: true,
      message: completo ? "Contrato assinado por todas as partes!" : `Assinatura registrada! Faltam ${totalNecessario - totalAssinaturas} assinatura(s).`,
      completo,
      assinaturas_registradas: totalAssinaturas,
      assinaturas_necessarias: totalNecessario,
      codigo_verificacao: codigoVerificacao,
      documento_hash: docHash,
      assinado_em: agora,
      evidencias: { ip, user_agent: ua, aceite_termos: true, geolocation: geolocation || null },
    });
  }

  // ── Módulos habilitados (público — usado por todos os portais) ──
  if (action === "modulos_habilitados") {
    try {
      const escolaId = await getEscolaPadrao(admin);
      if (!escolaId) return ok({ modulos: [], tema: 'corporativo' });
      const modulos = await getModulosHabilitados(admin, escolaId);
      const { data: escola } = await admin.from("escolas").select("tema").eq("id", escolaId).single();
      return ok({ modulos: [...modulos], tema: escola?.tema || 'corporativo' }, PUBLIC_CACHE);
    } catch { return ok({ modulos: [], tema: 'corporativo' }); }
  }

  // ── Ticket de suporte (público — antes do auth check) ──
  if (action === "ticket_create") {
    const { email, nome, portal, tipo, descricao, url_pagina, user_agent, resolucao_tela } = body as any;
    if (!email || !descricao || !portal) return err("email, descricao e portal obrigatórios.");
    let escola_id = null;
    try {
      const { data: esc } = await admin.from("escolas").select("id").eq("ativo", true).limit(1).single();
      escola_id = esc?.id || null;
    } catch {}
    const { data: ticketData, error: insErr } = await admin.from("tickets").insert({
      escola_id, email, nome: nome || null, portal, tipo: tipo || "bug",
      descricao, url_pagina: url_pagina || null, user_agent: user_agent || null,
      resolucao_tela: resolucao_tela || null,
    }).select("numero").single();
    if (insErr) return err("Erro ao criar ticket: " + insErr.message);
    const ticketNumero = ticketData?.numero;
    try {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        const tipoLabel: Record<string, string> = { bug: 'Bug/Erro', duvida: 'Dúvida', sugestao: 'Sugestão', urgente: '🚨 URGENTE' };
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Lumied Tickets <onboarding@resend.dev>",
            to: ["ivyson@gmail.com"],
            subject: `[Ticket #${sanitizeHeaderValue(String(ticketNumero || '?'))} ${sanitizeHeaderValue(tipoLabel[(tipo as string) || 'bug'] || (tipo as string) || 'bug')}] ${sanitizeHeaderValue((descricao as string || '').slice(0, 80))}`,
            html: `<div style="font-family:sans-serif;max-width:600px;">
              <h2 style="color:#C8102E;">Novo Ticket de Suporte</h2>
              <table style="border-collapse:collapse;width:100%;">
                <tr><td style="padding:8px;font-weight:bold;color:#7a7169;">Tipo</td><td style="padding:8px;">${escapeHtml(tipoLabel[(tipo as string) || 'bug'] || (tipo as string) || 'bug')}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;color:#7a7169;">Email</td><td style="padding:8px;">${escapeHtml(email)}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;color:#7a7169;">Portal</td><td style="padding:8px;">${escapeHtml(portal)}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;color:#7a7169;">URL</td><td style="padding:8px;">${escapeHtml(url_pagina || '—')}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;color:#7a7169;">Descrição</td><td style="padding:8px;">${escapeHtml(descricao)}</td></tr>
              </table>
              <p style="margin-top:16px;font-size:12px;color:#999;">Acesse o painel admin para responder.</p>
            </div>`
          })
        });
      }
    } catch {}
    // Disparar Claude AI trigger imediatamente via poke (fire-and-forget)
    // Token no header (não em query) pra não aparecer em logs/metrics
    try {
      fetch("https://api.claude.ai/v1/code/triggers/trig_01PTaCsfDfdNrUGwfUeZJZ96/poke", {
        method: "POST",
        headers: { "X-Trigger-Token": Deno.env.get("CLAUDE_TRIGGER_TOKEN") || "lumied-ticket-poke-2026" },
      }).catch(() => {});
    } catch {}
    return ok({ success: true, numero: ticketNumero });
  }

  // ════════════════════════════════════════════════════════════
  //  AÇÕES AUTENTICADAS (Gerente)
  // ════════════════════════════════════════════════════════════
  // Token: prioriza _token do body (evita conflito com JWT Verification do Supabase),
  // fallback para Authorization header
  const authHeader = req.headers.get("authorization")?.replace("Bearer ", "") ?? null;
  const token = (body._token as string) || authHeader;
  const gerente = await validarSessao(admin, token);
  if (!gerente) return err("Sessão inválida ou expirada. Faça login novamente.", 401);

  // ── Role check for sensitive financial actions ────────────────
  const sensitiveActions = ["staff_alterar_resp_financeiro", "financeiro_decisao_aprovar", "financeiro_decisao_rejeitar", "indicacao_b2b_config_salvar"];
  if (sensitiveActions.includes(action as string)) {
    const { data: usr } = await admin.from("usuarios").select("papeis").eq("email", gerente.email).maybeSingle();
    const roles = usr?.papeis || [];
    if (!roles.includes("gerente") && !roles.includes("diretor")) {
      return err("Apenas gerentes e diretores podem realizar esta ação.", 403);
    }
  }

  // ── Solicitações ──────────────────────────────────────────────
  if (action === "solicitacoes_list") {
    const limite = Number(body.limite) || 100;
    const offset = Number(body.offset) || 0;
    const { data } = await admin.from("solicitacoes").select("id, email, nome_resp, nome_crianca, turno, serie, dias_semana, mes_vigencia, criado_em").order("criado_em", { ascending: false }).range(offset, offset + limite - 1);
    return ok(data ?? []);
  }
  if (action === "solicitacoes_update_turno") {
    const { id, turno } = body as { id: string; turno: string };
    const { error } = await admin.from("solicitacoes").update({ turno }).eq("id", id);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "solicitacoes_delete") {
    const { id } = body as { id: string };
    await admin.from("solicitacoes").delete().eq("id", id);
    return ok({ success: true });
  }

  // ── Séries (CRUD completo) ────────────────────────────────────
  if (action === "series_list_all") {
    const { data } = await admin.from("series").select("*").order("ordem");
    return ok(data ?? []);
  }
  if (action === "series_create") {
    const { nome, ordem } = body as { nome: string; ordem: number };
    if (!nome) return err("Nome é obrigatório.");
    const { error } = await admin.from("series").insert({ nome, ordem: ordem ?? 99 });
    if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "Já existe uma série com este nome." : sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "series_update") {
    const { id, nome, ordem, ativo } = body as { id: string; nome: string; ordem: number; ativo: boolean };
    const { error } = await admin.from("series").update({ nome, ordem, ativo }).eq("id", id);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "series_delete") {
    const { id } = body as { id: string };
    await admin.from("series").delete().eq("id", id);
    return ok({ success: true });
  }

  // ── Gerentes ──────────────────────────────────────────────────
  if (action === "gerentes_list") {
    const { data } = await admin.from("gerentes").select("id, nome, email, criado_em").order("criado_em");
    return ok(data ?? []);
  }
  if (action === "gerentes_create") {
    const { nome, email, senha } = body as { nome: string; email: string; senha: string };
    if (!nome || !email || !senha) return err("Nome, e-mail e senha são obrigatórios.");
    if ((senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const senha_hash = await hashSenha(senha as string);
    const { error } = await admin.from("gerentes").insert({ nome, email, senha_hash });
    if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "E-mail já cadastrado." : sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "gerentes_delete") {
    const { id } = body as { id: string };
    if (id === gerente.id) return err("Você não pode remover sua própria conta.");
    // Atomic safe delete via RPC (migration 217) — previne race condition
    const { data: okRpc, error: rpcErr } = await admin.rpc("gerentes_safe_delete", { p_id: id });
    if (rpcErr) {
      console.error("[gerentes_safe_delete]", rpcErr);
      return err(sanitizePgError(rpcErr));
    }
    if (!okRpc) return err("É necessário manter pelo menos um gerente.");
    return ok({ success: true });
  }
  if (action === "gerentes_change_password") {
    const { senhaAtual, novaSenha } = body as { senhaAtual: string; novaSenha: string };
    if (!senhaAtual || !novaSenha) return err("Preencha todos os campos.");
    if ((novaSenha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const { data: g } = await admin.from("gerentes").select("senha_hash").eq("id", gerente.id).single();
    if (!g || !(await verificarSenhaAuto(senhaAtual, g.senha_hash))) return err("Senha atual incorreta.");
    const hash = await hashSenha(novaSenha);
    await admin.from("gerentes").update({ senha_hash: hash }).eq("id", gerente.id);
    return ok({ success: true });
  }

  // ── Usuários Unificados ──────────────────────────────────────
  if (action === "usuarios_list") {
    const { data } = await admin.from("usuarios").select("id, nome, email, papel, papeis, ativo, criado_em").order("papel").order("nome");
    const users = (data ?? []).map((u: any) => ({ ...u, papeis: u.papeis?.length ? u.papeis : (u.papel ? [u.papel] : []) }));
    // Enriquece professoras com serie_id
    const profEmails = users.filter(u => u.papeis.includes('professora') || u.papeis.includes('professora_assistente')).map(u => u.email);
    if (profEmails.length) {
      const { data: profs } = await admin.from("professoras").select("email, serie_id, series(id, nome)").in("email", profEmails);
      const profMap = new Map((profs ?? []).map((p: any) => [p.email, { serie_id: p.serie_id, serie_nome: p.series?.nome }]));
      for (const u of users) {
        const p = profMap.get(u.email);
        if (p) { (u as any).serie_id = p.serie_id; (u as any).serie_nome = p.serie_nome; }
      }
    }
    return ok(users);
  }
  if (action === "usuarios_create") {
    const { nome, email, senha, papel, papeis: rawPapeis, features } = body as any;
    if (!nome || !email || !senha) return err("Nome, e-mail e senha são obrigatórios.");
    // Aceita papeis (array) ou papel (string legado)
    let papeis: string[] = Array.isArray(rawPapeis) && rawPapeis.length ? rawPapeis : (papel ? [papel] : []);
    if (!papeis.length) return err("Selecione pelo menos um papel.");
    const papeisValidos = ["gerente", "diretor", "financeiro", "professora", "professora_assistente", "secretaria", "comercial", "manutencao", "impressao"];
    const invalidos = papeis.filter((p: string) => !papeisValidos.includes(p));
    if (invalidos.length) return err("Papel inválido: " + invalidos.join(", "));
    if ((senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const senha_hash = await hashSenhaProf(senha as string);
    const primaryPapel = papeis[0]; // para compatibilidade com coluna legada
    const { error } = await admin.from("usuarios").insert({ nome, email, senha_hash, papel: primaryPapel, papeis });
    if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "E-mail já cadastrado." : sanitizePgError(error)); }
    // Sincroniza com tabelas legadas para cada papel
    if (papeis.includes("gerente") || papeis.includes("diretor") || papeis.includes("financeiro")) {
      await admin.from("gerentes").insert({ nome, email, senha_hash: await hashSenha(senha as string) }).catch(() => {});
    }
    if (papeis.some((p: string) => ["professora", "professora_assistente", "manutencao"].includes(p))) {
      const tipo = papeis.includes("professora_assistente") ? "professora_assistente" : papeis.includes("manutencao") ? "manutencao" : "professora";
      await admin.from("professoras").insert({ nome, email, senha_hash, tipo }).catch(() => {});
    }
    const secRoles = ["secretaria","comercial","financeiro","diretor","manutencao","impressao"];
    if (papeis.some((p: string) => secRoles.includes(p))) {
      let secFeatures = features || [];
      if (!secFeatures.length) {
        if (papeis.includes("secretaria")) secFeatures.push("atestados");
        if (papeis.includes("comercial")) secFeatures.push("crm", "templates", "metas");
        if (papeis.includes("financeiro") || papeis.includes("diretor")) secFeatures.push("financeiro");
        if (papeis.includes("manutencao")) secFeatures.push("manutencao");
        if (papeis.includes("impressao")) secFeatures.push("impressao");
      }
      await admin.from("secretarias").upsert({ nome, email, senha_hash, features: secFeatures, ativo: true }, { onConflict: "email" }).catch(() => {});
    }
    return ok({ success: true });
  }
  if (action === "usuarios_update") {
    const { id, nome, email, papel, papeis: rawPapeis, features } = body as any;
    if (!id) return err("ID obrigatório.");
    // Busca estado atual
    const { data: current } = await admin.from("usuarios").select("nome, email, senha_hash, papeis, papel").eq("id", id).single();
    if (!current) return err("Usuário não encontrado.");
    const update: Record<string, unknown> = {};
    if (nome) update.nome = nome;
    if (email) update.email = email;
    const papeis = Array.isArray(rawPapeis) && rawPapeis.length ? rawPapeis : (papel ? [papel] : null);
    if (papeis) {
      update.papeis = papeis;
      update.papel = papeis[0];
    }
    const { error } = await admin.from("usuarios").update(update).eq("id", id);
    if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "E-mail já cadastrado." : sanitizePgError(error)); }
    // Sincroniza tabelas legadas se papéis mudaram
    if (papeis) {
      try {
        const oldRoles: string[] = current.papeis?.length ? current.papeis : (current.papel ? [current.papel] : []);
        const uEmail = (email || current.email) as string;
        const uNome = (nome || current.nome) as string;
        const uHash = current.senha_hash as string;
        // Gerente: diretor, gerente, financeiro → tabela gerentes
        const needsGerente = papeis.some((p: string) => ["gerente","diretor","financeiro"].includes(p));
        const hadGerente = oldRoles.some((p: string) => ["gerente","diretor","financeiro"].includes(p));
        if (needsGerente && !hadGerente) {
          await admin.from("gerentes").upsert({ nome: uNome, email: uEmail, senha_hash: uHash }, { onConflict: "email" }).catch(() => {});
        } else if (!needsGerente && hadGerente) {
          await admin.from("gerentes").delete().eq("email", uEmail).catch(() => {});
        }
        // Professora
        const needsProf = papeis.some((p: string) => ["professora","professora_assistente","manutencao"].includes(p));
        const hadProf = oldRoles.some((p: string) => ["professora","professora_assistente","manutencao"].includes(p));
        if (needsProf && !hadProf) {
          const tipo = papeis.includes("professora_assistente") ? "professora_assistente" : papeis.includes("manutencao") ? "manutencao" : "professora";
          await admin.from("professoras").upsert({ nome: uNome, email: uEmail, senha_hash: uHash, tipo }, { onConflict: "email" }).catch(() => {});
        } else if (!needsProf && hadProf) {
          await admin.from("professoras").delete().eq("email", uEmail).catch(() => {});
        }
        // Secretaria/Comercial
        const secRoles = ["secretaria","comercial","financeiro","diretor","manutencao","impressao"];
        const needsSec = papeis.some((p: string) => secRoles.includes(p));
        const hadSec = oldRoles.some((p: string) => secRoles.includes(p));
        if (needsSec) {
          const secFeatures: string[] = Array.isArray(features) ? features : [];
          if (!secFeatures.length) {
            if (papeis.includes("secretaria")) secFeatures.push("atestados");
            if (papeis.includes("comercial")) secFeatures.push("crm", "templates", "metas");
            if (papeis.includes("financeiro") || papeis.includes("diretor")) secFeatures.push("financeiro");
            if (papeis.includes("manutencao")) secFeatures.push("manutencao");
            if (papeis.includes("impressao")) secFeatures.push("impressao");
          }
          // Upsert: cria se não existe, atualiza features se existe
          await admin.from("secretarias").upsert({ nome: uNome, email: uEmail, senha_hash: uHash, features: secFeatures, ativo: true }, { onConflict: "email" }).catch(() => {});
        } else if (!needsSec && hadSec) {
          await admin.from("secretarias").update({ ativo: false }).eq("email", uEmail).catch(() => {});
        }
      } catch (_syncErr) {
        // Sync com tabelas legadas é best-effort, não falha a operação principal
      }
    }
    return ok({ success: true });
  }
  if (action === "usuarios_delete") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatório.");
    const { data: u } = await admin.from("usuarios").select("email, papel, papeis").eq("id", id).single();
    if (!u) return err("Usuário não encontrado.");
    if (u.email === gerente.email) return err("Você não pode remover sua própria conta.");
    const roles = u.papeis?.length ? u.papeis : [u.papel];
    if (roles.includes("gerente")) {
      // Conta gerentes em papeis (array) OR papel (singular legado)
      const { count } = await admin.from("usuarios")
        .select("*", { count: "exact", head: true })
        .or("papeis.cs.{gerente},papel.eq.gerente")
        .eq("ativo", true);
      if ((count ?? 0) <= 1) return err("É necessário manter pelo menos um gerente.");
    }
    await admin.from("usuarios").delete().eq("id", id);
    // Remove de todas as tabelas legadas
    await admin.from("gerentes").delete().eq("email", u.email).catch(() => {});
    await admin.from("professoras").delete().eq("email", u.email).catch(() => {});
    await admin.from("secretarias").delete().eq("email", u.email).catch(() => {});
    return ok({ success: true });
  }
  if (action === "usuarios_reset_senha") {
    const { id, nova_senha } = body as { id: string; nova_senha: string };
    if (!id || !nova_senha) return err("ID e nova senha são obrigatórios.");
    if ((nova_senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const senha_hash = await hashSenhaProf(nova_senha as string);
    const { error } = await admin.from("usuarios").update({ senha_hash }).eq("id", id);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // ── Permissões RBAC ────────────────────────────────────────────
  if (action === "permissoes_get") {
    const { usuario_id } = body as { usuario_id: string };
    if (!usuario_id) return err("usuario_id obrigatório.");

    // Get user's papeis (array) com fallback ao singular
    const { data: user } = await admin.from("usuarios").select("papel, papeis").eq("id", usuario_id).single();
    if (!user) return err("Usuário não encontrado.", 404);
    const userRoles: string[] = (user.papeis?.length ? user.papeis : (user.papel ? [user.papel] : [])) as string[];

    // Get defaults de TODOS os papéis e faz UNIÃO (permissão mais permissiva vence)
    const { data: defaults } = userRoles.length
      ? await admin.from("permissoes_papel")
          .select("modulo, pode_ver, pode_editar")
          .in("papel", userRoles)
      : { data: [] as Array<{modulo:string;pode_ver:boolean;pode_editar:boolean}> };

    // Get user-specific overrides
    const { data: overrides } = await admin.from("permissoes_usuario")
      .select("modulo, pode_ver, pode_editar")
      .eq("usuario_id", usuario_id);

    // Merge: overrides take precedence
    const permsMap: Record<string, {pode_ver: boolean, pode_editar: boolean}> = {};
    for (const d of defaults || []) {
      const cur = permsMap[d.modulo];
      // União OR — se QUALQUER papel do usuário permite, permite
      permsMap[d.modulo] = {
        pode_ver: (cur?.pode_ver ?? false) || d.pode_ver,
        pode_editar: (cur?.pode_editar ?? false) || d.pode_editar,
      };
    }
    for (const o of overrides || []) permsMap[o.modulo] = { pode_ver: o.pode_ver, pode_editar: o.pode_editar };

    const result = Object.entries(permsMap).map(([modulo, p]) => ({ modulo, ...p }));
    return ok(result);
  }
  if (action === "permissoes_update") {
    const { usuario_id, permissoes } = body as { usuario_id: string; permissoes: Array<{modulo: string; pode_ver: boolean; pode_editar: boolean}> };
    if (!usuario_id || !Array.isArray(permissoes)) return err("usuario_id e permissoes obrigatórios.");

    const escolaId = await getEscolaPadrao(admin);

    for (const p of permissoes) {
      await admin.from("permissoes_usuario").upsert({
        escola_id: escolaId,
        usuario_id,
        modulo: p.modulo,
        pode_ver: p.pode_ver,
        pode_editar: p.pode_editar,
        atualizado_por: gerente.email,
        atualizado_em: new Date().toISOString(),
      }, { onConflict: "usuario_id,modulo" });
    }

    return ok({ success: true });
  }
  if (action === "permissoes_reset") {
    const { usuario_id } = body as { usuario_id: string };
    if (!usuario_id) return err("usuario_id obrigatório.");
    await admin.from("permissoes_usuario").delete().eq("usuario_id", usuario_id);
    return ok({ success: true });
  }

  // ── Alunos ─────────────────────────────────────────────────
  if (action === "alunos_list") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { data } = await admin.from("alunos").select("id, nome, email, serie, turma, data_nascimento, responsavel_nome, resp_nome, cpf, ativo, turno, dias_semana, atividades_ids, turmas_selecionadas, almoco_dias, criado_em").order("nome");
    return ok(data ?? []);
  }

  if (action === "aluno_documentos_list") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { aluno_email } = body as { aluno_email: string };
    if (!aluno_email) return err("aluno_email obrigatório.");
    const { data } = await admin.from("matricula_documentos").select("*").ilike("aluno_email", aluno_email).order("criado_em", { ascending: false });
    return ok(data ?? []);
  }

  if (action === "aluno_historico_list") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { aluno_nome, aluno_email } = body as { aluno_nome?: string; aluno_email?: string };
    let q = admin.from("aluno_historico").select("*").order("criado_em", { ascending: false });
    if (aluno_email) q = q.ilike("aluno_email", aluno_email);
    else if (aluno_nome) q = q.ilike("aluno_nome", `%${aluno_nome}%`);
    else return err("aluno_nome ou aluno_email obrigatório.");
    const { data } = await q;
    return ok(data ?? []);
  }

  if (action === "aluno_criar") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { nome, email, serie, data_nascimento, responsavel_nome } = body as any;
    if (!nome) return err("Nome obrigatório.");
    const { data, error } = await admin.from("alunos").insert({
      nome, email: email || null, serie: serie || null,
      data_nascimento: data_nascimento || null,
      responsavel_nome: responsavel_nome || null,
      ativo: true,
    }).select("id").single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    logAudit(admin, {
      ator_tipo: 'gerente', ator_id: gerente.id, ator_email: gerente.email,
      recurso: 'aluno', recurso_id: data?.id,
      acao: 'criar', ip, user_agent: req.headers.get('user-agent'),
      depois: { nome, email, serie, responsavel_nome },
    });
    return ok({ success: true, id: data?.id });
  }

  if (action === "aluno_update_turno") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { id, turno, dias_semana } = body as { id: string; turno: string; dias_semana?: string[] };
    if (!id || !turno) return err("id e turno obrigatórios.");
    const updateData: any = { turno };
    if (dias_semana !== undefined) updateData.dias_semana = dias_semana;
    const { error } = await admin.from("alunos").update(updateData).eq("id", id);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  if (action === "alunos_import_turnos") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { registros } = body as { registros: { nome: string; turno: string; dias_semana?: string[] }[] };
    if (!Array.isArray(registros) || !registros.length) return err("registros obrigatório (array).");
    // Busca todos os alunos para matching flexível
    const { data: todosAlunos } = await admin.from("alunos").select("id, nome");
    const alunosList = todosAlunos ?? [];
    function findAlunoTurno(nomeBusca: string) {
      const limpo = nomeBusca.replace(/\s*-\s*G\d+$/i, "").trim().toLowerCase();
      let f = alunosList.find(a => a.nome.toLowerCase() === limpo);
      if (f) return f;
      f = alunosList.find(a => a.nome.toLowerCase().startsWith(limpo) || limpo.startsWith(a.nome.toLowerCase()));
      if (f) return f;
      const palavras = limpo.split(/\s+/).filter(p => p.length > 2);
      return alunosList.find(a => palavras.every(p => a.nome.toLowerCase().includes(p))) || null;
    }
    let sucesso = 0, erros: string[] = [];
    for (const r of registros) {
      if (!r.nome || !r.turno) { erros.push((r.nome || "?") + ": nome e turno obrigatórios"); continue; }
      const updateData: any = { turno: r.turno };
      if (r.dias_semana) updateData.dias_semana = r.dias_semana;
      const found = findAlunoTurno(r.nome);
      if (!found) { erros.push(r.nome + ": aluno não encontrado"); continue; }
      const { error } = await admin.from("alunos").update(updateData).eq("id", found.id);
      if (error) { erros.push(r.nome + ": " + error.message); continue; }
      sucesso++;
    }
    return ok({ sucesso, erros });
  }

  if (action === "alunos_import_atividades") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { registros } = body as { registros: { nome: string; atividade: string; turma?: string }[] };
    if (!Array.isArray(registros) || !registros.length) return err("registros obrigatório (array).");

    // Busca todas as atividades cadastradas para resolver nomes → IDs
    const { data: atividades } = await admin.from("atividades").select("id, nome, horarios");
    const ativMap: Record<string, { id: string; horarios: any[] }> = {};
    for (const a of atividades ?? []) {
      ativMap[a.nome.toLowerCase()] = { id: a.id, horarios: a.horarios ?? [] };
    }

    // Busca todos os alunos para matching flexível
    const { data: todosAlunos } = await admin.from("alunos").select("id, nome");
    const alunosList = todosAlunos ?? [];

    // Função de matching: limpa sufixos (- G1, - G2), normaliza acentos, busca parcial
    function findAluno(nomeBusca: string) {
      // Remove sufixos como "- G1", "- G2" etc
      const limpo = nomeBusca.replace(/\s*-\s*G\d+$/i, "").trim().toLowerCase();
      // Match exato (case-insensitive)
      let found = alunosList.find(a => a.nome.toLowerCase() === limpo);
      if (found) return found;
      // Match parcial: nome da planilha contido no nome do banco ou vice-versa
      found = alunosList.find(a => a.nome.toLowerCase().startsWith(limpo) || limpo.startsWith(a.nome.toLowerCase()));
      if (found) return found;
      // Match por palavras: todas as palavras do nome da planilha devem estar no nome do banco
      const palavras = limpo.split(/\s+/).filter(p => p.length > 2);
      found = alunosList.find(a => {
        const nomeDb = a.nome.toLowerCase();
        return palavras.every(p => nomeDb.includes(p));
      });
      return found || null;
    }

    // Agrupa linhas por aluno (mesmo aluno pode ter múltiplas atividades)
    const porAluno: Record<string, { alunoId: string; atividades_ids: string[]; turmas_selecionadas: any[] }> = {};
    const erros: string[] = [];
    for (const r of registros) {
      if (!r.nome || !r.atividade) { erros.push((r.nome || "?") + ": nome e atividade obrigatórios"); continue; }
      const ativ = ativMap[r.atividade.toLowerCase()];
      if (!ativ) { erros.push(r.nome + ": atividade '" + r.atividade + "' não encontrada"); continue; }
      const aluno = findAluno(r.nome);
      if (!aluno) { erros.push(r.nome + ": aluno não encontrado"); continue; }
      const key = aluno.id;
      if (!porAluno[key]) porAluno[key] = { alunoId: aluno.id, atividades_ids: [], turmas_selecionadas: [] };
      if (!porAluno[key].atividades_ids.includes(ativ.id)) porAluno[key].atividades_ids.push(ativ.id);
      // Resolve turma → slots a partir dos horários da atividade
      const turmaInfo = r.turma ? ativ.horarios.find((h: any) => h.turma === r.turma) : null;
      porAluno[key].turmas_selecionadas.push({
        atividade_id: ativ.id,
        turma: r.turma || (ativ.horarios[0]?.turma ?? ''),
        slots: turmaInfo?.slots ?? ativ.horarios[0]?.slots ?? [],
      });
    }

    let sucesso = 0;
    for (const [, dados] of Object.entries(porAluno)) {
      const { error } = await admin.from("alunos").update({
        atividades_ids: dados.atividades_ids,
        turmas_selecionadas: dados.turmas_selecionadas,
      }).eq("id", dados.alunoId);
      if (error) { erros.push(dados.alunoId + ": " + error.message); continue; }
      sucesso++;
    }
    return ok({ sucesso, erros });
  }

  if (action === "aluno_historico_create") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { aluno_nome, aluno_email, turma, tipo, titulo, descricao } = body as any;
    if (!aluno_nome || !titulo || !tipo) return err("aluno_nome, titulo e tipo obrigatórios.");
    const escolaId = await getEscolaPadrao(admin);
    const { error } = await admin.from("aluno_historico").insert({
      escola_id: escolaId, aluno_nome, aluno_email: aluno_email || null,
      turma: turma || null, tipo, titulo, descricao: descricao || null,
      registrado_por: gerente.nome, registrado_por_papel: 'coordenacao',
    });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // ── Configurações ────────────────────────────────────────────
  if (action === "config_set") {
    const { chave, valor } = body as { chave: string; valor: string };
    await admin.from("configuracoes").upsert({ chave, valor, atualizado_em: new Date().toISOString() });
    return ok({ success: true });
  }
  if (action === "config_delete") {
    const { chave } = body as { chave: string };
    await admin.from("configuracoes").delete().eq("chave", chave);
    return ok({ success: true });
  }

  // ── Logo upload (base64) ─────────────────────────────────────
  if (action === "logo_upload") {
    const { base64, mime } = body as { base64: string; mime: string };
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (!allowed.includes(mime)) return err("Tipo de arquivo não permitido.");
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    if (bytes.length > 5 * 1024 * 1024) return err("Arquivo muito grande (máx. 5MB).");
    const ext = mime.split("/")[1].replace("svg+xml", "svg");
    const path = `logo.${ext}`;
    const { error } = await admin.storage.from("logos").upload(path, bytes, { contentType: mime, upsert: true });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    const { data: { publicUrl } } = admin.storage.from("logos").getPublicUrl(path);
    const url = publicUrl + "?t=" + Date.now();
    await admin.from("configuracoes").upsert({ chave: "logo_url", valor: url });
    return ok({ url });
  }
  if (action === "logo_remove") {
    await admin.from("configuracoes").delete().eq("chave", "logo_url");
    return ok({ success: true });
  }

  // ── Upload de relatório PDF para compartilhar ─────────────────
  if (action === "relatorio_upload") {
    const { base64, nome } = body as { base64: string; nome: string };
    if (!base64 || !nome) return err("base64 e nome são obrigatórios.");
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    if (bytes.length > 20 * 1024 * 1024) return err("Arquivo muito grande (máx. 20MB).");
    // Salva com timestamp para evitar cache
    const path = `relatorios/${nome}-${Date.now()}.pdf`;
    // Garante que o bucket 'relatorios' existe
    await admin.storage.createBucket('relatorios', { public: true, fileSizeLimit: 20971520 }).catch(() => {});
    const { error } = await admin.storage.from("relatorios").upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    const { data: { publicUrl } } = admin.storage.from("relatorios").getPublicUrl(path);
    return ok({ url: publicUrl });
  }

  // ── Atividades (públicas) ─────────────────────────────────────
  if (action === "atividades_list") {
    const { data } = await admin.from("atividades").select("*").eq("ativo", true).order("ordem");
    return ok(data ?? []);
  }

  // ── Atividades CRUD (autenticado) ─────────────────────────────
  if (action === "atividades_list_all") {
    const { data: atividades } = await admin.from("atividades").select("*").order("ordem");
    if (!atividades?.length) return ok([]);

    const { data: alunosAtiv } = await admin.from("alunos").select("turmas_selecionadas").not("turmas_selecionadas", "is", null);
    const ocupacao: Record<string, number> = {};
    for (const al of alunosAtiv ?? []) {
      for (const ts of (al.turmas_selecionadas ?? [])) {
        const key = `${ts.atividade_id}|${ts.turma}`;
        ocupacao[key] = (ocupacao[key] || 0) + 1;
      }
    }

    const resultado = atividades.map(a => ({
      ...a,
      horarios: (a.horarios ?? []).map((t: Record<string, unknown>) => {
        const inscritos = ocupacao[`${a.id}|${t.turma}`] || 0;
        const vagas = Number(t.vagas ?? 999);
        return { ...t, inscritos, vagas_disponiveis: Math.max(0, vagas - inscritos) };
      })
    }));

    return ok(resultado);
  }
  if (action === "atividades_create") {
    const { nome, preco, descricao, cor, horarios, ordem, valor_repasse_aluno } = body as Record<string, unknown>;
    if (!nome) return err("Nome é obrigatório.");
    const { error } = await admin.from("atividades").insert({ nome, preco: preco ?? 0, descricao: descricao ?? "", cor: cor ?? "#C8102E", horarios: horarios ?? [], ordem: ordem ?? 99, valor_repasse_aluno: valor_repasse_aluno ?? 0 });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "atividades_update") {
    const { id, nome, preco, descricao, cor, horarios, ordem, ativo } = body as Record<string, unknown>;
    if (!id) return err("ID obrigatório.");
    const { error } = await admin.from("atividades").update({ nome, preco, descricao, cor, horarios, ordem, ativo }).eq("id", id);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // Atualização completa (edição pelo gerente)
  if (action === "atividades_update_full") {
    const { id, nome, preco, descricao, cor, horarios, ordem, valor_repasse_aluno } = body as Record<string, unknown>;
    if (!id || !nome) return err("ID e nome são obrigatórios.");
    const updateData: Record<string, unknown> = { nome, preco, descricao, cor, horarios, ordem };
    if (valor_repasse_aluno != null) updateData.valor_repasse_aluno = valor_repasse_aluno;
    const { error } = await admin.from("atividades").update(updateData).eq("id", id);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "atividades_delete") {
    const { id } = body as { id: string };
    await admin.from("atividades").delete().eq("id", id);
    return ok({ success: true });
  }

  // ── Contas a Receber — Atividades Extras ─────────────────────
  if (action === "atividades_apurar_mes") {
    // Apura e gera contas a receber para cada atividade no mês informado
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const { data: atividades } = await admin.from("atividades").select("id, nome, valor_repasse_aluno").eq("ativo", true);
    const { data: alunos } = await admin.from("alunos").select("atividades_ids").eq("ativo", true).not("atividades_ids", "is", null);
    if (!atividades?.length) return ok({ gerados: 0 });

    // Conta alunos por atividade
    const contagem: Record<string, number> = {};
    for (const a of alunos ?? []) {
      for (const aid of (a.atividades_ids || [])) {
        contagem[aid] = (contagem[aid] || 0) + 1;
      }
    }

    // Calcula vencimento: dia 05 do mês seguinte
    const [y, m] = mes.split("-").map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    const vencimento = `${nextMonth}-05`;

    let gerados = 0;
    for (const ativ of atividades) {
      const qtd = contagem[ativ.id] || 0;
      if (qtd === 0 && !ativ.valor_repasse_aluno) continue;
      const total = qtd * (ativ.valor_repasse_aluno || 0);
      const { error } = await admin.from("atividades_contas_receber").upsert({
        atividade_id: ativ.id, atividade_nome: ativ.nome, mes_apuracao: mes,
        qtd_alunos: qtd, valor_por_aluno: ativ.valor_repasse_aluno || 0,
        valor_total: total, data_vencimento: vencimento,
      }, { onConflict: "atividade_id,mes_apuracao" });
      if (!error) gerados++;
    }
    return ok({ gerados, mes, vencimento });
  }
  if (action === "atividades_contas_list") {
    const mes = (body as any).mes;
    let q = admin.from("atividades_contas_receber").select("*").order("atividade_nome");
    if (mes) q = q.eq("mes_apuracao", mes);
    const { data } = await q;
    return ok(data ?? []);
  }
  if (action === "atividades_conta_pagar") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatório.");
    await admin.from("atividades_contas_receber").update({ status: "pago", data_pagamento: new Date().toISOString().slice(0, 10) }).eq("id", id);
    return ok({ success: true });
  }
  if (action === "atividades_conta_cancelar") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatório.");
    await admin.from("atividades_contas_receber").update({ status: "cancelado" }).eq("id", id);
    return ok({ success: true });
  }

  // ── Inscrições em atividades (autenticado) ────────────────────
  if (action === "inscricoes_atividades_list") {
    const { data } = await admin.from("alunos").select("id, nome, email, serie, turma, responsavel_nome, resp_nome, atividades_ids, turmas_selecionadas, almoco_dias, criado_em").not("atividades_ids", "is", null).order("nome");
    // Map to expected frontend fields
    const mapped = (data ?? []).map(a => ({
      id: a.id,
      nome_crianca: a.nome,
      email: a.email,
      nome_resp: a.responsavel_nome || a.resp_nome || '',
      serie: a.serie || a.turma || '',
      atividades_ids: a.atividades_ids,
      turmas_selecionadas: a.turmas_selecionadas,
      almoco_dias: a.almoco_dias,
      criado_em: a.criado_em,
    }));
    return ok(mapped);
  }
  if (action === "inscricoes_atividades_delete") {
    const { id } = body as { id: string };
    // Clear atividades from aluno instead of deleting
    const { error } = await admin.from("alunos").update({ atividades_ids: null, turmas_selecionadas: null, almoco_dias: null }).eq("id", id);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "aluno_update_atividades") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { id, atividades_ids, turmas_selecionadas, almoco_dias } = body as any;
    if (!id) return err("id obrigatório.");
    const updateData: any = {};
    if (atividades_ids !== undefined) updateData.atividades_ids = atividades_ids;
    if (turmas_selecionadas !== undefined) updateData.turmas_selecionadas = turmas_selecionadas;
    if (almoco_dias !== undefined) updateData.almoco_dias = almoco_dias;
    const { error } = await admin.from("alunos").update(updateData).eq("id", id);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // ── Professoras (autenticado) ─────────────────────────────────
  if (action === "professoras_list") {
    const { data } = await admin.from("professoras").select("*").order("nome");
    return ok(data ?? []);
  }
  if (action === "professoras_create") {
    const { nome, email, senha, tipo } = body as { nome: string; email: string; senha: string; tipo?: string };
    if (!nome || !email) return err("Nome e e-mail são obrigatórios.");
    const tiposValidos = ["professora", "professora_assistente", "manutencao"];
    const insertData: Record<string, unknown> = { nome, email, tipo: tiposValidos.includes(tipo ?? "") ? tipo : "professora" };
    if (senha) {
      if ((senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
      insertData.senha_hash = await hashSenhaProf(senha as string);
    }
    const { error } = await admin.from("professoras").insert(insertData);
    if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "E-mail já cadastrado." : sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "professoras_reset_senha") {
    const { id, nova_senha } = body as { id: string; nova_senha: string };
    if (!id || !nova_senha) return err("ID e nova senha são obrigatórios.");
    if ((nova_senha as string).length < 6) return err("Senha mínima de 6 caracteres.");
    const senha_hash = await hashSenhaProf(nova_senha as string);
    const { error } = await admin.from("professoras").update({ senha_hash }).eq("id", id);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "professoras_delete") {
    const { id } = body as { id: string };
    await admin.from("professoras").delete().eq("id", id);
    return ok({ success: true });
  }

  // ── Manutenção CRUD (autenticado — gerente) ─────────────────
  if (action === "manutencao_list") {
    const { data, error } = await admin
      .from("manutencoes")
      .select("*, usuarios(nome, email)")
      .order("criado_em", { ascending: false });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    // Sort by urgencia priority: critica > alta > media > baixa, then by criado_em desc
    const prioridade: Record<string, number> = { critica: 0, alta: 1, media: 2, baixa: 3 };
    const sorted = (data ?? []).sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const pa = prioridade[a.urgencia as string] ?? 9;
      const pb = prioridade[b.urgencia as string] ?? 9;
      if (pa !== pb) return pa - pb;
      return new Date(b.criado_em as string).getTime() - new Date(a.criado_em as string).getTime();
    });
    return ok(sorted);
  }
  if (action === "manutencao_create") {
    const { descricao, localizacao, urgencia, foto_url: fotoUrlBody, usuario_id, base64, mime } = body as Record<string, unknown>;
    if (!descricao || !localizacao || !urgencia) return err("Descrição, localização e urgência são obrigatórios.");
    const urgencias = ["baixa", "media", "alta", "critica"];
    if (!urgencias.includes(urgencia as string)) return err("Urgência inválida. Use: baixa, media, alta, critica.");
    let foto_url: string | null = (fotoUrlBody as string) ?? null;
    if (base64 && mime) {
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(mime as string)) return err("Tipo de imagem não permitido.");
      const bytes = Uint8Array.from(atob(base64 as string), c => c.charCodeAt(0));
      if (bytes.length > 10 * 1024 * 1024) return err("Imagem muito grande (máx. 10MB).");
      const ext = (mime as string).split("/")[1];
      const path = `fotos/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      await admin.storage.createBucket("manutencoes", { public: true }).catch(() => {});
      const { error: upErr } = await admin.storage.from("manutencoes").upload(path, bytes, { contentType: mime as string, upsert: false });
      if (upErr) return err("Erro ao enviar foto: " + upErr.message);
      const { data: { publicUrl } } = admin.storage.from("manutencoes").getPublicUrl(path);
      foto_url = publicUrl;
    }
    const insert: Record<string, unknown> = { descricao, localizacao, urgencia, foto_url };
    if (usuario_id) insert.usuario_id = usuario_id;
    else if (gerente?.id) insert.usuario_id = gerente.id;
    const { error } = await admin.from("manutencoes").insert(insert);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "manutencao_update_status") {
    const { id, status, equipe_responsavel, observacao_gerente } = body as Record<string, unknown>;
    if (!id || !status) return err("ID e status são obrigatórios.");
    const statusValidos = ["aprovada", "em_execucao", "concluida", "rejeitada"];
    if (!statusValidos.includes(status as string)) return err("Status inválido. Use: aprovada, em_execucao, concluida, rejeitada.");
    const update: Record<string, unknown> = { status, atualizado_em: new Date().toISOString() };
    if (equipe_responsavel !== undefined) update.equipe_responsavel = equipe_responsavel;
    if (observacao_gerente !== undefined) update.observacao_gerente = observacao_gerente;
    if (status === "concluida") update.data_conclusao = new Date().toISOString().split("T")[0];
    const { error } = await admin.from("manutencoes").update(update).eq("id", id);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "manutencao_delete") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatório.");
    await admin.from("manutencoes").delete().eq("id", id);
    return ok({ success: true });
  }

  // ── Famílias (CRUD) ─────────────────────────────────────
  if (action === "familias_list") {
    const { data } = await admin.from("familias").select("cpf, nome_responsavel, nome_aluno, email, serie, turno, escola_id, atualizado_em").order("nome_aluno");
    return ok(data ?? []);
  }
  if (action === "familias_update") {
    const { cpf, nome_aluno, nome_responsavel, email, serie, turno } = body as {
      cpf: string; nome_aluno?: string; nome_responsavel?: string;
      email?: string; serie?: string | null; turno?: string | null;
    };
    if (!cpf) return err("CPF obrigatório.");
    const updates: Record<string, unknown> = {};
    if (nome_aluno !== undefined) updates.nome_aluno = nome_aluno;
    if (nome_responsavel !== undefined) updates.nome_responsavel = nome_responsavel;
    if (email !== undefined) updates.email = email;
    if (serie !== undefined) updates.serie = serie;
    if (turno !== undefined) updates.turno = turno;
    if (!Object.keys(updates).length) return err("Nenhum campo para atualizar.");
    const { error } = await admin.from("familias").update(updates).eq("cpf", cpf);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }
  if (action === "familias_reset_senha") {
    const { email, nova_senha } = body as { email?: string; nova_senha?: string };
    if (!email) return err("E-mail obrigatório.");
    if (!nova_senha || nova_senha.length < 6) return err("Senha deve ter no mínimo 6 caracteres.");
    // Step 1: Try to create user (works if user doesn't exist yet)
    const { data: created } = await admin.auth.admin.createUser({
      email, password: nova_senha, email_confirm: true
    });
    if (created?.user) return ok({ success: true });
    // Step 2: User already exists — get their ID via generateLink
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink", email
    });
    if (linkErr || !linkData?.user?.id) return err("Não foi possível localizar o usuário: " + (linkErr?.message || "user não encontrado"));
    // Step 3: Update password
    const { error: updateErr } = await admin.auth.admin.updateUserById(linkData.user.id, { password: nova_senha });
    if (updateErr) return err("Erro ao alterar senha: " + updateErr.message);
    return ok({ success: true });
  }
  if (action === "familias_delete") {
    const { cpf, email } = body as { cpf?: string; email?: string };
    if (!cpf && !email) return err("CPF ou email obrigatório.");
    if (cpf) {
      await admin.from("familias").delete().eq("cpf", cpf);
    } else {
      await admin.from("familias").delete().eq("email", email);
    }
    return ok({ success: true });
  }

  // ── Equipes de manutenção (CRUD) ────────────────────────
  if (action === "manut_equipes_list") {
    const { data } = await admin.from("manut_equipes").select("*").eq("ativo", true).order("nome");
    return ok(data ?? []);
  }
  if (action === "manut_equipes_list_all") {
    const { data } = await admin.from("manut_equipes").select("*").order("nome");
    return ok(data ?? []);
  }
  if (action === "manut_equipe_save") {
    const { id, nome } = body as { id?: string; nome: string };
    if (!nome) return err("Nome obrigatório.");
    if (id) {
      const { error } = await admin.from("manut_equipes").update({ nome }).eq("id", id);
      if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    } else {
      const { error } = await admin.from("manut_equipes").insert({ nome });
      if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "Já existe uma equipe com este nome." : sanitizePgError(error)); }
    }
    return ok({ success: true });
  }
  if (action === "manut_equipe_toggle") {
    const { id, ativo } = body as { id: string; ativo: boolean };
    if (!id) return err("ID obrigatório.");
    await admin.from("manut_equipes").update({ ativo }).eq("id", id);
    return ok({ success: true });
  }

  // ── Categorias de insumos ───────────────────────────────
  if (action === "alm_categorias_list") {
    const { data } = await admin.from("alm_categorias").select("*").eq("ativo", true).order("nome");
    return ok(data ?? []);
  }
  if (action === "alm_categorias_list_all") {
    const { data } = await admin.from("alm_categorias").select("*").order("nome");
    return ok(data ?? []);
  }
  if (action === "alm_categoria_save") {
    const { id, nome } = body as { id?: string; nome: string };
    if (!nome) return err("Nome obrigatório.");
    if (id) {
      const { error } = await admin.from("alm_categorias").update({ nome }).eq("id", id);
      if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    } else {
      const { error } = await admin.from("alm_categorias").insert({ nome });
      if (error) { console.error("[api db error]", error); return err(error.message.includes("unique") ? "Já existe uma categoria com este nome." : sanitizePgError(error)); }
    }
    return ok({ success: true });
  }
  if (action === "alm_categoria_toggle") {
    const { id, ativo } = body as { id: string; ativo: boolean };
    if (!id) return err("ID obrigatório.");
    await admin.from("alm_categorias").update({ ativo }).eq("id", id);
    return ok({ success: true });
  }

  // ── Calendario Escolar ─────────────────────────────────
  if (action === "calendario_list") {
    const { mes, ano } = body as { mes?: string; ano?: string };
    let query = admin.from("calendario_eventos").select("*").order("data_inicio");
    if (mes) {
      const [y, m] = mes.split("-");
      const inicio = `${y}-${m}-01`;
      const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
      const fim = `${y}-${m}-${lastDay}`;
      query = query.gte("data_inicio", inicio).lte("data_inicio", fim);
    } else if (ano) {
      query = query.gte("data_inicio", `${ano}-01-01`).lte("data_inicio", `${ano}-12-31`);
    }
    const { data } = await query;
    return ok(data ?? []);
  }
  if (action === "calendario_list_public") {
    // Para pais e professoras (sem auth)
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const [y, m] = mes.split("-");
    const inicio = `${y}-${m}-01`;
    const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
    const fim = `${y}-${m}-${lastDay}`;
    const portal = (body as any).portal || "pais";
    let query = admin.from("calendario_eventos").select("*")
      .gte("data_inicio", inicio).lte("data_inicio", fim).order("data_inicio");
    if (portal === "pais") query = query.eq("visivel_pais", true);
    else query = query.eq("visivel_professoras", true);
    const { data } = await query;
    return ok(data ?? []);
  }
  if (action === "calendario_save") {
    const { id, titulo, descricao, data_inicio, data_fim, tipo, cor, visivel_pais, visivel_professoras } = body as any;
    if (!titulo || !data_inicio) return err("Titulo e data obrigatorios.");
    const data = { titulo, descricao: descricao || null, data_inicio, data_fim: data_fim || data_inicio, tipo: tipo || "evento", cor: cor || "#C8102E", visivel_pais: visivel_pais ?? true, visivel_professoras: visivel_professoras ?? true, criado_por: gerente?.nome };
    if (id) {
      await admin.from("calendario_eventos").update(data).eq("id", id);
    } else {
      await admin.from("calendario_eventos").insert(data);
    }
    return ok({ success: true });
  }
  if (action === "calendario_delete") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("calendario_eventos").delete().eq("id", id);
    return ok({ success: true });
  }

  // ── Analytics Dashboard ───────────────────────────────
  if (action === "analytics_dashboard") {
    const ano = (body as any).ano || new Date().getFullYear().toString();
    // Solicitacoes por mes
    const { data: sols } = await admin.from("solicitacoes").select("criado_em, turno").gte("criado_em", `${ano}-01-01`).lte("criado_em", `${ano}-12-31T23:59:59`);
    const solsPorMes = Array(12).fill(0);
    for (const s of sols ?? []) { const m = new Date(s.criado_em).getMonth(); solsPorMes[m]++; }

    // Almoxarifado gastos por mes
    const { data: reqs } = await admin.from("alm_requisicoes").select("mes, total, status").like("mes", `${ano}-%`);
    const gastosPorMes = Array(12).fill(0);
    for (const r of reqs ?? []) {
      if (r.status === "aprovado") {
        const m = parseInt(r.mes.split("-")[1]) - 1;
        gastosPorMes[m] += r.total || 0;
      }
    }

    // Manutencao por status
    const { data: manuts } = await admin.from("manutencoes").select("status, urgencia, criado_em").gte("criado_em", `${ano}-01-01`);
    const manutStatus: Record<string, number> = {};
    const manutPorMes = Array(12).fill(0);
    for (const m of manuts ?? []) {
      manutStatus[m.status] = (manutStatus[m.status] || 0) + 1;
      const mo = new Date(m.criado_em).getMonth();
      manutPorMes[mo]++;
    }

    // Atividades inscritos
    const { data: ativs } = await admin.from("atividades").select("nome, horarios").eq("ativo", true);
    const atividadesData = (ativs ?? []).map((a: any) => ({
      nome: a.nome,
      inscritos: (a.horarios || []).reduce((s: number, h: any) => s + (h.inscritos || 0), 0),
    }));

    return ok({
      solicitacoes_por_mes: solsPorMes,
      gastos_almox_por_mes: gastosPorMes,
      manutencao_status: manutStatus,
      manutencao_por_mes: manutPorMes,
      atividades: atividadesData,
      ano,
    });
  }

  // ── Permissoes ─────────────────────────────────────────
  if (action === "permissoes_usuario") {
    const papel = gerente?.papel || (body as any).papel || 'gerente';
    const { data } = await admin.from("permissoes_papel").select("modulo, pode_ver, pode_editar").eq("papel", papel);
    return ok(data ?? []);
  }

  // ── Financeiro ────────────────────────────────────────
  if (action === "fin_plano_contas_list") {
    const { data } = await admin.from("fin_plano_contas").select("*").order("codigo");
    return ok(data ?? []);
  }
  if (action === "fin_plano_contas_save") {
    const { id, codigo, nome, tipo } = body as any;
    if (!nome || !tipo) return err("Nome e tipo obrigatorios.");
    if (id) {
      await admin.from("fin_plano_contas").update({ codigo, nome, tipo }).eq("id", id);
    } else {
      await admin.from("fin_plano_contas").insert({ codigo, nome, tipo });
    }
    return ok({ success: true });
  }
  if (action === "fin_lancamento_save") {
    const { id, tipo, conta_id, descricao, valor, data_lancamento, data_vencimento, status, fornecedor, familia_email, familia_nome, observacao } = body as any;
    if (!descricao || !valor || !data_lancamento) return err("Descricao, valor e data obrigatorios.");
    const data = { tipo, conta_id, descricao, valor: parseFloat(valor), data_lancamento, data_vencimento: data_vencimento || null, status: status || 'pendente', fornecedor: fornecedor || null, familia_email: familia_email || null, familia_nome: familia_nome || null, observacao: observacao || null, criado_por: gerente?.nome };
    if (id) {
      await admin.from("fin_lancamentos").update(data).eq("id", id);
    } else {
      await admin.from("fin_lancamentos").insert(data);
    }
    return ok({ success: true });
  }
  if (action === "fin_lancamentos_list") {
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const tipo = (body as any).tipo;
    let query = admin.from("fin_lancamentos").select("*, fin_plano_contas(nome, codigo)")
      .gte("data_lancamento", mes + "-01").lte("data_lancamento", mes + "-31").order("data_lancamento", { ascending: false });
    if (tipo) query = query.eq("tipo", tipo);
    const { data } = await query;
    return ok(data ?? []);
  }
  if (action === "fin_lancamento_pagar") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("fin_lancamentos").update({ status: "pago", data_pagamento: new Date().toISOString().split("T")[0] }).eq("id", id);
    return ok({ success: true });
  }
  if (action === "fin_lancamento_delete") {
    const { id } = body as { id: string };
    await admin.from("fin_lancamentos").delete().eq("id", id);
    return ok({ success: true });
  }
  if (action === "fin_dashboard") {
    const ano = (body as any).ano || new Date().getFullYear().toString();
    const { data: lancs } = await admin.from("fin_lancamentos").select("tipo, valor, status, data_lancamento")
      .gte("data_lancamento", ano + "-01-01").lte("data_lancamento", ano + "-12-31");
    const receitasMes = Array(12).fill(0), despesasMes = Array(12).fill(0);
    let totalReceitas = 0, totalDespesas = 0, pendente = 0;
    for (const l of lancs ?? []) {
      const m = parseInt(l.data_lancamento.split("-")[1]) - 1;
      if (l.tipo === "receita") { receitasMes[m] += l.valor; totalReceitas += l.valor; }
      else { despesasMes[m] += l.valor; totalDespesas += l.valor; }
      if (l.status === "pendente" || l.status === "atrasado") pendente += l.valor;
    }
    // Mensalidades
    const { data: mens } = await admin.from("fin_mensalidades").select("status, valor_total")
      .like("mes", ano + "-%");
    let mensPago = 0, mensPendente = 0, mensTotal = 0;
    for (const m of mens ?? []) {
      mensTotal += m.valor_total;
      if (m.status === "pago") mensPago += m.valor_total;
      else mensPendente += m.valor_total;
    }
    return ok({ receitas_mes: receitasMes, despesas_mes: despesasMes, total_receitas: totalReceitas, total_despesas: totalDespesas, pendente, mensalidades: { total: mensTotal, pago: mensPago, pendente: mensPendente }, ano });
  }
  if (action === "fin_gerar_mensalidades") {
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const vencimento = (body as any).vencimento || 10;
    // Busca todas as solicitacoes ativas
    const { data: sols } = await admin.from("solicitacoes").select("email, nome_resp, nome_crianca, serie, turno");
    const TURNO_PRECOS: Record<string, number> = {
      integral_5x: 4395, integral_4x: 4303.57, integral_3x: 4072.13, integral_2x: 3760.70, integral_1x: 3300,
      semi_5x: 4030, semi_4x: 3991.57, semi_3x: 3773.13, semi_2x: 3534.70, semi_1x: 3196.27, tarde: 0, diaria: 150,
    };
    let geradas = 0;
    for (const s of sols ?? []) {
      const valorTurno = TURNO_PRECOS[s.turno] || 0;
      if (valorTurno <= 0) continue;
      const [y, m] = mes.split("-");
      const dtVenc = `${y}-${m}-${String(vencimento).padStart(2, "0")}`;
      const { error } = await admin.from("fin_mensalidades").upsert({
        familia_email: s.email, familia_nome: s.nome_resp, crianca_nome: s.nome_crianca,
        serie: s.serie, turno: s.turno, valor_turno: valorTurno, valor_atividades: 0,
        valor_total: valorTurno, mes, data_vencimento: dtVenc,
      }, { onConflict: "familia_email,crianca_nome,mes" });
      if (!error) geradas++;
    }
    return ok({ success: true, geradas });
  }
  if (action === "fin_mensalidades_list") {
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const { data } = await admin.from("fin_mensalidades").select("*").eq("mes", mes).order("familia_nome");
    return ok(data ?? []);
  }
  if (action === "fin_mensalidade_pagar") {
    const { id } = body as { id: string };
    await admin.from("fin_mensalidades").update({ status: "pago", data_pagamento: new Date().toISOString().split("T")[0] }).eq("id", id);
    return ok({ success: true });
  }

  // ── DRE ────────────────────────────────────────────────
  if (action === "fin_dre") {
    const ano = (body as any).ano || new Date().getFullYear().toString();
    const { data: contas } = await admin.from("fin_plano_contas").select("id, codigo, nome, tipo").in("tipo", ["receita", "despesa"]).order("codigo");
    const { data: lancs } = await admin.from("fin_lancamentos").select("conta_id, valor, tipo, status, data_lancamento")
      .gte("data_lancamento", ano + "-01-01").lte("data_lancamento", ano + "-12-31");
    // Agrupa por conta e mes
    const contaMap: Record<string, { nome: string; codigo: string; tipo: string; meses: number[]; total: number }> = {};
    for (const c of contas ?? []) {
      contaMap[c.id] = { nome: c.nome, codigo: c.codigo, tipo: c.tipo, meses: Array(12).fill(0), total: 0 };
    }
    for (const l of lancs ?? []) {
      if (l.conta_id && contaMap[l.conta_id]) {
        const m = parseInt(l.data_lancamento.split("-")[1]) - 1;
        contaMap[l.conta_id].meses[m] += l.valor;
        contaMap[l.conta_id].total += l.valor;
      }
    }
    const receitas = Object.values(contaMap).filter(c => c.tipo === "receita");
    const despesas = Object.values(contaMap).filter(c => c.tipo === "despesa");
    const totalReceitasMes = Array(12).fill(0), totalDespesasMes = Array(12).fill(0);
    for (const r of receitas) r.meses.forEach((v, i) => totalReceitasMes[i] += v);
    for (const d of despesas) d.meses.forEach((v, i) => totalDespesasMes[i] += v);
    const resultadoMes = totalReceitasMes.map((r, i) => r - totalDespesasMes[i]);
    return ok({ receitas, despesas, total_receitas_mes: totalReceitasMes, total_despesas_mes: totalDespesasMes, resultado_mes: resultadoMes, ano });
  }

  // ── Balanco Patrimonial ───────────────────────────────
  if (action === "fin_balanco") {
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const { data: contas } = await admin.from("fin_plano_contas").select("id, codigo, nome, tipo").in("tipo", ["ativo", "passivo", "patrimonio"]).order("codigo");
    const { data: saldos } = await admin.from("fin_saldos_patrimoniais").select("conta_id, saldo").eq("mes", mes);
    const saldoMap: Record<string, number> = {};
    for (const s of saldos ?? []) saldoMap[s.conta_id] = s.saldo;
    // Calcula receitas - despesas acumulado ate o mes para lucro/prejuizo
    const [y, m] = mes.split("-");
    const { data: lancs } = await admin.from("fin_lancamentos").select("tipo, valor")
      .gte("data_lancamento", y + "-01-01").lte("data_lancamento", mes + "-31");
    let lucro = 0;
    for (const l of lancs ?? []) { lucro += l.tipo === "receita" ? l.valor : -l.valor; }
    const ativos = (contas ?? []).filter(c => c.tipo === "ativo").map(c => ({ ...c, saldo: saldoMap[c.id] || 0 }));
    const passivos = (contas ?? []).filter(c => c.tipo === "passivo").map(c => ({ ...c, saldo: saldoMap[c.id] || 0 }));
    const patrimonio = (contas ?? []).filter(c => c.tipo === "patrimonio").map(c => ({ ...c, saldo: saldoMap[c.id] || 0 }));
    const totalAtivo = ativos.reduce((s, c) => s + c.saldo, 0);
    const totalPassivo = passivos.reduce((s, c) => s + c.saldo, 0);
    const totalPL = patrimonio.reduce((s, c) => s + c.saldo, 0) + lucro;
    return ok({ ativos, passivos, patrimonio, total_ativo: totalAtivo, total_passivo: totalPassivo, total_pl: totalPL, lucro_periodo: lucro, mes });
  }
  if (action === "fin_saldo_patrimonial_set") {
    const { conta_id, mes, saldo } = body as any;
    if (!conta_id || !mes) return err("conta_id e mes obrigatorios.");
    await admin.from("fin_saldos_patrimoniais").upsert({ conta_id, mes, saldo: parseFloat(saldo) || 0 }, { onConflict: "conta_id,mes" });
    return ok({ success: true });
  }

  // ── Conciliacao Bancaria ──────────────────────────────
  if (action === "fin_extrato_importar") {
    const itens = (body as any).itens || [];
    if (!itens.length) return err("Nenhum item para importar.");
    let ok2 = 0;
    for (const it of itens) {
      const { error } = await admin.from("fin_extrato_bancario").insert({
        data_transacao: it.data, descricao: it.descricao, valor: Math.abs(parseFloat(it.valor)),
        tipo: parseFloat(it.valor) >= 0 ? "credito" : "debito", saldo: it.saldo || null, banco: it.banco || null,
      });
      if (!error) ok2++;
    }
    return ok({ importados: ok2 });
  }
  if (action === "fin_extrato_list") {
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const { data } = await admin.from("fin_extrato_bancario").select("*, fin_lancamentos(descricao, valor)")
      .gte("data_transacao", mes + "-01").lte("data_transacao", mes + "-31").order("data_transacao");
    return ok(data ?? []);
  }
  if (action === "fin_extrato_conciliar") {
    const { extrato_id, lancamento_id } = body as any;
    if (!extrato_id) return err("extrato_id obrigatorio.");
    await admin.from("fin_extrato_bancario").update({ lancamento_id: lancamento_id || null, conciliado: !!lancamento_id }).eq("id", extrato_id);
    return ok({ success: true });
  }
  if (action === "fin_extrato_auto_conciliar") {
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const { data: extratos } = await admin.from("fin_extrato_bancario").select("*").eq("conciliado", false)
      .gte("data_transacao", mes + "-01").lte("data_transacao", mes + "-31");
    const { data: lancs } = await admin.from("fin_lancamentos").select("id, descricao, valor, data_lancamento")
      .gte("data_lancamento", mes + "-01").lte("data_lancamento", mes + "-31");
    let conciliados = 0;
    for (const ext of extratos ?? []) {
      const match = (lancs ?? []).find(l => Math.abs(l.valor - ext.valor) < 0.01 && l.data_lancamento === ext.data_transacao);
      if (match) {
        await admin.from("fin_extrato_bancario").update({ lancamento_id: match.id, conciliado: true }).eq("id", ext.id);
        conciliados++;
      }
    }
    return ok({ conciliados });
  }

  // ── Emissao de Boletos (Inter) ──────────────────────────
  if (action === "fin_emitir_boleto") {
    const { mensalidade_id, cpf_pagador, valor, vencimento, descricao, nome_pagador } = body as any;
    if (!cpf_pagador || !valor || !vencimento) return err("CPF, valor e vencimento obrigatorios.");
    const RELAY_URL = Deno.env.get("INTER_RELAY_URL") || "";
    const RELAY_SECRET = Deno.env.get("RELAY_SECRET") || "";
    try {
      // Criar cobranca via API Inter v3
      const cobrancaBody = {
        seuNumero: `MB-${Date.now()}`,
        valorNominal: parseFloat(valor),
        dataVencimento: vencimento,
        numDiasAgenda: 30,
        pagador: {
          cpfCnpj: cpf_pagador.replace(/\D/g, ""),
          tipoPessoa: cpf_pagador.replace(/\D/g, "").length > 11 ? "JURIDICA" : "FISICA",
          nome: nome_pagador || "Responsavel",
        },
        mensagem: { linha1: descricao || "Mensalidade Escolar" },
      };
      const res = await fetch(`${RELAY_URL}/inter-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RELAY_SECRET}` },
        body: JSON.stringify({ path: "/cobranca/v3/cobrancas", method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cobrancaBody) }),
      });
      const relayResp = await res.json() as any;
      const interData = typeof relayResp.body === "string" ? JSON.parse(relayResp.body) : relayResp.body;
      // Salvar boleto emitido
      const { error: insErr } = await admin.from("fin_boletos_emitidos").insert({
        mensalidade_id: mensalidade_id || null,
        familia_email: (body as any).familia_email || null,
        familia_nome: nome_pagador || null,
        crianca_nome: (body as any).crianca_nome || null,
        cpf_pagador, valor: parseFloat(valor), vencimento, descricao,
        nosso_numero: interData?.cobranca?.nossoNumero || interData?.nossoNumero || null,
        codigo_barras: interData?.boleto?.codigoBarras || null,
        linha_digitavel: interData?.boleto?.linhaDigitavel || null,
        pix_copia_cola: interData?.pix?.pixCopiaECola || null,
        inter_response: interData,
      });
      if (insErr) return err("Boleto criado no Inter mas erro ao salvar: " + insErr.message);
      // Atualizar mensalidade se vinculada
      if (mensalidade_id) {
        await admin.from("fin_mensalidades").update({ status: "pendente" }).eq("id", mensalidade_id);
      }
      return ok({ success: true, nosso_numero: interData?.cobranca?.nossoNumero, pix: interData?.pix?.pixCopiaECola });
    } catch (e) { return err("Erro ao emitir boleto: " + (e as Error).message); }
  }
  if (action === "fin_boletos_emitidos_list") {
    const mes = (body as any).mes;
    let query = admin.from("fin_boletos_emitidos").select("*").order("criado_em", { ascending: false });
    if (mes) query = query.gte("vencimento", mes + "-01").lte("vencimento", mes + "-31");
    const { data } = await query.limit(100);
    return ok(data ?? []);
  }
  if (action === "fin_boleto_cancelar") {
    const { id } = body as { id: string };
    await admin.from("fin_boletos_emitidos").update({ status: "cancelado" }).eq("id", id);
    return ok({ success: true });
  }

  // ── Notas Fiscais ─────────────────────────────────────
  if (action === "fin_nf_emitir") {
    const { mensalidade_id, boleto_id, familia_email, familia_nome, cpf_cnpj_tomador, valor, descricao_servico } = body as any;
    if (!valor || !descricao_servico) return err("Valor e descricao obrigatorios.");
    // Salvar NF como pendente (emissao real sera integrada com sistema da prefeitura)
    const { data: nf, error: insErr } = await admin.from("fin_notas_fiscais").insert({
      boleto_id: boleto_id || null, mensalidade_id: mensalidade_id || null,
      familia_email, familia_nome, cpf_cnpj_tomador: cpf_cnpj_tomador || null,
      valor: parseFloat(valor), descricao_servico,
      status: "pendente",
    }).select("id").single();
    if (insErr) return err(insErr.message);
    return ok({ success: true, nf_id: nf.id });
  }
  if (action === "fin_nf_list") {
    const mes = (body as any).mes;
    let query = admin.from("fin_notas_fiscais").select("*").order("criado_em", { ascending: false });
    if (mes) query = query.gte("criado_em", mes + "-01").lte("criado_em", mes + "-31T23:59:59");
    const { data } = await query.limit(100);
    return ok(data ?? []);
  }
  if (action === "fin_nf_marcar_emitida") {
    const { id, numero_nf, codigo_verificacao } = body as any;
    await admin.from("fin_notas_fiscais").update({ status: "emitida", numero_nf, codigo_verificacao }).eq("id", id);
    return ok({ success: true });
  }

  // ── CRM ────────────────────────────────────────────────
  if (action === "crm_estagios_list") {
    const { data } = await admin.from("crm_estagios").select("*").eq("ativo", true).order("ordem");
    return ok(data ?? []);
  }
  if (action === "crm_leads_list") {
    const { data } = await admin.from("crm_leads").select("*, crm_estagios(nome, cor, ordem)").order("atualizado_em", { ascending: false });
    return ok(data ?? []);
  }
  if (action === "crm_lead_save") {
    const { id, nome_responsavel, email, telefone, nome_crianca, data_nascimento, serie_interesse, estagio_id, origem, valor_mensalidade, observacoes, responsavel_interno, data_proximo_contato, data_visita } = body as any;
    if (!nome_responsavel) return err("Nome obrigatorio.");
    const data = { nome_responsavel, email, telefone, nome_crianca, data_nascimento: data_nascimento || null, serie_interesse, estagio_id, origem, valor_mensalidade: valor_mensalidade ? parseFloat(valor_mensalidade) : null, observacoes, responsavel_interno, data_proximo_contato: data_proximo_contato || null, data_visita: data_visita || null, atualizado_em: new Date().toISOString() };
    if (id) {
      await admin.from("crm_leads").update(data).eq("id", id);
    } else {
      await admin.from("crm_leads").insert(data);
    }
    return ok({ success: true });
  }
  if (action === "crm_lead_mover") {
    const { id, estagio_id } = body as any;
    if (!id || !estagio_id) return err("id e estagio_id obrigatorios.");
    await admin.from("crm_leads").update({ estagio_id, atualizado_em: new Date().toISOString() }).eq("id", id);
    return ok({ success: true });
  }
  if (action === "crm_lead_delete") {
    const { id } = body as { id: string };
    await admin.from("crm_leads").delete().eq("id", id);
    return ok({ success: true });
  }
  if (action === "crm_interacoes_list") {
    const { lead_id } = body as any;
    if (!lead_id) return err("lead_id obrigatorio.");
    const { data } = await admin.from("crm_interacoes").select("*").eq("lead_id", lead_id).order("criado_em", { ascending: false });
    return ok(data ?? []);
  }
  if (action === "crm_interacao_save") {
    const { lead_id, tipo, descricao } = body as any;
    if (!lead_id || !descricao) return err("lead_id e descricao obrigatorios.");
    await admin.from("crm_interacoes").insert({ lead_id, tipo: tipo || "nota", descricao, criado_por: gerente?.nome });
    await admin.from("crm_leads").update({ atualizado_em: new Date().toISOString() }).eq("id", lead_id);
    return ok({ success: true });
  }
  if (action === "crm_templates_list") {
    const { data } = await admin.from("crm_templates").select("*").eq("ativo", true).order("categoria");
    return ok(data ?? []);
  }
  if (action === "crm_template_save") {
    const { id, nome, categoria, conteudo, variaveis } = body as any;
    if (!nome || !conteudo) return err("Nome e conteudo obrigatorios.");
    if (id) { await admin.from("crm_templates").update({ nome, categoria, conteudo, variaveis }).eq("id", id); }
    else { await admin.from("crm_templates").insert({ nome, categoria: categoria || "geral", conteudo, variaveis: variaveis || [] }); }
    return ok({ success: true });
  }
  if (action === "crm_reuniao_save") {
    const { lead_id, titulo, data_hora, duracao_min, local, descricao } = body as any;
    if (!titulo || !data_hora) return err("Titulo e data obrigatorios.");
    const { data: r, error: e } = await admin.from("crm_reunioes").insert({ lead_id, titulo, data_hora, duracao_min: duracao_min || 30, local, descricao, criado_por: gerente?.nome }).select("id").single();
    if (e) return err(e.message);
    // Registra interacao
    if (lead_id) {
      await admin.from("crm_interacoes").insert({ lead_id, tipo: "reuniao", descricao: `Reunião agendada: ${titulo} em ${new Date(data_hora).toLocaleString("pt-BR")}`, criado_por: gerente?.nome });
    }
    return ok({ success: true, id: r.id });
  }
  if (action === "config_series_idade_list") {
    const ano = (body as any).ano || new Date().getFullYear();
    const { data } = await admin.from("config_series_idade").select("*").eq("ano_ref", ano).eq("ativo", true).order("ordem");
    return ok(data ?? []);
  }
  if (action === "config_series_idade_save") {
    const { id, serie, idade_min_meses, idade_max_meses, data_corte_ref, ano_ref } = body as any;
    if (!serie) return err("Serie obrigatoria.");
    const data = { serie, idade_min_meses: parseInt(idade_min_meses), idade_max_meses: parseInt(idade_max_meses), data_corte_ref: data_corte_ref || "03-31", ano_ref: parseInt(ano_ref) || new Date().getFullYear() };
    if (id) { await admin.from("config_series_idade").update(data).eq("id", id); }
    else { await admin.from("config_series_idade").insert({ ...data, ordem: 99 }); }
    return ok({ success: true });
  }
  if (action === "config_series_idade_delete") {
    const { id } = body as { id: string };
    await admin.from("config_series_idade").delete().eq("id", id);
    return ok({ success: true });
  }
  if (action === "config_series_idade_atualizar_ano") {
    const { ano_origem, ano_destino } = body as any;
    if (!ano_origem || !ano_destino) return err("Ano de origem e destino obrigatorios.");
    const { data: existentes } = await admin.from("config_series_idade").select("*").eq("ano_ref", parseInt(ano_origem)).eq("ativo", true);
    if (!existentes?.length) return err("Nenhuma serie encontrada para o ano " + ano_origem);
    for (const s of existentes) {
      await admin.from("config_series_idade").upsert({
        serie: s.serie, idade_min_meses: s.idade_min_meses, idade_max_meses: s.idade_max_meses,
        data_corte_ref: s.data_corte_ref, ano_ref: parseInt(ano_destino), ordem: s.ordem, ativo: true
      }, { onConflict: "serie,ano_ref" });
    }
    return ok({ success: true, total: existentes.length });
  }
  if (action === "crm_calcular_serie") {
    const { data_nascimento } = body as any;
    if (!data_nascimento) return err("data_nascimento obrigatoria.");
    const ano = new Date().getFullYear();
    const { data: config } = await admin.from("config_series_idade").select("*").eq("ano_ref", ano).eq("ativo", true).order("ordem");
    if (!config?.length) return ok({ serie: null });
    const dataCorte = new Date(ano + "-" + (config[0].data_corte_ref || "03-31"));
    const nasc = new Date(data_nascimento);
    const diffMs = dataCorte.getTime() - nasc.getTime();
    const meses = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44));
    const match = config.find(c => meses >= c.idade_min_meses && meses <= c.idade_max_meses);
    return ok({ serie: match?.serie || null, idade_meses: meses });
  }
  // Vagas
  if (action === "crm_vagas_list") {
    const ano = parseInt((body as any).ano) || new Date().getFullYear();
    const { data: turmas } = await admin.from("crm_turmas_vagas").select("*").eq("ano", ano).order("ordem");
    // Contar matriculas/reservas por serie
    const { data: matrs } = await admin.from("crm_matriculas").select("serie, status").eq("ano", ano).in("status", ["reserva", "matriculado"]);
    const ocupMap: Record<string, { reservas: number; matriculados: number }> = {};
    for (const m of matrs ?? []) {
      if (!ocupMap[m.serie]) ocupMap[m.serie] = { reservas: 0, matriculados: 0 };
      if (m.status === "reserva") ocupMap[m.serie].reservas++;
      else ocupMap[m.serie].matriculados++;
    }
    const result = (turmas ?? []).map((t: any) => {
      const o = ocupMap[t.serie] || { reservas: 0, matriculados: 0 };
      return { ...t, reservas: o.reservas, matriculados: o.matriculados, ocupados: o.reservas + o.matriculados, disponiveis: t.vagas_total - o.reservas - o.matriculados };
    });
    return ok(result);
  }
  if (action === "crm_vagas_save") {
    const { id, serie, ano, qtd_turmas, vagas_por_turma, ordem } = body as any;
    if (!serie || !ano) return err("Serie e ano obrigatorios.");
    const data = { serie, ano: parseInt(ano), qtd_turmas: parseInt(qtd_turmas) || 1, vagas_por_turma: parseInt(vagas_por_turma) || 18, ordem: parseInt(ordem) || 0 };
    if (id) { await admin.from("crm_turmas_vagas").update(data).eq("id", id); }
    else { await admin.from("crm_turmas_vagas").upsert(data, { onConflict: "serie,ano" }); }
    return ok({ success: true });
  }
  // Matriculas
  if (action === "crm_matricula_criar") {
    const { lead_id, nome_responsavel, nome_crianca, serie, ano, status, email, telefone, data_nascimento, turma } = body as any;
    if (!nome_crianca || !serie || !ano) return err("Crianca, serie e ano obrigatorios.");
    const st = status || "reserva";
    const { error } = await admin.from("crm_matriculas").insert({
      lead_id, nome_responsavel, nome_crianca, serie, ano: parseInt(ano), status: st,
      email: email || null, telefone: telefone || null, data_nascimento: data_nascimento || null,
      turma: turma || "A",
      data_reserva: st === "reserva" ? new Date().toISOString().split("T")[0] : null,
      data_matricula: st === "matriculado" ? new Date().toISOString().split("T")[0] : null,
    });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    // Mover lead para estagio correto
    if (lead_id) {
      const estagioNome = st === "matriculado" ? "Matrícula Fechada" : "Negociação";
      const { data: est } = await admin.from("crm_estagios").select("id").ilike("nome", `%${estagioNome}%`).maybeSingle();
      if (est) await admin.from("crm_leads").update({ estagio_id: est.id, ano_matricula: parseInt(ano), atualizado_em: new Date().toISOString() }).eq("id", lead_id);
      await admin.from("crm_interacoes").insert({ lead_id, tipo: "nota", descricao: `${st === "matriculado" ? "Matrícula" : "Reserva"} registrada para ${serie} ${ano}`, criado_por: gerente?.nome });
    }
    return ok({ success: true });
  }
  if (action === "crm_matricula_atualizar_status") {
    const { id, status } = body as any;
    if (!id || !status) return err("id e status obrigatorios.");
    const update: Record<string, any> = { status };
    if (status === "matriculado") update.data_matricula = new Date().toISOString().split("T")[0];
    if (status === "cancelado") update.data_cancelamento = new Date().toISOString().split("T")[0];
    await admin.from("crm_matriculas").update(update).eq("id", id);
    return ok({ success: true });
  }
  if (action === "crm_matricula_atualizar_turma") {
    const { id, turma } = body as any;
    if (!id || !turma) return err("id e turma obrigatorios.");
    await admin.from("crm_matriculas").update({ turma }).eq("id", id);
    return ok({ success: true });
  }
  if (action === "crm_matriculas_list") {
    const ano = parseInt((body as any).ano) || new Date().getFullYear();
    const { data } = await admin.from("crm_matriculas").select("*").eq("ano", ano).order("serie").order("turma").order("criado_em");
    return ok(data ?? []);
  }
  if (action === "crm_dashboard") {
    const { data: leads } = await admin.from("crm_leads").select("estagio_id, origem, valor_mensalidade, criado_em, crm_estagios(nome)");
    const { data: estagios } = await admin.from("crm_estagios").select("id, nome, cor, ordem").eq("ativo", true).order("ordem");
    const porEstagio: Record<string, number> = {};
    const porOrigem: Record<string, number> = {};
    let valorPipeline = 0;
    for (const l of leads ?? []) {
      const est = (l as any).crm_estagios?.nome || "?";
      porEstagio[est] = (porEstagio[est] || 0) + 1;
      if (l.origem) porOrigem[l.origem] = (porOrigem[l.origem] || 0) + 1;
      if (l.valor_mensalidade) valorPipeline += l.valor_mensalidade;
    }
    return ok({ total: (leads ?? []).length, por_estagio: porEstagio, por_origem: porOrigem, valor_pipeline: valorPipeline, estagios: estagios ?? [] });
  }

  // ── Impressoes (gerente) ────────────────────────────────
  if (action === "impressoes_pendentes") {
    const { data } = await admin.from("impressoes").select("*")
      .in("status", ["pendente", "aprovado", "impresso"]).order("criado_em", { ascending: true });
    return ok(data ?? []);
  }
  if (action === "impressoes_todas") {
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const { data } = await admin.from("impressoes").select("*")
      .gte("criado_em", mes + "-01").order("criado_em", { ascending: false });
    return ok(data ?? []);
  }
  if (action === "impressao_aprovar") {
    const { id, nota } = body as { id: string; nota?: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("impressoes").update({
      status: "aprovado", aprovado_por: gerente?.nome, aprovado_em: new Date().toISOString(),
      nota_gerente: nota || null,
    }).eq("id", id);
    const { data: imp } = await admin.from("impressoes").select("professora_id, professoras(email)").eq("id", id).maybeSingle();
    const profEmail = (imp as any)?.professoras?.email;
    if (profEmail) {
      await admin.from("notificacoes").insert({ portal: "professora", destinatario: profEmail, titulo: "Impressao aprovada", mensagem: "Sua solicitacao de impressao foi aprovada.", tipo: "success" });
    }
    return ok({ success: true });
  }
  if (action === "impressao_rejeitar") {
    const { id, nota } = body as { id: string; nota?: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("impressoes").update({
      status: "rejeitado", aprovado_por: gerente?.nome, aprovado_em: new Date().toISOString(),
      nota_gerente: nota || null,
    }).eq("id", id);
    const { data: imp } = await admin.from("impressoes").select("professora_id, professoras(email)").eq("id", id).maybeSingle();
    const profEmail = (imp as any)?.professoras?.email;
    if (profEmail) {
      await admin.from("notificacoes").insert({ portal: "professora", destinatario: profEmail, titulo: "Impressao rejeitada", mensagem: nota ? "Motivo: " + nota : "Sua solicitacao foi rejeitada.", tipo: "error" });
    }
    return ok({ success: true });
  }
  if (action === "impressao_marcar_impresso") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("impressoes").update({ status: "impresso", impresso_em: new Date().toISOString() }).eq("id", id);
    return ok({ success: true });
  }
  if (action === "impressao_marcar_entregue") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("impressoes").update({ status: "entregue", entregue_em: new Date().toISOString(), entregue_por: gerente?.nome }).eq("id", id);
    return ok({ success: true });
  }
  if (action === "impressoes_orcamento_list") {
    const mes = (body as any).mes || new Date().toISOString().slice(0, 7);
    const { data: turmas } = await admin.from("series").select("id, nome").eq("ativo", true).order("nome");
    const { data: orcs } = await admin.from("impressoes_orcamento").select("turma_id, limite").eq("mes", mes);
    const { data: usadas } = await admin.from("impressoes").select("turma_id, copias, num_paginas").gte("criado_em", mes + "-01").in("status", ["pendente", "aprovado", "impresso", "entregue"]);
    const orcMap: Record<string, number> = {};
    for (const o of orcs ?? []) orcMap[o.turma_id] = o.limite;
    const usadoMap: Record<string, number> = {};
    for (const u of usadas ?? []) usadoMap[u.turma_id] = (usadoMap[u.turma_id] || 0) + ((u.copias || 0) * (u.num_paginas || 1));
    const result = (turmas ?? []).map((t: any) => ({ ...t, limite: orcMap[t.id] ?? 50, usado: usadoMap[t.id] ?? 0 }));
    return ok(result);
  }
  if (action === "impressoes_orcamento_set") {
    const { turma_id, mes, limite } = body as any;
    if (!turma_id || !mes) return err("turma_id e mes obrigatorios.");
    await admin.from("impressoes_orcamento").upsert({ turma_id, mes, limite: parseInt(limite) || 50 }, { onConflict: "turma_id,mes" });
    return ok({ success: true });
  }

  // ── Horário de Acesso Professoras ────────────────────────
  if (action === "prof_horario_acesso_list") {
    const { data } = await admin.from("professora_horario_acesso").select("*").order("professora_id").order("dia_semana");
    const { data: profs } = await admin.from("professoras").select("id, nome, email").eq("ativo", true).order("nome");
    return ok({ data: data ?? [], professoras: profs ?? [] });
  }
  if (action === "prof_horario_acesso_salvar") {
    const { professora_id, horarios } = body as any;
    if (!professora_id || !Array.isArray(horarios)) return err("professora_id e horarios[] obrigatórios.");
    // Remove existentes e insere novos
    await admin.from("professora_horario_acesso").delete().eq("professora_id", professora_id);
    if (horarios.length > 0) {
      const rows = horarios.map((h: any) => ({
        professora_id,
        dia_semana: h.dia_semana,
        hora_inicio: h.hora_inicio || "07:00",
        hora_fim: h.hora_fim || "18:00",
        ativo: h.ativo !== false,
      }));
      const { error } = await admin.from("professora_horario_acesso").insert(rows);
      if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    }
    return ok({ success: true });
  }
  if (action === "prof_horario_acesso_remover") {
    const { professora_id } = body as any;
    if (!professora_id) return err("professora_id obrigatório.");
    await admin.from("professora_horario_acesso").delete().eq("professora_id", professora_id);
    return ok({ success: true });
  }

  // ── Alertas de Emergencia ───────────────────────────────
  if (action === "emergencia_acionar") {
    const { tipo, mensagem } = body as { tipo: string; mensagem?: string };
    if (!tipo) return err("Tipo obrigatorio.");
    const { error } = await admin.from("alertas_emergencia").insert({
      tipo, mensagem: mensagem || null,
      acionado_por: gerente?.nome || "Gerente",
      acionado_por_id: gerente?.id || null,
    });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    // Notifica todos os portais
    const { data: users } = await admin.from("usuarios").select("email, papel, papeis");
    const tipos: Record<string, string> = { incendio: "INCENDIO", intruso: "INTRUSO", emergencia_medica: "EMERGENCIA MEDICA", evacuacao: "EVACUACAO", outro: "ALERTA" };
    const tipoLabel = tipos[tipo] || tipo.toUpperCase();
    for (const u of users ?? []) {
      const uRoles: string[] = (u.papeis?.length ? u.papeis : (u.papel ? [u.papel] : [])) as string[];
      // Emergência: enviar para o portal mais privilegiado do usuário
      const portal = uRoles.includes("gerente") ? "gerente"
        : uRoles.includes("secretaria") || uRoles.includes("comercial") || uRoles.includes("financeiro") ? "secretaria"
        : "professora";
      await admin.from("notificacoes").insert({
        portal, destinatario: u.email,
        titulo: "EMERGENCIA: " + tipoLabel,
        mensagem: mensagem || "Alerta de emergencia acionado. Siga o protocolo de seguranca.",
        tipo: "error",
      });
    }
    return ok({ success: true });
  }
  if (action === "emergencia_resolver") {
    const { id } = body as { id: string };
    if (!id) return err("ID obrigatorio.");
    await admin.from("alertas_emergencia").update({
      ativo: false, resolvido_em: new Date().toISOString(),
      resolvido_por: gerente?.nome || "Gerente",
    }).eq("id", id);
    return ok({ success: true });
  }
  if (action === "emergencia_ativos") {
    const { data } = await admin.from("alertas_emergencia").select("*")
      .eq("ativo", true).order("criado_em", { ascending: false });
    return ok(data ?? []);
  }
  if (action === "emergencia_historico") {
    const { data } = await admin.from("alertas_emergencia").select("*")
      .order("criado_em", { ascending: false }).limit(50);
    return ok(data ?? []);
  }

  // ── Atribuir turma/série a professora ───────────────────
  if (action === "usuarios_set_serie") {
    const { email, serie_id, serie_nome } = body as { email: string; serie_id?: string | null; serie_nome?: string };
    if (!email) return err("E-mail obrigatório.");
    let resolvedId = serie_id || null;
    if (!resolvedId && serie_nome) {
      const { data: s } = await admin.from("series").select("id").ilike("nome", serie_nome).limit(1).maybeSingle();
      resolvedId = s?.id || null;
    }
    const { error } = await admin.from("professoras").update({ serie_id: resolvedId }).eq("email", email);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // ── Notificações ────────────────────────────────────────
  if (action === "notif_list") {
    const { portal, email } = body as { portal: string; email: string };
    if (!portal || !email) return err("portal e email obrigatórios.");
    const { data } = await admin.from("notificacoes").select("*")
      .eq("portal", portal).eq("destinatario", email)
      .order("criado_em", { ascending: false }).limit(50);
    return ok(data ?? []);
  }
  if (action === "notif_marcar_lida") {
    const { ids } = body as { ids: string[] };
    if (!ids || !Array.isArray(ids)) return err("ids obrigatório (array).");
    await admin.from("notificacoes").update({ lida: true }).in("id", ids);
    return ok({ success: true });
  }
  if (action === "notif_marcar_todas") {
    const { portal, email } = body as { portal: string; email: string };
    if (!portal || !email) return err("portal e email obrigatórios.");
    await admin.from("notificacoes").update({ lida: true }).eq("portal", portal).eq("destinatario", email).eq("lida", false);
    return ok({ success: true });
  }

  // ── WebAuthn / Biometria (gerente) ──────────────────────
  if (action === "webauthn_register_challenge") {
    const rp_id = body.rp_id as string;
    if (!rp_id || !gerente) return err("Sessão inválida.", 401);
    const challenge = generateChallenge();
    await admin.from("webauthn_challenges").insert({ challenge, usuario_tipo: "gerente", usuario_id: gerente.id, tipo: "register", rp_id });
    await admin.from("webauthn_challenges").delete().lt("expira_em", new Date().toISOString());
    return ok({ challenge, rp_id, user_id: b64urlEncode(new TextEncoder().encode(gerente.id)), user_name: gerente.email, user_display_name: gerente.nome });
  }
  if (action === "webauthn_register_verify") {
    const { credential, rp_id } = body as { credential: any; rp_id: string };
    if (!credential || !rp_id || !gerente) return err("Dados incompletos.", 400);
    const { data: ch } = await admin.from("webauthn_challenges").select("*").eq("tipo", "register").eq("usuario_id", gerente.id).gt("expira_em", new Date().toISOString()).order("criado_em", { ascending: false }).limit(1).maybeSingle();
    if (!ch) return err("Challenge expirado.", 400);
    await admin.from("webauthn_challenges").delete().eq("id", ch.id);
    try {
      const result = await verifyRegistration(credential.response.clientDataJSON, credential.response.attestationObject, ch.challenge, rp_id);
      await admin.from("webauthn_credentials").insert({ usuario_tipo: "gerente", usuario_id: gerente.id, credential_id: result.credentialId, public_key: result.publicKey, sign_count: result.signCount, transports: credential.transports || ["internal"], rp_id });
      return ok({ success: true });
    } catch (e) { return err("Verificação falhou: " + (e as Error).message, 400); }
  }

  // ═══════════════════════════════════════════════════════════
  //  MATRÍCULA / REMATRÍCULA ONLINE
  // ═══════════════════════════════════════════════════════════

  if (action === "matricula_formulario_get") {
    const { ano, tipo } = body as any;
    const { data } = await admin.from("matricula_formularios").select("*").eq("ano", ano || new Date().getFullYear()).eq("tipo", tipo || "nova").eq("ativo", true).single();
    return ok(data || { campos: [] });
  }

  if (action === "matricula_formulario_create") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { ano, tipo, titulo, campos } = body as any;
    if (!ano || !tipo) return err("Ano e tipo obrigatórios.");
    const { data, error } = await admin.from("matricula_formularios").upsert({ ano, tipo, titulo, campos: campos || [] }, { onConflict: "ano,tipo" }).select().single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok(data);
  }

  if (action === "matricula_submit") {
    const { ano, dados, documentos_base64 } = body as any;
    if (!dados || !dados.nome_crianca || !dados.email) return err("Dados incompletos.");
    // Criar matrícula no CRM
    const { data: mat, error } = await admin.from("crm_matriculas").insert({
      nome_crianca: dados.nome_crianca,
      serie: dados.serie_pretendida || dados.serie_proxima || null,
      ano: ano || new Date().getFullYear(),
      status: "reserva",
      nome_responsavel: dados.nome_responsavel || null,
      email: dados.email,
      telefone: dados.telefone || null,
      data_nascimento: dados.data_nascimento || null,
      observacoes: dados.observacoes || null
    }).select().single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok(mat);
  }

  if (action === "matricula_documentos_upload") {
    const { matricula_id, tipo, base64, mime, nome_arquivo } = body as any;
    if (!matricula_id || !tipo || !base64) return err("matricula_id, tipo e base64 obrigatórios.");
    const bytes = Uint8Array.from(atob(base64), (c: string) => c.charCodeAt(0));
    const ext = (mime || "application/pdf").split("/")[1] || "pdf";
    const fileName = `matriculas/${matricula_id}/${Date.now()}_${tipo}.${ext}`;
    const { error: upErr } = await admin.storage.from("documentos").upload(fileName, bytes, { contentType: mime || "application/pdf", upsert: false });
    if (upErr) return err(upErr.message);
    const { data: { publicUrl } } = admin.storage.from("documentos").getPublicUrl(fileName);
    const { data, error } = await admin.from("matricula_documentos").insert({ matricula_id, tipo, nome_arquivo, arquivo_url: publicUrl }).select().single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok(data);
  }

  if (action === "rematricula_gerar_lote") {
    const gerente = await validarSessao(admin, token);
    if (!gerente) return err("Sessão inválida.", 401);
    const { ano } = body as any;
    const anoAlvo = ano || new Date().getFullYear() + 1;
    // Buscar famílias ativas
    const { data: familias } = await admin.from("familias").select("email, nome_aluno, nome_responsavel, serie");
    if (!familias || familias.length === 0) return ok({ count: 0 });
    let count = 0;
    for (const f of familias) {
      const { error } = await admin.from("crm_matriculas").upsert({
        nome_crianca: f.nome_aluno, serie: f.serie, ano: anoAlvo, status: "reserva",
        nome_responsavel: f.nome_responsavel, email: f.email
      }, { onConflict: "email,ano" }).select();
      if (!error) count++;
    }
    return ok({ success: true, count });
  }

  if (action === "matricula_status_list") {
    const { ano, status } = body as any;
    let q = admin.from("crm_matriculas").select("*, matricula_documentos(tipo, validado)").order("criado_em", { ascending: false });
    if (ano) q = q.eq("ano", ano);
    if (status) q = q.eq("status", status);
    const { data } = await q;
    return ok(data ?? []);
  }

  // ── Módulos habilitados (feature gating) ──

  // ── Indicações B2C (público) ────────────────────────
  if (action === "indicacao_criar") {
    const { indicador_nome, indicador_email, indicador_telefone, lead_nome, lead_telefone, lead_email, lead_serie_interesse, lead_mensagem, codigo_indicacao } = body as any;
    if (!indicador_nome || !indicador_email || !lead_nome || !lead_telefone || !codigo_indicacao) return err("Campos obrigatórios ausentes.");
    const { data: ind, error: insErr } = await admin.from("indicacoes").insert({ indicador_nome, indicador_email, indicador_telefone, lead_nome, lead_telefone, lead_email, lead_serie_interesse, lead_mensagem, codigo_indicacao, ip_origem: ip }).select().single();
    if (insErr) return err(insErr.message);
    const { data: primeiroEstagio } = await admin.from("crm_estagios").select("id").order("ordem").limit(1).single();
    if (primeiroEstagio) {
      const { data: crmLead } = await admin.from("crm_leads").insert({ nome_responsavel: lead_nome, email: lead_email, telefone: lead_telefone, serie_interesse: lead_serie_interesse, origem: "indicacao", observacoes: `Indicado por: ${indicador_nome} (${indicador_email}). ${lead_mensagem || ""}`.trim(), estagio_id: primeiroEstagio.id }).select("id").single();
      if (crmLead) await admin.from("indicacoes").update({ crm_lead_id: crmLead.id }).eq("id", ind.id);
    }
    return ok({ data: ind, success: true });
  }
  if (action === "indicacao_rastrear") {
    const { codigo_indicacao: cod } = body as any;
    if (!cod) return err("Código obrigatório.");
    const { data: indData } = await admin.from("indicacoes").select("lead_nome, status, recompensa_status, recompensa_descricao, criado_em").eq("codigo_indicacao", cod.toUpperCase()).single();
    if (!indData) return err("Indicação não encontrada.", 404);
    return ok({ data: indData });
  }

  // ── Indicações B2B (parceiros) ────────────────────
  if (action === "indicacao_b2b_auth") {
    const { email: authEmail } = body as any;
    if (!authEmail) return err("E-mail obrigatório.");
    const { data: ger } = await admin.from("gerentes").select("id, nome, email").eq("email", authEmail).single();
    if (!ger) return err("E-mail não encontrado.", 404);
    const { data: esc } = await admin.from("escolas").select("id, nome").eq("ativo", true).limit(1).single();
    return ok({ data: { ...ger, escola_id: esc?.id, escola_nome: esc?.nome, is_gerente: true } });
  }
  if (action === "indicacao_b2b_criar") {
    const { indicador_email: ie, indicador_nome: iname, escola_indicadora_id, escola_nome: en, escola_cidade, escola_estado, escola_tipo, contato_nome, contato_telefone, contato_email, contato_cargo, mensagem: msg2, codigo } = body as any;
    if (!ie || !en || !contato_nome || !contato_telefone || !codigo) return err("Campos obrigatórios ausentes.");
    const { data: b2bData, error: b2bErr } = await admin.from("indicacoes_b2b").insert({ escola_indicadora_id, indicador_nome: iname, indicador_email: ie, escola_nome: en, escola_cidade, escola_estado, escola_tipo, contato_nome, contato_telefone, contato_email, contato_cargo, mensagem: msg2, codigo }).select().single();
    if (b2bErr) return err(b2bErr.message);
    return ok({ data: b2bData, success: true });
  }
  if (action === "indicacao_b2b_list") {
    const { email: listEmail } = body as any;
    if (!listEmail) return err("E-mail obrigatório.");
    const { data: b2bList } = await admin.from("indicacoes_b2b").select("*").eq("indicador_email", listEmail).order("criado_em", { ascending: false });
    return ok({ data: b2bList ?? [] });
  }
  if (action === "indicacao_b2b_config_salvar") {
    const { bonificacao_demonstracao, bonificacao_contratacao, bonificacao_especial } = body as any;
    await admin.from("indicacoes_b2b_config").update({ bonificacao_demonstracao, bonificacao_contratacao, bonificacao_especial }).eq("programa_ativo", true);
    return ok({ success: true });
  }

  // ── WhatsApp — Endpoints de integração SaaS ────────
  if (action === "wa_family_by_phone") {
    const { phone: waPhone } = body as any;
    if (!waPhone) return err("Phone obrigatório.");
    // Normalizar: remover +55, espaços, hifens. `cleanPhone` contém apenas
    // dígitos (0-9), portanto é seguro interpolar no filtro .or() — não há
    // caracteres que possam quebrar o parser de filtros do PostgREST.
    const cleanPhone = String(waPhone).replace(/\D/g, '').replace(/^55/, '');
    if (!cleanPhone || cleanPhone.length < 8 || cleanPhone.length > 15) return err("Phone inválido.");
    // Buscar família por telefone (pai ou mãe)
    const { data: fam } = await admin.from("familias").select("id, nome_responsavel, email, telefone, alunos(id, nome)").or(`telefone.like.%${cleanPhone}%,telefone2.like.%${cleanPhone}%`).limit(1).single();
    if (!fam) return ok({ data: null });
    const aluno = fam.alunos?.[0];
    return ok({ data: { familia_id: fam.id, nome_responsavel: fam.nome_responsavel, email: fam.email, aluno_id: aluno?.id, aluno_nome: aluno?.nome } });
  }

  if (action === "wa_student_balance") {
    const { student_id: sid } = body as any;
    if (!sid) return err("student_id obrigatório.");
    const { data: aluno } = await admin.from("alunos").select("nome").eq("id", sid).single();
    const { data: boletos } = await admin.from("boletos").select("descricao, valor, vencimento, status").eq("aluno_id", sid).order("vencimento", { ascending: false }).limit(5);
    return ok({ data: { aluno_nome: aluno?.nome, items: boletos ?? [] } });
  }

  if (action === "wa_student_attendance_today") {
    const { student_id: sid } = body as any;
    if (!sid) return err("student_id obrigatório.");
    const today = new Date().toISOString().split("T")[0];
    const { data: aluno } = await admin.from("alunos").select("nome").eq("id", sid).single();
    const { data: freq } = await admin.from("frequencia").select("presente, hora_entrada").eq("aluno_id", sid).eq("data", today).single();
    return ok({ data: freq ? { aluno_nome: aluno?.nome, presente: freq.presente, hora_entrada: freq.hora_entrada } : null });
  }

  if (action === "wa_class_events") {
    const { class_id: cid } = body as any;
    const { data: eventos } = await admin.from("calendario_eventos").select("titulo, data, descricao").gte("data", new Date().toISOString().split("T")[0]).order("data").limit(5);
    return ok({ data: eventos ?? [] });
  }

  if (action === "wa_meetings_scheduled") {
    const { data: meetings } = await admin.from("wa_scheduled_meetings").select("*").gte("meeting_at", new Date().toISOString()).eq("followup_sent", false).order("meeting_at");
    return ok({ data: meetings ?? [] });
  }

  // ── Suporte FAQ (público) ─────────────────────────
  if (action === "suporte_faq_list") {
    const { portal: p } = body as any;
    // Use .in() with a strict allow-list to prevent PostgREST .or() injection.
    const ALLOWED_PORTALS = ["todos", "pais", "gerente", "professora", "secretaria", "aluno", "admin"];
    let q = admin.from("suporte_faq").select("id, pergunta, resposta, palavras_chave, categoria").eq("ativo", true).order("ordem");
    if (p && p !== 'todos') {
      if (typeof p !== "string" || !ALLOWED_PORTALS.includes(p)) {
        return err("Portal inválido.");
      }
      q = q.in("portal", ["todos", p]);
    }
    const { data: faqData } = await q;
    return ok({ data: faqData ?? [] });
  }

  // ── Responsável financeiro / Decisões ─────────────
  if (action === "financeiro_resp_get") {
    const { data: escola } = await admin.from("escolas").select("resp_financeiro_nome, resp_financeiro_email, resp_financeiro_telefone, resp_financeiro_cargo, resp_financeiro_definido").limit(1).single();
    return ok({ data: escola });
  }

  if (action === "financeiro_resp_salvar") {
    const { resp_financeiro_nome, resp_financeiro_email, resp_financeiro_telefone, resp_financeiro_cargo } = body as any;
    if (!resp_financeiro_nome || !resp_financeiro_email) return err("Nome e email do responsável financeiro obrigatórios.");
    // Verificar se já foi definido — só staff Lumied pode alterar depois
    const { data: escolaCheck } = await admin.from("escolas").select("id, resp_financeiro_definido, resp_financeiro_nome, resp_financeiro_email").eq("ativo", true).limit(1).single();
    if (escolaCheck?.resp_financeiro_definido) {
      return err("O responsável financeiro já foi definido no onboarding e só pode ser alterado pelo suporte Lumied. Contate suporte@lumied.com.br");
    }
    // Primeira definição (onboarding)
    await admin.from("escolas").update({
      resp_financeiro_nome, resp_financeiro_email, resp_financeiro_telefone, resp_financeiro_cargo,
      resp_financeiro_definido: true, resp_financeiro_definido_em: new Date().toISOString(), resp_financeiro_definido_por: "onboarding",
    }).eq("id", escolaCheck.id);
    await admin.from("resp_financeiro_historico").insert({
      escola_id: escolaCheck.id, acao: "definido", nome_novo: resp_financeiro_nome, email_novo: resp_financeiro_email, alterado_por: "onboarding",
    });
    return ok({ success: true });
  }

  // Staff Lumied (via admin.html): alterar resp financeiro
  if (action === "staff_alterar_resp_financeiro") {
    const { escola_id: eid, resp_financeiro_nome: rfn, resp_financeiro_email: rfe, resp_financeiro_telefone: rft, resp_financeiro_cargo: rfc, motivo: motivoRf, admin_nome: an } = body as any;
    if (!eid || !rfn || !rfe) return err("escola_id, nome e email obrigatórios.");
    const { data: ant } = await admin.from("escolas").select("resp_financeiro_nome, resp_financeiro_email").eq("id", eid).single();
    await admin.from("escolas").update({ resp_financeiro_nome: rfn, resp_financeiro_email: rfe, resp_financeiro_telefone: rft, resp_financeiro_cargo: rfc, resp_financeiro_definido_por: `staff:${an || "admin"}` }).eq("id", eid);
    await admin.from("resp_financeiro_historico").insert({ escola_id: eid, acao: "alterado", nome_anterior: ant?.resp_financeiro_nome, email_anterior: ant?.resp_financeiro_email, nome_novo: rfn, email_novo: rfe, alterado_por: `staff:${an || "admin"}`, motivo: motivoRf });
    return ok({ success: true });
  }

  if (action === "financeiro_decisoes_pendentes") {
    const { data } = await admin.from("escola_decisoes_financeiras").select("*").eq("status", "pendente").order("criado_em", { ascending: false });
    return ok({ data: data ?? [] });
  }

  if (action === "financeiro_decisoes_list") {
    const { status: st } = body as any;
    let q2 = admin.from("escola_decisoes_financeiras").select("*").order("criado_em", { ascending: false });
    if (st) q2 = q2.eq("status", st);
    const { data } = await q2.limit(100);
    return ok({ data: data ?? [] });
  }

  if (action === "financeiro_decisao_aprovar") {
    const { id: decId } = body as any;
    if (!decId) return err("ID obrigatório.");
    const { data: decisao } = await admin.from("escola_decisoes_financeiras").select("*").eq("id", decId).single();
    if (!decisao) return err("Decisão não encontrada.", 404);
    if (decisao.status !== "pendente") return err("Decisão já processada.");

    // Buscar resp financeiro
    const { data: escola } = await admin.from("escolas").select("resp_financeiro_nome, resp_financeiro_email").eq("id", decisao.escola_id).single();

    await admin.from("escola_decisoes_financeiras").update({
      status: "aprovado",
      aprovado_por: escola?.resp_financeiro_nome || gerente?.nome || "Gerente",
      aprovado_por_email: escola?.resp_financeiro_email,
      aprovado_em: new Date().toISOString(),
      executado: true,
      executado_em: new Date().toISOString(),
    }).eq("id", decId);

    // Se for upgrade, aplicar mudança de plano
    if (decisao.tipo === "upgrade_tier" && decisao.plano_solicitado) {
      const { data: novoPlano } = await admin.from("planos").select("id").eq("slug", decisao.plano_solicitado).single();
      if (novoPlano) await admin.from("escolas").update({ plano_id: novoPlano.id }).eq("id", decisao.escola_id);
    }

    return ok({ success: true, tipo: decisao.tipo });
  }

  if (action === "financeiro_decisao_rejeitar") {
    const { id: decId, motivo } = body as any;
    if (!decId) return err("ID obrigatório.");
    const { data: escola } = await admin.from("escolas").select("resp_financeiro_nome, resp_financeiro_email").limit(1).single();
    await admin.from("escola_decisoes_financeiras").update({
      status: "rejeitado", motivo_rejeicao: motivo || "Rejeitado pelo responsável financeiro.",
      aprovado_por: escola?.resp_financeiro_nome || "Gerente", aprovado_em: new Date().toISOString(),
    }).eq("id", decId);
    return ok({ success: true });
  }

  if (action === "financeiro_solicitar_upgrade") {
    const { plano_solicitado, motivo: motivoUp } = body as any;
    if (!plano_solicitado) return err("plano_solicitado obrigatório.");
    const { data: escola } = await admin.from("escolas").select("id, plano_id, planos(slug, preco_mensal)").limit(1).single();
    const { data: novo } = await admin.from("planos").select("slug, nome, preco_mensal").eq("slug", plano_solicitado).single();
    if (!novo) return err("Plano não encontrado.");
    const diff = novo.preco_mensal - ((escola as any).planos?.preco_mensal || 0);
    await admin.from("escola_decisoes_financeiras").insert({
      escola_id: escola.id, tipo: "upgrade_tier",
      descricao: `Upgrade de ${(escola as any).planos?.slug || '?'} para ${novo.nome}. Diferença: +R$ ${diff.toFixed(2)}/mês. ${motivoUp || ''}`,
      valor_estimado: diff, recorrente: true,
      plano_atual: (escola as any).planos?.slug, plano_solicitado,
      solicitado_por: gerente?.nome || "Gerente", solicitado_por_email: gerente?.email,
    });
    return ok({ success: true, diferenca: diff });
  }

  if (action === "financeiro_extras_disponiveis") {
    const { data } = await admin.from("escola_extras").select("*").eq("ativo", true).order("preco");
    return ok({ data: data ?? [] });
  }

  if (action === "financeiro_solicitar_extra") {
    const { extra_id } = body as any;
    if (!extra_id) return err("extra_id obrigatório.");
    const { data: extra } = await admin.from("escola_extras").select("*").eq("id", extra_id).single();
    if (!extra) return err("Extra não encontrado.");
    const { data: escola } = await admin.from("escolas").select("id").eq("ativo", true).limit(1).single();
    await admin.from("escola_decisoes_financeiras").insert({
      escola_id: escola.id, tipo: `addon_${extra.unidade}`,
      descricao: `Contratação: ${extra.nome} — R$ ${extra.preco}/mês. ${extra.descricao}`,
      valor_estimado: extra.preco, recorrente: extra.recorrente,
      quantidade: extra.quantidade, preco_unitario: extra.preco / extra.quantidade,
      solicitado_por: gerente?.nome || "Gerente", solicitado_por_email: gerente?.email,
    });
    return ok({ success: true });
  }

  if (action === "financeiro_wa_consumo") {
    const mes = new Date().getMonth() + 1;
    const ano = new Date().getFullYear();
    const { data } = await admin.from("wa_consumo_mensal").select("*").eq("mes", mes).eq("ano", ano).limit(1).single();
    const { data: alertas } = await admin.from("wa_consumo_alertas").select("*").order("criado_em", { ascending: false }).limit(10);
    return ok({ consumo: data, alertas: alertas ?? [] });
  }

  // ── Contratos Digitais ──────────────────────────────────────
  if (action === "contrato_templates_list") {
    const { data } = await admin.from("contrato_templates").select("*").eq("ativo", true).order("nome");
    return ok(data ?? []);
  }

  if (action === "contrato_template_create") {
    const { nome, tipo, html_template, variaveis } = body as any;
    if (!nome || !html_template) return err("nome e html_template obrigatórios.");
    const { data, error } = await admin.from("contrato_templates").insert({ nome, tipo: tipo || 'matricula', html_template, variaveis: variaveis || [] }).select().single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok(data);
  }

  if (action === "contrato_template_update") {
    const { id, nome, html_template, variaveis, ativo } = body as any;
    if (!id) return err("id obrigatório.");
    const fields: any = {};
    if (nome !== undefined) fields.nome = nome;
    if (html_template !== undefined) fields.html_template = html_template;
    if (variaveis !== undefined) fields.variaveis = variaveis;
    if (ativo !== undefined) fields.ativo = ativo;
    const { error } = await admin.from("contrato_templates").update(fields).eq("id", id);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  if (action === "contrato_gerar") {
    const { template_id, familia_email, familia_nome, dados, matricula_id } = body as any;
    if (!template_id || !familia_email) return err("template_id e familia_email obrigatórios.");

    // Get template
    const { data: tpl } = await admin.from("contrato_templates").select("*").eq("id", template_id).single();
    if (!tpl) return err("Template não encontrado.", 404);

    // Render HTML with variables
    let html = tpl.html_template;
    const vars = dados || {};
    vars.familia_nome = familia_nome || vars.familia_nome || '';
    vars.familia_email = familia_email;
    vars.data_hoje = new Date().toLocaleDateString('pt-BR');
    vars.ano_letivo = new Date().getFullYear().toString();
    for (const [key, val] of Object.entries(vars)) {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
    }

    const { data: contrato, error } = await admin.from("contratos").insert({
      template_id, familia_email: familia_email.toLowerCase().trim(),
      familia_nome: familia_nome || '', matricula_id: matricula_id || null,
      dados_preenchidos: vars, html_renderizado: html, status: 'rascunho',
    }).select().single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok(contrato);
  }

  if (action === "contrato_enviar") {
    const { id } = body as any;
    if (!id) return err("id obrigatório.");
    const { error } = await admin.from("contratos").update({ status: 'enviado', enviado_em: new Date().toISOString() }).eq("id", id);
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    // TODO: send email notification to familia
    return ok({ success: true });
  }

  if (action === "contratos_list") {
    const { data } = await admin.from("contratos").select("*, contrato_templates(nome, tipo), contrato_assinaturas(id, tipo, nome_signatario, assinado_em)").order("criado_em", { ascending: false });
    return ok(data ?? []);
  }

  if (action === "contrato_delete") {
    const { id } = body as any;
    const { data: c } = await admin.from("contratos").select("status").eq("id", id).single();
    if (c?.status === 'assinado') return err("Contrato assinado não pode ser excluído.");
    await admin.from("contratos").delete().eq("id", id);
    return ok({ success: true });
  }

  return err("Ação desconhecida.");
});
