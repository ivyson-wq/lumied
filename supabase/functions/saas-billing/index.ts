// ═══════════════════════════════════════════════════════════════
//  Edge Function: saas-billing
// ═══════════════════════════════════════════════════════════════
//  Billing SaaS via Asaas — cobrança recorrente das escolas-cliente.
//
//  Actions:
//    setup_customer       — staff cria/atualiza customer no Asaas
//    create_subscription  — staff inicia assinatura mensal recorrente
//    cancel_subscription  — staff cancela
//    list_faturas         — escola/gerente lista suas próprias faturas
//    list_faturas_all     — staff lista de todas as escolas (últimos 60d)
//    webhook              — endpoint pro Asaas bater (NÃO autenticar)
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createLogger } from "../_shared/logger.ts";

const log = createLogger("saas-billing");
let CORS: Record<string, string> = getCorsHeaders();

const ASAAS_API_BASE = Deno.env.get("ASAAS_API_BASE") || "https://api.asaas.com/v3";
const ASAAS_API_KEY = () => Deno.env.get("ASAAS_API_KEY") || "";
const ASAAS_WEBHOOK_SECRET = () => Deno.env.get("ASAAS_WEBHOOK_SECRET") || "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function err(msg: string, status = 400, code?: string) {
  return json({ error: msg, code }, status);
}

