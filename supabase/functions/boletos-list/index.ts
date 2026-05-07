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

  const fullUrl = `${relayUrl}/inter-proxy`
  console.log('interFetch ->', init.method ?? 'GET', path, '| relay:', fullUrl)
  const res = await fetch(fullUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${relaySecret}` },
    body: JSON.stringify({ path, method: init.method ?? 'GET', headers: init.headers ?? {}, body: bodyStr }),
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Relay retornou ${res.status}: ${text.slice(0, 200)}`)
  }
  const { status, body } = await res.json() as { status: number; body: string }
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  }
}

async function getInterToken(): Promise<string> {
  const clientId = Deno.env.get('INTER_CLIENT_ID')!
  const clientSecret = Deno.env.get('INTER_CLIENT_SECRET')!

  // Tenta múltiplos scopes (API do Inter varia o scope aceito)
  const scopes = [
    'boleto-cobranca.read',
    'cobranca.boleto.read cobranca.boleto.pdf',
    'boleto-cobranca.read boleto-cobranca.write',
    'cobranca.read',
  ]

  for (const scope of scopes) {
    console.log('Tentando scope:', scope)
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope, grant_type: 'client_credentials' })
    const res = await interFetch('/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const text = await res.text()
    console.log('Inter OAuth status:', res.status, '| scope:', scope, '| body:', text.slice(0, 200))
    if (res.ok) {
      console.log('Scope aceito:', scope)
      return (JSON.parse(text) as { access_token: string }).access_token
    }
  }

  throw new Error('Nenhum scope aceito pelo Inter. Verifique client_id/client_secret e permissões do app no portal do Inter.')
}

async function listarCobrancasInter(token: string, cpf: string): Promise<any[]> {
  const hoje = new Date()
  const dataFinal = hoje.toISOString().slice(0, 10)
  const dataInicial = new Date(hoje.setFullYear(hoje.getFullYear() - 1))
    .toISOString()
    .slice(0, 10)

  // Tenta com x-conta-corrente se disponível
  const conta = Deno.env.get('INTER_CONTA')
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (conta) headers['x-conta-corrente'] = conta

  // Tenta diferentes formatos de query (API Inter v3)
  const queryVariants = [
    `cpfCnpjPagador=${cpf}&dataInicial=${dataInicial}&dataFinal=${dataFinal}&filtrarPor=VENCIMENTO&itensPorPagina=50&paginaAtual=0`,
    `cpfCnpj=${cpf}&dataInicial=${dataInicial}&dataFinal=${dataFinal}&itensPorPagina=100`,
  ]

  let res: Awaited<ReturnType<typeof interFetch>> | null = null
  let lastText = ''
  for (const q of queryVariants) {
    console.log('Tentando query:', `/cobranca/v3/cobrancas?${q}`)
    const attempt = await interFetch(`/cobranca/v3/cobrancas?${q}`, { headers })
    lastText = await attempt.text()
    console.log('Inter response status:', attempt.status, '| body:', lastText.slice(0, 500))
    if (attempt.ok) { res = { ...attempt, text: () => Promise.resolve(lastText), json: () => Promise.resolve(JSON.parse(lastText)) }; break }
    console.log('Query falhou:', attempt.status, lastText.slice(0, 200))
  }
  if (!res) res = { ok: false, status: 400, text: () => Promise.resolve(lastText), json: () => Promise.resolve({}) }

  const text = await res.text()
  if (!res.ok) throw new Error(`Inter listagem falhou: ${res.status} | ${text}`)

  const data = JSON.parse(text) as { content?: any[]; cobrancas?: any[] }
  return data.content ?? data.cobrancas ?? []
}

async function getBoletoPdf(token: string, codigoSolicitacao: string): Promise<Uint8Array | null> {
  try {
    const res = await interFetch(`/cobranca/v3/cobrancas/${codigoSolicitacao}/pdf`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-conta-corrente': Deno.env.get('INTER_CONTA')!,
      },
    })
    if (!res.ok) return null
    const data = await res.json() as { pdf: string }
    const binary = atob(data.pdf)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

import { getCorsHeaders } from '../_shared/cors.ts'
import { checkRateLimit, getClientIP } from '../_shared/ratelimit.ts'
import { captureException } from '../_shared/sentry.ts'

let corsHeaders: Record<string, string> = getCorsHeaders()

