// ═══════════════════════════════════════════════════════════════
//  Edge Function: academico (v2 — Router Pattern)
//  Notas, Frequência, Diário de Classe, Documentos, Relatórios,
//  Portal do Aluno, Banco de Provas
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  Router,
  rateLimit,
  authGerente,
  authProfessora,
  authProfOrGerente,
  authAluno,
  authPaisOuAluno,
  canReadAluno,
  requireFeature,
  loadEscola,
  requireEscola,
  successResponse,
  AppError,
  sanitizePgError,
  logAudit,
  captureException,
  verificarSenhaAuto,
  gerarToken,
} from "../_shared/mod.ts";

const router = new Router("academico");
router.useGlobal(rateLimit());

// ── Shortcut middlewares ──
const featNotas = requireFeature("notas");
const featFreq = requireFeature("frequencia");
const featDiario = requireFeature("diario_classe");
const featDocs = requireFeature("documentos");
const featBncc = requireFeature("relatorios_bncc");
const featAluno = requireFeature("portal_aluno");
const featProvas = requireFeature("banco_provas");

const authPG = authProfOrGerente();
const authAl = authAluno();
const authPA = authPaisOuAluno();

// ── Sanitiza termo de busca para filtros .or() do PostgREST ──
function sanitizeBusca(s: unknown): string {
  return String(s ?? "").replace(/[^a-zA-Z0-9À-ÿ\s-]/g, "").trim().substring(0, 100);
}

// ═══════════════════════════════════════════════════════════════
//  NOTAS / BOLETIM / CONCEITOS
// ═══════════════════════════════════════════════════════════════

router.on("notas_config_get", loadEscola, featNotas, async (ctx) => {
  let q = ctx.sb.from("notas_config").select("*");
  if (ctx.escola_id) q = q.eq("escola_id", ctx.escola_id);
  const { data } = await q.limit(1).single();
  return successResponse(data || {});
});

router.on("notas_config_update", authGerente, featNotas, async (ctx) => {
  const { tipo_avaliacao, media_aprovacao, conceitos_escala, conceito_minimo, formula_media, permite_recuperacao, peso_recuperacao, periodos_tipo } = ctx.body as any;
  const fields: any = { atualizado_em: new Date().toISOString() };
  if (tipo_avaliacao !== undefined) fields.tipo_avaliacao = tipo_avaliacao;
  if (media_aprovacao !== undefined) fields.media_aprovacao = media_aprovacao;
  if (conceitos_escala !== undefined) fields.conceitos_escala = conceitos_escala;
  if (conceito_minimo !== undefined) fields.conceito_minimo = conceito_minimo;
  if (formula_media !== undefined) fields.formula_media = formula_media;
  if (permite_recuperacao !== undefined) fields.permite_recuperacao = permite_recuperacao;
  if (peso_recuperacao !== undefined) fields.peso_recuperacao = peso_recuperacao;
  if (periodos_tipo !== undefined) fields.periodos_tipo = periodos_tipo;
  let qExist = ctx.sb.from("notas_config").select("id");
  if (ctx.escola_id) qExist = qExist.eq("escola_id", ctx.escola_id);
  const { data: existing } = await qExist.limit(1).single();
  if (existing) { await ctx.sb.from("notas_config").update(fields).eq("id", existing.id).eq("escola_id", ctx.escola_id!); }
  else { await ctx.sb.from("notas_config").insert({ ...fields, escola_id: ctx.escola_id }); }
  return successResponse({ success: true });
});

// ── Períodos ──

router.on("notas_periodos_list", loadEscola, featNotas, async (ctx) => {
  const ano = (ctx.body.ano as number) || new Date().getFullYear();
  let q = ctx.sb.from("notas_periodos").select("*").eq("ano", ano);
  if (ctx.escola_id) q = q.eq("escola_id", ctx.escola_id);
  const { data } = await q.order("numero");
  return successResponse(data ?? []);
});

router.on("notas_periodos_create", authGerente, featNotas, requireEscola, async (ctx) => {
  const { nome, numero, ano, data_inicio, data_fim } = ctx.body as any;
  if (!nome || !numero || !ano) throw new AppError("VALIDATION_FAILED", "Nome, número e ano obrigatórios.");
  const { data, error } = await ctx.sb.from("notas_periodos").insert({ escola_id: ctx.escola_id, nome, numero, ano, data_inicio, data_fim }).select().single();
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse(data);
});

router.on("notas_periodos_update", authGerente, featNotas, requireEscola, async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token;
  const { error } = await ctx.sb.from("notas_periodos").update(fields).eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true });
});

router.on("notas_periodos_delete", authGerente, featNotas, requireEscola, async (ctx) => {
  const { id } = ctx.body as { id: string };
  const { error } = await ctx.sb.from("notas_periodos").delete().eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true });
});

// ── Disciplinas ──

router.on("notas_disciplinas_list", loadEscola, featNotas, async (ctx) => {
  const { serie_id } = ctx.body as any;
  let q = ctx.sb.from("notas_disciplinas").select("*, series(nome), professoras(nome)").eq("ativo", true).order("nome");
  if (serie_id) q = q.eq("serie_id", serie_id);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("notas_disciplinas_create", authGerente, featNotas, requireEscola, async (ctx) => {
  const { nome, serie_id, professora_id, carga_horaria } = ctx.body as any;
  if (!nome) throw new AppError("VALIDATION_FAILED", "Nome obrigatório.");
  const { data, error } = await ctx.sb.from("notas_disciplinas").insert({ escola_id: ctx.escola_id, nome, serie_id, professora_id, carga_horaria }).select().single();
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse(data);
});

router.on("notas_disciplinas_update", authGerente, featNotas, requireEscola, async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token;
  const { error } = await ctx.sb.from("notas_disciplinas").update(fields).eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true });
});

