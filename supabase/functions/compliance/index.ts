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

/**
 * Auth middleware that accepts BOTH gerente (legacy) and secretaria/equipe (unified) sessions.
 * 1. Tries gerente_sessoes → gerentes (original authGerente logic)
 * 2. If that fails, tries sessoes → usuarios (unified table), checks allowed papeis
 */
const authGerenteOrSecretaria: import("../_shared/router.ts").Middleware = async (ctx, next) => {
  const token = (ctx.body._token as string) || null;
  if (!token) throw new AppError("AUTH_REQUIRED", "Token de sessão obrigatório.");

  // Try 1: gerente_sessoes → gerentes
  const { data: gerenteSessao } = await ctx.sb
    .from("gerente_sessoes")
    .select("*, gerentes(id, nome, email)")
    .eq("token", token)
    .single();

  if (gerenteSessao && new Date(gerenteSessao.expira_em) >= new Date()) {
    const user = (gerenteSessao as any).gerentes;
    ctx.user = { ...user, tipo: "gerente" };
    return next();
  }

  // Try 2: sessoes → usuarios (unified sessions for secretaria/comercial/etc.)
  const { data: sessaoUnificada } = await ctx.sb
    .from("sessoes")
    .select("*, usuarios(id, nome, email, papeis)")
    .eq("token", token)
    .single();

  if (sessaoUnificada && new Date(sessaoUnificada.expira_em) >= new Date()) {
    const usuario = (sessaoUnificada as any).usuarios;
    const papeisPermitidos = ["gerente", "diretor", "secretaria", "comercial", "financeiro"];
    const papeis: string[] = usuario?.papeis || [];
    if (papeis.some((p: string) => papeisPermitidos.includes(p))) {
      ctx.user = { ...usuario, tipo: papeis[0] };
      return next();
    }
  }

  throw new AppError("AUTH_INVALID", "Sessão inválida ou sem permissão para compliance.");
};

// ═══════════════════════════════════════════════════════════════
//  Horários pré-configurados das professoras
// ═══════════════════════════════════════════════════════════════

