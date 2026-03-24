import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

  try {
    const payload = await req.json()
    console.log('Webhook Inter recebido:', JSON.stringify(payload))

    const situacao = payload.situacao ?? payload.evento
    if (situacao !== 'EMITIDO') {
      return new Response(JSON.stringify({ ok: true, msg: `Situação ${situacao} ignorada` }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const nossoNumero: string = payload.nossoNumero
    const codigoSolicitacao: string = payload.codigoSolicitacao
    const cpf: string = payload.pagador?.cpfCnpj?.replace(/\D/g, '')
    const valor: number = payload.valorNominal ?? payload.valor
    const vencimento: string = payload.dataVencimento
    const linhaDigitavel: string = payload.linhaDigitavel ?? ''

    if (!nossoNumero || !codigoSolicitacao || !cpf) {
      return new Response(JSON.stringify({ error: 'nossoNumero, codigoSolicitacao ou CPF ausente' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

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

    const { error: dbError } = await supabase.from('boletos').insert({
      cpf: cpfFormatado,
      nosso_numero: nossoNumero,
      valor,
      vencimento,
      linha_digitavel: linhaDigitavel,
      situacao: 'EMITIDO',
      pdf_url: pdfUrl,
    })

    if (dbError) throw new Error(`Inserção no banco falhou: ${dbError.message}`)

    console.log(`Boleto ${nossoNumero} salvo para CPF ${cpfFormatado}`)

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Erro no webhook Inter:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
