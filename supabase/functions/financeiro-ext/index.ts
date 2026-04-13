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
  });
  const { status, body: resBody } = await res.json();
  if (status < 200 || status >= 300) throw new Error(`Inter API error ${status}: ${resBody}`);
  return JSON.parse(resBody);
}

async function getInterToken(...scopeOptions: string[]): Promise<string> {
  const clientId = Deno.env.get("INTER_CLIENT_ID");
  const clientSecret = Deno.env.get("INTER_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new AppError("BAD_REQUEST", "Inter API não configurada.");
  const scopes = scopeOptions.length ? scopeOptions : ["extrato.read"];
  for (const scope of scopes) {
    try {
      const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope, grant_type: "client_credentials" });
      const data = await interFetch("/oauth/v2/token", "POST", { "Content-Type": "application/x-www-form-urlencoded" }, params.toString());
      if (data?.access_token) {
        log.info(`Inter OAuth scope aceito: ${scope}`);
        return data.access_token;
      }
    } catch { log.warn(`Inter OAuth scope rejeitado: ${scope}`); }
  }
  throw new Error(`Nenhum scope aceito pelo Inter. Tentados: ${scopes.join(", ")}`);
}

// ═══════════════════════════════════════════════════════════════
//  Resend Email Helper
// ═══════════════════════════════════════════════════════════════
async function sendEmail(to: string, subject: string, html: string) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    log.warn("RESEND_API_KEY not configured");
    return;
  }
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: "Lumied Financeiro <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });
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
  const { data } = await ctx.sb.from("pix_config").select("*").eq("ativo", true).limit(1).single();
  return successResponse(data || {});
});

router.on("pix_config_set", authGerente, requireFeature("pix"), async (ctx) => {
  const { chave_pix, tipo_chave, nome_beneficiario, cidade } = ctx.body as any;
  if (!chave_pix) throw new AppError("VALIDATION_FAILED", "Chave PIX obrigatória.");
  const { data: existing } = await ctx.sb.from("pix_config").select("id").limit(1).single();
  if (existing) await ctx.sb.from("pix_config").update({ chave_pix, tipo_chave, nome_beneficiario, cidade }).eq("id", existing.id);
  else await ctx.sb.from("pix_config").insert({ chave_pix, tipo_chave, nome_beneficiario, cidade });
  log.info("PIX config atualizado");
  return successResponse({ success: true });
});

router.on("pix_gerar_cobranca", authGerente, requireFeature("pix"), async (ctx) => {
  const { valor, descricao, familia_email, boleto_id, mensalidade_id } = ctx.body as any;
  if (!valor) throw new AppError("VALIDATION_FAILED", "Valor obrigatório.");
  const { data: config } = await ctx.sb.from("pix_config").select("*").eq("ativo", true).limit(1).single();
  if (!config) throw new AppError("BAD_REQUEST", "PIX não configurado.");
  const txid = "MB" + Date.now().toString(36).toUpperCase() + Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(36)).join('').toUpperCase();
  const payload = gerarPayloadPix(config.chave_pix, config.nome_beneficiario || "MAPLE BEAR", config.cidade || "CAXIAS DO SUL", valor, txid);
  const { data, error } = await ctx.sb.from("pix_cobrancas").insert({ boleto_id, mensalidade_id, txid, qr_code_payload: payload, valor, descricao, familia_email, expira_em: new Date(Date.now() + 24 * 3600000).toISOString() }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("PIX cobrança gerada", { metadata: { txid, valor } });
  return successResponse(data);
});

