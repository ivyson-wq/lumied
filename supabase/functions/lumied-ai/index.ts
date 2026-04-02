// ═══════════════════════════════════════════════════════════════
//  Edge Function: lumied-ai — Inteligência Operacional Nativa
//  Gera insights, responde perguntas, analisa dados, prevê tendências
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, authProfessora } from "../_shared/router.ts";
import { successResponse, AppError } from "../_shared/errors.ts";
import { askClaude, SYSTEM_PROMPTS, buildContextFromData } from "../_shared/ai.ts";

const router = new Router("lumied-ai");
router.useGlobal(rateLimit({ maxRequests: 30, windowMs: 60000 }));

// ═══════════════════════════════════════════════════════
//  ASSISTENTE — Pergunta livre com contexto de dados
// ═══════════════════════════════════════════════════════

router.on("ai_perguntar", authGerente, async (ctx) => {
  const { pergunta, portal = "gerente" } = ctx.body as any;
  if (!pergunta) throw new AppError("VALIDATION_FAILED", "Pergunta obrigatória.");

  // Coletar contexto real do banco
  const contexto = await coletarContexto(ctx.sb, portal);
  const system = SYSTEM_PROMPTS[portal as keyof typeof SYSTEM_PROMPTS] || SYSTEM_PROMPTS.gerente;

  const prompt = `CONTEXTO DA ESCOLA (dados reais):
${buildContextFromData(contexto)}

PERGUNTA DO USUÁRIO:
${pergunta}`;

  const resposta = await askClaude(prompt, { system, maxTokens: 600 });
  if (!resposta) throw new AppError("INTERNAL_ERROR", "IA indisponível no momento.");

  // Registrar conversa
  await ctx.sb.from("ia_conversas").insert({
    portal, usuario_id: ctx.user?.id, usuario_nome: ctx.user?.nome,
    mensagens: [
      { role: "user", content: pergunta, ts: new Date().toISOString() },
      { role: "assistant", content: resposta.text, ts: new Date().toISOString() },
    ],
    total_mensagens: 2,
    tokens_total: resposta.tokens_input + resposta.tokens_output,
    custo_total: resposta.cost,
  });

  return successResponse({ resposta: resposta.text, tokens: resposta.tokens_input + resposta.tokens_output });
});

// Professora também pode perguntar
router.on("ai_perguntar_prof", authProfessora, async (ctx) => {
  const { pergunta } = ctx.body as any;
  if (!pergunta) throw new AppError("VALIDATION_FAILED", "Pergunta obrigatória.");

  const contexto = await coletarContextoProfessora(ctx.sb, ctx.user?.id);
  const prompt = `CONTEXTO (dados reais da turma):
${buildContextFromData(contexto)}

PERGUNTA DA PROFESSORA:
${pergunta}`;

  const resposta = await askClaude(prompt, { system: SYSTEM_PROMPTS.professora, maxTokens: 400 });
  if (!resposta) throw new AppError("INTERNAL_ERROR", "IA indisponível.");

  return successResponse({ resposta: resposta.text });
});

// ═══════════════════════════════════════════════════════
//  INSIGHTS — Geração automática diária
// ═══════════════════════════════════════════════════════

