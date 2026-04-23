// ═══════════════════════════════════════════════════════════════
//  Edge Function: saas-billing (Banco Inter)
// ═══════════════════════════════════════════════════════════════
//  Cobrança recorrente SaaS via Banco Inter, usando o mesmo relay
//  mTLS que emite boletos de alunos. Substituiu integração ASAAS
//  antes de qualquer uso em produção.
//
//  Actions:
//    setup_cliente         — staff cadastra dados de pagador da escola
//    create_subscription   — staff inicia assinatura mensal lógica
//    cancel_subscription   — staff cancela
//    emitir_fatura         — staff emite uma fatura PENDING no Inter (cria cobrança)
//    emitir_faturas_lote   — staff emite todas as faturas PENDING sem inter_cobranca_id
//    list_faturas          — escola/gerente ou staff lista faturas
//    list_faturas_all      — staff lista de todas as escolas
//    list_subscriptions    — staff lista assinaturas
//    dashboard_stats       — staff MRR, ARR, inadimplência
//    fatura_avulsa         — staff cria cobrança única (setup, consultoria)
//    registrar_pagto_manual— staff marca fatura como paga manualmente
//    enviar_lembrete       — staff email de cobrança
//    marcar_inadimplente   — staff força status escola
//    escolas_faturaveis    — staff escolas ativas p/ seletor
//    webhook               — endpoint público Inter → sincroniza status
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("saas-billing");
let CORS: Record<string, string> = getCorsHeaders();

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function err(msg: string, status = 400, code?: string) {
  return json({ error: msg, code }, status);
}

// ── Inter API helpers (via relay mTLS) ──
async function interToken(scope = "boleto-cobranca.read boleto-cobranca.write"): Promise<string> {
  const clientId = Deno.env.get("INTER_CLIENT_ID");
  const clientSecret = Deno.env.get("INTER_CLIENT_SECRET");
  const relayUrl = Deno.env.get("INTER_RELAY_URL");
  const relaySecret = Deno.env.get("RELAY_SECRET");
  if (!clientId || !clientSecret || !relayUrl || !relaySecret) {
    throw new Error("Inter API não configurada (INTER_CLIENT_ID/SECRET + INTER_RELAY_URL/RELAY_SECRET).");
  }
  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope, grant_type: "client_credentials" });
  const res = await fetch(`${relayUrl}/inter-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${relaySecret}` },
    body: JSON.stringify({ path: "/oauth/v2/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }),
    signal: AbortSignal.timeout(15000),
  });
  const { status, body } = await res.json() as { status: number; body: string };
  if (status < 200 || status >= 300) throw new Error(`Inter OAuth falhou (${status}): ${body}`);
  const parsed = JSON.parse(body);
  if (!parsed?.access_token) throw new Error("Inter OAuth sem access_token");
  return parsed.access_token;
}

async function interCall(path: string, method = "GET", token: string, body?: unknown): Promise<any> {
  const relayUrl = Deno.env.get("INTER_RELAY_URL");
  const relaySecret = Deno.env.get("RELAY_SECRET");
  const contaCorrente = Deno.env.get("INTER_CONTA");
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (contaCorrente) headers["x-conta-corrente"] = contaCorrente;
  const res = await fetch(`${relayUrl}/inter-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${relaySecret}` },
    body: JSON.stringify({ path, method, headers, body: body ? JSON.stringify(body) : "" }),
    signal: AbortSignal.timeout(15000),
  });
  const { status, body: resBody } = await res.json() as { status: number; body: string };
  const parsed = resBody ? (() => { try { return JSON.parse(resBody); } catch { return resBody; } })() : null;
  if (status < 200 || status >= 300) throw new Error(`Inter ${method} ${path} falhou (${status}): ${resBody}`);
  return parsed;
}

async function validarStaff(sb: SupabaseClient, token: string): Promise<{ ok: boolean; staff?: any }> {
  if (!token) return { ok: false };
  const { data } = await sb.from("lumied_staff_sessoes")
    .select("staff_id, expira_em, lumied_staff(id, email, nome, cargo, papel_id, ativo)")
    .eq("token", token).maybeSingle();
  const d = data as any;
  if (!d || new Date(d.expira_em) < new Date()) return { ok: false };
  if (!d.lumied_staff?.ativo) return { ok: false };
  return { ok: true, staff: d.lumied_staff };
}

