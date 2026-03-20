import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const body = await req.json()
  const { action } = body

  // ── PÚBLICO: verifica se e-mail tem acesso ──────────────
  if (action === 'check') {
    const email: string = (body.email || '').toLowerCase().trim()
    if (!email) return json({ allowed: false })

    // Verifica na tabela familias (pode não existir)
    try {
      const { data } = await sb
        .from('familias')
        .select('email')
        .ilike('email', email)
        .maybeSingle()
      if (data) return json({ allowed: true })
    } catch (_) {
      // tabela familias não existe ainda, ignora
    }

    // Verifica na tabela de usuários autorizados por gerente
    const { data } = await sb
      .from('usuarios_autorizados')
      .select('email')
      .ilike('email', email)
      .maybeSingle()

    return json({ allowed: !!data })
  }

  // ── AUTENTICADO: apenas gerentes ────────────────────────
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Não autorizado' }, 401)

  const { data: sessao } = await sb
    .from('gerente_sessoes')
    .select('gerente_id, expira_em')
    .eq('token', token)
    .maybeSingle()

  if (!sessao || new Date(sessao.expira_em) < new Date()) {
    return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)
  }

  if (action === 'list') {
    const { data } = await sb
      .from('usuarios_autorizados')
      .select('*')
      .order('criado_em', { ascending: false })
    return json({ data: data ?? [] })
  }

  if (action === 'add') {
    const email: string = (body.email || '').toLowerCase().trim()
    const nome: string = (body.nome || '').trim()
    const { data: gerente } = await sb
      .from('gerentes')
      .select('nome')
      .eq('id', sessao.gerente_id)
      .maybeSingle()
    if (!email) return json({ error: 'E-mail obrigatório' }, 400)
    const { error } = await sb
      .from('usuarios_autorizados')
      .insert({ email, nome: nome || null, criado_por: gerente?.nome || null })
    if (error) return json({ error: error.code === '23505' ? 'E-mail já cadastrado.' : error.message }, 400)
    return json({ ok: true })
  }

  if (action === 'remove') {
    const { id } = body
    const { error } = await sb.from('usuarios_autorizados').delete().eq('id', id)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  return json({ error: 'Ação desconhecida' }, 400)
})
