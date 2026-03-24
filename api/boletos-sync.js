const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

async function sbGet(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase ${table}: ${res.status} ${text}`)
  }
  return res.json()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  const { email } = req.body || {}
  if (!email) {
    return res.status(400).json({ error: 'E-mail obrigatório' })
  }

  try {
    // Busca CPF pelo e-mail em solicitacoes_acesso
    const solRows = await sbGet(
      'solicitacoes_acesso',
      `select=cpf&email=ilike.${encodeURIComponent(email)}&limit=1`
    )

    const cpfRaw = solRows[0]?.cpf?.replace(/\D/g, '')
    if (!cpfRaw || cpfRaw.length !== 11) {
      return res.status(200).json({ boletos: [] })
    }

    const cpfFormatado = cpfRaw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

    // Busca boletos pelos dois formatos possíveis de CPF
    const boletos = await sbGet(
      'boletos',
      `select=*&or=(cpf.eq.${encodeURIComponent(cpfFormatado)},cpf.eq.${encodeURIComponent(cpfRaw)})&order=vencimento.desc`
    )

    return res.status(200).json({ boletos })
  } catch (err) {
    console.error('[boletos-sync]', err)
    return res.status(500).json({ error: String(err) })
  }
}
