// ═══════════════════════════════════════════════════════════════
//  Edge Function: loja (v2 — Router Pattern)
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, requireFeature } from "../_shared/router.ts";
import { successResponse, AppError } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("loja");
const router = new Router("loja");
router.useGlobal(rateLimit());

const feat = requireFeature("ecommerce");

router.on("produtos_list", feat, async (ctx) => {
  const { categoria, busca, ativo_only } = ctx.body as any;
  let q = ctx.sb.from("loja_produtos").select("*").order("destaque", { ascending: false }).order("nome");
  if (ativo_only !== false) q = q.eq("ativo", true);
  if (categoria) q = q.eq("categoria", categoria);
  if (busca) q = q.ilike("nome", `%${busca}%`);
  const { data } = await q;
  return successResponse(data ?? []);
});

router.on("produtos_create", authGerente, feat, async (ctx) => {
  const { nome, descricao, categoria, preco, preco_promocional, estoque, imagem_url, tamanhos, destaque } = ctx.body as any;
  if (!nome || !preco) throw new AppError("VALIDATION_FAILED", "Nome e preço obrigatórios.");
  const { data, error } = await ctx.sb.from("loja_produtos").insert({ nome, descricao, categoria, preco, preco_promocional, estoque, imagem_url, tamanhos, destaque }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("Produto criado", { metadata: { nome } });
  return successResponse(data);
});

router.on("produtos_update", authGerente, feat, async (ctx) => {
  const { id, ...fields } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");
  delete fields.action; delete fields._token;
  const { error } = await ctx.sb.from("loja_produtos").update(fields).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("pedidos_list", feat, async (ctx) => {
  const { familia_email, status } = ctx.body as any;
  let q = ctx.sb.from("loja_pedidos").select("*, loja_itens_pedido(*, loja_produtos(nome, imagem_url))").order("criado_em", { ascending: false });
  if (familia_email) q = q.eq("familia_email", familia_email);
  if (status) q = q.eq("status", status);
  const { data } = await q.limit(100);
  return successResponse(data ?? []);
});

router.on("pedido_create", feat, async (ctx) => {
  const { familia_email, familia_nome, itens } = ctx.body as { familia_email: string; familia_nome: string; itens: Array<{ produto_id: string; quantidade: number; tamanho?: string }> };
  if (!familia_email || !Array.isArray(itens) || !itens.length) throw new AppError("VALIDATION_FAILED", "Email e itens obrigatórios.");
  let total = 0;
  const itensDetalhados = [];
  for (const item of itens) {
    const { data: produto } = await ctx.sb.from("loja_produtos").select("preco, preco_promocional, estoque, nome").eq("id", item.produto_id).single();
    if (!produto) throw new AppError("NOT_FOUND", "Produto não encontrado: " + item.produto_id);
    if (produto.estoque < item.quantidade) throw new AppError("CONFLICT", `Estoque insuficiente para ${produto.nome}.`);
    const preco = produto.preco_promocional || produto.preco;
    const subtotal = preco * item.quantidade;
    total += subtotal;
    itensDetalhados.push({ produto_id: item.produto_id, quantidade: item.quantidade, tamanho: item.tamanho, preco_unitario: preco, subtotal });
  }
  const { data: pedido, error } = await ctx.sb.from("loja_pedidos").insert({ familia_email, familia_nome, total, subtotal: total }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  await ctx.sb.from("loja_itens_pedido").insert(itensDetalhados.map(i => ({ ...i, pedido_id: pedido.id })));
  for (const item of itens) {
    const { data: p } = await ctx.sb.from("loja_produtos").select("estoque").eq("id", item.produto_id).single();
    if (p) await ctx.sb.from("loja_produtos").update({ estoque: Math.max(0, p.estoque - item.quantidade) }).eq("id", item.produto_id);
  }
  log.info("Pedido criado", { metadata: { pedido_id: pedido.id, total } });
  return successResponse(pedido);
});

router.on("pedido_update_status", authGerente, feat, async (ctx) => {
  const { id, status } = ctx.body as any;
  if (!id || !status) throw new AppError("VALIDATION_FAILED", "ID e status obrigatórios.");
  const { error } = await ctx.sb.from("loja_pedidos").update({ status, atualizado_em: new Date().toISOString() }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
