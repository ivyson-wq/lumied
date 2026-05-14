// bank-relay (Cloudflare Worker) — proxy mTLS multi-banco.
//
// Substitui o Node.js relay/ que estava planejado pra Render/Fly. Como o
// resto do stack do Lumied roda em Cloudflare Workers, a relay ganhou
// mais coerência aqui.
//
// Endpoints:
//   POST /inter-proxy   → legacy, single-bank Inter. Mantido pra
//                         backward-compat com edge functions antigas.
//   POST /bank-proxy    → genérico. Payload { banco, path, method,
//                         headers, body } — banco em {inter,sicredi,
//                         bb,itau,bradesco}. Edge function passa X-Bank.
//   GET  /health        → versão + bancos com cert mTLS plugado.
//
// Auth: Authorization: Bearer ${RELAY_SECRET} em todo request.
//
// mTLS: cert+key são uploaded via `wrangler mtls-certificate upload`,
// retornam certificate_id, e plugam aqui via `[[mtls_certificates]]`
// no wrangler.toml. Cada binding (INTER_MTLS, SICREDI_MTLS, etc.) é
// um Fetcher que executa fetch() automaticamente apresentando o cert.

export interface Env {
  RELAY_SECRET: string
  BANK_SANDBOX?: string

  // mtls_certificates bindings (presentes só se cert foi uploaded)
  INTER_MTLS?: Fetcher
  SICREDI_MTLS?: Fetcher
  BB_MTLS?: Fetcher
  ITAU_MTLS?: Fetcher
  BRADESCO_MTLS?: Fetcher
}

const HOSTS_PROD = {
  inter:    'cdpj.partners.bancointer.com.br',
  sicredi:  'api-parceiro.sicredi.com.br',
  bb:       'api.bb.com.br',
  bb_oauth: 'oauth.bb.com.br',
  itau:     'secure.api.itau',
  bradesco: 'cobranca.bradesconetempresa.b.br',
} as const

const HOSTS_SANDBOX = {
  inter:    'cdpj-sandbox.partners.uatinter.co',
  sicredi:  'api-parceiro.sicredi.com.br',
  bb:       'api.sandbox.bb.com.br',
  bb_oauth: 'oauth.sandbox.bb.com.br',
  itau:     'sandbox.devportal.itau.com.br',
  bradesco: 'proxy.api.prebanco.com.br',
} as const

type BancoProvider = 'inter' | 'sicredi' | 'bb' | 'itau' | 'bradesco'

function resolveHost(banco: BancoProvider, path: string, sandbox: boolean): string | null {
  const map = sandbox ? HOSTS_SANDBOX : HOSTS_PROD
  if (banco === 'bb' && (path === '/oauth/token' || path.startsWith('/oauth/'))) {
    return map.bb_oauth
  }
  const h = (map as Record<string, string>)[banco]
  return h ?? null
}

function pickBinding(env: Env, banco: BancoProvider): Fetcher | undefined {
  switch (banco) {
    case 'inter':    return env.INTER_MTLS
    case 'sicredi':  return env.SICREDI_MTLS
    case 'bb':       return env.BB_MTLS
    case 'itau':     return env.ITAU_MTLS
    case 'bradesco': return env.BRADESCO_MTLS
  }
}

function bancosCarregados(env: Env): BancoProvider[] {
  const all: BancoProvider[] = ['inter', 'sicredi', 'bb', 'itau', 'bradesco']
  return all.filter((b) => pickBinding(env, b) !== undefined)
}

function authOk(req: Request, secret: string): boolean {
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-bank',
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const url = new URL(req.url)

    // Health (público, sem auth — só lista bancos plugados)
    if (url.pathname === '/health' && req.method === 'GET') {
      return Response.json({
        ok: true,
        version: 'v2-worker',
        sandbox: env.BANK_SANDBOX === 'true',
        bancos_carregados: bancosCarregados(env),
      }, { headers: CORS_HEADERS })
    }

    const isInterLegacy = url.pathname === '/inter-proxy'
    const isBankProxy = url.pathname === '/bank-proxy'

    if (!isInterLegacy && !isBankProxy) {
      return Response.json(
        { error: 'Not found', supported: ['/inter-proxy', '/bank-proxy', '/health'] },
        { status: 404, headers: CORS_HEADERS },
      )
    }

    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS })
    }

    if (!authOk(req, env.RELAY_SECRET)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
    }

    let payload: {
      banco?: string
      path?: string
      method?: string
      headers?: Record<string, string>
      body?: string
    }
    try {
      payload = await req.json()
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS_HEADERS })
    }

    const banco = (isInterLegacy
      ? 'inter'
      : (payload.banco || req.headers.get('x-bank') || 'inter')) as BancoProvider

    if (!HOSTS_PROD[banco as keyof typeof HOSTS_PROD]) {
      return Response.json({ error: `Banco '${banco}' inválido` }, { status: 400, headers: CORS_HEADERS })
    }

    if (!payload.path) {
      return Response.json({ error: 'Campo "path" obrigatório' }, { status: 400, headers: CORS_HEADERS })
    }

    const sandbox = env.BANK_SANDBOX === 'true'
    const hostname = resolveHost(banco, payload.path, sandbox)
    if (!hostname) {
      return Response.json({ error: `Banco '${banco}' sem host configurado` }, { status: 500, headers: CORS_HEADERS })
    }

    const binding = pickBinding(env, banco)
    if (!binding) {
      return Response.json({
        error: `Banco '${banco}' sem cert mTLS plugado`,
        hint: `Upload via 'wrangler mtls-certificate upload --cert <banco>.pem --key <banco>.key --name ${banco}' e adicionar binding em wrangler.toml`,
      }, { status: 503, headers: CORS_HEADERS })
    }

    const upstreamUrl = `https://${hostname}${payload.path}`
    let upstreamRes: Response
    try {
      upstreamRes = await binding.fetch(upstreamUrl, {
        method: payload.method ?? 'GET',
        headers: payload.headers ?? {},
        body: payload.body ?? undefined,
      })
    } catch (err) {
      return Response.json({
        error: 'Falha ao contactar banco',
        details: String((err as Error).message ?? err),
      }, { status: 502, headers: CORS_HEADERS })
    }

    const bodyText = await upstreamRes.text()
    return Response.json(
      { status: upstreamRes.status, body: bodyText },
      { headers: CORS_HEADERS },
    )
  },
} satisfies ExportedHandler<Env>
