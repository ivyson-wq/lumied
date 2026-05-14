// boletos-sync — sincroniza boletos do banco padrão da família.
// Refatorado em sprint 0 pra usar BankAdapter (multi-banco).
//
// Fluxo:
//  1. Recebe CPF
//  2. Resolve escola via familias.cpf
//  3. Carrega escola_banco_config (banco padrão)
//  4. adapter.listarBoletos -> sincroniza com tabela `boletos`

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { captureException } from '../_shared/sentry.ts'
import { getBankAdapter } from '../_shared/banks/registry.ts'
import { getBancoConfig, marcarErro, marcarSucesso } from '../_shared/banks/config.ts'
import { BankError } from '../_shared/banks/errors.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
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

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const cpfFmt = cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

    // Resolve escola via familia.cpf
    const { data: fam } = await sb.from('familias').select('escola_id').eq('cpf', cpfFmt).maybeSingle()
    if (!(fam as any)?.escola_id) {
      return new Response(JSON.stringify({ error: 'CPF sem família/escola cadastrada.' }), { status: 404, headers: CORS })
    }
    const escolaId = (fam as any).escola_id

    // Carrega banco padrão da escola
    const config = await getBancoConfig(sb, escolaId)
    const adapter = getBankAdapter(config.banco)

    // Lista últimos 12 meses
    const hoje = new Date()
    const inicio = new Date(hoje); inicio.setMonth(inicio.getMonth() - 12)
    const dataInicial = inicio.toISOString().slice(0, 10)
    const dataFinal = hoje.toISOString().slice(0, 10)

    const lista = await adapter.listarBoletos(cpf, dataInicial, dataFinal, config)
    console.log(`[boletos-sync] ${config.banco}: ${lista.length} boletos para CPF ${cpf}`)

    let sincronizados = 0
    for (const bol of lista) {
      const nossoNumero = bol.nosso_numero
      if (!nossoNumero) continue

      const { data: existe } = await sb.from('boletos')
        .select('id, situacao').eq('nosso_numero', nossoNumero).maybeSingle()

      if (existe) {
        if (existe.situacao !== bol.situacao) {
          await sb.from('boletos').update({ situacao: bol.situacao }).eq('id', existe.id)
        }
        continue
      }

      // Tenta baixar PDF (opcional — só Inter retorna assim hoje)
      let pdfUrl: string | null = null
      let pdfPath: string | null = null
      if (adapter.downloadBoletoPdf) {
        try {
          const pdfBytes = await adapter.downloadBoletoPdf(nossoNumero, config)
          const fileName = `${cpf}/${nossoNumero}.pdf`
          await sb.storage.from('boletos').upload(fileName, pdfBytes, { contentType: 'application/pdf', upsert: true })
          const { data: signed } = await sb.storage.from('boletos').createSignedUrl(fileName, 60 * 60 * 24 * 30)
          pdfUrl = signed?.signedUrl ?? null
          pdfPath = fileName
        } catch (e) { console.warn('[boletos-sync] PDF falhou:', nossoNumero, e instanceof Error ? e.message : e) }
      }

      const { error: insErr } = await sb.from('boletos').insert({
        cpf: cpfFmt,
        nosso_numero: nossoNumero,
        valor: bol.valor,
        vencimento: bol.data_vencimento,
        linha_digitavel: '',
        situacao: bol.situacao,
        pdf_url: pdfUrl,
        pdf_path: pdfPath,
        escola_id: escolaId,
      })
      if (!insErr) sincronizados++
      else console.error('[boletos-sync] Insert falhou:', insErr.message)
    }

    await marcarSucesso(sb, config.id)
    return new Response(JSON.stringify({ ok: true, banco: config.banco, sincronizados, total: lista.length }), { headers: CORS })

  } catch (err) {
    console.error('[boletos-sync] Erro:', err)

    if (err instanceof BankError) {
      // Tenta registrar erro no config se possível (best-effort)
      try {
        const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
        const cpf = String(((await req.clone().json().catch(() => ({}))) as any)?.cpf || '').replace(/\D/g, '')
        const cpfFmt = cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
        const { data: fam } = await sb.from('familias').select('escola_id').eq('cpf', cpfFmt).maybeSingle()
        if ((fam as any)?.escola_id) {
          const cfg = await getBancoConfig(sb, (fam as any).escola_id, err.banco as any).catch(() => null)
          if (cfg) await marcarErro(sb, cfg.id, `${err.code}: ${err.message}`)
        }
      } catch { /* ignore */ }

      return new Response(JSON.stringify(err.toJSON()), { status: 502, headers: CORS })
    }

    captureException(err instanceof Error ? err : new Error(String(err)), { function: 'boletos-sync' }).catch(() => {})
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS })
  }
})
