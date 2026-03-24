import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const INTER_BASE = 'https://cdpj.partners.bancointer.com.br'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

function interHttpClient(): any {
  try {
    const cert = Deno.env.get('INTER_CERT')
    const key = Deno.env.get('INTER_KEY')
    if (cert && key) {
      return Deno.createHttpClient({ certChain: cert, privateKey: key })
    }
  } catch (e) {
    console.warn('mTLS client não disponível, usando fetch padrão:', e)
  }
  return undefined
}

async function interFetch(url: string, opts: any = {}): Promise<Response> {
  const client = interHttpClient()
  if (client) opts.client = client
  console.log(`interFetch -> ${opts.method || 'GET'} ${url.replace(INTER_BASE, '')} | relay: ${Deno.env.get('INTER_RELAY_URL') || 'none'}`)
  return fetch(url, opts)
}

async function getInterToken(): Promise<string> {
  const scopes = [
    'cobranca.boleto.read cobranca.boleto.pdf',
    'boleto-cobranca.read boleto-cobranca.write',
    'cobranca.read',
    'boleto-cobranca.read',
  ]

  const clientId = Deno.env.get('INTER_CLIENT_ID')!
  const clientSecret = Deno.env.get('INTER_CLIENT_SECRET')!

  for (const scope of scopes) {
    const res = await interFetch(`${INTER_BASE}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope, grant_type: 'client_credentials' }),
    })

    if (res.ok) {
      const data = await res.json()
      return data.access_token
    }
    await res.text() // consume body
  }

  throw new Error('Nenhum scope aceito pelo Inter.')
}

/** Extract the billing ID used for the PDF endpoint.
 *  Inter API v3 uses `codigoSolicitacao` as the primary identifier. */
function getBoletoId(bol: any): string | undefined {
  return bol.codigoSolicitacao || bol.nossoNumero || bol.codigoBarras || undefined
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS })

  try {
    const body = await req.json()
    const cpf = (body.cpf || '').replace(/\D/g, '')

    if (!cpf || cpf.length !== 11) {
      return new Response(JSON.stringify({ error: 'CPF inválido.' }), { status: 400, headers: CORS })
    }

    console.log('boletos-list: buscando para CPF:', cpf)

    const token = await getInterToken()

    // Busca boletos dos últimos 12 meses
    const hoje = new Date()
    const inicio = new Date(hoje)
    inicio.setMonth(inicio.getMonth() - 12)
    const dataInicial = inicio.toISOString().split('T')[0]
    const dataFinal = hoje.toISOString().split('T')[0]

    const url = `${INTER_BASE}/cobranca/v3/cobrancas?cpfCnpj=${cpf}&dataInicial=${dataInicial}&dataFinal=${dataFinal}&itensPorPagina=100`
    const boletosRes = await interFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!boletosRes.ok) {
      const errText = await boletosRes.text()
      console.error('Inter API error:', boletosRes.status, errText)
      if (boletosRes.status === 404) {
        return new Response(JSON.stringify({ ok: true, boletos: [] }), { headers: CORS })
      }
      return new Response(JSON.stringify({ error: 'Consulta Inter falhou: ' + boletosRes.status }), { status: 502, headers: CORS })
    }

    const resData = await boletosRes.json()
    const cobrancas = resData.cobrancas ?? resData.content ?? resData ?? []
    const lista = Array.isArray(cobrancas) ? cobrancas : []
    console.log(`Inter retornou ${lista.length} boleto(s)`)

    // Sincroniza com Supabase e monta lista de retorno
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const cpfFmt = cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
    const boletos: any[] = []

    for (const bol of lista) {
      const boletoId = getBoletoId(bol)
      if (!boletoId) {
        console.warn('Boleto sem ID válido, pulando:', JSON.stringify(bol).slice(0, 200))
        continue
      }

      const nossoNumero = bol.nossoNumero || boletoId
      const situacao = bol.situacao || 'EMITIDO'

      // Verifica se já existe
      const { data: existe } = await sb.from('boletos').select('id, situacao, pdf_url').eq('nosso_numero', nossoNumero).maybeSingle()

      if (existe) {
        if (existe.situacao !== situacao) {
          await sb.from('boletos').update({ situacao }).eq('id', existe.id)
        }
        boletos.push({ ...bol, pdf_url: existe.pdf_url, situacao })
        continue
      }

      // Tenta baixar PDF usando o ID correto
      let pdfUrl: string | null = null
      try {
        const pdfRes = await interFetch(`${INTER_BASE}/cobranca/v3/cobrancas/${boletoId}/pdf`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (pdfRes.ok) {
          const pdfData = await pdfRes.json()
          if (pdfData.pdf) {
            const binary = atob(pdfData.pdf)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            await sb.storage.createBucket('boletos', { public: true }).catch(() => {})
            const fileName = `${cpf}/${nossoNumero}.pdf`
            const { error: upErr } = await sb.storage.from('boletos').upload(fileName, bytes, { contentType: 'application/pdf', upsert: true })
            if (!upErr) {
              const { data: urlData } = sb.storage.from('boletos').getPublicUrl(fileName)
              pdfUrl = urlData.publicUrl
            }
          }
        } else {
          console.warn(`PDF fetch falhou para ${boletoId}:`, pdfRes.status)
        }
      } catch (e) {
        console.warn('PDF falhou:', boletoId, e)
      }

      // Insere no banco
      const { error: dbErr } = await sb.from('boletos').insert({
        cpf: cpfFmt, nosso_numero: nossoNumero,
        valor: bol.valorNominal ?? bol.valor ?? 0,
        vencimento: bol.dataVencimento ?? null,
        linha_digitavel: bol.linhaDigitavel ?? '',
        situacao, pdf_url: pdfUrl,
      })
      if (dbErr) console.error('Insert falhou:', dbErr.message)

      boletos.push({ ...bol, pdf_url: pdfUrl })
    }

    console.log(`boletos-list: ${boletos.length} boletos processados`)
    return new Response(JSON.stringify({ ok: true, boletos }), { headers: CORS })

  } catch (err) {
    console.error('Erro geral boletos-list:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS })
  }
})
