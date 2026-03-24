'use strict'
const https = require('https')
const http = require('http')

const INTER_HOST = 'cdpj.partners.bancointer.com.br'
const RELAY_SECRET = process.env.RELAY_SECRET
const INTER_CERT = process.env.INTER_CERT?.replace(/\\n/g, '\n')
const INTER_KEY = process.env.INTER_KEY?.replace(/\\n/g, '\n')

if (!RELAY_SECRET) { console.error('RELAY_SECRET não definido'); process.exit(1) }
if (!INTER_CERT)   { console.error('INTER_CERT não definido');   process.exit(1) }
if (!INTER_KEY)    { console.error('INTER_KEY não definido');     process.exit(1) }

function interRequest(path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const reqHeaders = { ...headers }
    if (body) reqHeaders['Content-Length'] = Buffer.byteLength(body)

    const req = https.request(
      { hostname: INTER_HOST, path, method, cert: INTER_CERT, key: INTER_KEY, headers: reqHeaders },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
      }
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.url !== '/inter-proxy') { res.writeHead(404); res.end('Not found'); return }

  const auth = req.headers['authorization']
  if (!auth || auth !== `Bearer ${RELAY_SECRET}`) {
    res.writeHead(401); res.end('Unauthorized'); return
  }

  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const payload = JSON.parse(Buffer.concat(chunks).toString())

    const result = await interRequest(
      payload.path,
      payload.method ?? 'GET',
      payload.headers ?? {},
      payload.body ?? ''
    )

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (err) {
    console.error('Relay error:', err)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err) }))
  }
})

const PORT = process.env.PORT ?? 8080
server.listen(PORT, () => console.log(`Relay Inter rodando na porta ${PORT}`))