router.on("notas_disciplinas_delete", authGerente, featNotas, requireEscola, async (ctx) => {
  const { id } = ctx.body as { id: string };
  const { error } = await ctx.sb.from("notas_disciplinas").update({ ativo: false }).eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true });
});

// ── Avaliações ──

router.on("notas_avaliacoes_list", loadEscola, featNotas, async (ctx) => {
  const { disciplina_id, periodo_id } = ctx.body as any;
  let q = ctx.sb.from("notas_avaliacoes").select("*, notas_disciplinas(nome, serie_id), notas_periodos(nome, numero)").order("data_avaliacao", { ascending: false });
  if (disciplina_id) q = q.eq("disciplina_id", disciplina_id);
  if (periodo_id) q = q.eq("periodo_id", periodo_id);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("notas_avaliacoes_create", authPG, featNotas, requireEscola, async (ctx) => {
  const { disciplina_id, periodo_id, nome, tipo, peso, data_avaliacao, valor_maximo } = ctx.body as any;
  if (!disciplina_id || !periodo_id || !nome) throw new AppError("VALIDATION_FAILED", "Disciplina, período e nome obrigatórios.");
  const { data, error } = await ctx.sb.from("notas_avaliacoes").insert({
    escola_id: ctx.escola_id, disciplina_id, periodo_id, nome, tipo: tipo || "prova", peso: peso || 1.0,
    data_avaliacao, valor_maximo: valor_maximo || 10.0,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse(data);
});

router.on("notas_avaliacoes_update", authPG, featNotas, requireEscola, async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token; delete fields._prof_token;
  const { error } = await ctx.sb.from("notas_avaliacoes").update(fields).eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true });
});

router.on("notas_avaliacoes_delete", authPG, featNotas, requireEscola, async (ctx) => {
  const { id } = ctx.body as { id: string };
  const { error } = await ctx.sb.from("notas_avaliacoes").delete().eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true });
});

// ── Lançamento de notas (batch upsert) ──

router.on("notas_lancamentos_upsert", authPG, featNotas, requireEscola, async (ctx) => {
  const { avaliacao_id, lancamentos } = ctx.body as { avaliacao_id: string; lancamentos: Array<{ aluno_email: string; aluno_nome: string; valor?: number; conceito?: string; observacao?: string }> };
  if (!avaliacao_id || !Array.isArray(lancamentos)) throw new AppError("VALIDATION_FAILED", "avaliacao_id e lancamentos[] obrigatórios.");

  const rows = lancamentos.map(l => ({
    escola_id: ctx.escola_id,
    avaliacao_id,
    aluno_email: l.aluno_email,
    aluno_nome: l.aluno_nome,
    valor: l.valor ?? null,
    conceito: l.conceito ?? null,
    observacao: l.observacao ?? null,
    lancado_por: ctx.user?.id ?? null,
    lancado_em: new Date().toISOString(),
  }));

  const { error } = await ctx.sb.from("notas_lancamentos").upsert(rows, { onConflict: "avaliacao_id,aluno_email" });
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  logAudit(ctx.sb, {
    ator_tipo: ctx.user?.tipo as "professora" | "gerente",
    ator_id: ctx.user?.id,
    ator_email: ctx.user?.email,
    recurso: "notas_lancamento",
    recurso_id: avaliacao_id,
    acao: "upsert",
    metadata: { alunos: rows.length },
  });
  return successResponse({ success: true, count: rows.length });
});

router.on("notas_lancamentos_list", loadEscola, featNotas, async (ctx) => {
  const { avaliacao_id } = ctx.body as any;
  if (!avaliacao_id) throw new AppError("VALIDATION_FAILED", "avaliacao_id obrigatório.");
  let q = ctx.sb.from("notas_lancamentos").select("*").eq("avaliacao_id", avaliacao_id);
  if (ctx.escola_id) q = q.eq("escola_id", ctx.escola_id);
  const { data } = await q.order("aluno_nome");
  return successResponse(data ?? []);
});

// ── Calcular médias ──

router.on("notas_calcular_media", loadEscola, featNotas, async (ctx) => {
  const { aluno_email, disciplina_id, periodo_id } = ctx.body as any;
  if (!aluno_email || !disciplina_id || !periodo_id) throw new AppError("VALIDATION_FAILED", "aluno_email, disciplina_id e periodo_id obrigatórios.");

  const { data: avaliacoes } = await ctx.sb.from("notas_avaliacoes").select("id, peso, tipo, valor_maximo").eq("disciplina_id", disciplina_id).eq("periodo_id", periodo_id);
  if (!avaliacoes || avaliacoes.length === 0) return successResponse({ media: null, message: "Sem avaliações." });

  const avalIds = avaliacoes.map(a => a.id);
  const { data: notas } = await ctx.sb.from("notas_lancamentos").select("avaliacao_id, valor").eq("aluno_email", aluno_email).in("avaliacao_id", avalIds);
  if (!notas || notas.length === 0) return successResponse({ media: null, message: "Sem notas lançadas." });

  let qCfg = ctx.sb.from("notas_config").select("*");
  if (ctx.escola_id) qCfg = qCfg.eq("escola_id", ctx.escola_id);
  const { data: config } = await qCfg.limit(1).single();
  const formula = config?.formula_media || "aritmetica";

  const normais = avaliacoes.filter(a => a.tipo !== "recuperacao");
  const recup = avaliacoes.filter(a => a.tipo === "recuperacao");

  let media: number;
  if (formula === "ponderada") {
    let somaPN = 0, somaPesos = 0;
    for (const av of normais) {
      if (!av.valor_maximo || av.valor_maximo <= 0) continue;
      const nota = notas.find(n => n.avaliacao_id === av.id);
      if (nota && nota.valor !== null) {
        somaPN += (nota.valor / av.valor_maximo) * 10 * av.peso;
        somaPesos += av.peso;
      }
    }
    media = somaPesos > 0 ? somaPN / somaPesos : 0;
  } else {
    let soma = 0, count = 0;
    for (const av of normais) {
      if (!av.valor_maximo || av.valor_maximo <= 0) continue;
      const nota = notas.find(n => n.avaliacao_id === av.id);
      if (nota && nota.valor !== null) {
        soma += (nota.valor / av.valor_maximo) * 10;
        count++;
      }
    }
    media = count > 0 ? soma / count : 0;
  }

  if (recup.length > 0 && config?.permite_recuperacao) {
    const pesoRecup = config.peso_recuperacao || 0.4;
    for (const av of recup) {
      if (!av.valor_maximo || av.valor_maximo <= 0) continue;
      const nota = notas.find(n => n.avaliacao_id === av.id);
      if (nota && nota.valor !== null) {
        const notaRecup = (nota.valor / av.valor_maximo) * 10;
        if (notaRecup > media) {
          media = media * (1 - pesoRecup) + notaRecup * pesoRecup;
        }
      }
    }
  }

  media = Math.round(media * 100) / 100;
  const aprovado = media >= (config?.media_aprovacao || 7);
  return successResponse({ media, aprovado, formula });
});