router.on("compliance_horarios_list", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_horarios_upsert", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_horarios_bulk", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_horarios_delete", authGerenteOrSecretaria, feat, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { error } = await ctx.sb.from("compliance_horarios").update({ ativo: false }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  Importação manual de arquivo de ponto
// ═══════════════════════════════════════════════════════════════

router.on("compliance_importar_ponto", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_importacoes_list", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_verificar_ponto", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_ocorrencias_list", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_confirmar_ocorrencia", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_justificar_ocorrencia", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_alertas_list", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_dashboard", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_incidentes_list", authGerenteOrSecretaria, feat, async (ctx) => {
  const { tipo, gravidade, status } = ctx.body as any;
  let q = ctx.sb.from("compliance_incidentes").select("*").order("data_ocorrencia", { ascending: false });
  if (tipo) q = q.eq("tipo", tipo);
  if (gravidade) q = q.eq("gravidade", gravidade);
  if (status) q = q.eq("status", status);
  const { data } = await q.limit(200);
  return successResponse(data ?? []);
});

router.on("compliance_incidente_criar", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_incidente_atualizar", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_incidente_historico", authGerenteOrSecretaria, feat, async (ctx) => {
  const { incidente_id } = ctx.body as any;
  if (!incidente_id) throw new AppError("VALIDATION_FAILED", "incidente_id obrigatório.");
  const { data } = await ctx.sb.from("compliance_incidentes_historico").select("*").eq("incidente_id", incidente_id).order("criado_em");
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  CERTIFICAÇÕES E TREINAMENTOS
// ═══════════════════════════════════════════════════════════════

router.on("compliance_cert_tipos_list", authGerenteOrSecretaria, feat, async (ctx) => {
  const { data } = await ctx.sb.from("compliance_certificacoes_tipos").select("*").eq("ativo", true).order("nome");
  return successResponse(data ?? []);
});

router.on("compliance_cert_list", authGerenteOrSecretaria, feat, async (ctx) => {
  const { funcionario_id, status } = ctx.body as any;
  let q = ctx.sb.from("compliance_certificacoes").select("*, rh_funcionarios(nome, cargo, departamento), compliance_certificacoes_tipos(nome)").order("data_vencimento");
  if (funcionario_id) q = q.eq("funcionario_id", funcionario_id);
  if (status) q = q.eq("status", status);
  const { data } = await q.limit(300);
  return successResponse(data ?? []);
});

router.on("compliance_cert_criar", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_treinamentos_list", authGerenteOrSecretaria, feat, async (ctx) => {
  const { status } = ctx.body as any;
  let q = ctx.sb.from("compliance_treinamentos").select("*, compliance_certificacoes_tipos(nome)").order("data_prevista", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data } = await q.limit(100);
  return successResponse(data ?? []);
});

router.on("compliance_treinamento_criar", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_inspecao_templates_list", authGerenteOrSecretaria, feat, async (ctx) => {
  const { data } = await ctx.sb.from("compliance_inspecao_templates").select("*").eq("ativo", true).order("nome");
  return successResponse(data ?? []);
});

router.on("compliance_inspecao_realizar", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_inspecoes_list", authGerenteOrSecretaria, feat, async (ctx) => {
  const { template_id } = ctx.body as any;
  let q = ctx.sb.from("compliance_inspecoes").select("*, compliance_inspecao_templates(nome, categoria)").order("data_inspecao", { ascending: false });
  if (template_id) q = q.eq("template_id", template_id);
  const { data } = await q.limit(100);
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  POLÍTICAS E DOCUMENTOS
// ═══════════════════════════════════════════════════════════════

router.on("compliance_politicas_list", authGerenteOrSecretaria, feat, async (ctx) => {
  const { data } = await ctx.sb.from("compliance_politicas").select("*").order("titulo");
  return successResponse(data ?? []);
});

router.on("compliance_politica_criar", authGerenteOrSecretaria, feat, async (ctx) => {
  const { titulo, categoria, conteudo_html, arquivo_url, aceite_obrigatorio, aplica_a, vigente_desde, revisao_proxima } = ctx.body as any;
  if (!titulo || !categoria) throw new AppError("VALIDATION_FAILED", "titulo e categoria obrigatórios.");
  const { data, error } = await ctx.sb.from("compliance_politicas").insert({
    titulo, categoria, conteudo_html, arquivo_url, aceite_obrigatorio, aplica_a: aplica_a || "todos",
    vigente_desde, revisao_proxima, criado_por: ctx.user?.nome,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("compliance_politica_aceites", authGerenteOrSecretaria, feat, async (ctx) => {
  const { politica_id } = ctx.body as any;
  if (!politica_id) throw new AppError("VALIDATION_FAILED", "politica_id obrigatório.");
  const { data } = await ctx.sb.from("compliance_politicas_aceites").select("*").eq("politica_id", politica_id).order("aceito_em", { ascending: false });
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  CALENDÁRIO DE COMPLIANCE
// ═══════════════════════════════════════════════════════════════

router.on("compliance_calendario_list", authGerenteOrSecretaria, feat, async (ctx) => {
  const { categoria, status } = ctx.body as any;
  let q = ctx.sb.from("compliance_calendario").select("*").order("data_limite");
  if (categoria) q = q.eq("categoria", categoria);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("compliance_calendario_concluir", authGerenteOrSecretaria, feat, async (ctx) => {
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

router.on("compliance_dashboard_completo", authGerenteOrSecretaria, feat, async (ctx) => {
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

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Backward-compatible wrapper — returns decimal hours */
function calcularHoras(entrada: string, saida: string): number {
  const minEntrada = timeToMinutes(entrada);
  const minSaida = timeToMinutes(saida);
  return Math.max(0, (minSaida - minEntrada) / 60);
}

/** Load all ponto config from compliance_config_ponto as a Map<chave, valor> */
async function carregarConfigPonto(sb: ReturnType<typeof createClient>): Promise<Map<string, string>> {
  const { data } = await sb.from("compliance_config_ponto").select("chave, valor");
  const map = new Map<string, string>();
  (data ?? []).forEach((r: any) => map.set(r.chave, r.valor));
  return map;
}

function cfgNum(cfg: Map<string, string>, chave: string, fallback: number): number {
  const v = cfg.get(chave);
  return v ? Number(v) : fallback;
}

/** Calculate night work minutes between two HH:MM times (CLT art. 73) */
function calcularHorasNoturnas(
  entradaMin: number,
  saidaMin: number,
  noturnInicio: number,
  noturnFim: number,
): number {
  // Night period: 22:00 (1320) to 05:00 (300 next day → treat as 1740 if we normalize)
  // We handle the wrap-around by checking two segments
  let noturnaMin = 0;
  const ranges: Array<[number, number]> = [];

  if (noturnInicio > noturnFim) {
    // Crosses midnight: e.g. 22:00-05:00 → [1320,1440] + [0,300]
    ranges.push([noturnInicio, 1440]);
    ranges.push([0, noturnFim]);
  } else {
    ranges.push([noturnInicio, noturnFim]);
  }

  for (const [rStart, rEnd] of ranges) {
    const overlapStart = Math.max(entradaMin, rStart);
    const overlapEnd = Math.min(saidaMin, rEnd);
    if (overlapEnd > overlapStart) {
      noturnaMin += overlapEnd - overlapStart;
    }
  }

  return noturnaMin;
}

/** Determine jornada_diaria_min based on tipo_jornada */
function jornadaPorTipo(tipo: string | null | undefined): number {
  switch (tipo) {
    case "parcial_4h": return 240;
    case "parcial_6h": return 360;
    default: return 480; // integral
  }
}

/** Auto-deduct interval per CLT art. 71 */
function intervaloLegal(jornadaMin: number, configIntervalo: number): number {
  if (jornadaMin > 360) return Math.max(configIntervalo, 60); // >6h → min 1h
  if (jornadaMin > 240) return Math.max(configIntervalo, 15); // >4h → min 15min
  return 0; // <=4h → no mandatory break
}

interface ProcessamentoResult {
  intervalo_minutos: number;
  horas_normais_min: number;
  hora_extra_50_min: number;
  hora_extra_100_min: number;
  hora_noturna_min: number;
  adicional_noturno_pct: number; // 20% CLT art. 73
  atraso_min: number;
  falta: boolean;
  tipo_dia: string;
  banco_horas_min: number;
  minutos_excedentes: number;
  dentro_horario: boolean;
  alertas: string[]; // alertas de conformidade
}

/**
 * Process a single ponto record with full CLT compliance.
 * Given a ponto record and horario config, calculates all labor law fields.
 */
function processarRegistroPonto(
  reg: any,
  config: any,
  tipoDia: string,
  cfg: Map<string, string>,
): ProcessamentoResult {
  const entradaReal = timeToMinutes(reg.hora_entrada);
  const saidaReal = reg.hora_saida ? timeToMinutes(reg.hora_saida) : entradaReal;
  const entradaPrevista = timeToMinutes(config.hora_entrada);
  const saidaPrevista = timeToMinutes(config.hora_saida);

  const toleranciaEntrada = cfgNum(cfg, "tolerancia_entrada_min", 10);
  const toleranciaSaida = cfgNum(cfg, "tolerancia_saida_min", 10);
  const limiteHeDiaria = cfgNum(cfg, "limite_he_diaria_min", 120);
  const jornadaMaxDiaria = cfgNum(cfg, "jornada_maxima_diaria_min", 600);
  const bancoHorasAtivo = cfg.get("banco_horas_ativo") === "true";
  const noturnInicio = timeToMinutes(cfg.get("hora_noturna_inicio") || "22:00");
  const noturnFim = timeToMinutes(cfg.get("hora_noturna_fim") || "05:00");

  const jornadaDiaria = config.jornada_diaria_min || jornadaPorTipo(config.tipo_jornada);

  const alertas: string[] = [];

  // CLT Art. 319: Proibição de trabalho aos domingos para professores
  if (tipoDia === "domingo") {
    alertas.push("⚠️ CLT Art. 319: É vedado aos professores regência de aulas e trabalho em exames aos domingos.");
  }

  // If no hora_saida, mark as falta
  if (!reg.hora_saida) {
    return {
      intervalo_minutos: 0, horas_normais_min: 0, hora_extra_50_min: 0, hora_extra_100_min: 0,
      hora_noturna_min: 0, adicional_noturno_pct: 0, atraso_min: 0, falta: true, tipo_dia: tipoDia,
      banco_horas_min: 0, minutos_excedentes: 0, dentro_horario: true, alertas,
    };
  }

  // Gross minutes worked
  let brutoMin = Math.max(0, saidaReal - entradaReal);

  // Auto-deduct intervalo intrajornada (CLT art. 71)
  const intervaloConfig = config.intervalo_minutos ?? 60;
  const intervalo = intervaloLegal(brutoMin, intervaloConfig);
  const liquidoMin = Math.max(0, brutoMin - intervalo);

  // Cap at jornada maxima diaria (10h = 600min) — CLT art. 59
  const efetivo = Math.min(liquidoMin, jornadaMaxDiaria);

  // Atraso: late arrival beyond tolerance (CLT art. 58 §1°)
  let atraso = 0;
  if (entradaReal > entradaPrevista + toleranciaEntrada) {
    atraso = entradaReal - entradaPrevista;
  }

  // Horas normais vs extras
  let horasNormais = Math.min(efetivo, jornadaDiaria);
  let totalExtra = Math.max(0, efetivo - jornadaDiaria);

  // Check exit tolerance — only count extra if beyond tolerance
  const saidaExcedente = saidaReal - saidaPrevista;
  if (saidaExcedente <= toleranciaSaida && saidaExcedente >= 0) {
    // Within tolerance — no extra
    totalExtra = 0;
    horasNormais = efetivo;
  }

  // Cap extra at 2h (120min) — CLT art. 59
  totalExtra = Math.min(totalExtra, limiteHeDiaria);

  // Split extra by tipo_dia
  let he50 = 0;
  let he100 = 0;
  if (tipoDia === "domingo" || tipoDia === "feriado") {
    he100 = totalExtra;
  } else {
    // sabado: also 50% unless it's a rest day (simplified: 50%)
    he50 = totalExtra;
  }

  // Hora noturna (CLT art. 73) — adicional de 20%
  const horaNot = calcularHorasNoturnas(entradaReal, saidaReal, noturnInicio, noturnFim);
  const adicionalNoturnoPct = horaNot > 0 ? 20 : 0; // CLT Art. 73 — 20% adicional noturno

  // Hora noturna reduzida: 52:30 = cada hora noturna vale 52min30s
  // Isso significa que quem trabalha 7h noturnas efetivas = 8h para fins de remuneração
  // A diferença já está computada no horaNot via a config hora_noturna_reducao

  // Banco de horas
  const bancoMin = bancoHorasAtivo ? totalExtra : 0;

  const dentroHorario = totalExtra === 0;

  // Alertas de conformidade
  if (totalExtra > 0 && tipoDia === "domingo") {
    alertas.push("⚠️ CLT Art. 319 + Art. 59-A: Hora extra em domingo — adicional de 100% obrigatório. Verificar se havia autorização.");
  }
  if (totalExtra > 120) {
    alertas.push(`⚠️ CLT Art. 59: Limite de 2h extras/dia excedido (${totalExtra}min). Excedente acima de 120min foi descartado.`);
  }
  if (brutoMin > jornadaMaxDiaria + intervalo) {
    alertas.push(`⚠️ CLT Art. 59: Jornada bruta (${brutoMin}min) excede máximo de ${jornadaMaxDiaria}min + intervalo.`);
  }
  if (atraso > 30) {
    alertas.push(`⚠️ Atraso significativo: ${atraso}min. Verificar justificativa.`);
  }

  return {
    intervalo_minutos: intervalo,
    horas_normais_min: horasNormais,
    hora_extra_50_min: he50,
    hora_extra_100_min: he100,
    hora_noturna_min: horaNot,
    adicional_noturno_pct: adicionalNoturnoPct,
    atraso_min: atraso,
    falta: false,
    tipo_dia: tipoDia,
    banco_horas_min: bancoMin,
    minutos_excedentes: totalExtra,
    dentro_horario: dentroHorario,
    alertas,
  };
}

async function verificarPonto(
  sb: ReturnType<typeof createClient>,
  dataInicio?: string,
  dataFim?: string,
) {
  // Load config
  const cfg = await carregarConfigPonto(sb);

  // Load feriados in the date range
  let fQ = sb.from("compliance_feriados").select("data, tipo");
  if (dataInicio) fQ = fQ.gte("data", dataInicio);
  if (dataFim) fQ = fQ.lte("data", dataFim);
  const { data: feriados } = await fQ;
  const feriadoMap = new Map<string, string>();
  (feriados ?? []).forEach((f: any) => feriadoMap.set(f.data, f.tipo));

  // Fetch unprocessed ponto records in the period
  let q = sb
    .from("compliance_ponto_registros")
    .select("*, professoras(id, nome, email)")
    .eq("processado", false)
    .order("data");
  if (dataInicio) q = q.gte("data", dataInicio);
  if (dataFim) q = q.lte("data", dataFim);
  const { data: registros } = await q;

  if (!registros || registros.length === 0) {
    return { verificados: 0, ocorrencias_criadas: 0, processados: 0 };
  }

  // Fetch all active schedules
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
  let processados = 0;

  for (const reg of registros) {
    // Calculate dia_semana (1=Mon, 7=Sun)
    const dt = new Date(reg.data + "T12:00:00");
    const jsDow = dt.getDay();
    const diaSemana = jsDow === 0 ? 7 : jsDow;

    // Determine tipo_dia
    let tipoDia = "util";
    if (feriadoMap.has(reg.data)) {
      tipoDia = "feriado";
    } else if (diaSemana === 7) {
      tipoDia = "domingo";
    } else if (diaSemana === 6) {
      tipoDia = "sabado";
    }

    const key = `${reg.professora_id}_${diaSemana}`;
    const configs = horariosMap.get(key);
    if (!configs || configs.length === 0) {
      // No schedule for this day — mark as processed, skip
      await sb.from("compliance_ponto_registros")
        .update({ processado: true, tipo_dia: tipoDia })
        .eq("id", reg.id);
      processados++;
      continue;
    }

    const config = configs[0];
    const result = processarRegistroPonto(reg, config, tipoDia, cfg);

    // Update the ponto record with all calculated fields
    await sb.from("compliance_ponto_registros").update({
      intervalo_minutos: result.intervalo_minutos,
      horas_normais_min: result.horas_normais_min,
      hora_extra_50_min: result.hora_extra_50_min,
      hora_extra_100_min: result.hora_extra_100_min,
      hora_noturna_min: result.hora_noturna_min,
      atraso_min: result.atraso_min,
      falta: result.falta,
      tipo_dia: result.tipo_dia,
      banco_horas_min: result.banco_horas_min,
      processado: true,
      dentro_horario: result.dentro_horario,
      hora_extra_minutos: result.minutos_excedentes,
      adicional_noturno_pct: result.adicional_noturno_pct,
      alertas: result.alertas.length ? result.alertas : null,
    }).eq("id", reg.id);

    processados++;

    // Create ocorrencia if extra hours detected
    if (result.minutos_excedentes > 0) {
      const { data: existente } = await sb
        .from("compliance_ocorrencias")
        .select("id")
        .eq("ponto_registro_id", reg.id)
        .limit(1);

      if (!existente || existente.length === 0) {
        const tipoOcorrencia = (tipoDia === "domingo" || tipoDia === "feriado")
          ? "hora_extra_domingo_feriado"
          : "hora_extra_nao_autorizada";
        await sb.from("compliance_ocorrencias").insert({
          professora_id: reg.professora_id,
          ponto_registro_id: reg.id,
          data_ocorrencia: reg.data,
          hora_prevista_saida: config.hora_saida,
          hora_real_saida: reg.hora_saida,
          minutos_excedentes: result.minutos_excedentes,
          tipo: tipoOcorrencia,
        });
        ocorrenciasCriadas++;
      }
    }

    // Update banco de horas if active
    if (result.banco_horas_min > 0) {
      const mesDate = new Date(reg.data + "T12:00:00");
      const mes = mesDate.getMonth() + 1;
      const ano = mesDate.getFullYear();

      const { data: banco } = await sb
        .from("compliance_banco_horas")
        .select("id, creditos_min, saldo_final_min")
        .eq("professora_id", reg.professora_id)
        .eq("mes", mes)
        .eq("ano", ano)
        .single();

      if (banco) {
        await sb.from("compliance_banco_horas").update({
          creditos_min: (banco.creditos_min || 0) + result.banco_horas_min,
          saldo_final_min: (banco.saldo_final_min || 0) + result.banco_horas_min,
        }).eq("id", banco.id);
      } else {
        // Get saldo from previous month
        const prevMes = mes === 1 ? 12 : mes - 1;
        const prevAno = mes === 1 ? ano - 1 : ano;
        const { data: prevBanco } = await sb
          .from("compliance_banco_horas")
          .select("saldo_final_min")
          .eq("professora_id", reg.professora_id)
          .eq("mes", prevMes)
          .eq("ano", prevAno)
          .single();

        const saldoAnterior = prevBanco?.saldo_final_min ?? 0;
        await sb.from("compliance_banco_horas").insert({
          professora_id: reg.professora_id,
          mes, ano,
          saldo_anterior_min: saldoAnterior,
          creditos_min: result.banco_horas_min,
          debitos_min: 0,
          saldo_final_min: saldoAnterior + result.banco_horas_min,
        });
      }
    }
  }

  return { verificados: registros.length, ocorrencias_criadas: ocorrenciasCriadas, processados };
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
router.on("compliance_ciencia_criar", authGerenteOrSecretaria, feat, async (ctx) => {
  const { professora_id, ocorrencia_id, tipo, titulo, descricao, data_referencia } = ctx.body as any;
  if (!professora_id || !titulo || !descricao) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  const { data, error } = await ctx.sb.from("compliance_ciencias").insert({
    professora_id, ocorrencia_id, tipo: tipo || "hora_extra", titulo, descricao, data_referencia,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

// Gerente: listar ciências (com filtros)
router.on("compliance_ciencias_list", authGerenteOrSecretaria, feat, async (ctx) => {
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
router.on("compliance_ciencia_detalhe", authGerenteOrSecretaria, feat, async (ctx) => {
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
//  QUIZ DE COMPLIANCE — Geração IA + Aplicação
// ═══════════════════════════════════════════════════════════════

// Gerente: criar quiz e gerar perguntas via Claude
router.on("compliance_quiz_criar", authGerenteOrSecretaria, feat, async (ctx) => {
  const { titulo, descricao, politica_id, tema, total_perguntas, nota_minima, tempo_limite_minutos, recorrencia, aplica_a, prompt_contexto } = ctx.body as any;
  if (!titulo || !tema) throw new AppError("VALIDATION_FAILED", "titulo e tema obrigatórios.");

  // Criar quiz
  const { data: quiz, error } = await ctx.sb.from("compliance_quizzes").insert({
    titulo, descricao, politica_id, tema,
    total_perguntas: total_perguntas || 5,
    nota_minima: nota_minima || 70,
    tempo_limite_minutos: tempo_limite_minutos || 15,
    recorrencia: recorrencia || "trimestral",
    aplica_a: aplica_a || "todos",
    prompt_contexto,
    criado_por: ctx.user?.nome,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);

  // Buscar conteúdo da política base (se houver)
  let conteudoPolitica = "";
  if (politica_id) {
    const { data: pol } = await ctx.sb.from("compliance_politicas").select("titulo, conteudo_html").eq("id", politica_id).single();
    if (pol?.conteudo_html) {
      conteudoPolitica = pol.conteudo_html.replace(/<[^>]*>/g, " ").substring(0, 3000);
    }
  }

  // Gerar perguntas via Claude Haiku
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (ANTHROPIC_KEY && conteudoPolitica) {
    try {
      const nPerguntas = total_perguntas || 5;
      const promptIA = `Você é um especialista em compliance escolar. Com base no documento abaixo, gere exatamente ${nPerguntas} perguntas de múltipla escolha (4 alternativas cada) para avaliar se um funcionário de escola entende o conteúdo.

DOCUMENTO (${tema}):
${conteudoPolitica}

${prompt_contexto ? `CONTEXTO EXTRA: ${prompt_contexto}` : ""}

Responda APENAS em JSON válido, sem markdown, no formato:
[{"pergunta":"texto","opcoes":["A","B","C","D"],"resposta_correta":0,"explicacao":"porquê","dificuldade":"media"}]

Onde resposta_correta é o índice (0-3) da opção correta. Varie a dificuldade entre fácil, média e difícil. Perguntas em português brasileiro.`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2000, messages: [{ role: "user", content: promptIA }] }),
      });

      if (res.ok) {
        const aiData = await res.json() as any;
        const texto = aiData.content?.[0]?.text || "";
        // Extrair JSON do texto
        const jsonMatch = texto.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const perguntas = JSON.parse(jsonMatch[0]) as Array<{ pergunta: string; opcoes: string[]; resposta_correta: number; explicacao: string; dificuldade: string }>;
          for (let i = 0; i < perguntas.length; i++) {
            await ctx.sb.from("compliance_quiz_perguntas").insert({
              quiz_id: quiz.id,
              ordem: i + 1,
              pergunta: perguntas[i].pergunta,
              tipo: "multipla_escolha",
              opcoes: perguntas[i].opcoes,
              resposta_correta: perguntas[i].resposta_correta,
              explicacao: perguntas[i].explicacao,
              dificuldade: perguntas[i].dificuldade || "media",
            });
          }
          await ctx.sb.from("compliance_quizzes").update({ perguntas_geradas: true }).eq("id", quiz.id);
        }
      }
    } catch (e) { console.error("[QUIZ] Erro ao gerar perguntas:", e); }
  }

  return successResponse(quiz);
});

// Gerente: atribuir quiz a funcionários
router.on("compliance_quiz_atribuir", authGerenteOrSecretaria, feat, async (ctx) => {
  const { quiz_id, professora_ids, prazo_dias } = ctx.body as any;
  if (!quiz_id || !Array.isArray(professora_ids)) throw new AppError("VALIDATION_FAILED", "quiz_id e professora_ids[] obrigatórios.");
  const prazo = new Date(); prazo.setDate(prazo.getDate() + (prazo_dias || 7));
  const prazoStr = prazo.toISOString().split("T")[0];

  let atribuidos = 0;
  for (const profId of professora_ids) {
    const { data: prof } = await ctx.sb.from("professoras").select("id, nome, email").eq("id", profId).single();
    if (!prof) continue;
    await ctx.sb.from("compliance_quiz_atribuicoes").insert({
      quiz_id, professora_id: profId, nome: prof.nome, email: prof.email, cargo: "professora", prazo: prazoStr,
    });
    atribuidos++;
  }
  return successResponse({ atribuidos, prazo: prazoStr });
});

// Gerente: listar quizzes
router.on("compliance_quizzes_list", authGerenteOrSecretaria, feat, async (ctx) => {
  const { data } = await ctx.sb.from("compliance_quizzes").select("*, compliance_politicas(titulo)").eq("ativo", true).order("criado_em", { ascending: false });
  return successResponse(data ?? []);
});

// Gerente: ver resultados de um quiz
router.on("compliance_quiz_resultados", authGerenteOrSecretaria, feat, async (ctx) => {
  const { quiz_id } = ctx.body as any;
  if (!quiz_id) throw new AppError("VALIDATION_FAILED", "quiz_id obrigatório.");
  const { data: atribuicoes } = await ctx.sb.from("compliance_quiz_atribuicoes").select("*").eq("quiz_id", quiz_id).order("nome");
  const { data: quiz } = await ctx.sb.from("compliance_quizzes").select("titulo, nota_minima, total_perguntas").eq("id", quiz_id).single();
  return successResponse({ quiz, atribuicoes: atribuicoes ?? [] });
});

// Professora: listar quizzes pendentes
router.on("compliance_quiz_pendentes", authProfessora, async (ctx) => {
  const profId = ctx.user?.id;
  if (!profId) throw new AppError("AUTH_REQUIRED", "Autenticação necessária.");
  const { data } = await ctx.sb.from("compliance_quiz_atribuicoes")
    .select("*, compliance_quizzes(id, titulo, descricao, tema, total_perguntas, tempo_limite_minutos, nota_minima)")
    .eq("professora_id", profId)
    .in("status", ["pendente", "em_andamento"])
    .order("prazo");
  return successResponse(data ?? []);
});

// Professora: obter perguntas do quiz (iniciar tentativa)
router.on("compliance_quiz_iniciar", authProfessora, async (ctx) => {
  const { atribuicao_id } = ctx.body as any;
  if (!atribuicao_id) throw new AppError("VALIDATION_FAILED", "atribuicao_id obrigatório.");

  const { data: atrib } = await ctx.sb.from("compliance_quiz_atribuicoes").select("*, compliance_quizzes(id, titulo, total_perguntas, tempo_limite_minutos, nota_minima, tentativas_max)").eq("id", atribuicao_id).single();
  if (!atrib) throw new AppError("NOT_FOUND", "Atribuição não encontrada.");
  if (atrib.professora_id !== ctx.user?.id) throw new AppError("FORBIDDEN", "Acesso negado.");
  const quiz = (atrib as any).compliance_quizzes;
  if (atrib.tentativas >= (quiz.tentativas_max || 3)) throw new AppError("BAD_REQUEST", "Número máximo de tentativas atingido.");

  // Marcar como em andamento
  await ctx.sb.from("compliance_quiz_atribuicoes").update({ status: "em_andamento" }).eq("id", atribuicao_id);

  // Buscar perguntas (sem a resposta correta!)
  const { data: perguntas } = await ctx.sb.from("compliance_quiz_perguntas")
    .select("id, ordem, pergunta, tipo, opcoes, dificuldade")
    .eq("quiz_id", quiz.id)
    .order("ordem");

  return successResponse({
    atribuicao_id,
    quiz: { titulo: quiz.titulo, tempo_limite_minutos: quiz.tempo_limite_minutos, nota_minima: quiz.nota_minima },
    perguntas: perguntas ?? [],
    tentativa: atrib.tentativas + 1,
  });
});

// Professora: enviar respostas e receber nota
router.on("compliance_quiz_responder", authProfessora, async (ctx) => {
  const { atribuicao_id, respostas } = ctx.body as any;
  if (!atribuicao_id || !Array.isArray(respostas)) throw new AppError("VALIDATION_FAILED", "atribuicao_id e respostas[] obrigatórios.");

  const { data: atrib } = await ctx.sb.from("compliance_quiz_atribuicoes").select("*, compliance_quizzes(id, nota_minima, tentativas_max)").eq("id", atribuicao_id).single();
  if (!atrib || atrib.professora_id !== ctx.user?.id) throw new AppError("FORBIDDEN", "Acesso negado.");

  const quiz = (atrib as any).compliance_quizzes;
  const tentativa = atrib.tentativas + 1;

  // Buscar gabarito
  const { data: perguntas } = await ctx.sb.from("compliance_quiz_perguntas").select("id, resposta_correta, explicacao").eq("quiz_id", quiz.id);
  const gabarito = new Map((perguntas ?? []).map((p: any) => [p.id, p]));

  let corretas = 0;
  const resultados: any[] = [];

  for (const resp of respostas) {
    const gab = gabarito.get(resp.pergunta_id);
    const correta = gab ? resp.resposta_selecionada === gab.resposta_correta : false;
    if (correta) corretas++;

    await ctx.sb.from("compliance_quiz_respostas").insert({
      atribuicao_id, pergunta_id: resp.pergunta_id, tentativa,
      resposta_selecionada: resp.resposta_selecionada,
      correta, tempo_segundos: resp.tempo_segundos || 0,
    });

    resultados.push({ pergunta_id: resp.pergunta_id, correta, explicacao: gab?.explicacao });
  }

  const totalPerguntas = perguntas?.length || 1;
  const nota = Math.round((corretas / totalPerguntas) * 100);
  const aprovado = nota >= (quiz.nota_minima || 70);

  // Atualizar atribuição
  await ctx.sb.from("compliance_quiz_atribuicoes").update({
    tentativas: tentativa,
    melhor_nota: Math.max(nota, atrib.melhor_nota || 0),
    ultima_tentativa_em: new Date().toISOString(),
    status: aprovado ? "aprovado" : tentativa >= (quiz.tentativas_max || 3) ? "reprovado" : "em_andamento",
    ...(aprovado ? { aprovado_em: new Date().toISOString() } : {}),
  }).eq("id", atribuicao_id);

  return successResponse({
    nota,
    corretas,
    total: totalPerguntas,
    aprovado,
    tentativa,
    tentativas_restantes: Math.max(0, (quiz.tentativas_max || 3) - tentativa),
    resultados,
  });
});

// ═══════════════════════════════════════════════════════════════
//  RESUMO MENSAL CLT — Ponto por professora
// ═══════════════════════════════════════════════════════════════

router.on("compliance_ponto_resumo_mensal", authGerenteOrSecretaria, feat, async (ctx) => {
  const { professora_id, mes, ano } = ctx.body as any;
  const anoAtual = ano || new Date().getFullYear();
  const mesAtual = mes || new Date().getMonth() + 1;
  const dataInicio = `${anoAtual}-${String(mesAtual).padStart(2, "0")}-01`;
  const dataFim = `${anoAtual}-${String(mesAtual).padStart(2, "0")}-31`;

  let q = ctx.sb
    .from("compliance_ponto_registros")
    .select("*, professoras(id, nome, email)")
    .gte("data", dataInicio)
    .lte("data", dataFim)
    .eq("processado", true)
    .order("data");
  if (professora_id) q = q.eq("professora_id", professora_id);

  const { data: registros } = await q;

  // Group by professora
  const porProf = new Map<string, { nome: string; registros: any[] }>();
  (registros ?? []).forEach((r: any) => {
    const pid = r.professora_id;
    const nome = r.professoras?.nome ?? "N/A";
    if (!porProf.has(pid)) porProf.set(pid, { nome, registros: [] });
    porProf.get(pid)!.registros.push(r);
  });

  // Load banco de horas for the month
  const { data: bancos } = await ctx.sb
    .from("compliance_banco_horas")
    .select("*")
    .eq("mes", mesAtual)
    .eq("ano", anoAtual);
  const bancoMap = new Map<string, any>();
  (bancos ?? []).forEach((b: any) => bancoMap.set(b.professora_id, b));

  const resumos = [...porProf.entries()].map(([pid, { nome, registros: regs }]) => {
    const diasTrabalhados = regs.filter((r: any) => !r.falta).length;
    const totalNormaisMin = regs.reduce((s: number, r: any) => s + (r.horas_normais_min || 0), 0);
    const totalHe50Min = regs.reduce((s: number, r: any) => s + (r.hora_extra_50_min || 0), 0);
    const totalHe100Min = regs.reduce((s: number, r: any) => s + (r.hora_extra_100_min || 0), 0);
    const totalNoturnasMin = regs.reduce((s: number, r: any) => s + (r.hora_noturna_min || 0), 0);
    const totalAtrasosMin = regs.reduce((s: number, r: any) => s + (r.atraso_min || 0), 0);
    const totalFaltas = regs.filter((r: any) => r.falta).length;

    // DSR calculation: (total HE + noturnas) / dias_uteis_trabalhados * domingos_e_feriados
    const diasUteis = regs.filter((r: any) => r.tipo_dia === "util" && !r.falta).length;
    const domingosFeriados = regs.filter((r: any) => r.tipo_dia === "domingo" || r.tipo_dia === "feriado").length;
    const dsrMin = diasUteis > 0
      ? Math.round(((totalHe50Min + totalHe100Min + totalNoturnasMin) / diasUteis) * (domingosFeriados || 4))
      : 0;

    const banco = bancoMap.get(pid);

    return {
      professora_id: pid,
      nome,
      mes: mesAtual,
      ano: anoAtual,
      dias_trabalhados: diasTrabalhados,
      total_horas_normais_min: totalNormaisMin,
      total_horas_normais_fmt: `${Math.floor(totalNormaisMin / 60)}h${String(totalNormaisMin % 60).padStart(2, "0")}`,
      total_he_50_min: totalHe50Min,
      total_he_50_fmt: `${Math.floor(totalHe50Min / 60)}h${String(totalHe50Min % 60).padStart(2, "0")}`,
      total_he_100_min: totalHe100Min,
      total_he_100_fmt: `${Math.floor(totalHe100Min / 60)}h${String(totalHe100Min % 60).padStart(2, "0")}`,
      total_noturnas_min: totalNoturnasMin,
      total_atrasos_min: totalAtrasosMin,
      total_faltas: totalFaltas,
      dsr_min: dsrMin,
      dsr_fmt: `${Math.floor(dsrMin / 60)}h${String(dsrMin % 60).padStart(2, "0")}`,
      banco_horas: banco ? {
        saldo_anterior_min: banco.saldo_anterior_min,
        creditos_min: banco.creditos_min,
        debitos_min: banco.debitos_min,
        saldo_final_min: banco.saldo_final_min,
        fechado: banco.fechado,
      } : null,
    };
  });

  return successResponse(resumos);
});

// ═══════════════════════════════════════════════════════════════
//  FERIADOS — CRUD
// ═══════════════════════════════════════════════════════════════

router.on("compliance_feriados_list", authGerenteOrSecretaria, feat, async (ctx) => {
  const { ano } = ctx.body as any;
  let q = ctx.sb.from("compliance_feriados").select("*").order("data");
  if (ano) {
    q = q.gte("data", `${ano}-01-01`).lte("data", `${ano}-12-31`);
  }
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("compliance_feriados_save", authGerenteOrSecretaria, feat, async (ctx) => {
  const { id, data, descricao, tipo } = ctx.body as any;
  if (!data || !descricao) throw new AppError("VALIDATION_FAILED", "data e descricao obrigatorios.");
  if (id) {
    const { data: updated, error } = await ctx.sb.from("compliance_feriados")
      .update({ data, descricao, tipo: tipo || "feriado" })
      .eq("id", id).select().single();
    if (error) throw new AppError("BAD_REQUEST", error.message);
    return successResponse(updated);
  }
  const { data: created, error } = await ctx.sb.from("compliance_feriados")
    .insert({ data, descricao, tipo: tipo || "feriado" })
    .select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(created);
});

router.on("compliance_feriados_delete", authGerenteOrSecretaria, feat, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatorio.");
  const { error } = await ctx.sb.from("compliance_feriados").delete().eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  CONFIG PONTO — Read/Update
// ═══════════════════════════════════════════════════════════════

router.on("compliance_config_ponto_list", authGerenteOrSecretaria, feat, async (ctx) => {
  const { data } = await ctx.sb.from("compliance_config_ponto").select("*").order("chave");
  return successResponse(data ?? []);
});

router.on("compliance_config_ponto_save", authGerenteOrSecretaria, feat, async (ctx) => {
  const { configs } = ctx.body as any;
  if (!Array.isArray(configs)) throw new AppError("VALIDATION_FAILED", "configs[] obrigatorio.");
  let updated = 0;
  for (const c of configs) {
    if (!c.chave || c.valor === undefined) continue;
    const { error } = await ctx.sb.from("compliance_config_ponto")
      .update({ valor: String(c.valor) })
      .eq("chave", c.chave);
    if (!error) updated++;
  }
  return successResponse({ updated });
});

// ═══════════════════════════════════════════════════════════════
//  BANCO DE HORAS — List
// ═══════════════════════════════════════════════════════════════

router.on("compliance_banco_horas_list", authGerenteOrSecretaria, feat, async (ctx) => {
  const { professora_id, ano } = ctx.body as any;
  const anoFiltro = ano || new Date().getFullYear();
  let q = ctx.sb
    .from("compliance_banco_horas")
    .select("*, professoras(id, nome)")
    .eq("ano", anoFiltro)
    .order("mes");
  if (professora_id) q = q.eq("professora_id", professora_id);
  const { data } = await q;
  return successResponse(data ?? []);
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
