const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  if (req.method !== 'POST') { res.writeHead(405, CORS); return res.end(JSON.stringify({ error: 'Method not allowed' })) }

  let body = ''
  await new Promise(resolve => { req.on('data', c => body += c); req.on('end', resolve) })
  const { cpf: rawCpf } = JSON.parse(body || '{}')
  const cpf = (rawCpf || '').replace(/\D/g, '')

  if (!cpf || cpf.length !== 11) {
    res.writeHead(400, CORS)
    return res.end(JSON.stringify({ error: 'CPF inválido.' }))
  }

  // Delega para Edge Function Supabase (Deno — mTLS nativo) passando CPF direto
  const upstream = await fetch(`${SUPABASE_URL}/functions/v1/boletos-list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },

    body: JSON.stringify({ cpf }),
  })

  const data = await upstream.json()
  const boletos = data.boletos ?? []
  res.writeHead(upstream.ok ? 200 : upstream.status, CORS)
  res.end(JSON.stringify({ ok: upstream.ok, sincronizados: boletos.length, total: boletos.length, boletos }))
}
