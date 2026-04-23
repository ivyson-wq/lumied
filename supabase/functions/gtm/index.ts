// ═══════════════════════════════════════════════════════════════
//  Edge Function: gtm — Funil comercial Lumied (SaaS-level)
//  Leads, CRM Lumied, ROI calculator, nurturing drip, indicações.
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, type Context, type Middleware, successResponse, AppError, createLogger } from "../_shared/mod.ts";

const log = createLogger("gtm");

// ── Helpers ──
function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > max) return null;
  return t;
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function esc(s: string): string {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}

// ── Staff auth (aceita admin OU lumied_staff) ──
async function authStaff(ctx: Context, next: () => Promise<Response>): Promise<Response> {
  const token = (ctx.body._token as string) || (ctx.body._staff_token as string) || null;
  if (!token) throw new AppError("AUTH_REQUIRED", "Token obrigatório.");

  // 1) staff sessão
  const { data: ss } = await ctx.sb.from("lumied_staff_sessoes")
    .select("staff_id, expira_em, lumied_staff(id, nome, email, cargo, ativo)")
    .eq("token", token).maybeSingle();
  if (ss && new Date((ss as any).expira_em) >= new Date()) {
    const s = (ss as any).lumied_staff;
    if (s?.ativo) { ctx.user = { ...s, tipo: 'staff' }; return next(); }
  }
  // 2) admin sessão (fallback)
  const { data: as_ } = await ctx.sb.from("admin_sessoes")
    .select("*, admins(id, nome, email)")
    .eq("token", token).maybeSingle();
  if (as_ && new Date((as_ as any).expira_em) >= new Date()) {
    ctx.user = { ...(as_ as any).admins, tipo: 'admin' };
    return next();
  }
  throw new AppError("AUTH_INVALID", "Sessão inválida.");
}

// ── Service role auth (cron) ──
function requireServiceAuth(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const cronKey = Deno.env.get("CRON_INTERNAL_KEY") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || (token !== serviceKey && (!cronKey || token !== cronKey))) {
    throw new AppError("AUTH_INVALID", "Autorização inválida.");
  }
}

// ── Tier pricing (espelha PLAYBOOK §9) ──
const TIER_INFO: Record<string, { nome: string; preco_mes: number; preco_anual_mes: number; alunos_max: number | null }> = {
  starter:  { nome: 'Starter',  preco_mes: 790,   preco_anual_mes: 632,   alunos_max: 200 },
  start:    { nome: 'Start',    preco_mes: 1200,  preco_anual_mes: 960,   alunos_max: 300 },
  evolucao: { nome: 'Evolução', preco_mes: 1800,  preco_anual_mes: 1440,  alunos_max: 800 },
  prestige: { nome: 'Prestige', preco_mes: 3300,  preco_anual_mes: 2640,  alunos_max: null },
};
function sugerirTier(alunos: number | null | undefined): keyof typeof TIER_INFO {
  const a = alunos || 0;
  if (a <= 200) return 'starter';
  if (a <= 300) return 'start';
  if (a <= 800) return 'evolucao';
  return 'prestige';
}

