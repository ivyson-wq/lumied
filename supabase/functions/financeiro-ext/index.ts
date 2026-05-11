// ═══════════════════════════════════════════════════════════════
//  Edge Function: financeiro-ext (v3 — Router Pattern)
//  PIX Integrado + Integração Contábil + Conciliação + Boletos
//  + Inadimplência + Relatório Mensal + Folha de Pagamento
// ═══════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Router, rateLimit, authGerente, requireFeature } from "../_shared/router.ts";
import { successResponse, AppError } from "../_shared/errors.ts";
import { createLogger } from "../_shared/logger.ts";
import { getEscolaPadrao } from "../_shared/modulos.ts";
import type { Middleware } from "../_shared/router.ts";

const log = createLogger("financeiro-ext");
const router = new Router("financeiro-ext");
router.useGlobal(rateLimit());

// ═══════════════════════════════════════════════════════════════
//  Auth: Cron or Gerente middleware
// ═══════════════════════════════════════════════════════════════
const authCronOrGerente: Middleware = async (ctx, next) => {
  const cronKey = (ctx.body as Record<string, unknown>)._cron_key as string | undefined;
  if (cronKey && cronKey === Deno.env.get("CRON_INTERNAL_KEY")) {
    ctx.user = { id: "cron", nome: "Sistema", email: "cron@lumied.com.br", tipo: "cron" };
    return next();
  }
  return authGerente(ctx, next);
};

// ═══════════════════════════════════════════════════════════════
//  Inter API Helpers
// ═══════════════════════════════════════════════════════════════
async function interFetch(
  path: string,
  method = "GET",
  headers: Record<string, string> = {},
  body = "",
): Promise<any> {
  const relayUrl = Deno.env.get("INTER_RELAY_URL");
  const relaySecret = Deno.env.get("RELAY_SECRET");
  if (!relayUrl || !relaySecret) return null;
  const res = await fetch(`${relayUrl}/inter-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${relaySecret}` },
    body: JSON.stringify({ path, method, headers, body }),
    signal: AbortSignal.timeout(15000),
  });
  const { status, body: resBody } = await res.json();
  if (status < 200 || status >= 300) throw new Error(`Inter API error ${status}: ${resBody}`);
  return JSON.parse(resBody);
}

async function getInterToken(...scopeOptions: string[]): Promise<string> {
  const clientId = Deno.env.get("INTER_CLIENT_ID");
  const clientSecret = Deno.env.get("INTER_CLIENT_SECRET");
  const relayUrl = Deno.env.get("INTER_RELAY_URL");
  const relaySecret = Deno.env.get("RELAY_SECRET");
  if (!clientId || !clientSecret || !relayUrl || !relaySecret) throw new AppError("BAD_REQUEST", "Inter API não configurada.");
  const scopes = scopeOptions.length ? scopeOptions : ["extrato.read"];
  for (const scope of scopes) {
    try {
      const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope, grant_type: "client_credentials" });
      // Call relay directly (don't use interFetch which throws on non-2xx)
      const res = await fetch(`${relayUrl}/inter-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${relaySecret}` },
        body: JSON.stringify({ path: "/oauth/v2/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }),
        signal: AbortSignal.timeout(15000),
      });
      const { status, body } = await res.json() as { status: number; body: string };
      if (status >= 200 && status < 300) {
        const parsed = JSON.parse(body);
        if (parsed?.access_token) {
          log.info(`Inter OAuth scope aceito: ${scope}`);
          return parsed.access_token;
        }
      }
      log.warn(`Inter OAuth scope rejeitado: ${scope} (status ${status})`);
    } catch (e) { log.warn(`Inter OAuth scope erro: ${scope}: ${e}`); }
  }
  throw new Error(`Nenhum scope aceito pelo Inter. Tentados: ${scopes.join(", ")}`);
}

// ═══════════════════════════════════════════════════════════════
//  Resend Email Helper
// ═══════════════════════════════════════════════════════════════
type Attachment = { filename: string; content: string; content_type?: string };

async function sendEmail(to: string, subject: string, html: string, attachments?: Attachment[]) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    log.warn("RESEND_API_KEY not configured");
    return;
  }
  const body: Record<string, unknown> = {
    from: "Lumied Financeiro <onboarding@resend.dev>",
    to: [to],
    subject,
    html,
  };
  if (attachments?.length) body.attachments = attachments;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
}

// ═══════════════════════════════════════════════════════════════
//  HTML → Seções de texto (para PDFs server-side de contratos antigos)
// ═══════════════════════════════════════════════════════════════
function htmlToSections(html: string): Array<{ heading: string; lines: string[] }> {
  const decode = (s: string) => s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&(#\d+);/g, (_, n) => String.fromCharCode(parseInt(n.slice(1))));

  // Quebra blocos por tags de parágrafo/título antes de strip
  let normalized = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<(td|th)[^>]*>/gi, "  ");

  // Particiona por headings (h1-h3)
  const parts = normalized.split(/<h[1-3][^>]*>/i);
  const headings: string[] = [];
  const headRegex = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let match: RegExpExecArray | null;
  const htmlCopy = normalized;
  while ((match = headRegex.exec(htmlCopy)) !== null) {
    headings.push(decode(match[1].replace(/<[^>]+>/g, "").trim()));
  }

  const strip = (s: string) => decode(s.replace(/<[^>]+>/g, ""))
    .split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);

  // parts[0] = antes do primeiro heading; parts[1..] = depois de cada heading
  const sections: Array<{ heading: string; lines: string[] }> = [];
  if (parts[0] && strip(parts[0]).length) {
    sections.push({ heading: "Contrato", lines: strip(parts[0]) });
  }
  for (let i = 1; i < parts.length; i++) {
    // remover o fechamento do heading que ficou no início
    const body = parts[i].replace(/^[^<]*<\/h[1-3]>/i, "");
    sections.push({ heading: headings[i - 1] || "Cláusula", lines: strip(body) });
  }
  if (!sections.length) sections.push({ heading: "Contrato", lines: strip(html) });
  return sections;
}

// ═══════════════════════════════════════════════════════════════
//  PDF helper — gera PDF simples (header + linhas) via pdf-lib
// ═══════════════════════════════════════════════════════════════
async function generatePdfReport(
  title: string,
  subtitle: string,
  sections: Array<{ heading: string; lines: string[] }>,
): Promise<string> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("Lumied");
  doc.setCreator("Lumied SaaS Escolar");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const MARGIN = 50;
  const PAGE_W = 595;
  const PAGE_H = 842;
  const LINE_H = 13;
  const MAX_W = PAGE_W - MARGIN * 2;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; };
  const ensure = (needed: number) => { if (y - needed < MARGIN) newPage(); };

  const wrap = (text: string, f: typeof font, size: number): string[] => {
    const words = text.split(/\s+/);
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(test, size) > MAX_W) {
        if (cur) out.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };

  // Header
  page.drawText(title, { x: MARGIN, y, size: 16, font: bold, color: rgb(0.1, 0.2, 0.5) });
  y -= 22;
  if (subtitle) {
    for (const ln of wrap(subtitle, font, 10)) { page.drawText(ln, { x: MARGIN, y, size: 10, font, color: rgb(0.3,0.3,0.3) }); y -= LINE_H; }
  }
  page.drawLine({ start:{x:MARGIN,y:y-4}, end:{x:PAGE_W-MARGIN,y:y-4}, thickness:0.5, color: rgb(0.7,0.7,0.7) });
  y -= 16;

  for (const sec of sections) {
    ensure(LINE_H * 2);
    page.drawText(sec.heading, { x: MARGIN, y, size: 12, font: bold, color: rgb(0,0,0) });
    y -= LINE_H + 4;
    for (const raw of sec.lines) {
      for (const ln of wrap(raw, font, 10)) {
        ensure(LINE_H);
        page.drawText(ln, { x: MARGIN, y, size: 10, font });
        y -= LINE_H;
      }
    }
    y -= 8;
  }

  // Footer em cada página
  const pages = doc.getPages();
  const stamp = `Gerado automaticamente em ${new Date().toLocaleString("pt-BR")} — Lumied`;
  pages.forEach((p, i) => {
    p.drawText(`${stamp}  ·  Página ${i + 1}/${pages.length}`, {
      x: MARGIN, y: 30, size: 8, font, color: rgb(0.5, 0.5, 0.5),
    });
  });

  const bytes = await doc.save();
  // base64 encode (Deno-safe)
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// ═══════════════════════════════════════════════════════════════
//  Date Helpers
// ═══════════════════════════════════════════════════════════════
function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function previousMonth(): { year: number; month: number; label: string } {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  return { year, month, label: `${year}-${String(month).padStart(2, "0")}` };
}

