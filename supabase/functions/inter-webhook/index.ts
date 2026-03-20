import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const INTER_BASE = 'https://cdpj.partners.bancointer.com.br'
const RESEND_URL = 'https://api.resend.com/emails'

// Cliente HTTP com mTLS (certificado + chave do Inter)
function interHttpClient() {
  return Deno.createHttpClient({
    certChain: Deno.env.get('INTER_CERT')!,
    privateKey: Deno.env.get('INTER_KEY')!,
  })
}

// Busca token OAuth2 do Inter
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

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Inter auth falhou: ${res.status} ${err}`)
  }

  const data = await res.json()
  return data.access_token
}

// Busca PDF do boleto em base64
async function getBoletoPdf(token: string, nossoNumero: string): Promise<string> {
  const client = interHttpClient()
  const res = await fetch(`${INTER_BASE}/cobranca/v3/boletos/${nossoNumero}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
    client,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`PDF boleto falhou: ${res.status} ${err}`)
  }

  const data = await res.json()
  return data.pdf // base64
}

// Envia e-mail com boleto via Resend
async function enviarEmail(para: string, nome: string, boleto: {
  nossoNumero: string
  valor: number
  vencimento: string
  linhaDigitavel: string
  pdfBase64: string
}) {
  const valorFormatado = boleto.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const vencFormatado = boleto.vencimento.split('-').reverse().join('/')

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Maple Bear <noreply@maplebearcaxiasdosul.com.br>',
      to: [para],
      subject: `Boleto Maple Bear — ${valorFormatado} — Venc. ${vencFormatado}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:auto">
          <img src="https://raw.githubusercontent.com/ivyson-wq/Escolha-de-turno/main/Design%20sem%20nome.png" width="80" style="margin-bottom:16px"/>
          <h2 style="color:#C8102E">Olá, ${nome}!</h2>
          <p>Seu boleto Maple Bear está disponível.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Valor</td><td style="padding:8px">${valorFormatado}</td></tr>
            <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Vencimento</td><td style="padding:8px">${vencFormatado}</td></tr>
            <tr><td style="padding:8px;background:#f5f5f5;font-weight:bold">Linha Digitável</td><td style="padding:8px;font-family:monospace;font-size:13px">${boleto.linhaDigitavel}</td></tr>
          </table>
          <p style="font-size:12px;color:#888">O boleto em PDF está anexo a este e-mail.</p>
        </div>
      `,
      attachments: [
        {
          filename: `boleto-maple-bear-${boleto.nossoNumero}.pdf`,
          content: boleto.pdfBase64,
        },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Resend falhou: ${res.status} ${err}`)
  }
}

Deno.serve(async (req) => {
  // Supabase precisa de OPTIONS para CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }

  if (req.method !== 'POST') {
    return new Response('Método não permitido', { status: 405 })
  }

  try {
    const payload = await req.json()
    console.log('Webhook Inter recebido:', JSON.stringify(payload))

    // Inter envia a situação do boleto — só processa quando EMITIDO
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

    // Busca família pelo CPF no Supabase
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Formata CPF para o padrão do banco: 123.456.789-00
    const cpfFormatado = cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

    const { data: familia, error: dbErr } = await supabase
      .from('familias')
      .select('email, nome_responsavel')
      .eq('cpf', cpfFormatado)
      .single()

    if (dbErr || !familia) {
      console.error('Família não encontrada para CPF:', cpf, dbErr)
      return new Response(JSON.stringify({ error: 'Família não encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Busca token e PDF no Inter
    const token = await getInterToken()
    const pdfBase64 = await getBoletoPdf(token, nossoNumero)

    // Envia e-mail
    await enviarEmail(familia.email, familia.nome_responsavel, {
      nossoNumero,
      valor,
      vencimento,
      linhaDigitavel,
      pdfBase64,
    })

    console.log(`Boleto ${nossoNumero} enviado para ${familia.email}`)

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
