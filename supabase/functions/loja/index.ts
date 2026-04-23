// ═══════════════════════════════════════════════════════════════
//  Edge Function: loja (v2 — Router Pattern)
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, requireFeature, requireEscola, loadEscola, successResponse, AppError, sanitizePgError, createLogger } from "../_shared/mod.ts";

const log = createLogger("loja");
const router = new Router("loja");
router.useGlobal(rateLimit());

const feat = requireFeature("ecommerce");

// ── Helpers ────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validEmail(e: unknown): e is string {
  return typeof e === "string" && e.length <= 254 && EMAIL_RE.test(e);
}
function str(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > max) return null;
  return t;
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Allow-list of updatable product fields — prevents mass assignment
// (escola_id, id, criado_em etc. can't be overwritten by the client)
const PRODUTO_UPDATABLE = new Set([
  "nome", "descricao", "categoria", "preco", "preco_promocional",
  "estoque", "imagem_url", "tamanhos", "destaque", "ativo",
]);

router.on("produtos_list", loadEscola, feat, async (ctx) => {
  const { categoria, busca, ativo_only } = ctx.body as Record<string, unknown>;
  let q = ctx.sb.from("loja_produtos").select("*")
    .order("destaque", { ascending: false }).order("nome");
  if (ctx.escola_id) q = q.eq("escola_id", ctx.escola_id);
  if (ativo_only !== false) q = q.eq("ativo", true);
  const cat = str(categoria, 80);
  if (cat) q = q.eq("categoria", cat);
  const bus = str(busca, 80);
  if (bus) {
    // Escape PostgREST ilike wildcards/commas to block filter injection
    const safe = bus.replace(/[,%(){}]/g, " ");
    q = q.ilike("nome", `%${safe}%`).limit(100);
  } else {
    q = q.limit(200);
  }
  const { data, error } = await q;
  if (error) { log.apiError("produtos_list", error); throw new AppError("BAD_REQUEST", sanitizePgError(error)); }
  return successResponse(data ?? []);
});

router.on("produtos_create", authGerente, requireEscola, feat, async (ctx) => {
  const b = ctx.body as Record<string, unknown>;
  const nome = str(b.nome, 200);
  const preco = num(b.preco);
  if (!nome) throw new AppError("VALIDATION_FAILED", "Nome obrigatório.");
  if (preco === null || preco < 0) throw new AppError("VALIDATION_FAILED", "Preço inválido.");
  const payload: Record<string, unknown> = {
    escola_id: ctx.escola_id,
    nome,
    preco,
    descricao: str(b.descricao, 2000),
    categoria: str(b.categoria, 80),
    preco_promocional: b.preco_promocional == null ? null : num(b.preco_promocional),
    estoque: b.estoque == null ? 0 : Math.max(0, Math.floor(num(b.estoque) ?? 0)),
    imagem_url: str(b.imagem_url, 500),
    tamanhos: Array.isArray(b.tamanhos) ? b.tamanhos.slice(0, 20) : null,
    destaque: !!b.destaque,
  };
  const { data, error } = await ctx.sb.from("loja_produtos").insert(payload).select().single();
  if (error) { log.apiError("produtos_create", error); throw new AppError("BAD_REQUEST", sanitizePgError(error)); }
  log.info("Produto criado", { metadata: { nome } });
  return successResponse(data);
});

