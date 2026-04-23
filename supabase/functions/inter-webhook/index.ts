import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { captureException } from '../_shared/sentry.ts'

async function interFetch(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams } = {}
): Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }> {
  const relayUrl = Deno.env.get('INTER_RELAY_URL')!
  const relaySecret = Deno.env.get('RELAY_SECRET')!
  const bodyStr = init.body instanceof URLSearchParams
    ? init.body.toString()
    : (init.body ?? '')

  const res = await fetch(`${relayUrl}/inter-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${relaySecret}` },
    body: JSON.stringify({ path, method: init.method ?? 'GET', headers: init.headers ?? {}, body: bodyStr }),
    signal: AbortSignal.timeout(15000),
  })

  const { status, body } = await res.json() as { status: number; body: string }
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  }
}

async function getInterToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: Deno.env.get('INTER_CLIENT_ID')!,
    client_secret: Deno.env.get('INTER_CLIENT_SECRET')!,
    scope: 'boleto-cobranca.read',
    grant_type: 'client_credentials',
  })

  const res = await interFetch('/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const text = await res.text()
  console.log('Inter OAuth status:', res.status, '| body:', text.slice(0, 200))
  if (!res.ok) throw new Error(`Inter auth falhou: ${res.status} | ${text}`)
  return (JSON.parse(text) as { access_token: string }).access_token
}

