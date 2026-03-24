const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY

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

  // Busca e-mail pelo CPF para chamar o Edge Function
  const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/solicitacoes_acesso?select=email&cpf=ilike.*${cpf}*&limit=1`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` }
  })
  const rows = await sbRes.json()
  const email = rows?.[0]?.email

  if (!email) {
    res.writeHead(200, CORS)
    return res.end(JSON.stringify({ ok: true, sincronizados: 0, total: 0 }))
  }

  // Delega para Edge Function Supabase (Deno — mTLS nativo)
  const upstream = await fetch(`${SUPABASE_URL}/functions/v1/boletos-list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ email }),
  })

  const data = await upstream.json()
  const total = data.boletos?.length ?? 0
  res.writeHead(upstream.status, CORS)
  res.end(JSON.stringify({ ok: upstream.ok, sincronizados: total, total, boletos: data.boletos }))
}
