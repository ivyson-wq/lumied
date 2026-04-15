// ═══════════════════════════════════════════════════════════════
//  Edge Function: cozinha
//  Merenda escolar interna — cardápio, receitas, estoque FIFO,
//  compras, sanitário (RDC 216), amostras testemunha, desperdício.
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerenteOrSecretaria, requireFeature, requireEscola } from "../_shared/router.ts";
import { successResponse, AppError } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("cozinha");
const router = new Router("cozinha");
router.useGlobal(rateLimit());

const authCoz = authGerenteOrSecretaria(["gerente", "diretor", "secretaria", "manutencao", "nutricionista"]);
const coz = requireFeature("cozinha");

// Nutricionista também pode ser secretaria com papel específico
// Professoras usam endpoint apartado (ver abaixo) com auth próprio.

// ═══════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════
router.on("config_get", authCoz, requireEscola, coz, async (ctx) => {
  const { data } = await ctx.sb
    .from("cozinha_config").select("*").eq("escola_id", ctx.escola_id!).maybeSingle();
  return successResponse(data || { escola_id: ctx.escola_id });
});

router.on("config_upsert", authCoz, requireEscola, coz, async (ctx) => {
  const body = ctx.body as any;
  const upd: any = { escola_id: ctx.escola_id, atualizado_em: new Date().toISOString() };
  for (const k of ["nutricionista_nome","nutricionista_crn","nutricionista_email","custo_refeicao_meta","tolerancia_temp_geladeira","tolerancia_temp_freezer","amostra_horas","observacoes"]) {
    if (k in body) upd[k] = body[k];
  }
  const { error } = await ctx.sb.from("cozinha_config").upsert(upd, { onConflict: "escola_id" });
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  ALIMENTOS
// ═══════════════════════════════════════════════════════════════
router.on("alimentos_list", authCoz, requireEscola, coz, async (ctx) => {
  const { categoria, busca } = ctx.body as any;
  let q = ctx.sb.from("v_cozinha_estoque").select("*")
    .eq("escola_id", ctx.escola_id!).order("nome");
  if (categoria) q = q.eq("categoria", categoria);
  if (busca) q = q.ilike("nome", `%${String(busca).slice(0, 50)}%`);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("alimento_upsert", authCoz, requireEscola, coz, async (ctx) => {
  const body = ctx.body as any;
  const rec: any = { escola_id: ctx.escola_id };
  for (const k of ["id","nome","categoria","unidade_compra","unidade_uso","fator_conversao","estoque_minimo","temperatura","preco_medio","kcal_100g","proteina_g_100g","carbo_g_100g","gordura_g_100g","sodio_mg_100g","alergenos","ativo"]) {
    if (k in body) rec[k] = body[k];
  }
  if (!rec.nome) throw new AppError("VALIDATION_FAILED", "Nome obrigatório.");
  const { data, error } = await ctx.sb.from("cozinha_alimentos").upsert(rec).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("alimento_delete", authCoz, requireEscola, coz, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { error } = await ctx.sb.from("cozinha_alimentos")
    .update({ ativo: false }).eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  LOTES (entrada manual + vencimentos)
// ═══════════════════════════════════════════════════════════════
router.on("lote_add", authCoz, requireEscola, coz, async (ctx) => {
  const body = ctx.body as any;
  const { alimento_id, quantidade, validade, lote, fornecedor, nota_fiscal, preco_unitario, observacao } = body;
  if (!alimento_id || !quantidade) throw new AppError("VALIDATION_FAILED", "alimento_id e quantidade obrigatórios.");
  const qty = Number(quantidade);
  const { data, error } = await ctx.sb.from("cozinha_alimento_lotes").insert({
    escola_id: ctx.escola_id, alimento_id, lote, quantidade: qty, quantidade_inicial: qty,
    validade, fornecedor, nota_fiscal, preco_unitario, observacao,
    recebido_por: ctx.user?.nome, conferido: true,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("lotes_vencendo", authCoz, requireEscola, coz, async (ctx) => {
  const { dias = 7 } = ctx.body as any;
  const limite = new Date(Date.now() + Number(dias) * 86400000).toISOString().split("T")[0];
  const { data } = await ctx.sb
    .from("cozinha_alimento_lotes")
    .select("*, cozinha_alimentos(nome, categoria, unidade_uso)")
    .eq("escola_id", ctx.escola_id!)
    .gt("quantidade", 0)
    .not("validade", "is", null)
    .lte("validade", limite)
    .order("validade");
  return successResponse(data ?? []);
});

router.on("lotes_list", authCoz, requireEscola, coz, async (ctx) => {
  const { alimento_id } = ctx.body as any;
  let q = ctx.sb.from("cozinha_alimento_lotes")
    .select("*, cozinha_alimentos(nome, unidade_uso)")
    .eq("escola_id", ctx.escola_id!)
    .gt("quantidade", 0)
    .order("validade", { ascending: true, nullsFirst: false });
  if (alimento_id) q = q.eq("alimento_id", alimento_id);
  const { data } = await q.limit(500);
  return successResponse(data ?? []);
});

router.on("lote_descartar", authCoz, requireEscola, coz, async (ctx) => {
  const { id, motivo } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { error } = await ctx.sb.from("cozinha_alimento_lotes")
    .update({ quantidade: 0, observacao: `DESCARTADO: ${motivo || "sem motivo"}` })
    .eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  RECEITAS
// ═══════════════════════════════════════════════════════════════
router.on("receitas_list", authCoz, requireEscola, coz, async (ctx) => {
  const { categoria, ativa } = ctx.body as any;
  let q = ctx.sb.from("cozinha_receitas").select("*")
    .eq("escola_id", ctx.escola_id!).order("nome");
  if (categoria) q = q.eq("categoria", categoria);
  if (ativa !== undefined) q = q.eq("ativa", ativa);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("receita_get", authCoz, requireEscola, coz, async (ctx) => {
  const { id } = ctx.body as any;
  const { data: r } = await ctx.sb.from("cozinha_receitas").select("*")
    .eq("id", id).eq("escola_id", ctx.escola_id!).single();
  if (!r) throw new AppError("NOT_FOUND", "Receita não encontrada.");
  const { data: ings } = await ctx.sb.from("cozinha_receita_ingredientes")
    .select("*, cozinha_alimentos(nome, unidade_uso, preco_medio, kcal_100g, proteina_g_100g, carbo_g_100g, gordura_g_100g, alergenos)")
    .eq("receita_id", id);
  // Custo + nutrição por porção
  let custo = 0, kcal = 0, prot = 0, carbo = 0, gord = 0;
  const alerg = new Set<string>();
  for (const i of ings ?? []) {
    const a = (i as any).cozinha_alimentos;
    if (!a) continue;
    const q = Number((i as any).quantidade) || 0;
    custo += q * (Number(a.preco_medio) || 0);
    const fator = q / 100; // valores nutricionais são /100g
    kcal += fator * (Number(a.kcal_100g) || 0);
    prot += fator * (Number(a.proteina_g_100g) || 0);
    carbo += fator * (Number(a.carbo_g_100g) || 0);
    gord += fator * (Number(a.gordura_g_100g) || 0);
    (a.alergenos || []).forEach((x: string) => alerg.add(x));
  }
  return successResponse({ ...r, ingredientes: ings ?? [], nutricao: { custo_porcao: custo, kcal, proteina_g: prot, carbo_g: carbo, gordura_g: gord }, alergenos: Array.from(alerg) });
});

router.on("receita_upsert", authCoz, requireEscola, coz, async (ctx) => {
  const body = ctx.body as any;
  const rec: any = { escola_id: ctx.escola_id, atualizado_em: new Date().toISOString() };
  for (const k of ["id","nome","categoria","faixa_etaria","rendimento_porcoes","tempo_preparo_min","modo_preparo","observacoes","ativa"]) {
    if (k in body) rec[k] = body[k];
  }
  if (!rec.nome) throw new AppError("VALIDATION_FAILED", "Nome obrigatório.");
  const { data: receita, error } = await ctx.sb.from("cozinha_receitas").upsert(rec).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  if (Array.isArray(body.ingredientes)) {
    await ctx.sb.from("cozinha_receita_ingredientes").delete().eq("receita_id", receita.id);
    const ings = body.ingredientes.filter((x: any) => x.alimento_id && x.quantidade).map((x: any) => ({
      receita_id: receita.id, alimento_id: x.alimento_id, quantidade: x.quantidade, unidade: x.unidade, observacao: x.observacao,
    }));
    if (ings.length) {
      const { error: ierr } = await ctx.sb.from("cozinha_receita_ingredientes").insert(ings);
      if (ierr) throw new AppError("BAD_REQUEST", ierr.message);
    }
  }
  return successResponse(receita);
});

router.on("receita_delete", authCoz, requireEscola, coz, async (ctx) => {
  const { id } = ctx.body as any;
  const { error } = await ctx.sb.from("cozinha_receitas")
    .update({ ativa: false }).eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  CARDÁPIO
// ═══════════════════════════════════════════════════════════════
router.on("cardapio_list", authCoz, requireEscola, coz, async (ctx) => {
  const { data_inicio, data_fim } = ctx.body as any;
  const hoje = new Date();
  const ini = data_inicio || hoje.toISOString().split("T")[0];
  const fim = data_fim || new Date(hoje.getTime() + 14 * 86400000).toISOString().split("T")[0];
  const { data } = await ctx.sb.from("cozinha_cardapios")
    .select("*, cozinha_receitas(nome, categoria)")
    .eq("escola_id", ctx.escola_id!)
    .gte("data", ini).lte("data", fim)
    .order("data").order("refeicao");
  return successResponse(data ?? []);
});

router.on("cardapio_upsert", authCoz, requireEscola, coz, async (ctx) => {
  const body = ctx.body as any;
  const { data: dt, refeicao, receita_id, descricao_livre, observacoes, faixa_etaria } = body;
  if (!dt || !refeicao) throw new AppError("VALIDATION_FAILED", "data e refeicao obrigatórios.");
  const { error } = await ctx.sb.from("cozinha_cardapios").upsert({
    escola_id: ctx.escola_id, data: dt, refeicao, faixa_etaria: faixa_etaria || "todos",
    receita_id, descricao_livre, observacoes,
  }, { onConflict: "escola_id,data,refeicao,faixa_etaria" });
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ ok: true });
});

router.on("cardapio_aprovar", authCoz, requireEscola, coz, async (ctx) => {
  const { ids, nutricionista_nome, nutricionista_crn } = ctx.body as any;
  if (!ids || !ids.length) throw new AppError("VALIDATION_FAILED", "IDs obrigatórios.");
  const { error } = await ctx.sb.from("cozinha_cardapios").update({
    aprovado_por: nutricionista_nome, aprovado_crn: nutricionista_crn,
    aprovado_em: new Date().toISOString(),
  }).in("id", ids).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ ok: true });
});

router.on("cardapio_publicar", authCoz, requireEscola, coz, async (ctx) => {
  const { data_inicio, data_fim } = ctx.body as any;
  const { error } = await ctx.sb.from("cozinha_cardapios").update({
    publicado: true, publicado_em: new Date().toISOString(),
  }).eq("escola_id", ctx.escola_id!)
    .gte("data", data_inicio).lte("data", data_fim)
    .not("aprovado_em", "is", null);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ ok: true });
});

router.on("cardapio_delete", authCoz, requireEscola, coz, async (ctx) => {
  const { id } = ctx.body as any;
  const { error } = await ctx.sb.from("cozinha_cardapios")
    .delete().eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ ok: true });
});

// Cardápio público (pais): só publicados
router.on("cardapio_publico", async (ctx) => {
  const { escola_id, data_inicio, data_fim } = ctx.body as any;
  if (!escola_id) throw new AppError("VALIDATION_FAILED", "escola_id obrigatório.");
  const hoje = new Date();
  const ini = data_inicio || hoje.toISOString().split("T")[0];
  const fim = data_fim || new Date(hoje.getTime() + 7 * 86400000).toISOString().split("T")[0];
  const { data } = await ctx.sb.from("cozinha_cardapios")
    .select("data, refeicao, faixa_etaria, observacoes, cozinha_receitas(nome, categoria), descricao_livre")
    .eq("escola_id", escola_id).eq("publicado", true)
    .gte("data", ini).lte("data", fim)
    .order("data").order("refeicao");
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  ALERGIAS / CONFLITO
// ═══════════════════════════════════════════════════════════════
router.on("alergias_conflito_dia", authCoz, requireEscola, coz, async (ctx) => {
  const { data: dt } = ctx.body as any;
  const dia = dt || new Date().toISOString().split("T")[0];
  // Carrega cardápio do dia com alergenos dos ingredientes
  const { data: cards } = await ctx.sb.from("cozinha_cardapios")
    .select("id, refeicao, receita_id, cozinha_receitas(nome, cozinha_receita_ingredientes(cozinha_alimentos(nome, alergenos)))")
    .eq("escola_id", ctx.escola_id!).eq("data", dia);
  // Carrega restrições ativas
  const { data: rest } = await ctx.sb.from("cantina_restricoes")
    .select("*").eq("escola_id", ctx.escola_id!);
  const conflitos: any[] = [];
  for (const c of cards ?? []) {
    const alergenos = new Set<string>();
    const ings = (c as any).cozinha_receitas?.cozinha_receita_ingredientes || [];
    for (const i of ings) (i.cozinha_alimentos?.alergenos || []).forEach((a: string) => alergenos.add(a.toLowerCase()));
    for (const r of rest ?? []) {
      const rd = String((r as any).descricao || "").toLowerCase();
      const rt = String((r as any).tipo || "").toLowerCase();
      for (const a of alergenos) {
        if (rd.includes(a) || rt.includes(a)) {
          conflitos.push({
            aluno_email: (r as any).aluno_email, aluno_nome: (r as any).aluno_nome,
            severidade: (r as any).severidade, refeicao: (c as any).refeicao,
            receita: (c as any).cozinha_receitas?.nome, alergeno: a,
          });
        }
      }
    }
  }
  return successResponse(conflitos);
});

// ═══════════════════════════════════════════════════════════════
//  COMPRAS
// ═══════════════════════════════════════════════════════════════
router.on("compras_projetar", authCoz, requireEscola, coz, async (ctx) => {
  const { dias = 7, porcoes = 100 } = ctx.body as any;
  const { data, error } = await ctx.sb.rpc("cozinha_projetar_compras", {
    p_escola: ctx.escola_id, p_dias: Number(dias), p_porcoes_padrao: Number(porcoes),
  });
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data ?? []);
});

router.on("compras_list", authCoz, requireEscola, coz, async (ctx) => {
  const { status } = ctx.body as any;
  let q = ctx.sb.from("cozinha_compras").select("*")
    .eq("escola_id", ctx.escola_id!).order("criado_em", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data } = await q.limit(200);
  return successResponse(data ?? []);
});

router.on("compra_get", authCoz, requireEscola, coz, async (ctx) => {
  const { id } = ctx.body as any;
  const { data: c } = await ctx.sb.from("cozinha_compras").select("*")
    .eq("id", id).eq("escola_id", ctx.escola_id!).single();
  if (!c) throw new AppError("NOT_FOUND", "Compra não encontrada.");
  const { data: itens } = await ctx.sb.from("cozinha_compra_itens")
    .select("*, cozinha_alimentos(nome, unidade_uso)").eq("compra_id", id);
  return successResponse({ ...c, itens: itens ?? [] });
});

router.on("compra_upsert", authCoz, requireEscola, coz, async (ctx) => {
  const body = ctx.body as any;
  const rec: any = { escola_id: ctx.escola_id };
  for (const k of ["id","status","fornecedor","fornecedor_cnpj","fornecedor_contato","total","data_pedido","data_entrega_prev","nota_fiscal","observacoes"]) {
    if (k in body) rec[k] = body[k];
  }
  if (!rec.criado_por) rec.criado_por = ctx.user?.nome;
  const { data: compra, error } = await ctx.sb.from("cozinha_compras").upsert(rec).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  if (Array.isArray(body.itens)) {
    await ctx.sb.from("cozinha_compra_itens").delete().eq("compra_id", compra.id);
    const itens = body.itens.filter((x: any) => x.alimento_id && x.quantidade).map((x: any) => ({
      compra_id: compra.id, alimento_id: x.alimento_id, quantidade: x.quantidade, unidade: x.unidade,
      preco_unitario: x.preco_unitario, subtotal: (Number(x.quantidade) || 0) * (Number(x.preco_unitario) || 0),
    }));
    if (itens.length) await ctx.sb.from("cozinha_compra_itens").insert(itens);
    const total = itens.reduce((s: number, i: any) => s + (i.subtotal || 0), 0);
    await ctx.sb.from("cozinha_compras").update({ total }).eq("id", compra.id);
  }
  return successResponse(compra);
});

router.on("compra_aprovar", authCoz, requireEscola, coz, async (ctx) => {
  const { id } = ctx.body as any;
  const { error } = await ctx.sb.from("cozinha_compras").update({
    status: "aprovada", aprovado_por: ctx.user?.nome, aprovado_em: new Date().toISOString(),
  }).eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ ok: true });
});

router.on("compra_receber", authCoz, requireEscola, coz, async (ctx) => {
  // itens: [{compra_item_id, recebido_qtd, lote, validade, preco_unitario}]
  const { id, itens, nota_fiscal } = ctx.body as any;
  if (!id || !Array.isArray(itens)) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  const { data: compra } = await ctx.sb.from("cozinha_compras").select("fornecedor, escola_id")
    .eq("id", id).eq("escola_id", ctx.escola_id!).single();
  if (!compra) throw new AppError("NOT_FOUND", "Compra não encontrada.");
  for (const it of itens) {
    const { data: ci } = await ctx.sb.from("cozinha_compra_itens").select("alimento_id, preco_unitario, quantidade")
      .eq("id", it.compra_item_id).eq("compra_id", id).single();
    if (!ci) continue;
    const qty = Number(it.recebido_qtd || ci.quantidade);
    const { data: lote } = await ctx.sb.from("cozinha_alimento_lotes").insert({
      escola_id: ctx.escola_id, alimento_id: ci.alimento_id,
      lote: it.lote, quantidade: qty, quantidade_inicial: qty, validade: it.validade,
      nota_fiscal: nota_fiscal, fornecedor: compra.fornecedor,
      preco_unitario: it.preco_unitario || ci.preco_unitario,
      recebido_por: ctx.user?.nome, conferido: true,
    }).select().single();
    await ctx.sb.from("cozinha_compra_itens").update({
      recebido_qtd: qty, lote_gerado_id: lote?.id,
    }).eq("id", it.compra_item_id);
    // Atualiza preço médio do alimento
    if (it.preco_unitario) {
      await ctx.sb.from("cozinha_alimentos").update({ preco_medio: it.preco_unitario })
        .eq("id", ci.alimento_id).eq("escola_id", ctx.escola_id!);
    }
  }
  await ctx.sb.from("cozinha_compras").update({
    status: "recebida", data_recebimento: new Date().toISOString(), nota_fiscal,
  }).eq("id", id);
  return successResponse({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  CONSUMO (baixar estoque FIFO ao executar refeição)
// ═══════════════════════════════════════════════════════════════
router.on("refeicao_executar", authCoz, requireEscola, coz, async (ctx) => {
  // Dado um cardápio_id e porções servidas, consome os ingredientes via FIFO
  const { cardapio_id, porcoes } = ctx.body as any;
  if (!cardapio_id || !porcoes) throw new AppError("VALIDATION_FAILED", "cardapio_id e porcoes obrigatórios.");
  const { data: card } = await ctx.sb.from("cozinha_cardapios")
    .select("id, data, refeicao, receita_id, cozinha_receitas(cozinha_receita_ingredientes(alimento_id, quantidade))")
    .eq("id", cardapio_id).eq("escola_id", ctx.escola_id!).single();
  if (!card?.receita_id) throw new AppError("NOT_FOUND", "Cardápio ou receita não encontrado.");
  const ings = (card as any).cozinha_receitas?.cozinha_receita_ingredientes || [];
  const resultados: any[] = [];
  let custoTotal = 0;
  for (const ing of ings) {
    const qtd = Number(ing.quantidade) * Number(porcoes);
    const { data: r } = await ctx.sb.rpc("cozinha_baixar_estoque", {
      p_escola: ctx.escola_id, p_alimento: ing.alimento_id, p_qtd: qtd,
      p_cardapio: cardapio_id, p_data: card.data, p_refeicao: card.refeicao,
    });
    custoTotal += Number((r as any)?.custo_total || 0);
    resultados.push({ alimento_id: ing.alimento_id, ...r });
  }
  return successResponse({ ok: true, porcoes, custo_total: custoTotal, custo_porcao: custoTotal / porcoes, resultados });
});

// ═══════════════════════════════════════════════════════════════
//  SANITÁRIO — TEMPERATURA
// ═══════════════════════════════════════════════════════════════
router.on("temperatura_registrar", authCoz, requireEscola, coz, async (ctx) => {
  const { equipamento, tipo, temperatura, periodo, acao_corretiva } = ctx.body as any;
  if (!equipamento || temperatura === undefined) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  const { data: cfg } = await ctx.sb.from("cozinha_config")
    .select("tolerancia_temp_geladeira, tolerancia_temp_freezer")
    .eq("escola_id", ctx.escola_id!).maybeSingle();
  const t = Number(temperatura);
  let conforme = true;
  if (tipo === "refrigerado") conforme = t <= Number(cfg?.tolerancia_temp_geladeira ?? 7);
  else if (tipo === "congelado") conforme = t <= Number(cfg?.tolerancia_temp_freezer ?? -12);
  const { data, error } = await ctx.sb.from("cozinha_temperatura_registros").insert({
    escola_id: ctx.escola_id, equipamento, tipo, temperatura: t, periodo, conforme, acao_corretiva,
    registrado_por: ctx.user?.nome,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("temperatura_list", authCoz, requireEscola, coz, async (ctx) => {
  const { dias = 30 } = ctx.body as any;
  const desde = new Date(Date.now() - Number(dias) * 86400000).toISOString();
  const { data } = await ctx.sb.from("cozinha_temperatura_registros").select("*")
    .eq("escola_id", ctx.escola_id!).gte("registrado_em", desde)
    .order("registrado_em", { ascending: false }).limit(500);
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  SANITÁRIO — HIGIENIZAÇÃO
// ═══════════════════════════════════════════════════════════════
router.on("higienizacao_tarefas_list", authCoz, requireEscola, coz, async (ctx) => {
  const { data } = await ctx.sb.from("cozinha_higienizacao_tarefas").select("*")
    .eq("escola_id", ctx.escola_id!).eq("ativa", true).order("periodicidade").order("nome");
  return successResponse(data ?? []);
});

router.on("higienizacao_tarefa_upsert", authCoz, requireEscola, coz, async (ctx) => {
  const body = ctx.body as any;
  const rec: any = { escola_id: ctx.escola_id };
  for (const k of ["id","nome","area","periodicidade","ativa"]) if (k in body) rec[k] = body[k];
  if (!rec.nome || !rec.periodicidade) throw new AppError("VALIDATION_FAILED", "nome e periodicidade obrigatórios.");
  const { data, error } = await ctx.sb.from("cozinha_higienizacao_tarefas").upsert(rec).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("higienizacao_executar", authCoz, requireEscola, coz, async (ctx) => {
  const { tarefa_id, observacao, conforme = true } = ctx.body as any;
  if (!tarefa_id) throw new AppError("VALIDATION_FAILED", "tarefa_id obrigatório.");
  const { data, error } = await ctx.sb.from("cozinha_higienizacao_execucoes").insert({
    escola_id: ctx.escola_id, tarefa_id, observacao, conforme,
    executado_por: ctx.user?.nome,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("higienizacao_status", authCoz, requireEscola, coz, async (ctx) => {
  // Retorna tarefas com última execução e alerta de atraso
  const { data: tarefas } = await ctx.sb.from("cozinha_higienizacao_tarefas")
    .select("*").eq("escola_id", ctx.escola_id!).eq("ativa", true);
  const out: any[] = [];
  const now = Date.now();
  const prazoDias: Record<string, number> = { diaria: 1, semanal: 7, quinzenal: 15, mensal: 30 };
  for (const t of tarefas ?? []) {
    const { data: ult } = await ctx.sb.from("cozinha_higienizacao_execucoes")
      .select("executado_em, executado_por").eq("tarefa_id", t.id)
      .order("executado_em", { ascending: false }).limit(1).maybeSingle();
    const prazo = prazoDias[(t as any).periodicidade] || 7;
    let atraso_dias = null;
    if (ult?.executado_em) {
      const diff = (now - new Date(ult.executado_em).getTime()) / 86400000;
      atraso_dias = Math.max(0, Math.floor(diff - prazo));
    } else atraso_dias = 999;
    out.push({ ...t, ultima_execucao: ult?.executado_em, ultima_por: ult?.executado_por, atraso_dias, vencida: atraso_dias > 0 });
  }
  return successResponse(out);
});

// ═══════════════════════════════════════════════════════════════
//  AMOSTRAS TESTEMUNHA (72h RDC 216)
// ═══════════════════════════════════════════════════════════════
router.on("amostra_coletar", authCoz, requireEscola, coz, async (ctx) => {
  const { data: dt, refeicao, receita_id, descricao, lotes_utilizados } = ctx.body as any;
  if (!dt || !refeicao) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  const { data: cfg } = await ctx.sb.from("cozinha_config")
    .select("amostra_horas").eq("escola_id", ctx.escola_id!).maybeSingle();
  const horas = Number(cfg?.amostra_horas ?? 72);
  const armazenado_ate = new Date(Date.now() + horas * 3600000).toISOString();
  const { data, error } = await ctx.sb.from("cozinha_amostras").insert({
    escola_id: ctx.escola_id, data: dt, refeicao, receita_id, descricao, lotes_utilizados,
    coletado_por: ctx.user?.nome, armazenado_ate,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("amostras_list", authCoz, requireEscola, coz, async (ctx) => {
  const { dias = 7 } = ctx.body as any;
  const desde = new Date(Date.now() - Number(dias) * 86400000).toISOString();
  const { data } = await ctx.sb.from("cozinha_amostras")
    .select("*, cozinha_receitas(nome)").eq("escola_id", ctx.escola_id!)
    .gte("coletado_em", desde).order("coletado_em", { ascending: false });
  return successResponse(data ?? []);
});

router.on("amostra_descartar", authCoz, requireEscola, coz, async (ctx) => {
  const { id } = ctx.body as any;
  const { error } = await ctx.sb.from("cozinha_amostras").update({
    descartado_em: new Date().toISOString(), descartado_por: ctx.user?.nome,
  }).eq("id", id).eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  DESPERDÍCIO
// ═══════════════════════════════════════════════════════════════
router.on("desperdicio_registrar", authCoz, requireEscola, coz, async (ctx) => {
  const body = ctx.body as any;
  const rec: any = { escola_id: ctx.escola_id, registrado_por: ctx.user?.nome };
  for (const k of ["data","refeicao","receita_id","porcoes_preparadas","porcoes_servidas","sobra_limpa_kg","sobra_suja_kg","observacao"]) {
    if (k in body) rec[k] = body[k];
  }
  if (rec.porcoes_servidas && rec.sobra_suja_kg) {
    rec.per_capita_g = (Number(rec.sobra_suja_kg) * 1000) / Number(rec.porcoes_servidas);
  }
  const { data, error } = await ctx.sb.from("cozinha_desperdicio").insert(rec).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("desperdicio_list", authCoz, requireEscola, coz, async (ctx) => {
  const { dias = 30 } = ctx.body as any;
  const desde = new Date(Date.now() - Number(dias) * 86400000).toISOString().split("T")[0];
  const { data } = await ctx.sb.from("cozinha_desperdicio")
    .select("*, cozinha_receitas(nome)").eq("escola_id", ctx.escola_id!)
    .gte("data", desde).order("data", { ascending: false });
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD / KPIs
// ═══════════════════════════════════════════════════════════════
router.on("dashboard", authCoz, requireEscola, coz, async (ctx) => {
  const hoje = new Date().toISOString().split("T")[0];
  const sete = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
  const mes30 = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

  const [estoque, vencendo, cardApr, cardPend, amostrasAtivas, tempHoje, hig, desp30] = await Promise.all([
    ctx.sb.from("v_cozinha_estoque").select("alimento_id, estoque_valido, estoque_minimo").eq("escola_id", ctx.escola_id!),
    ctx.sb.from("cozinha_alimento_lotes").select("id", { count: "exact", head: true })
      .eq("escola_id", ctx.escola_id!).gt("quantidade", 0)
      .not("validade", "is", null).lte("validade", sete),
    ctx.sb.from("cozinha_cardapios").select("id", { count: "exact", head: true })
      .eq("escola_id", ctx.escola_id!).gte("data", hoje).lte("data", sete).not("aprovado_em", "is", null),
    ctx.sb.from("cozinha_cardapios").select("id", { count: "exact", head: true })
      .eq("escola_id", ctx.escola_id!).gte("data", hoje).lte("data", sete).is("aprovado_em", null),
    ctx.sb.from("cozinha_amostras").select("id", { count: "exact", head: true })
      .eq("escola_id", ctx.escola_id!).is("descartado_em", null),
    ctx.sb.from("cozinha_temperatura_registros").select("conforme")
      .eq("escola_id", ctx.escola_id!).gte("registrado_em", hoje),
    ctx.sb.rpc ? null : null,
    ctx.sb.from("cozinha_desperdicio").select("per_capita_g, sobra_suja_kg, porcoes_servidas")
      .eq("escola_id", ctx.escola_id!).gte("data", mes30),
  ]);

  const abaixoMin = (estoque.data ?? []).filter((e: any) => Number(e.estoque_valido) < Number(e.estoque_minimo || 0)).length;
  const tempRegs = tempHoje.data ?? [];
  const tempNaoConforme = tempRegs.filter((r: any) => !r.conforme).length;
  const desp = desp30.data ?? [];
  const totalSobra = desp.reduce((s: number, d: any) => s + Number(d.sobra_suja_kg || 0), 0);
  const totalPorc = desp.reduce((s: number, d: any) => s + Number(d.porcoes_servidas || 0), 0);

  return successResponse({
    estoque_abaixo_minimo: abaixoMin,
    lotes_vencendo_7d: vencendo.count ?? 0,
    cardapios_aprovados_7d: cardApr.count ?? 0,
    cardapios_pendentes_7d: cardPend.count ?? 0,
    amostras_ativas: amostrasAtivas.count ?? 0,
    temperaturas_hoje: tempRegs.length,
    temperaturas_nao_conformes_hoje: tempNaoConforme,
    desperdicio_per_capita_g_30d: totalPorc > 0 ? (totalSobra * 1000) / totalPorc : 0,
    desperdicio_total_kg_30d: totalSobra,
  });
});

// ═══════════════════════════════════════════════════════════════
//  JOB: descartar amostras vencidas + alertar vencimentos
// ═══════════════════════════════════════════════════════════════
router.on("job_limpeza", async (ctx) => {
  const now = new Date().toISOString();
  const { data } = await ctx.sb.from("cozinha_amostras")
    .update({ descartado_em: now, descartado_por: "system" })
    .lt("armazenado_ate", now).is("descartado_em", null).select("id");
  log.info("Amostras descartadas", { metadata: { count: data?.length ?? 0 } });
  return successResponse({ descartadas: data?.length ?? 0 });
});

serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