// ── Resend email helper ──
async function enviarEmail(to: string, subject: string, html: string, replyTo?: string): Promise<string | null> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) { log.warn("[gtm] RESEND_API_KEY não configurada"); return null; }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Lumied <noreply@lumied.com.br>",
        to: [to],
        reply_to: replyTo || "ivyson@gmail.com",
        subject,
        html,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { log.error("[gtm] Resend erro", { metadata: { status: res.status, body: await res.text() } }); return null; }
    const data = await res.json();
    return data?.id || null;
  } catch (e) {
    log.error("[gtm] Resend fetch falhou", { metadata: { error: (e as Error).message } });
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
const router = new Router("gtm");
router.useGlobal(rateLimit({ maxRequests: 60, windowMs: 60000 }));

// ─────────────────────────────────────────────────
//  PUBLIC — ROI calculator + lead capture
// ─────────────────────────────────────────────────

router.on("roi_calcular", rateLimit({ windowMs: 60000, maxRequests: 10 }), async (ctx) => {
  const b = ctx.body as any;
  const alunos = num(b.alunos) || 0;
  const mensalidade = num(b.mensalidade_media) || 0;
  const inadimplencia = num(b.inadimplencia_pct) || 0;
  const sistema = str(b.sistema_atual, 60) || '';
  const horasAdmin = num(b.horas_admin_semana) || 8;
  const email = str(b.email, 120);
  const nomeEscola = str(b.nome_escola, 120);
  const telefone = str(b.telefone, 40);
  const cidade = str(b.cidade, 80);
  const uf = str(b.uf, 2);

  if (alunos < 10 || alunos > 5000) throw new AppError("VALIDATION_FAILED", "Alunos entre 10 e 5000.");
  if (mensalidade < 50 || mensalidade > 10000) throw new AppError("VALIDATION_FAILED", "Mensalidade entre R$ 50 e R$ 10.000.");
  if (inadimplencia < 0 || inadimplencia > 50) throw new AppError("VALIDATION_FAILED", "Inadimplência entre 0 e 50%.");

  // Cálculo — premissas documentadas no PLAYBOOK
  // 1) Redução de inadimplência: Lumied reduz 55% da taxa atual (benchmark Maple Bear 12%→3.8% = 68%, conservador 55%)
  const totalAbertoAnual = alunos * mensalidade * 12;
  const atrasadoAtualAnual = totalAbertoAnual * (inadimplencia / 100);
  const recuperacaoAnual = atrasadoAtualAnual * 0.55;
  // 2) Economia horas admin: 40% de redução das horas/semana × R$ 22/hora × 52 semanas
  const economiaHoraAnual = horasAdmin * 0.40 * 22 * 52;
  const totalAnual = recuperacaoAnual + economiaHoraAnual;
  const tier = sugerirTier(alunos);
  const custoAnualLumied = TIER_INFO[tier].preco_anual_mes * 12;
  const roiMult = custoAnualLumied > 0 ? totalAnual / custoAnualLumied : 0;

  // Se deixou e-mail, vira lead MQL auto-qualificado
  let leadId: string | null = null;
  if (email && nomeEscola) {
    // Upsert lead por email (mesmo email = mesmo lead)
    const existing = await ctx.sb.from("leads_comerciais").select("id").eq("email", email.toLowerCase()).maybeSingle();
    if (existing?.data?.id) {
      leadId = existing.data.id;
      await ctx.sb.from("leads_comerciais").update({
        nome_escola: nomeEscola,
        telefone: telefone || null,
        cidade, uf,
        alunos_estimados: alunos,
        sistema_atual: sistema || null,
        tier_sugerido: tier,
        qualificado_mql: true,
        qualificado_em: new Date().toISOString(),
      }).eq("id", leadId);
    } else {
      const ins = await ctx.sb.from("leads_comerciais").insert({
        nome_escola: nomeEscola,
        email: email.toLowerCase(),
        telefone: telefone || null,
        cidade, uf,
        alunos_estimados: alunos,
        sistema_atual: sistema || null,
        tier_sugerido: tier,
        origem: 'roi_calc',
        status: 'novo',
        qualificado_mql: true,
        qualificado_em: new Date().toISOString(),
        ip: ctx.ip,
        user_agent: ctx.req.headers.get('user-agent') || '',
      }).select("id").single();
      leadId = (ins.data as any)?.id || null;
    }
    if (leadId) {
      await ctx.sb.from("gtm_lead_events").insert({
        lead_id: leadId, tipo: 'roi_calc',
        descricao: `ROI calc: R$ ${totalAnual.toFixed(0)}/ano (${roiMult.toFixed(1)}x)`,
        meta: { alunos, mensalidade, inadimplencia, tier, recuperacao: recuperacaoAnual, economia: economiaHoraAnual },
      });
    }
  }

  // Log mesmo sem e-mail (anônimo)
  await ctx.sb.from("gtm_roi_calc_log").insert({
    lead_id: leadId,
    email: email ? email.toLowerCase() : null,
    alunos, mensalidade_media: mensalidade, inadimplencia_pct: inadimplencia,
    sistema_atual: sistema || null,
    horas_admin_semana: horasAdmin,
    resultado_recuperacao_anual: recuperacaoAnual,
    resultado_economia_hora_anual: economiaHoraAnual,
    resultado_total_anual: totalAnual,
    tier_sugerido: tier,
    custo_lumied_anual: custoAnualLumied,
    roi_multiplicador: roiMult,
    ip: ctx.ip,
    user_agent: ctx.req.headers.get('user-agent') || '',
  });

  return successResponse({
    recuperacao_anual: Math.round(recuperacaoAnual),
    economia_hora_anual: Math.round(economiaHoraAnual),
    total_anual: Math.round(totalAnual),
    custo_lumied_anual: custoAnualLumied,
    custo_lumied_mensal: TIER_INFO[tier].preco_anual_mes,
    roi_multiplicador: Math.round(roiMult * 10) / 10,
    tier_sugerido: tier,
    tier_nome: TIER_INFO[tier].nome,
    lead_capturado: !!leadId,
  });
});

// Captura de lead genérica — vindo de qualquer form
router.on("lead_capture", rateLimit({ windowMs: 60000, maxRequests: 5 }), async (ctx) => {
  const b = ctx.body as any;
  const email = str(b.email, 120);
  const nomeEscola = str(b.nome_escola, 120);
  if (!email || !nomeEscola) throw new AppError("VALIDATION_FAILED", "Nome da escola e e-mail obrigatórios.");

  const telefone = str(b.telefone, 40);
  const cidade = str(b.cidade, 80);
  const uf = str(b.uf, 2);
  const alunos = num(b.alunos_estimados);
  const sistema = str(b.sistema_atual, 60);
  const origem = str(b.origem, 40) || 'site';
  const mensagem = str(b.mensagem, 2000);
  const utm_source = str(b.utm_source, 60);
  const utm_medium = str(b.utm_medium, 60);
  const utm_campaign = str(b.utm_campaign, 60);
  const codigo_indicacao = str(b.codigo_indicacao, 40);

  // Upsert por email
  const existing = await ctx.sb.from("leads_comerciais").select("id, qualificado_mql").eq("email", email.toLowerCase()).maybeSingle();
  let leadId: string;
  if (existing?.data?.id) {
    leadId = existing.data.id;
    const upd: any = { nome_escola: nomeEscola };
    if (telefone) upd.telefone = telefone;
    if (cidade) upd.cidade = cidade;
    if (uf) upd.uf = uf;
    if (alunos) { upd.alunos_estimados = alunos; upd.tier_sugerido = sugerirTier(alunos); }
    if (sistema) upd.sistema_atual = sistema;
    if (mensagem) upd.mensagem = mensagem;
    if (!existing.data.qualificado_mql) { upd.qualificado_mql = true; upd.qualificado_em = new Date().toISOString(); }
    await ctx.sb.from("leads_comerciais").update(upd).eq("id", leadId);
  } else {
    const ins = await ctx.sb.from("leads_comerciais").insert({
      nome_escola: nomeEscola,
      email: email.toLowerCase(),
      telefone, cidade, uf,
      alunos_estimados: alunos,
      sistema_atual: sistema,
      tier_sugerido: alunos ? sugerirTier(alunos) : null,
      origem, mensagem, utm_source, utm_medium, utm_campaign,
      status: 'novo',
      qualificado_mql: true,
      qualificado_em: new Date().toISOString(),
      ip: ctx.ip,
      user_agent: ctx.req.headers.get('user-agent') || '',
    }).select("id").single();
    leadId = (ins.data as any).id;
  }

  // Indicação?
  if (codigo_indicacao) {
    await ctx.sb.from("indicacoes_clicks").insert({
      codigo: codigo_indicacao, lead_id: leadId, ip: ctx.ip, user_agent: ctx.req.headers.get('user-agent') || '',
    });
  }

  await ctx.sb.from("gtm_lead_events").insert({
    lead_id: leadId, tipo: 'status_change', status_para: 'novo',
    descricao: `Lead capturado via ${origem}${utm_source ? ` (utm=${utm_source})` : ''}`,
    meta: { origem, utm_source, utm_medium, utm_campaign },
  });

  // Notifica Ivyson
  enviarEmail("ivyson@gmail.com", `🔔 Novo Lead MQL: ${nomeEscola}`,
    `<h2>Novo lead qualificado</h2>
     <p><b>Escola:</b> ${esc(nomeEscola)}<br>
     <b>E-mail:</b> ${esc(email)}<br>
     <b>WhatsApp:</b> ${esc(telefone || '—')}<br>
     <b>Cidade/UF:</b> ${esc(cidade || '—')}/${esc(uf || '—')}<br>
     <b>Alunos:</b> ${alunos || '?'}<br>
     <b>Sistema atual:</b> ${esc(sistema || '—')}<br>
     <b>Origem:</b> ${esc(origem)}${utm_source ? ' · utm=' + esc(utm_source) : ''}</p>
     ${mensagem ? `<p><b>Mensagem:</b><br>${esc(mensagem)}</p>` : ''}
     <p><a href="https://admin.lumied.com.br" style="background:#6B3FA0;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Abrir CRM Lumied</a></p>`);

  return successResponse({ success: true, lead_id: leadId, message: "Obrigado! Entraremos em contato em até 24h." });
});

// Calendly webhook — marca lead como demo_agendada
router.on("calendly_webhook", async (ctx) => {
  const secret = Deno.env.get("CALENDLY_WEBHOOK_TOKEN") || "";
  const token = (ctx.body._token as string) || "";
  if (!secret || token !== secret) throw new AppError("AUTH_INVALID", "Token inválido.");

  const b = ctx.body as any;
  const email = str(b.invitee_email, 120);
  const eventUri = str(b.event_uri, 300);
  const startAt = str(b.start_time, 40);
  if (!email) throw new AppError("VALIDATION_FAILED", "invitee_email obrigatório.");

  const { data: lead } = await ctx.sb.from("leads_comerciais").select("id, status").eq("email", email.toLowerCase()).maybeSingle();
  if (!lead) return successResponse({ success: false, message: "Lead não encontrado" });

  await ctx.sb.from("leads_comerciais").update({
    status: 'demo_agendada',
    calendly_event_uri: eventUri,
    calendly_booking_at: startAt ? new Date(startAt).toISOString() : new Date().toISOString(),
  }).eq("id", (lead as any).id);

  await ctx.sb.from("gtm_lead_events").insert({
    lead_id: (lead as any).id, tipo: 'calendly_booked',
    status_de: (lead as any).status, status_para: 'demo_agendada',
    descricao: `Demo agendada via Calendly`,
    meta: { event_uri: eventUri, start_time: startAt },
  });

  return successResponse({ success: true });
});

// ─────────────────────────────────────────────────
//  STAFF — CRM + Funil
// ─────────────────────────────────────────────────

router.on("leads_list", authStaff, async (ctx) => {
  const b = ctx.body as any;
  const statusFilter = str(b.status, 40);
  const tocoFilter = num(b.toque);
  let q = ctx.sb.from("leads_comerciais")
    .select("id, nome_escola, email, telefone, cidade, uf, alunos_estimados, sistema_atual, tier_sugerido, status, toque_atual, proximo_passo, proximo_passo_em, qualificado_mql, origem, utm_source, criado_em, calendly_booking_at, valor_mrr")
    .order("criado_em", { ascending: false }).limit(500);
  if (statusFilter) q = q.eq("status", statusFilter);
  if (tocoFilter !== null) q = q.eq("toque_atual", tocoFilter);
  const { data } = await q;
  return successResponse({ leads: data || [] });
});

router.on("lead_get", authStaff, async (ctx) => {
  const id = str((ctx.body as any).id, 40);
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  const [leadRes, eventsRes, nurtRes] = await Promise.all([
    ctx.sb.from("leads_comerciais").select("*").eq("id", id).single(),
    ctx.sb.from("gtm_lead_events").select("*").eq("lead_id", id).order("criado_em", { ascending: false }).limit(100),
    ctx.sb.from("gtm_nurture_enviados").select("*").eq("lead_id", id).order("passo"),
  ]);
  if (leadRes.error) throw new AppError("NOT_FOUND", "Lead não encontrado.");
  return successResponse({ lead: leadRes.data, events: eventsRes.data || [], nurture: nurtRes.data || [] });
});

router.on("lead_update", authStaff, async (ctx) => {
  const b = ctx.body as any;
  const id = str(b.id, 40);
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  const ALLOWED = ["nome_escola","telefone","cidade","uf","alunos_estimados","sistema_atual","tier_sugerido","status","toque_atual","proximo_passo","proximo_passo_em","notas","nurture_optout","perdido_motivo","valor_mrr","responsavel_staff_id"];
  const upd: Record<string, unknown> = {};
  for (const k of ALLOWED) if (k in b) upd[k] = b[k];
  if (upd.status === 'fechado' && !upd.fechado_em) upd.fechado_em = new Date().toISOString();
  if (Object.keys(upd).length === 0) throw new AppError("VALIDATION_FAILED", "Nenhum campo para atualizar.");

  // Buscar status atual para registrar transição
  const { data: antes } = await ctx.sb.from("leads_comerciais").select("status").eq("id", id).single();
  const { error } = await ctx.sb.from("leads_comerciais").update(upd).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);

  if (upd.status && antes && (antes as any).status !== upd.status) {
    await ctx.sb.from("gtm_lead_events").insert({
      lead_id: id, tipo: 'status_change',
      status_de: (antes as any).status, status_para: upd.status,
      descricao: `Status: ${(antes as any).status} → ${upd.status}`,
      ator_staff_id: ctx.user?.tipo === 'staff' ? ctx.user.id : null,
    });
  }
  return successResponse({ success: true });
});