async function validarGerente(sb: SupabaseClient, token: string): Promise<{ ok: boolean; escola_id?: string }> {
  if (!token) return { ok: false };
  const { data: gs } = await sb.from("gerente_sessoes").select("gerente_id, expira_em, gerentes(escola_id)").eq("token", token).maybeSingle();
  const g = gs as any;
  if (g && new Date(g.expira_em) >= new Date()) return { ok: true, escola_id: g.gerentes?.escola_id };
  return { ok: false };
}

// ── Converte cobrança Inter → patch na saas_faturas ──
function patchFromCobranca(cob: any): Record<string, any> {
  const statusMap: Record<string, string> = {
    EM_PROCESSAMENTO: 'PENDING',
    A_RECEBER: 'PENDING',
    RECEBIDO: 'RECEIVED',
    PAGO: 'RECEIVED',
    MARCADO_RECEBIDO: 'RECEIVED_IN_CASH',
    ATRASADO: 'OVERDUE',
    CANCELADO: 'CANCELLED',
    EXPIRADO: 'OVERDUE',
    FALHA_EMISSAO: 'ERROR',
  };
  const status = statusMap[cob?.situacao] || cob?.situacao || 'PENDING';
  return {
    status,
    nosso_numero: cob?.boleto?.nossoNumero || null,
    linha_digitavel: cob?.boleto?.linhaDigitavel || null,
    codigo_barras: cob?.boleto?.codigoBarras || null,
    pix_txid: cob?.pix?.txid || null,
    pix_copia_cola: cob?.pix?.pixCopiaECola || null,
    url_boleto: cob?.boleto?.urlBoleto || null,
    data_pagamento: cob?.dataSituacao || null,
    valor_pago: cob?.valorTotalRecebimento || null,
    atualizado_em: new Date().toISOString(),
  };
}

// ── Verifica permissão (RPC que criamos na mig 246) ──
async function permitido(sb: SupabaseClient, staff: any, recurso: string, acao: string): Promise<boolean> {
  if (!staff) return false;
  if (staff.cargo === 'fundador') return true;
  const { data } = await sb.rpc("staff_tem_permissao", { p_staff_id: staff.id, p_recurso: recurso, p_acao: acao });
  return !!data;
}

