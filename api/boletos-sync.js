const SUPABASE_URL  = process.env.SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  return res.json()
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

  const cpfFmt = cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

  // 1. Tenta sincronizar via Edge Function (mTLS Deno) em background
  try {
    const solRows = await sbFetch(`solicitacoes_acesso?select=email&or=(cpf.eq.${encodeURIComponent(cpfFmt)},cpf.eq.${encodeURIComponent(cpf)})&limit=1`)
    const email = solRows?.[0]?.email
    if (email) {
      fetch(`${SUPABASE_URL}/functions/v1/boletos-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY },
        body: JSON.stringify({ email }),
      }).catch(() => {})
    }
  } catch (_) {}

  // 2. Lê boletos do banco (ambos formatos de CPF)
  const boletos = await sbFetch(`boletos?or=(cpf.eq.${encodeURIComponent(cpfFmt)},cpf.eq.${encodeURIComponent(cpf)})&order=vencimento.desc`)

  const total = Array.isArray(boletos) ? boletos.length : 0
  res.writeHead(200, CORS)
  res.end(JSON.stringify({ ok: true, sincronizados: total, total, boletos: Array.isArray(boletos) ? boletos : [] }))
}
