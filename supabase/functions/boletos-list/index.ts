import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const INTER_BASE = 'https://cdpj.partners.bancointer.com.br'

function parsePem(raw: string): string {
  const pem = raw.replace(/\\n/g, '\n').trim()
  const headerMatch = pem.match(/-----BEGIN ([^-]+)-----/)
  const footerMatch = pem.match(/-----END ([^-]+)-----/)
  if (!headerMatch || !footerMatch) return pem
  const header = `-----BEGIN ${headerMatch[1]}-----`
  const footer = `-----END ${footerMatch[1]}-----`
  // Extrai só o base64, remove tudo que não é base64
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/[\s]/g, '')
  // Quebra em linhas de 64 chars conforme padrão PEM
  const lines = b64.match(/.{1,64}/g) ?? []
  return [header, ...lines, footer].join('\n')
}

function interHttpClient() {
  return Deno.createHttpClient({
    certChain: parsePem(Deno.env.get('INTER_CERT')!),
    privateKey: parsePem(Deno.env.get('INTER_KEY')!),
  })
}

async function getInterToken(): Promise<string> {
  const certRaw = Deno.env.get('INTER_CERT') ?? ''
  const keyRaw = Deno.env.get('INTER_KEY') ?? ''
  const clientId = Deno.env.get('INTER_CLIENT_ID') ?? ''
  console.log('CLIENT_ID (primeiros 8 chars):', clientId.slice(0, 8))
  console.log('CLIENT_SECRET presente:', !!Deno.env.get('INTER_CLIENT_SECRET'))
  console.log('CERT OU esperado:       dd093e1b')
  console.log('CERT header:', certRaw.replace(/\\n/g, '\n').split('\n')[0])

  // Diagnóstico da chave privada
  const parsedKey = parsePem(keyRaw)
  const keyLines = parsedKey.split('\n')
  console.log('KEY presente:', keyRaw.length > 0)
  console.log('KEY header:', keyLines[0] ?? '(ausente)')
  console.log('KEY footer:', keyLines[keyLines.length - 1] ?? '(ausente)')
  console.log('KEY base64 length:', keyLines.slice(1, -1).join('').length)

  // Verifica correspondência chave/certificado
  try {
    // Parseia DER do certificado para extrair SubjectPublicKeyInfo (SPKI)
    function readTLV(buf: Uint8Array, off: number) {
      const tag = buf[off++]
      let len = buf[off++]
      if (len & 0x80) { const nb = len & 0x7f; len = 0; for (let i = 0; i < nb; i++) len = (len << 8) | buf[off++] }
      return { tag, len, vs: off, end: off + len }
    }
    const parsedCert = parsePem(certRaw)
    const certB64 = parsedCert.split('\n').slice(1, -1).join('')
    const certDer = Uint8Array.from(atob(certB64), c => c.charCodeAt(0))
    // Navega: outer SEQUENCE → TBSCert SEQUENCE → skip version/serial/sig/issuer/validity/subject → SPKI
    const outer = readTLV(certDer, 0)
    const tbs = readTLV(certDer, outer.vs)
    let p = tbs.vs
    if (certDer[p] === 0xa0) { const v = readTLV(certDer, p); p = v.end }
    for (let i = 0; i < 5; i++) { const t = readTLV(certDer, p); p = t.end } // serial, sig, issuer, validity, subject
    const spkiTLV = readTLV(certDer, p)
    const spkiBytes = certDer.slice(p, spkiTLV.end)

    // Importa chave privada (extractable) e chave pública do cert
    const keyB64 = keyLines.slice(1, -1).join('')
    const keyDer = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0))
    const algo = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
    const privKey = await crypto.subtle.importKey('pkcs8', keyDer, algo, true, ['sign'])
    const pubKeyFromCert = await crypto.subtle.importKey('spki', spkiBytes, algo, true, ['verify'])
    console.log('KEY crypto import: OK (PKCS8/RSA)')

    // Exporta módulos como JWK e compara
    const privJwk = await crypto.subtle.exportKey('jwk', privKey)
    const certJwk = await crypto.subtle.exportKey('jwk', pubKeyFromCert)
    const nKey = (privJwk as any).n ?? ''
    const nCert = (certJwk as any).n ?? ''
    console.log('KEY modulus (primeiros 20):', nKey.slice(0, 20))
    console.log('CERT modulus (primeiros 20):', nCert.slice(0, 20))
    console.log('KEY/CERT correspondem:', nKey === nCert)
  } catch (e1) {
    console.log('KEY crypto import: FALHOU -', String(e1).slice(0, 120))
  }

  // Diagnóstico do client_secret
  const secret = Deno.env.get('INTER_CLIENT_SECRET') ?? ''
  console.log('CLIENT_SECRET length:', secret.length)
  console.log('CLIENT_SECRET primeiros 4 chars:', secret.slice(0, 4))

  // Cria o cliente mTLS e verifica se não joga exceção
  let client: Deno.HttpClient
  try {
    client = interHttpClient()
    console.log('mTLS HttpClient: criado com sucesso')
  } catch (clientErr) {
    console.log('mTLS HttpClient: ERRO ao criar -', String(clientErr))
    throw clientErr
  }

  const oauthBody = new URLSearchParams({
    client_id: Deno.env.get('INTER_CLIENT_ID')!,
    client_secret: secret,
    scope: 'boleto-cobranca.read',
    grant_type: 'client_credentials',
  })

  // Teste sem mTLS para comparar o erro (diagnóstico)
  try {
    const resNoTls = await fetch(`${INTER_BASE}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(oauthBody),
    })
    console.log('Sem-mTLS status:', resNoTls.status, '| body:', (await resNoTls.text()).slice(0, 100))
  } catch (noTlsErr) {
    console.log('Sem-mTLS erro (esperado se Inter exige cert):', String(noTlsErr).slice(0, 100))
  }

  const res = await fetch(`${INTER_BASE}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: oauthBody,
    client,
  })

  const resText = await res.text()
  console.log('Inter OAuth status:', res.status)
  console.log('Inter OAuth headers:', JSON.stringify(Object.fromEntries(res.headers)))
  console.log('Inter OAuth body:', resText || '(vazio)')
  if (!res.ok) throw new Error(`Inter auth falhou: ${res.status} | ${resText}`)
  return JSON.parse(resText).access_token
}

