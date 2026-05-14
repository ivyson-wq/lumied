// ═══════════════════════════════════════════════════════════════
//  Edge Function: diplomas (v2 — Onda 3 do refator)
//  4999 → ~100 linhas. Dispatch procedural preservado verbatim
//  em 10 handlers de domínio (handlers/*.ts). Comportamento idêntico
//  ao monolito original — cada handler returns Response se matchou
//  uma action interna, null pra fall-through pro próximo.
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  getCorsHeaders,
  checkRateLimit, getClientIP,
} from '../_shared/mod.ts'
import { type HandlerCtx, json, ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI } from './_lib.ts'

import { handle as handlePublic } from './handlers/public.ts'
import { handle as handleTeacher } from './handlers/teacher.ts'
import { handle as handleSecretaria } from './handlers/secretaria.ts'
import { handle as handleManager } from './handlers/manager.ts'
import { handle as handlePickup } from './handlers/pickup.ts'
import { handle as handleAlmoxPrice } from './handlers/almox-price.ts'
import { handle as handleAlmoxCompra } from './handlers/almox-compra.ts'
import { handle as handleAlmoxProf } from './handlers/almox-prof.ts'
import { handle as handleAlmoxManager } from './handlers/almox-manager.ts'
import { handle as handleMisc } from './handlers/misc.ts'

const HANDLERS = [
  handlePublic, handleTeacher, handleSecretaria, handleManager,
  handlePickup, handleAlmoxPrice, handleAlmoxCompra,
  handleAlmoxProf, handleAlmoxManager, handleMisc,
]

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  try {
    // Rate limiting
    const clientIp = getClientIP(req)
    const rl = checkRateLimit(clientIp, 'api')
    if (!rl.allowed) {
      return json({ error: `Muitas requisições. Tente em ${rl.retryAfterSeconds}s.`, code: 'RATE_LIMITED' }, 429, cors)
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // OAuth callback do ML (GET com query string — não vai pelo dispatch normal)
    const url = new URL(req.url)
    if (url.searchParams.get('action') === 'ml_oauth_callback') {
      const code = url.searchParams.get('code')
      if (!code) return new Response('Codigo nao recebido.', { status: 400 })
      try {
        const res = await fetch('https://api.mercadolibre.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `grant_type=authorization_code&client_id=${ML_CLIENT_ID}&client_secret=${ML_CLIENT_SECRET}&code=${code}&redirect_uri=${encodeURIComponent(ML_REDIRECT_URI)}`,
          signal: AbortSignal.timeout(10000),
        })
        const t = await res.json()
        if (t.access_token) {
          await sb.from('ml_tokens').delete().gte('criado_em', '2000-01-01')
          const { error: insErr } = await sb.from('ml_tokens').insert({
            access_token: t.access_token,
            refresh_token: t.refresh_token || t.access_token,
            expires_at: new Date(Date.now() + (t.expires_in || 21600) * 1000).toISOString(),
            user_id: String(t.user_id || ''),
          })
          if (insErr) return new Response('Erro ao salvar token: ' + insErr.message, { status: 500 })
          const appUrl = Deno.env.get('APP_URL') || 'https://maplebearcaxias.lumied.com.br'
          return Response.redirect(appUrl + '/ml-conectado.html', 302)
        }
        return new Response('Erro ao obter token do ML: ' + JSON.stringify(t), { status: 400, headers: { 'Content-Type': 'text/plain' } })
      } catch (e) { return new Response('Erro: ' + (e as Error).message, { status: 500 }) }
    }

    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch (_) { body = {} }
    const { action } = body
    // Token: _prof_token/_token do body se presente, senão Authorization header
    const authHeader = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
    const token = (body._prof_token as string) || (body._token as string) || authHeader

    const ctx: HandlerCtx = {
      // deno-lint-ignore no-explicit-any
      req, sb: sb as any, body, action: action as string, token, clientIp, cors,
    }

    for (const h of HANDLERS) {
      const r = await h(ctx)
      if (r) return r
    }

    return json({ error: 'Ação desconhecida' }, 400, cors)
  } catch (e) {
    console.error('[diplomas] uncaught', e)
    return new Response(JSON.stringify({ error: 'Erro interno: ' + (e as Error).message }), {
      status: 500, headers: getCorsHeaders(req),
    })
  }
})
