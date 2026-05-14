// boletos-list — lista boletos da família (sincroniza com banco padrão).
// Refatorado em sprint 0 pra usar BankAdapter (multi-banco).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { checkRateLimit, getClientIP } from '../_shared/ratelimit.ts'
import { captureException } from '../_shared/sentry.ts'
import { getBankAdapter } from '../_shared/banks/registry.ts'
import { getBancoConfig } from '../_shared/banks/config.ts'
import { BankError } from '../_shared/banks/errors.ts'

let corsHeaders: Record<string, string> = getCorsHeaders()

Deno.serve(async (req) => {
  corsHeaders = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405, headers: corsHeaders })

  try {
    const ip = getClientIP(req)
    const rl = checkRateLimit(ip, 'api')
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: `Tente novamente em ${rl.retryAfterSeconds}s.` }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const body = await req.json()
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    let cpfRaw: string | undefined
    if (body.cpf) {
      cpfRaw = String(body.cpf).replace(/\D/g, '')
    } else if (body.email) {
      const { data: sol } = await sb.from('solicitacoes_acesso').select('cpf').eq('email', body.email).maybeSingle()
      if (sol?.cpf) cpfRaw = sol.cpf.replace(/\D/g, '')
    }

    if (!cpfRaw || cpfRaw.length !== 11) {
      return new Response(JSON.stringify({ boletos: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const cpfFormatado = cpfRaw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

    // Resolve escola via família
    const { data: fam } = await sb.from('familias').select('escola_id').eq('cpf', cpfFormatado).maybeSingle()
    const escolaId: string | null = (fam as any)?.escola_id ?? null

    // Sync com banco padrão (best-effort — se falhar, retorna cache do DB)
    if (escolaId) {
      try {
        const config = await getBancoConfig(sb, escolaId)
        const adapter = getBankAdapter(config.banco)
        const hoje = new Date()
        const dataFinal = hoje.toISOString().slice(0, 10)
        const dataInicial = new Date(hoje.setFullYear(hoje.getFullYear() - 1)).toISOString().slice(0, 10)

        const lista = await adapter.listarBoletos(cpfRaw, dataInicial, dataFinal, config)

        for (const bol of lista) {
          if (!bol.nosso_numero) continue

          const { data: existing } = await sb.from('boletos')
            .select('id, pdf_url, pdf_path, situacao')
            .eq('nosso_numero', bol.nosso_numero)
            .maybeSingle()

          let pdfUrl = (existing as any)?.pdf_url ?? null
          let pdfPath = (existing as any)?.pdf_path ?? null

          if (!pdfUrl && adapter.downloadBoletoPdf) {
            try {
              const pdfBytes = await adapter.downloadBoletoPdf(bol.nosso_numero, config)
              const fileName = `${cpfRaw}/${bol.nosso_numero}.pdf`
              const { error: upErr } = await sb.storage.from('boletos').upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })
              if (!upErr) {
                const { data: signed } = await sb.storage.from('boletos').createSignedUrl(fileName, 60 * 60 * 24 * 30)
                pdfUrl = signed?.signedUrl ?? null
                pdfPath = fileName
              }
            } catch { /* PDF opcional */ }
          }

          if (existing) {
            if (existing.situacao !== bol.situacao || (!existing.pdf_url && pdfUrl)) {
              await sb.from('boletos')
                .update({ situacao: bol.situacao, pdf_url: pdfUrl ?? existing.pdf_url, pdf_path: pdfPath })
                .eq('nosso_numero', bol.nosso_numero)
            }
          } else {
            await sb.from('boletos').insert({
              cpf: cpfFormatado,
              nosso_numero: bol.nosso_numero,
              valor: bol.valor,
              vencimento: bol.data_vencimento,
              linha_digitavel: '',
              situacao: bol.situacao,
              pdf_url: pdfUrl,
              pdf_path: pdfPath,
              escola_id: escolaId,
            })
          }
        }
      } catch (syncErr) {
        if (syncErr instanceof BankError) console.warn('[boletos-list] sync banco falhou:', syncErr.code, syncErr.message)
        else console.warn('[boletos-list] sync inesperado:', syncErr)
        // Continua e retorna cache
      }
    }

    const { data: boletos, error: dbError } = await sb.from('boletos')
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