// ── Boletim ──

router.on("boletim_gerar", authGerente, featNotas, requireEscola, async (ctx) => {
  const { aluno_email, aluno_nome, periodo_id, ano } = ctx.body as any;
  if (!aluno_email || !aluno_nome || !periodo_id || !ano) throw new AppError("VALIDATION_FAILED", "aluno_email, aluno_nome, periodo_id e ano obrigatórios.");

  const { data: disciplinas } = await ctx.sb.from("notas_disciplinas").select("id, nome, serie_id").eq("ativo", true).eq("escola_id", ctx.escola_id!);
  if (!disciplinas) return successResponse({ dados: { disciplinas: [] } });

  const disciplinasResult = [];
  for (const disc of disciplinas) {
    const { data: avaliacoes } = await ctx.sb.from("notas_avaliacoes").select("id, nome, tipo, peso, valor_maximo").eq("disciplina_id", disc.id).eq("periodo_id", periodo_id);
    const avalIds = (avaliacoes || []).map(a => a.id);
    const { data: notas } = avalIds.length > 0
      ? await ctx.sb.from("notas_lancamentos").select("avaliacao_id, valor, conceito").eq("aluno_email", aluno_email).in("avaliacao_id", avalIds)
      : { data: [] };

    if (!notas || notas.length === 0) continue;

    const avaliacoesResult = (avaliacoes || []).map(av => {
      const nota = (notas || []).find(n => n.avaliacao_id === av.id);
      return { nome: av.nome, tipo: av.tipo, peso: av.peso, valor: nota?.valor, conceito: nota?.conceito };
    });

    const vals = avaliacoesResult.filter(a => a.valor !== null && a.valor !== undefined && a.tipo !== "recuperacao").map(a => a.valor as number);
    const media = vals.length > 0 ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100 : null;
    disciplinasResult.push({ nome: disc.nome, media, avaliacoes: avaliacoesResult });
  }

  const withMedia = disciplinasResult.filter(d => d.media !== null);
  const mediaGeral = withMedia.length > 0
    ? Math.round((withMedia.reduce((s, d) => s + (d.media as number), 0) / withMedia.length) * 100) / 100
    : null;

  const dados = { disciplinas: disciplinasResult };
  const { data: boletim, error } = await ctx.sb.from("boletins").upsert({
    escola_id: ctx.escola_id, aluno_email, aluno_nome, periodo_id, ano, dados, media_geral: mediaGeral,
    status: "gerado", gerado_por: ctx.user!.nome, gerado_em: new Date().toISOString(),
  }, { onConflict: "aluno_email,periodo_id" }).select().single();
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse(boletim);
});

router.on("boletim_get", authPA, featNotas, async (ctx) => {
  const { aluno_email, ano } = ctx.body as any;
  if (!aluno_email) throw new AppError("VALIDATION_FAILED", "aluno_email obrigatório.");
  if (!(await canReadAluno(ctx, String(aluno_email)))) {
    throw new AppError("FORBIDDEN", "Sem acesso a este aluno.");
  }
  const anoFiltro = ano || new Date().getFullYear();
  const { data } = await ctx.sb.from("boletins").select("*, notas_periodos(nome, numero)").eq("aluno_email", String(aluno_email).toLowerCase().trim()).eq("ano", anoFiltro).order("notas_periodos(numero)");
  return successResponse(data ?? []);
});

router.on("notas_alunos_serie", loadEscola, featNotas, async (ctx) => {
  const { serie_id } = ctx.body as any;
  if (!serie_id) throw new AppError("VALIDATION_FAILED", "serie_id obrigatório.");
  let qFam = ctx.sb.from("familias").select("email, nome_aluno, nome_responsavel, serie");
  if (ctx.escola_id) qFam = qFam.eq("escola_id", ctx.escola_id);
  const { data } = await qFam.order("nome_aluno");
  const { data: serie } = await ctx.sb.from("series").select("nome").eq("id", serie_id).single();
  if (!serie) return successResponse([]);
  const alunos = (data || []).filter(f => f.serie === serie.nome);
  return successResponse(alunos);
});

// ═══════════════════════════════════════════════════════════════
//  CONTROLE DE FREQUÊNCIA / CHAMADA
// ═══════════════════════════════════════════════════════════════

router.on("frequencia_config_get", loadEscola, featFreq, async (ctx) => {
  let q = ctx.sb.from("frequencia_config").select("*");
  if (ctx.escola_id) q = q.eq("escola_id", ctx.escola_id);
  const { data } = await q.limit(1).single();
  return successResponse(data || {});
});