async function getBoletoPdf(token: string, codigoSolicitacao: string): Promise<Uint8Array> {
  const res = await interFetch(`/cobranca/v3/cobrancas/${codigoSolicitacao}/pdf`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-conta-corrente': Deno.env.get('INTER_CONTA')!,
    },
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`PDF boleto falhou: ${res.status} | ${text}`)

  const data = JSON.parse(text) as { pdf: string }
  const binary = atob(data.pdf)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 })

  // Authentication check
  const authHeader = req.headers.get("x-webhook-secret") || req.headers.get("authorization")?.replace("Bearer ", "");
  const expectedSecret = Deno.env.get("RELAY_SECRET");
  if (expectedSecret && authHeader !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const payload = await req.json()
    console.log('Webhook Inter recebido:', JSON.stringify(payload))

    const situacao: string = (payload.situacao ?? payload.evento ?? '').toUpperCase()
    const nossoNumero: string = payload.nossoNumero ?? ''
    const codigoSolicitacao: string = payload.codigoSolicitacao ?? ''
    const cpf: string = (payload.pagador?.cpfCnpj ?? '').replace(/\D/g, '')
    const valor: number = payload.valorNominal ?? payload.valor ?? 0
    const vencimento: string = payload.dataVencimento ?? ''
    const linhaDigitavel: string = payload.linhaDigitavel ?? ''

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ── PAGO: baixa automática ──
    if (situacao === 'PAGO') {
      const dataPagamento = payload.dataPagamento ?? new Date().toISOString().slice(0, 10)
      const valorRecebido = payload.valorTotalRecebido ?? valor
      console.log(`[inter-webhook] PAGO nossoNumero=${nossoNumero} valor=${valorRecebido} data=${dataPagamento}`)

      // 1. Atomic update: only mark as pago if not already processed (prevents race condition)
      const { data: updatedBoletos, error: updateErr } = await supabase.from('fin_boletos_emitidos')
        .update({
          status: 'pago', pago_em: dataPagamento,
        })
        .eq('nosso_numero', nossoNumero)
        .neq('status', 'pago')
        .select('id, mensalidade_id, batch_item_id, escola_id')

      if (updateErr) {
        console.error(`[inter-webhook] Erro ao atualizar boleto ${nossoNumero}:`, updateErr)
        throw updateErr
      }

      const boleto = updatedBoletos?.[0] ?? null

      // If no rows updated, boleto was already processed or doesn't exist — return early
      if (!boleto) {
        console.log(`[inter-webhook] Boleto ${nossoNumero} já processado ou não encontrado, ignorando duplicata`)
        return new Response(JSON.stringify({ ok: true, action: 'pago', nossoNumero, duplicado: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const escolaId: string | null = boleto.escola_id ?? null

      // Download comprovante PDF and update comprovante_url separately
      let comprovanteUrl: string | null = null
      try {
        const token = await getInterToken()
        const pdfBytes = await getBoletoPdf(token, codigoSolicitacao)
        const fileName = `comprovantes/${nossoNumero}_pago.pdf`
        await supabase.storage.from('boletos').upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })
        const { data: urlData } = supabase.storage.from('boletos').getPublicUrl(fileName)
        comprovanteUrl = urlData.publicUrl
      } catch (e) { console.warn('[inter-webhook] PDF comprovante indisponível:', e) }

      if (comprovanteUrl) {
        await supabase.from('fin_boletos_emitidos').update({ comprovante_url: comprovanteUrl })
          .eq('id', boleto.id)
      }

      // 2. Atualiza mensalidade vinculada (with escola_id filter)
      if (boleto.mensalidade_id) {
        const mensalidadeFilter = supabase.from('fin_mensalidades').update({
          status: 'pago', data_pagamento: dataPagamento,
        }).eq('id', boleto.mensalidade_id)
        if (escolaId) mensalidadeFilter.eq('escola_id', escolaId)
        await mensalidadeFilter
      }

      // 3. Atualiza batch item se houver (with escola_id filter)
      if (boleto.batch_item_id) {
        const batchFilter = supabase.from('fin_boleto_batch_items').update({ status: 'pago' })
          .eq('id', boleto.batch_item_id)
        if (escolaId) batchFilter.eq('escola_id', escolaId)
        await batchFilter
      }

      console.log(`[inter-webhook] Boleto ${nossoNumero} marcado como PAGO`)

      // 4. Atualiza tabela legada boletos (with escola_id filter)
      const legadoFilter = supabase.from('boletos').update({ situacao: 'PAGO' }).eq('nosso_numero', nossoNumero)
      if (escolaId) legadoFilter.eq('escola_id', escolaId)
      await legadoFilter

      return new Response(JSON.stringify({ ok: true, action: 'pago', nossoNumero }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── VENCIDO / CANCELADO / EXPIRADO: atualizar status ──
    if (['VENCIDO', 'CANCELADO', 'EXPIRADO'].includes(situacao)) {
      const statusMap: Record<string, string> = { VENCIDO: 'vencido', CANCELADO: 'cancelado', EXPIRADO: 'vencido' }
      const newStatus = statusMap[situacao] ?? 'vencido'
      console.log(`[inter-webhook] ${situacao} nossoNumero=${nossoNumero}`)

      // Atomic update: only transition if not already in final state 'pago'
      const { data: updatedBoletos } = await supabase.from('fin_boletos_emitidos')
        .update({ status: newStatus })
        .eq('nosso_numero', nossoNumero)
        .neq('status', 'pago')
        .select('escola_id, mensalidade_id')

      const boleto = updatedBoletos?.[0] ?? null
      const escolaId: string | null = boleto?.escola_id ?? null

      // Update legacy table (with escola_id filter)
      const legadoFilter = supabase.from('boletos').update({ situacao }).eq('nosso_numero', nossoNumero)
      if (escolaId) legadoFilter.eq('escola_id', escolaId)
      await legadoFilter

      // Marcar mensalidade como atrasado se VENCIDO (with escola_id filter)
      if (situacao === 'VENCIDO' && boleto?.mensalidade_id) {
        const mensalidadeFilter = supabase.from('fin_mensalidades').update({ status: 'atrasado' })
          .eq('id', boleto.mensalidade_id)
        if (escolaId) mensalidadeFilter.eq('escola_id', escolaId)
        await mensalidadeFilter
      }

      return new Response(JSON.stringify({ ok: true, action: situacao.toLowerCase(), nossoNumero }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── EMITIDO: fluxo original (download PDF + salvar) ──
    if (situacao !== 'EMITIDO') {
      return new Response(JSON.stringify({ ok: true, msg: `Situação ${situacao} não processada` }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!nossoNumero || !codigoSolicitacao || !cpf) {
      return new Response(JSON.stringify({ error: 'nossoNumero, codigoSolicitacao ou CPF ausente' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    const token = await getInterToken()
    const pdfBytes = await getBoletoPdf(token, codigoSolicitacao)

    const fileName = `${cpf}/${nossoNumero}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('boletos')
      .upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })

    if (uploadError) throw new Error(`Upload PDF falhou: ${uploadError.message}`)

    const { data: urlData } = supabase.storage.from('boletos').getPublicUrl(fileName)
    const pdfUrl = urlData.publicUrl

    const cpfFormatado = cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

    // Resolve escola_id from existing fin_boletos_emitidos record
    const { data: boletoEmitido } = await supabase.from('fin_boletos_emitidos')
      .select('escola_id').eq('nosso_numero', nossoNumero).maybeSingle()
    const escolaIdEmitido: string | null = boletoEmitido?.escola_id ?? null

    const boletoRecord: Record<string, unknown> = {
      cpf: cpfFormatado,
      nosso_numero: nossoNumero,
      valor,
      vencimento,
      linha_digitavel: linhaDigitavel,
      situacao: 'EMITIDO',
      pdf_url: pdfUrl,
    }
    if (escolaIdEmitido) boletoRecord.escola_id = escolaIdEmitido

    await supabase.from('boletos').upsert(boletoRecord, { onConflict: 'nosso_numero' }).catch(() => {
      // Fallback: insert if upsert fails (no unique constraint)
      return supabase.from('boletos').insert(boletoRecord)
    })

    console.log(`[inter-webhook] Boleto ${nossoNumero} EMITIDO para CPF ${cpfFormatado}`)

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Erro no webhook Inter:', err)
    captureException(err instanceof Error ? err : new Error(String(err)), { function: 'inter-webhook' }).catch(() => {})
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