router.on("pix_cobrancas_list", authGerente, requireFeature("pix"), async (ctx) => {
  const { status, familia_email } = ctx.body as any;
  let q = ctx.sb.from("pix_cobrancas").select("*").order("criado_em", { ascending: false });
  if (status) q = q.eq("status", status);
  if (familia_email) q = q.eq("familia_email", familia_email);
  const { data } = await q.limit(100);
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  CONTÁBIL
// ═══════════════════════════════════════════════════════════════
router.on("contabil_config_get", authGerente, requireFeature("contabil"), async (ctx) => {
  const { data } = await ctx.sb.from("contabil_config").select("*").eq("ativo", true);
  return successResponse(data ?? []);
});

router.on("contabil_config_set", authGerente, requireFeature("contabil"), async (ctx) => {
  const { sistema, formato_exportacao, config: cfg } = ctx.body as any;
  if (!sistema) throw new AppError("VALIDATION_FAILED", "Sistema obrigatório.");
  const { error } = await ctx.sb.from("contabil_config").upsert({ sistema, formato_exportacao, config: cfg || {} } as any);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("contabil_exportar", authGerente, requireFeature("contabil"), async (ctx) => {
  const { sistema, periodo_inicio, periodo_fim, tipo } = ctx.body as any;
  if (!sistema || !periodo_inicio || !periodo_fim) throw new AppError("VALIDATION_FAILED", "sistema, periodo_inicio e periodo_fim obrigatórios.");
  const { data: lancamentos } = await ctx.sb.from("fin_lancamentos").select("*").gte("data_lancamento", periodo_inicio).lte("data_lancamento", periodo_fim).order("data_lancamento");
  const { data: exp, error } = await ctx.sb.from("contabil_exportacoes").insert({ sistema, periodo_inicio, periodo_fim, tipo: tipo || "lancamentos", registros: lancamentos?.length || 0, gerado_por: ctx.user?.nome }).select().single();
  if (error) throw new AppError("BAD_REQUEST", error.message);
  log.info("Exportação contábil", { metadata: { sistema, registros: lancamentos?.length } });
  return successResponse({ ...exp, lancamentos: lancamentos ?? [] });
});

router.on("contabil_exportacoes_list", authGerente, requireFeature("contabil"), async (ctx) => {
  const { data } = await ctx.sb.from("contabil_exportacoes").select("*").order("gerado_em", { ascending: false }).limit(50);
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  CONCILIAÇÃO AUTOMÁTICA
// ═══════════════════════════════════════════════════════════════
router.on("conciliacao_automatica", authCronOrGerente, async (ctx) => {
  const relayUrl = Deno.env.get("INTER_RELAY_URL");
  if (!relayUrl) {
    return successResponse({ error: "Inter API não configurada. Configure INTER_RELAY_URL para habilitar a conciliação automática.", matched: 0, created: 0, pendente_revisao: 0 });
  }

  let token: string;
  try {
    token = await getInterToken("extrato.read", "banking.extrato.read", "extrato.read banking.read");
  } catch (e) {
    return successResponse({ error: `Falha na autenticação Inter: ${e instanceof Error ? e.message : e}`, matched: 0, created: 0, pendente_revisao: 0 });
  }
  const dataRef = yesterday();
  const interConta = Deno.env.get("INTER_CONTA") || "";

  const extrato = await interFetch(
    `/banking/v2/extrato?dataInicio=${dataRef}&dataFim=${dataRef}`,
    "GET",
    { Authorization: `Bearer ${token}`, "x-conta-corrente": interConta },
  );

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
      }).eq("id", lancamento.id);
      matched++;
    } else {
      await ctx.sb.from("fin_lancamentos").insert({
        tipo: tx.tipoOperacao === "C" ? "receita" : "despesa",
        descricao: tx.titulo || tx.descricao || "Transação Inter",
        valor: txValor,
        data_lancamento: txData,
        status: "pendente_revisao",
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
    });
  }

  // Log execution
  await ctx.sb.from("fin_conciliacao_execucoes").insert({
    data_referencia: dataRef,
    transacoes_total: transacoes.length,
    conciliadas: matched,
    novas: created,
    executado_por: ctx.user?.nome || "cron",
  });

  log.info("Conciliação executada", { metadata: { dataRef, matched, created, total: transacoes.length } });
  return successResponse({ data_referencia: dataRef, transacoes: transacoes.length, conciliadas: matched, novas: created });
});

router.on("conciliacao_pendentes_list", authGerente, async (ctx) => {
  const { data } = await ctx.sb
    .from("fin_lancamentos")
    .select("*")
    .eq("status", "pendente_revisao")
    .order("data_lancamento", { ascending: false });
  return successResponse(data ?? []);
});

router.on("conciliacao_pendente_resolver", authGerente, async (ctx) => {
  const { id, conta_id, status } = ctx.body as any;
  if (!id || !status) throw new AppError("VALIDATION_FAILED", "id e status obrigatórios.");
  if (!["pendente", "pago"].includes(status)) throw new AppError("VALIDATION_FAILED", "Status deve ser 'pendente' ou 'pago'.");

  const { error } = await ctx.sb.from("fin_lancamentos").update({ conta_id, status }).eq("id", id).eq("status", "pendente_revisao");
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("conciliacao_historico", authGerente, async (ctx) => {
  const { data } = await ctx.sb
    .from("fin_conciliacao_execucoes")
    .select("*")
    .order("executado_em", { ascending: false })
    .limit(20);
  return successResponse(data ?? []);
});

// ═══════════════════════════════════════════════════════════════
//  BOLETOS BATCH (Day 28)
// ═══════════════════════════════════════════════════════════════
router.on("boletos_gerar_batch", authCronOrGerente, async (ctx) => {
  const nm = nextMonth();
  const mesRef = nm.label;

  // Get dia vencimento from escola_config
  const { data: cfgDia } = await ctx.sb
    .from("escola_config")
    .select("valor")
    .eq("chave", "dia_vencimento_boleto")
    .maybeSingle();
  const diaVencimento = cfgDia?.valor || "10";
  const vencimento = `${nm.year}-${String(nm.month).padStart(2, "0")}-${diaVencimento.padStart(2, "0")}`;

  // Get active alunos with families
  const { data: alunos } = await ctx.sb
    .from("alunos")
    .select("id, nome, serie, turno, familia_email, resp_nome, cpf")
    .eq("ativo", true);

  if (!alunos || alunos.length === 0) {
    return successResponse({ batch_id: null, total_alunos: 0, message: "Nenhum aluno ativo encontrado." });
  }

  // Get family data
  const emails = [...new Set(alunos.map((a: any) => a.familia_email).filter(Boolean))];
  const { data: familias } = await ctx.sb
    .from("familias")
    .select("email, nome_resp, cpf")
    .in("email", emails);
  const familiaMap = new Map((familias ?? []).map((f: any) => [f.email, f]));

  // Create batch record
  const { data: batch, error: batchErr } = await ctx.sb
    .from("fin_boletos_batch")
    .insert({
      mes_referencia: mesRef,
      status: "aguardando_aprovacao",
      total_boletos: alunos.length,
    })
    .select()
    .single();
  if (batchErr) throw new AppError("BAD_REQUEST", batchErr.message);

  let totalGeral = 0;
  const batchItems: any[] = [];

  for (const aluno of alunos) {
    const items: { nome: string; valor: number }[] = [];

    // Turno value: try previous month's mensalidade as reference
    const { data: prevMens } = await ctx.sb
      .from("fin_mensalidades")
      .select("valor")
      .eq("crianca_nome", aluno.nome)
      .order("mes", { ascending: false })
      .limit(1)
      .maybeSingle();
    const turnoValor = prevMens?.valor || 0;

    const mesLabel = nm.month <= 9 ? `0${nm.month}` : `${nm.month}`;
    const monthNames = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    items.push({ nome: `Mensalidade ${monthNames[nm.month]}/${nm.year}`, valor: turnoValor });

    // Get inscribed activities
    const famEmail = aluno.familia_email;
    if (famEmail) {
      const { data: inscricoes } = await ctx.sb
        .from("inscricoes_atividades")
        .select("atividades_ids")
        .eq("email", famEmail)
        .maybeSingle();

      if (inscricoes?.atividades_ids?.length) {
        const { data: atividades } = await ctx.sb
          .from("atividades")
          .select("nome, preco")
          .in("id", inscricoes.atividades_ids);

        for (const at of atividades ?? []) {
          if (at.preco && at.preco > 0) {
            items.push({ nome: at.nome, valor: at.preco });
          }
        }
      }
    }

    const descDetalhada = items.map(i => `${i.nome}: R$${i.valor.toFixed(2)}`).join(" | ");
    const valorTotal = items.reduce((s, i) => s + i.valor, 0);
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
      vencimento: vencimento,
      status: "aguardando",
    });
  }

  if (batchItems.length > 0) {
    await ctx.sb.from("fin_boleto_batch_items").insert(batchItems);
  }

  // Update batch with totals
  await ctx.sb.from("fin_boletos_batch").update({
    valor_total: totalGeral,
  }).eq("id", batch.id);

  log.info("Batch de boletos gerado", { metadata: { mesRef, alunos: alunos.length, valorTotal: totalGeral } });
  return successResponse({ batch_id: batch.id, mes_referencia: mesRef, total_alunos: alunos.length, valor_total: totalGeral });
});

router.on("boletos_batch_list", authGerente, async (ctx) => {
  const { data } = await ctx.sb
    .from("fin_boletos_batch")
    .select("*, fin_boleto_batch_items(*)")
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

  const { error } = await ctx.sb.from("fin_boleto_batch_items").update(updates).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

router.on("boletos_batch_aprovar", authGerente, async (ctx) => {
  const { batch_id } = ctx.body as any;
  if (!batch_id) throw new AppError("VALIDATION_FAILED", "batch_id obrigatório.");

  // Update batch status
  await ctx.sb.from("fin_boletos_batch").update({
    status: "aprovado",
    aprovado_por: ctx.user?.nome,
    aprovado_em: new Date().toISOString(),
  }).eq("id", batch_id);

  // Get all items
  const { data: items } = await ctx.sb
    .from("fin_boleto_batch_items")
    .select("*")
    .eq("batch_id", batch_id);

  if (!items || items.length === 0) {
    return successResponse({ batch_id, emitidos: 0, erros: 0 });
  }

  // Update all items to aprovado
  await ctx.sb.from("fin_boleto_batch_items").update({ status: "aprovado" }).eq("batch_id", batch_id);

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
            mensagem: {
              linha1: (item.descricao_detalhada || "").substring(0, 100),
            },
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
  await ctx.sb.from("fin_boletos_batch").update({ status: finalStatus }).eq("id", batch_id);

  log.info("Batch aprovado e emitido", { metadata: { batch_id, emitidos, erros } });
  return successResponse({ batch_id, emitidos, erros, status: finalStatus });
});

router.on("boletos_batch_rejeitar", authGerente, async (ctx) => {
  const { batch_id } = ctx.body as any;
  if (!batch_id) throw new AppError("VALIDATION_FAILED", "batch_id obrigatório.");
  await ctx.sb.from("fin_boletos_batch").update({ status: "rejeitado" }).eq("id", batch_id);
  return successResponse({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  INADIMPLÊNCIA
// ═══════════════════════════════════════════════════════════════
router.on("inadimplencia_verificar", authCronOrGerente, async (ctx) => {
  const { data: overdue } = await ctx.sb
    .from("fin_mensalidades")
    .select("*")
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
        const { data: cfgAdv } = await ctx.sb
          .from("escola_config")
          .select("valor")
          .eq("chave", "email_advogado")
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

          const html = `
            <h2>Cobrança Extrajudicial — ${m.crianca_nome}</h2>
            <p><strong>Responsável:</strong> ${familia?.nome_resp || m.familia_email}</p>
            <p><strong>Email:</strong> ${m.familia_email}</p>
            <p><strong>Telefone:</strong> ${familia?.telefone || "N/I"}</p>
            <h3>Débitos em aberto:</h3>
            <ul>${debtList}</ul>
            <p><strong>Contrato:</strong> <a href="${contratoLink}">${contratoLink}</a></p>
            <p>Este email foi gerado automaticamente pelo sistema Lumied.</p>
          `;

          await sendEmail(cfgAdv.valor, `Cobrança Extrajudicial — ${m.crianca_nome}`, html);

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
  const { data: items } = await ctx.sb
    .from("fin_inadimplencia")
    .select("*")
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
  const { error } = await ctx.sb.from("fin_inadimplencia").update({
    status: "resolvido",
    resolvido_em: new Date().toISOString(),
    resolvido_por: ctx.user?.nome,
  }).eq("id", id);
  if (error) throw new AppError("BAD_REQUEST", error.message);
  return successResponse({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  RELATÓRIO MENSAL
// ═══════════════════════════════════════════════════════════════
async function buildRelatorioData(sb: any) {
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
    .gte("data_lancamento", mesInicio)
    .lte("data_lancamento", mesFim);

  // Previous month data (for MoM)
  const { data: lancamentosPrev } = await sb
    .from("fin_lancamentos")
    .select("tipo, plano_contas, valor")
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
    });
    const result = await resp.json();
    return result?.content?.[0]?.text || "Sem sugestões disponíveis.";
  } catch {
    return "Erro ao consultar IA.";
  }
}

router.on("relatorio_mensal_enviar", authCronOrGerente, async (ctx) => {
  const data = await buildRelatorioData(ctx.sb);
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
  });

  log.info("Relatório mensal enviado", { metadata: { mes: data.mes_referencia, para: recipientEmail } });
  return successResponse({ ...data, sugestoes, html, enviado_para: recipientEmail });
});

router.on("relatorio_mensal_preview", authGerente, async (ctx) => {
  const data = await buildRelatorioData(ctx.sb);
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