function nextMonth(): { year: number; month: number; label: string } {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  return { year, month, label: `${year}-${String(month).padStart(2, "0")}` };
}

// ═══════════════════════════════════════════════════════════════
//  PIX
// ═══════════════════════════════════════════════════════════════
router.on("pix_config_get", authGerente, requireFeature("pix"), async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb.from("pix_config").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true).limit(1).maybeSingle();
  return successResponse(data || {});
});

router.on("pix_config_set", authGerente, requireFeature("pix"), async (ctx) => {
  const { chave_pix, tipo_chave, nome_beneficiario, cidade } = ctx.body as any;
  if (!chave_pix) throw new AppError("VALIDATION_FAILED", "Chave PIX obrigatória.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data: existing } = await ctx.sb.from("pix_config").select("id").eq("escola_id", ctx.escola_id).limit(1).maybeSingle();
  if (existing) await ctx.sb.from("pix_config").update({ chave_pix, tipo_chave, nome_beneficiario, cidade }).eq("id", existing.id);
  else await ctx.sb.from("pix_config").insert({ chave_pix, tipo_chave, nome_beneficiario, cidade, escola_id: ctx.escola_id });
  log.info("PIX config atualizado");
  return successResponse({ success: true });
});

router.on("pix_gerar_cobranca", authGerente, requireFeature("pix"), async (ctx) => {
  const { valor, descricao, familia_email, boleto_id, mensalidade_id } = ctx.body as any;
  if (!valor) throw new AppError("VALIDATION_FAILED", "Valor obrigatório.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data: config } = await ctx.sb.from("pix_config").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true).limit(1).maybeSingle();
  if (!config) throw new AppError("BAD_REQUEST", "PIX não configurado.");
  const txid = "MB" + Date.now().toString(36).toUpperCase() + Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(36)).join('').toUpperCase();
  const payload = gerarPayloadPix(config.chave_pix, config.nome_beneficiario || "LUMIED", config.cidade || "CAXIAS DO SUL", valor, txid);
  const { data, error } = await ctx.sb.from("pix_cobrancas").insert({ boleto_id, mensalidade_id, txid, qr_code_payload: payload, valor, descricao, familia_email, expira_em: new Date(Date.now() + 24 * 3600000).toISOString(), escola_id: ctx.escola_id }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("PIX cobrança gerada", { metadata: { txid, valor } });
  return successResponse(data);
});

router.on("pix_cobrancas_list", authGerente, requireFeature("pix"), async (ctx) => {
  const { status, familia_email } = ctx.body as any;
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  let q = ctx.sb.from("pix_cobrancas").select("*").eq("escola_id", ctx.escola_id).order("criado_em", { ascending: false });
  if (status) q = q.eq("status", status);
  if (familia_email) q = q.eq("familia_email", familia_email);
  const { data } = await q.limit(100);
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  CONTÁBIL
// ═══════════════════════════════════════════════════════════════
router.on("contabil_config_get", authGerente, requireFeature("contabil"), async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb.from("contabil_config").select("*").eq("escola_id", ctx.escola_id).eq("ativo", true);
  return successResponse(data ?? []);
});

router.on("contabil_config_set", authGerente, requireFeature("contabil"), async (ctx) => {
  const { sistema, formato_exportacao, config: cfg } = ctx.body as any;
  if (!sistema) throw new AppError("VALIDATION_FAILED", "Sistema obrigatório.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { error } = await ctx.sb.from("contabil_config").upsert({ sistema, formato_exportacao, config: cfg || {}, escola_id: ctx.escola_id } as any);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("contabil_exportar", authGerente, requireFeature("contabil"), async (ctx) => {
  const { sistema, periodo_inicio, periodo_fim, tipo } = ctx.body as any;
  if (!sistema || !periodo_inicio || !periodo_fim) throw new AppError("VALIDATION_FAILED", "sistema, periodo_inicio e periodo_fim obrigatórios.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data: lancamentos } = await ctx.sb.from("fin_lancamentos").select("*").eq("escola_id", ctx.escola_id).gte("data_lancamento", periodo_inicio).lte("data_lancamento", periodo_fim).order("data_lancamento");
  const { data: exp, error } = await ctx.sb.from("contabil_exportacoes").insert({ sistema, periodo_inicio, periodo_fim, tipo: tipo || "lancamentos", registros: lancamentos?.length || 0, gerado_por: ctx.user?.nome, escola_id: ctx.escola_id }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("Exportação contábil", { metadata: { sistema, registros: lancamentos?.length } });
  return successResponse({ ...exp, lancamentos: lancamentos ?? [] });
});

router.on("contabil_exportacoes_list", authGerente, requireFeature("contabil"), async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb.from("contabil_exportacoes").select("*").eq("escola_id", ctx.escola_id).order("gerado_em", { ascending: false }).limit(50);
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  CONCILIAÇÃO AUTOMÁTICA
// ═══════════════════════════════════════════════════════════════
router.on("conciliacao_automatica", authCronOrGerente, async (ctx) => {
  const escolaId = ctx.escola_id || (ctx.user as any)?.escola_id || await getEscolaPadrao(ctx.sb);
  const relayUrl = Deno.env.get("INTER_RELAY_URL");
  if (!relayUrl) {
    return successResponse({ error: "Inter API não configurada. Configure INTER_RELAY_URL para habilitar a conciliação automática.", matched: 0, created: 0, pendente_revisao: 0 });
  }

  let token: string;
  try {
    token = await getInterToken("extrato.read", "boleto-cobranca.read extrato.read");
  } catch (e) {
    return successResponse({ error: `Falha na autenticação Inter: ${e instanceof Error ? e.message : e}`, matched: 0, created: 0, pendente_revisao: 0 });
  }
  const dataRef = yesterday();
  const interConta = Deno.env.get("INTER_CONTA") || "";

  let extrato: any;
  try {
    extrato = await interFetch(
      `/banking/v2/extrato?dataInicio=${dataRef}&dataFim=${dataRef}`,
      "GET",
      { Authorization: `Bearer ${token}`, "x-conta-corrente": interConta },
    );
  } catch (e) {
    return successResponse({ error: `Falha ao buscar extrato Inter: ${e instanceof Error ? e.message : e}. Verifique se o escopo 'extrato.read' está habilitado no app Inter (Internet Banking → Desenvolvedores → Editar App).`, matched: 0, created: 0, pendente_revisao: 0 });
  }

  const transacoes: any[] = extrato?.transacoes ?? [];
  let matched = 0;
  let created = 0;

  for (const tx of transacoes) {
    const txValor = parseFloat(tx.valor);
    const txData = tx.dataEntrada || dataRef;

    // Try to match existing lancamento
    const { data: lancamento } = await ctx.sb
      .from("fin_lancamentos")
      .select("id")
      .eq("escola_id", escolaId)
      .eq("status", "pendente")
      .eq("data_lancamento", txData)
      .gte("valor", txValor - 0.01)
      .lte("valor", txValor + 0.01)
      .limit(1)
      .maybeSingle();

    if (lancamento) {
      await ctx.sb.from("fin_lancamentos").update({
        status: "pago",
        data_pagamento: txData,
      }).eq("id", lancamento.id).eq("escola_id", escolaId);
      matched++;
    } else {
      await ctx.sb.from("fin_lancamentos").insert({
        tipo: tx.tipoOperacao === "C" ? "receita" : "despesa",
        descricao: tx.titulo || tx.descricao || "Transação Inter",
        valor: txValor,
        data_lancamento: txData,
        status: "pendente_revisao",
        escola_id: escolaId,
      });
      created++;
    }

    // Always insert into extrato bancario
    await ctx.sb.from("fin_extrato_bancario").insert({
      data: txData,
      valor: txValor,
      descricao: tx.titulo || tx.descricao,
      origem: "inter_api",
      inter_tipo_operacao: tx.tipoOperacao,
      inter_tipo_transacao: tx.tipoTransacao,
      escola_id: escolaId,
    });
  }

  // Log execution
  await ctx.sb.from("fin_conciliacao_execucoes").insert({
    data_referencia: dataRef,
    transacoes_total: transacoes.length,
    conciliadas: matched,
    novas: created,
    executado_por: ctx.user?.nome || "cron",
    escola_id: escolaId,
  });

  log.info("Conciliação executada", { metadata: { dataRef, matched, created, total: transacoes.length } });
  return successResponse({ data_referencia: dataRef, transacoes: transacoes.length, conciliadas: matched, novas: created });
});

router.on("conciliacao_pendentes_list", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb
    .from("fin_lancamentos")
    .select("*")
    .eq("escola_id", ctx.escola_id)
    .eq("status", "pendente_revisao")
    .order("data_lancamento", { ascending: false });
  return successResponse(data ?? []);
});

router.on("conciliacao_pendente_resolver", authGerente, async (ctx) => {
  const { id, conta_id, status } = ctx.body as any;
  if (!id || !status) throw new AppError("VALIDATION_FAILED", "id e status obrigatórios.");
  if (!["pendente", "pago"].includes(status)) throw new AppError("VALIDATION_FAILED", "Status deve ser 'pendente' ou 'pago'.");

  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { error } = await ctx.sb.from("fin_lancamentos").update({ conta_id, status }).eq("id", id).eq("escola_id", ctx.escola_id).eq("status", "pendente_revisao");
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("conciliacao_historico", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb
    .from("fin_conciliacao_execucoes")
    .select("*")
    .eq("escola_id", ctx.escola_id)
    .order("executado_em", { ascending: false })
    .limit(20);
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  BOLETOS BATCH (Day 28)
// ═══════════════════════════════════════════════════════════════
// ── Helper: gera batch para um mês (usado por auto e manual) ──
async function gerarBatchParaMes(
  ctx: any,
  escolaId: string,
  mesRef: string,
  ano: number,
  mes: number,
  origem: "automatico" | "manual",
): Promise<any> {
  // Dia de vencimento configurável
  const { data: cfgDia } = await ctx.sb
    .from("escola_config")
    .select("valor")
    .eq("chave", "dia_vencimento_boleto")
    .eq("escola_id", escolaId)
    .maybeSingle();
  const diaVencimento = cfgDia?.valor || "10";
  const vencimento = `${ano}-${String(mes).padStart(2, "0")}-${diaVencimento.padStart(2, "0")}`;

  // Alunos ativos
  const { data: alunos } = await ctx.sb
    .from("alunos")
    .select("id, nome, serie, turno, familia_email, resp_nome, cpf")
    .eq("escola_id", escolaId)
    .eq("ativo", true);

  if (!alunos || alunos.length === 0) {
    return { batch_id: null, total_alunos: 0, pulados: 0, message: "Nenhum aluno ativo encontrado." };
  }

  // Alunos que JÁ têm boleto emitido/pendente neste mês (pular duplicatas)
  const { data: jaEmitidos } = await ctx.sb
    .from("fin_boletos_emitidos")
    .select("aluno_id, crianca_nome")
    .eq("escola_id", escolaId)
    .gte("vencimento", `${mesRef}-01`)
    .lte("vencimento", `${mesRef}-31`)
    .in("status", ["emitido", "pago"]);

  const jaEmitidosSet = new Set<string>();
  for (const b of jaEmitidos ?? []) {
    if (b.aluno_id) jaEmitidosSet.add(b.aluno_id);
    if (b.crianca_nome) jaEmitidosSet.add(b.crianca_nome);
  }
  // Também checar batch items pendentes
  const { data: jaBatchItems } = await ctx.sb
    .from("fin_boleto_batch_items")
    .select("aluno_id")
    .eq("escola_id", escolaId)
    .gte("vencimento", `${mesRef}-01`)
    .lte("vencimento", `${mesRef}-31`)
    .in("status", ["aguardando", "aprovado", "emitido"]);
  for (const bi of jaBatchItems ?? []) {
    if (bi.aluno_id) jaEmitidosSet.add(bi.aluno_id);
  }

  const alunosFiltrados = alunos.filter((a: any) => !jaEmitidosSet.has(a.id) && !jaEmitidosSet.has(a.nome));
  const pulados = alunos.length - alunosFiltrados.length;

  if (alunosFiltrados.length === 0) {
    return { batch_id: null, total_alunos: 0, pulados, message: `Todos os ${alunos.length} alunos já têm boleto para ${mesRef}.` };
  }

  // Famílias
  const emails = [...new Set(alunosFiltrados.map((a: any) => a.familia_email).filter(Boolean))];
  const { data: familias } = emails.length
    ? await ctx.sb.from("familias").select("email, nome_resp, cpf").eq("escola_id", escolaId).in("email", emails)
    : { data: [] };
  const familiaMap = new Map((familias ?? []).map((f: any) => [f.email, f]));

  // Criar batch
  const { data: batch, error: batchErr } = await ctx.sb
    .from("fin_boletos_batch")
    .insert({
      mes_referencia: mesRef,
      status: "aguardando_aprovacao",
      total_boletos: alunosFiltrados.length,
      escola_id: escolaId,
    })
    .select()
    .single();
  if (batchErr) throw new AppError("BAD_REQUEST", batchErr.message);

  let totalGeral = 0;
  const batchItems: any[] = [];
  const monthNames = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

  // ── Carregar tabela de preços por turno (escola_config → turnos_config) ──
  const { data: cfgTurnos } = await ctx.sb
    .from("escola_config")
    .select("valor")
    .eq("chave", "turnos_config")
    .eq("escola_id", escolaId)
    .maybeSingle();
  let turnosConfig: Array<{ id: string; nome: string; preco: number }> = [];
  try { turnosConfig = cfgTurnos?.valor ? (typeof cfgTurnos.valor === "string" ? JSON.parse(cfgTurnos.valor) : cfgTurnos.valor) : []; } catch { /* */ }
  const turnoPrecoMap = new Map(turnosConfig.map(t => [t.id, { nome: t.nome, preco: t.preco || 0 }]));

  // ── Preço do almoço ──
  const { data: cfgAlmoco } = await ctx.sb
    .from("escola_config")
    .select("valor")
    .eq("chave", "almoco_preco")
    .eq("escola_id", escolaId)
    .maybeSingle();
  const almocoPrecoDia = parseFloat(cfgAlmoco?.valor || "0");

  // ── Atividades com preço (apenas as cobradas pela escola) ──
  const { data: todasAtividades } = await ctx.sb
    .from("atividades")
    .select("id, nome, preco, cobranca_pela_escola")
    .eq("escola_id", escolaId)
    .eq("ativo", true);
  // Só inclui no boleto atividades onde a escola faz a cobrança (não a empresa fornecedora)
  const atividadeMap = new Map(
    (todasAtividades ?? [])
      .filter((a: any) => a.cobranca_pela_escola !== false)
      .map((a: any) => [a.id, { nome: a.nome, preco: a.preco || 0 }])
  );

  for (const aluno of alunosFiltrados) {
    const items: { nome: string; valor: number; categoria: string }[] = [];

    // ── 1. MENSALIDADE BASE (turno do aluno → turnos_config) ──
    const turnoInfo = turnoPrecoMap.get(aluno.turno);
    const turnoNome = turnoInfo?.nome || aluno.turno || "Turno";
    const turnoValor = turnoInfo?.preco ?? 0;
    items.push({ nome: `Mensalidade ${monthNames[mes]}/${ano} — ${turnoNome}`, valor: turnoValor, categoria: "mensalidade" });

    // ── 2. ALIMENTAÇÃO (almoco_dias do aluno × preço/dia) ──
    if (almocoPrecoDia > 0 && aluno.turno) {
      // Turnos integrais/semi incluem alimentação nos dias selecionados
      // almoco_dias pode estar no aluno ou inferido do turno (integral_Nx = N dias)
      let diasAlmoco = 0;
      // Tentar extrair dias do turno (e.g., integral_5x → 5, semi_3x → 3)
      const turnoMatch = (aluno.turno || "").match(/(\d+)x$/);
      if (turnoMatch) diasAlmoco = parseInt(turnoMatch[1]);
      // Média de semanas no mês ≈ 4.33
      if (diasAlmoco > 0) {
        const diasMes = Math.round(diasAlmoco * 4.33);
        const valorAlimentacao = Math.round(almocoPrecoDia * diasMes * 100) / 100;
        items.push({ nome: `Alimentação (${diasAlmoco}×/sem, ${diasMes} dias)`, valor: valorAlimentacao, categoria: "alimentacao" });
      }
    }

    // ── 3. ATIVIDADES EXTRAS (inscrições do aluno/família) ──
    const famEmail = aluno.familia_email;
    if (famEmail) {
      const { data: inscricoes } = await ctx.sb
        .from("inscricoes_atividades")
        .select("atividades_ids")
        .eq("email", famEmail)
        .maybeSingle();
      if (inscricoes?.atividades_ids?.length) {
        for (const atId of inscricoes.atividades_ids) {
          const at = atividadeMap.get(atId);
          if (at && at.preco > 0) {
            items.push({ nome: at.nome, valor: at.preco, categoria: "atividade_extra" });
          }
        }
      }
    }

    const descDetalhada = items.map(i => `${i.nome}: R$${i.valor.toFixed(2)}`).join(" | ");
    const valorTotal = Math.round(items.reduce((s, i) => s + i.valor, 0) * 100) / 100;
    totalGeral += valorTotal;

    const familia = familiaMap.get(famEmail);
    batchItems.push({
      batch_id: batch.id,
      aluno_id: aluno.id,
      crianca_nome: aluno.nome,
      familia_email: famEmail,
      familia_nome: familia?.nome_resp || aluno.resp_nome || "",
      cpf_pagador: familia?.cpf || aluno.cpf || "",
      valor_total: valorTotal,
      descricao_detalhada: descDetalhada,
      itens: items,
      vencimento,
      status: "aguardando",
      escola_id: escolaId,
    });
  }

  if (batchItems.length > 0) {
    await ctx.sb.from("fin_boleto_batch_items").insert(batchItems);
  }
  await ctx.sb.from("fin_boletos_batch").update({ valor_total: totalGeral }).eq("id", batch.id);

  log.info(`Batch ${origem} gerado`, { metadata: { mesRef, alunos: alunosFiltrados.length, pulados, valorTotal: totalGeral } });
  return { batch_id: batch.id, mes_referencia: mesRef, total_alunos: alunosFiltrados.length, pulados, valor_total: totalGeral, origem };
}

// ── Batch automático (dia 28, próximo mês) — pula quem já tem boleto ──
router.on("boletos_gerar_batch", authCronOrGerente, async (ctx) => {
  const escolaId = ctx.escola_id || (ctx.user as any)?.escola_id || await getEscolaPadrao(ctx.sb);
  const nm = nextMonth();
  const result = await gerarBatchParaMes(ctx, escolaId!, nm.label, nm.year, nm.month, "automatico");
  return successResponse(result);
});

// ── Batch manual (sob demanda, qualquer mês) — pula quem já tem boleto ──
router.on("boletos_gerar_batch_manual", authGerente, async (ctx) => {
  const { mes_referencia } = ctx.body as any;
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  // Default: próximo mês
  const nm = nextMonth();
  const mesRef = mes_referencia || nm.label;
  const [anoStr, mesStr] = mesRef.split("-");
  const ano = parseInt(anoStr);
  const mes = parseInt(mesStr);
  if (!ano || !mes || mes < 1 || mes > 12) throw new AppError("VALIDATION_FAILED", "mes_referencia inválido (formato: YYYY-MM).");
  const result = await gerarBatchParaMes(ctx, ctx.escola_id, mesRef, ano, mes, "manual");
  return successResponse(result);
});

router.on("boletos_batch_list", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data } = await ctx.sb
    .from("fin_boletos_batch")
    .select("*, fin_boleto_batch_items(*)")
    .eq("escola_id", ctx.escola_id)
    .order("gerado_em", { ascending: false });
  return successResponse(data ?? []);
});

router.on("boletos_batch_item_edit", authGerente, async (ctx) => {
  const { id, valor_total, descricao_detalhada, itens } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");

  const updates: Record<string, any> = {};
  if (valor_total !== undefined) updates.valor_total = valor_total;
  if (descricao_detalhada !== undefined) updates.descricao_detalhada = descricao_detalhada;
  if (itens !== undefined) updates.itens = itens;

  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { error } = await ctx.sb.from("fin_boleto_batch_items").update(updates).eq("id", id).eq("escola_id", ctx.escola_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("boletos_batch_aprovar", authGerente, async (ctx) => {
  const { batch_id } = ctx.body as any;
  if (!batch_id) throw new AppError("VALIDATION_FAILED", "batch_id obrigatório.");

  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");

  // Update batch status
  await ctx.sb.from("fin_boletos_batch").update({
    status: "aprovado",
    aprovado_por: ctx.user?.nome,
    aprovado_em: new Date().toISOString(),
  }).eq("id", batch_id).eq("escola_id", ctx.escola_id);

  // Get all items
  const { data: items } = await ctx.sb
    .from("fin_boleto_batch_items")
    .select("*")
    .eq("batch_id", batch_id)
    .eq("escola_id", ctx.escola_id);

  if (!items || items.length === 0) {
    return successResponse({ batch_id, emitidos: 0, erros: 0 });
  }

  // Update all items to aprovado
  await ctx.sb.from("fin_boleto_batch_items").update({ status: "aprovado" }).eq("batch_id", batch_id).eq("escola_id", ctx.escola_id);

  let emitidos = 0;
  let erros = 0;

  // Check if Inter API is configured
  const relayUrl = Deno.env.get("INTER_RELAY_URL");
  if (relayUrl) {
    let token: string | null = null;
    try {
      token = await getInterToken("boleto-cobranca.write", "boleto-cobranca.read boleto-cobranca.write", "cobv.write", "cobranca.write");
    } catch {
      log.warn("Não foi possível obter token Inter para boletos");
    }

    if (token) {
      for (const item of items) {
        try {
          // Inter API suporta até 5 linhas de mensagem (78 chars cada)
          const itensArr: Array<{ nome: string; valor: number }> = Array.isArray(item.itens) ? item.itens : [];
          const msgLines: Record<string, string> = {};
          const fmtVal = (v: number) => `R$${v.toFixed(2)}`;
          for (let li = 0; li < Math.min(itensArr.length, 4); li++) {
            const it = itensArr[li];
            msgLines[`linha${li + 1}`] = `${it.nome}: ${fmtVal(it.valor)}`.substring(0, 78);
          }
          msgLines[`linha${Math.min(itensArr.length, 4) + 1}`] = `TOTAL: ${fmtVal(item.valor_total)} — ${item.crianca_nome}`.substring(0, 78);

          const boletoPayload = {
            seuNumero: `LUM-${item.id.substring(0, 8)}`,
            valorNominal: item.valor_total,
            dataVencimento: item.vencimento,
            numDiasAgenda: 30,
            pagador: {
              cpfCnpj: (item.cpf_pagador || "").replace(/\D/g, ""),
              tipoPessoa: "FISICA",
              nome: item.familia_nome,
            },
            mensagem: msgLines,
          };

          const result = await interFetch(
            "/cobranca/v3/cobrancas",
            "POST",
            { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            JSON.stringify(boletoPayload),
          );

          await ctx.sb.from("fin_boleto_batch_items").update({
            nosso_numero: result?.cobranca?.nossoNumero || result?.nossoNumero,
            codigo_barras: result?.boleto?.codigoBarras || result?.codigoBarras,
            linha_digitavel: result?.boleto?.linhaDigitavel || result?.linhaDigitavel,
            pix_copia_cola: result?.pix?.pixCopiaECola || result?.pixCopiaECola,
            inter_response: result,
            status: "emitido",
          }).eq("id", item.id);

          // Insert into fin_boletos_emitidos
          await ctx.sb.from("fin_boletos_emitidos").insert({
            batch_item_id: item.id,
            aluno_id: item.aluno_id || null,
            crianca_nome: item.crianca_nome,
            familia_email: item.familia_email,
            familia_nome: item.familia_nome,
            cpf_pagador: item.cpf_pagador,
            nosso_numero: result?.cobranca?.nossoNumero || result?.nossoNumero,
            codigo_barras: result?.boleto?.codigoBarras || result?.codigoBarras,
            linha_digitavel: result?.boleto?.linhaDigitavel || result?.linhaDigitavel,
            pix_copia_cola: result?.pix?.pixCopiaECola || result?.pixCopiaECola,
            valor: item.valor_total,
            vencimento: item.vencimento,
            descricao: item.descricao_detalhada,
            inter_response: result,
            status: "emitido",
            escola_id: item.escola_id,
          }).catch((e: any) => log.warn("Insert fin_boletos_emitidos failed", { error: e.message }));

          // Upsert fin_mensalidades
          await ctx.sb.from("fin_mensalidades").upsert({
            crianca_nome: item.crianca_nome,
            familia_email: item.familia_email,
            familia_nome: item.familia_nome,
            mes: item.vencimento?.substring(0, 7),
            valor_total: item.valor_total,
            data_vencimento: item.vencimento,
            status: "pendente",
            boleto_batch_item_id: item.id,
          }, { onConflict: "familia_email,crianca_nome,mes" }).catch(() => {});

          emitidos++;
        } catch (err) {
          await ctx.sb.from("fin_boleto_batch_items").update({
            erro: err instanceof Error ? err.message : String(err),
            status: "erro",
          }).eq("id", item.id);
          erros++;
        }
      }
    }
  }

  // Update batch final status
  const finalStatus = erros === 0 ? "emitido" : (emitidos === 0 ? "erro" : "parcial");
  await ctx.sb.from("fin_boletos_batch").update({ status: finalStatus }).eq("id", batch_id).eq("escola_id", ctx.escola_id);

  log.info("Batch aprovado e emitido", { metadata: { batch_id, emitidos, erros } });
  return successResponse({ batch_id, emitidos, erros, status: finalStatus });
});

router.on("boletos_batch_rejeitar", authGerente, async (ctx) => {
  const { batch_id } = ctx.body as any;
  if (!batch_id) throw new AppError("VALIDATION_FAILED", "batch_id obrigatório.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  await ctx.sb.from("fin_boletos_batch").update({ status: "rejeitado" }).eq("id", batch_id).eq("escola_id", ctx.escola_id);
  return successResponse({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  INADIMPLÊNCIA
// ═══════════════════════════════════════════════════════════════
router.on("inadimplencia_verificar", authCronOrGerente, async (ctx) => {
  const escolaIdInad = ctx.escola_id || (ctx.user as any)?.escola_id || await getEscolaPadrao(ctx.sb);
  const { data: overdue } = await ctx.sb
    .from("fin_mensalidades")
    .select("*")
    .eq("escola_id", escolaIdInad)
    .in("status", ["pendente", "atrasado"])
    .lt("data_vencimento", new Date().toISOString().slice(0, 10));

  if (!overdue || overdue.length === 0) {
    return successResponse({ buckets: { "7d": 0, "15d": 0, "28d": 0 }, total: 0 });
  }

  const today = new Date();
  const buckets: Record<string, number> = { "7d": 0, "15d": 0, "28d": 0 };

  for (const m of overdue) {
    const venc = new Date(m.data_vencimento);
    const diasAtraso = Math.floor((today.getTime() - venc.getTime()) / (1000 * 60 * 60 * 24));

    let bucket: string | null = null;
    if (diasAtraso >= 28) bucket = "28d";
    else if (diasAtraso >= 15) bucket = "15d";
    else if (diasAtraso >= 7) bucket = "7d";
    else continue;

    buckets[bucket]++;

    // Update mensalidade status to atrasado
    if (m.status !== "atrasado") {
      await ctx.sb.from("fin_mensalidades").update({ status: "atrasado" }).eq("id", m.id);
    }

    // Upsert inadimplencia
    await ctx.sb.from("fin_inadimplencia").upsert({
      familia_email: m.familia_email,
      crianca_nome: m.crianca_nome,
      dias_atraso: diasAtraso,
      valor_total_devedor: m.valor_total || m.valor_turno || 0,
      bucket,
      mensalidades_ids: [m.id],
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "familia_email,crianca_nome" }).catch(() => {
      // If no unique constraint, just insert
      return ctx.sb.from("fin_inadimplencia").insert({
        familia_email: m.familia_email, crianca_nome: m.crianca_nome,
        dias_atraso: diasAtraso, valor_total_devedor: m.valor_total || 0,
        bucket, mensalidades_ids: [m.id],
        escola_id: m.escola_id,
      });
    });

    // 28d bucket: send to lawyer
    if (bucket === "28d") {
      const { data: inadEntry } = await ctx.sb
        .from("fin_inadimplencia")
        .select("status")
        .eq("familia_email", m.familia_email)
        .eq("crianca_nome", m.crianca_nome)
        .maybeSingle();

      if (inadEntry?.status !== "cobranca_extrajudicial") {
        const escolaIdAdv = m.escola_id || (ctx.user as any)?.escola_id || await getEscolaPadrao(ctx.sb);
        const { data: cfgAdv } = await ctx.sb
          .from("escola_config")
          .select("valor")
          .eq("chave", "email_advogado")
          .eq("escola_id", escolaIdAdv)
          .maybeSingle();

        if (cfgAdv?.valor) {
          // Get family data
          const { data: familia } = await ctx.sb
            .from("familias")
            .select("nome_resp, email, telefone")
            .eq("email", m.familia_email)
            .maybeSingle();

          // Get outstanding debts
          const { data: debts } = await ctx.sb
            .from("fin_mensalidades")
            .select("mes, valor_total, data_vencimento")
            .eq("familia_email", m.familia_email)
            .in("status", ["pendente", "atrasado"])
            .order("data_vencimento");

          // Get contract link
          const { data: contrato } = await ctx.sb
            .from("contratos")
            .select("id")
            .eq("familia_email", m.familia_email)
            .eq("status", "assinado")
            .order("criado_em", { ascending: false })
            .limit(1)
            .maybeSingle();

          const debtList = (debts ?? [])
            .map((d: any) => `<li>${d.mes} — R$${(d.valor_total||0).toFixed(2)} (venc: ${d.data_vencimento})</li>`)
            .join("");
          const appUrl = Deno.env.get("APP_URL") || "https://lumied.com.br";
          const contratoLink = contrato ? `${appUrl}/verificar.html?id=${contrato.id}` : "N/A";

          // Histórico de envios (régua) e tratativas manuais
          const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"} as any)[c]);
          const fmtDt = (d: string | null) => d ? new Date(d).toLocaleString("pt-BR") : "";

          const { data: envios } = await ctx.sb
            .from("regua_execucoes")
            .select("enviado_em, canal, assunto, status, erro_msg, destinatario")
            .eq("familia_email", m.familia_email)
            .order("enviado_em", { ascending: true })
            .limit(200);

          const { data: tratativas } = await ctx.sb
            .from("cobranca_tratativas")
            .select("created_at, tipo, observacao, usuario_nome, usuario_papel, data_prevista_pagamento, valor_negociado, resultado")
            .eq("familia_email", m.familia_email)
            .is("deleted_at", null)
            .order("created_at", { ascending: true })
            .limit(200);

          const enviosHtml = (envios ?? []).length
            ? `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:12px;width:100%;">
                <thead style="background:#f3f4f6;"><tr><th>Data</th><th>Canal</th><th>Destinatário</th><th>Assunto</th><th>Status</th></tr></thead>
                <tbody>${(envios as any[]).map(e => `<tr>
                  <td>${fmtDt(e.enviado_em)}</td>
                  <td>${esc(e.canal)}</td>
                  <td>${esc(e.destinatario || "")}</td>
                  <td>${esc(e.assunto || "—")}</td>
                  <td>${esc(e.status)}${e.erro_msg ? ` <span style="color:#b91c1c;">(${esc(e.erro_msg)})</span>` : ""}</td>
                </tr>`).join("")}</tbody></table>`
            : "<p><em>Nenhum envio registrado.</em></p>";

          const tratativasHtml = (tratativas ?? []).length
            ? (tratativas as any[]).map(t => `
                <div style="border-left:3px solid #2563eb;padding:8px 12px;margin:8px 0;background:#f9fafb;font-size:13px;">
                  <div><strong>${esc(t.tipo)}</strong> — ${fmtDt(t.created_at)} — ${esc(t.usuario_nome)}${t.usuario_papel ? ` (${esc(t.usuario_papel)})` : ""}</div>
                  <div style="white-space:pre-wrap;margin-top:4px;">${esc(t.observacao)}</div>
                  ${t.data_prevista_pagamento ? `<div style="color:#555;font-size:12px;margin-top:4px;">📅 Prevista: ${esc(t.data_prevista_pagamento)}</div>` : ""}
                  ${t.valor_negociado ? `<div style="color:#555;font-size:12px;">💰 Negociado: R$ ${Number(t.valor_negociado).toFixed(2)}</div>` : ""}
                  ${t.resultado ? `<div style="color:#555;font-size:12px;">Resultado: ${esc(t.resultado)}</div>` : ""}
                </div>`).join("")
            : "<p><em>Nenhuma tratativa registrada.</em></p>";

          const html = `
            <h2>Cobrança Extrajudicial — ${m.crianca_nome}</h2>
            <p><strong>Responsável:</strong> ${familia?.nome_resp || m.familia_email}</p>
            <p><strong>Email:</strong> ${m.familia_email}</p>
            <p><strong>Telefone:</strong> ${familia?.telefone || "N/I"}</p>
            <h3>Débitos em aberto:</h3>
            <ul>${debtList}</ul>
            <p><strong>Contrato:</strong> <a href="${contratoLink}">${contratoLink}</a></p>

            <h3>Histórico de comunicações enviadas</h3>
            ${enviosHtml}

            <h3>Tratativas registradas pela equipe</h3>
            ${tratativasHtml}

            <p style="color:#666;font-size:12px;margin-top:20px;">Este email foi gerado automaticamente pelo sistema Lumied. Histórico completo disponível no painel do gerente.</p>
          `;

          const assuntoAdv = `Cobrança Extrajudicial — ${m.crianca_nome}`;
          let envioStatus = "enviado";
          let envioErro: string | null = null;

          // ── Anexos: contrato + relatório de débitos + relatório de tratativas ──
          const attachments: Attachment[] = [];
          try {
            // 1. Contrato — prefere PDF do storage; regenera do HTML se faltar
            if (contrato?.id) {
              const { data: contratoFull } = await ctx.sb
                .from("contratos")
                .select("id, html_renderizado, pdf_path, codigo_verificacao, documento_hash, assinado_em, familia_nome")
                .eq("id", contrato.id)
                .maybeSingle();
              const fname = `contrato-${m.crianca_nome.replace(/\W+/g,"_")}.pdf`;

              const downloadAndAttach = async (path: string): Promise<boolean> => {
                const { data: pdfBlob } = await ctx.sb.storage.from("contratos-pdf").download(path);
                if (!pdfBlob) return false;
                const buf = new Uint8Array(await pdfBlob.arrayBuffer());
                let bin = "";
                const chunk = 0x8000;
                for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
                attachments.push({ filename: fname, content: btoa(bin), content_type: "application/pdf" });
                return true;
              };

              let attached = false;
              if (contratoFull?.pdf_path) attached = await downloadAndAttach(contratoFull.pdf_path);

              // Fallback automático: gera PDF server-side a partir do html_renderizado, salva e reusa
              if (!attached && contratoFull?.html_renderizado) {
                try {
                  const sections = htmlToSections(contratoFull.html_renderizado);
                  const subtitle = [
                    `Responsável: ${contratoFull.familia_nome || m.familia_email}`,
                    contratoFull.assinado_em ? `Assinado em: ${new Date(contratoFull.assinado_em).toLocaleString("pt-BR")}` : "",
                    contratoFull.codigo_verificacao ? `Código de verificação: ${contratoFull.codigo_verificacao}` : "",
                    contratoFull.documento_hash ? `Hash SHA-256: ${contratoFull.documento_hash}` : "",
                    "Validade: Lei 14.063/2020 · MP 2.200-2/2001",
                  ].filter(Boolean).join("\n");
                  const pdfB64 = await generatePdfReport(`Contrato — ${m.crianca_nome}`, subtitle, sections);
                  // Upload para reusar em cobranças futuras
                  const bin2 = atob(pdfB64);
                  const bytes2 = new Uint8Array(bin2.length);
                  for (let i = 0; i < bin2.length; i++) bytes2[i] = bin2.charCodeAt(i);
                  const newPath = `${contratoFull.id}.pdf`;
                  const { error: upErr } = await ctx.sb.storage.from("contratos-pdf")
                    .upload(newPath, bytes2, { contentType: "application/pdf", upsert: true });
                  if (!upErr) {
                    await ctx.sb.from("contratos").update({
                      pdf_path: newPath,
                      pdf_gerado_em: new Date().toISOString(),
                    }).eq("id", contratoFull.id);
                  }
                  attachments.push({ filename: fname, content: pdfB64, content_type: "application/pdf" });
                  attached = true;
                } catch (e) {
                  log.warn("Falha gerando PDF server-side do contrato", { metadata: { err: (e as Error).message } });
                }
              }
            }

            // 2. Relatório de débitos (PDF)
            const totalDebito = (debts ?? []).reduce((s: number, d: any) => s + (d.valor_total || 0), 0);
            const debtLines = (debts ?? []).map((d: any) =>
              `• ${d.mes}   Venc: ${d.data_vencimento}   Valor: R$ ${Number(d.valor_total||0).toFixed(2)}`
            );
            const pdfDebitos = await generatePdfReport(
              "Relatório de Débitos em Aberto",
              `Aluno(a): ${m.crianca_nome}\nResponsável: ${familia?.nome_resp || m.familia_email}\nEmail: ${m.familia_email}\nTelefone: ${familia?.telefone || "N/I"}`,
              [
                { heading: "Débitos em aberto", lines: debtLines.length ? debtLines : ["(nenhum)"] },
                { heading: "Total devedor", lines: [`R$ ${totalDebito.toFixed(2)}   —   ${(debts ?? []).length} parcela(s)`] },
                { heading: "Situação", lines: [`Em atraso há ${diasAtraso} dia(s). Cobrança extrajudicial acionada em ${new Date().toLocaleString("pt-BR")}.`] },
              ],
            );
            attachments.push({
              filename: `relatorio-debitos-${m.crianca_nome.replace(/\W+/g,"_")}.pdf`,
              content: pdfDebitos,
              content_type: "application/pdf",
            });

            // 3. Declaração de tentativas (PDF) — envios da régua + tratativas
            const enviosLines = (envios ?? []).length
              ? (envios as any[]).map(e =>
                  `${new Date(e.enviado_em).toLocaleString("pt-BR")}  ·  ${e.canal}  →  ${e.destinatario || "—"}  ·  ${e.status}${e.erro_msg ? ` (erro: ${e.erro_msg})` : ""}\n   Assunto: ${e.assunto || "—"}`
                )
              : ["(nenhum envio automático registrado)"];
            const tratLines: string[] = [];
            if ((tratativas ?? []).length) {
              for (const t of tratativas as any[]) {
                tratLines.push(`[${t.tipo}] ${new Date(t.created_at).toLocaleString("pt-BR")} — ${t.usuario_nome}${t.usuario_papel ? ` (${t.usuario_papel})` : ""}`);
                tratLines.push(`   ${t.observacao}`);
                if (t.data_prevista_pagamento) tratLines.push(`   Prevista: ${t.data_prevista_pagamento}`);
                if (t.valor_negociado) tratLines.push(`   Valor negociado: R$ ${Number(t.valor_negociado).toFixed(2)}`);
                tratLines.push("");
              }
            } else {
              tratLines.push("(nenhuma tratativa manual registrada)");
            }
            const pdfTentativas = await generatePdfReport(
              "Declaração de Tentativas de Cobrança",
              `Aluno(a): ${m.crianca_nome}\nResponsável: ${familia?.nome_resp || m.familia_email}\nDocumento gerado para fins de cobrança extrajudicial.`,
              [
                { heading: "Comunicações enviadas (régua automática)", lines: enviosLines },
                { heading: "Tratativas registradas pela equipe", lines: tratLines },
              ],
            );
            attachments.push({
              filename: `tentativas-cobranca-${m.crianca_nome.replace(/\W+/g,"_")}.pdf`,
              content: pdfTentativas,
              content_type: "application/pdf",
            });
          } catch (e) {
            log.error("Erro gerando anexos", { metadata: { err: (e as Error).message } });
          }

          try {
            await sendEmail(cfgAdv.valor, assuntoAdv, html, attachments);
          } catch (e) {
            envioStatus = "erro";
            envioErro = (e as Error).message;
          }

          // Log unificado em regua_execucoes (aparece na timeline de cobrança)
          await ctx.sb.from("regua_execucoes").insert({
            escola_id: m.escola_id || null,
            mensalidade_id: m.id || null,
            aluno_id: m.aluno_id || null,
            familia_email: m.familia_email,
            destinatario: cfgAdv.valor,
            canal: "email_advogado",
            assunto: assuntoAdv,
            corpo: `Envio extrajudicial para ${cfgAdv.valor}. Responsável: ${familia?.nome_resp || m.familia_email}. Débitos: ${(debts ?? []).length}. Contrato: ${contratoLink}`,
            corpo_html: html,
            provider: "resend",
            status: envioStatus,
            erro_msg: envioErro,
            disparado_auto: true,
            metadata: {
              tipo: "extrajudicial",
              bucket: "28d",
              dias_atraso: diasAtraso,
              debitos_qtd: (debts ?? []).length,
              valor_total: m.valor_total || 0,
              anexos: attachments.map(a => a.filename),
            },
          });

          await ctx.sb.from("fin_inadimplencia").update({
            status: "cobranca_extrajudicial",
            email_advogado_em: new Date().toISOString(),
          }).eq("familia_email", m.familia_email).eq("crianca_nome", m.crianca_nome);
        }
      }
    }
  }

  log.info("Inadimplência verificada", { metadata: { buckets } });
  return successResponse({ buckets, total: overdue.length });
});

router.on("inadimplencia_dashboard", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { data: items } = await ctx.sb
    .from("fin_inadimplencia")
    .select("*")
    .eq("escola_id", ctx.escola_id)
    .neq("status", "resolvido")
    .order("dias_atraso", { ascending: false });

  const all = items ?? [];
  const bucketData = (b: string) => {
    const filtered = all.filter((i: any) => i.bucket === b);
    return { count: filtered.length, total: filtered.reduce((s: number, i: any) => s + (i.valor_total_devedor || 0), 0) };
  };
  const extrajudicial = all.filter((i: any) => i.status === "cobranca_extrajudicial");

  return successResponse({
    buckets: {
      "7d": bucketData("7d"),
      "15d": bucketData("15d"),
      "28d": bucketData("28d"),
    },
    extrajudicial: {
      count: extrajudicial.length,
      total: extrajudicial.reduce((s: number, i: any) => s + (i.valor_total_devedor || 0), 0),
    },
    items: all,
  });
});

router.on("inadimplencia_marcar_resolvido", authGerente, async (ctx) => {
  const { id } = ctx.body as any;
  if (!id) throw new AppError("VALIDATION_FAILED", "id obrigatório.");
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const { error } = await ctx.sb.from("fin_inadimplencia").update({
    status: "resolvido",
    resolvido_em: new Date().toISOString(),
    resolvido_por: ctx.user?.nome,
  }).eq("id", id).eq("escola_id", ctx.escola_id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  RELATÓRIO MENSAL
// ═══════════════════════════════════════════════════════════════
async function buildRelatorioData(sb: any, escolaId: string) {
  const prev = previousMonth();
  const prevPrev = { year: prev.month === 1 ? prev.year - 1 : prev.year, month: prev.month === 1 ? 12 : prev.month - 1 };
  const prevPrevLabel = `${prevPrev.year}-${String(prevPrev.month).padStart(2, "0")}`;

  const mesInicio = `${prev.label}-01`;
  const mesFim = `${prev.label}-31`;
  const prevMesInicio = `${prevPrevLabel}-01`;
  const prevMesFim = `${prevPrevLabel}-31`;

  // Current month data
  const { data: lancamentos } = await sb
    .from("fin_lancamentos")
    .select("tipo, plano_contas, valor, descricao")
    .eq("escola_id", escolaId)
    .gte("data_lancamento", mesInicio)
    .lte("data_lancamento", mesFim);

  // Previous month data (for MoM)
  const { data: lancamentosPrev } = await sb
    .from("fin_lancamentos")
    .select("tipo, plano_contas, valor")
    .eq("escola_id", escolaId)
    .gte("data_lancamento", prevMesInicio)
    .lte("data_lancamento", prevMesFim);

  const current = lancamentos ?? [];
  const previous = lancamentosPrev ?? [];

  // Aggregate by plano_contas
  const agrupado: Record<string, { receita: number; despesa: number }> = {};
  for (const l of current) {
    const key = l.plano_contas || "Sem classificação";
    if (!agrupado[key]) agrupado[key] = { receita: 0, despesa: 0 };
    if (l.tipo === "receita") agrupado[key].receita += l.valor || 0;
    else agrupado[key].despesa += l.valor || 0;
  }

  const totalReceita = current.filter((l: any) => l.tipo === "receita").reduce((s: number, l: any) => s + (l.valor || 0), 0);
  const totalDespesa = current.filter((l: any) => l.tipo === "despesa").reduce((s: number, l: any) => s + (l.valor || 0), 0);
  const lucro = totalReceita - totalDespesa;

  const prevReceita = previous.filter((l: any) => l.tipo === "receita").reduce((s: number, l: any) => s + (l.valor || 0), 0);
  const prevDespesa = previous.filter((l: any) => l.tipo === "despesa").reduce((s: number, l: any) => s + (l.valor || 0), 0);

  const pctReceita = prevReceita > 0 ? ((totalReceita - prevReceita) / prevReceita * 100) : 0;
  const pctDespesa = prevDespesa > 0 ? ((totalDespesa - prevDespesa) / prevDespesa * 100) : 0;

  return {
    mes_referencia: prev.label,
    mes_anterior: prevPrevLabel,
    agrupado,
    totalReceita,
    totalDespesa,
    lucro,
    prevReceita,
    prevDespesa,
    pctReceita: Math.round(pctReceita * 10) / 10,
    pctDespesa: Math.round(pctDespesa * 10) / 10,
  };
}

async function buildRelatorioHtml(data: any, sugestoes: string): Promise<string> {
  const rows = Object.entries(data.agrupado)
    .map(([key, val]: [string, any]) => `<tr><td>${key}</td><td style="color:green">R$${val.receita.toFixed(2)}</td><td style="color:red">R$${val.despesa.toFixed(2)}</td></tr>`)
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2>Relatório Financeiro — ${data.mes_referencia}</h2>
      <table border="1" cellpadding="8" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <tr style="background:#f4f4f4;"><th>Plano de Contas</th><th>Receita</th><th>Despesa</th></tr>
        ${rows}
        <tr style="font-weight:bold;background:#eee;">
          <td>TOTAL</td>
          <td style="color:green">R$${data.totalReceita.toFixed(2)}</td>
          <td style="color:red">R$${data.totalDespesa.toFixed(2)}</td>
        </tr>
      </table>
      <p><strong>Resultado:</strong> R$${data.lucro.toFixed(2)} (${data.lucro >= 0 ? "superávit" : "déficit"})</p>
      <p><strong>Variação Receita MoM:</strong> ${data.pctReceita > 0 ? "+" : ""}${data.pctReceita}%</p>
      <p><strong>Variação Despesa MoM:</strong> ${data.pctDespesa > 0 ? "+" : ""}${data.pctDespesa}%</p>
      <h3>Sugestões da IA</h3>
      <p>${sugestoes.replace(/\n/g, "<br>")}</p>
      <hr><p style="color:#999;font-size:12px;">Relatório gerado automaticamente por Lumied.</p>
    </div>
  `;
}

async function getAiSugestoes(data: any): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return "IA não configurada (ANTHROPIC_API_KEY ausente).";

  const prompt = `Você é um consultor financeiro escolar. Analise estes dados financeiros e dê 3-5 sugestões práticas e concisas em português:
Mês: ${data.mes_referencia}
Receita total: R$${data.totalReceita.toFixed(2)} (variação MoM: ${data.pctReceita}%)
Despesa total: R$${data.totalDespesa.toFixed(2)} (variação MoM: ${data.pctDespesa}%)
Resultado: R$${data.lucro.toFixed(2)}
Detalhamento por plano de contas: ${JSON.stringify(data.agrupado)}
Dê sugestões curtas e acionáveis. Sem markdown, texto puro.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await resp.json();
    return result?.content?.[0]?.text || "Sem sugestões disponíveis.";
  } catch {
    return "Erro ao consultar IA.";
  }
}

router.on("relatorio_mensal_enviar", authCronOrGerente, async (ctx) => {
  const escolaIdRelatorio = ctx.escola_id || (ctx.user as any)?.escola_id || await getEscolaPadrao(ctx.sb);
  const data = await buildRelatorioData(ctx.sb, escolaIdRelatorio);
  const sugestoes = await getAiSugestoes(data);
  const html = await buildRelatorioHtml(data, sugestoes);

  // Get recipient email
  const { data: escola } = await ctx.sb
    .from("escolas")
    .select("resp_financeiro_email")
    .limit(1)
    .maybeSingle();

  const recipientEmail = escola?.resp_financeiro_email;
  if (recipientEmail) {
    await sendEmail(recipientEmail, `Relatório Financeiro — ${data.mes_referencia}`, html);
  } else {
    log.warn("resp_financeiro_email não configurado, email não enviado");
  }

  // Log
  await ctx.sb.from("fin_relatorio_mensal").insert({
    mes_referencia: data.mes_referencia,
    total_receita: data.totalReceita,
    total_despesa: data.totalDespesa,
    lucro: data.lucro,
    sugestoes_ia: sugestoes,
    enviado_para: recipientEmail || null,
    gerado_por: ctx.user?.nome || "cron",
    escola_id: escolaIdRelatorio,
  });

  log.info("Relatório mensal enviado", { metadata: { mes: data.mes_referencia, para: recipientEmail } });
  return successResponse({ ...data, sugestoes, html, enviado_para: recipientEmail });
});

router.on("relatorio_mensal_preview", authGerente, async (ctx) => {
  if (!ctx.escola_id) throw new AppError("FORBIDDEN", "Sessão sem escola associada.");
  const data = await buildRelatorioData(ctx.sb, ctx.escola_id);
  const sugestoes = await getAiSugestoes(data);
  const html = await buildRelatorioHtml(data, sugestoes);
  return successResponse({ ...data, sugestoes, html });
});

// ═══════════════════════════════════════════════════════════════
//  FOLHA DE PAGAMENTO
// ═══════════════════════════════════════════════════════════════
router.on("folha_upload_parse", authGerente, async (ctx) => {
  const { pdf_base64 } = ctx.body as any;
  if (!pdf_base64) throw new AppError("VALIDATION_FAILED", "pdf_base64 obrigatório.");

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new AppError("BAD_REQUEST", "ANTHROPIC_API_KEY não configurada.");

  // Call Claude Vision to extract payroll data
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: pdf_base64 },
          },
          {
            type: "text",
            text: "Extraia os dados desta folha de pagamento em JSON. Para cada funcionário retorne: {nome, cpf, salario_bruto, descontos, salario_liquido}. Retorne APENAS o JSON array, sem markdown.",
          },
        ],
      }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  const result = await resp.json();
  const textContent = result?.content?.[0]?.text || "[]";

  let parsed: any[];
  try {
    parsed = JSON.parse(textContent);
  } catch {
    throw new AppError("BAD_REQUEST", "Não foi possível interpretar a folha. Tente com imagem mais nítida.");
  }

  // Enrich with bank data from rh_funcionarios
  for (const emp of parsed) {
    if (emp.cpf) {
      const cpfClean = emp.cpf.replace(/\D/g, "");
      const { data: func } = await ctx.sb
        .from("rh_funcionarios")
        .select("banco, agencia, conta, tipo_conta, pix_chave")
        .eq("cpf", cpfClean)
        .maybeSingle();

      if (func) {
        emp.banco = func.banco;
        emp.agencia = func.agencia;
        emp.conta = func.conta;
        emp.tipo_conta = func.tipo_conta;
        emp.pix_chave = func.pix_chave;
      }
    }
  }

  log.info("Folha parsed via AI", { metadata: { funcionarios: parsed.length } });
  return successResponse(parsed);
});

router.on("folha_upload_save", authGerente, async (ctx) => {
  const { mes_referencia, dados } = ctx.body as any;
  if (!mes_referencia || !dados) throw new AppError("VALIDATION_FAILED", "mes_referencia e dados obrigatórios.");

  const { data, error } = await ctx.sb.from("fin_folha_upload").insert({
    mes_referencia,
    dados,
    criado_por: ctx.user?.nome,
  }).select().single();

  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse(data);
});

// ═══════════════════════════════════════════════════════════════
//  PIX Helpers (CRC16 + Payload)
// ═══════════════════════════════════════════════════════════════
function crc16Ccitt(payload: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function gerarPayloadPix(chave: string, nome: string, cidade: string, valor: number, txid: string): string {
  const pad = (id: string, val: string) => id + val.length.toString().padStart(2, "0") + val;
  const gui = pad("00", "br.gov.bcb.pix");
  const chavePix = pad("01", chave);
  const merchantAccount = pad("26", gui + chavePix);
  const payloadSemCrc = pad("00", "01") + merchantAccount + pad("52", "0000") + pad("53", "986") + pad("54", valor.toFixed(2)) + pad("58", "BR") + pad("59", nome.substring(0, 25)) + pad("60", cidade.substring(0, 15)) + pad("62", pad("05", txid)) + "6304";
  return payloadSemCrc + crc16Ccitt(payloadSemCrc);
}

// ═══════════════════════════════════════════════════════════════
//  Serve
// ═══════════════════════════════════════════════════════════════
serve(async (req) => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return router.handle(req, sb);
});