async function listarCobrancasInter(token: string, cpf: string): Promise<any[]> {
  const client = interHttpClient()

  // Inter exige intervalo de datas — buscamos últimos 12 meses
  const hoje = new Date()
  const dataFinal = hoje.toISOString().slice(0, 10)
  const dataInicial = new Date(hoje.setFullYear(hoje.getFullYear() - 1))
    .toISOString()
    .slice(0, 10)

  const params = new URLSearchParams({
    dataInicial,
    dataFinal,
    filtrarPor: 'VENCIMENTO',
    cpfCnpjPagador: cpf,
    itensPorPagina: '50',
    paginaAtual: '0',
  })

  const res = await fetch(`${INTER_BASE}/cobranca/v3/cobrancas?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    client,
  })

  if (!res.ok) throw new Error(`Inter listagem falhou: ${res.status} ${await res.text()}`)

  const data = await res.json()
  return data.content ?? data.cobrancas ?? []
}

async function getBoletoPdf(token: string, codigoSolicitacao: string): Promise<Uint8Array | null> {
  try {
    const client = interHttpClient()
    const res = await fetch(`${INTER_BASE}/cobranca/v3/cobrancas/${codigoSolicitacao}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
      client,
    })
    if (!res.ok) return null
    const data = await res.json()
    const binary = atob(data.pdf)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 })

  try {
    const body = await req.json()
    const email: string | undefined = body.email
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Aceita CPF direto no payload ou busca pelo e-mail em solicitacoes_acesso
    let cpfRaw: string | undefined

    if (body.cpf) {
      cpfRaw = String(body.cpf).replace(/\D/g, '')
    } else if (email) {
      const { data: sol } = await supabase
        .from('solicitacoes_acesso')
        .select('cpf')
        .ilike('email', email)
        .maybeSingle()
      if (sol?.cpf) cpfRaw = sol.cpf.replace(/\D/g, '')
    }

    if (!cpfRaw || cpfRaw.length !== 11) {
      return new Response(JSON.stringify({ boletos: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const cpfFormatado = cpfRaw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

    // Sincroniza com Inter e salva novos boletos no Supabase
    try {
      const token = await getInterToken()
      const cobrancas = await listarCobrancasInter(token, cpfRaw)

      for (const c of cobrancas) {
        const nossoNumero: string = c.nossoNumero
        const codigoSolicitacao: string = c.codigoSolicitacao
        const situacao: string = c.situacao ?? 'EMITIDO'
        const valor: number = c.valorNominal ?? c.valor
        const vencimento: string = c.dataVencimento
        const linhaDigitavel: string = c.linhaDigitavel ?? ''

        // Verifica se já existe para decidir entre insert ou update de situação
        const { data: existing } = await supabase
          .from('boletos')
          .select('id, pdf_url, situacao')
          .eq('nosso_numero', nossoNumero)
          .maybeSingle()

        let pdfUrl = existing?.pdf_url ?? null

        // Busca PDF apenas se ainda não tiver
        if (!pdfUrl) {
          const pdfBytes = await getBoletoPdf(token, codigoSolicitacao)
          if (pdfBytes) {
            const fileName = `${cpfRaw}/${nossoNumero}.pdf`
            const { error: uploadError } = await supabase.storage
              .from('boletos')
              .upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })
            if (!uploadError) {
              const { data: urlData } = supabase.storage.from('boletos').getPublicUrl(fileName)
              pdfUrl = urlData.publicUrl
            }
          }
        }

        if (existing) {
          // Atualiza só a situação se mudou
          if (existing.situacao !== situacao || (!existing.pdf_url && pdfUrl)) {
            await supabase
              .from('boletos')
              .update({ situacao, pdf_url: pdfUrl ?? existing.pdf_url })
              .eq('nosso_numero', nossoNumero)
          }
        } else {
          await supabase.from('boletos').insert({
            cpf: cpfFormatado,
            nosso_numero: nossoNumero,
            valor,
            vencimento,
            linha_digitavel: linhaDigitavel,
            situacao,
            pdf_url: pdfUrl,
          })
        }
      }
    } catch (syncErr) {
      // Falha na sincronização com Inter não bloqueia — retorna o que há no banco
      console.error('Sync Inter falhou (retornando cache):', syncErr)
    }

    // Retorna boletos do banco (já sincronizados ou cache)
    const { data: boletos, error: dbError } = await supabase
      .from('boletos')
      .select('*')
      .or(`cpf.eq.${cpfFormatado},cpf.eq.${cpfRaw}`)
      .order('vencimento', { ascending: false })

    if (dbError) throw new Error(dbError.message)

    return new Response(JSON.stringify({ boletos: boletos ?? [] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Erro em boletos-list:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
