'use strict'
// ─────────────────────────────────────────────────────────────────
//  bank-relay v2 — proxy mTLS multi-banco.
//
//  Endpoints:
//    POST /inter-proxy   → legacy (single-bank Inter). Mantido pra
//                          backward-compat com edge functions antigas.
//    POST /bank-proxy    → genérico. Payload { banco, path, method,
//                          headers, body } — banco em {inter,sicredi,
//                          bb,itau,bradesco}. Edge function passa
//                          X-Bank header também.
//
//  Auth: Authorization: Bearer ${RELAY_SECRET} em todo request.
//
//  Cert/host por banco: env vars `<BANCO>_CERT` + `<BANCO>_KEY`
//    (PEM, com \n literal escapado). Fallback INTER_CERT/INTER_KEY
//    pra compat com setup atual. Sandbox toggle via BANK_SANDBOX=true.
// ─────────────────────────────────────────────────────────────────

const https = require('https')
const http = require('http')

const RELAY_SECRET = process.env.RELAY_SECRET
const SANDBOX = process.env.BANK_SANDBOX === 'true'

if (!RELAY_SECRET) { console.error('RELAY_SECRET não definido'); process.exit(1) }

// ── Hosts canônicos por banco ───────────────────────────────────
// OAuth normalmente bate no mesmo host, com 2 exceções (BB).
const HOSTS_PROD = {
  inter:    'cdpj.partners.bancointer.com.br',
  sicredi:  'api-parceiro.sicredi.com.br',
  bb:       'api.bb.com.br',
  bb_oauth: 'oauth.bb.com.br',
  itau:     'secure.api.itau',
  bradesco: 'cobranca.bradesconetempresa.b.br',
}

const HOSTS_SANDBOX = {
  inter:    'cdpj-sandbox.partners.uatinter.co',
  sicredi:  'api-parceiro.sicredi.com.br',   // mesmo host, creds diferentes
  bb:       'api.sandbox.bb.com.br',
  bb_oauth: 'oauth.sandbox.bb.com.br',
  itau:     'sandbox.devportal.itau.com.br',
  bradesco: 'proxy.api.prebanco.com.br',
}

function resolveHost(banco, path) {
  const map = SANDBOX ? HOSTS_SANDBOX : HOSTS_PROD
  // BB tem OAuth em host separado
  if (banco === 'bb' && (path === '/oauth/token' || path.startsWith('/oauth/'))) {
    return map.bb_oauth
  }
  return map[banco]
}

// ── Cert/key por banco (PEM em env vars) ────────────────────────
// Convenção: <BANCO>_CERT + <BANCO>_KEY. Inter aceita INTER_CERT/KEY
// como hoje. Para PFX usar <BANCO>_PFX_BASE64 + <BANCO>_PFX_PASS.
function loadCreds(banco) {
  const up = banco.toUpperCase()
  const pfxB64 = process.env[`${up}_PFX_BASE64`]
  if (pfxB64) {
    return {
      pfx: Buffer.from(pfxB64, 'base64'),
      passphrase: process.env[`${up}_PFX_PASS`] || '',
    }
  }
  const cert = process.env[`${up}_CERT`]?.replace(/\\n/g, '\n')
  const key  = process.env[`${up}_KEY`]?.replace(/\\n/g, '\n')
  if (cert && key) return { cert, key }
  return null
}

// Pre-load + validação no startup pra falhar cedo.
const CERTS = {}
for (const banco of Object.keys(HOSTS_PROD)) {
  if (banco === 'bb_oauth') continue
  const creds = loadCreds(banco)
  if (creds) CERTS[banco] = creds
}
if (!CERTS.inter) {
  console.error('inter cert/key não definidos (INTER_CERT + INTER_KEY ou INTER_PFX_BASE64).')
  process.exit(1)
}
console.log(`bank-relay v2 iniciando | sandbox=${SANDBOX} | bancos carregados: ${Object.keys(CERTS).join(', ')}`)

// ── Proxy HTTPS mTLS ────────────────────────────────────────────
function bankRequest({ banco, path, method, headers, body }) {
  const hostname = resolveHost(banco, path)
  const creds = CERTS[banco]
  if (!hostname) return Promise.reject(new Error(`banco '${banco}' sem host configurado`))
  if (!creds)    return Promise.reject(new Error(`banco '${banco}' sem cert mTLS carregado (configure ${banco.toUpperCase()}_CERT/KEY ou _PFX_BASE64)`))

  return new Promise((resolve, reject) => {
    const reqHeaders = { ...headers }
    if (body) reqHeaders['Content-Length'] = Buffer.byteLength(body)

    const opts = { hostname, path, method, headers: reqHeaders, ...creds }

    const req = https.request(opts, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// ── HTTP server ────────────────────────────────────────────────
function authOk(req) {
  const auth = req.headers['authorization']
  return auth === `Bearer ${RELAY_SECRET}`
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString()
}

const server = http.createServer(async (req, res) => {
  // CORS / preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, content-type, x-bank',
    })
    res.end()
    return
  }

  // Health
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      version: 'v2',
      sandbox: SANDBOX,
      bancos_carregados: Object.keys(CERTS),
    }))
    return
  }

  // Endpoints suportados
  const isInterLegacy = req.url === '/inter-proxy'
  const isBankProxy   = req.url === '/bank-proxy'

  if (!isInterLegacy && !isBankProxy) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found', supported: ['/inter-proxy', '/bank-proxy', '/health'] }))
    return
  }

  if (!authOk(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  try {
    const payload = JSON.parse(await readBody(req))
    const banco = isInterLegacy ? 'inter' : (payload.banco || req.headers['x-bank'] || 'inter')

    const result = await bankRequest({
      banco,
      path: payload.path,
      method: payload.method ?? 'GET',
      headers: payload.headers ?? {},
      body: payload.body ?? '',
    })

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (err) {
    console.error(`Relay error (${req.url}):`, err.message || err)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err.message || err) }))
  }
})

const PORT = process.env.PORT ?? 8080
server.listen(PORT, () => console.log(`bank-relay v2 rodando na porta ${PORT}`))