serve(async (req) => {
  CORS = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }
  const action = body.action as string;
  const authHeader = req.headers.get("authorization") || "";
  const token = (body._token as string) || (body._staff_token as string) || authHeader.replace(/^Bearer\s+/i, "");

  try {
    // ── Webhook do Inter (sem auth — Inter usa HMAC via relay) ──
    if (action === "webhook" || req.url.includes("/webhook")) {
      // O relay já valida HMAC; aqui chega só o payload útil.
      // Inter envia 1 evento por cobrança: { codigoSolicitacao, situacao, ... }
      const cobranca = body.cobranca || body;
      const interId = cobranca?.codigoSolicitacao || cobranca?.seuNumero;
      if (!interId) return json({ ok: true, noop: true, reason: "sem codigoSolicitacao" });

      const patch = patchFromCobranca(cobranca);
      const { data: f } = await sb.from("saas_faturas")
        .update(patch)
        .eq("inter_cobranca_id", interId)
        .select("escola_id").maybeSingle();
      if (f && (f as any).escola_id) {
        await sb.rpc("sincronizar_saas_status", { p_escola_id: (f as any).escola_id });
      }
      log.info("Inter webhook", { metadata: { interId, status: patch.status } });
      return json({ ok: true });
    }

    const auth = await validarStaff(sb, token);
    const staff = auth.staff;

    // ── setup_cliente (staff) ──
    if (action === "setup_cliente") {
      if (!auth.ok || !(await permitido(sb, staff, 'saas_billing', 'criar_fatura'))) return err("Sem permissão.", 403);
      const { escola_id, cpf_cnpj, nome_pagador, email, telefone, endereco } = body;
      if (!escola_id || !cpf_cnpj || !nome_pagador) return err("escola_id, cpf_cnpj, nome_pagador obrigatórios.");
      const end = endereco || {};
      const payload = {
        escola_id, cpf_cnpj: String(cpf_cnpj).replace(/\D/g,''),
        nome_pagador, email: email || null, telefone: telefone || null,
        endereco_logradouro: end.logradouro || null, endereco_numero: end.numero || null,
        endereco_bairro: end.bairro || null, endereco_cidade: end.cidade || null,
        endereco_uf: end.uf || null, endereco_cep: (end.cep || '').replace(/\D/g,'') || null,
        atualizado_em: new Date().toISOString(),
      };
      const { data: existing } = await sb.from("saas_clientes_inter").select("id").eq("escola_id", escola_id).maybeSingle();
      if (existing) {
        await sb.from("saas_clientes_inter").update(payload).eq("escola_id", escola_id);
        return json({ ok: true, updated: true });
      }
      const { error } = await sb.from("saas_clientes_inter").insert(payload);
      if (error) return err(error.message);
      return json({ ok: true, created: true });
    }

    // ── create_subscription (staff) — cria assinatura lógica (sem chamar Inter). ──
    //    A geração de fatura do mês é feita pelo cron + emitir_faturas_lote.
    if (action === "create_subscription") {
      if (!auth.ok || !(await permitido(sb, staff, 'saas_billing', 'criar_fatura'))) return err("Sem permissão.", 403);
      const { escola_id, valor, dia_vencimento, ciclo, forma_pagamento, descricao } = body;
      if (!escola_id || !valor || !dia_vencimento) return err("escola_id, valor, dia_vencimento obrigatórios.");

      const { data: cli } = await sb.from("saas_clientes_inter").select("id").eq("escola_id", escola_id).maybeSingle();
      if (!cli) return err("Escola não tem cliente Inter — rode setup_cliente antes.", 400);

      const hoje = new Date();
      const prox = new Date(hoje.getFullYear(), hoje.getMonth() + (hoje.getDate() > Number(dia_vencimento) ? 1 : 0), Number(dia_vencimento));

      const { data: sub, error } = await sb.from("saas_assinaturas").insert({
        escola_id, valor: Number(valor),
        ciclo: (ciclo as string) || "MONTHLY",
        proximo_vencimento: prox.toISOString().slice(0, 10),
        status: "ACTIVE",
        forma_pagamento: (forma_pagamento as string) || "BOLETO",
      }).select("id").single();
      if (error) return err(error.message);

      await sb.from("escolas").update({
        saas_valor_mensal: Number(valor),
        saas_forma_pagamento: (forma_pagamento as string) || "boleto",
        saas_proximo_vencimento: prox.toISOString().slice(0, 10),
        saas_status: "ativo",
      }).eq("id", escola_id);

      // Também cria já a primeira fatura PENDING (para emitir_faturas_lote processar)
      await sb.from("saas_faturas").insert({
        escola_id, assinatura_id: (sub as any).id,
        valor: Number(valor), data_vencimento: prox.toISOString().slice(0, 10),
        status: "PENDING", forma_pagamento: (forma_pagamento as string) || "BOLETO",
        descricao: descricao || "Mensalidade Lumied",
      });

      return json({ ok: true, subscription_id: (sub as any).id, proximo_vencimento: prox.toISOString().slice(0, 10) });
    }

    // ── cancel_subscription (staff) ──
    if (action === "cancel_subscription") {
      if (!auth.ok || !(await permitido(sb, staff, 'saas_billing', 'cancelar'))) return err("Sem permissão.", 403);
      const { escola_id } = body;
      if (!escola_id) return err("escola_id obrigatório.");
      await sb.from("saas_assinaturas").update({ status: "CANCELLED" }).eq("escola_id", escola_id).eq("status", "ACTIVE");
      return json({ ok: true });
    }

    // ── emitir_fatura (staff) — emite UMA fatura no Inter a partir de uma saas_faturas PENDING ──
    if (action === "emitir_fatura") {
      if (!auth.ok || !(await permitido(sb, staff, 'saas_billing', 'criar_fatura'))) return err("Sem permissão.", 403);
      const { fatura_id } = body;
      if (!fatura_id) return err("fatura_id obrigatório.");
      const r = await emitirFatura(sb, fatura_id);
      return json(r);
    }

    // ── emitir_faturas_lote (staff) — emite todas as PENDING sem inter_cobranca_id ──
    if (action === "emitir_faturas_lote") {
      if (!auth.ok || !(await permitido(sb, staff, 'saas_billing', 'criar_fatura'))) return err("Sem permissão.", 403);
      const { data: pendentes } = await sb.from("saas_faturas")
        .select("id")
        .eq("status", "PENDING")
        .is("inter_cobranca_id", null)
        .order("data_vencimento")
        .limit(50);
      const results: any[] = [];
      for (const f of (pendentes || [])) {
        try {
          const r = await emitirFatura(sb, (f as any).id);
          results.push({ id: (f as any).id, ok: true, inter_cobranca_id: r.inter_cobranca_id });
        } catch (e) {
          results.push({ id: (f as any).id, ok: false, error: (e as Error).message });
        }
      }
      return json({ ok: true, processed: results.length, results });
    }

    // ── list_faturas (escola ou staff) ──
    if (action === "list_faturas") {
      let escolaTarget: string | null = null;
      if (auth.ok) {
        escolaTarget = body.escola_id;
        if (!escolaTarget) return err("escola_id obrigatório.");
      } else {
        const g = await validarGerente(sb, token);
        if (!g.ok || !g.escola_id) return err("Sessão inválida.", 401);
        escolaTarget = g.escola_id;
      }
      const { data } = await sb.from("saas_faturas")
        .select("id, valor, valor_pago, data_vencimento, data_pagamento, status, forma_pagamento, nosso_numero, linha_digitavel, codigo_barras, url_boleto, pix_copia_cola, descricao, inter_cobranca_id")
        .eq("escola_id", escolaTarget)
        .order("data_vencimento", { ascending: false })
        .limit(24);
      return json({ faturas: data ?? [] });
    }

    // ── list_faturas_all (staff) ──
    if (action === "list_faturas_all") {
      if (!auth.ok || !(await permitido(sb, staff, 'saas_billing', 'ver'))) return err("Sem permissão.", 403);
      const { data } = await sb.from("saas_faturas")
        .select("id, escola_id, valor, data_vencimento, data_pagamento, status, forma_pagamento, nosso_numero, escolas(nome)")
        .order("data_vencimento", { ascending: false })
        .limit(200);
      const out = (data ?? []).map((f: any) => ({ ...f, escola_nome: f.escolas?.nome }));
      return json({ faturas: out });
    }

    // ── list_subscriptions (staff) ──
    if (action === "list_subscriptions") {
      if (!auth.ok || !(await permitido(sb, staff, 'saas_billing', 'ver'))) return err("Sem permissão.", 403);
      const { data } = await sb.from("saas_assinaturas")
        .select("id, escola_id, inter_ref, valor, ciclo, proximo_vencimento, status, forma_pagamento, criado_em, escolas(nome, slug, saas_status)")
        .order("criado_em", { ascending: false }).limit(300);
      const out = (data || []).map((s: any) => ({ ...s, escola_nome: s.escolas?.nome, escola_slug: s.escolas?.slug, saas_status: s.escolas?.saas_status }));
      return json({ subscriptions: out });
    }

    // ── dashboard_stats (staff) ──
    if (action === "dashboard_stats") {
      if (!auth.ok || !(await permitido(sb, staff, 'saas_billing', 'ver'))) return err("Sem permissão.", 403);
      const hoje = new Date().toISOString().slice(0, 10);
      const ini30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const [assinaturasRes, faturasMesRes, pendRes, venRes, escolasRes] = await Promise.all([
        sb.from("saas_assinaturas").select("valor, status, ciclo").eq("status", "ACTIVE"),
        sb.from("saas_faturas").select("valor, valor_pago, status, data_vencimento, data_pagamento").gte("data_pagamento", ini30),
        sb.from("saas_faturas").select("valor, data_vencimento, escola_id, escolas(nome)").eq("status", "PENDING").order("data_vencimento").limit(200),
        sb.from("saas_faturas").select("valor, data_vencimento, escola_id, escolas(nome)").eq("status", "OVERDUE").order("data_vencimento").limit(200),
        sb.from("escolas").select("saas_status", { count: "exact", head: true }).eq("ativo", true),
      ]);
      const ativas: any[] = assinaturasRes.data || [];
      const mrr = ativas.reduce((s, a) => s + (Number(a.valor) || 0) * (a.ciclo === 'YEARLY' ? 1 / 12 : 1), 0);
      const faturasMes: any[] = faturasMesRes.data || [];
      const recebido30d = faturasMes
        .filter(f => ['RECEIVED', 'RECEIVED_IN_CASH'].includes(f.status))
        .reduce((s, f) => s + Number(f.valor_pago || f.valor || 0), 0);
      const pendentes: any[] = pendRes.data || [];
      const vencidas: any[] = venRes.data || [];
      const totalPendente = pendentes.reduce((s, f) => s + Number(f.valor || 0), 0);
      const totalVencido = vencidas.reduce((s, f) => s + Number(f.valor || 0), 0);
      const inadimplenciaPct = mrr > 0 ? (totalVencido / mrr) * 100 : 0;

      return json({
        assinaturas_ativas: ativas.length,
        escolas_ativas: escolasRes.count || 0,
        mrr, arr: mrr * 12,
        recebido_30d: recebido30d,
        total_pendente: totalPendente,
        total_vencido: totalVencido,
        inadimplencia_pct: Math.round(inadimplenciaPct * 10) / 10,
        vencidas: vencidas.slice(0, 20).map((f: any) => ({
          escola_id: f.escola_id, escola_nome: f.escolas?.nome, valor: Number(f.valor),
          data_vencimento: f.data_vencimento,
          dias_atraso: Math.floor((new Date(hoje).getTime() - new Date(f.data_vencimento).getTime()) / 86400000),
        })),
        pendentes_proximas: pendentes.slice(0, 20).map((f: any) => ({
          escola_id: f.escola_id, escola_nome: f.escolas?.nome, valor: Number(f.valor), data_vencimento: f.data_vencimento,
        })),
      });
    }

    // ── fatura_avulsa (staff) — cria cobrança única ──
    if (action === "fatura_avulsa") {
      if (!auth.ok || !(await permitido(sb, staff, 'saas_billing', 'criar_fatura'))) return err("Sem permissão.", 403);
      const { escola_id, valor, descricao, data_vencimento, forma_pagamento } = body;
      if (!escola_id || !valor || !descricao) return err("escola_id, valor, descricao obrigatórios.");
      const dueDate = (data_vencimento as string) || new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
      const { data: f, error } = await sb.from("saas_faturas").insert({
        escola_id, valor: Number(valor), data_vencimento: dueDate, status: "PENDING",
        forma_pagamento: forma_pagamento || "BOLETO", descricao,
      }).select("id").single();
      if (error) return err(error.message);

      // Emite imediatamente no Inter
      try {
        const r = await emitirFatura(sb, (f as any).id);
        return json({ ok: true, fatura_id: (f as any).id, ...r });
      } catch (e) {
        return json({ ok: true, fatura_id: (f as any).id, emit_error: (e as Error).message });
      }
    }

    // ── registrar_pagto_manual (staff) ──
    if (action === "registrar_pagto_manual") {
      if (!auth.ok || !(await permitido(sb, staff, 'saas_billing', 'registrar_pagto'))) return err("Sem permissão.", 403);
      const { fatura_id, valor_pago, data_pagamento, observacao } = body;
      if (!fatura_id) return err("fatura_id obrigatório.");
      const { data: f } = await sb.from("saas_faturas").select("id, escola_id, valor").eq("id", fatura_id).maybeSingle();
      if (!f) return err("Fatura não encontrada.", 404);
      const pago = Number(valor_pago) || Number((f as any).valor);
      const dtPgto = (data_pagamento as string) || new Date().toISOString().slice(0, 10);
      await sb.from("saas_faturas").update({
        status: 'RECEIVED_IN_CASH', valor_pago: pago, data_pagamento: dtPgto,
        descricao: observacao ? `[pgto manual] ${observacao}` : undefined,
      }).eq("id", fatura_id);
      await sb.rpc("sincronizar_saas_status", { p_escola_id: (f as any).escola_id });
      return json({ ok: true });
    }

    // ── enviar_lembrete (staff) ──
    if (action === "enviar_lembrete") {
      if (!auth.ok || !(await permitido(sb, staff, 'saas_billing', 'ver'))) return err("Sem permissão.", 403);
      const { escola_id, fatura_id, mensagem_extra } = body;
      if (!escola_id) return err("escola_id obrigatório.");
      const { data: esc } = await sb.from("escolas").select("nome, contato_email, contato_nome").eq("id", escola_id).maybeSingle();
      if (!esc || !(esc as any).contato_email) return err("Escola sem e-mail de contato.", 400);
      const fatura = fatura_id
        ? (await sb.from("saas_faturas").select("valor, data_vencimento, url_boleto, linha_digitavel, pix_copia_cola").eq("id", fatura_id).maybeSingle()).data
        : (await sb.from("saas_faturas").select("valor, data_vencimento, url_boleto, linha_digitavel, pix_copia_cola").eq("escola_id", escola_id).eq("status", "PENDING").order("data_vencimento").limit(1).maybeSingle()).data;
      if (!fatura) return err("Fatura não encontrada.", 404);
      const f = fatura as any;
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) return err("RESEND_API_KEY não configurada.", 500);
      const vencimentoFmt = new Date(f.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR');
      const linkBoleto = f.url_boleto || '';
      const html = `
        <div style="font-family:sans-serif;max-width:560px;color:#0F172A;">
          <h2 style="color:#6B3FA0;">Lembrete de fatura — ${(esc as any).nome}</h2>
          <p>Olá${(esc as any).contato_nome ? ' ' + (esc as any).contato_nome.split(' ')[0] : ''},</p>
          <p>Este é um lembrete amigável da sua fatura Lumied:</p>
          <table style="border-collapse:collapse;margin:14px 0;">
            <tr><td style="padding:6px 10px;background:#f0e6ff;"><b>Valor</b></td><td style="padding:6px 10px;">R$ ${Number(f.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td></tr>
            <tr><td style="padding:6px 10px;background:#f0e6ff;"><b>Vencimento</b></td><td style="padding:6px 10px;">${vencimentoFmt}</td></tr>
          </table>
          ${mensagem_extra ? `<p style="background:#fef3c7;padding:12px;border-left:4px solid #ca8a04;border-radius:6px;">${String(mensagem_extra).replace(/[<>]/g, '')}</p>` : ''}
          ${linkBoleto ? `<p><a href="${linkBoleto}" style="background:#6B3FA0;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;">Ver 2ª via do boleto</a></p>` : ''}
          ${f.linha_digitavel ? `<p style="font-size:12px;color:#64748b;">Linha digitável:<br><code style="background:#f1f5f9;padding:4px;font-size:11px;word-break:break-all;">${f.linha_digitavel}</code></p>` : ''}
          ${f.pix_copia_cola ? `<p style="font-size:12px;color:#64748b;">PIX copia-e-cola:<br><code style="background:#f1f5f9;padding:4px;font-size:11px;word-break:break-all;">${f.pix_copia_cola}</code></p>` : ''}
          <p style="color:#64748b;font-size:12px;margin-top:18px;">Qualquer dúvida, responda este e-mail.</p>
          <p style="color:#6B3FA0;font-weight:700;">Equipe Lumied</p>
        </div>`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Lumied Financeiro <financeiro@lumied.com.br>",
          to: [(esc as any).contato_email],
          reply_to: "ivyson@gmail.com",
          subject: `Lembrete: fatura Lumied vence em ${vencimentoFmt}`,
          html,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return err(`Resend: ${await res.text()}`, 502);
      return json({ ok: true, sent_to: (esc as any).contato_email });
    }

    // ── marcar_inadimplente (staff) ──
    if (action === "marcar_inadimplente") {
      if (!auth.ok || !(await permitido(sb, staff, 'saas_billing', 'cancelar'))) return err("Sem permissão.", 403);
      const { escola_id, novo_status } = body;
      if (!escola_id || !novo_status) return err("escola_id e novo_status obrigatórios.");
      if (!['ativo', 'atraso', 'suspenso', 'bloqueado', 'cancelado'].includes(novo_status)) return err("Status inválido.");
      await sb.from("escolas").update({ saas_status: novo_status }).eq("id", escola_id);
      return json({ ok: true });
    }

    // ── escolas_faturaveis (staff) ──
    if (action === "escolas_faturaveis") {
      if (!auth.ok || !(await permitido(sb, staff, 'saas_billing', 'ver'))) return err("Sem permissão.", 403);
      const { data } = await sb.from("escolas")
        .select("id, nome, slug, saas_status, saas_valor_mensal, saas_proximo_vencimento, saas_clientes_inter(id, cpf_cnpj)")
        .eq("ativo", true).order("nome");
      const out = (data || []).map((e: any) => ({ ...e, tem_cliente_inter: !!(e.saas_clientes_inter && e.saas_clientes_inter[0]?.cpf_cnpj) }));
      return json({ escolas: out });
    }

    return err("Ação inválida.", 400);
  } catch (e) {
    log.error("saas-billing erro", { metadata: { err: (e as Error).message } });
    return err((e as Error).message, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
//  Emissão de fatura no Inter (compartilhado entre emitir_fatura e fatura_avulsa)
// ═══════════════════════════════════════════════════════════════
async function emitirFatura(sb: SupabaseClient, faturaId: string): Promise<any> {
  const { data: fat } = await sb.from("saas_faturas")
    .select("id, escola_id, valor, data_vencimento, descricao, inter_cobranca_id")
    .eq("id", faturaId).maybeSingle();
  if (!fat) throw new Error("Fatura não encontrada.");
  const f = fat as any;
  if (f.inter_cobranca_id) throw new Error("Fatura já emitida no Inter.");

  const { data: cli } = await sb.from("saas_clientes_inter").select("*").eq("escola_id", f.escola_id).maybeSingle();
  if (!cli) throw new Error("Escola sem cliente Inter — configure setup_cliente.");
  const c = cli as any;

  // Validações Inter obrigatórias
  if (!c.endereco_cep || !c.endereco_logradouro || !c.endereco_cidade || !c.endereco_uf) {
    throw new Error("Endereço do pagador incompleto (CEP, logradouro, cidade, UF).");
  }

  const token = await interToken();
  const seuNumero = `LUMIED-${String(f.id).replace(/-/g, '').slice(0, 15)}`;
  const payload = {
    seuNumero,
    valorNominal: Number(f.valor),
    dataVencimento: f.data_vencimento,
    numDiasAgenda: 30,
    pagador: {
      cpfCnpj: c.cpf_cnpj,
      tipoPessoa: c.cpf_cnpj.length > 11 ? "JURIDICA" : "FISICA",
      nome: c.nome_pagador,
      email: c.email || undefined,
      telefone: c.telefone || undefined,
      endereco: c.endereco_logradouro,
      numero: c.endereco_numero || "S/N",
      bairro: c.endereco_bairro || "",
      cidade: c.endereco_cidade,
      uf: c.endereco_uf,
      cep: c.endereco_cep,
    },
    mensagem: { linha1: f.descricao || "Lumied — Mensalidade SaaS" },
  };

  // 1) Cria a cobrança (retorna codigoSolicitacao)
  const create = await interCall("/cobranca/v3/cobrancas", "POST", token, payload);
  const codigoSolicitacao = create?.codigoSolicitacao || create?.CodigoSolicitacao;
  if (!codigoSolicitacao) throw new Error(`Inter sem codigoSolicitacao: ${JSON.stringify(create)}`);

  // 2) Consulta detalhes (nosso número + linha digitável + PIX txid)
  let detalhes: any = {};
  try {
    detalhes = await interCall(`/cobranca/v3/cobrancas/${codigoSolicitacao}`, "GET", token);
  } catch (e) {
    log.warn("Consulta inicial Inter falhou; webhook preencherá depois", { metadata: { err: (e as Error).message } });
  }
  const patch = patchFromCobranca(detalhes);
  patch.inter_cobranca_id = codigoSolicitacao;

  await sb.from("saas_faturas").update(patch).eq("id", faturaId);
  return { inter_cobranca_id: codigoSolicitacao, ...patch };
}
