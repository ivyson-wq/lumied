const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  const { email } = req.body || {}
  if (!email) {
    return res.status(400).json({ error: 'E-mail obrigatório' })
  }

  // Delega para a Edge Function Supabase que faz mTLS com o Inter nativamente
  const upstream = await fetch(`${SUPABASE_URL}/functions/v1/boletos-list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON,
    },
    body: JSON.stringify({ email }),
  })

  const data = await upstream.json()
  return res.status(upstream.status).json(data)
}