async function asaas(path: string, method = "GET", body?: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const key = ASAAS_API_KEY();
  if (!key) return { ok: false, status: 500, data: { error: "ASAAS_API_KEY não configurada" } };
  const resp = await fetch(`${ASAAS_API_BASE}${path}`, {
    method,
    headers: { "access_token": key, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

async function validarStaff(sb: SupabaseClient, token: string): Promise<{ ok: boolean; staff?: unknown }> {
  if (!token) return { ok: false };
  const { data } = await sb.from("lumied_staff_sessoes").select("staff_id, expira_em, lumied_staff(email, nome)").eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const d = data as any;
  if (!d || new Date(d.expira_em) < new Date()) return { ok: false };
  return { ok: true, staff: d.lumied_staff };
}

async function validarGerente(sb: SupabaseClient, token: string): Promise<{ ok: boolean; escola_id?: string }> {
  if (!token) return { ok: false };
  const { data: gs } = await sb.from("gerente_sessoes").select("gerente_id, expira_em, gerentes(escola_id)").eq("token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const g = gs as any;
  if (g && new Date(g.expira_em) >= new Date()) return { ok: true, escola_id: g.gerentes?.escola_id };
  return { ok: false };
}

serve(async (req) => {
  CORS = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const action = body.action as string;
  const authHeader = req.headers.get("authorization") || "";
  const token = (body._token as string) || authHeader.replace(/^Bearer\s+/i, "");

  try {
    // ── Webhook do Asaas (sem auth — Asaas não suporta Bearer, usa token custom) ──
    if (action === "webhook" || req.url.includes("/webhook")) {
      const asaasToken = req.headers.get("asaas-access-token") || req.headers.get("x-asaas-token") || "";
      if (ASAAS_WEBHOOK_SECRET() && asaasToken !== ASAAS_WEBHOOK_SECRET()) {
        return err("Webhook token inválido.", 401);
      }
      const event = body.event as string;
      const payment = body.payment || body.subscription || {};
      log.info("asaas webhook", { metadata: { event, payment_id: payment.id } });

      if (payment.id && payment.customer) {
        // Localiza escola pelo customer_id
        const { data: cli } = await sb.from("saas_clientes_asaas").select("escola_id").eq("asaas_customer_id", payment.customer).maybeSingle();
        if (!cli) {
          log.warn("Webhook sem escola associada", { metadata: { customer: payment.customer } });
          return json({ ok: true, noop: true });
        }
        const escola_id = (cli as { escola_id: string }).escola_id;

        // Upsert da fatura
        await sb.from("saas_faturas").upsert({
          asaas_payment_id: payment.id,
          escola_id,
          valor: payment.value || 0,
          valor_pago: payment.netValue || null,
          data_vencimento: payment.dueDate || new Date().toISOString().slice(0,10),
          data_pagamento: payment.paymentDate || payment.confirmedDate || null,
          status: payment.status || "PENDING",
          forma_pagamento: payment.billingType || null,
          url_fatura: payment.invoiceUrl || null,
          url_boleto: payment.bankSlipUrl || null,
          pix_copia_cola: payment.pixTransaction?.qrCode?.payload || null,
          descricao: payment.description || null,
          webhook_raw: body,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: "asaas_payment_id" });

        // Sincroniza status da escola
        await sb.rpc("sincronizar_saas_status", { p_escola_id: escola_id });
      }
      return json({ ok: true });
    }

    // ── Actions autenticadas ──
    const staff = await validarStaff(sb, token);

    // setup_customer (staff)
    if (action === "setup_customer") {
      if (!staff.ok) return err("Staff apenas.", 403);
      const { escola_id, name, email, cpfCnpj, phone, address } = body as Record<string, string>;
      if (!escola_id || !name || !cpfCnpj) return err("escola_id, name, cpfCnpj obrigatórios.");

      // Verifica se já existe
      const { data: existing } = await sb.from("saas_clientes_asaas").select("asaas_customer_id").eq("escola_id", escola_id).maybeSingle();
      if (existing) {
        // Atualiza no Asaas
        const r = await asaas(`/customers/${(existing as { asaas_customer_id: string }).asaas_customer_id}`, "POST", { name, email, phone, cpfCnpj, address });
        if (!r.ok) return err(`Asaas: ${JSON.stringify(r.data)}`, r.status);
        return json({ ok: true, customer_id: (existing as { asaas_customer_id: string }).asaas_customer_id, updated: true });
      }

      // Cria novo customer
      const r = await asaas(`/customers`, "POST", { name, email, cpfCnpj, phone, address, notificationDisabled: false });
      if (!r.ok) return err(`Asaas: ${JSON.stringify(r.data)}`, r.status);
      const customer = r.data as { id: string };

      await sb.from("saas_clientes_asaas").insert({
        escola_id, asaas_customer_id: customer.id, cpf_cnpj: cpfCnpj,
      });
      return json({ ok: true, customer_id: customer.id, created: true });
    }

    // create_subscription (staff)
    if (action === "create_subscription") {
      if (!staff.ok) return err("Staff apenas.", 403);
      const { escola_id, valor, dia_vencimento, ciclo, forma_pagamento, descricao } = body as Record<string, string | number>;
      if (!escola_id || !valor || !dia_vencimento) return err("escola_id, valor, dia_vencimento obrigatórios.");

      const { data: cli } = await sb.from("saas_clientes_asaas").select("asaas_customer_id").eq("escola_id", escola_id).maybeSingle();
      if (!cli) return err("Escola não tem customer no Asaas — rode setup_customer antes.", 400);

      // Próximo vencimento: próximo mês, dia N (ou ajusta)
      const hoje = new Date();
      const prox = new Date(hoje.getFullYear(), hoje.getMonth() + (hoje.getDate() > Number(dia_vencimento) ? 1 : 0), Number(dia_vencimento));

      const r = await asaas(`/subscriptions`, "POST", {
        customer: (cli as { asaas_customer_id: string }).asaas_customer_id,
        billingType: (forma_pagamento as string) || "BOLETO",
        value: Number(valor),
        nextDueDate: prox.toISOString().slice(0, 10),
        cycle: (ciclo as string) || "MONTHLY",
        description: descricao || "Plano Lumied — assinatura mensal",
      });
      if (!r.ok) return err(`Asaas: ${JSON.stringify(r.data)}`, r.status);
      const sub = r.data as { id: string; nextDueDate: string; status: string };

      await sb.from("saas_assinaturas").insert({
        escola_id, asaas_subscription_id: sub.id, valor: Number(valor),
        ciclo: (ciclo as string) || "MONTHLY",
        proximo_vencimento: sub.nextDueDate, status: sub.status || "ACTIVE",
        forma_pagamento: (forma_pagamento as string) || "BOLETO",
      });

      // Atualiza escolas com valor + forma pagamento
      await sb.from("escolas").update({
        saas_valor_mensal: Number(valor),
        saas_forma_pagamento: (forma_pagamento as string) || "boleto",
        saas_proximo_vencimento: sub.nextDueDate,
        saas_status: "ativo",
      }).eq("id", escola_id);

      return json({ ok: true, subscription_id: sub.id, proximo_vencimento: sub.nextDueDate });
    }

    // cancel_subscription (staff)
    if (action === "cancel_subscription") {
      if (!staff.ok) return err("Staff apenas.", 403);
      const { escola_id } = body as Record<string, string>;
      if (!escola_id) return err("escola_id obrigatório.");
      const { data: sub } = await sb.from("saas_assinaturas").select("asaas_subscription_id, id").eq("escola_id", escola_id).eq("status", "ACTIVE").maybeSingle();
      if (!sub) return err("Nenhuma assinatura ativa.", 404);
      const r = await asaas(`/subscriptions/${(sub as { asaas_subscription_id: string }).asaas_subscription_id}`, "DELETE");
      if (!r.ok) return err(`Asaas: ${JSON.stringify(r.data)}`, r.status);
      await sb.from("saas_assinaturas").update({ status: "CANCELLED" }).eq("id", (sub as { id: string }).id);
      return json({ ok: true });
    }

    // list_faturas (gerente da própria escola OU staff com escola_id específico)
    if (action === "list_faturas") {
      let escolaTarget: string | null = null;
      if (staff.ok) {
        escolaTarget = body.escola_id as string;
        if (!escolaTarget) return err("escola_id obrigatório.");
      } else {
        const g = await validarGerente(sb, token);
        if (!g.ok || !g.escola_id) return err("Sessão inválida.", 401);
        escolaTarget = g.escola_id;
      }
      const { data } = await sb.from("saas_faturas")
        .select("id, valor, valor_pago, data_vencimento, data_pagamento, status, forma_pagamento, url_fatura, url_boleto, pix_copia_cola, descricao")
        .eq("escola_id", escolaTarget)
        .order("data_vencimento", { ascending: false })
        .limit(24);
      return json({ faturas: data ?? [] });
    }

    // list_faturas_all (staff)
    if (action === "list_faturas_all") {
      if (!staff.ok) return err("Staff apenas.", 403);
      const { data } = await sb.from("saas_faturas")
        .select("id, escola_id, valor, data_vencimento, data_pagamento, status, forma_pagamento, escolas(nome)")
        .order("data_vencimento", { ascending: false })
        .limit(200);
      // deno-lint-ignore no-explicit-any
      const out = (data ?? []).map((f: any) => ({ ...f, escola_nome: f.escolas?.nome }));
      return json({ faturas: out });
    }

    // ═══════════════════════════════════════════════════════════════
    //  FINANCEIRO — dashboard, assinaturas, cobrança avulsa, ações
    // ═══════════════════════════════════════════════════════════════

    // dashboard_stats (staff) — MRR, ARR, inadimplência, fluxo 30d
    if (action === "dashboard_stats") {
      if (!staff.ok) return err("Staff apenas.", 403);
      const hoje = new Date().toISOString().slice(0,10);
      const ini30 = new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
      const [assinaturasRes, faturasMesRes, pendRes, venRes, escolasRes] = await Promise.all([
        sb.from("saas_assinaturas").select("valor, status, ciclo").eq("status","ACTIVE"),
        sb.from("saas_faturas").select("valor, valor_pago, status, data_vencimento, data_pagamento").gte("data_pagamento", ini30),
        sb.from("saas_faturas").select("valor, data_vencimento, escola_id, escolas(nome)").eq("status","PENDING").order("data_vencimento").limit(200),
        sb.from("saas_faturas").select("valor, data_vencimento, escola_id, escolas(nome)").eq("status","OVERDUE").order("data_vencimento").limit(200),
        sb.from("escolas").select("saas_status", { count: "exact", head: true }).eq("ativo", true),
      ]);
      // deno-lint-ignore no-explicit-any
      const ativas: any[] = assinaturasRes.data || [];
      const mrr = ativas.reduce((s, a) => s + (Number(a.valor) || 0) * (a.ciclo === 'YEARLY' ? 1/12 : 1), 0);
      // deno-lint-ignore no-explicit-any
      const faturasMes: any[] = faturasMesRes.data || [];
      const recebido30d = faturasMes
        .filter(f => ['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(f.status))
        .reduce((s, f) => s + Number(f.valor_pago || f.valor || 0), 0);
      // deno-lint-ignore no-explicit-any
      const pendentes: any[] = pendRes.data || [];
      // deno-lint-ignore no-explicit-any
      const vencidas: any[] = venRes.data || [];
      const totalPendente = pendentes.reduce((s, f) => s + Number(f.valor || 0), 0);
      const totalVencido = vencidas.reduce((s, f) => s + Number(f.valor || 0), 0);
      const inadimplenciaPct = mrr > 0 ? (totalVencido / mrr) * 100 : 0;

      return json({
        assinaturas_ativas: ativas.length,
        escolas_ativas: escolasRes.count || 0,
        mrr,
        arr: mrr * 12,
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

    // list_subscriptions (staff) — todas assinaturas com escola
    if (action === "list_subscriptions") {
      if (!staff.ok) return err("Staff apenas.", 403);
      const { data } = await sb.from("saas_assinaturas")
        .select("id, escola_id, asaas_subscription_id, valor, ciclo, proximo_vencimento, status, forma_pagamento, criado_em, escolas(nome, slug, saas_status)")
        .order("criado_em", { ascending: false }).limit(300);
      // deno-lint-ignore no-explicit-any
      const out = (data || []).map((s: any) => ({ ...s, escola_nome: s.escolas?.nome, escola_slug: s.escolas?.slug, saas_status: s.escolas?.saas_status }));
      return json({ subscriptions: out });
    }

    // fatura_avulsa (staff) — cria cobrança única via Asaas (setup, consultoria, etc.)
    if (action === "fatura_avulsa") {
      if (!staff.ok) return err("Staff apenas.", 403);
      const { escola_id, valor, descricao, data_vencimento, forma_pagamento } = body as Record<string, string | number>;
      if (!escola_id || !valor || !descricao) return err("escola_id, valor e descricao obrigatórios.");
      const { data: cli } = await sb.from("saas_clientes_asaas").select("asaas_customer_id").eq("escola_id", escola_id).maybeSingle();
      if (!cli) return err("Escola não tem customer no Asaas — rode setup_customer antes.", 400);
      const dueDate = (data_vencimento as string) || new Date(Date.now() + 5*86400000).toISOString().slice(0,10);

      const r = await asaas(`/payments`, "POST", {
        customer: (cli as { asaas_customer_id: string }).asaas_customer_id,
        billingType: (forma_pagamento as string) || "BOLETO",
        value: Number(valor),
        dueDate,
        description: descricao,
      });
      if (!r.ok) return err(`Asaas: ${JSON.stringify(r.data)}`, r.status);
      // deno-lint-ignore no-explicit-any
      const p = r.data as any;
      await sb.from("saas_faturas").insert({
        asaas_payment_id: p.id, escola_id,
        valor: Number(valor), data_vencimento: dueDate,
        status: p.status || "PENDING",
        forma_pagamento: (forma_pagamento as string) || "BOLETO",
        url_fatura: p.invoiceUrl, url_boleto: p.bankSlipUrl,
        pix_copia_cola: p.pixTransaction?.qrCode?.payload || null,
        descricao,
      });
      return json({ ok: true, payment_id: p.id, invoice_url: p.invoiceUrl, boleto_url: p.bankSlipUrl });
    }

    // registrar_pagto_manual (staff) — marca fatura como paga (ex: PIX externo)
    if (action === "registrar_pagto_manual") {
      if (!staff.ok) return err("Staff apenas.", 403);
      const { fatura_id, valor_pago, data_pagamento, observacao } = body as Record<string, string | number>;
      if (!fatura_id) return err("fatura_id obrigatório.");
      const { data: f } = await sb.from("saas_faturas").select("id, escola_id, valor, status").eq("id", fatura_id).maybeSingle();
      if (!f) return err("Fatura não encontrada.", 404);
      const pago = Number(valor_pago) || Number((f as any).valor);
      const dtPgto = (data_pagamento as string) || new Date().toISOString().slice(0,10);
      await sb.from("saas_faturas").update({
        status: 'RECEIVED_IN_CASH',
        valor_pago: pago,
        data_pagamento: dtPgto,
        descricao: observacao ? `[pgto manual] ${observacao}` : undefined,
      }).eq("id", fatura_id);
      await sb.rpc("sincronizar_saas_status", { p_escola_id: (f as any).escola_id });
      return json({ ok: true });
    }

    // enviar_lembrete (staff) — email de cobrança para escola
    if (action === "enviar_lembrete") {
      if (!staff.ok) return err("Staff apenas.", 403);
      const { escola_id, fatura_id, mensagem_extra } = body as Record<string, string>;
      if (!escola_id) return err("escola_id obrigatório.");
      const { data: esc } = await sb.from("escolas").select("nome, contato_email, contato_nome").eq("id", escola_id).maybeSingle();
      if (!esc || !(esc as any).contato_email) return err("Escola sem e-mail de contato.", 400);
      const fatura = fatura_id
        ? (await sb.from("saas_faturas").select("valor, data_vencimento, url_boleto, url_fatura, pix_copia_cola").eq("id", fatura_id).maybeSingle()).data
        : (await sb.from("saas_faturas").select("valor, data_vencimento, url_boleto, url_fatura, pix_copia_cola").eq("escola_id", escola_id).eq("status","PENDING").order("data_vencimento").limit(1).maybeSingle()).data;
      if (!fatura) return err("Fatura não encontrada.", 404);
      // deno-lint-ignore no-explicit-any
      const f = fatura as any;
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) return err("RESEND_API_KEY não configurada.", 500);
      const vencimentoFmt = new Date(f.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR');
      const linkBoleto = f.url_boleto || f.url_fatura || '';
      const html = `
        <div style="font-family:sans-serif;max-width:560px;color:#0F172A;">
          <h2 style="color:#6B3FA0;">Lembrete de fatura — ${(esc as any).nome}</h2>
          <p>Olá${(esc as any).contato_nome ? ' ' + (esc as any).contato_nome.split(' ')[0] : ''},</p>
          <p>Este é um lembrete amigável da sua fatura Lumied:</p>
          <table style="border-collapse:collapse;margin:14px 0;">
            <tr><td style="padding:6px 10px;background:#f0e6ff;"><b>Valor</b></td><td style="padding:6px 10px;">R$ ${Number(f.valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td></tr>
            <tr><td style="padding:6px 10px;background:#f0e6ff;"><b>Vencimento</b></td><td style="padding:6px 10px;">${vencimentoFmt}</td></tr>
          </table>
          ${mensagem_extra ? `<p style="background:#fef3c7;padding:12px;border-left:4px solid #ca8a04;border-radius:6px;">${String(mensagem_extra).replace(/[<>]/g,'')}</p>` : ''}
          ${linkBoleto ? `<p><a href="${linkBoleto}" style="background:#6B3FA0;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;">Ver fatura / 2ª via</a></p>` : ''}
          ${f.pix_copia_cola ? `<p style="font-size:12px;color:#64748b;">PIX copia-e-cola:<br><code style="background:#f1f5f9;padding:4px;font-size:11px;word-break:break-all;">${f.pix_copia_cola}</code></p>` : ''}
          <p style="color:#64748b;font-size:12px;margin-top:18px;">Qualquer dúvida, responda este e-mail. Estamos por aqui.</p>
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

    // marcar_inadimplente (staff) — força status=suspenso/bloqueado na escola
    if (action === "marcar_inadimplente") {
      if (!staff.ok) return err("Staff apenas.", 403);
      const { escola_id, novo_status } = body as Record<string, string>;
      if (!escola_id || !novo_status) return err("escola_id e novo_status obrigatórios.");
      if (!['ativo','atraso','suspenso','bloqueado','cancelado'].includes(novo_status)) return err("Status inválido.");
      await sb.from("escolas").update({ saas_status: novo_status }).eq("id", escola_id);
      return json({ ok: true });
    }

    // escolas_faturaveis (staff) — escolas ativas + dados de cobrança para seletor
    if (action === "escolas_faturaveis") {
      if (!staff.ok) return err("Staff apenas.", 403);
      const { data } = await sb.from("escolas")
        .select("id, nome, slug, saas_status, saas_valor_mensal, saas_proximo_vencimento, saas_clientes_asaas(asaas_customer_id)")
        .eq("ativo", true).order("nome");
      // deno-lint-ignore no-explicit-any
      const out = (data || []).map((e: any) => ({ ...e, tem_customer_asaas: !!(e.saas_clientes_asaas && e.saas_clientes_asaas[0]?.asaas_customer_id) }));
      return json({ escolas: out });
    }

    return err("Ação inválida.", 400);
  } catch (e) {
    log.error("saas-billing erro", { metadata: { err: (e as Error).message } });
    return err((e as Error).message, 500);
  }
});
