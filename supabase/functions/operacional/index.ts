// ═══════════════════════════════════════════════════════════════
//  Edge Function: operacional (v2 — Router Pattern)
//  Biblioteca, Cantina, Transporte
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, requireFeature } from "../_shared/router.ts";
import { successResponse, AppError } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("operacional");
const router = new Router("operacional");
router.useGlobal(rateLimit());

// Auth middleware: gerente (legado) OU secretaria/equipe (sessão unificada)
const authGerenteOuSecretaria: import("../_shared/router.ts").Middleware = async (ctx, next) => {
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

  const { data: ss } = await ctx.sb
    .from("secretaria_sessoes")
    .select("*, secretarias(id, nome, email)")
    .eq("token", token)
    .maybeSingle();
  if (ss && new Date(ss.expira_em) >= new Date()) {
    ctx.user = { ...(ss as any).secretarias, tipo: "secretaria" };
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
    const permitidos = ["gerente", "diretor", "secretaria", "comercial"];
    if (papeis.some((p: string) => permitidos.includes(p))) {
      ctx.user = { ...usuario, tipo: papeis[0] };
      return next();
    }
  }

  throw new AppError("AUTH_INVALID", "Sessão inválida ou sem permissão.");
};

// ═══ BIBLIOTECA ═══
const bib = requireFeature("biblioteca");

