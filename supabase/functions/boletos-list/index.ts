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

  const client = interHttpClient()
  const body = new URLSearchParams({
    client_id: Deno.env.get('INTER_CLIENT_ID')!,
    client_secret: Deno.env.get('INTER_CLIENT_SECRET')!,
    scope: 'boleto-cobranca.read',
    grant_type: 'client_credentials',
  })

  const res = await fetch(`${INTER_BASE}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
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

async function getBoletoPdf(token: string, nossoNumero: string): Promise<Uint8Array | null> {
  try {
    const client = interHttpClient()
    const res = await fetch(`${INTER_BASE}/cobranca/v3/cobrancas/${nossoNumero}/pdf`, {
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
        const situacao: string = c.situacao ?? 'EMITIDO'
        const valor: number = c.valorNominal ?? c.valor
        const vencimento: string = c.dataVencimento
        const linhaDigitavel: string = c.linhaDigitavel ?? ''

        // Verifica se já existe para decidir entre insert ou update de situação
        const { data: existing } = await supabase
          .from('boletos')
          .select('id, pdf_url')
          .eq('nosso_numero', nossoNumero)
          .maybeSingle()

        let pdfUrl = existing?.pdf_url ?? null

        // Busca PDF apenas se ainda não tiver
        if (!pdfUrl) {
          const pdfBytes = await getBoletoPdf(token, nossoNumero)
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
