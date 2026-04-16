// ═══════════════════════════════════════════════════════════════
//  Edge Function: cobranca (v2 — Router Pattern)
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, requireFeature, validateInput } from "../_shared/router.ts";
import { successResponse, AppError } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("cobranca");
const router = new Router("cobranca");
router.useGlobal(rateLimit());

// Auth middleware: gerente/diretor (legado) ou financeiro (sessão unificada)
const authGerenteOuFinanceiro: import("../_shared/router.ts").Middleware = async (ctx, next) => {
  const token = (ctx.body._token as string) || null;
  if (!token) throw new AppError("AUTH_REQUIRED", "Token de sessão obrigatório.");

  const { data: gs } = await ctx.sb
    .from("gerente_sessoes")
    .select("*, gerentes(id, nome, email)")
    .eq("token", token)
    .maybeSingle();
  if (gs && new Date(gs.expira_em) >= new Date()) {
    ctx.user = { ...(gs as any).gerentes, tipo: "gerente" };
    return next();
  }

  const { data: us } = await ctx.sb
    .from("sessoes")
    .select("*, usuarios(id, nome, email, papeis, papel)")
    .eq("token", token)
    .maybeSingle();
  if (us && new Date(us.expira_em) >= new Date()) {
    const usuario = (us as any).usuarios;
    const papeis: string[] = usuario?.papeis?.length ? usuario.papeis : (usuario?.papel ? [usuario.papel] : []);
    const permitidos = ["gerente", "diretor", "financeiro"];
    if (papeis.some((p: string) => permitidos.includes(p))) {
      ctx.user = { ...usuario, tipo: papeis[0] };
      return next();
    }
  }

  throw new AppError("AUTH_INVALID", "Sessão inválida ou sem permissão financeira.");
};

router.on("regua_config_list", authGerente, requireFeature("regua_cobranca"), async (ctx) => {
  const { data } = await ctx.sb.from("regua_config").select("*").order("ordem");
  return successResponse(data ?? []);
});