router.on("acervo_list", bib, async (ctx) => {
  const { categoria, busca } = ctx.body as any;
  let q = ctx.sb.from("biblioteca_acervo").select("*").eq("ativo", true).order("titulo");
  if (categoria) q = q.eq("categoria", categoria);
  if (busca) q = q.or(`titulo.ilike.%${busca}%,autor.ilike.%${busca}%,isbn.ilike.%${busca}%`);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("acervo_create", authGerente, bib, async (ctx) => {
  const { titulo, autor, isbn, editora, codigo_barras, categoria, localizacao, quantidade, capa_url, sinopse, ano_publicacao } = ctx.body as any;
  if (!titulo) throw new AppError("VALIDATION_FAILED", "Título obrigatório.");
  const { data, error } = await ctx.sb.from("biblioteca_acervo").insert({ titulo, autor, isbn, editora, codigo_barras, categoria, localizacao, quantidade: quantidade || 1, disponivel: quantidade || 1, capa_url, sinopse, ano_publicacao }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("acervo_update", authGerente, bib, async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token;
  const { error } = await ctx.sb.from("biblioteca_acervo").update(fields).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("emprestimo_create", authGerente, bib, async (ctx) => {
  const { acervo_id, aluno_email, aluno_nome, data_devolucao_prevista } = ctx.body as any;
  if (!acervo_id || !aluno_email) throw new AppError("VALIDATION_FAILED", "acervo_id e aluno_email obrigatórios.");
  const { data: livro } = await ctx.sb.from("biblioteca_acervo").select("disponivel").eq("id", acervo_id).single();
  if (!livro || livro.disponivel <= 0) throw new AppError("CONFLICT", "Livro não disponível.");
  await ctx.sb.from("biblioteca_acervo").update({ disponivel: livro.disponivel - 1 }).eq("id", acervo_id);
  const { data, error } = await ctx.sb.from("biblioteca_emprestimos").insert({ acervo_id, aluno_email, aluno_nome, data_devolucao_prevista: data_devolucao_prevista || new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0] }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("Empréstimo criado", { metadata: { acervo_id, aluno_email } });
  return successResponse(data);
});

router.on("emprestimo_devolver", authGerente, bib, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  const { data: emp } = await ctx.sb.from("biblioteca_emprestimos").select("acervo_id, data_devolucao_prevista").eq("id", id).single();
  if (!emp) throw new AppError("NOT_FOUND", "Empréstimo não encontrado.");
  const hoje = new Date().toISOString().split("T")[0];
  let multa = 0;
  if (hoje > emp.data_devolucao_prevista) {
    multa = Math.ceil((new Date(hoje).getTime() - new Date(emp.data_devolucao_prevista).getTime()) / 86400000);
  }
  await ctx.sb.from("biblioteca_emprestimos").update({ data_devolucao_real: hoje, status: "devolvido", multa }).eq("id", id);
  const { data: l } = await ctx.sb.from("biblioteca_acervo").select("disponivel").eq("id", emp.acervo_id).single();
  if (l) await ctx.sb.from("biblioteca_acervo").update({ disponivel: (l.disponivel || 0) + 1 }).eq("id", emp.acervo_id);
  return successResponse({ success: true, multa });
});

router.on("emprestimos_list", bib, async (ctx) => {
  const { status, aluno_email } = ctx.body as any;
  let q = ctx.sb.from("biblioteca_emprestimos").select("*, biblioteca_acervo(titulo, autor)").order("data_emprestimo", { ascending: false });
  if (status) q = q.eq("status", status);
  if (aluno_email) q = q.eq("aluno_email", aluno_email);
  const { data } = await q.limit(200);
  return successResponse(data ?? []);
});

router.on("reserva_create", bib, async (ctx) => {
  const { acervo_id, aluno_email, aluno_nome } = ctx.body as any;
  if (!acervo_id || !aluno_email) throw new AppError("VALIDATION_FAILED", "acervo_id e aluno_email obrigatórios.");
  const { data, error } = await ctx.sb.from("biblioteca_reservas").insert({ acervo_id, aluno_email, aluno_nome }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

// ═══ CANTINA ═══
const cant = requireFeature("cantina");

router.on("cantina_cardapio_list", cant, async (ctx) => {
  const { data_inicio, data_fim } = ctx.body as any;
  let q = ctx.sb.from("cantina_cardapio").select("*").order("data").order("refeicao");
  if (data_inicio) q = q.gte("data", data_inicio);
  if (data_fim) q = q.lte("data", data_fim);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("cantina_cardapio_upsert", authGerente, cant, async (ctx) => {
  const { data: dataStr, refeicao, itens, observacoes } = ctx.body as any;
  if (!dataStr || !refeicao) throw new AppError("VALIDATION_FAILED", "data e refeicao obrigatórios.");
  const { error } = await ctx.sb.from("cantina_cardapio").upsert({ data: dataStr, refeicao, itens: itens || [], observacoes }, { onConflict: "data,refeicao" });
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("cantina_credito_add", authGerente, cant, async (ctx) => {
  const { aluno_email, aluno_nome, valor, descricao } = ctx.body as any;
  if (!aluno_email || !valor) throw new AppError("VALIDATION_FAILED", "aluno_email e valor obrigatórios.");
  const { data: existing } = await ctx.sb.from("cantina_creditos").select("saldo").eq("aluno_email", aluno_email).single();
  const novoSaldo = (existing?.saldo || 0) + valor;
  await ctx.sb.from("cantina_creditos").upsert({ aluno_email, aluno_nome, saldo: novoSaldo, atualizado_em: new Date().toISOString() }, { onConflict: "aluno_email" });
  await ctx.sb.from("cantina_transacoes").insert({ aluno_email, tipo: valor > 0 ? "credito" : "debito", valor: Math.abs(valor), descricao });
  return successResponse({ success: true, saldo: novoSaldo });
});

router.on("cantina_restricoes_list", cant, async (ctx) => {
  const { aluno_email } = ctx.body as any;
  let q = ctx.sb.from("cantina_restricoes").select("*").order("aluno_nome");
  if (aluno_email) q = q.eq("aluno_email", aluno_email);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("cantina_restricoes_create", authGerenteOuSecretaria, cant, async (ctx) => {
  const { aluno_email, aluno_nome, tipo, descricao, severidade } = ctx.body as any;
  if (!aluno_email || !tipo || !descricao) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  const { data, error } = await ctx.sb.from("cantina_restricoes").insert({ aluno_email, aluno_nome, tipo, descricao, severidade }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

// ═══ TRANSPORTE ═══
const transp = requireFeature("transporte");

router.on("transporte_rotas_list", transp, async (ctx) => {
  const { data } = await ctx.sb.from("transporte_rotas").select("*, transporte_alunos(count)").eq("ativo", true).order("nome");
  return successResponse(data ?? []);
});

router.on("transporte_rotas_create", authGerente, transp, async (ctx) => {
  const { nome, turno, motorista_nome, motorista_telefone, motorista_cnh, veiculo, placa, capacidade } = ctx.body as any;
  if (!nome) throw new AppError("VALIDATION_FAILED", "Nome obrigatório.");
  const { data, error } = await ctx.sb.from("transporte_rotas").insert({ nome, turno, motorista_nome, motorista_telefone, motorista_cnh, veiculo, placa, capacidade }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("transporte_rotas_update", authGerente, transp, async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token;
  const { error } = await ctx.sb.from("transporte_rotas").update(fields).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("transporte_alunos_list", transp, async (ctx) => {
  const { rota_id } = ctx.body as any;
  let q = ctx.sb.from("transporte_alunos").select("*, transporte_rotas(nome)").eq("ativo", true).order("ordem");
  if (rota_id) q = q.eq("rota_id", rota_id);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("transporte_alunos_assign", authGerente, transp, async (ctx) => {
  const { rota_id, aluno_email, aluno_nome, ponto_embarque, endereco, ordem } = ctx.body as any;
  if (!rota_id || !aluno_email) throw new AppError("VALIDATION_FAILED", "rota_id e aluno_email obrigatórios.");
  const { data, error } = await ctx.sb.from("transporte_alunos").upsert({ rota_id, aluno_email, aluno_nome, ponto_embarque, endereco, ordem }, { onConflict: "rota_id,aluno_email" }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

router.on("transporte_rastreio_update", authGerente, transp, async (ctx) => {
  const { rota_id, latitude, longitude, velocidade, direcao } = ctx.body as any;
  if (!rota_id || latitude === undefined || longitude === undefined) throw new AppError("VALIDATION_FAILED", "Campos obrigatórios.");
  const { error } = await ctx.sb.from("transporte_rastreio").insert({ rota_id, latitude, longitude, velocidade, direcao });
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("transporte_rastreio_get", transp, async (ctx) => {
  const { rota_id } = ctx.body as any;
  if (!rota_id) throw new AppError("VALIDATION_FAILED", "rota_id obrigatório.");
  const { data } = await ctx.sb.from("transporte_rastreio").select("*").eq("rota_id", rota_id).order("registrado_em", { ascending: false }).limit(1).single();
  return successResponse(data || {});
});

serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
