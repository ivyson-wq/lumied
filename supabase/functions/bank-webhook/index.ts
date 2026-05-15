// bank-webhook — webhook genérico multi-banco.
//
// URL: POST /bank-webhook/{banco}
//   ex: /bank-webhook/inter, /bank-webhook/sicredi, /bank-webhook/bb
//
// Fluxo:
//  1. Extrai banco do path
//  2. Resolve escola via CNPJ beneficiário no payload (ou header)
//  3. Carrega BancoConfig
//  4. adapter.parseWebhook → evento canônico
//  5. Aplica side-effects (atualiza fin_boletos_emitidos, fin_mensalidades, boletos)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { captureException } from '../_shared/sentry.ts'
import { getBankAdapter, bancosImplementados } from '../_shared/banks/registry.ts'
import { getBancoConfigByCnpj } from '../_shared/banks/config.ts'
import { BankError } from '../_shared/banks/errors.ts'
import type { BancoProvider, WebhookEvent } from '../_shared/banks/types.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 })

  try {
    const url = new URL(req.url)
    // Path: /bank-webhook/{banco} (Supabase edge functions: pathname pode incluir o nome da função)
    const pathParts = url.pathname.split('/').filter(Boolean)
    const banco = (pathParts[pathParts.length - 1] || '').toLowerCase() as BancoProvider

    if (!bancosImplementados().includes(banco)) {
      return new Response(JSON.stringify({ error: `Banco '${banco}' não suportado.` }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    const bodyText = await req.text()
    if (!bodyText) {
      return new Response(JSON.stringify({ error: 'Body vazio.' }), { status: 400 })
    }

    // Auth: pra Inter (legado), aceita RELAY_SECRET via x-webhook-secret/Authorization
    if (banco === 'inter') {
      const authHeader = req.headers.get('x-webhook-secret') || req.headers.get('authorization')?.replace('Bearer ', '')
      const expected = Deno.env.get('RELAY_SECRET')
      if (expected && authHeader !== expected) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      }
    }

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Resolve escola via CNPJ beneficiário no payload
    const payload = JSON.parse(bodyText)
    const cnpjBenef: string = (
      payload.beneficiario?.cpfCnpj ??
      payload.beneficiario?.cnpj ??
      payload.cnpjBeneficiario ??
      ''
    ).replace(/\D/g, '')

    let config = cnpjBenef
      ? await getBancoConfigByCnpj(sb, banco, cnpjBenef)
      : null

    // Fallback: se não tem CNPJ no payload (Inter antigo), aceita só se
    // houver EXATAMENTE 1 config ativa pra esse banco (deploy single-tenant).
    // Em multi-tenant, recusa: anti-padrão do incidente 16/04/2026
    // ([[project_tenant_isolation_incident]]).
    if (!config) {
      const { data: ativas, count } = await sb.from('escola_banco_config')
        .select('*', { count: 'exact' })
        .eq('banco', banco)
        .eq('ativo', true)
      if (count === 1 && ativas && ativas.length === 1) {
        config = ativas[0] as any
        console.warn(`[bank-webhook] ${banco} sem CNPJ no payload — usando única config ativa (single-tenant).`)
      } else if (count && count > 1) {
        console.error(`[bank-webhook] ${banco} sem CNPJ em multi-tenant (${count} configs ativas). Recusando.`)
        return new Response(JSON.stringify({ error: 'Payload sem identificação de escola (CNPJ ausente em multi-tenant).' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (!config) {
      return new Response(JSON.stringify({ error: `Nenhuma escola configurada para ${banco}.` }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      })
    }

    // Validação HMAC + parse via adapter
    const adapter = getBankAdapter(banco)
    let event: WebhookEvent
    try {
      event = await adapter.parseWebhook(req.headers, bodyText, config)
    } catch (e) {
      if (e instanceof BankError && e.code === 'WEBHOOK_INVALID_SIG') {
        return new Response(JSON.stringify({ error: 'Assinatura inválida.' }), { status: 401 })
      }
      throw e
    }

    console.log(`[bank-webhook] ${banco} ${event.tipo} nosso_numero=${event.nosso_numero ?? ''} txid=${event.txid ?? ''}`)

    // ── Side effects (atualiza tabelas internas) ──
    if (event.tipo === 'boleto.pago' && event.nosso_numero) {
      await processarBoletoPago(sb, event)
    } else if (
      (event.tipo === 'boleto.vencido' || event.tipo === 'boleto.cancelado')
      && event.nosso_numero
    ) {
      await processarBoletoStatus(sb, event)
    } else if (event.tipo === 'boleto.emitido' && event.nosso_numero) {
      // Só logamos — o boleto foi criado pela escola, registro local já existe
      console.log(`[bank-webhook] EMITIDO confirmação ${event.nosso_numero}`)
    }

    return new Response(JSON.stringify({ ok: true, banco, tipo: event.tipo, nosso_numero: event.nosso_numero }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[bank-webhook] erro:', err)
    captureException(err instanceof Error ? err : new Error(String(err)), { function: 'bank-webhook' }).catch(() => {})

    if (err instanceof BankError) {
      return new Response(JSON.stringify(err.toJSON()), { status: 502, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})

// ─────────────────────────────────────────────────────────────────

async function processarBoletoPago(sb: any, event: WebhookEvent): Promise<void> {
  const nossoNumero = event.nosso_numero!
  const dataPagamento = event.data_pagamento ?? new Date().toISOString().slice(0, 10)
  const valorPago = event.valor_pago ?? event.valor

  // Atomic update: só marca pago se ainda não estiver
  const { data: updated } = await sb.from('fin_boletos_emitidos')
    .update({ status: 'pago', pago_em: dataPagamento })
    .eq('nosso_numero', nossoNumero)
    .neq('status', 'pago')
    .select('id, mensalidade_id, batch_item_id, escola_id')

  const boleto = updated?.[0] ?? null
  if (!boleto) {
    console.log(`[bank-webhook] ${nossoNumero} já processado, ignorando duplicata`)
    return
  }

  const escolaId: string | null = boleto.escola_id ?? null

  // Atualiza mensalidade
  if (boleto.mensalidade_id) {
    const q = sb.from('fin_mensalidades').update({ status: 'pago', data_pagamento: dataPagamento }).eq('id', boleto.mensalidade_id)
    if (escolaId) q.eq('escola_id', escolaId)
    await q
  }

  // Atualiza batch item
  if (boleto.batch_item_id) {
    const q = sb.from('fin_boleto_batch_items').update({ status: 'pago' }).eq('id', boleto.batch_item_id)
    if (escolaId) q.eq('escola_id', escolaId)
    await q
  }

  // Tabela legada
  const q = sb.from('boletos').update({ situacao: 'PAGO' }).eq('nosso_numero', nossoNumero)
  if (escolaId) q.eq('escola_id', escolaId)
  await q

  // Lançamento financeiro (método pagamento)
  if (boleto.mensalidade_id) {
    await sb.from('fin_lancamentos')
      .update({ metodo_pagamento: 'boleto', referencia_pagamento: nossoNumero })
      .eq('mensalidade_id', boleto.mensalidade_id)
  }

  // Cancela PIX vinculado
  await sb.from('pix_cobrancas')
    .update({ status: 'cancelada' })
    .eq('status', 'ativa')
    .eq('boleto_id', boleto.id)

  console.log(`[bank-webhook] ${event.banco} ${nossoNumero} marcado como PAGO (R$ ${valorPago})`)
}

async function processarBoletoStatus(sb: any, event: WebhookEvent): Promise<void> {
  const nossoNumero = event.nosso_numero!
  const statusMap: Record<string, string> = {
    'boleto.vencido': 'vencido',
    'boleto.cancelado': 'cancelado',
  }
  const newStatus = statusMap[event.tipo] ?? 'vencido'

  const { data: updated } = await sb.from('fin_boletos_emitidos')
    .update({ status: newStatus })
    .eq('nosso_numero', nossoNumero)
    .neq('status', 'pago')
    .select('escola_id, mensalidade_id')

  const boleto = updated?.[0] ?? null
  const escolaId: string | null = boleto?.escola_id ?? null

  // Tabela legada
  const situacao = event.tipo === 'boleto.vencido' ? 'VENCIDO' : 'CANCELADO'
  const q = sb.from('boletos').update({ situacao }).eq('nosso_numero', nossoNumero)
  if (escolaId) q.eq('escola_id', escolaId)
  await q

  // Mensalidade vencida
  if (event.tipo === 'boleto.vencido' && boleto?.mensalidade_id) {
    const q2 = sb.from('fin_mensalidades').update({ status: 'atrasado' }).eq('id', boleto.mensalidade_id)
    if (escolaId) q2.eq('escola_id', escolaId)
    await q2
  }
}
