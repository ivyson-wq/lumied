// Auto-extraído do api/index.ts (Onda 3 do refator).
// Bloco PÚBLICO preservado verbatim — vars `req`/`admin`/`body`/`action`/`ip`/`ok`/`err`/`cors`/
// `PUBLIC_CACHE` vêm do ctx desestruturado abaixo. Returns Response quando uma
// action matcha; null pra fall-through.
import {
  generateChallenge, verifyRegistration, verifyAuthentication, b64urlEncode,
  getModulosHabilitados, getEscolaPadrao,
  resolveEscolaId,
  checkRateLimit, checkRateLimitDb, getClientIP,
  sanitizeBody, getCorsHeaders, createLogger,
  hashSenhaV1 as hashSenha, hashSenha as hashSenhaProf, verificarSenhaAuto, gerarToken, validarSessao as _validarSessao,
  resolveUsuario, sanitizePgError, logAudit, isFlagOn,
  cacheGet, cacheSet,
} from "../../_shared/mod.ts";
import { askClaude, askClaudeWithTools, SYSTEM_PROMPTS } from "../../_shared/ai.ts";
import { McpServer } from "../../_shared/mcp.ts";
import { gerenteTools } from "../../mcp/tools_gerente.ts";
import { createCalendarEvent } from "../../_shared/gcal.ts";
import { type Any, type BaseCtx, escapeHtml, sanitizeHeaderValue, sha256Hex, sanitizeForPrompt, timingSafeEqual, validarSessao } from "../_lib.ts";

const log = createLogger("api");

// LAP: mapeia papeis[] do usuário pra persona do LHS.
// Mesma precedência da edge function track-event e do handler de api/handlers/auth.ts.
function inferLapPersona(papeis: unknown): string {
  if (!Array.isArray(papeis)) return "sistema";
  const set = new Set(papeis.map(String));
  if (set.has("diretor")) return "diretor";
  if (set.has("financeiro")) return "financeiro";
  if (set.has("comercial")) return "comercial";
  if (set.has("nutricionista")) return "nutricionista";
  if (set.has("almoxarifado")) return "almoxarife";
  if (set.has("manutencao")) return "manutencao";
  if (set.has("impressao")) return "impressao";
  if (set.has("coord_pedagogico")) return "coord_pedagogico";
  if (set.has("professora_assistente")) return "professora_assistente";
  if (set.has("professora")) return "professora";
  if (set.has("secretaria")) return "secretaria";
  if (set.has("gerente")) return "diretor";
  return "sistema";
}