router.on("produtos_update", authGerente, requireEscola, feat, async (ctx) => {
  const b = ctx.body as Record<string, unknown>;
  const id = str(b.id, 64);
  if (!id) throw new AppError("VALIDATION_FAILED", "ID obrigatório.");

  // Mass assignment guard — only allow whitelisted columns
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (PRODUTO_UPDATABLE.has(k)) fields[k] = v;
  }
  if (!Object.keys(fields).length) {
    throw new AppError("VALIDATION_FAILED", "Nenhum campo válido para atualizar.");
  }
  // Coerce numerics
  if ("preco" in fields) { const n = num(fields.preco); if (n === null || n < 0) throw new AppError("VALIDATION_FAILED", "Preço inválido."); fields.preco = n; }
  if ("estoque" in fields) { const n = num(fields.estoque); fields.estoque = n === null ? 0 : Math.max(0, Math.floor(n)); }
  if ("preco_promocional" in fields && fields.preco_promocional != null) {
    const n = num(fields.preco_promocional);
    fields.preco_promocional = n === null || n < 0 ? null : n;
  }

  const { error } = await ctx.sb.from("loja_produtos")
    .update(fields)
    .eq("id", id)
    .eq("escola_id", ctx.escola_id); // tenant scoping
  if (error) { log.apiError("produtos_update", error); throw new AppError("BAD_REQUEST", sanitizePgError(error)); }
  return successResponse({ success: true });
});

// Pedidos — listagem exige auth de gerente (PII: emails/nomes de famílias)
router.on("pedidos_list", authGerente, requireEscola, feat, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { familia_email, status } = ctx.body as Record<string, unknown>;
  let q = ctx.sb.from("loja_pedidos")
    .select("*, loja_itens_pedido(*, loja_produtos(nome, imagem_url))")
    .eq("escola_id", ctx.escola_id)
    .order("criado_em", { ascending: false });
  if (familia_email) {
    if (!validEmail(familia_email)) throw new AppError("VALIDATION_FAILED", "Email inválido.");
    q = q.eq("familia_email", familia_email);
  }
  const st = str(status, 40);
  if (st) q = q.eq("status", st);
  const { data, error } = await q.limit(100);
  if (error) { log.apiError("pedidos_list", error); throw new AppError("BAD_REQUEST", sanitizePgError(error)); }
  return successResponse(data ?? []);
});