router.on("lead_registrar_toque", authStaff, async (ctx) => {
  const b = ctx.body as any;
  const id = str(b.id, 40);
  const toque = num(b.toque);
  const descricao = str(b.descricao, 500);
  if (!id || toque === null || toque < 1 || toque > 7) throw new AppError("VALIDATION_FAILED", "id e toque (1-7) obrigatórios.");

  await ctx.sb.from("leads_comerciais").update({ toque_atual: toque }).eq("id", id);
  await ctx.sb.from("gtm_lead_events").insert({
    lead_id: id, tipo: 'toque', toque,
    descricao: descricao || `Toque T${toque} registrado`,
    ator_staff_id: ctx.user?.tipo === 'staff' ? ctx.user.id : null,
  });
  return successResponse({ success: true });
});

router.on("lead_nota", authStaff, async (ctx) => {
  const b = ctx.body as any;
  const id = str(b.id, 40);
  const nota = str(b.nota, 2000);
  if (!id || !nota) throw new AppError("VALIDATION_FAILED", "id e nota obrigatórios.");
  await ctx.sb.from("gtm_lead_events").insert({
    lead_id: id, tipo: 'nota', descricao: nota,
    ator_staff_id: ctx.user?.tipo === 'staff' ? ctx.user.id : null,
  });
  return successResponse({ success: true });
});

