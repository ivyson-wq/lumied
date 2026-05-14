// Cliente HTTP genérico para o bank-relay (Render/Fly).
// Substitui interFetch que existia em cada edge function.
//
// Convenção: relay aceita header X-Bank pra rotear o cert correto
// e proxiar pro host certo. Backward-compat: se X-Bank ausente,
// trata como 'inter' e usa /inter-proxy.

import type { BancoProvider } from './types.ts'
import { BankError } from './errors.ts'

export interface RelayResponse {
  ok: boolean
  status: number
  body: string
  json<T = unknown>(): T
}

interface RelayOpts {
  banco: BancoProvider
  path: string                       // path no host do banco (ex: /oauth/v2/token)
  method?: string
  headers?: Record<string, string>
  body?: string | URLSearchParams
  timeoutMs?: number
}

export async function bankRelay(opts: RelayOpts): Promise<RelayResponse> {
  const relayUrl = Deno.env.get('INTER_RELAY_URL')!  // Mantém nome do env por compat; será BANK_RELAY_URL no futuro
  const relaySecret = Deno.env.get('RELAY_SECRET')!

  if (!relayUrl || !relaySecret) {
    throw new BankError({
      code: 'CONFIG_INCOMPLETE',
      banco: opts.banco,
      message: 'INTER_RELAY_URL ou RELAY_SECRET não configurados.',
    })
  }

  const bodyStr = opts.body instanceof URLSearchParams
    ? opts.body.toString()
    : (opts.body ?? '')

  // Backward-compat: relay v1 usa /inter-proxy; relay v2 usa /bank-proxy.
  // Tentamos /bank-proxy primeiro com X-Bank; se 404, fallback /inter-proxy.
  const tryEndpoint = async (endpoint: string) => {
    return await fetch(`${relayUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${relaySecret}`,
        'X-Bank': opts.banco,
      },
      body: JSON.stringify({
        banco: opts.banco,
        path: opts.path,
        method: opts.method ?? 'GET',
        headers: opts.headers ?? {},
        body: bodyStr,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
    })
  }

  let res = await tryEndpoint('/bank-proxy')
  if (res.status === 404) {
    // Relay antigo (single-bank Inter)
    if (opts.banco !== 'inter') {
      throw new BankError({
        code: 'BANK_UNAVAILABLE',
        banco: opts.banco,
        message: `bank-relay v2 não deployado — ${opts.banco} requer relay multi-banco.`,
      })
    }
    res = await tryEndpoint('/inter-proxy')
  }

  if (!res.ok) {
    const text = await res.text()
    throw new BankError({
      code: 'BANK_UNAVAILABLE',
      banco: opts.banco,
      message: `Relay retornou ${res.status}`,
      status: res.status,
      details: text.slice(0, 500),
    })
  }

  const { status, body } = await res.json() as { status: number; body: string }
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    json<T = unknown>(): T { return JSON.parse(body) as T },
  }
}