router.on("frequencia_config_update", authGerente, featFreq, async (ctx) => {
  const { limite_faltas_percent, alerta_percent } = ctx.body as any;
  let qExist = ctx.sb.from("frequencia_config").select("id");
  if (ctx.escola_id) qExist = qExist.eq("escola_id", ctx.escola_id);
  const { data: existing } = await qExist.limit(1).single();
  const fields: any = { atualizado_em: new Date().toISOString() };
  if (limite_faltas_percent !== undefined) fields.limite_faltas_percent = limite_faltas_percent;
  if (alerta_percent !== undefined) fields.alerta_percent = alerta_percent;
  if (existing) await ctx.sb.from("frequencia_config").update(fields).eq("id", existing.id).eq("escola_id", ctx.escola_id!);
  else await ctx.sb.from("frequencia_config").insert({ ...fields, escola_id: ctx.escola_id });
  return successResponse({ success: true });
});

router.on("frequencia_chamada_create", authPG, featFreq, requireEscola, async (ctx) => {
  const { serie_id, disciplina_id, data: dataStr, horario } = ctx.body as any;
  if (!serie_id || !dataStr) throw new AppError("VALIDATION_FAILED", "serie_id e data obrigatórios.");
  const { data, error } = await ctx.sb.from("frequencia_chamadas").insert({
    serie_id, disciplina_id: disciplina_id || null, data: dataStr,
    horario: horario || null, professora_id: ctx.user?.tipo === "professora" ? ctx.user.id : null,
    escola_id: ctx.escola_id,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse(data);
});

router.on("frequencia_chamada_list", loadEscola, featFreq, async (ctx) => {
  const { serie_id, data_inicio, data_fim } = ctx.body as any;
  let q = ctx.sb.from("frequencia_chamadas").select("*, series(nome), notas_disciplinas(nome), professoras(nome)").order("data", { ascending: false });
  if (serie_id) q = q.eq("serie_id", serie_id);
  if (data_inicio) q = q.gte("data", data_inicio);
  if (data_fim) q = q.lte("data", data_fim);
  q = q.limit(100);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("frequencia_registros_upsert", authPG, featFreq, async (ctx) => {
  const { chamada_id, registros } = ctx.body as { chamada_id: string; registros: Array<{ aluno_email: string; aluno_nome: string; status: string; observacao?: string }> };
  if (!chamada_id || !Array.isArray(registros)) throw new AppError("VALIDATION_FAILED", "chamada_id e registros[] obrigatórios.");
  const rows = registros.map(r => ({
    chamada_id, aluno_email: r.aluno_email, aluno_nome: r.aluno_nome,
    status: r.status || "P", observacao: r.observacao || null,
  }));
  const { error } = await ctx.sb.from("frequencia_registros").upsert(rows, { onConflict: "chamada_id,aluno_email" });
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true, count: rows.length });
});

router.on("frequencia_registros_list", loadEscola, featFreq, async (ctx) => {
  const { chamada_id } = ctx.body as any;
  if (!chamada_id) throw new AppError("VALIDATION_FAILED", "chamada_id obrigatório.");
  const { data } = await ctx.sb.from("frequencia_registros").select("id, chamada_id, aluno_email, aluno_nome, status, observacao").eq("chamada_id", chamada_id).order("aluno_nome");
  return successResponse(data ?? []);
});

router.on("frequencia_relatorio_aluno", loadEscola, featFreq, async (ctx) => {
  const { aluno_email, serie_id, ano } = ctx.body as any;
  if (!aluno_email) throw new AppError("VALIDATION_FAILED", "aluno_email obrigatório.");
  const anoFiltro = ano || new Date().getFullYear();
  let qChamadas = ctx.sb.from("frequencia_chamadas").select("id", { count: "exact", head: false }).gte("data", `${anoFiltro}-01-01`).lte("data", `${anoFiltro}-12-31`);
  if (serie_id) qChamadas = qChamadas.eq("serie_id", serie_id);
  const { data: chamadas } = await qChamadas;
  const totalAulas = chamadas?.length || 0;

  let totalFaltas = 0;
  if (totalAulas > 0) {
    const chamadaIds = chamadas!.map((c: any) => c.id);
    const { count } = await ctx.sb.from("frequencia_registros")
      .select("*", { count: "exact", head: true })
      .eq("aluno_email", aluno_email)
      .in("chamada_id", chamadaIds)
      .in("status", ["A", "F"]);
    totalFaltas = count || 0;
  }

  const percentPresenca = totalAulas > 0 ? Math.round(((totalAulas - totalFaltas) / totalAulas) * 100 * 10) / 10 : 100;
  const percentFaltas = totalAulas > 0 ? Math.round((totalFaltas / totalAulas) * 100 * 10) / 10 : 0;
  return successResponse({ aluno_email, total_aulas: totalAulas, total_faltas: totalFaltas, percent_presenca: percentPresenca, percent_faltas: percentFaltas });
});

// ═══════════════════════════════════════════════════════════════
//  DIÁRIO DE CLASSE DIGITAL
// ═══════════════════════════════════════════════════════════════

router.on("diario_registros_list", loadEscola, featDiario, async (ctx) => {
  const { serie_id, disciplina_id, data_inicio, data_fim } = ctx.body as any;
  let q = ctx.sb.from("diario_registros").select("*, series(nome), notas_disciplinas(nome), professoras(nome)").order("data", { ascending: false });
  if (serie_id) q = q.eq("serie_id", serie_id);
  if (disciplina_id) q = q.eq("disciplina_id", disciplina_id);
  if (data_inicio) q = q.gte("data", data_inicio);
  if (data_fim) q = q.lte("data", data_fim);
  q = q.limit(100);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("diario_registros_create", authPG, featDiario, requireEscola, async (ctx) => {
  const { serie_id, disciplina_id, data: dataStr, conteudo_planejado, conteudo_executado, observacoes, habilidades_bncc } = ctx.body as any;
  if (!serie_id || !dataStr) throw new AppError("VALIDATION_FAILED", "serie_id e data obrigatórios.");
  // OBS: a coluna em diario_registros é `professor_id` (mig 051), não `professora_id`.
  // Outras tabelas (frequencia_chamadas, notas_disciplinas, relatorios_pedagogicos)
  // usam `professora_id`. Não confundir.
  const { data, error } = await ctx.sb.from("diario_registros").insert({
    serie_id, disciplina_id: disciplina_id || null, data: dataStr,
    professor_id: ctx.user?.tipo === "professora" ? ctx.user.id : null,
    conteudo_planejado: conteudo_planejado || null,
    conteudo_executado: conteudo_executado || null,
    observacoes: observacoes || null,
    habilidades_bncc: habilidades_bncc || [],
    escola_id: ctx.escola_id,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse(data);
});

router.on("diario_registros_update", authPG, featDiario, requireEscola, async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token; delete fields._prof_token;
  fields.atualizado_em = new Date().toISOString();
  const { error } = await ctx.sb.from("diario_registros").update(fields).eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true });
});

router.on("diario_registros_delete", authPG, featDiario, requireEscola, async (ctx) => {
  const { id } = ctx.body as { id: string };
  const { error } = await ctx.sb.from("diario_registros").delete().eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true });
});

router.on("diario_bncc_habilidades_list", loadEscola, featDiario, async (ctx) => {
  const { componente, ano_serie, busca } = ctx.body as any;
  let q = ctx.sb.from("diario_bncc_habilidades").select("*").order("codigo");
  if (componente) q = q.eq("componente", componente);
  if (ano_serie) q = q.eq("ano_serie", ano_serie);
  if (busca) {
    const b = sanitizeBusca(busca);
    if (b) q = q.or(`codigo.ilike.%${b}%,descricao.ilike.%${b}%`);
  }
  const { data } = await q;
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  DOCUMENTOS DO ALUNO
// ═══════════════════════════════════════════════════════════════

router.on("documento_templates_list", loadEscola, featDocs, async (ctx) => {
  let q = ctx.sb.from("documentos_templates").select("id, tipo, nome, variaveis, ativo").eq("ativo", true);
  if (ctx.escola_id) q = q.eq("escola_id", ctx.escola_id);
  const { data } = await q.order("tipo");
  return successResponse(data ?? []);
});

router.on("documento_templates_update", authGerente, featDocs, async (ctx) => {
  const { id, template_html, variaveis } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const fields: any = {};
  if (template_html !== undefined) fields.template_html = template_html;
  if (variaveis !== undefined) fields.variaveis = variaveis;
  let qUpd = ctx.sb.from("documentos_templates").update(fields).eq("id", id);
  if (ctx.escola_id) qUpd = qUpd.eq("escola_id", ctx.escola_id);
  const { error } = await qUpd;
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true });
});

router.on("documento_gerar", authGerente, featDocs, requireEscola, async (ctx) => {
  const { tipo, aluno_email, aluno_nome, dados } = ctx.body as any;
  if (!tipo || !aluno_email || !aluno_nome) throw new AppError("VALIDATION_FAILED", "tipo, aluno_email e aluno_nome obrigatórios.");

  let qTmpl = ctx.sb.from("documentos_templates").select("*").eq("tipo", tipo);
  if (ctx.escola_id) qTmpl = qTmpl.eq("escola_id", ctx.escola_id);
  const { data: tmpl } = await qTmpl.single();
  if (!tmpl) throw new AppError("NOT_FOUND", "Template não encontrado para tipo: " + tipo);

  let html = tmpl.template_html;
  const varsData = dados || {};
  varsData.aluno_nome = varsData.aluno_nome || aluno_nome;
  varsData.data_extenso = varsData.data_extenso || new Date().toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
  varsData.ano = varsData.ano || new Date().getFullYear().toString();

  for (const [key, val] of Object.entries(varsData)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(val ?? ""));
  }

  const { data: doc, error } = await ctx.sb.from("documentos_gerados").insert({
    escola_id: ctx.escola_id, aluno_email, aluno_nome, tipo, dados_json: varsData,
    gerado_por: ctx.user!.nome, gerado_em: new Date().toISOString(),
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ ...doc, html_renderizado: html });
});