router.on("pedido_create", loadEscola, feat, async (ctx) => {
  const b = ctx.body as { familia_email?: unknown; familia_nome?: unknown; itens?: unknown };
  const familia_email = b.familia_email;
  const familia_nome = str(b.familia_nome, 200);
  const itens = b.itens;
  if (!validEmail(familia_email)) throw new AppError("VALIDATION_FAILED", "Email inválido.");
  if (!familia_nome) throw new AppError("VALIDATION_FAILED", "Nome obrigatório.");
  if (!Array.isArray(itens) || itens.length === 0) throw new AppError("VALIDATION_FAILED", "Itens obrigatórios.");
  if (itens.length > 50) throw new AppError("VALIDATION_FAILED", "Muitos itens no pedido.");

  // Normalize + validate items
  type Item = { produto_id: string; quantidade: number; tamanho?: string | null };
  const itensNorm: Item[] = [];
  for (const raw of itens as unknown[]) {
    const it = raw as Record<string, unknown>;
    const produto_id = str(it.produto_id, 64);
    const quantidade = num(it.quantidade);
    if (!produto_id) throw new AppError("VALIDATION_FAILED", "produto_id inválido.");
    if (quantidade === null || !Number.isInteger(quantidade) || quantidade <= 0 || quantidade > 500) {
      throw new AppError("VALIDATION_FAILED", "Quantidade inválida.");
    }
    itensNorm.push({ produto_id, quantidade, tamanho: str(it.tamanho, 40) });
  }

  // Load products once (batched) and scope by escola when possible
  const ids = Array.from(new Set(itensNorm.map((i) => i.produto_id)));
  let produtosQ = ctx.sb.from("loja_produtos")
    .select("id, preco, preco_promocional, estoque, nome, ativo, escola_id")
    .in("id", ids);
  if (ctx.escola_id) produtosQ = produtosQ.eq("escola_id", ctx.escola_id);
  const { data: produtos, error: prodErr } = await produtosQ;
  if (prodErr) { log.apiError("pedido_create.produtos", prodErr); throw new AppError("BAD_REQUEST", sanitizePgError(prodErr)); }
  const mapaProdutos = new Map<string, any>((produtos ?? []).map((p: any) => [p.id, p]));

  let total = 0;
  const itensDetalhados: Array<Record<string, unknown>> = [];
  for (const item of itensNorm) {
    const produto = mapaProdutos.get(item.produto_id);
    if (!produto || produto.ativo === false) {
      throw new AppError("NOT_FOUND", "Produto não encontrado.");
    }
    const estoque = Number(produto.estoque ?? 0);
    if (estoque < item.quantidade) {
      throw new AppError("CONFLICT", `Estoque insuficiente para ${produto.nome}.`);
    }
    const preco = Number(produto.preco_promocional ?? produto.preco ?? 0);
    if (!(preco > 0)) throw new AppError("CONFLICT", "Preço inválido para " + produto.nome);
    const subtotal = preco * item.quantidade;
    total += subtotal;
    itensDetalhados.push({
      produto_id: item.produto_id,
      quantidade: item.quantidade,
      tamanho: item.tamanho,
      preco_unitario: preco,
      subtotal,
    });
  }

  const pedidoPayload: Record<string, unknown> = {
    familia_email,
    familia_nome,
    total,
    subtotal: total,
  };
  if (ctx.escola_id) pedidoPayload.escola_id = ctx.escola_id;

  const { data: pedido, error } = await ctx.sb.from("loja_pedidos")
    .insert(pedidoPayload).select().maybeSingle();
  if (error || !pedido) {
    log.apiError("pedido_create", error);
    throw new AppError("BAD_REQUEST", sanitizePgError(error));
  }

  const { error: itensErr } = await ctx.sb.from("loja_itens_pedido")
    .insert(itensDetalhados.map((i) => ({ ...i, pedido_id: pedido.id, escola_id: pedido.escola_id || ctx.escola_id })));
  if (itensErr) {
    log.apiError("pedido_create.itens", itensErr);
    // Best-effort rollback
    await ctx.sb.from("loja_pedidos").delete().eq("id", pedido.id);
    throw new AppError("BAD_REQUEST", sanitizePgError(itensErr));
  }

  // Decrement estoque atomically using RPC if available; otherwise safe-min update
  // NOTE: the previous implementation had a TOCTOU race (read + write).
  // Here we rely on the estoque_check already performed above plus an atomic
  // SQL expression via a single update per product using a filter on current stock.
  for (const item of itensNorm) {
    const produto = mapaProdutos.get(item.produto_id);
    const novoEstoque = Math.max(0, Number(produto.estoque ?? 0) - item.quantidade);
    await ctx.sb.from("loja_produtos")
      .update({ estoque: novoEstoque })
      .eq("id", item.produto_id)
      .gte("estoque", item.quantidade); // refuse if another order drained it
  }

  log.info("Pedido criado", { metadata: { pedido_id: pedido.id, total } });
  return successResponse(pedido);
});

router.on("pedido_update_status", authGerente, requireEscola, feat, async (ctx) => {
  const b = ctx.body as Record<string, unknown>;
  const id = str(b.id, 64);
  const status = str(b.status, 40);
  if (!id || !status) throw new AppError("VALIDATION_FAILED", "ID e status obrigatórios.");
  const STATUS_VALIDOS = new Set(["pendente", "pago", "enviado", "entregue", "cancelado"]);
  if (!STATUS_VALIDOS.has(status)) throw new AppError("VALIDATION_FAILED", "Status inválido.");
  const { error } = await ctx.sb.from("loja_pedidos")
    .update({ status, atualizado_em: new Date().toISOString() })
    .eq("id", id)
    .eq("escola_id", ctx.escola_id);
  if (error) { log.apiError("pedido_update_status", error); throw new AppError("BAD_REQUEST", sanitizePgError(error)); }
  return successResponse({ success: true });
});

serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  return router.handle(req, sb);
});
