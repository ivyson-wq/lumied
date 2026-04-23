// ═══════════════════════════════════════════════════════════════
//  Edge Function: workflows (v1 — Router Pattern)
//  Workflow Automation Engine — CRUD + execution engine
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  Router,
  rateLimit,
  authGerenteOrSecretaria,
  AppError,
  successResponse,
} from "../_shared/mod.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("workflows");
const router = new Router("workflows");
router.useGlobal(rateLimit());

const auth = authGerenteOrSecretaria(["gerente", "diretor", "secretaria", "comercial", "financeiro"]);

// ─────────────────────────────────────────────────────────────
//  CRUD
// ─────────────────────────────────────────────────────────────

router.on("workflow_list", auth, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data, error } = await ctx.sb
    .from("workflows")
    .select("id,nome,descricao,ativo,trigger_tipo,trigger_config,execucoes_total,ultima_execucao,criado_em")
    .eq("escola_id", ctx.escola_id)
    .order("criado_em", { ascending: false });
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data ?? []);
});

router.on("workflow_get", auth, async (ctx) => {
  const { id } = ctx.body as { id: string };
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data, error } = await ctx.sb
    .from("workflows")
    .select("*")
    .eq("id", id)
    .eq("escola_id", ctx.escola_id)
    .maybeSingle();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  if (!data) throw new AppError("NOT_FOUND", "Workflow não encontrado.");
  return successResponse(data);
});

