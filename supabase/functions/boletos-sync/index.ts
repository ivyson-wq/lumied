import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { captureException } from '../_shared/sentry.ts'

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

    const clientId = Deno.env.get('INTER_CLIENT_ID')
    const clientSecret = Deno.env.get('INTER_CLIENT_SECRET')

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'Credenciais Inter não configuradas.' }), { status: 500, headers: CORS })
    }

    // ── OAuth: tenta múltiplos scopes ──
    const scopes = [
      'cobranca.boleto.read cobranca.boleto.pdf',
      'boleto-cobranca.read boleto-cobranca.write',
      'cobranca.read',
      'boleto-cobranca.read',
    ]

    let accessToken = ''
    let scopeUsado = ''

    for (const scope of scopes) {
      console.log('Tentando scope:', scope)

      const fetchOpts: any = {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope, grant_type: 'client_credentials' }),
        signal: AbortSignal.timeout(15000),
      }
      const res = await fetch(`${INTER_BASE}/oauth/v2/token`, fetchOpts)

      if (res.ok) {
        const data = await res.json()
        accessToken = data.access_token
        scopeUsado = scope
        console.log('Scope aceito:', scope)
        break
      }

      const errText = await res.text()
      console.log('Scope rejeitado:', scope, res.status, errText)
    }

    if (!accessToken) {
      return new Response(JSON.stringify({
        error: 'Nenhum scope aceito pelo Inter.',
        scopes_tentados: scopes,
      }), { status: 502, headers: CORS })
    }

    // ── Buscar boletos (últimos 12 meses) ──
    const hoje = new Date()
    const inicio = new Date(hoje)
    inicio.setMonth(inicio.getMonth() - 12)
    const dataInicial = inicio.toISOString().split('T')[0]
    const dataFinal = hoje.toISOString().split('T')[0]

    const url = `${INTER_BASE}/cobranca/v3/cobrancas?cpfCnpj=${cpf}&dataInicial=${dataInicial}&dataFinal=${dataFinal}&itensPorPagina=100`
    console.log('Buscando boletos:', url)

    const boletosRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) })

    if (!boletosRes.ok) {
      const errText = await boletosRes.text()
      console.error('Consulta boletos falhou:', boletosRes.status, errText)
      if (boletosRes.status === 404) {
        return new Response(JSON.stringify({ ok: true, sincronizados: 0, total: 0 }), { headers: CORS })
      }
      return new Response(JSON.stringify({ error: 'Consulta Inter falhou: ' + boletosRes.status, detail: errText }), { status: 502, headers: CORS })
    }

    const resData = await boletosRes.json()
    const cobrancas = resData.cobrancas ?? resData.content ?? resData ?? []
    const lista = Array.isArray(cobrancas) ? cobrancas : []
    console.log('Inter retornou', lista.length, 'boleto(s)')

    // ── Sincronizar com Supabase ──
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const cpfFmt = cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
    let sincronizados = 0

    for (const bol of lista) {
      const boletoId = bol.codigoSolicitacao || bol.nossoNumero || bol.codigoBarras || ''
      if (!boletoId) continue
      const nossoNumero = bol.nossoNumero || boletoId

      const { data: existe } = await sb.from('boletos').select('id, situacao').eq('nosso_numero', nossoNumero).maybeSingle()
      const situacao = bol.situacao || 'EMITIDO'

      if (existe) {
        if (existe.situacao !== situacao) await sb.from('boletos').update({ situacao }).eq('id', existe.id)
        continue
      }

      // PDF
      let pdfUrl: string | null = null
      let pdfPath: string | null = null
      try {
        const pdfRes = await fetch(`${INTER_BASE}/cobranca/v3/cobrancas/${boletoId}/pdf`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) })
        if (pdfRes.ok) {
          const pdfData = await pdfRes.json()
          if (pdfData.pdf) {
            const binary = atob(pdfData.pdf)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            await sb.storage.createBucket('boletos', { public: false }).catch(() => {})
            const fileName = `${cpf}/${nossoNumero}.pdf`
            const { error: upErr } = await sb.storage.from('boletos').upload(fileName, bytes, { contentType: 'application/pdf', upsert: true })
            if (!upErr) {
              // Bucket privado (mig 280): signed URL TTL 30d (boletos têm vencimento longo)
              const { data: signed } = await sb.storage.from('boletos').createSignedUrl(fileName, 60 * 60 * 24 * 30)
              pdfUrl = signed?.signedUrl ?? null
              pdfPath = fileName
            }
          }
        }
      } catch (e) { console.warn('PDF falhou:', nossoNumero, e) }

      // Resolve escola via família (Banco Inter é single-tenant Maple por enquanto)
      const { data: fam } = await sb.from('familias').select('escola_id').eq('cpf', cpfFmt).maybeSingle()
      if (!(fam as any)?.escola_id) { console.warn('skip sync:', nossoNumero, 'CPF sem familia/escola'); continue }
      const { error: dbErr } = await sb.from('boletos').insert({
        cpf: cpfFmt, nosso_numero: nossoNumero,
        valor: bol.valorNominal ?? bol.valor ?? 0,
        vencimento: bol.dataVencimento ?? null,
        linha_digitavel: bol.linhaDigitavel ?? '',
        situacao, pdf_url: pdfUrl, pdf_path: pdfPath,
        escola_id: (fam as any).escola_id,
      })
      if (!dbErr) sincronizados++
      else console.error('Insert falhou:', dbErr.message)
    }

    console.log('Sync OK:', sincronizados, 'novos,', lista.length, 'total')
    return new Response(JSON.stringify({ ok: true, sincronizados, total: lista.length }), { headers: CORS })

  } catch (err) {
    console.error('Erro geral:', err)
    captureException(err instanceof Error ? err : new Error(String(err)), { function: 'boletos-sync' }).catch(() => {})
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS })
  }
})