router.on("regua_config_create", authGerente, requireFeature("regua_cobranca"), async (ctx) => {
  const { evento, canal, dias_offset, template_assunto, template_corpo } = ctx.body as any;
  if (!evento || !canal || dias_offset === undefined) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data, error } = await ctx.sb.from("regua_config").insert({ evento, canal, dias_offset, template_assunto, template_corpo, escola_id: ctx.escola_id }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("regua_config_update", authGerente, requireFeature("regua_cobranca"), async (ctx) => {
  const body = ctx.body as any;
  const { id } = body;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const ALLOWED = [
    "evento", "canal", "dias_offset", "dias_atraso",
    "template_assunto", "template_corpo", "template_id",
    "ordem", "ativo",
  ];
  const update: Record<string, unknown> = {};
  for (const k of ALLOWED) if (k in body) update[k] = body[k];
  const { error } = await ctx.sb.from("regua_config").update(update).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ── Helpers ──
function renderTemplate(tpl: string | null, vars: Record<string, unknown>): string {
  if (!tpl) return "";
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ""));
}

async function sendEmailResend(to: string, subject: string, html: string, from?: string): Promise<{ id?: string; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { error: "RESEND_API_KEY ausente" };
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: from || "Lumied <no-reply@lumied.com.br>", to, subject, html }),
    });
    const j = await resp.json();
    if (!resp.ok) return { error: j?.message || `HTTP ${resp.status}` };
    return { id: j?.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

router.on("regua_executar", authGerenteOuFinanceiro, requireFeature("regua_cobranca"), async (ctx) => {
  const hoje = new Date();
  const hojeStr = hoje.toISOString().split("T")[0];
  const { data: configs } = await ctx.sb.from("regua_config").select("*").eq("ativo", true).order("ordem");
  if (!configs?.length) return successResponse({ executados: 0 });
  const { data: mensalidades } = await ctx.sb.from("fin_mensalidades").select("*").eq("status", "pendente");
  let executados = 0;
  let erros = 0;
  const disparadoPor = (ctx.user as any)?.id || null;

  for (const mens of mensalidades || []) {
    const vencimento = new Date(mens.vencimento || mens.mes + "-10");
    const vars = {
      nome: mens.familia_nome || mens.aluno_nome || "responsável",
      valor: Number(mens.valor || 0).toFixed(2),
      data_vencimento: vencimento.toISOString().split("T")[0].split("-").reverse().join("/"),
      aluno: mens.aluno_nome || "",
      mes: mens.mes || "",
    };

    for (const cfg of configs) {
      const dataDisparo = new Date(vencimento);
      dataDisparo.setDate(dataDisparo.getDate() + cfg.dias_offset);
      if (dataDisparo.toISOString().split("T")[0] !== hojeStr) continue;

      // Dedupe por (config, mensalidade) se houver mensalidade_id; senão por (config, familia_email)
      const dedupeQ = ctx.sb.from("regua_execucoes").select("id", { count: "exact", head: true }).eq("config_id", cfg.id);
      const { count } = mens.id
        ? await dedupeQ.eq("mensalidade_id", mens.id)
        : await dedupeQ.eq("familia_email", mens.familia_email);
      if ((count || 0) > 0) continue;

      const assunto = renderTemplate(cfg.template_assunto, vars);
      const corpo = renderTemplate(cfg.template_corpo, vars);
      let status = "enviado";
      let erroMsg: string | null = null;
      let providerId: string | null = null;

      if (cfg.canal === "email" && mens.familia_email) {
        const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;line-height:1.6">${corpo.replace(/\n/g, "<br>")}</div>`;
        const r = await sendEmailResend(mens.familia_email, assunto, html);
        if (r.error) { status = "erro"; erroMsg = r.error; erros++; }
        else providerId = r.id || null;
      }

      await ctx.sb.from("regua_execucoes").insert({
        config_id: cfg.id,
        escola_id: mens.escola_id || null,
        mensalidade_id: mens.id || null,
        aluno_id: mens.aluno_id || null,
        familia_id: mens.familia_id || null,
        familia_email: mens.familia_email,
        destinatario: mens.familia_email,
        canal: cfg.canal,
        assunto,
        corpo,
        corpo_html: cfg.canal === "email" ? `<div>${corpo}</div>` : null,
        provider: cfg.canal === "email" ? "resend" : null,
        provider_message_id: providerId,
        status,
        erro_msg: erroMsg,
        disparado_por: disparadoPor,
        disparado_auto: !disparadoPor,
        metadata: { evento: cfg.evento, dias_offset: cfg.dias_offset, valor: mens.valor },
      });
      if (status === "enviado") executados++;
    }
  }
  log.info("Régua executada", { metadata: { executados, erros } });
  return successResponse({ executados, erros });
});

router.on("regua_execucoes_list", authGerenteOuFinanceiro, requireFeature("regua_cobranca"), async (ctx) => {
  const { familia_email, mensalidade_id, aluno_id, status, desde, ate, limite } = ctx.body as any;
  let q = ctx.sb.from("regua_execucoes")
    .select("*, regua_config(evento, canal, dias_offset)")
    .order("enviado_em", { ascending: false })
    .limit(Math.min(limite || 100, 500));
  if (familia_email)   q = q.eq("familia_email", familia_email);
  if (mensalidade_id)  q = q.eq("mensalidade_id", mensalidade_id);
  if (aluno_id)        q = q.eq("aluno_id", aluno_id);
  if (status)          q = q.eq("status", status);
  if (desde)           q = q.gte("enviado_em", desde);
  if (ate)             q = q.lte("enviado_em", ate);
  const { data } = await q;
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  Tratativas — observações manuais sobre cobranças
// ═══════════════════════════════════════════════════════════════

const TIPOS_TRATATIVA = [
  "nota","ligacao","whatsapp","email_manual","reuniao","visita",
  "promessa_pagamento","acordo","negativacao","cartorio","outros",
];

router.on("tratativa_create", authGerenteOuFinanceiro, requireFeature("regua_cobranca"), async (ctx) => {
  const b = ctx.body as any;
  const u = ctx.user as any;
  if (!b.observacao || !String(b.observacao).trim()) {
    throw new AppError("VALIDATION_FAILED", "Observação é obrigatória.");
  }
  if (!b.mensalidade_id && !b.familia_email && !b.aluno_id) {
    throw new AppError("VALIDATION_FAILED", "Informe mensalidade_id, aluno_id ou familia_email.");
  }
  const tipo = b.tipo || "nota";
  if (!TIPOS_TRATATIVA.includes(tipo)) {
    throw new AppError("VALIDATION_FAILED", `Tipo inválido. Use: ${TIPOS_TRATATIVA.join(", ")}`);
  }
  const { data, error } = await ctx.sb.from("cobranca_tratativas").insert({
    escola_id: b.escola_id || u?.escola_id || null,
    mensalidade_id: b.mensalidade_id || null,
    aluno_id: b.aluno_id || null,
    familia_email: b.familia_email || null,
    usuario_id: u?.id || null,
    usuario_nome: u?.nome || "desconhecido",
    usuario_papel: u?.tipo || (u?.papeis?.[0]) || null,
    tipo,
    observacao: String(b.observacao).trim(),
    data_prevista_pagamento: b.data_prevista_pagamento || null,
    valor_negociado: b.valor_negociado ?? null,
    resultado: b.resultado || null,
    anexos: b.anexos || [],
    execucao_id: b.execucao_id || null,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("Tratativa criada", { metadata: { id: data.id, tipo, usuario: u?.nome } });
  return successResponse(data);
});

router.on("tratativa_list", authGerenteOuFinanceiro, requireFeature("regua_cobranca"), async (ctx) => {
  const { mensalidade_id, aluno_id, familia_email, tipo, limite } = ctx.body as any;
  let q = ctx.sb.from("cobranca_tratativas")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(Math.min(limite || 100, 500));
  if (mensalidade_id) q = q.eq("mensalidade_id", mensalidade_id);
  if (aluno_id)       q = q.eq("aluno_id", aluno_id);
  if (familia_email)  q = q.eq("familia_email", familia_email);
  if (tipo)           q = q.eq("tipo", tipo);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("tratativa_update", authGerenteOuFinanceiro, requireFeature("regua_cobranca"), async (ctx) => {
  const b = ctx.body as any;
  const u = ctx.user as any;
  if (!b.id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  // Só o autor ou gerente pode editar
  const { data: existing } = await ctx.sb.from("cobranca_tratativas").select("usuario_id").eq("id", b.id).maybeSingle();
  if (!existing) throw new AppError("NOT_FOUND", "Tratativa não encontrada.");
  const isOwner = existing.usuario_id && existing.usuario_id === u?.id;
  const isGerente = ["gerente","diretor"].includes(u?.tipo);
  if (!isOwner && !isGerente) throw new AppError("FORBIDDEN", "Só o autor ou gerente pode editar.");

  const ALLOWED = ["observacao","tipo","data_prevista_pagamento","valor_negociado","resultado","anexos"];
  const update: Record<string, unknown> = {};
  for (const k of ALLOWED) if (k in b) update[k] = b[k];
  if (update.tipo && !TIPOS_TRATATIVA.includes(update.tipo as string)) {
    throw new AppError("VALIDATION_FAILED", "Tipo inválido.");
  }
  const { error } = await ctx.sb.from("cobranca_tratativas").update(update).eq("id", b.id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("tratativa_delete", authGerenteOuFinanceiro, requireFeature("regua_cobranca"), async (ctx) => {
  const b = ctx.body as any;
  const u = ctx.user as any;
  if (!b.id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { data: existing } = await ctx.sb.from("cobranca_tratativas").select("usuario_id").eq("id", b.id).maybeSingle();
  if (!existing) throw new AppError("NOT_FOUND", "Tratativa não encontrada.");
  const isOwner = existing.usuario_id && existing.usuario_id === u?.id;
  const isGerente = ["gerente","diretor"].includes(u?.tipo);
  if (!isOwner && !isGerente) throw new AppError("FORBIDDEN", "Só o autor ou gerente pode remover.");
  await ctx.sb.from("cobranca_tratativas").update({ deleted_at: new Date().toISOString() }).eq("id", b.id);
  return successResponse({ success: true });
});

router.on("cobranca_timeline", authGerenteOuFinanceiro, requireFeature("regua_cobranca"), async (ctx) => {
  const { mensalidade_id, aluno_id, familia_email, limite } = ctx.body as any;
  if (!mensalidade_id && !aluno_id && !familia_email) {
    throw new AppError("VALIDATION_FAILED", "Informe mensalidade_id, aluno_id ou familia_email.");
  }
  let q = ctx.sb.from("vw_cobranca_timeline")
    .select("*")
    .order("ocorrido_em", { ascending: false })
    .limit(Math.min(limite || 200, 500));
  if (mensalidade_id) q = q.eq("mensalidade_id", mensalidade_id);
  if (aluno_id)       q = q.eq("aluno_id", aluno_id);
  if (familia_email)  q = q.eq("familia_email", familia_email);
  const { data } = await q;
  return successResponse(data ?? []);
});

serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