router.on("workflow_create", auth, async (ctx) => {
  const body = ctx.body as Record<string, unknown>;
  const { nome, descricao, trigger_tipo, trigger_config, condicoes, acoes } = body;
  if (!nome || !trigger_tipo || !acoes) {
    throw new AppError("VALIDATION_FAILED", "nome, trigger_tipo e acoes são obrigatórios.");
  }
  if (!["evento", "cron", "manual"].includes(trigger_tipo as string)) {
    throw new AppError("VALIDATION_FAILED", "trigger_tipo deve ser evento, cron ou manual.");
  }
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");

  const { data, error } = await ctx.sb
    .from("workflows")
    .insert({
      escola_id: ctx.escola_id,
      nome,
      descricao: descricao ?? null,
      trigger_tipo,
      trigger_config: trigger_config ?? {},
      condicoes: condicoes ?? [],
      acoes,
      criado_por: ctx.user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("workflow criado", { id: data.id, nome });
  return successResponse(data);
});

router.on("workflow_update", auth, async (ctx) => {
  const body = ctx.body as Record<string, unknown>;
  const { id } = body;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");

  const ALLOWED = ["nome", "descricao", "trigger_tipo", "trigger_config", "condicoes", "acoes", "ativo"];
  const update: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  for (const k of ALLOWED) if (k in body) update[k] = body[k];

  const { error } = await ctx.sb
    .from("workflows")
    .update(update)
    .eq("id", id as string)
    .eq("escola_id", ctx.escola_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("workflow_delete", auth, async (ctx) => {
  // Soft delete: ativo=false
  const { id } = ctx.body as { id: string };
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { error } = await ctx.sb
    .from("workflows")
    .update({ ativo: false, atualizado_em: new Date().toISOString() })
    .eq("id", id)
    .eq("escola_id", ctx.escola_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("workflow_toggle", auth, async (ctx) => {
  const { id, ativo } = ctx.body as { id: string; ativo: boolean };
  if (!id || ativo === undefined) throw new AppError("VALIDATION_FAILED", "id e ativo obrigatórios.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { error } = await ctx.sb
    .from("workflows")
    .update({ ativo, atualizado_em: new Date().toISOString() })
    .eq("id", id)
    .eq("escola_id", ctx.escola_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true, ativo });
});

router.on("workflow_execucoes_list", auth, async (ctx) => {
  const body = ctx.body as Record<string, unknown>;
  const { workflow_id, limit = 50 } = body;
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");

  let q = ctx.sb
    .from("workflow_execucoes")
    .select("id,workflow_id,status,trigger_data,resultado,erro,iniciado_em,finalizado_em")
    .eq("escola_id", ctx.escola_id)
    .order("iniciado_em", { ascending: false })
    .limit(Math.min(Number(limit), 200));

  if (workflow_id) q = q.eq("workflow_id", workflow_id as string);

  const { data, error } = await q;
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data ?? []);
});

// ─────────────────────────────────────────────────────────────
//  Action executor (internal)
// ─────────────────────────────────────────────────────────────

type AcaoConfig = {
  tipo: string;
  [key: string]: unknown;
};

type ActionResult = {
  tipo: string;
  ok: boolean;
  detalhe?: string;
  erro?: string;
};

async function executarAcao(
  sb: ReturnType<typeof createClient>,
  escola_id: string,
  execucao_id: string,
  acao: AcaoConfig,
  contexto: Record<string, unknown>,
): Promise<ActionResult> {
  const base = { tipo: acao.tipo, ok: false };
  try {
    switch (acao.tipo) {
      case "enviar_email": {
        const { assunto, para, template, vars } = acao as {
          assunto: string;
          para: string;
          template: string;
          vars?: Record<string, unknown>;
        };
        const mergedVars = { ...contexto, ...(vars ?? {}) };
        // Resolve recipient email from context
        const toEmail = resolveEmail(para, contexto);
        if (!toEmail) return { ...base, erro: `Email não encontrado para destinatário: ${para}` };
        await invokeFunction("send-email", {
          action: "generico",
          para: toEmail,
          assunto: interpolate(assunto, mergedVars),
          corpo: buildEmailCorpo(template, mergedVars),
          escola_id,
        });
        return { ...base, ok: true, detalhe: `Email enviado para ${toEmail}` };
      }

      case "enviar_whatsapp": {
        const { mensagem, para } = acao as { mensagem: string; para: string };
        const phone = resolvePhone(para, contexto);
        if (!phone) return { ...base, erro: `Telefone não encontrado para: ${para}` };
        await invokeFunction("whatsapp-gateway", {
          action: "enviar_mensagem",
          telefone: phone,
          mensagem: interpolate(mensagem, contexto),
          escola_id,
        });
        return { ...base, ok: true, detalhe: `WhatsApp enviado para ${phone}` };
      }

      case "criar_notificacao": {
        const { mensagem, para, prioridade = "normal" } = acao as {
          mensagem: string;
          para: string;
          prioridade?: string;
        };
        const { error } = await sb.from("notificacoes").insert({
          escola_id,
          tipo: "workflow",
          destinatario_papel: para,
          mensagem: interpolate(mensagem, contexto),
          prioridade,
          lida: false,
          dados: { execucao_id, contexto },
        });
        if (error) return { ...base, erro: error.message };
        return { ...base, ok: true, detalhe: `Notificação criada para papel: ${para}` };
      }

      case "criar_tarefa": {
        const { titulo, descricao, atribuir, prioridade = "normal" } = acao as {
          titulo?: string;
          descricao?: string;
          atribuir: string;
          prioridade?: string;
        };
        const { error } = await sb.from("tarefas").insert({
          escola_id,
          titulo: interpolate(titulo ?? "Tarefa gerada por workflow", contexto),
          descricao: descricao ? interpolate(descricao, contexto) : null,
          atribuido_para: atribuir,
          prioridade,
          contexto,
          workflow_execucao_id: execucao_id,
        });
        if (error) return { ...base, erro: error.message };
        return { ...base, ok: true, detalhe: `Tarefa criada para: ${atribuir}` };
      }

      case "atualizar_campo": {
        const { tabela, campo, valor, id_campo = "id" } = acao as {
          tabela: string;
          campo: string;
          valor: unknown;
          id_campo?: string;
        };
        const registroId = contexto[id_campo] ?? contexto.id;
        if (!registroId) return { ...base, erro: "ID do registro não encontrado no contexto." };
        // Allowlist to prevent arbitrary table writes
        const TABELAS_PERMITIDAS = ["alunos", "leads", "matriculas", "boletos", "tarefas"];
        if (!TABELAS_PERMITIDAS.includes(tabela)) {
          return { ...base, erro: `Tabela '${tabela}' não permitida para atualização.` };
        }
        const { error } = await sb
          .from(tabela)
          .update({ [campo]: valor })
          .eq(id_campo, registroId as string)
          .eq("escola_id", escola_id);
        if (error) return { ...base, erro: error.message };
        return { ...base, ok: true, detalhe: `${tabela}.${campo} atualizado` };
      }

      default:
        return { ...base, erro: `Tipo de ação desconhecido: ${acao.tipo}` };
    }
  } catch (e) {
    return { ...base, erro: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────────────────────────────────────────
//  Workflow execution
// ─────────────────────────────────────────────────────────────

async function executarWorkflow(
  sb: ReturnType<typeof createClient>,
  workflow: Record<string, unknown>,
  triggerData: Record<string, unknown>,
): Promise<void> {
  const escola_id = workflow.escola_id as string;
  const acoes = (workflow.acoes as AcaoConfig[]) ?? [];

  // Create execution record
  const { data: execucao, error: execErr } = await sb
    .from("workflow_execucoes")
    .insert({
      escola_id,
      workflow_id: workflow.id,
      status: "executando",
      trigger_data: triggerData,
    })
    .select("id")
    .single();
  if (execErr || !execucao) {
    log.error("Falha ao criar registro de execução", { workflow_id: workflow.id, err: execErr?.message });
    return;
  }

  const execucao_id = execucao.id as string;
  const resultados: ActionResult[] = [];
  let temFalha = false;

  for (const acao of acoes) {
    const result = await executarAcao(sb, escola_id, execucao_id, acao, triggerData);
    resultados.push(result);
    if (!result.ok) temFalha = true;
  }

  const status = resultados.every((r) => r.ok)
    ? "sucesso"
    : resultados.some((r) => r.ok)
    ? "parcial"
    : "falha";

  await sb
    .from("workflow_execucoes")
    .update({ status, resultado: { acoes: resultados }, finalizado_em: new Date().toISOString() })
    .eq("id", execucao_id);

  await sb
    .from("workflows")
    .update({
      execucoes_total: (workflow.execucoes_total as number ?? 0) + 1,
      ultima_execucao: new Date().toISOString(),
    })
    .eq("id", workflow.id as string);

  if (temFalha) {
    log.warn("Workflow com falhas parciais", { workflow_id: workflow.id, status });
  }
}

// ─────────────────────────────────────────────────────────────
//  Manual trigger
// ─────────────────────────────────────────────────────────────

router.on("workflow_executar", auth, async (ctx) => {
  const { id, trigger_data = {} } = ctx.body as { id: string; trigger_data?: Record<string, unknown> };
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");

  const { data: workflow, error } = await ctx.sb
    .from("workflows")
    .select("*")
    .eq("id", id)
    .eq("escola_id", ctx.escola_id)
    .maybeSingle();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  if (!workflow) throw new AppError("NOT_FOUND", "Workflow não encontrado.");

  // Execute asynchronously — don't block the response
  executarWorkflow(ctx.sb, workflow as Record<string, unknown>, trigger_data).catch((e) =>
    log.error("Erro executando workflow manual", { id, err: e?.message })
  );

  return successResponse({ success: true, message: "Workflow iniciado." });
});

// ─────────────────────────────────────────────────────────────
//  Cron endpoint: processar workflows de evento
//  Called by pg_cron or external scheduler — uses CRON_INTERNAL_KEY
// ─────────────────────────────────────────────────────────────

router.on("workflow_processar_eventos", async (ctx) => {
  const cronKey = Deno.env.get("CRON_INTERNAL_KEY");
  const authHeader = ctx.req.headers.get("authorization") ?? "";
  const bodyKey = (ctx.body as Record<string, unknown>)._cron_key as string | undefined;
  if (!cronKey || (authHeader !== `Bearer ${cronKey}` && bodyKey !== cronKey)) {
    throw new AppError("AUTH_REQUIRED", "Chave de cron inválida.");
  }

  const sbAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Fetch all active event-triggered workflows
  const { data: workflows, error } = await sbAdmin
    .from("workflows")
    .select("*")
    .eq("ativo", true)
    .eq("trigger_tipo", "evento");
  if (error) throw new AppError("BAD_REQUEST", error.message);
  if (!workflows?.length) return successResponse({ processed: 0 });

  let processed = 0;
  for (const wf of workflows) {
    const config = (wf.trigger_config ?? {}) as Record<string, unknown>;
    const evento = config.evento as string | undefined;
    if (!evento) continue;

    // Check if this event has pending triggers
    const triggerData = await resolveEventoData(sbAdmin, wf as Record<string, unknown>, config);
    if (!triggerData) continue;

    await executarWorkflow(sbAdmin, wf as Record<string, unknown>, triggerData);
    processed++;
  }

  log.info("workflow_processar_eventos concluído", { processed });
  return successResponse({ processed });
});

// ─────────────────────────────────────────────────────────────
//  Event data resolver
// ─────────────────────────────────────────────────────────────

async function resolveEventoData(
  sb: ReturnType<typeof createClient>,
  workflow: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const evento = config.evento as string;
  const condicao = (config.condicao ?? {}) as Record<string, unknown>;
  const escola_id = workflow.escola_id as string;

  switch (evento) {
    case "aluno_falta": {
      const minFaltas = Number(condicao.faltas_consecutivas ?? 3);
      // Find students with consecutive absences >= threshold
      const { data } = await sb.rpc("get_alunos_faltas_consecutivas", {
        p_escola_id: escola_id,
        p_min_faltas: minFaltas,
      }).maybeSingle();
      return data ? { ...(data as Record<string, unknown>), evento } : null;
    }

    case "lead_sem_atividade": {
      const diasInativo = Number(condicao.dias_inativo ?? 7);
      const corte = new Date(Date.now() - diasInativo * 86400_000).toISOString();
      const { data } = await sb
        .from("leads")
        .select("id,nome,email,etapa,ultima_atividade")
        .eq("escola_id", escola_id)
        .lt("ultima_atividade", corte)
        .eq("status", "ativo")
        .limit(1)
        .maybeSingle();
      if (!data) return null;
      const d = data as Record<string, unknown>;
      return {
        evento,
        lead_id: d.id,
        lead_nome: d.nome,
        lead_email: d.email,
        lead_etapa: d.etapa,
        dias_inativo: diasInativo,
      };
    }

    case "matricula_criada": {
      // Check for enrollments in the last cron interval (1 hour)
      const { data } = await sb
        .from("matriculas")
        .select("id,aluno_id,turma_id,data_inicio,alunos(nome),turmas(nome)")
        .eq("escola_id", escola_id)
        .gte("criado_em", new Date(Date.now() - 3_600_000).toISOString())
        .limit(1)
        .maybeSingle();
      if (!data) return null;
      const d = data as Record<string, unknown>;
      // deno-lint-ignore no-explicit-any
      const aluno = (d.alunos as any)?.nome ?? "Aluno";
      // deno-lint-ignore no-explicit-any
      const turma = (d.turmas as any)?.nome ?? "Turma";
      return { evento, matricula_id: d.id, aluno_nome: aluno, turma_nome: turma, data_inicio: d.data_inicio };
    }

    default:
      // Unknown event type — skip silently
      return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`));
}

function resolveEmail(para: string, ctx: Record<string, unknown>): string | null {
  // Direct email in context
  if (para === "responsavel" || para === "responsavel_financeiro") {
    return (ctx.responsavel_email ?? ctx.email) as string | null;
  }
  if (para === "secretaria") return (ctx.secretaria_email) as string | null;
  // Treat as literal email address
  if (para.includes("@")) return para;
  return null;
}

function resolvePhone(para: string, ctx: Record<string, unknown>): string | null {
  if (para === "responsavel") return (ctx.responsavel_telefone ?? ctx.telefone) as string | null;
  return null;
}

function buildEmailCorpo(template: string, vars: Record<string, unknown>): string {
  const escola = String(vars.escola_nome ?? "Escola");
  const cor = String(vars.escola_cor ?? "#2563EB");

  const templateBodies: Record<string, string> = {
    lembrete_boleto: `
      <p>Prezado(a) responsável,</p>
      <p>Lembramos que o boleto de <strong>{{aluno}}</strong> vence em <strong>{{vencimento}}</strong>.</p>
      <p>Valor: <strong>R$ {{valor}}</strong></p>
      <p>Efetue o pagamento para evitar encargos por atraso.</p>
    `,
    boas_vindas_matricula: `
      <p>Seja muito bem-vindo(a) à <strong>${escola}</strong>!</p>
      <p>A matrícula de <strong>{{aluno}}</strong> na turma <strong>{{turma}}</strong> foi confirmada.</p>
      <p>Data de início: <strong>{{inicio}}</strong>.</p>
      <p>Estamos felizes em tê-los conosco! Em caso de dúvidas, entre em contato com a secretaria.</p>
    `,
  };

  const corpo = interpolate(templateBodies[template] ?? `<p>${template}</p>`, vars);
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:${cor};">${escola}</h2>
      ${corpo}
      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;">
      <p style="color:#6b7280;font-size:12px;">Este é um e-mail automático. Não responda a este endereço.</p>
    </div>
  `;
}

async function invokeFunction(name: string, payload: Record<string, unknown>): Promise<void> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`;
  const key = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`invokeFunction ${name} falhou: ${res.status} ${text}`);
  }
}

// ─────────────────────────────────────────────────────────────
//  Entry point
// ─────────────────────────────────────────────────────────────

serve((req) => router.handle(req));