Deno.serve(async (req) => {
  corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405, headers: corsHeaders })

  try {
    // Rate limiting
    const ip = getClientIP(req)
    const rl = checkRateLimit(ip, 'api')
    if (!rl.allowed) return new Response(JSON.stringify({ error: `Tente novamente em ${rl.retryAfterSeconds}s.` }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

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
        .eq('email', email)
        .maybeSingle()
      if (sol?.cpf) cpfRaw = sol.cpf.replace(/\D/g, '')
    }

    if (!cpfRaw || cpfRaw.length !== 11) {
      return new Response(JSON.stringify({ boletos: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const cpfFormatado = cpfRaw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

    // Sincroniza com Inter e salva novos boletos no Supabase
    let cobrancas: any[] = []
    let insertErrors: string[] = []
    try {
      const token = await getInterToken()
      cobrancas = await listarCobrancasInter(token, cpfRaw)

      console.log('Total cobrancas retornadas:', cobrancas.length)
      if (cobrancas.length > 0) console.log('Estrutura cobranca[0]:', JSON.stringify(cobrancas[0]))

      // Log pagador para entender estrutura do CPF
      if (cobrancas.length > 0) {
        const sample = cobrancas[0].cobranca ?? cobrancas[0]
        console.log('Pagador sample:', JSON.stringify(sample.pagador ?? {}).slice(0, 300))
        console.log('Keys cobranca:', Object.keys(sample).join(','))
      }

      const insertErrors: string[] = []
      for (const raw of cobrancas) {
        // API Inter v3 retorna { cobranca: {...}, boleto: {...}, pix: {...} }
        const cob = raw.cobranca ?? raw
        const bol = raw.boleto ?? {}

        // Filtra apenas boletos do CPF solicitado
        const pagadorCpf = (cob.pagador?.cpfCnpj ?? cob.cpfCnpjBeneficiario ?? '').replace(/\D/g, '')
        if (pagadorCpf && pagadorCpf !== cpfRaw) continue

        const nossoNumero: string = cob.nossoNumero ?? bol.nossoNumero ?? cob.seuNumero ?? ''
        const codigoSolicitacao: string = cob.codigoSolicitacao ?? ''
        const situacao: string = cob.situacao ?? 'EMITIDO'
        const valor: number = cob.valorNominal ?? cob.valor ?? 0
        const vencimento: string = cob.dataVencimento ?? ''
        const linhaDigitavel: string = bol.linhaDigitavel ?? cob.linhaDigitavel ?? ''

        if (!nossoNumero) { insertErrors.push('sem nossoNumero: keys=' + JSON.stringify(Object.keys(cob)).slice(0, 200)); continue }

        const { data: existing } = await supabase
          .from('boletos')
          .select('id, pdf_url, situacao')
          .eq('nosso_numero', nossoNumero)
          .maybeSingle()

        let pdfUrl = existing?.pdf_url ?? null
        let pdfPath: string | null = (existing as any)?.pdf_path ?? null

        if (!pdfUrl && codigoSolicitacao) {
          try {
            const pdfBytes = await getBoletoPdf(token, codigoSolicitacao)
            if (pdfBytes) {
              const fileName = `${cpfRaw}/${nossoNumero}.pdf`
              const { error: uploadError } = await supabase.storage
                .from('boletos')
                .upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })
              if (!uploadError) {
                const { data: signed } = await supabase.storage.from('boletos').createSignedUrl(fileName, 60 * 60 * 24 * 30)
                pdfUrl = signed?.signedUrl ?? null
                pdfPath = fileName
              }
            }
          } catch { /* PDF download optional */ }
        }

        if (existing) {
          if (existing.situacao !== situacao || (!existing.pdf_url && pdfUrl)) {
            const { error: updErr } = await supabase
              .from('boletos')
              .update({ situacao, pdf_url: pdfUrl ?? existing.pdf_url, pdf_path: pdfPath ?? (existing as any).pdf_path })
              .eq('nosso_numero', nossoNumero)
            if (updErr) insertErrors.push(`update ${nossoNumero}: ${updErr.message}`)
          }
        } else {
          // Resolve escola via familia.cpf (Banco Inter integration hoje é single-tenant Maple)
          const { data: fam } = await supabase.from('familias').select('escola_id').eq('cpf', cpfFormatado).maybeSingle()
          if (!fam?.escola_id) {
            insertErrors.push(`skip ${nossoNumero}: CPF ${cpfFormatado} sem família/escola cadastrada`)
            continue
          }
          const { error: insErr } = await supabase.from('boletos').insert({
            cpf: cpfFormatado,
            nosso_numero: nossoNumero,
            valor,
            vencimento,
            linha_digitavel: linhaDigitavel,
            situacao,
            pdf_url: pdfUrl,
            pdf_path: pdfPath,
            escola_id: fam.escola_id,
          })
          if (insErr) insertErrors.push(`insert ${nossoNumero}: ${insErr.message}`)
        }
      }
      console.log('Insert errors:', insertErrors)
    } catch (syncErr) {
      console.error('Sync Inter falhou (retornando cache):', syncErr)
      // Retorna erro de sync para diagnóstico
      const { data: cached } = await supabase
        .from('boletos')
        .select('id, cpf, nosso_numero, valor, vencimento, linha_digitavel, situacao, pdf_url, criado_em')
        .in('cpf', [cpfFormatado, cpfRaw])
        .order('vencimento', { ascending: false })
      return new Response(JSON.stringify({ boletos: cached ?? [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: boletos, error: dbError } = await supabase
      .from('boletos')
      .select('*')
      .in('cpf', [cpfFormatado, cpfRaw])
      .order('vencimento', { ascending: false })

    if (dbError) throw new Error(dbError.message)

    return new Response(JSON.stringify({ boletos: boletos ?? [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Erro em boletos-list:', err)
    captureException(err instanceof Error ? err : new Error(String(err)), { function: 'boletos-list' }).catch(() => {})
    return new Response(JSON.stringify({ error: 'Erro interno do servidor.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
