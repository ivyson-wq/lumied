// ═══════════════════════════════════════════════════════════════
//  Edge Function: compliance (v2 — Router Pattern)
//  Controle de hora extra, importação de ponto, alertas
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, authProfessora, requireFeature } from "../_shared/router.ts";
import { successResponse, AppError } from "../_shared/errors.ts";

const router = new Router("compliance");
router.useGlobal(rateLimit());

const feat = requireFeature("compliance");

// ═══════════════════════════════════════════════════════════════
//  Horários pré-configurados das professoras
// ═══════════════════════════════════════════════════════════════

router.on("compliance_horarios_list", authGerente, feat, async (ctx) => {
  const { professora_id } = ctx.body as any;
  let q = ctx.sb
    .from("compliance_horarios")
    .select("*, professoras(id, nome, email)")
    .eq("ativo", true)
    .order("dia_semana");
  if (professora_id) q = q.eq("professora_id", professora_id);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("compliance_horarios_upsert", authGerente, feat, async (ctx) => {
  const { professora_id, dia_semana, hora_entrada, hora_saida, tolerancia_minutos } = ctx.body as any;
  if (!professora_id || !dia_semana || !hora_entrada || !hora_saida) {
    throw new AppError("VALIDATION_FAILED", "professora_id, dia_semana, hora_entrada e hora_saida são obrigatórios.");
  }
  const { data, error } = await ctx.sb
    .from("compliance_horarios")
    .upsert(
      { professora_id, dia_semana, hora_entrada, hora_saida, tolerancia_minutos: tolerancia_minutos ?? 10 },
      { onConflict: "professora_id,dia_semana" }
    )
    .select()
    .single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("compliance_horarios_bulk", authGerente, feat, async (ctx) => {
  const { professora_id, horarios } = ctx.body as any;
  if (!professora_id || !Array.isArray(horarios)) {
    throw new AppError("VALIDATION_FAILED", "professora_id e horarios[] obrigatórios.");
  }
  const rows = horarios.map((h: any) => ({
    professora_id,
    dia_semana: h.dia_semana,
    hora_entrada: h.hora_entrada,
    hora_saida: h.hora_saida,
    tolerancia_minutos: h.tolerancia_minutos ?? 10,
  }));
  const { error } = await ctx.sb
    .from("compliance_horarios")
    .upsert(rows, { onConflict: "professora_id,dia_semana" });
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true, total: rows.length });
});

router.on("compliance_horarios_delete", authGerente, feat, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { error } = await ctx.sb.from("compliance_horarios").update({ ativo: false }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  Importação manual de arquivo de ponto
// ═══════════════════════════════════════════════════════════════

router.on("compliance_importar_ponto", authGerente, feat, async (ctx) => {
  const { nome_arquivo, registros } = ctx.body as any;
  if (!nome_arquivo || !Array.isArray(registros) || registros.length === 0) {
    throw new AppError("VALIDATION_FAILED", "nome_arquivo e registros[] obrigatórios.");
  }

  // Criar registro de importação
  const { data: importacao, error: impErr } = await ctx.sb
    .from("compliance_ponto_importacoes")
    .insert({
      nome_arquivo,
      tipo: "manual",
      total_registros: registros.length,
      importado_por: ctx.user?.nome ?? "sistema",
    })
    .select()
    .single();
  if (impErr) throw new AppError("BAD_REQUEST", impErr.message);

  // Processar registros
  let processados = 0;
  let erros = 0;

  for (const reg of registros) {
    try {
      const horasTrabalhadas = calcularHoras(reg.hora_entrada, reg.hora_saida);
      const { error } = await ctx.sb.from("compliance_ponto_registros").insert({
        importacao_id: importacao.id,
        professora_id: reg.professora_id,
        data: reg.data,
        hora_entrada: reg.hora_entrada,
        hora_saida: reg.hora_saida,
        horas_trabalhadas: horasTrabalhadas,
      });
      if (error) { erros++; } else { processados++; }
    } catch { erros++; }
  }

  // Atualizar importação
  await ctx.sb.from("compliance_ponto_importacoes").update({
    registros_processados: processados,
    registros_com_erro: erros,
    status: erros === registros.length ? "erro" : "concluido",
  }).eq("id", importacao.id);

  return successResponse({
    importacao_id: importacao.id,
    total: registros.length,
    processados,
    erros,
  });
});

router.on("compliance_importacoes_list", authGerente, feat, async (ctx) => {
  const { data } = await ctx.sb
    .from("compliance_ponto_importacoes")
    .select("*")
    .order("criado_em", { ascending: false })
    .limit(50);
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  Verificação de ponto — detectar hora extra não autorizada
// ═══════════════════════════════════════════════════════════════

router.on("compliance_verificar_ponto", authGerente, feat, async (ctx) => {
  const { data_inicio, data_fim } = ctx.body as any;
  const resultado = await verificarPonto(ctx.sb, data_inicio, data_fim);
  return successResponse(resultado);
});

// Chamado automaticamente pelo cron (sem auth — usa service_role_key)
router.on("compliance_verificar_ponto_auto", async (ctx) => {
  // Verifica os últimos 2 dias úteis
  const hoje = new Date();
  const dataFim = hoje.toISOString().split("T")[0];
  const dataInicio = new Date(hoje.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const resultado = await verificarPonto(ctx.sb, dataInicio, dataFim);
  return successResponse(resultado);
});

// ═══════════════════════════════════════════════════════════════
//  Ocorrências
// ═══════════════════════════════════════════════════════════════

router.on("compliance_ocorrencias_list", authGerente, feat, async (ctx) => {
  const { status, professora_id, data_inicio, data_fim } = ctx.body as any;
  let q = ctx.sb
    .from("compliance_ocorrencias")
    .select("*, professoras(id, nome, email)")
    .order("data_ocorrencia", { ascending: false });
  if (status) q = q.eq("status", status);
  if (professora_id) q = q.eq("professora_id", professora_id);
  if (data_inicio) q = q.gte("data_ocorrencia", data_inicio);
  if (data_fim) q = q.lte("data_ocorrencia", data_fim);
  const { data } = await q.limit(200);
  return successResponse(data ?? []);
});

router.on("compliance_confirmar_ocorrencia", authGerente, feat, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID da ocorrência obrigatório.");

  // Buscar ocorrência com dados da professora
  const { data: ocorrencia } = await ctx.sb
    .from("compliance_ocorrencias")
    .select("*, professoras(id, nome, email)")
    .eq("id", id)
    .single();
  if (!ocorrencia) throw new AppError("NOT_FOUND", "Ocorrência não encontrada.");
  if (ocorrencia.status !== "pendente") {
    throw new AppError("BAD_REQUEST", "Ocorrência já foi processada.");
  }

  // Marcar como confirmada
  await ctx.sb.from("compliance_ocorrencias").update({
    status: "confirmada",
    confirmada_por: ctx.user?.nome ?? "gerente",
    confirmada_em: new Date().toISOString(),
  }).eq("id", id);

  // Enviar e-mail de alerta
  const prof = (ocorrencia as any).professoras;
  let alertaEnviado = false;
  if (prof?.email) {
    const alerta = await enviarAlertaHoraExtra(ctx.sb, ocorrencia, prof);
    alertaEnviado = alerta.enviado;
  }

  // Criar ciência pendente para a professora (bloqueará o app até confirmação com selfie)
  const dataFmt = String(ocorrencia.data_ocorrencia).split("-").reverse().join("/");
  await ctx.sb.from("compliance_ciencias").insert({
    professora_id: ocorrencia.professora_id,
    ocorrencia_id: id,
    tipo: "hora_extra",
    titulo: `Hora extra não autorizada — ${dataFmt}`,
    descricao: `Foi registrada hora extra não autorizada no dia ${dataFmt}. Saída prevista: ${ocorrencia.hora_prevista_saida}. Saída real: ${ocorrencia.hora_real_saida}. Excedente: ${ocorrencia.minutos_excedentes} minutos. Conforme política da escola, horas extras devem ser previamente autorizadas pela coordenação.`,
    data_referencia: ocorrencia.data_ocorrencia,
  });

  return successResponse({ confirmada: true, alerta_enviado: alertaEnviado, ciencia_criada: true });
});

router.on("compliance_justificar_ocorrencia", authGerente, feat, async (ctx) => {
  const { id, justificativa, status } = ctx.body as any;
  if (!id || !justificativa) throw new AppError("VALIDATION_FAILED", "ID e justificativa obrigatórios.");
  const novoStatus = status === "descartada" ? "descartada" : "justificada";
  const { error } = await ctx.sb.from("compliance_ocorrencias").update({
    status: novoStatus,
    justificativa,
    confirmada_por: ctx.user?.nome ?? "gerente",
    confirmada_em: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true, status: novoStatus });
});

// ═══════════════════════════════════════════════════════════════
//  Alertas enviados
// ═══════════════════════════════════════════════════════════════

router.on("compliance_alertas_list", authGerente, feat, async (ctx) => {
  const { professora_id } = ctx.body as any;
  let q = ctx.sb
    .from("compliance_alertas")
    .select("*, professoras(id, nome, email), compliance_ocorrencias(data_ocorrencia, minutos_excedentes)")
    .order("criado_em", { ascending: false });
  if (professora_id) q = q.eq("professora_id", professora_id);
  const { data } = await q.limit(100);
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  Dashboard
// ═══════════════════════════════════════════════════════════════

router.on("compliance_dashboard", authGerente, feat, async (ctx) => {
  const { mes, ano } = ctx.body as any;
  const anoAtual = ano || new Date().getFullYear();
  const mesAtual = mes || new Date().getMonth() + 1;
  const dataInicio = `${anoAtual}-${String(mesAtual).padStart(2, "0")}-01`;
  const dataFim = `${anoAtual}-${String(mesAtual).padStart(2, "0")}-31`;

  const [ocorrencias, alertas, importacoes] = await Promise.all([
    ctx.sb.from("compliance_ocorrencias")
      .select("status", { count: "exact" })
      .gte("data_ocorrencia", dataInicio)
      .lte("data_ocorrencia", dataFim),
    ctx.sb.from("compliance_alertas")
      .select("enviado", { count: "exact" })
      .gte("criado_em", dataInicio),
    ctx.sb.from("compliance_ponto_importacoes")
      .select("status", { count: "exact" })
      .gte("criado_em", dataInicio),
  ]);

  // Contar ocorrências por status
  const { data: porStatus } = await ctx.sb
    .from("compliance_ocorrencias")
    .select("status")
    .gte("data_ocorrencia", dataInicio)
    .lte("data_ocorrencia", dataFim);

  const contagem = { pendente: 0, confirmada: 0, justificada: 0, descartada: 0 };
  (porStatus ?? []).forEach((r: any) => {
    if (r.status in contagem) contagem[r.status as keyof typeof contagem]++;
  });

  // Top professoras com mais ocorrências no mês
  const { data: topProf } = await ctx.sb
    .from("compliance_ocorrencias")
    .select("professora_id, professoras(nome)")
    .gte("data_ocorrencia", dataInicio)
    .lte("data_ocorrencia", dataFim);

  const profMap = new Map<string, { nome: string; total: number }>();
  (topProf ?? []).forEach((r: any) => {
    const nome = r.professoras?.nome ?? "N/A";
    const cur = profMap.get(r.professora_id) ?? { nome, total: 0 };
    cur.total++;
    profMap.set(r.professora_id, cur);
  });
  const ranking = [...profMap.entries()]
    .map(([id, v]) => ({ professora_id: id, nome: v.nome, total_ocorrencias: v.total }))
    .sort((a, b) => b.total_ocorrencias - a.total_ocorrencias)
    .slice(0, 10);

  return successResponse({
    mes: mesAtual,
    ano: anoAtual,
    total_ocorrencias: ocorrencias.count ?? 0,
    total_alertas: alertas.count ?? 0,
    total_importacoes: importacoes.count ?? 0,
    ocorrencias_por_status: contagem,
    ranking_professoras: ranking,
  });
});

// ═══════════════════════════════════════════════════════════════
//  INCIDENTES / PROTEÇÃO AO ALUNO
// ═══════════════════════════════════════════════════════════════

router.on("compliance_incidentes_list", authGerente, feat, async (ctx) => {
  const { tipo, gravidade, status } = ctx.body as any;
  let q = ctx.sb.from("compliance_incidentes").select("*").order("data_ocorrencia", { ascending: false });
  if (tipo) q = q.eq("tipo", tipo);
  if (gravidade) q = q.eq("gravidade", gravidade);
  if (status) q = q.eq("status", status);
  const { data } = await q.limit(200);
  return successResponse(data ?? []);
});

router.on("compliance_incidente_criar", authGerente, feat, async (ctx) => {
  const { tipo, gravidade, descricao, data_ocorrencia, local_ocorrencia, vitima_nome, agressor_nome, testemunhas, anonimo } = ctx.body as any;
  if (!tipo || !descricao || !data_ocorrencia) throw new AppError("VALIDATION_FAILED", "tipo, descricao e data_ocorrencia obrigatórios.");
  const { data, error } = await ctx.sb.from("compliance_incidentes").insert({
    tipo, gravidade: gravidade || "media", descricao, data_ocorrencia, local_ocorrencia,
    vitima_nome, agressor_nome, testemunhas, anonimo: anonimo || false,
    registrado_por: ctx.user?.nome ?? "sistema", registrado_por_tipo: "gerente",
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  await ctx.sb.from("compliance_incidentes_historico").insert({
    incidente_id: data.id, acao: "criado", descricao: "Incidente registrado", realizado_por: ctx.user?.nome ?? "sistema",
  });
  return successResponse(data);
});

router.on("compliance_incidente_atualizar", authGerente, feat, async (ctx) => {
  const { id, status, medidas_tomadas, parecer_final, encaminhamento_externo, pais_notificados, investigador } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const fields: Record<string, unknown> = {};
  if (status) fields.status = status;
  if (medidas_tomadas) fields.medidas_tomadas = medidas_tomadas;
  if (parecer_final) fields.parecer_final = parecer_final;
  if (encaminhamento_externo) fields.encaminhamento_externo = encaminhamento_externo;
  if (investigador) fields.investigador = investigador;
  if (pais_notificados) { fields.pais_notificados = true; fields.pais_notificados_em = new Date().toISOString(); }
  const { error } = await ctx.sb.from("compliance_incidentes").update(fields).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  if (status) {
    await ctx.sb.from("compliance_incidentes_historico").insert({
      incidente_id: id, acao: status, descricao: medidas_tomadas || parecer_final || `Status alterado para ${status}`, realizado_por: ctx.user?.nome ?? "sistema",
    });
  }
  return successResponse({ success: true });
});

router.on("compliance_incidente_historico", authGerente, feat, async (ctx) => {
  const { incidente_id } = ctx.body as any;
  if (!incidente_id) throw new AppError("VALIDATION_FAILED", "incidente_id obrigatório.");
  const { data } = await ctx.sb.from("compliance_incidentes_historico").select("*").eq("incidente_id", incidente_id).order("criado_em");
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  CERTIFICAÇÕES E TREINAMENTOS
// ═══════════════════════════════════════════════════════════════

router.on("compliance_cert_tipos_list", authGerente, feat, async (ctx) => {
  const { data } = await ctx.sb.from("compliance_certificacoes_tipos").select("*").eq("ativo", true).order("nome");
  return successResponse(data ?? []);
});

router.on("compliance_cert_list", authGerente, feat, async (ctx) => {
  const { funcionario_id, status } = ctx.body as any;
  let q = ctx.sb.from("compliance_certificacoes").select("*, rh_funcionarios(nome, cargo, departamento), compliance_certificacoes_tipos(nome)").order("data_vencimento");
  if (funcionario_id) q = q.eq("funcionario_id", funcionario_id);
  if (status) q = q.eq("status", status);
  const { data } = await q.limit(300);
  return successResponse(data ?? []);
});

router.on("compliance_cert_criar", authGerente, feat, async (ctx) => {
  const { funcionario_id, tipo_id, data_obtencao, instituicao, numero_certificado, arquivo_url } = ctx.body as any;
  if (!funcionario_id || !tipo_id || !data_obtencao) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios ausentes.");
  const { data: tipo } = await ctx.sb.from("compliance_certificacoes_tipos").select("validade_meses").eq("id", tipo_id).single();
  let data_vencimento = null;
  if (tipo?.validade_meses) {
    const d = new Date(data_obtencao);
    d.setMonth(d.getMonth() + tipo.validade_meses);
    data_vencimento = d.toISOString().split("T")[0];
  }
  const { data, error } = await ctx.sb.from("compliance_certificacoes").insert({
    funcionario_id, tipo_id, data_obtencao, data_vencimento, instituicao, numero_certificado, arquivo_url,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("compliance_treinamentos_list", authGerente, feat, async (ctx) => {
  const { status } = ctx.body as any;
  let q = ctx.sb.from("compliance_treinamentos").select("*, compliance_certificacoes_tipos(nome)").order("data_prevista", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data } = await q.limit(100);
  return successResponse(data ?? []);
});

router.on("compliance_treinamento_criar", authGerente, feat, async (ctx) => {
  const { tipo_id, titulo, descricao, data_prevista, hora_inicio, hora_fim, local, instrutor, max_participantes } = ctx.body as any;
  if (!tipo_id || !titulo || !data_prevista) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  const { data, error } = await ctx.sb.from("compliance_treinamentos").insert({
    tipo_id, titulo, descricao, data_prevista, hora_inicio, hora_fim, local, instrutor, max_participantes,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

// ═══════════════════════════════════════════════════════════════
//  INSPEÇÕES
// ═══════════════════════════════════════════════════════════════

router.on("compliance_inspecao_templates_list", authGerente, feat, async (ctx) => {
  const { data } = await ctx.sb.from("compliance_inspecao_templates").select("*").eq("ativo", true).order("nome");
  return successResponse(data ?? []);
});

router.on("compliance_inspecao_realizar", authGerente, feat, async (ctx) => {
  const { template_id, data_inspecao, respostas, observacoes } = ctx.body as any;
  if (!template_id || !respostas) throw new AppError("VALIDATION_FAILED", "template_id e respostas obrigatórios.");
  const respostasArr = respostas as Array<{ item: string; resposta: unknown; obrigatorio?: boolean }>;
  const totalItens = respostasArr.length;
  const conformes = respostasArr.filter((r: any) => r.resposta === true || r.resposta === "sim").length;
  const conformidade_pct = totalItens > 0 ? Math.round((conformes / totalItens) * 100) : 0;
  const pendencias = respostasArr.filter((r: any) => r.obrigatorio && (r.resposta === false || r.resposta === "nao")).length;
  const { data, error } = await ctx.sb.from("compliance_inspecoes").insert({
    template_id, data_inspecao: data_inspecao || new Date().toISOString().split("T")[0],
    inspetor: ctx.user?.nome ?? "inspetor", respostas, observacoes,
    conformidade_pct, pendencias_criticas: pendencias,
    status: pendencias > 0 ? "pendencias" : conformidade_pct < 70 ? "reprovada" : "concluida",
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("compliance_inspecoes_list", authGerente, feat, async (ctx) => {
  const { template_id } = ctx.body as any;
  let q = ctx.sb.from("compliance_inspecoes").select("*, compliance_inspecao_templates(nome, categoria)").order("data_inspecao", { ascending: false });
  if (template_id) q = q.eq("template_id", template_id);
  const { data } = await q.limit(100);
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  POLÍTICAS E DOCUMENTOS
// ═══════════════════════════════════════════════════════════════

router.on("compliance_politicas_list", authGerente, feat, async (ctx) => {
  const { data } = await ctx.sb.from("compliance_politicas").select("*").order("titulo");
  return successResponse(data ?? []);
});

router.on("compliance_politica_criar", authGerente, feat, async (ctx) => {
  const { titulo, categoria, conteudo_html, arquivo_url, aceite_obrigatorio, aplica_a, vigente_desde, revisao_proxima } = ctx.body as any;
  if (!titulo || !categoria) throw new AppError("VALIDATION_FAILED", "titulo e categoria obrigatórios.");
  const { data, error } = await ctx.sb.from("compliance_politicas").insert({
    titulo, categoria, conteudo_html, arquivo_url, aceite_obrigatorio, aplica_a: aplica_a || "todos",
    vigente_desde, revisao_proxima, criado_por: ctx.user?.nome,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("compliance_politica_aceites", authGerente, feat, async (ctx) => {
  const { politica_id } = ctx.body as any;
  if (!politica_id) throw new AppError("VALIDATION_FAILED", "politica_id obrigatório.");
  const { data } = await ctx.sb.from("compliance_politicas_aceites").select("*").eq("politica_id", politica_id).order("aceito_em", { ascending: false });
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  CALENDÁRIO DE COMPLIANCE
// ═══════════════════════════════════════════════════════════════

router.on("compliance_calendario_list", authGerente, feat, async (ctx) => {
  const { categoria, status } = ctx.body as any;
  let q = ctx.sb.from("compliance_calendario").select("*").order("data_limite");
  if (categoria) q = q.eq("categoria", categoria);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("compliance_calendario_concluir", authGerente, feat, async (ctx) => {
  const { id, evidencia_url, observacoes } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { error } = await ctx.sb.from("compliance_calendario").update({
    status: "concluido", concluido_em: new Date().toISOString(), concluido_por: ctx.user?.nome, evidencia_url, observacoes,
  }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// Verificar prazos — chamado pelo cron diário
router.on("compliance_verificar_prazos_auto", async (ctx) => {
  const hoje = new Date().toISOString().split("T")[0];
  // Marcar como atrasados os que passaram da data
  await ctx.sb.from("compliance_calendario").update({ status: "atrasado" }).lt("data_limite", hoje).in("status", ["pendente", "em_andamento"]);
  // Contar atrasados e próximos
  const { count: atrasados } = await ctx.sb.from("compliance_calendario").select("*", { count: "exact", head: true }).eq("status", "atrasado");
  return successResponse({ verificado: true, atrasados: atrasados ?? 0 });
});

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD EXPANDIDO
// ═══════════════════════════════════════════════════════════════

router.on("compliance_dashboard_completo", authGerente, feat, async (ctx) => {
  const [incidentes, certVencidas, calAtrasados, inspecoes, ocorrencias] = await Promise.all([
    ctx.sb.from("compliance_incidentes").select("*", { count: "exact", head: true }).in("status", ["registrado", "em_investigacao"]),
    ctx.sb.from("compliance_certificacoes").select("*", { count: "exact", head: true }).eq("status", "vencida"),
    ctx.sb.from("compliance_calendario").select("*", { count: "exact", head: true }).eq("status", "atrasado"),
    ctx.sb.from("compliance_inspecoes").select("*", { count: "exact", head: true }).eq("status", "pendencias"),
    ctx.sb.from("compliance_ocorrencias").select("*", { count: "exact", head: true }).eq("status", "pendente"),
  ]);
  // Score de compliance (simplificado)
  const total_problemas = (incidentes.count ?? 0) + (certVencidas.count ?? 0) + (calAtrasados.count ?? 0) + (inspecoes.count ?? 0) + (ocorrencias.count ?? 0);
  const score = Math.max(0, 100 - (total_problemas * 5));
  return successResponse({
    score_compliance: score,
    incidentes_abertos: incidentes.count ?? 0,
    certificacoes_vencidas: certVencidas.count ?? 0,
    prazos_atrasados: calAtrasados.count ?? 0,
    inspecoes_com_pendencias: inspecoes.count ?? 0,
    hora_extra_pendentes: ocorrencias.count ?? 0,
  });
});

// ═══════════════════════════════════════════════════════════════
//  Funções auxiliares
// ═══════════════════════════════════════════════════════════════

function calcularHoras(entrada: string, saida: string): number {
  const [eh, em] = entrada.split(":").map(Number);
  const [sh, sm] = saida.split(":").map(Number);
  const minEntrada = eh * 60 + em;
  const minSaida = sh * 60 + sm;
  return Math.max(0, (minSaida - minEntrada) / 60);
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

async function verificarPonto(
  sb: ReturnType<typeof createClient>,
  dataInicio?: string,
  dataFim?: string,
) {
  // Buscar registros de ponto não verificados no período
  let q = sb
    .from("compliance_ponto_registros")
    .select("*, professoras(id, nome, email)")
    .eq("dentro_horario", true) // ainda não marcados como fora
    .order("data");
  if (dataInicio) q = q.gte("data", dataInicio);
  if (dataFim) q = q.lte("data", dataFim);
  const { data: registros } = await q;

  if (!registros || registros.length === 0) {
    return { verificados: 0, ocorrencias_criadas: 0 };
  }

  // Buscar todos os horários configurados
  const { data: horarios } = await sb
    .from("compliance_horarios")
    .select("*")
    .eq("ativo", true);

  const horariosMap = new Map<string, any[]>();
  (horarios ?? []).forEach((h: any) => {
    const key = `${h.professora_id}_${h.dia_semana}`;
    horariosMap.set(key, [...(horariosMap.get(key) ?? []), h]);
  });

  let ocorrenciasCriadas = 0;

  for (const reg of registros) {
    if (!reg.hora_saida) continue;

    // Calcular dia da semana (1=seg, 7=dom) a partir da data
    const dt = new Date(reg.data + "T12:00:00");
    const jsDow = dt.getDay(); // 0=dom, 1=seg
    const diaSemana = jsDow === 0 ? 7 : jsDow;

    const key = `${reg.professora_id}_${diaSemana}`;
    const configs = horariosMap.get(key);
    if (!configs || configs.length === 0) continue;

    const config = configs[0];
    const saidaPrevista = timeToMinutes(config.hora_saida);
    const saidaReal = timeToMinutes(reg.hora_saida);
    const tolerancia = config.tolerancia_minutos || 10;
    const excedente = saidaReal - saidaPrevista - tolerancia;

    if (excedente > 0) {
      // Verificar se já existe ocorrência para este registro
      const { data: existente } = await sb
        .from("compliance_ocorrencias")
        .select("id")
        .eq("ponto_registro_id", reg.id)
        .limit(1);

      if (!existente || existente.length === 0) {
        await sb.from("compliance_ocorrencias").insert({
          professora_id: reg.professora_id,
          ponto_registro_id: reg.id,
          data_ocorrencia: reg.data,
          hora_prevista_saida: config.hora_saida,
          hora_real_saida: reg.hora_saida,
          minutos_excedentes: excedente,
          tipo: "hora_extra_nao_autorizada",
        });
        ocorrenciasCriadas++;
      }

      // Marcar registro como fora do horário
      await sb.from("compliance_ponto_registros")
        .update({ dentro_horario: false, hora_extra_minutos: excedente })
        .eq("id", reg.id);
    }
  }

  return { verificados: registros.length, ocorrencias_criadas: ocorrenciasCriadas };
}

async function enviarAlertaHoraExtra(
  sb: ReturnType<typeof createClient>,
  ocorrencia: any,
  professora: { id: string; nome: string; email: string },
) {
  const dataFmt = String(ocorrencia.data_ocorrencia).split("-").reverse().join("/");
  const assunto = `⚠️ Alerta de Compliance — Hora Extra Não Autorizada (${dataFmt})`;
  const corpoHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#C8102E;">⚖️ Maple Bear — Alerta de Compliance</h2>
      <p>Prezada <strong>${professora.nome}</strong>,</p>
      <p>Identificamos uma ocorrência de <strong>hora extra não autorizada</strong> no seu registro de ponto:</p>
      <table style="border-collapse:collapse;margin:16px 0;width:100%;">
        <tr style="background:#f9f9f9;">
          <td style="padding:8px 12px;font-weight:bold;border:1px solid #ddd;">Data:</td>
          <td style="padding:8px 12px;border:1px solid #ddd;">${dataFmt}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-weight:bold;border:1px solid #ddd;">Horário previsto de saída:</td>
          <td style="padding:8px 12px;border:1px solid #ddd;">${ocorrencia.hora_prevista_saida}</td>
        </tr>
        <tr style="background:#f9f9f9;">
          <td style="padding:8px 12px;font-weight:bold;border:1px solid #ddd;">Horário real de saída:</td>
          <td style="padding:8px 12px;border:1px solid #ddd;">${ocorrencia.hora_real_saida}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-weight:bold;border:1px solid #ddd;">Tempo excedente:</td>
          <td style="padding:8px 12px;border:1px solid #ddd;color:#C8102E;font-weight:bold;">${ocorrencia.minutos_excedentes} minutos</td>
        </tr>
      </table>
      <p>De acordo com a política da escola, horas extras devem ser <strong>previamente autorizadas pela coordenação</strong>.</p>
      <p>Caso tenha uma justificativa, por favor entre em contato com a coordenação para regularizar a situação.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
      <p style="color:#999;font-size:12px;">Este é um e-mail automático do sistema de Compliance — Maple Bear Portal.<br>
      Não responda a este e-mail.</p>
    </div>
  `;

  // Registrar alerta no banco
  const { data: alerta, error: alertaErr } = await sb
    .from("compliance_alertas")
    .insert({
      ocorrencia_id: ocorrencia.id,
      professora_id: professora.id,
      email_destino: professora.email,
      tipo_alerta: "hora_extra",
      assunto,
      corpo_html: corpoHtml,
    })
    .select()
    .single();

  if (alertaErr) {
    return { id: null, enviado: false, erro: alertaErr.message };
  }

  // Enviar via Resend
  const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_KEY) {
    console.log("[compliance] RESEND_API_KEY não configurada. Alerta registrado mas não enviado.");
    return { id: alerta.id, enviado: false };
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: "Maple Bear Compliance <compliance@maplebear-cs.com.br>",
        to: [professora.email],
        subject: assunto,
        html: corpoHtml,
      }),
    });

    const enviado = resp.ok;
    const erroEnvio = enviado ? null : `Resend retornou ${resp.status}`;

    await sb.from("compliance_alertas").update({ enviado, erro_envio: erroEnvio }).eq("id", alerta.id);

    return { id: alerta.id, enviado };
  } catch (e) {
    const erroMsg = e instanceof Error ? e.message : "Erro desconhecido";
    await sb.from("compliance_alertas").update({ enviado: false, erro_envio: erroMsg }).eq("id", alerta.id);
    return { id: alerta.id, enviado: false };
  }
}

// ═══════════════════════════════════════════════════════════════
//  CIÊNCIA COM SELFIE — Portal da Professora
// ═══════════════════════════════════════════════════════════════

// Professora: listar ciências pendentes (bloqueia o app)
router.on("compliance_ciencias_pendentes", authProfessora, async (ctx) => {
  const profId = ctx.user?.id;
  if (!profId) throw new AppError("AUTH_REQUIRED", "Autenticação necessária.");
  const { data } = await ctx.sb.from("compliance_ciencias")
    .select("*")
    .eq("professora_id", profId)
    .eq("status", "pendente")
    .order("criado_em");
  return successResponse(data ?? []);
});

// Professora: confirmar ciência com selfie
router.on("compliance_ciencia_confirmar", authProfessora, async (ctx) => {
  const { ciencia_id, selfie_base64, ressalva } = ctx.body as any;
  if (!ciencia_id || !selfie_base64) throw new AppError("VALIDATION_FAILED", "ciencia_id e selfie_base64 obrigatórios.");

  // Verificar que pertence à professora
  const profId = ctx.user?.id;
  const { data: ciencia } = await ctx.sb.from("compliance_ciencias")
    .select("id, professora_id, status")
    .eq("id", ciencia_id)
    .single();
  if (!ciencia) throw new AppError("NOT_FOUND", "Ciência não encontrada.");
  if (ciencia.professora_id !== profId) throw new AppError("FORBIDDEN", "Acesso negado.");
  if (ciencia.status !== "pendente") throw new AppError("BAD_REQUEST", "Esta ciência já foi confirmada.");

  // Processar selfie: base64 → buffer → upload Storage
  const base64Data = selfie_base64.replace(/^data:image\/\w+;base64,/, "");
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  // Hash SHA-256 para integridade
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

  // Upload para Supabase Storage (bucket privado)
  const fileName = `${profId}/${ciencia_id}_${Date.now()}.jpg`;
  const { error: uploadErr } = await ctx.sb.storage
    .from("compliance-selfies")
    .upload(fileName, bytes, { contentType: "image/jpeg", upsert: false });
  if (uploadErr) throw new AppError("BAD_REQUEST", "Erro ao salvar selfie: " + uploadErr.message);

  // URL signed (válida por 10 anos — para auditoria)
  const { data: urlData } = await ctx.sb.storage
    .from("compliance-selfies")
    .createSignedUrl(fileName, 315360000); // 10 anos

  const selfieUrl = urlData?.signedUrl || fileName;

  // Atualizar ciência
  const status = ressalva ? "ciente_com_ressalva" : "ciente";
  const { error: updateErr } = await ctx.sb.from("compliance_ciencias").update({
    status,
    ciente_em: new Date().toISOString(),
    selfie_url: selfieUrl,
    selfie_hash: hashHex,
    selfie_metadata: {
      device: ctx.req.headers.get("user-agent") || "unknown",
      timestamp: new Date().toISOString(),
      ip: ctx.ip,
    },
    ressalva: ressalva || null,
    ip_confirmacao: ctx.ip,
    user_agent: ctx.req.headers.get("user-agent"),
  }).eq("id", ciencia_id);
  if (updateErr) throw new AppError("BAD_REQUEST", updateErr.message);

  return successResponse({ success: true, status, selfie_hash: hashHex });
});

// Gerente: criar ciência para professora (ao confirmar ocorrência)
router.on("compliance_ciencia_criar", authGerente, feat, async (ctx) => {
  const { professora_id, ocorrencia_id, tipo, titulo, descricao, data_referencia } = ctx.body as any;
  if (!professora_id || !titulo || !descricao) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  const { data, error } = await ctx.sb.from("compliance_ciencias").insert({
    professora_id, ocorrencia_id, tipo: tipo || "hora_extra", titulo, descricao, data_referencia,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

// Gerente: listar ciências (com filtros)
router.on("compliance_ciencias_list", authGerente, feat, async (ctx) => {
  const { professora_id, status } = ctx.body as any;
  let q = ctx.sb.from("compliance_ciencias")
    .select("*, professoras(id, nome, email)")
    .order("criado_em", { ascending: false });
  if (professora_id) q = q.eq("professora_id", professora_id);
  if (status) q = q.eq("status", status);
  const { data } = await q.limit(200);
  return successResponse(data ?? []);
});

// Gerente: ver selfie de ciência específica
router.on("compliance_ciencia_detalhe", authGerente, feat, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { data } = await ctx.sb.from("compliance_ciencias")
    .select("*, professoras(id, nome, email)")
    .eq("id", id)
    .single();
  if (!data) throw new AppError("NOT_FOUND", "Ciência não encontrada.");
  return successResponse(data);
});

// ═══════════════════════════════════════════════════════════════
//  Server
// ═══════════════════════════════════════════════════════════════
serve(async (req) => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return router.handle(req, sb);
});