router.on("gerar_insights_diarios", async (ctx) => {
  const dados = await coletarContexto(ctx.sb, "gerente");
  const insights: any[] = [];

  // 1. Análise financeira
  if (dados.inadimplencia_pct > 5) {
    const ai = await askClaude(
      `A inadimplência da escola está em ${dados.inadimplencia_pct}%. Total em aberto: R$ ${dados.total_em_aberto}. ${dados.total_alunos} alunos. Gere 1 insight com análise e ação sugerida.`,
      { system: SYSTEM_PROMPTS.gerente, maxTokens: 200 }
    );
    if (ai) insights.push({
      portal: "gerente", categoria: "alerta", modulo: "financeiro",
      titulo: `Inadimplência em ${dados.inadimplencia_pct}%`,
      descricao: ai.text, impacto: dados.inadimplencia_pct > 10 ? "alto" : "medio",
      acao_sugerida: "Revisar régua de cobrança e contatar famílias em atraso",
      acao_tipo: "revisar_dados", confianca: 0.90,
      tokens_usados: ai.tokens_input + ai.tokens_output, custo_estimado: ai.cost,
    });
  }

  // 2. Frequência — alunos em risco
  if (dados.alunos_frequencia_baixa > 0) {
    const ai = await askClaude(
      `${dados.alunos_frequencia_baixa} alunos têm frequência abaixo de 75% este mês. Total de alunos: ${dados.total_alunos}. Gere 1 insight com análise e ação.`,
      { system: SYSTEM_PROMPTS.gerente, maxTokens: 200 }
    );
    if (ai) insights.push({
      portal: "gerente", categoria: "alerta", modulo: "frequencia",
      titulo: `${dados.alunos_frequencia_baixa} alunos com frequência crítica`,
      descricao: ai.text, impacto: "alto",
      acao_sugerida: "Agendar reunião com famílias dos alunos em risco",
      acao_tipo: "agendar_reuniao", confianca: 0.85,
    });
  }

  // 3. CRM — leads parados
  if (dados.leads_parados > 0) {
    insights.push({
      portal: "gerente", categoria: "oportunidade", modulo: "crm",
      titulo: `${dados.leads_parados} leads sem contato há 7+ dias`,
      descricao: `Existem ${dados.leads_parados} famílias interessadas que não receberam follow-up nos últimos 7 dias. Cada dia sem contato reduz a chance de conversão em ~10%.`,
      impacto: "medio", acao_sugerida: "Abrir CRM e fazer follow-up dos leads parados",
      acao_tipo: "revisar_dados", confianca: 0.95,
    });
  }

  // 4. Compliance — prazos próximos
  if (dados.prazos_proximos > 0) {
    insights.push({
      portal: "gerente", categoria: "alerta", modulo: "compliance",
      titulo: `${dados.prazos_proximos} prazo(s) de compliance nos próximos 30 dias`,
      descricao: `Há obrigações regulatórias vencendo em breve. Verifique o calendário de compliance para evitar multas ou pendências legais.`,
      impacto: "alto", acao_sugerida: "Acessar Compliance → Calendário",
      acao_tipo: "revisar_dados", confianca: 0.99,
    });
  }

  // 5. Resumo diário inteligente
  const resumoAi = await askClaude(
    `Dados da escola hoje:
- ${dados.total_alunos} alunos, ${dados.presentes_hoje || '?'} presentes hoje
- ${dados.mensagens_enviadas_semana || 0} mensagens enviadas esta semana
- ${dados.boletos_vencendo_semana || 0} boletos vencem esta semana
- CRM: ${dados.leads_novos_semana || 0} leads novos esta semana

Gere um resumo de 2-3 frases sobre o dia da escola. Tom: direto e útil.`,
    { system: SYSTEM_PROMPTS.gerente, maxTokens: 150 }
  );
  if (resumoAi) insights.push({
    portal: "gerente", categoria: "resumo", modulo: "geral",
    titulo: "Resumo do dia",
    descricao: resumoAi.text, impacto: "baixo",
    confianca: 0.80, expira_em: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    tokens_usados: resumoAi.tokens_input + resumoAi.tokens_output, custo_estimado: resumoAi.cost,
  });

  // Salvar insights
  for (const insight of insights) {
    await ctx.sb.from("ia_insights").insert(insight);
  }

  return successResponse({ gerados: insights.length });
});

// ═══════════════════════════════════════════════════════
//  INSIGHTS — Listar para o portal
// ═══════════════════════════════════════════════════════

router.on("ai_insights_list", authGerente, async (ctx) => {
  const { portal = "gerente", categoria } = ctx.body as any;
  let q = ctx.sb.from("ia_insights")
    .select("*")
    .eq("portal", portal)
    .eq("status", "ativa")
    .order("criado_em", { ascending: false });
  if (categoria) q = q.eq("categoria", categoria);
  const { data } = await q.limit(20);
  return successResponse(data ?? []);
});

router.on("ai_insight_acao", authGerente, async (ctx) => {
  const { id, status } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const novoStatus = status || "lida";
  await ctx.sb.from("ia_insights").update({
    status: novoStatus,
    ...(novoStatus === "lida" ? { lida_em: new Date().toISOString() } : {}),
    ...(novoStatus === "executada" ? { executada_em: new Date().toISOString() } : {}),
  }).eq("id", id);
  return successResponse({ success: true });
});

