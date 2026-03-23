import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

const INTER_BASE = 'https://cdpj.partners.bancointer.com.br'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS })

  try {
    const body = await req.json()
    const cpf = (body.cpf || '').replace(/\D/g, '')

    if (!cpf || cpf.length !== 11) {
      return new Response(JSON.stringify({ error: 'CPF inválido.' }), { status: 400, headers: CORS })
    }

    console.log('Sync boletos para CPF:', cpf)

    // 1. Autenticar na API do Inter via OAuth
    const clientId = Deno.env.get('INTER_CLIENT_ID')
    const clientSecret = Deno.env.get('INTER_CLIENT_SECRET')

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'Credenciais Inter não configuradas.' }), { status: 500, headers: CORS })
    }

    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'boleto-cobranca.read',
      grant_type: 'client_credentials',
    })

    // Tenta com mTLS se disponível, senão sem
    let fetchOpts: any = {}
    try {
      const cert = Deno.env.get('INTER_CERT')
      const key = Deno.env.get('INTER_KEY')
      if (cert && key) {
        fetchOpts.client = Deno.createHttpClient({ certChain: cert, privateKey: key })
        console.log('Usando mTLS')
      }
    } catch (e) {
      console.log('mTLS não disponível, usando fetch padrão')
    }

    console.log('Autenticando no Inter...')
    const tokenRes = await fetch(`${INTER_BASE}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
      ...fetchOpts,
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      console.error('Auth Inter falhou:', tokenRes.status, errText)
      return new Response(JSON.stringify({ error: 'Autenticação Inter falhou: ' + tokenRes.status, detail: errText }), { status: 502, headers: CORS })
    }

    const { access_token } = await tokenRes.json()
    console.log('Token obtido com sucesso')

    // 2. Buscar boletos dos últimos 12 meses
    const hoje = new Date()
    const inicio = new Date(hoje)
    inicio.setMonth(inicio.getMonth() - 12)
    const dataInicial = inicio.toISOString().split('T')[0]
    const dataFinal = hoje.toISOString().split('T')[0]

    const url = `${INTER_BASE}/cobranca/v3/cobrancas?cpfCnpj=${cpf}&dataInicial=${dataInicial}&dataFinal=${dataFinal}&itensPorPagina=100`
    console.log('Buscando boletos:', url)

    const boletosRes = await fetch(url, {
      headers: { Authorization: `Bearer ${access_token}` },
      ...fetchOpts,
    })

    if (!boletosRes.ok) {
      const errText = await boletosRes.text()
      console.error('Consulta boletos falhou:', boletosRes.status, errText)
      if (boletosRes.status === 404) {
        return new Response(JSON.stringify({ ok: true, sincronizados: 0, total: 0, msg: 'Nenhum boleto encontrado na API do Inter.' }), { headers: CORS })
      }
      return new Response(JSON.stringify({ error: 'Consulta Inter falhou: ' + boletosRes.status, detail: errText }), { status: 502, headers: CORS })
    }

    const data = await boletosRes.json()
    const cobrancas = data.cobrancas ?? data.content ?? data ?? []
    const lista = Array.isArray(cobrancas) ? cobrancas : []
    console.log('Inter retornou', lista.length, 'boleto(s)')

    // 3. Sincronizar com o banco
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const cpfFmt = cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
    let sincronizados = 0

    for (const bol of lista) {
      const nossoNumero = bol.nossoNumero || bol.codigoBarras || ''
      if (!nossoNumero) continue

      // Verifica se já existe
      const { data: existe } = await sb
        .from('boletos')
        .select('id, situacao')
        .eq('nosso_numero', nossoNumero)
        .maybeSingle()

      const situacao = bol.situacao || 'EMITIDO'

      if (existe) {
        // Atualiza situação se mudou
        if (existe.situacao !== situacao) {
          await sb.from('boletos').update({ situacao }).eq('id', existe.id)
        }
        continue
      }

      // Tenta baixar PDF
      let pdfUrl: string | null = null
      try {
        const pdfRes = await fetch(`${INTER_BASE}/cobranca/v3/cobrancas/${nossoNumero}/pdf`, {
          headers: { Authorization: `Bearer ${access_token}` },
          ...fetchOpts,
        })
        if (pdfRes.ok) {
          const pdfData = await pdfRes.json()
          if (pdfData.pdf) {
            const binary = atob(pdfData.pdf)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

            await sb.storage.createBucket('boletos', { public: true }).catch(() => {})
            const fileName = `${cpf}/${nossoNumero}.pdf`
            const { error: upErr } = await sb.storage
              .from('boletos')
              .upload(fileName, bytes, { contentType: 'application/pdf', upsert: true })
            if (!upErr) {
              const { data: urlData } = sb.storage.from('boletos').getPublicUrl(fileName)
              pdfUrl = urlData.publicUrl
            }
          }
        }
      } catch (e) {
        console.warn('PDF download falhou para', nossoNumero, e)
      }

      // Insere no banco
      const { error: dbErr } = await sb.from('boletos').insert({
        cpf: cpfFmt,
        nosso_numero: nossoNumero,
        valor: bol.valorNominal ?? bol.valor ?? 0,
        vencimento: bol.dataVencimento ?? null,
        linha_digitavel: bol.linhaDigitavel ?? '',
        situacao,
        pdf_url: pdfUrl,
      })

      if (!dbErr) sincronizados++
      else console.error('Insert falhou:', dbErr.message)
    }

    console.log('Sync concluído:', sincronizados, 'novos,', lista.length, 'total')
    return new Response(JSON.stringify({ ok: true, sincronizados, total: lista.length }), { headers: CORS })

  } catch (err) {
    console.error('Erro geral:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS })
  }
})