export async function handle(ctx: BaseCtx): Promise<Response | null> {
  const { req, admin, body, action, ip, ok, err, cors: CORS, PUBLIC_CACHE } = ctx;
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
    const escolaIdAdmin = await resolveEscolaId(req, admin, null, body)
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
    const escolaIdAdmin = await resolveEscolaId(req, admin, null, body)
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

  // ═══════════════════════════════════════════════════════════
  //  LAP — Redeem de Magic Link (Sprint 10, PÚBLICO)
  //  Aceita token de convite, cria/encontra usuário + sessão.
  // ═══════════════════════════════════════════════════════════
  if (action === "lap_invite_redeem") {
    const { token: inviteToken, senha_inicial } = body as { token?: string; senha_inicial?: string };
    if (!inviteToken || inviteToken.length < 20) return err("Token inválido.", 400);

    const { data: link } = await admin.from("lap_magic_links")
      .select("token, escola_id, email, nome, papel, canal, expira_em, usado_em")
      .eq("token", inviteToken)
      .maybeSingle();
    if (!link) return err("Convite não encontrado.", 404);
    if (link.usado_em) return err("Convite já foi usado. Faça login normal ou solicite outro convite.", 410, "INVITE_USED");
    if (new Date(link.expira_em) < new Date()) return err("Convite expirado. Solicite um novo.", 410, "INVITE_EXPIRED");

    // Procura ou cria usuário
    const emailNorm = (link.email as string).toLowerCase().trim();
    let { data: existing } = await admin.from("usuarios")
      .select("id, nome, papeis")
      .eq("email", emailNorm)
      .eq("escola_id", link.escola_id)
      .maybeSingle();

    let usuarioId: string;
    if (existing) {
      usuarioId = (existing as any).id;
      // Adiciona o papel se não tinha
      const papeisAtuais: string[] = (existing as any).papeis || [];
      if (!papeisAtuais.includes(link.papel as string)) {
        await admin.from("usuarios").update({
          papeis: [...papeisAtuais, link.papel],
        }).eq("id", usuarioId);
      }
    } else {
      // Cria usuário sem senha (passwordless inicial)
      const senhaHash = senha_inicial ? await hashSenhaProf(senha_inicial as string) : null;
      const { data: novo, error: novoErr } = await admin.from("usuarios").insert({
        nome: link.nome || emailNorm.split('@')[0],
        email: emailNorm,
        papel: link.papel,
        papeis: [link.papel],
        escola_id: link.escola_id,
        senha_hash: senhaHash,
        ativo: true,
      }).select("id").single();
      if (novoErr || !novo) return err(sanitizePgError(novoErr ?? new Error("Falha ao criar usuário.")));
      usuarioId = novo.id;
    }

    // Cria sessão unificada
    const tk = gerarToken();
    const { error: sessErr } = await admin.from("sessoes").insert({
      usuario_id: usuarioId,
      token: tk,
      usuario_tipo: link.papel,
      expira_em: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    if (sessErr) return err("Não foi possível criar a sessão.", 500, "AUTH_SESSION_FAILED");

    // Marca link como usado
    await admin.from("lap_magic_links")
      .update({ usado_em: new Date().toISOString(), usuario_id: usuarioId })
      .eq("token", inviteToken);

    // Resolve slug da escola
    const { data: escola } = await admin.from("escolas")
      .select("slug, subdominio, nome")
      .eq("id", link.escola_id)
      .maybeSingle();
    const slug = (escola as any)?.subdominio || (escola as any)?.slug || null;

    // LAP: convite aceito (alimenta checklist + LHS)
    try {
      const { trackEvent } = await import("../../_shared/track.ts");
      trackEvent(admin, {
        escola_id: link.escola_id,
        user_id: usuarioId,
        event_name: "onboarding.convite.aceito",
        module: "onboarding",
        persona: inferLapPersona([link.papel]),
        payload: { canal: link.canal, papel: link.papel },
        idempotency_key: `invite-aceito:${inviteToken}`,
      });
    } catch (_) { /* silent */ }

    return ok({
      token: tk,
      papel: link.papel,
      email: emailNorm,
      nome: (existing as any)?.nome ?? link.nome ?? emailNorm.split('@')[0],
      escola_slug: slug,
      escola_nome: (escola as any)?.nome,
    });
  }

  // ── Login Família por email+senha (alternativa ao magic link) ──
  if (action === "familia_login") {
    const email = ((body.email as string) || "").toLowerCase().trim();
    const senha = (body.senha as string) || "";
    if (!email || !senha) return err("E-mail e senha são obrigatórios.");

    const rlFam = checkRateLimit(email, "login");
    if (!rlFam.allowed) return err(`Tente novamente em ${rlFam.retryAfterSeconds}s.`, 429);

    const escolaId = await resolveEscolaId(req, admin, null, body);
    const { data: familia } = await admin
      .from("familias")
      .select("id, nome_responsavel, email, senha_hash, escola_id")
      .eq("email", email)
      .eq("escola_id", escolaId)
      .maybeSingle();

    if (!familia || !familia.senha_hash) return err("E-mail ou senha incorretos.");
    if (!(await verificarSenhaAuto(senha, familia.senha_hash))) return err("E-mail ou senha incorretos.");

    // 1º login? Checa se já existem sessoes prévias dessa família.
    const { count: prevSessoes } = await admin
      .from("familia_sessoes")
      .select("*", { count: "exact", head: true })
      .eq("familia_id", familia.id);
    const isFirstLogin = (prevSessoes ?? 0) === 0;

    const token = gerarToken();
    await admin.from("familia_sessoes").insert({
      familia_id: familia.id,
      token,
      expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // LAP: cobertura de stakeholders 'pais' + convite aceito (onboarding) no 1º login
    try {
      const { trackEvents } = await import("../../_shared/track.ts");
      const evs: any[] = [{
        escola_id: familia.escola_id,
        user_id: familia.id,
        event_name: "auth.user.logged_in",
        module: "auth",
        persona: "pais",
        payload: { sessao_table: "familia_sessoes" },
      }];
      if (isFirstLogin) {
        evs.push({
          escola_id: familia.escola_id,
          user_id: familia.id,
          event_name: "pais.convite.aceito",
          module: "onboarding",
          persona: "pais",
          payload: { canal: "email_senha" },
          idempotency_key: `pai-convite:${familia.id}`,
        });
      }
      trackEvents(admin, evs);
    } catch (_) { /* silent */ }

    return ok({ token, nome: familia.nome_responsavel || "Família", email: familia.email });
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
    const escolaIdCfg = await resolveEscolaId(req, admin, null, body);
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
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("[magic-link] Resend error:", resp.status, errBody);
      return err("Erro ao enviar e-mail. Tente novamente.");
    }
    return ok({ sent: true });
  }

  // ── Auto-cadastro de aluno (público) — Mig 295 ──
  if (action === "aluno_solicitar_acesso") {
    const aluno_nome = String((body.aluno_nome as string) || '').trim();
    const aluno_email = String((body.aluno_email as string) || '').toLowerCase().trim();
    const serie = String((body.serie as string) || '').trim();
    const responsavel_nome = String((body.responsavel_nome as string) || '').trim();
    const responsavel_email = String((body.responsavel_email as string) || '').toLowerCase().trim();

    if (!aluno_nome || aluno_nome.length < 3) return err("Informe seu nome completo.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(aluno_email)) return err("E-mail do aluno inválido.");
    if (responsavel_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsavel_email)) return err("E-mail do responsável inválido.");
    if (!serie) return err("Informe sua turma/série.");

    // Resolve escola via Origin (subdomain). Sem escola, não dá pra continuar.
    const escolaSol = await resolveEscolaId(req, admin, null, body);
    if (!escolaSol) return err("Não foi possível identificar a escola. Acesse pelo subdomínio da sua escola.", 400);

    // Bloqueia se email do aluno já é usuário do sistema (qualquer papel).
    const { data: jaUser } = await admin.from("usuarios").select("id").eq("email", aluno_email).maybeSingle();
    if (jaUser) return err("Este e-mail já tem acesso à plataforma. Use o login normal.");

    // Bloqueia se já há solicitação pendente/aprovada com esse email nessa escola (índice único cobre, mas resposta amigável).
    const { data: jaSol } = await admin.from("aluno_solicitacoes_acesso")
      .select("id, status").eq("aluno_email", aluno_email).eq("escola_id", escolaSol)
      .in("status", ["pendente", "aprovado"]).maybeSingle();
    if (jaSol) {
      const msg = (jaSol as any).status === "pendente"
        ? "Sua solicitação já está em análise. Você receberá um e-mail quando a escola aprovar."
        : "Este e-mail já foi aprovado. Verifique sua caixa de entrada.";
      return err(msg, 409);
    }

    const { data: ins, error: insErr } = await admin.from("aluno_solicitacoes_acesso").insert({
      escola_id: escolaSol,
      aluno_nome, aluno_email, serie,
      responsavel_nome: responsavel_nome || null,
      responsavel_email: responsavel_email || null,
      ip_origem: ip,
    }).select("id").single();
    if (insErr) return err("Erro ao registrar solicitação: " + sanitizePgError(insErr));

    return ok({ ok: true, id: (ins as any).id, msg: "Solicitação enviada. Você receberá um e-mail quando a escola aprovar seu acesso." });
  }

  // ── Listagem de solicitações (gerente/secretaria) ──
  if (action === "aluno_solicitacoes_list") {
    const tk = (body._token as string) || '';
    const sessao = await validarSessao(admin, tk);
    if (!sessao) return err("Sessão inválida.", 401);
    const escolaList = (sessao as any).escola_id || (await resolveEscolaId(req, admin, null, body));
    if (!escolaList) return err("Escola não resolvida.", 400);

    const { data: solRows } = await admin.from("aluno_solicitacoes_acesso")
      .select("id, aluno_nome, aluno_email, serie, responsavel_nome, responsavel_email, status, motivo_rejeicao, criado_em, decidido_em")
      .eq("escola_id", escolaList).order("criado_em", { ascending: false }).limit(200);
    const sols = (solRows || []) as any[];

    // Heurísticas de match (só pra pendentes — economiza queries).
    const pendentes = sols.filter(s => s.status === 'pendente');
    if (pendentes.length) {
      const respEmails = [...new Set(pendentes.map(s => s.responsavel_email).filter(Boolean))];
      const alunoNomes = [...new Set(pendentes.map(s => s.aluno_nome))];
      const [{ data: famsMatch }, { data: alunosMatch }] = await Promise.all([
        respEmails.length
          ? admin.from("familias").select("email, nome_aluno").eq("escola_id", escolaList).in("email", respEmails)
          : Promise.resolve({ data: [] }),
        alunoNomes.length
          ? admin.from("alunos").select("nome, familia_email").eq("escola_id", escolaList)
          : Promise.resolve({ data: [] }),
      ]);
      const famSet = new Set((famsMatch || []).map((f: any) => f.email));
      const alunoSet = new Set((alunosMatch || []).map((a: any) => (a.nome || '').toLowerCase().trim()));
      for (const s of pendentes) {
        s.match_responsavel = !!(s.responsavel_email && famSet.has(s.responsavel_email));
        s.match_aluno = alunoSet.has((s.aluno_nome || '').toLowerCase().trim());
      }
    }

    const counts = sols.reduce((acc: any, s: any) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {});
    return ok({ solicitacoes: sols, counts });
  }

  // ── Aprovar solicitação (gerente) ──
  if (action === "aluno_solicitacao_aprovar") {
    const tk = (body._token as string) || '';
    const sessao = await validarSessao(admin, tk);
    if (!sessao) return err("Sessão inválida.", 401);
    const id = String((body.id as string) || '').trim();
    if (!id) return err("id obrigatório.");

    const { data: sol } = await admin.from("aluno_solicitacoes_acesso").select("*").eq("id", id).maybeSingle();
    if (!sol) return err("Solicitação não encontrada.", 404);
    if ((sol as any).status !== 'pendente') return err("Solicitação já decidida.", 409);

    // Cria alunos_login (senha vazia — login será via magic link). Trigger Mig 294
    // sincroniza pra usuarios.papeis += 'aluno' automaticamente.
    const { error: alErr } = await admin.from("alunos_login").insert({
      aluno_nome: (sol as any).aluno_nome,
      email: (sol as any).aluno_email,
      familia_email: (sol as any).responsavel_email || null,
      serie: (sol as any).serie || null,
      senha_hash: '',
      ativo: true,
    });
    if (alErr && !String(alErr.message).includes("duplicate")) {
      return err("Erro ao criar acesso: " + sanitizePgError(alErr));
    }

    await admin.from("aluno_solicitacoes_acesso").update({
      status: 'aprovado', decidido_por: (sessao as any).id || null, decidido_em: new Date().toISOString(),
    }).eq("id", id);

    // Dispara magic link branded com o template padrão.
    try {
      const { data: linkData } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: (sol as any).aluno_email,
        options: { redirectTo: `https://${(req.headers.get("host") || "")}/familia.html` },
      });
      const magicUrl = (linkData as any)?.properties?.action_link || '';
      const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
      if (magicUrl && RESEND_KEY) {
        const { data: cfgRows } = await admin.from("escola_config").select("chave, valor").eq("escola_id", (sol as any).escola_id);
        const cfg: Record<string, string> = {};
        for (const r of cfgRows ?? []) cfg[r.chave] = typeof r.valor === "string" ? r.valor.replace(/^"|"$/g, "") : (r.valor ?? "");
        const escolaNome = cfg.escola_nome || "Escola";
        const cor = cfg.cor_primaria || "#C8102E";
        const html = `
          <div style="font-family:'Segoe UI',Tahoma,sans-serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#fff;">
            <h2 style="color:${escapeHtml(cor)};margin:0 0 8px;font-size:20px;">Seu acesso foi aprovado!</h2>
            <p style="color:#888;font-size:12px;margin:0 0 18px;">${escapeHtml(escolaNome)} · by Lumied</p>
            <p style="font-size:14px;color:#333;line-height:1.6;">Olá, ${escapeHtml((sol as any).aluno_nome)}! A escola aprovou seu acesso ao portal. Clique abaixo para entrar:</p>
            <div style="text-align:center;margin:18px 0;">
              <a href="${escapeHtml(magicUrl)}" style="display:inline-block;padding:14px 32px;background:${escapeHtml(cor)};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Acessar portal</a>
            </div>
            <p style="font-size:11px;color:#aaa;text-align:center;">Link válido por 1 hora. Se expirar, peça um novo na tela de login.</p>
          </div>`;
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
          body: JSON.stringify({
            from: `${sanitizeHeaderValue(escolaNome) || 'Lumied'} <onboarding@resend.dev>`,
            to: [(sol as any).aluno_email],
            subject: `Acesso aprovado · ${sanitizeHeaderValue(escolaNome) || 'Lumied'}`,
            html,
          }),
          signal: AbortSignal.timeout(8000),
        });
      }
    } catch (e) {
      console.warn('[aluno_aprovar] magic link send failed:', (e as Error).message);
    }

    return ok({ ok: true });
  }

  // ── Rejeitar solicitação (gerente) ──
  if (action === "aluno_solicitacao_rejeitar") {
    const tk = (body._token as string) || '';
    const sessao = await validarSessao(admin, tk);
    if (!sessao) return err("Sessão inválida.", 401);
    const id = String((body.id as string) || '').trim();
    const motivo = String((body.motivo as string) || '').trim();
    const motivoLivre = String((body.motivo_livre as string) || '').trim();
    if (!id) return err("id obrigatório.");

    const motivosValidos: Record<string, string> = {
      email_em_uso: "Este e-mail já está vinculado a outra conta. Use outro e-mail.",
      nao_pertence: "Não localizamos seu cadastro nesta escola. Confirme com a secretaria.",
      dados_inconsistentes: "Os dados informados não conferem com nosso cadastro. Tente novamente com os dados corretos.",
      outro: motivoLivre || "Solicitação não aprovada. Entre em contato com a secretaria da escola.",
    };
    if (!motivosValidos[motivo]) return err("Motivo inválido.");

    const { data: sol } = await admin.from("aluno_solicitacoes_acesso").select("*").eq("id", id).maybeSingle();
    if (!sol) return err("Solicitação não encontrada.", 404);
    if ((sol as any).status !== 'pendente') return err("Solicitação já decidida.", 409);

    const motivoMsg = motivosValidos[motivo];
    await admin.from("aluno_solicitacoes_acesso").update({
      status: 'rejeitado',
      motivo_rejeicao: motivo === 'outro' ? `outro: ${motivoLivre}` : motivo,
      decidido_por: (sessao as any).id || null,
      decidido_em: new Date().toISOString(),
    }).eq("id", id);

    // Email padronizado pro aluno.
    try {
      const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
      if (RESEND_KEY) {
        const { data: cfgRows } = await admin.from("escola_config").select("chave, valor").eq("escola_id", (sol as any).escola_id);
        const cfg: Record<string, string> = {};
        for (const r of cfgRows ?? []) cfg[r.chave] = typeof r.valor === "string" ? r.valor.replace(/^"|"$/g, "") : (r.valor ?? "");
        const escolaNome = cfg.escola_nome || "Escola";
        const html = `
          <div style="font-family:'Segoe UI',Tahoma,sans-serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#fff;">
            <h2 style="margin:0 0 8px;font-size:20px;">Solicitação de acesso</h2>
            <p style="color:#888;font-size:12px;margin:0 0 18px;">${escapeHtml(escolaNome)} · by Lumied</p>
            <p style="font-size:14px;color:#333;line-height:1.6;">Olá, ${escapeHtml((sol as any).aluno_nome)}.</p>
            <p style="font-size:14px;color:#333;line-height:1.6;">${escapeHtml(motivoMsg)}</p>
            <p style="font-size:13px;color:#666;line-height:1.6;margin-top:18px;">Se acreditar que houve um engano, fale com a secretaria da escola.</p>
          </div>`;
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
          body: JSON.stringify({
            from: `${sanitizeHeaderValue(escolaNome) || 'Lumied'} <onboarding@resend.dev>`,
            to: [(sol as any).aluno_email],
            subject: `Solicitação de acesso · ${sanitizeHeaderValue(escolaNome) || 'Lumied'}`,
            html,
          }),
          signal: AbortSignal.timeout(8000),
        });
      }
    } catch (e) {
      console.warn('[aluno_rejeitar] email failed:', (e as Error).message);
    }

    return ok({ ok: true });
  }

  // ── Resolução de papéis do usuário autenticado (família/aluno) ──
  // Usado pelo familia.html pra aplicar RBAC frontend (esconder abas quando aluno-only).
  if (action === "me_papeis") {
    const tk = (body._token as string) || "";
    if (!tk) return ok({ papeis: [], aluno_only: false, logged: false });
    try {
      const { data: { user } } = await admin.auth.getUser(tk);
      if (!user?.email) return ok({ papeis: [], aluno_only: false, logged: false });
      const email = user.email.toLowerCase().trim();
      const { data: u } = await admin.from("usuarios")
        .select("papeis, escola_id, nome").eq("email", email).maybeSingle();
      const papeis: string[] = Array.isArray((u as any)?.papeis) ? (u as any).papeis : [];
      const aluno_only = papeis.includes("aluno") && papeis.length === 1;
      return ok({
        papeis, aluno_only, logged: true, email,
        nome: (u as any)?.nome ?? null,
        escola_id: (u as any)?.escola_id ?? null,
      });
    } catch {
      return ok({ papeis: [], aluno_only: false, logged: false });
    }
  }

  // ── Bootstrap do hub (área-restrita): config + módulos + whoami em 1 request ──
  if (action === "hub_bootstrap") {
    const tokens: string[] = Array.isArray(body._tokens) ? (body._tokens as string[]).filter(Boolean) : [];
    const escolaIdHub = await resolveEscolaId(req, admin, null, body);
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
    const selfToken = (body._token as string) || req.headers.get("authorization")?.replace("Bearer ", "") || null;
    const gerente = await validarSessao(admin, selfToken);
    if (!gerente) return err("Sessão inválida.", 401);
    const escolaId = (gerente as any).escola_id;
    if (!escolaId) return err("Sessão sem escola associada.", 403);
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
    const escolaId = (gerente as any).escola_id;
    if (!escolaId) return err("Sessão sem escola associada.", 403);
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

    // Compute etapas automáticas (derivadas de dados reais — TODAS escopadas por escola_id)
    const [{ count: alunosN }, { count: profsN }, { count: mensN }, { count: comunicN }] = await Promise.all([
      admin.from("alunos").select("*", { count: 'exact', head: true }).eq("escola_id", escolaId),
      admin.from("professoras").select("*", { count: 'exact', head: true }).eq("escola_id", escolaId),
      admin.from("fin_mensalidades").select("*", { count: 'exact', head: true }).eq("escola_id", escolaId),
      admin.from("comunicados").select("*", { count: 'exact', head: true }).eq("escola_id", escolaId).catch(() => ({ count: 0 })),
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
    const escolaId = (gerente as any).escola_id;
    if (!escolaId) return err("Sessão sem escola associada.", 403);
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
    const escolaId = (gerente as any).escola_id;
    if (!escolaId) return err("Sessão sem escola associada.", 403);
    await admin.from("escolas").update({ onboarding_dismissed_em: new Date().toISOString() }).eq("id", escolaId);
    return ok({ success: true });
  }

  if (action === "config_publica") {
    const escolaIdPub = await resolveEscolaId(req, admin, null, body)
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

  // Login — gerente: derivar escola via Origin para evitar colisão de email cross-tenant
  if (action === "login") {
    const { email, senha } = body as { email: string; senha: string };
    if (!email || !senha) return err("E-mail e senha são obrigatórios.", 400, "VALIDATION_FAILED");
    const rlLogin = checkRateLimit(email || ip, "login");
    if (!rlLogin.allowed) return err(`Muitas tentativas de login. Tente em ${rlLogin.retryAfterSeconds}s.`, 429, "RATE_LIMITED");
    const escolaIdLogin = await resolveEscolaId(req, admin, null, body);
    // Busca gerente no escopo da escola (Origin) se disponível; senão busca globalmente
    // (permite login em domínio customizado/dev). Single-tenant legado preservado via null.
    let q = admin.from("gerentes").select("id, nome, email, senha_hash, escola_id").eq("email", email);
    if (escolaIdLogin) q = q.eq("escola_id", escolaIdLogin);
    const { data: matches } = await q.limit(2);
    // Se multi-match sem Origin: não podemos decidir qual escola — erro genérico
    if (matches && matches.length > 1) {
      console.warn("[login] multiple gerentes com email", { email, n: matches.length });
      return err("E-mail ou senha incorretos.", 401, "AUTH_BAD_CREDENTIALS");
    }
    if (matches?.length) {
      const g = matches[0];
      const ok2 = await verificarSenhaAuto(senha as string, g.senha_hash);
      if (!ok2) return err("E-mail ou senha incorretos.", 401, "AUTH_BAD_CREDENTIALS");
      await admin.from("gerente_sessoes").delete().lt("expira_em", new Date().toISOString());
      const { data: sessao, error: sErr } = await admin.from("gerente_sessoes").insert({ gerente_id: g.id }).select().single();
      if (sErr || !sessao?.token) {
        console.error("[auth] gerente login AUTH_SESSION_FAILED", { email, err: sErr });
        return err("Não foi possível criar a sessão. Tente novamente.", 500, "AUTH_SESSION_FAILED");
      }
      // Fetch papeis from usuarios table for role-based gating
      const { data: uPapeis } = await admin.from("usuarios").select("papeis").eq("email", email).eq("escola_id", g.escola_id).maybeSingle();
      const papeis = uPapeis?.papeis || ["gerente"];

      // LAP: stakeholders + adoção dashboard
      try {
        const { trackEvent } = await import("../../_shared/track.ts");
        const persona = inferLapPersona(papeis);
        trackEvent(admin, {
          escola_id: g.escola_id,
          user_id: g.id,
          event_name: "auth.user.logged_in",
          module: "auth",
          persona,
          payload: { sessao_table: "gerente_sessoes" },
        });
      } catch (_) { /* silent */ }

      return ok({ token: sessao.token, nome: g.nome, email: g.email, papeis });
    }
    // Fallback: busca na tabela unificada usuarios (apenas comercial pode acessar CRM)
    const allowedLoginRoles = ["comercial"];
    let qu = admin.from("usuarios").select("id, nome, email, senha_hash, escola_id, papeis").eq("email", email).eq("ativo", true);
    if (escolaIdLogin) qu = qu.eq("escola_id", escolaIdLogin);
    const { data: uMatches } = await qu.limit(2);
    if (!uMatches?.length) return err("E-mail ou senha incorretos.", 401, "AUTH_BAD_CREDENTIALS");
    if (uMatches.length > 1) {
      console.warn("[login] multiple usuarios com email", { email, n: uMatches.length });
      return err("E-mail ou senha incorretos.", 401, "AUTH_BAD_CREDENTIALS");
    }
    const u = uMatches[0];
    const uRoles: string[] = u.papeis || [];
    if (!uRoles.some((r: string) => allowedLoginRoles.includes(r))) return err("E-mail ou senha incorretos.", 401, "AUTH_BAD_CREDENTIALS");
    if (!u.senha_hash) return err("Senha não cadastrada. Solicite ao gestor.", 401, "AUTH_NO_PASSWORD");
    const ok3 = await verificarSenhaAuto(senha as string, u.senha_hash);
    if (!ok3) return err("E-mail ou senha incorretos.", 401, "AUTH_BAD_CREDENTIALS");
    const { data: uSessao, error: uSErr } = await admin.from("sessoes").insert({ usuario_id: u.id, usuario_tipo: uRoles[0] }).select("token").single();
    if (uSErr || !uSessao?.token) {
      console.error("[auth] usuario login AUTH_SESSION_FAILED", { email, err: uSErr });
      return err("Não foi possível criar a sessão. Tente novamente.", 500, "AUTH_SESSION_FAILED");
    }

    // LAP: cobertura de personas operacionais (comercial etc.)
    try {
      const { trackEvent } = await import("../../_shared/track.ts");
      trackEvent(admin, {
        escola_id: u.escola_id,
        user_id: u.id,
        event_name: "auth.user.logged_in",
        module: "auth",
        persona: inferLapPersona(uRoles),
        payload: { sessao_table: "sessoes" },
      });
    } catch (_) { /* silent */ }

    return ok({ token: uSessao.token, nome: u.nome, email: u.email });
  }

  // Logout
  if (action === "logout") {
    const logoutToken = (body._token as string) || req.headers.get("authorization")?.replace("Bearer ", "");
    if (logoutToken) await admin.from("gerente_sessoes").delete().eq("token", logoutToken);
    return ok({ success: true });
  }

  // WebAuthn login (público) — escopado por Origin
  if (action === "webauthn_login_challenge") {
    const { email, rp_id } = body as { email: string; rp_id: string };
    if (!email || !rp_id) return err("email e rp_id obrigatórios.", 400);
    const escolaIdWA = await resolveEscolaId(req, admin, null, body);
    let q = admin.from("gerentes").select("id").eq("email", email);
    if (escolaIdWA) q = q.eq("escola_id", escolaIdWA);
    const { data: g } = await q.maybeSingle();
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
      const { data: g } = await admin.from("gerentes").select("nome, email, escola_id, papeis").eq("id", cred.usuario_id).maybeSingle();
      if (!g) return err("Gerente não encontrado.", 404);
      const { data: sess, error: sErr } = await admin.from("gerente_sessoes").insert({ gerente_id: cred.usuario_id }).select("token").single();
      if (sErr || !sess?.token) {
        console.error("[auth] webauthn gerente AUTH_SESSION_FAILED", { user: cred.usuario_id, err: sErr });
        return err("Não foi possível criar a sessão.", 500, "AUTH_SESSION_FAILED");
      }

      // LAP: webauthn login emite stakeholder logado
      try {
        const { trackEvent } = await import("../../_shared/track.ts");
        trackEvent(admin, {
          escola_id: (g as any).escola_id,
          user_id: cred.usuario_id,
          event_name: "auth.user.logged_in",
          module: "auth",
          persona: inferLapPersona((g as any).papeis),
          payload: { sessao_table: "gerente_sessoes", via: "webauthn" },
        });
      } catch (_) { /* silent */ }
      return ok({ token: sess.token, nome: g.nome, email: g.email });
    } catch (e) { return err("Verificação falhou: " + (e as Error).message, 400); }
  }

  // Leitura pública de séries (para o formulário) — resolve escola via Origin
  if (action === "series_list") {
    const origin = req.headers.get("origin") || req.headers.get("referer") || "";
    const m = origin.match(/https?:\/\/([a-z0-9-]+)\.lumied\.com\.br/i);
    const subdominio = m?.[1];
    let escolaIdPub: string | null = null;
    if (subdominio && subdominio !== 'www') {
      const { data: esc } = await admin.from("escolas").select("id").eq("slug", subdominio).eq("ativo", true).maybeSingle();
      escolaIdPub = (esc as any)?.id || null;
    }
    if (!escolaIdPub) return err("Escola não identificada.", 400);
    const { data } = await admin.from("series").select("*").eq("escola_id", escolaIdPub).eq("ativo", true).order("ordem");
    return ok(data ?? []);
  }

  // Leitura pública de atividades (para o formulário) — escopado via Origin
  if (action === "atividades_list") {
    const origin = req.headers.get("origin") || req.headers.get("referer") || "";
    const m = origin.match(/https?:\/\/([a-z0-9-]+)\.lumied\.com\.br/i);
    const subdominio = m?.[1];
    let escolaIdPub: string | null = null;
    if (subdominio && subdominio !== 'www') {
      const { data: esc } = await admin.from("escolas").select("id").eq("slug", subdominio).eq("ativo", true).maybeSingle();
      escolaIdPub = (esc as any)?.id || null;
    }
    if (!escolaIdPub) return err("Escola não identificada.", 400);
    const { data: atividades } = await admin.from("atividades").select("*").eq("escola_id", escolaIdPub).eq("ativo", true).order("ordem");
    if (!atividades?.length) return ok([]);

    // Busca turmas_selecionadas dos alunos para contar por atividade+turma (da mesma escola)
    const { data: alunosAtiv } = await admin.from("alunos").select("turmas_selecionadas").eq("escola_id", escolaIdPub).not("turmas_selecionadas", "is", null);

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
    // Deriva escola via Origin para escopar o pais-portal corretamente
    const escolaIdPais = await resolveEscolaId(req, admin, null, body);
    if (!escolaIdPais) return err("Escola não identificada (Origin).", 400);
    // Run two separate queries (email match + familia_email match) and merge in code
    const alunoCols = "id, nome, email, serie, turma, responsavel_nome, resp_nome, atividades_ids, turmas_selecionadas, almoco_dias, criado_em";
    const [solicitacoes, alunosA, alunosB, ausencias] = await Promise.all([
      admin.from("solicitacoes").select("*").eq("escola_id", escolaIdPais).eq("email", email).order("criado_em", { ascending: false }),
      admin.from("alunos").select(alunoCols).eq("escola_id", escolaIdPais).eq("email", email).not("atividades_ids", "is", null),
      admin.from("alunos").select(alunoCols).eq("escola_id", escolaIdPais).eq("familia_email", email).not("atividades_ids", "is", null),
      admin.from("ausencias").select("*").eq("escola_id", escolaIdPais).eq("email_resp", email).gte("data_ausencia", new Date().toISOString().split("T")[0]),
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
    // Deriva escola_id via familia do responsável
    const { data: fam } = await admin.from("familias").select("escola_id").eq("email", email_resp).maybeSingle();
    if (!fam?.escola_id) return err("Responsável não encontrado.", 404);
    // Verifica se já existe ausência para esse dia e criança (escopada por escola)
    const { data: exist } = await admin.from("ausencias")
      .select("id").eq("email_resp", email_resp).eq("nome_crianca", nome_crianca as string).eq("data_ausencia", data_ausencia as string).eq("escola_id", fam.escola_id).maybeSingle();
    if (exist) return ok({ success: true, already: true });
    const { error } = await admin.from("ausencias").insert({ email_resp, nome_crianca, data_ausencia, tipo: tipo ?? "turno", observacao: observacao ?? null, escola_id: fam.escola_id });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // ── Comunicados dos pais (saída antecipada / atraso) ────
  if (action === "comunicado_justificativas_list") {
    const escolaIdC = await resolveEscolaId(req, admin, null, body);
    if (!escolaIdC) return err("Escola não identificada.", 400);
    const { data } = await admin.from("comunicados_justificativas")
      .select("id, label, requer_aprovacao, ordem")
      .eq("escola_id", escolaIdC).eq("ativa", true).order("ordem");
    return ok({ data: data ?? [] });
  }

  if (action === "comunicado_criar") {
    const { aluno_id, aluno_nome, responsavel_email, tipo, horario, justificativa_id, justificativa_livre } = body as Record<string, string>;
    if (!aluno_nome || !responsavel_email || !tipo || !horario) return err("Aluno, responsável, tipo e horário são obrigatórios.");
    if (!["saida_antecipada", "atraso"].includes(tipo)) return err("Tipo inválido.");
    const escolaIdC = await resolveEscolaId(req, admin, null, body);
    if (!escolaIdC) return err("Escola não identificada.", 400);
    // Decide status: se tem justificativa pré-cadastrada que NÃO requer aprovação, vai direto;
    // senão (justificativa livre OU justificativa que requer aprovação), fica pendente.
    let status = "aprovado";
    if (justificativa_id) {
      const { data: j } = await admin.from("comunicados_justificativas")
        .select("requer_aprovacao").eq("id", justificativa_id).eq("escola_id", escolaIdC).maybeSingle();
      if (!j) return err("Justificativa inválida.");
      if ((j as any).requer_aprovacao) status = "pendente";
    } else if (justificativa_livre) {
      status = "pendente";
    } else {
      return err("Selecione uma justificativa ou descreva o motivo.");
    }
    const ins: Record<string, unknown> = {
      escola_id: escolaIdC, aluno_id: aluno_id || null, aluno_nome, responsavel_email,
      tipo, horario, justificativa_id: justificativa_id || null,
      justificativa_livre: justificativa_livre || null, status,
    };
    if (status === "aprovado") ins.aprovado_em = new Date().toISOString();
    const { data: criado, error } = await admin.from("comunicados_pais").insert(ins).select("id").single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    // Notifica secretaria + (se aprovado) professora
    const titulo = status === "pendente" ? "📨 Comunicado pendente de aprovação" : "📢 Novo comunicado dos pais";
    const msg = `${aluno_nome} — ${tipo === "saida_antecipada" ? "saída antecipada" : "atraso"} às ${horario}.`;
    await admin.from("notificacoes").insert({
      portal: "secretaria", destinatario: "*", titulo, mensagem: msg, tipo: "info", escola_id: escolaIdC,
    });
    if (status === "aprovado") {
      await admin.from("notificacoes").insert({
        portal: "professora", destinatario: "*", titulo: "📢 Comunicado dos pais", mensagem: msg, tipo: "info", escola_id: escolaIdC,
      });
    }
    return ok({ success: true, id: (criado as any).id, status });
  }

  if (action === "comunicado_listar") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const status = (body as { status?: string }).status || null;
    let q = admin.from("comunicados_pais").select("*")
      .eq("escola_id", gerente.escola_id).order("criado_em", { ascending: false }).limit(200);
    if (status) q = q.eq("status", status);
    const { data } = await q;
    return ok({ data: data ?? [] });
  }

  if (action === "comunicado_aprovar" || action === "comunicado_rejeitar") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { id, nota } = body as { id: string; nota?: string };
    if (!id) return err("ID obrigatório.");
    const novoStatus = action === "comunicado_aprovar" ? "aprovado" : "rejeitado";
    const { data: com, error } = await admin.from("comunicados_pais").update({
      status: novoStatus, nota_aprovador: nota || null,
      aprovado_em: novoStatus === "aprovado" ? new Date().toISOString() : null,
      aprovador_id: gerente.id,
    }).eq("id", id).eq("escola_id", gerente.escola_id).select().maybeSingle();
    if (error) return err(sanitizePgError(error));
    if (novoStatus === "aprovado" && com) {
      await admin.from("notificacoes").insert({
        portal: "professora", destinatario: "*",
        titulo: "📢 Comunicado dos pais aprovado",
        mensagem: `${(com as any).aluno_nome} — ${(com as any).tipo === "saida_antecipada" ? "saída antecipada" : "atraso"} às ${(com as any).horario}.`,
        tipo: "info", escola_id: gerente.escola_id,
      });
    }
    return ok({ success: true });
  }

  // Remover ausência (criança vai comparecer afinal)
  if (action === "ausencia_delete") {
    const { id, email_resp } = body as { id: string; email_resp: string };
    if (!id || !email_resp) return err("ID e email_resp obrigatórios.");
    const escolaIdPais = await resolveEscolaId(req, admin, null, body);
    if (!escolaIdPais) return err("Escola não identificada.", 400);
    const { data: ausencia } = await admin.from("ausencias").select("id").eq("id", id).eq("escola_id", escolaIdPais).eq("email_resp", email_resp).maybeSingle();
    if (!ausencia) return err("Ausência não encontrada ou não pertence a este responsável.", 404);
    await admin.from("ausencias").delete().eq("id", id).eq("escola_id", escolaIdPais).eq("email_resp", email_resp);
    return ok({ success: true });
  }

  // Leitura pública de configurações (escopada por Origin para evitar cross-tenant)
  if (action === "config_get") {
    const { chave } = body as { chave: string };
    const escolaIdCfg = await resolveEscolaId(req, admin, null, body);
    if (!escolaIdCfg) {
      // Multi-tenant: tabela global `configuracoes` é descontinuada; retornar null em vez de leak
      return ok({ valor: null });
    }
    // Preferir escola_config (tenant-scoped); fallback para configuracoes legado
    const { data: ec } = await admin.from("escola_config").select("valor").eq("escola_id", escolaIdCfg).eq("chave", chave).maybeSingle();
    if (ec) return ok({ valor: (ec as any).valor ?? null });
    const { data } = await admin.from("configuracoes").select("valor").eq("chave", chave).maybeSingle();
    return ok({ valor: (data as any)?.valor ?? null });
  }

  // Envio público do formulário de turno — escopado por Origin
  if (action === "public_submit") {
    const { email, nome_resp, nome_crianca, serie, turno, dias_semana } = body as Record<string, unknown>;
    if (!email || !nome_resp || !nome_crianca || !turno) return err("Campos obrigatórios ausentes.");
    const escolaIdSub = await resolveEscolaId(req, admin, null, body);
    if (!escolaIdSub) return err("Escola não identificada.", 400);
    const { error } = await admin.from("solicitacoes").insert({ email, nome_resp, nome_crianca, serie, turno, dias_semana: dias_semana ?? null, escola_id: escolaIdSub });
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    return ok({ success: true });
  }

  // Inscrição pública em atividades — grava na tabela alunos
  // Inscrição em atividade — versão STAFF (gerente/secretaria), permite
  // selecionar aluno existente ou criar um novo no mesmo fluxo. Bypass do
  // requisito de família pré-cadastrada (a versão pública continua exigindo).
  if (action === "inscricao_atividade_admin") {
    if (!gerente?.escola_id) return err("Sessão sem escola associada.", 403);
    const { aluno_id, novo_aluno, atividades_ids, turmas_selecionadas } = body as {
      aluno_id?: string;
      novo_aluno?: { nome: string; responsavel_nome?: string; email?: string; serie?: string };
      atividades_ids: string[];
      turmas_selecionadas?: any[];
    };
    if (!Array.isArray(atividades_ids)) return err("atividades_ids obrigatório.");

    let alvoAlunoId = aluno_id;
    let antes: any = null;
    if (alvoAlunoId) {
      const { data: existente } = await admin.from("alunos")
        .select("id, nome, atividades_ids, turmas_selecionadas")
        .eq("id", alvoAlunoId).eq("escola_id", gerente.escola_id).maybeSingle();
      if (!existente) return err("Aluno não encontrado nesta escola.", 404);
      antes = existente;
    } else {
      if (!novo_aluno?.nome) return err("Forneça aluno_id ou novo_aluno.nome.");
      const { data: criado, error: errCria } = await admin.from("alunos").insert({
        escola_id: gerente.escola_id,
        nome: novo_aluno.nome.trim(),
        responsavel_nome: novo_aluno.responsavel_nome?.trim() || null,
        email: novo_aluno.email?.trim() || null,
        serie: novo_aluno.serie || null,
        ativo: true,
      }).select("id").single();
      if (errCria) return err(sanitizePgError(errCria));
      alvoAlunoId = (criado as any).id;

      // LAP: aluno matriculado via fluxo de inscrição (Aha academico)
      try {
        const { trackEvent } = await import("../../_shared/track.ts");
        trackEvent(admin, {
          escola_id: gerente.escola_id,
          user_id: gerente.id,
          event_name: "academico.aluno.matriculado",
          module: "academico",
          persona: "secretaria",
          payload: { aluno_id: alvoAlunoId, via: "lumied_atividades", serie: novo_aluno.serie },
          idempotency_key: `aluno-matric:${alvoAlunoId}`,
        });
      } catch (_) { /* silent */ }
    }

    const { error: errUpd } = await admin.from("alunos").update({
      atividades_ids,
      turmas_selecionadas: turmas_selecionadas ?? [],
    }).eq("id", alvoAlunoId).eq("escola_id", gerente.escola_id);
    if (errUpd) return err(sanitizePgError(errUpd));

    // Audit
    await admin.from("audit_log_cadastro").insert({
      escola_id: gerente.escola_id,
      entidade: "inscricao_atividade",
      entidade_id: alvoAlunoId!,
      acao: aluno_id ? "update" : "insert",
      antes: antes ? { atividades_ids: antes.atividades_ids, turmas_selecionadas: antes.turmas_selecionadas } : null,
      depois: { atividades_ids, turmas_selecionadas: turmas_selecionadas ?? [] },
      autor: gerente.nome || gerente.email || "staff",
    }).then(() => {}, () => {}); // best-effort

    return ok({ success: true, aluno_id: alvoAlunoId });
  }

  if (action === "inscricao_atividade_submit") {
    const { email, nome_resp, nome_crianca, serie, atividades_ids, atividades_detalhe, turmas_selecionadas } = body as Record<string, unknown>;
    if (!email || !nome_resp || !nome_crianca || !atividades_ids) return err("Campos obrigatórios ausentes.");
    // Deriva escola_id via familia do responsável (necessário para escopar write)
    const { data: fam } = await admin.from("familias").select("escola_id").eq("email", email as string).maybeSingle();
    if (!fam?.escola_id) return err("Responsável não cadastrado — contate a secretaria.", 404);
    // Busca aluno pelo nome ESCOPADO por escola
    const { data: found } = await admin.from("alunos").select("id").ilike("nome", nome_crianca as string).eq("escola_id", fam.escola_id).limit(1).maybeSingle();
    if (found) {
      const { error } = await admin.from("alunos").update({
        atividades_ids: atividades_ids as string[],
        turmas_selecionadas: turmas_selecionadas ?? [],
      }).eq("id", found.id).eq("escola_id", fam.escola_id);
      if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }
    } else {
      // Aluno não cadastrado — cria na tabela alunos escopado
      const { data: novoAluno, error } = await admin.from("alunos").insert({
        nome: nome_crianca, email: email || null, serie: serie || null,
        responsavel_nome: nome_resp,
        atividades_ids: atividades_ids as string[],
        turmas_selecionadas: turmas_selecionadas ?? [],
        ativo: true,
        escola_id: fam.escola_id,
      }).select("id").single();
      if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }

      // LAP: aluno matriculado via portal família (matrícula online)
      if (novoAluno?.id) {
        try {
          const { trackEvent } = await import("../../_shared/track.ts");
          trackEvent(admin, {
            escola_id: fam.escola_id,
            user_id: fam.id,
            event_name: "academico.aluno.matriculado",
            module: "academico",
            persona: "pais",
            payload: { aluno_id: novoAluno.id, via: "matricula_online", serie },
            idempotency_key: `aluno-matric:${novoAluno.id}`,
          });
        } catch (_) { /* silent */ }
      }
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
    let foto_path_value: string | null = null;
    if (base64 && mime) {
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(mime as string)) return err("Tipo de imagem não permitido.");
      const bytes = Uint8Array.from(atob(base64 as string), c => c.charCodeAt(0));
      if (bytes.length > 10 * 1024 * 1024) return err("Imagem muito grande (máx. 10MB).");
      const ext = (mime as string).split("/")[1];
      const path = `fotos/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      await admin.storage.createBucket("manutencoes", { public: false }).catch(() => {});
      const { error: upErr } = await admin.storage.from("manutencoes").upload(path, bytes, { contentType: mime as string, upsert: false });
      if (upErr) return err("Erro ao enviar foto: " + upErr.message);
      // Bucket privado (mig 280): signed URL TTL 7d, regenerada em cada list.
      const { data: signed } = await admin.storage.from("manutencoes").createSignedUrl(path, 60 * 60 * 24 * 7);
      foto_url = signed?.signedUrl || null;
      foto_path_value = path;
    }
    const escolaIdMan = await resolveEscolaId(req, admin, null, body);
    if (!escolaIdMan) return err("Escola não identificada.", 400);
    const insert: Record<string, unknown> = { descricao, localizacao, urgencia, foto_url, foto_path: foto_path_value, escola_id: escolaIdMan };
    if (usuario_id) insert.usuario_id = usuario_id;
    else if (_email) {
      const { data: u } = await admin.from("usuarios").select("id").eq("escola_id", escolaIdMan).eq("email", _email as string).maybeSingle();
      if (u) insert.usuario_id = u.id;
    }
    const { data: chamadoNovo, error } = await admin.from("manutencoes").insert(insert).select("id").single();
    if (error) { console.error("[api db error]", error); return err(sanitizePgError(error)); }

    // LAP: manutencao.chamado.aberto (outcomes do LHS quando fechado_no_sla depois)
    if (chamadoNovo?.id) {
      try {
        const { trackEvent } = await import("../../_shared/track.ts");
        trackEvent(admin, {
          escola_id: escolaIdMan,
          user_id: (insert.usuario_id as string) || null,
          event_name: "manutencao.chamado.aberto",
          module: "manutencao",
          persona: "professora",
          payload: { urgencia, has_foto: !!foto_url, chamado_id: chamadoNovo.id, origem: "publico" },
          idempotency_key: `manut-aberto:${chamadoNovo.id}`,
        });
      } catch (_) { /* silent */ }
    }

    return ok({ success: true });
  }

  // ── Manutenção — meus chamados (professora/equipe) — escopado por Origin ──
  if (action === "manutencao_minhas") {
    const email = ((body._email as string) || "").toLowerCase().trim();
    if (!email) return err("E-mail obrigatório.");
    const escolaIdMin = await resolveEscolaId(req, admin, null, body);
    if (!escolaIdMin) return err("Escola não identificada.", 400);
    const { data: user } = await admin.from("usuarios").select("id").eq("escola_id", escolaIdMin).eq("email", email).maybeSingle();
    if (!user) return ok([]);
    const { data } = await admin.from("manutencoes").select("*, usuarios(nome, email)")
      .eq("escola_id", escolaIdMin).eq("usuario_id", user.id).order("criado_em", { ascending: false });
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

    const { data: contrato } = await admin.from("contratos").select("status, html_renderizado, dados_preenchidos, escola_id").eq("id", contrato_id).single();
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
      escola_id: (contrato as any).escola_id,
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

  // ── Módulos habilitados (per-session — resolve escola via token OU Origin) ──
  if (action === "modulos_habilitados") {
    try {
      // Prioridade: token da sessão no body → Origin → single-tenant fallback
      const escolaId = await resolveEscolaId(req, admin, null, body);
      if (!escolaId) {
        console.warn("[modulos_habilitados] escola não identificada");
        // Sem cache — deixa o cliente re-tentar quando tiver token/Origin válido
        return ok({ modulos: [], tema: 'corporativo' }, { "Cache-Control": "no-store" });
      }
      const modulos = await getModulosHabilitados(admin, escolaId);
      const { data: escola } = await admin.from("escolas").select("tema").eq("id", escolaId).maybeSingle();
      // Cache PRIVATE (por usuário/sessão, não compartilhado entre tenants)
      return ok(
        { modulos: [...modulos], tema: (escola as any)?.tema || 'corporativo' },
        { "Cache-Control": "private, max-age=30", "Vary": "Authorization" }
      );
    } catch (e) { console.error("[modulos_habilitados]", e); return ok({ modulos: [], tema: 'corporativo' }, { "Cache-Control": "no-store" }); }
  }

  // ── Ticket de suporte (público — antes do auth check) ──
  if (action === "ticket_create") {
    const rlTicket = checkRateLimit(ip, "login");
    if (!rlTicket.allowed) return err(`Limite de tickets atingido. Tente em ${rlTicket.retryAfterSeconds}s.`, 429);
    const { email, nome, portal, tipo, descricao, url_pagina, user_agent, resolucao_tela } = body as any;
    if (!email || !descricao || !portal) return err("email, descricao e portal obrigatórios.");
    // Escola via Origin + token (não assumir "primeira escola ativa")
    const escola_id = await resolveEscolaId(req, admin, null, body);
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
          }),
          signal: AbortSignal.timeout(8000),
        });
      }
    } catch (e) { console.warn('[api] Ticket email notification failed:', (e as Error).message) }
    // Disparar Claude AI trigger imediatamente via poke (fire-and-forget)
    // Token no header (não em query) pra não aparecer em logs/metrics
    try {
      fetch("https://api.claude.ai/v1/code/triggers/trig_01PTaCsfDfdNrUGwfUeZJZ96/poke", {
        method: "POST",
        headers: { "X-Trigger-Token": Deno.env.get("CLAUDE_TRIGGER_TOKEN") || "lumied-ticket-poke-2026" },
      }).catch(() => {});
    } catch (e) { console.warn('[api] Claude trigger poke failed:', (e as Error).message) }
    return ok({ success: true, numero: ticketNumero });
  }

  // ── Calcular risk scores (pg_cron ou admin — autenticação via CRON_INTERNAL_KEY) ──
  if (action === "calcular_risk_scores") {
    const cronKey = Deno.env.get("CRON_INTERNAL_KEY") || "";
    const authH = req.headers.get("authorization")?.replace("Bearer ", "") || "";
    const bodyKey = (body._cron_key as string) || "";
    if (!cronKey || (authH !== cronKey && bodyKey !== cronKey)) return err("Unauthorized", 401);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: escolas } = await admin.from("escolas").select("id").eq("ativo", true);
    if (!escolas?.length) return ok({ calculados: 0, alto_risco: 0 });

    let totalCalculados = 0;
    let totalAltoRisco = 0;

    for (const escola of escolas) {
      const escolaId = escola.id;
      const { data: familias } = await admin.from("familias")
        .select("email, nome_aluno")
        .eq("escola_id", escolaId);
      if (!familias?.length) continue;

      // Fetch chamadas dos últimos 30 dias
      const { data: chamadas30d } = await admin.from("frequencia_chamadas")
        .select("id")
        .eq("escola_id", escolaId)
        .gte("data", thirtyDaysAgo);
      const chamadaIds = (chamadas30d || []).map((c: any) => c.id);
      const totalAulas30d = chamadaIds.length;

      // Fetch últimas 6 avaliações da escola
      const { data: avaliacoes6 } = await admin.from("notas_avaliacoes")
        .select("id")
        .eq("escola_id", escolaId)
        .order("data_avaliacao", { ascending: false })
        .limit(6);
      const ava6Ids = (avaliacoes6 || []).map((a: any) => a.id);
      const ava3Recent = ava6Ids.slice(0, 3);
      const ava3Older = ava6Ids.slice(3);

      const upserts: unknown[] = [];

      for (const f of familias) {
        const email = f.email;
        if (!email) continue;
        const fatores: string[] = [];

        // ── score_frequencia ──
        let scoreFreq = 50;
        if (totalAulas30d > 0 && chamadaIds.length > 0) {
          const { count: ausencias } = await admin.from("frequencia_registros")
            .select("id", { count: "exact", head: true })
            .eq("aluno_email", email)
            .eq("status", "ausente")
            .in("chamada_id", chamadaIds);
          const pctAusencia = ((ausencias || 0) / totalAulas30d) * 100;
          scoreFreq = Math.round(Math.max(0, 100 - pctAusencia));
          if (pctAusencia >= 25) fatores.push(`Frequência baixa (${Math.round(100 - pctAusencia)}%)`);
        }

        // ── score_notas ──
        let scoreNotas = 50;
        if (ava6Ids.length > 0) {
          const { data: lancamentos } = await admin.from("notas_lancamentos")
            .select("valor, avaliacao_id")
            .eq("aluno_email", email)
            .in("avaliacao_id", ava6Ids);
          const vals = (lancamentos || []).map((l: any) => Number(l.valor)).filter(v => !isNaN(v));
          if (vals.length > 0) {
            const media = vals.reduce((s, v) => s + v, 0) / vals.length;
            scoreNotas = Math.round(Math.min(100, Math.max(0, media * 10)));
            if (media < 5) fatores.push(`Média baixa (${media.toFixed(1)})`);
          }
        }

        // ── score_tendencia ──
        let scoreTend = 50;
        if (ava3Recent.length > 0 && ava3Older.length > 0) {
          const { data: recNotas } = await admin.from("notas_lancamentos")
            .select("valor")
            .eq("aluno_email", email)
            .in("avaliacao_id", ava3Recent);
          const { data: oldNotas } = await admin.from("notas_lancamentos")
            .select("valor")
            .eq("aluno_email", email)
            .in("avaliacao_id", ava3Older);
          const recVals = (recNotas || []).map((l: any) => Number(l.valor)).filter(v => !isNaN(v));
          const oldVals = (oldNotas || []).map((l: any) => Number(l.valor)).filter(v => !isNaN(v));
          if (recVals.length && oldVals.length) {
            const recMedia = recVals.reduce((s, v) => s + v, 0) / recVals.length;
            const oldMedia = oldVals.reduce((s, v) => s + v, 0) / oldVals.length;
            const diff = recMedia - oldMedia;
            if (diff >= 0.5) { scoreTend = 80; }
            else if (diff <= -0.5) { scoreTend = 20; fatores.push("Notas em queda"); }
            else { scoreTend = 50; }
          }
        }

        // ── score_engajamento_pais ──
        let scoreEngaj = 50;
        const { data: authUser } = await admin.auth.admin.listUsers();
        const parentUser = (authUser?.users || []).find((u: any) => u.email === email);
        if (parentUser?.last_sign_in_at) {
          const daysSince = (Date.now() - new Date(parentUser.last_sign_in_at).getTime()) / 86400000;
          if (daysSince < 7) { scoreEngaj = 80; }
          else if (daysSince < 30) { scoreEngaj = 50; }
          else { scoreEngaj = 20; fatores.push("Responsável sem acesso há 30+ dias"); }
        }

        const rawScore = scoreFreq * 0.35 + scoreNotas * 0.30 + scoreEngaj * 0.20 + scoreTend * 0.15;
        const score = Math.round(Math.max(0, Math.min(100, 100 - rawScore)));

        upserts.push({
          escola_id: escolaId,
          aluno_email: email,
          aluno_nome: f.nome_aluno,
          score,
          score_frequencia: scoreFreq,
          score_notas: scoreNotas,
          score_engajamento_pais: scoreEngaj,
          score_tendencia: scoreTend,
          fatores: JSON.stringify(fatores),
          calculado_em: new Date().toISOString(),
        });

        if (score >= 60) totalAltoRisco++;
        totalCalculados++;
      }

      if (upserts.length > 0) {
        await admin.from("aluno_risk_scores").upsert(upserts, { onConflict: "escola_id,aluno_email" });
      }
    }

    return ok({ calculados: totalCalculados, alto_risco: totalAltoRisco });
  }

  return null
}