// ═══════════════════════════════════════════════════════
//  AÇÕES INTELIGENTES ESPECÍFICAS
// ═══════════════════════════════════════════════════════

// Redigir comunicado para famílias
router.on("ai_redigir_comunicado", authGerente, async (ctx) => {
  const { assunto, tom = "profissional_amigavel", contexto_extra } = ctx.body as any;
  if (!assunto) throw new AppError("VALIDATION_FAILED", "Assunto obrigatório.");
  const ai = await askClaude(
    `Redija um comunicado escolar para os pais sobre: "${assunto}". ${contexto_extra || ''}
Tom: ${tom}. Máximo 5 linhas. Comece com saudação. Termine com assinatura "Equipe [escola]".`,
    { system: "Você é redator de comunicados escolares. Escreva em português brasileiro, tom adequado ao público (famílias).", maxTokens: 300 }
  );
  if (!ai) throw new AppError("INTERNAL_ERROR", "IA indisponível.");
  return successResponse({ texto: ai.text });
});

// Analisar turma (para professora)
router.on("ai_analisar_turma", authProfessora, async (ctx) => {
  const { turma_id } = ctx.body as any;
  const dados = await coletarContextoProfessora(ctx.sb, ctx.user?.id);
  const ai = await askClaude(
    `Dados da turma:\n${buildContextFromData(dados)}\n\nFaça uma análise breve: pontos fortes, pontos de atenção e 1 sugestão pedagógica.`,
    { system: SYSTEM_PROMPTS.professora, maxTokens: 300 }
  );
  if (!ai) throw new AppError("INTERNAL_ERROR", "IA indisponível.");
  return successResponse({ analise: ai.text });
});

// Gerar parecer BNCC
router.on("ai_parecer_bncc", authProfessora, async (ctx) => {
  const { aluno_nome, notas, frequencia, observacoes } = ctx.body as any;
  if (!aluno_nome) throw new AppError("VALIDATION_FAILED", "aluno_nome obrigatório.");
  const ai = await askClaude(
    `Gere um parecer pedagógico (estilo BNCC) para o aluno ${aluno_nome}.
Notas: ${JSON.stringify(notas || {})}
Frequência: ${frequencia || '?'}%
Observações da professora: ${observacoes || 'Nenhuma'}

Parecer deve ter 3-4 frases, mencionando competências da BNCC.
Tom: profissional, positivo, construtivo.`,
    { system: "Você é especialista em pareceres pedagógicos escolares alinhados à BNCC. Escreva em português brasileiro.", maxTokens: 300 }
  );
  if (!ai) throw new AppError("INTERNAL_ERROR", "IA indisponível.");
  return successResponse({ parecer: ai.text });
});

// Prever inadimplência
router.on("ai_previsao_inadimplencia", authGerente, async (ctx) => {
  const dados = await coletarContexto(ctx.sb, "gerente");
  const ai = await askClaude(
    `Dados financeiros da escola:
- Inadimplência atual: ${dados.inadimplencia_pct}%
- Total em aberto: R$ ${dados.total_em_aberto}
- Alunos: ${dados.total_alunos}
- Mês atual: ${new Date().getMonth() + 1}
- Boletos vencendo esta semana: ${dados.boletos_vencendo_semana}

Com base nesses dados, qual a tendência para o próximo mês? Sugira ações preventivas.`,
    { system: SYSTEM_PROMPTS.gerente, maxTokens: 300 }
  );
  if (!ai) throw new AppError("INTERNAL_ERROR", "IA indisponível.");
  return successResponse({ previsao: ai.text });
});

// ═══════════════════════════════════════════════════════
//  COLETA DE CONTEXTO (dados reais do banco)
// ═══════════════════════════════════════════════════════