router.on("funil_stats", authStaff, async (ctx) => {
  const b = ctx.body as any;
  const dias = Math.min(num(b.dias) || 30, 365);
  const desde = new Date(Date.now() - dias * 86400000).toISOString();

  const [funilRes, events30, roiLog] = await Promise.all([
    ctx.sb.from("gtm_funil_resumo").select("*"),
    ctx.sb.from("gtm_lead_events").select("tipo, toque, criado_em, status_para").gte("criado_em", desde).limit(5000),
    ctx.sb.from("gtm_roi_calc_log").select("*").gte("criado_em", desde).limit(500),
  ]);

  const porStatus = (funilRes.data || []).reduce((acc: any, r: any) => { acc[r.status] = r; return acc; }, {});
  const ordem = ['novo','contatado','qualificado','demo_agendada','proposta','fechado','perdido'];
  const funil = ordem.map(s => ({
    status: s,
    total: porStatus[s]?.total || 0,
    ultimo_30d: porStatus[s]?.ultimo_30d || 0,
    ultimo_7d: porStatus[s]?.ultimo_7d || 0,
    mrr: Number(porStatus[s]?.mrr_fechado || 0),
  }));
  const mrrFechado = funil.find(f => f.status === 'fechado')?.mrr || 0;

  // Eventos por toque nos últimos 30d
  const toquesDistrib: Record<string, number> = {};
  for (const e of (events30.data || [])) {
    if (e.tipo === 'toque' && e.toque) toquesDistrib[`T${e.toque}`] = (toquesDistrib[`T${e.toque}`] || 0) + 1;
  }
  const roiMedio = (roiLog.data || []).reduce((s: number, r: any) => s + Number(r.resultado_total_anual || 0), 0) / Math.max((roiLog.data || []).length, 1);

  return successResponse({
    funil,
    mrr_fechado: mrrFechado,
    arr_fechado: mrrFechado * 12,
    roi_calcs_periodo: (roiLog.data || []).length,
    roi_medio_anual: Math.round(roiMedio),
    toques_distribuicao: toquesDistrib,
    periodo_dias: dias,
  });
});