router.on("documentos_aluno_list", loadEscola, featDocs, async (ctx) => {
  // Aluno autenticado vê apenas seus próprios; gerente pode ver de qualquer aluno.
  // Try aluno token first, then gerente
  const alunoToken = (ctx.body._aluno_token as string) || (ctx.body._token as string);
  const gerenteToken = ctx.body._token as string;

  let emailFiltro: string | null = null;

  // Try aluno session
  if (alunoToken) {
    const { data: sessao } = await ctx.sb.from("aluno_sessoes").select("aluno_id, expira_em").eq("token", alunoToken).maybeSingle();
    // deno-lint-ignore no-explicit-any
    const s = sessao as any;
    if (s && new Date(s.expira_em) >= new Date()) {
      const { data: aluno } = await ctx.sb.from("alunos_login").select("email").eq("id", s.aluno_id).maybeSingle();
      if (aluno) emailFiltro = (aluno as any).email;
    }
  }

  // Try gerente if no aluno found
  if (!emailFiltro && gerenteToken) {
    const { data: gs } = await ctx.sb.from("gerente_sessoes").select("expira_em").eq("token", gerenteToken).maybeSingle();
    if (gs && new Date((gs as any).expira_em) >= new Date()) {
      emailFiltro = (ctx.body as any).aluno_email;
    } else {
      // Unified session
      const { data: us } = await ctx.sb.from("sessoes").select("expira_em").eq("token", gerenteToken).maybeSingle();
      if (us && new Date((us as any).expira_em) >= new Date()) {
        emailFiltro = (ctx.body as any).aluno_email;
      }
    }
  }

  if (!emailFiltro) throw new AppError("VALIDATION_FAILED", "aluno_email obrigatório.");
  const { data } = await ctx.sb.from("documentos_gerados").select("*").eq("aluno_email", emailFiltro).order("gerado_em", { ascending: false });
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  RELATÓRIOS PEDAGÓGICOS / BNCC
// ═══════════════════════════════════════════════════════════════

router.on("relatorio_pedagogico_list", loadEscola, featBncc, async (ctx) => {
  const { aluno_email, professora_id, periodo_id, ano, status } = ctx.body as any;
  let q = ctx.sb.from("relatorios_pedagogicos").select("*, notas_periodos(nome), professoras(nome)").order("criado_em", { ascending: false });
  if (aluno_email) q = q.eq("aluno_email", aluno_email);
  if (professora_id) q = q.eq("professora_id", professora_id);
  if (periodo_id) q = q.eq("periodo_id", periodo_id);
  if (ano) q = q.eq("ano", ano);
  if (status) q = q.eq("status", status);
  q = q.limit(100);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("relatorio_pedagogico_create", authProfessora, featBncc, requireEscola, async (ctx) => {
  const { aluno_email, aluno_nome, periodo_id, ano, tipo, texto } = ctx.body as any;
  if (!aluno_email || !aluno_nome) throw new AppError("VALIDATION_FAILED", "aluno_email e aluno_nome obrigatórios.");
  const { data, error } = await ctx.sb.from("relatorios_pedagogicos").insert({
    escola_id: ctx.escola_id, aluno_email, aluno_nome, professora_id: ctx.user!.id, periodo_id, ano: ano || new Date().getFullYear(),
    tipo: tipo || "descritivo", texto, status: "rascunho",
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse(data);
});

router.on("relatorio_pedagogico_update", authPG, featBncc, requireEscola, async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token; delete fields._prof_token;
  fields.atualizado_em = new Date().toISOString();
  if (fields.status === "aprovado" && ctx.user?.tipo !== "professora") {
    fields.aprovado_por = ctx.user!.nome;
    fields.aprovado_em = new Date().toISOString();
  }
  const { error } = await ctx.sb.from("relatorios_pedagogicos").update(fields).eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true });
});

router.on("relatorio_competencias_upsert", authProfessora, featBncc, requireEscola, async (ctx) => {
  const { relatorio_id, competencias } = ctx.body as { relatorio_id: string; competencias: Array<{ competencia_id: string; nivel: string; observacao?: string }> };
  if (!relatorio_id || !Array.isArray(competencias)) throw new AppError("VALIDATION_FAILED", "relatorio_id e competencias[] obrigatórios.");
  const rows = competencias.map(c => ({ escola_id: ctx.escola_id, relatorio_id, competencia_id: c.competencia_id, nivel: c.nivel, observacao: c.observacao || null }));
  const { error } = await ctx.sb.from("relatorio_competencias").upsert(rows, { onConflict: "relatorio_id,competencia_id" });
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true });
});

router.on("bncc_competencias_list", loadEscola, featBncc, async (ctx) => {
  const { area, componente, ano_serie, tipo, busca } = ctx.body as any;
  let q = ctx.sb.from("bncc_competencias").select("*").order("codigo");
  if (area) q = q.eq("area", area);
  if (componente) q = q.eq("componente", componente);
  if (ano_serie) q = q.eq("ano_serie", ano_serie);
  if (tipo) q = q.eq("tipo", tipo);
  if (busca) {
    const b = sanitizeBusca(busca);
    if (b) q = q.or(`codigo.ilike.%${b}%,descricao.ilike.%${b}%`);
  }
  const { data } = await q;
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  PORTAL DO ALUNO
// ═══════════════════════════════════════════════════════════════

router.on("aluno_login", loadEscola, featAluno, async (ctx) => {
  const { email, senha } = ctx.body as { email: string; senha: string };
  if (!email || !senha) throw new AppError("VALIDATION_FAILED", "Email e senha obrigatórios.");
  const { data: aluno } = await ctx.sb.from("alunos_login").select("id, aluno_nome, email, senha_hash, familia_email, serie, ativo").eq("email", email).single();
  if (!aluno) throw new AppError("AUTH_BAD_CREDENTIALS", "Credenciais inválidas.");
  if (!aluno.ativo) throw new AppError("AUTH_USER_DISABLED", "Conta desativada.");

  const ok = await verificarSenhaAuto(senha, aluno.senha_hash);
  if (!ok) throw new AppError("AUTH_BAD_CREDENTIALS", "Credenciais inválidas.");

  const tkn = gerarToken();
  const { error: asErr } = await ctx.sb.from("aluno_sessoes").insert({ aluno_id: aluno.id, token: tkn, expira_em: new Date(Date.now() + 7 * 86400000).toISOString() });
  if (asErr) throw new AppError("AUTH_SESSION_FAILED", "Não foi possível criar a sessão.");
  return successResponse({ token: tkn, nome: aluno.aluno_nome, email: aluno.email, serie: aluno.serie });
});

router.on("aluno_logout", loadEscola, featAluno, async (ctx) => {
  const alunoToken = (ctx.body._aluno_token as string) || (ctx.body._token as string);
  if (alunoToken) await ctx.sb.from("aluno_sessoes").delete().eq("token", alunoToken);
  return successResponse({ success: true });
});

router.on("aluno_notas_get", authAl, featAluno, async (ctx) => {
  const { ano } = ctx.body as any;
  const { data } = await ctx.sb.from("boletins").select("*, notas_periodos(nome, numero)").eq("aluno_email", ctx.user!.email).eq("ano", ano || new Date().getFullYear()).order("notas_periodos(numero)");
  return successResponse(data ?? []);
});

router.on("aluno_frequencia_get", authAl, featAluno, async (ctx) => {
  const { ano } = ctx.body as any;
  const anoFiltro = ano || new Date().getFullYear();
  let qCham = ctx.sb.from("frequencia_chamadas").select("id").gte("data", `${anoFiltro}-01-01`).lte("data", `${anoFiltro}-12-31`);
  if (ctx.escola_id) qCham = qCham.eq("escola_id", ctx.escola_id);
  const { data: chamadas } = await qCham;
  const totalAulas = chamadas?.length || 0;
  let totalFaltas = 0;
  if (totalAulas > 0) {
    const ids = chamadas!.map((c: any) => c.id);
    const { count } = await ctx.sb.from("frequencia_registros").select("*", { count: "exact", head: true }).eq("aluno_email", ctx.user!.email).in("chamada_id", ids).in("status", ["A", "F"]);
    totalFaltas = count || 0;
  }
  const percent = totalAulas > 0 ? Math.round(((totalAulas - totalFaltas) / totalAulas) * 1000) / 10 : 100;
  return successResponse({ total_aulas: totalAulas, total_faltas: totalFaltas, percent_presenca: percent });
});

// Espelho de aluno_frequencia_get para consulta da família (responsável passa aluno_email do filho).
// Auth: authPaisOuAluno + canReadAluno garante que o JWT pode ler o alvo.
router.on("frequencia_resumo_get", authPA, featFreq, async (ctx) => {
  const { aluno_email, ano } = ctx.body as any;
  if (!aluno_email) throw new AppError("VALIDATION_FAILED", "aluno_email obrigatório.");
  if (!(await canReadAluno(ctx, String(aluno_email)))) {
    throw new AppError("FORBIDDEN", "Sem acesso a este aluno.");
  }
  const anoFiltro = ano || new Date().getFullYear();
  let qCham = ctx.sb.from("frequencia_chamadas").select("id").gte("data", `${anoFiltro}-01-01`).lte("data", `${anoFiltro}-12-31`);
  if (ctx.escola_id) qCham = qCham.eq("escola_id", ctx.escola_id);
  const { data: chamadas } = await qCham;
  const totalAulas = chamadas?.length || 0;
  let totalFaltas = 0;
  if (totalAulas > 0) {
    const ids = chamadas!.map((c: any) => c.id);
    const { count } = await ctx.sb.from("frequencia_registros").select("*", { count: "exact", head: true }).eq("aluno_email", String(aluno_email).toLowerCase().trim()).in("chamada_id", ids).in("status", ["A", "F"]);
    totalFaltas = count || 0;
  }
  const percent = totalAulas > 0 ? Math.round(((totalAulas - totalFaltas) / totalAulas) * 1000) / 10 : 100;
  return successResponse({ total_aulas: totalAulas, total_faltas: totalFaltas, percent_presenca: percent });
});

// ═══════════════════════════════════════════════════════════════
//  BANCO DE PROVAS / AVALIAÇÕES ONLINE
// ═══════════════════════════════════════════════════════════════

router.on("provas_questoes_list", loadEscola, featProvas, async (ctx) => {
  const { disciplina_id, dificuldade, busca } = ctx.body as any;
  let q = ctx.sb.from("provas_questoes").select("*, notas_disciplinas(nome)").eq("ativo", true).order("criado_em", { ascending: false });
  if (disciplina_id) q = q.eq("disciplina_id", disciplina_id);
  if (dificuldade) q = q.eq("dificuldade", dificuldade);
  if (busca) q = q.ilike("texto", `%${busca}%`);
  q = q.limit(200);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("provas_questoes_create", authPG, featProvas, requireEscola, async (ctx) => {
  const { disciplina_id, texto, tipo, opcoes, resposta_correta, dificuldade, habilidade_bncc, explicacao } = ctx.body as any;
  if (!texto) throw new AppError("VALIDATION_FAILED", "Texto da questão obrigatório.");
  const { data, error } = await ctx.sb.from("provas_questoes").insert({
    escola_id: ctx.escola_id, disciplina_id, texto, tipo: tipo || "multipla", opcoes: opcoes || [],
    resposta_correta, dificuldade: dificuldade || "media",
    habilidade_bncc, explicacao, criado_por: ctx.user?.tipo === "professora" ? ctx.user.id : null,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse(data);
});

router.on("provas_questoes_update", authPG, featProvas, requireEscola, async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token; delete fields._prof_token;
  const { error } = await ctx.sb.from("provas_questoes").update(fields).eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true });
});

router.on("provas_list", loadEscola, featProvas, async (ctx) => {
  const { serie_id, disciplina_id, status } = ctx.body as any;
  let q = ctx.sb.from("provas").select("*, notas_disciplinas(nome), series(nome), professoras(nome)").order("criado_em", { ascending: false });
  if (serie_id) q = q.eq("serie_id", serie_id);
  if (disciplina_id) q = q.eq("disciplina_id", disciplina_id);
  if (status) q = q.eq("status", status);
  q = q.limit(100);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("provas_create", authPG, featProvas, requireEscola, async (ctx) => {
  const { titulo, disciplina_id, serie_id, periodo_id, questoes, data_inicio, data_fim, tempo_limite, pontuacao_total, embaralhar } = ctx.body as any;
  if (!titulo) throw new AppError("VALIDATION_FAILED", "Título obrigatório.");
  const { data, error } = await ctx.sb.from("provas").insert({
    escola_id: ctx.escola_id, titulo, disciplina_id, serie_id, periodo_id, questoes: questoes || [],
    data_inicio, data_fim, tempo_limite, pontuacao_total: pontuacao_total || 10,
    embaralhar: embaralhar || false, criado_por: ctx.user?.tipo === "professora" ? ctx.user.id : null, status: "rascunho",
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse(data);
});

router.on("provas_update", authPG, featProvas, requireEscola, async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token; delete fields._prof_token;
  const { error } = await ctx.sb.from("provas").update(fields).eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse({ success: true });
});

router.on("provas_responder", authAl, featProvas, requireEscola, async (ctx) => {
  const { prova_id, respostas } = ctx.body as any;
  if (!prova_id) throw new AppError("VALIDATION_FAILED", "prova_id obrigatório.");

  const { data: prova } = await ctx.sb.from("provas").select("status, data_inicio, data_fim, questoes, pontuacao_total").eq("id", prova_id).single();
  if (!prova || prova.status !== "publicada") throw new AppError("BAD_REQUEST", "Prova não disponível.");
  const agora = new Date();
  if (prova.data_inicio && agora < new Date(prova.data_inicio)) throw new AppError("BAD_REQUEST", "Prova ainda não iniciada.");
  if (prova.data_fim && agora > new Date(prova.data_fim)) throw new AppError("BAD_REQUEST", "Prazo encerrado.");

  let pontuacao = 0;
  const detalhada: Record<string, any> = {};
  const questoesProva = prova.questoes || [];
  const totalQuestoes = questoesProva.length;
  const pontoPorQuestao = totalQuestoes > 0 ? prova.pontuacao_total / totalQuestoes : 0;

  for (const qRef of questoesProva) {
    const qId = qRef.questao_id;
    const respAluno = respostas?.[qId];
    const { data: questao } = await ctx.sb.from("provas_questoes").select("tipo, opcoes, resposta_correta").eq("id", qId).single();
    if (!questao) continue;
    let correta = false;
    if (questao.tipo === "multipla") {
      const opcCorreta = (questao.opcoes || []).findIndex((o: any) => o.correta);
      correta = respAluno !== undefined && parseInt(respAluno) === opcCorreta;
    } else if (questao.tipo === "verdadeiro_falso") {
      correta = respAluno === questao.resposta_correta;
    }
    const pts = correta ? pontoPorQuestao : 0;
    pontuacao += pts;
    detalhada[qId] = { pontos: pts, max: pontoPorQuestao, correta, tipo: questao.tipo };
  }

  pontuacao = Math.round(pontuacao * 100) / 100;
  const corrigido = !questoesProva.some((q: any) => {
    const d = detalhada[q.questao_id];
    return d?.tipo === "dissertativa";
  });

  const { data, error } = await ctx.sb.from("provas_respostas").upsert({
    escola_id: ctx.escola_id, prova_id, aluno_email: ctx.user!.email, aluno_nome: ctx.user!.nome, respostas: respostas || {},
    pontuacao, pontuacao_detalhada: detalhada, fim: agora.toISOString(),
    corrigido, corrigido_em: corrigido ? agora.toISOString() : null,
  }, { onConflict: "prova_id,aluno_email" }).select().single();
  if (error) throw new AppError("BAD_REQUEST", sanitizePgError(error));
  return successResponse(data);
});

router.on("provas_respostas_list", loadEscola, featProvas, async (ctx) => {
  const { prova_id, aluno_email } = ctx.body as any;
  let q = ctx.sb.from("provas_respostas").select("*").order("aluno_nome");
  if (prova_id) q = q.eq("prova_id", prova_id);
  if (aluno_email) q = q.eq("aluno_email", aluno_email);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("provas_disponiveis_aluno", authAl, featProvas, async (ctx) => {
  const { serie_id } = ctx.body as any;
  const agora = new Date().toISOString();
  let q = ctx.sb.from("provas").select("id, titulo, notas_disciplinas(nome), data_inicio, data_fim, tempo_limite, pontuacao_total").eq("status", "publicada");
  if (serie_id) q = q.eq("serie_id", serie_id);
  q = q.lte("data_inicio", agora).gte("data_fim", agora);
  const { data: provas } = await q;
  const result = [];
  for (const p of provas || []) {
    const { data: resp } = await ctx.sb.from("provas_respostas").select("id, pontuacao, fim").eq("prova_id", p.id).eq("aluno_email", ctx.user!.email).single();
    result.push({ ...p, respondida: !!resp, pontuacao: resp?.pontuacao ?? null });
  }
  return successResponse(result);
});

// Espelho de provas_disponiveis_aluno para a família (responsável passa aluno_email).
// Resolve serie_id automaticamente via tabela alunos. Auth via authPaisOuAluno + canReadAluno.
router.on("provas_disponiveis_familia", authPA, featProvas, async (ctx) => {
  const { aluno_email } = ctx.body as any;
  if (!aluno_email) throw new AppError("VALIDATION_FAILED", "aluno_email obrigatório.");
  if (!(await canReadAluno(ctx, String(aluno_email)))) {
    throw new AppError("FORBIDDEN", "Sem acesso a este aluno.");
  }
  const emailNorm = String(aluno_email).toLowerCase().trim();
  const { data: aluno } = await ctx.sb.from("alunos").select("serie_id").eq("email", emailNorm).maybeSingle();
  const serie_id = (aluno as any)?.serie_id ?? null;
  const agora = new Date().toISOString();
  let q = ctx.sb.from("provas").select("id, titulo, notas_disciplinas(nome), data_inicio, data_fim, tempo_limite, pontuacao_total").eq("status", "publicada");
  if (serie_id) q = q.eq("serie_id", serie_id);
  q = q.lte("data_inicio", agora).gte("data_fim", agora);
  const { data: provas } = await q;
  const result = [];
  for (const p of provas || []) {
    const { data: resp } = await ctx.sb.from("provas_respostas").select("id, pontuacao, fim").eq("prova_id", p.id).eq("aluno_email", emailNorm).maybeSingle();
    result.push({ ...p, respondida: !!resp, pontuacao: (resp as any)?.pontuacao ?? null });
  }
  return successResponse(result);
});

// ═══════════════════════════════════════════════════════════════
//  SERVE
// ═══════════════════════════════════════════════════════════════

serve((req: Request) => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return router.handle(req, sb);
});