async function coletarContexto(sb: any, portal: string) {
  const hoje = new Date().toISOString().split("T")[0];
  const semanaAtras = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

  const [alunos, boletos, leads, compliance, frequencia] = await Promise.all([
    sb.from("alunos").select("*", { count: "exact", head: true }).eq("ativo", true),
    sb.from("boletos").select("valor, status, vencimento").eq("status", "pendente"),
    sb.from("crm_leads").select("id, atualizado_em").order("atualizado_em", { ascending: false }),
    sb.from("compliance_calendario").select("*", { count: "exact", head: true }).eq("status", "pendente").lte("data_limite", new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]),
    sb.from("frequencia").select("presente").eq("data", hoje),
  ]);

  const boletosData = boletos.data || [];
  const totalAberto = boletosData.reduce((s: number, b: any) => s + (Number(b.valor) || 0), 0);
  const leadsData = leads.data || [];
  const leadsParados = leadsData.filter((l: any) => l.atualizado_em && l.atualizado_em < semanaAtras).length;
  const freqData = frequencia.data || [];
  const presentes = freqData.filter((f: any) => f.presente).length;

  return {
    total_alunos: alunos.count || 0,
    presentes_hoje: presentes,
    total_em_aberto: totalAberto.toFixed(2),
    boletos_pendentes: boletosData.length,
    inadimplencia_pct: alunos.count ? Math.round((boletosData.length / (alunos.count as number)) * 100) : 0,
    boletos_vencendo_semana: boletosData.filter((b: any) => b.vencimento && b.vencimento <= new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0]).length,
    leads_total: leadsData.length,
    leads_parados: leadsParados,
    leads_novos_semana: leadsData.filter((l: any) => l.atualizado_em >= semanaAtras).length,
    prazos_proximos: compliance.count || 0,
    alunos_frequencia_baixa: 0, // seria calculado com query mais complexa
  };
}

async function coletarContextoProfessora(sb: any, profId: string | undefined) {
  if (!profId) return {};
  const { data: prof } = await sb.from("professoras").select("nome, serie_id").eq("id", profId).single();
  const { data: alunos } = await sb.from("alunos").select("*", { count: "exact", head: true }).eq("serie_id", prof?.serie_id);
  return {
    professora: prof?.nome,
    total_alunos_turma: alunos?.count || 0,
  };
}

// ═══════════════════════════════════════════════════════
//  ROI — Dashboard de retorno real
// ═══════════════════════════════════════════════════════

