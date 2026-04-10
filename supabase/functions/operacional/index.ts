// ═══════════════════════════════════════════════════════════════
//  Edge Function: operacional (v2 — Router Pattern)
//  Biblioteca, Cantina, Transporte
//
//  Tenant scoping (escola_id):
//    ✓ biblioteca_acervo       — escola_id via migration 074
//    ✓ transporte_rotas         — escola_id via migration 074
//    ✓ cantina_cardapio         — escola_id via migration 074
//    ✗ biblioteca_emprestimos   — no escola_id column (filtered via acervo_id)
//    ✗ biblioteca_reservas      — no escola_id column
//    ✗ cantina_creditos         — no escola_id column (TODO add in later migration)
//    ✗ cantina_transacoes       — no escola_id column
//    ✗ cantina_restricoes       — no escola_id column
//    ✗ transporte_alunos        — no escola_id column (filtered via rota_id)
//    ✗ transporte_rastreio      — no escola_id column (filtered via rota_id)
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerenteOrSecretaria, requireFeature, requireEscola } from "../_shared/router.ts";
import { successResponse, AppError } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("operacional");
const router = new Router("operacional");
router.useGlobal(rateLimit());

// Unified auth: gerente OR secretaria/equipe. Populates ctx.escola_id.
const authOp = authGerenteOrSecretaria(["gerente", "diretor", "secretaria", "comercial"]);

// ═══ BIBLIOTECA ═══
const bib = requireFeature("biblioteca");

