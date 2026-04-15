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

    return err("Ação inválida.", 400);
  } catch (e) {
    log.error("saas-billing erro", { metadata: { err: (e as Error).message } });
    return err((e as Error).message, 500);
  }
});