router.on("roi_dashboard", authGerente, async (ctx) => {
  // Config ROI da escola
  const { data: config } = await ctx.sb.from("roi_config").select("*").limit(1).single();
  const cfg = config || { mensalidade_media_aluno: 2500, salario_medio_admin: 3500, total_staff_admin: 2, custo_hora_admin: 22, taxa_evasao_anterior: 8, taxa_inadimplencia_anterior: 10, operational_savings_rate: 0.30, evasion_reduction_rate: 0.40, default_reduction_rate: 0.20 };

  // Dados reais do mês atual
  const mesAtual = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const { data: snapshot } = await ctx.sb.from("roi_snapshots").select("*").eq("mes", mesAtual).limit(1).single();

  // Dados reais do banco
  const [alunos, boletos, msgs, leads] = await Promise.all([
    ctx.sb.from("alunos").select("*", { count: "exact", head: true }).eq("ativo", true),
    ctx.sb.from("boletos").select("valor, status").eq("status", "pago").gte("criado_em", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    ctx.sb.from("wa_consumo_mensal").select("templates_enviados, textos_livres_enviados").eq("mes", new Date().getMonth() + 1).eq("ano", new Date().getFullYear()).limit(1).single(),
    ctx.sb.from("crm_leads").select("*", { count: "exact", head: true }),
  ]);

  const totalAlunos = (alunos.count as number) || 0;
  const receitaMensal = totalAlunos * cfg.mensalidade_media_aluno;
  const boletosPagos = (boletos.data || []).length;
  const valorArrecadado = (boletos.data || []).reduce((s: number, b: any) => s + Number(b.valor || 0), 0);
  const waMsgs = (msgs.data?.templates_enviados || 0) + (msgs.data?.textos_livres_enviados || 0);

  // Cálculos ROI
  const horasEconMes = Math.round(cfg.total_staff_admin * 176 * cfg.operational_savings_rate);
  const econOperacionalMes = horasEconMes * cfg.custo_hora_admin;
  const alunosRetidosMes = Math.round(totalAlunos * (cfg.taxa_evasao_anterior / 100) * cfg.evasion_reduction_rate / 12);
  const evasaoEvitadaMes = alunosRetidosMes * cfg.mensalidade_media_aluno;
  const inadEvitadaMes = receitaMensal * (cfg.taxa_inadimplencia_anterior / 100) * cfg.default_reduction_rate;
  const totalEconomiaMes = econOperacionalMes + evasaoEvitadaMes + inadEvitadaMes;

  // Histórico (últimos 6 meses)
  const { data: historico } = await ctx.sb.from("roi_snapshots").select("mes, valor_economizado_total, horas_economizadas").order("mes", { ascending: false }).limit(6);

  return successResponse({
    mes: mesAtual,
    metricas_reais: { total_alunos: totalAlunos, boletos_pagos: boletosPagos, valor_arrecadado: valorArrecadado, whatsapp_msgs: waMsgs, leads_total: leads.count || 0 },
    roi_estimado: {
      horas_economizadas_mes: horasEconMes,
      economia_operacional_mes: Math.round(econOperacionalMes),
      evasao_evitada_mes: Math.round(evasaoEvitadaMes),
      inadimplencia_evitada_mes: Math.round(inadEvitadaMes),
      total_economia_mes: Math.round(totalEconomiaMes),
      total_economia_anual: Math.round(totalEconomiaMes * 12),
      alunos_retidos_mes: alunosRetidosMes,
    },
    config: cfg,
    historico: historico ?? [],
  });
});

router.on("roi_config_salvar", authGerente, async (ctx) => {
  const fields = ctx.body as any;
  delete fields.action; delete fields._token;
  const { data: escola } = await ctx.sb.from("escolas").select("id").eq("ativo", true).limit(1).single();
  if (!escola) throw new AppError("NOT_FOUND", "Escola não encontrada.");
  await ctx.sb.from("roi_config").upsert({ escola_id: escola.id, ...fields }, { onConflict: "escola_id" });
  return successResponse({ success: true });
});

router.on("roi_gerar_snapshot", async (ctx) => {
  // Chamado pelo cron mensal
  const mesAtual = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const { data: escolas } = await ctx.sb.from("escolas").select("id").eq("ativo", true);
  let gerados = 0;
  for (const escola of escolas ?? []) {
    const { data: config } = await ctx.sb.from("roi_config").select("*").eq("escola_id", escola.id).single();
    const cfg = config || { mensalidade_media_aluno: 2500, total_staff_admin: 2, custo_hora_admin: 22, taxa_evasao_anterior: 8, taxa_inadimplencia_anterior: 10, operational_savings_rate: 0.30, evasion_reduction_rate: 0.40, default_reduction_rate: 0.20 };
    const { count: totalAlunos } = await ctx.sb.from("alunos").select("*", { count: "exact", head: true }).eq("ativo", true);
    const n = (totalAlunos as number) || 0;
    const horasEcon = Math.round(cfg.total_staff_admin * 176 * cfg.operational_savings_rate);
    const econOp = horasEcon * cfg.custo_hora_admin;
    const evasaoEvit = Math.round(n * (cfg.taxa_evasao_anterior / 100) * cfg.evasion_reduction_rate / 12) * cfg.mensalidade_media_aluno;
    const inadEvit = n * cfg.mensalidade_media_aluno * (cfg.taxa_inadimplencia_anterior / 100) * cfg.default_reduction_rate;
    await ctx.sb.from("roi_snapshots").upsert({
      escola_id: escola.id, mes: mesAtual,
      horas_economizadas: horasEcon,
      minutos_economizados: horasEcon * 60,
      valor_economizado_total: Math.round(econOp + evasaoEvit + inadEvit),
      valor_inadimplencia_evitada: Math.round(inadEvit),
      evasoes_evitadas: Math.round(n * (cfg.taxa_evasao_anterior / 100) * cfg.evasion_reduction_rate / 12),
    }, { onConflict: "escola_id,mes" });
    gerados++;
  }
  return successResponse({ gerados });
});

// ═══════════════════════════════════════════════════════
//  Server
// ═══════════════════════════════════════════════════════
serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