router.on("acervo_list", authOp, requireEscola, bib, async (ctx) => {
  const { categoria, busca } = ctx.body as any;
  let q = ctx.sb
    .from("biblioteca_acervo")
    .select("*")
    .eq("escola_id", ctx.escola_id!)
    .eq("ativo", true)
    .order("titulo");
  if (categoria) q = q.eq("categoria", categoria);
  if (busca) q = q.or(`titulo.ilike.%${busca}%,autor.ilike.%${busca}%,isbn.ilike.%${busca}%`);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("acervo_create", authOp, requireEscola, bib, async (ctx) => {
  const { titulo, autor, isbn, editora, codigo_barras, categoria, localizacao, quantidade, capa_url, sinopse, ano_publicacao } = ctx.body as any;
  if (!titulo) throw new AppError("VALIDATION_FAILED", "Título obrigatório.");
  const { data, error } = await ctx.sb.from("biblioteca_acervo").insert({
    escola_id: ctx.escola_id,
    titulo, autor, isbn, editora, codigo_barras, categoria, localizacao,
    quantidade: quantidade || 1, disponivel: quantidade || 1, capa_url, sinopse, ano_publicacao,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("acervo_update", authOp, requireEscola, bib, async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token;
  // Never allow escola_id to be changed via update
  delete fields.escola_id;
  const { error } = await ctx.sb
    .from("biblioteca_acervo")
    .update(fields)
    .eq("id", id)
    .eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("emprestimo_create", authOp, requireEscola, bib, async (ctx) => {
  const { acervo_id, aluno_email, aluno_nome, data_devolucao_prevista } = ctx.body as any;
  if (!acervo_id || !aluno_email) throw new AppError("VALIDATION_FAILED", "acervo_id e aluno_email obrigatórios.");
  // Verify the acervo belongs to this escola before creating the loan
  const { data: livro } = await ctx.sb
    .from("biblioteca_acervo")
    .select("disponivel")
    .eq("id", acervo_id)
    .eq("escola_id", ctx.escola_id!)
    .single();
  if (!livro) throw new AppError("NOT_FOUND", "Livro não encontrado nesta escola.");
  if (livro.disponivel <= 0) throw new AppError("CONFLICT", "Livro não disponível.");
  await ctx.sb
    .from("biblioteca_acervo")
    .update({ disponivel: livro.disponivel - 1 })
    .eq("id", acervo_id)
    .eq("escola_id", ctx.escola_id!);
  // biblioteca_emprestimos does not (yet) have escola_id; tenant scoping is via acervo_id
  const { data, error } = await ctx.sb.from("biblioteca_emprestimos").insert({
    acervo_id, aluno_email, aluno_nome,
    data_devolucao_prevista: data_devolucao_prevista || new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("Empréstimo criado", { metadata: { acervo_id, aluno_email } });
  return successResponse(data);
});

router.on("emprestimo_devolver", authOp, requireEscola, bib, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  // Join via acervo to enforce escola scope
  const { data: emp } = await ctx.sb
    .from("biblioteca_emprestimos")
    .select("acervo_id, data_devolucao_prevista, biblioteca_acervo!inner(escola_id)")
    .eq("id", id)
    .eq("biblioteca_acervo.escola_id", ctx.escola_id!)
    .single();
  if (!emp) throw new AppError("NOT_FOUND", "Empréstimo não encontrado.");
  const hoje = new Date().toISOString().split("T")[0];
  let multa = 0;
  if (hoje > emp.data_devolucao_prevista) {
    multa = Math.ceil((new Date(hoje).getTime() - new Date(emp.data_devolucao_prevista).getTime()) / 86400000);
  }
  await ctx.sb.from("biblioteca_emprestimos").update({ data_devolucao_real: hoje, status: "devolvido", multa }).eq("id", id);
  const { data: l } = await ctx.sb
    .from("biblioteca_acervo")
    .select("disponivel")
    .eq("id", emp.acervo_id)
    .eq("escola_id", ctx.escola_id!)
    .single();
  if (l) await ctx.sb
    .from("biblioteca_acervo")
    .update({ disponivel: (l.disponivel || 0) + 1 })
    .eq("id", emp.acervo_id)
    .eq("escola_id", ctx.escola_id!);
  return successResponse({ success: true, multa });
});

router.on("emprestimos_list", authOp, requireEscola, bib, async (ctx) => {
  const { status, aluno_email } = ctx.body as any;
  // biblioteca_emprestimos has no escola_id column; scope via acervo join
  let q = ctx.sb
    .from("biblioteca_emprestimos")
    .select("*, biblioteca_acervo!inner(titulo, autor, escola_id)")
    .eq("biblioteca_acervo.escola_id", ctx.escola_id!)
    .order("data_emprestimo", { ascending: false });
  if (status) q = q.eq("status", status);
  if (aluno_email) q = q.eq("aluno_email", aluno_email);
  const { data } = await q.limit(200);
  return successResponse(data ?? []);
});

router.on("reserva_create", authOp, requireEscola, bib, async (ctx) => {
  const { acervo_id, aluno_email, aluno_nome } = ctx.body as any;
  if (!acervo_id || !aluno_email) throw new AppError("VALIDATION_FAILED", "acervo_id e aluno_email obrigatórios.");
  // Verify acervo belongs to this escola
  const { data: ac } = await ctx.sb
    .from("biblioteca_acervo")
    .select("id")
    .eq("id", acervo_id)
    .eq("escola_id", ctx.escola_id!)
    .maybeSingle();
  if (!ac) throw new AppError("NOT_FOUND", "Livro não encontrado nesta escola.");
  // biblioteca_reservas has no escola_id column (TODO add in later migration)
  const { data, error } = await ctx.sb.from("biblioteca_reservas").insert({ acervo_id, aluno_email, aluno_nome }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

// ═══ CANTINA ═══
const cant = requireFeature("cantina");

router.on("cantina_cardapio_list", authOp, requireEscola, cant, async (ctx) => {
  const { data_inicio, data_fim } = ctx.body as any;
  let q = ctx.sb
    .from("cantina_cardapio")
    .select("*")
    .eq("escola_id", ctx.escola_id!)
    .order("data")
    .order("refeicao");
  if (data_inicio) q = q.gte("data", data_inicio);
  if (data_fim) q = q.lte("data", data_fim);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("cantina_cardapio_upsert", authOp, requireEscola, cant, async (ctx) => {
  const { data: dataStr, refeicao, itens, observacoes } = ctx.body as any;
  if (!dataStr || !refeicao) throw new AppError("VALIDATION_FAILED", "data e refeicao obrigatórios.");
  const { error } = await ctx.sb.from("cantina_cardapio").upsert(
    { escola_id: ctx.escola_id, data: dataStr, refeicao, itens: itens || [], observacoes },
    { onConflict: "data,refeicao" },
  );
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("cantina_credito_add", authOp, requireEscola, cant, async (ctx) => {
  // NOTE: cantina_creditos and cantina_transacoes don't yet have escola_id.
  // TODO: add column in a later migration and filter here.
  const { aluno_email, aluno_nome, valor, descricao } = ctx.body as any;
  if (!aluno_email || !valor) throw new AppError("VALIDATION_FAILED", "aluno_email e valor obrigatórios.");
  const { data: existing } = await ctx.sb.from("cantina_creditos").select("saldo").eq("aluno_email", aluno_email).single();
  const novoSaldo = (existing?.saldo || 0) + valor;
  await ctx.sb.from("cantina_creditos").upsert({ aluno_email, aluno_nome, saldo: novoSaldo, atualizado_em: new Date().toISOString() }, { onConflict: "aluno_email" });
  await ctx.sb.from("cantina_transacoes").insert({ aluno_email, tipo: valor > 0 ? "credito" : "debito", valor: Math.abs(valor), descricao });
  return successResponse({ success: true, saldo: novoSaldo });
});

router.on("cantina_restricoes_list", authOp, requireEscola, cant, async (ctx) => {
  // NOTE: cantina_restricoes doesn't yet have escola_id.
  // TODO: add column in a later migration and filter here.
  const { aluno_email } = ctx.body as any;
  let q = ctx.sb.from("cantina_restricoes").select("*").order("aluno_nome");
  if (aluno_email) q = q.eq("aluno_email", aluno_email);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("cantina_restricoes_create", authOp, requireEscola, cant, async (ctx) => {
  // NOTE: cantina_restricoes doesn't yet have escola_id.
  const { aluno_email, aluno_nome, tipo, descricao, severidade } = ctx.body as any;
  if (!aluno_email || !tipo || !descricao) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  const { data, error } = await ctx.sb.from("cantina_restricoes").insert({ aluno_email, aluno_nome, tipo, descricao, severidade }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

// ═══ TRANSPORTE ═══
const transp = requireFeature("transporte");

router.on("transporte_rotas_list", authOp, requireEscola, transp, async (ctx) => {
  const { data } = await ctx.sb
    .from("transporte_rotas")
    .select("*, transporte_alunos(count)")
    .eq("escola_id", ctx.escola_id!)
    .eq("ativo", true)
    .order("nome");
  return successResponse(data ?? []);
});

router.on("transporte_rotas_create", authOp, requireEscola, transp, async (ctx) => {
  const { nome, turno, motorista_nome, motorista_telefone, motorista_cnh, veiculo, placa, capacidade } = ctx.body as any;
  if (!nome) throw new AppError("VALIDATION_FAILED", "Nome obrigatório.");
  const { data, error } = await ctx.sb.from("transporte_rotas").insert({
    escola_id: ctx.escola_id,
    nome, turno, motorista_nome, motorista_telefone, motorista_cnh, veiculo, placa, capacidade,
  }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("transporte_rotas_update", authOp, requireEscola, transp, async (ctx) => {
  const body = ctx.body as any;
  const { id } = body;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const ALLOWED = [
    "nome", "turno", "motorista_nome", "motorista_telefone", "motorista_cnh",
    "motorista", "veiculo", "placa", "capacidade", "tarifa", "ativo",
  ];
  const update: Record<string, unknown> = {};
  for (const k of ALLOWED) if (k in body) update[k] = body[k];
  const { error } = await ctx.sb
    .from("transporte_rotas")
    .update(update)
    .eq("id", id)
    .eq("escola_id", ctx.escola_id!);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("transporte_alunos_list", authOp, requireEscola, transp, async (ctx) => {
  const { rota_id } = ctx.body as any;
  // transporte_alunos has no escola_id column; scope via rota join
  let q = ctx.sb
    .from("transporte_alunos")
    .select("*, transporte_rotas!inner(nome, escola_id)")
    .eq("transporte_rotas.escola_id", ctx.escola_id!)
    .eq("ativo", true)
    .order("ordem");
  if (rota_id) q = q.eq("rota_id", rota_id);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("transporte_alunos_assign", authOp, requireEscola, transp, async (ctx) => {
  const { rota_id, aluno_email, aluno_nome, ponto_embarque, endereco, ordem } = ctx.body as any;
  if (!rota_id || !aluno_email) throw new AppError("VALIDATION_FAILED", "rota_id e aluno_email obrigatórios.");
  // Verify the rota belongs to this escola
  const { data: rota } = await ctx.sb
    .from("transporte_rotas")
    .select("id")
    .eq("id", rota_id)
    .eq("escola_id", ctx.escola_id!)
    .maybeSingle();
  if (!rota) throw new AppError("NOT_FOUND", "Rota não encontrada nesta escola.");
  const { data, error } = await ctx.sb.from("transporte_alunos").upsert({ rota_id, aluno_email, aluno_nome, ponto_embarque, endereco, ordem }, { onConflict: "rota_id,aluno_email" }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("transporte_rastreio_update", authOp, requireEscola, transp, async (ctx) => {
  const { rota_id, latitude, longitude, velocidade, direcao } = ctx.body as any;
  if (!rota_id || latitude === undefined || longitude === undefined) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  // Verify rota belongs to this escola
  const { data: rota } = await ctx.sb
    .from("transporte_rotas")
    .select("id")
    .eq("id", rota_id)
    .eq("escola_id", ctx.escola_id!)
    .maybeSingle();
  if (!rota) throw new AppError("NOT_FOUND", "Rota não encontrada nesta escola.");
  const { error } = await ctx.sb.from("transporte_rastreio").insert({ rota_id, latitude, longitude, velocidade, direcao });
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("transporte_rastreio_get", authOp, requireEscola, transp, async (ctx) => {
  const { rota_id } = ctx.body as any;
  if (!rota_id) throw new AppError("VALIDATION_FAILED", "rota_id obrigatório.");
  // Verify rota belongs to this escola first
  const { data: rota } = await ctx.sb
    .from("transporte_rotas")
    .select("id")
    .eq("id", rota_id)
    .eq("escola_id", ctx.escola_id!)
    .maybeSingle();
  if (!rota) throw new AppError("NOT_FOUND", "Rota não encontrada nesta escola.");
  const { data } = await ctx.sb.from("transporte_rastreio").select("*").eq("rota_id", rota_id).order("registrado_em", { ascending: false }).limit(1).single();
  return successResponse(data || {});
});

serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