// ─────────────────────────────────────────────────
//  CRON — Nurture drip (rodado às 12:00 UTC = 09:00 BRT)
// ─────────────────────────────────────────────────

const NURTURE_EMAILS: Record<number, { subject: (nome: string) => string; html: (lead: any) => string }> = {
  1: {
    subject: (nome) => `Bem-vindo à Lumied — 3 coisas que você pode fazer agora, ${nome.split(' ')[0]}`,
    html: (l) => `
      <p>Olá ${esc(l.nome_escola?.split(' ')[0] || 'direção')},</p>
      <p>Obrigado por entrar em contato! Sou o Ivyson, fundador da Lumied.</p>
      <p>Enquanto agendamos uma conversa, 3 coisas úteis agora:</p>
      <ol>
        <li><b>Calculadora de ROI:</b> <a href="https://lumied.com.br/roi/">lumied.com.br/roi/</a> — 30s e você descobre quanto a Lumied recupera em mensalidades atrasadas na sua escola.</li>
        <li><b>Tour em 8 minutos:</b> <a href="https://lumied.com.br/demo/">lumied.com.br/demo/</a> — vídeo guiado pelos principais módulos.</li>
        <li><b>Comparativo:</b> <a href="https://lumied.com.br/vs/escolaweb/">lumied.com.br/vs/escolaweb/</a> — Lumied × principais concorrentes.</li>
      </ol>
      <p>Qualquer coisa, responde esse e-mail direto.</p>
      <p>Abraço,<br>Ivyson Longoni<br>Lumied</p>`,
  },
  2: {
    subject: () => `Case: como uma escola de 287 alunos recuperou R$ 47.200 em 4 meses`,
    html: (l) => `
      <p>Olá,</p>
      <p>A ${l.alunos_estimados ? `sua escola (${l.alunos_estimados} alunos)` : 'sua escola'} deve gastar horas toda semana conciliando mensalidades atrasadas. É a parte mais chata — e mais cara — da gestão.</p>
      <p><b>O que a Maple Bear Caxias fez com o Lumied:</b></p>
      <ul>
        <li>Inadimplência caiu de 12% para 3,8% em 4 meses</li>
        <li>R$ 47.200 recuperados em 287 alunos</li>
        <li>ROI 2,2× só no módulo de cobrança — sem contar o resto</li>
      </ul>
      <p>Quer ver como? Marca 20min comigo: <a href="https://lumied.com.br/demo/">lumied.com.br/demo/</a></p>
      <p>Se preferir, posso te colocar em contato direto com a diretora da Maple Bear Caxias — ela topa conversar.</p>
      <p>Abraço,<br>Ivyson</p>`,
  },
  3: {
    subject: () => `Comparativo Lumied × Escolaweb × Sponte (tabela rápida)`,
    html: (l) => `
      <p>Oi,</p>
      <p>Lembrei de você porque muitas escolas que vêm falar com a gente estão na dúvida entre continuar no ${esc(l.sistema_atual || 'sistema atual')} ou migrar.</p>
      <p>Preparei um comparativo direto: <a href="https://lumied.com.br/vs/escolaweb/">lumied.com.br/vs/escolaweb/</a></p>
      <p>Pontos-chave que costumam decidir:</p>
      <ul>
        <li>IA nativa (só Lumied tem)</li>
        <li>WhatsApp gateway integrado</li>
        <li>Compliance CLT + ponto AFD</li>
        <li>Migração gratuita em até 48h</li>
      </ul>
      <p>Se fizer sentido, marca uma conversa de 20min: <a href="https://lumied.com.br/demo/">lumied.com.br/demo/</a></p>
      <p>Abraço,<br>Ivyson</p>`,
  },
  4: {
    subject: (nome) => `${nome.split(' ')[0]}, proposta-guia para você avaliar`,
    html: (l) => `
      <p>Olá,</p>
      <p>Para facilitar a decisão, segue um rascunho de proposta baseada no que sei da sua escola:</p>
      <ul>
        <li><b>Plano sugerido:</b> ${TIER_INFO[l.tier_sugerido || 'start'].nome}</li>
        <li><b>Investimento mensal (anual):</b> R$ ${TIER_INFO[l.tier_sugerido || 'start'].preco_anual_mes}</li>
        <li><b>Setup e migração:</b> isento</li>
        <li><b>Go-live:</b> 5 dias úteis após assinatura</li>
        <li><b>Treinamento:</b> 4 sessões (diretoria, secretaria, professoras, workshop)</li>
      </ul>
      <p>Quer agendar 20min para ajustar isso à realidade da escola?</p>
      <p><a href="https://lumied.com.br/demo/" style="background:#6B3FA0;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;">Agendar reunião</a></p>
      <p>Abraço,<br>Ivyson</p>`,
  },
  5: {
    subject: () => `Última mensagem minha`,
    html: (l) => `
      <p>Olá,</p>
      <p>Imagino que agora não é o momento certo — e tudo bem.</p>
      <p>Vou parar de te escrever. Deixo 3 coisas, pro caso de serem úteis no futuro:</p>
      <ul>
        <li>Comparativo: <a href="https://lumied.com.br/vs/escolaweb/">lumied.com.br/vs/escolaweb/</a></li>
        <li>Blog (publicamos diariamente): <a href="https://lumied.com.br/blog/">lumied.com.br/blog/</a></li>
        <li>Meu WhatsApp direto: (54) 99999-9999</li>
      </ul>
      <p>Se um dia a ${esc(l.nome_escola || 'sua escola')} quiser sair do ${esc(l.sistema_atual || 'sistema atual')}, me chama. Sem compromisso.</p>
      <p>Abraço e sucesso no ano letivo,<br>Ivyson</p>`,
  },
};

