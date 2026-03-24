import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const INTER_BASE_HOST = 'cdpj.partners.bancointer.com.br'

function parsePem(raw: string): string {
  const pem = raw.replace(/\\n/g, '\n').trim()
  const headerMatch = pem.match(/-----BEGIN ([^-]+)-----/)
  const footerMatch = pem.match(/-----END ([^-]+)-----/)
  if (!headerMatch || !footerMatch) return pem
  const header = `-----BEGIN ${headerMatch[1]}-----`
  const footer = `-----END ${footerMatch[1]}-----`
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/[\s]/g, '')
  const lines = b64.match(/.{1,64}/g) ?? []
  return [header, ...lines, footer].join('\n')
}

function parseHttpResponse(raw: string): { status: number; body: string } {
  const headerEnd = raw.indexOf('\r\n\r\n')
  if (headerEnd < 0) throw new Error('Resposta HTTP inválida')
  const headerSection = raw.slice(0, headerEnd)
  const lines = headerSection.split('\r\n')
  const status = parseInt(lines[0].split(' ')[1] ?? '0')
  const headers: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':')
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
  }
  const rawBody = raw.slice(headerEnd + 4)
  let body: string
  if (headers['transfer-encoding']?.toLowerCase().includes('chunked')) {
    let decoded = ''
    let pos = 0
    while (pos < rawBody.length) {
      const end = rawBody.indexOf('\r\n', pos)
      if (end < 0) break
      const size = parseInt(rawBody.slice(pos, end), 16)
      if (!size) break
      pos = end + 2
      decoded += rawBody.slice(pos, pos + size)
      pos += size + 2
    }
    body = decoded
  } else {
    body = rawBody
  }
  return { status, body }
}

async function interFetch(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams } = {}
): Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }> {
  const cert = parsePem(Deno.env.get('INTER_CERT')!)
  const key = parsePem(Deno.env.get('INTER_KEY')!)
  const method = init.method ?? 'GET'
  const bodyStr = init.body instanceof URLSearchParams
    ? init.body.toString()
    : (init.body ?? '')

  const conn = await Deno.connectTls({
    hostname: INTER_BASE_HOST,
    port: 443,
    certChain: cert,
    privateKey: key,
  })

  try {
    const allHeaders: Record<string, string> = {
      Host: INTER_BASE_HOST,
      Connection: 'close',
      ...init.headers,
    }
    if (bodyStr) allHeaders['Content-Length'] = String(new TextEncoder().encode(bodyStr).length)

    const headerLines = Object.entries(allHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n')
    const rawRequest = `${method} ${path} HTTP/1.1\r\n${headerLines}\r\n\r\n${bodyStr}`

    await conn.write(new TextEncoder().encode(rawRequest))

    const chunks: Uint8Array[] = []
    const tmp = new Uint8Array(8192)
    while (true) {
      let n: number | null
      try { n = await conn.read(tmp) } catch { break }
      if (n === null) break
      chunks.push(tmp.slice(0, n))
    }

    const total = chunks.reduce((a, b) => a + b.length, 0)
    const merged = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { merged.set(c, off); off += c.length }

    const { status, body } = parseHttpResponse(new TextDecoder().decode(merged))
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
      json: () => Promise.resolve(JSON.parse(body)),
    }
  } finally {
    try { conn.close() } catch { /* ignorado */ }
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
