import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const INTER_BASE = 'https://cdpj.partners.bancointer.com.br'

function interHttpClient() {
  return Deno.createHttpClient({
    certChain: Deno.env.get('INTER_CERT')!,
    privateKey: Deno.env.get('INTER_KEY')!,
  })
}

async function getInterToken(): Promise<string> {
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

  if (!res.ok) throw new Error(`Inter auth falhou: ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

async function getBoletoPdf(token: string, nossoNumero: string): Promise<Uint8Array> {
  const client = interHttpClient()
  const res = await fetch(`${INTER_BASE}/cobranca/v3/cobrancas/${nossoNumero}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
    client,
  })

  if (!res.ok) throw new Error(`PDF boleto falhou: ${res.status} ${await res.text()}`)

  const data = await res.json()
  // Inter retorna PDF em base64
  const base64 = data.pdf
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 })

  try {
    const payload = await req.json()

    // ── SYNC: busca boletos na API do Inter e sincroniza com o banco ──
    if (payload.action === 'sync_boletos') {
      const cpf = (payload.cpf || '').replace(/\D/g, '')
      if (!cpf || cpf.length !== 11) {
        return new Response(JSON.stringify({ error: 'CPF inválido.' }), { status: 400, headers: CORS })
      }

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      const token = await getInterToken()
      const client = interHttpClient()

      // Busca boletos dos últimos 12 meses
      const hoje = new Date()
      const inicio = new Date(hoje)
      inicio.setMonth(inicio.getMonth() - 12)
      const dataInicial = inicio.toISOString().split('T')[0]
      const dataFinal = hoje.toISOString().split('T')[0]

      const url = `${INTER_BASE}/cobranca/v3/cobrancas?cpfCnpj=${cpf}&dataInicial=${dataInicial}&dataFinal=${dataFinal}&itensPorPagina=100`
      console.log('Sync boletos URL:', url)

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        client,
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error('Inter API error:', res.status, errText)
        // Se 404 ou sem boletos, retorna lista vazia
        if (res.status === 404) {
          return new Response(JSON.stringify({ ok: true, sincronizados: 0 }), { headers: CORS })
        }
        return new Response(JSON.stringify({ error: 'Erro ao consultar Inter: ' + res.status }), { status: 500, headers: CORS })
      }

      const data = await res.json()
      const cobrancas = data.cobrancas ?? data.content ?? []
      console.log(`Inter retornou ${cobrancas.length} boleto(s)`)

      let sincronizados = 0
      const cpfFormatado = cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

      for (const bol of cobrancas) {
        const nossoNumero = bol.nossoNumero || bol.codigoBarras || ''
        if (!nossoNumero) continue

        // Verifica se já existe no banco
        const { data: existe } = await supabase
          .from('boletos')
          .select('id')
          .eq('nosso_numero', nossoNumero)
          .maybeSingle()

        if (existe) {
          // Atualiza situação se mudou
          const novaSituacao = bol.situacao || 'EMITIDO'
          await supabase.from('boletos')
            .update({ situacao: novaSituacao })
            .eq('nosso_numero', nossoNumero)
          continue
        }

        // Boleto novo — tenta baixar PDF
        let pdfUrl: string | null = null
        try {
          const pdfBytes = await getBoletoPdf(token, nossoNumero)
          const fileName = `${cpf}/${nossoNumero}.pdf`
          await supabase.storage.createBucket('boletos', { public: true }).catch(() => {})
          const { error: upErr } = await supabase.storage
            .from('boletos')
            .upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })
          if (!upErr) {
            const { data: urlData } = supabase.storage.from('boletos').getPublicUrl(fileName)
            pdfUrl = urlData.publicUrl
          }
        } catch (e) {
          console.error('PDF download falhou para', nossoNumero, e)
        }

        // Insere no banco
        const { error: dbErr } = await supabase.from('boletos').insert({
          cpf: cpfFormatado,
          nosso_numero: nossoNumero,
          valor: bol.valorNominal ?? bol.valor ?? 0,
          vencimento: bol.dataVencimento ?? null,
          linha_digitavel: bol.linhaDigitavel ?? '',
          situacao: bol.situacao || 'EMITIDO',
          pdf_url: pdfUrl,
        })

        if (!dbErr) sincronizados++
        else console.error('Insert boleto falhou:', dbErr.message)
      }

      console.log(`Sync concluído: ${sincronizados} novos boletos inseridos`)
      return new Response(JSON.stringify({ ok: true, sincronizados, total: cobrancas.length }), { headers: CORS })
    }

    // ── WEBHOOK: recebe eventos do banco Inter ──
    console.log('Webhook Inter recebido:', JSON.stringify(payload))

    const situacao = payload.situacao ?? payload.evento
    if (situacao !== 'EMITIDO') {
      return new Response(JSON.stringify({ ok: true, msg: `Situação ${situacao} ignorada` }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const nossoNumero: string = payload.nossoNumero
    const cpf: string = payload.pagador?.cpfCnpj?.replace(/\D/g, '')
    const valor: number = payload.valorNominal ?? payload.valor
    const vencimento: string = payload.dataVencimento
    const linhaDigitavel: string = payload.linhaDigitavel ?? ''

    if (!nossoNumero || !cpf) {
      return new Response(JSON.stringify({ error: 'nossoNumero ou CPF ausente' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Busca PDF no Inter
    const token = await getInterToken()
    const pdfBytes = await getBoletoPdf(token, nossoNumero)

    // Faz upload do PDF no Storage
    const fileName = `${cpf}/${nossoNumero}.pdf`
    const { error: uploadError } = await supabase.storage
      .from('boletos')
      .upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })

    if (uploadError) throw new Error(`Upload PDF falhou: ${uploadError.message}`)

    const { data: urlData } = supabase.storage.from('boletos').getPublicUrl(fileName)
    const pdfUrl = urlData.publicUrl

    // Formata CPF para o padrão do banco: 123.456.789-00
    const cpfFormatado = cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

    // Salva boleto na tabela
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