router.on("nurture_tick", async (ctx) => {
  requireServiceAuth(ctx.req);
  const { data: pendentes } = await ctx.sb.rpc("gtm_nurture_pendentes");
  const lista: any[] = pendentes || [];
  let enviados = 0;
  let falhas = 0;

  for (const p of lista.slice(0, 50)) {
    const template = NURTURE_EMAILS[p.passo as number];
    if (!template) continue;
    const subject = template.subject(p.nome_escola || '');
    const html = template.html(p);
    const resendId = await enviarEmail(p.email, subject, html);
    if (!resendId) { falhas++; continue; }
    await ctx.sb.from("gtm_nurture_enviados").insert({
      lead_id: p.lead_id, passo: p.passo, email_subject: subject, resend_id: resendId,
    });
    await ctx.sb.from("gtm_lead_events").insert({
      lead_id: p.lead_id, tipo: 'nurture_sent',
      descricao: `Email drip #${p.passo}: ${subject}`,
      meta: { passo: p.passo, resend_id: resendId },
    });
    enviados++;
  }
  return successResponse({ pendentes_considerados: lista.length, enviados, falhas });
});

// ─────────────────────────────────────────────────
//  Serve
// ─────────────────────────────────────────────────

serve((req) => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  return router.handle(req, sb);
});
