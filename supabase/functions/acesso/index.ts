import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

async function sendEmail(to: string[], subject: string, html: string) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Maple Bear <noreply@maplebearcaxiasdosul.com.br>',
        to,
        subject,
        html,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error('Resend error:', await res.text())
  } catch (e) {
    console.error('sendEmail failed:', e)
  }
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

    try {
      const { data } = await sb.from('familias').select('email').ilike('email', email).maybeSingle()
      if (data) return json({ allowed: true })
    } catch (_) { /* tabela não existe */ }

    const { data } = await sb
      .from('usuarios_autorizados').select('email').ilike('email', email).maybeSingle()
    return json({ allowed: !!data })
  }

  // ── PÚBLICO: solicitar acesso ───────────────────────────
  if (action === 'solicitar') {
    const nome: string        = (body.nome || '').trim()
    const cpf: string         = (body.cpf || '').replace(/\D/g, '')
    const email: string       = (body.email || '').toLowerCase().trim()
    const telefone: string    = (body.telefone || '').trim()
    const nome_crianca: string = (body.nome_crianca || '').trim()

    if (!nome || !cpf || !email || !telefone || !nome_crianca)
      return json({ error: 'Todos os campos são obrigatórios.' }, 400)
    if (cpf.length !== 11)
      return json({ error: 'CPF inválido.' }, 400)

    // verifica se já está autorizado
    try {
      const { data: fam } = await sb.from('familias').select('email').ilike('email', email).maybeSingle()
      if (fam) return json({ error: 'Este e-mail já possui acesso ao sistema.' }, 400)
    } catch (_) {}
    const { data: auth } = await sb.from('usuarios_autorizados').select('email').ilike('email', email).maybeSingle()
    if (auth) return json({ error: 'Este e-mail já possui acesso ao sistema.' }, 400)

    // verifica se já existe solicitação pendente
    const { data: dup } = await sb
      .from('solicitacoes_acesso').select('id').ilike('email', email).eq('status', 'pendente').maybeSingle()
    if (dup) return json({ error: 'Já existe uma solicitação pendente para este e-mail.' }, 400)

    // formata CPF
    const cpfFmt = cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

    const { data: inserted, error: insErr } = await sb.from('solicitacoes_acesso').insert({
      nome, cpf: cpfFmt, email, telefone, nome_crianca, status: 'pendente',
    }).select()
    if (insErr) return json({ error: insErr.message }, 400)
    if (!inserted || inserted.length === 0)
      return json({ error: 'Solicitação não foi salva. Verifique as permissões da tabela no Supabase (RLS).' }, 500)

    // envia e-mail para todos os gerentes
    const { data: gerentes } = await sb.from('gerentes').select('email, nome')
    if (gerentes && gerentes.length > 0) {
      const emails = gerentes.map((g: { email: string }) => g.email)
      await sendEmail(
        emails,
        `Nova solicitação de acesso — ${nome}`,
        `
        <div style="font-family:sans-serif;max-width:560px;margin:auto;">
          <h2 style="color:#C8102E;">Nova Solicitação de Acesso</h2>
          <p>Um responsável solicitou acesso ao formulário público da Maple Bear.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr><td style="padding:8px;background:#f9f5f0;font-weight:600;border-radius:4px 0 0 4px;width:40%;">Nome</td><td style="padding:8px;border-bottom:1px solid #eee;">${nome}</td></tr>
            <tr><td style="padding:8px;background:#f9f5f0;font-weight:600;">CPF</td><td style="padding:8px;border-bottom:1px solid #eee;">${cpfFmt}</td></tr>
            <tr><td style="padding:8px;background:#f9f5f0;font-weight:600;">E-mail</td><td style="padding:8px;border-bottom:1px solid #eee;">${email}</td></tr>
            <tr><td style="padding:8px;background:#f9f5f0;font-weight:600;">Telefone</td><td style="padding:8px;border-bottom:1px solid #eee;">${telefone}</td></tr>
            <tr><td style="padding:8px;background:#f9f5f0;font-weight:600;">Criança</td><td style="padding:8px;">${nome_crianca}</td></tr>
          </table>
          <a href="https://maple-bear-rs.vercel.app/acesso.html" style="display:inline-block;padding:12px 24px;background:#C8102E;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Revisar no Painel</a>
        </div>
        `
      )
    }

    return json({ ok: true })
  }

  // ── AUTENTICADO: apenas gerentes ────────────────────────
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json({ error: 'Não autorizado' }, 401)

  const { data: sessao } = await sb
    .from('gerente_sessoes').select('gerente_id, expira_em').eq('token', token).maybeSingle()
  if (!sessao || new Date(sessao.expira_em) < new Date())
    return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

  const { data: gerenteAtual } = await sb
    .from('gerentes').select('nome').eq('id', sessao.gerente_id).maybeSingle()
  const nomeGerente = gerenteAtual?.nome || 'Gerente'

  if (action === 'list') {
    const { data } = await sb
      .from('usuarios_autorizados').select('*').order('criado_em', { ascending: false })
    return json({ data: data ?? [] })
  }

  if (action === 'solicitacoes_list') {
    const { data } = await sb
      .from('solicitacoes_acesso').select('*')
      .eq('status', 'pendente').order('criado_em', { ascending: true })
    return json({ data: data ?? [] })
  }

  if (action === 'add') {
    const email: string = (body.email || '').toLowerCase().trim()
    const nome: string  = (body.nome || '').trim()
    if (!email) return json({ error: 'E-mail obrigatório' }, 400)
    const { error } = await sb.from('usuarios_autorizados')
      .insert({ email, nome: nome || null, criado_por: nomeGerente })
    if (error) return json({ error: error.code === '23505' ? 'E-mail já cadastrado.' : error.message }, 400)
    return json({ ok: true })
  }

  if (action === 'remove') {
    const { id } = body
    const { error } = await sb.from('usuarios_autorizados').delete().eq('id', id)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  if (action === 'aprovar') {
    const { id } = body
    const { data: sol } = await sb
      .from('solicitacoes_acesso').select('*').eq('id', id).maybeSingle()
    if (!sol) return json({ error: 'Solicitação não encontrada.' }, 404)

    // adiciona aos autorizados (ignora duplicata)
    await sb.from('usuarios_autorizados').insert({
      email: sol.email, nome: sol.nome, criado_por: nomeGerente
    }).then(() => {})

    // atualiza status
    await sb.from('solicitacoes_acesso').update({
      status: 'aprovado',
      processado_em: new Date().toISOString(),
      processado_por: nomeGerente,
    }).eq('id', id)

    // envia e-mail ao responsável
    await sendEmail(
      [sol.email],
      'Acesso aprovado — Maple Bear Bento Gonçalves',
      `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;">
        <h2 style="color:#C8102E;">Acesso Aprovado! 🎉</h2>
        <p>Olá, <strong>${sol.nome}</strong>!</p>
        <p>Sua solicitação de acesso ao formulário da Maple Bear Bento Gonçalves foi <strong>aprovada</strong>.</p>
        <p style="margin:20px 0;">Agora você pode acessar o formulário usando o seu e-mail <strong>${sol.email}</strong> via Magic Link ou Google.</p>
        <a href="https://maple-bear-rs.vercel.app" style="display:inline-block;padding:12px 24px;background:#C8102E;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Acessar Formulário</a>
        <p style="margin-top:24px;font-size:12px;color:#999;">Maple Bear Bento Gonçalves — sistema de solicitações online.</p>
      </div>
      `
    )

    return json({ ok: true })
  }

  if (action === 'rejeitar') {
    const { id } = body
    const { data: sol } = await sb
      .from('solicitacoes_acesso').select('*').eq('id', id).maybeSingle()
    if (!sol) return json({ error: 'Solicitação não encontrada.' }, 404)

    await sb.from('solicitacoes_acesso').update({
      status: 'rejeitado',
      processado_em: new Date().toISOString(),
      processado_por: nomeGerente,
    }).eq('id', id)

    await sendEmail(
      [sol.email],
      'Solicitação de acesso — Maple Bear Bento Gonçalves',
      `
      <div style="font-family:sans-serif;max-width:560px;margin:auto;">
        <h2 style="color:#C8102E;">Maple Bear Bento Gonçalves</h2>
        <p>Olá, <strong>${sol.nome}</strong>.</p>
        <p>Analisamos sua solicitação de acesso ao formulário online e, no momento, não foi possível aprová-la.</p>
        <p>Em caso de dúvidas, entre em contato diretamente com a escola.</p>
        <p style="margin-top:24px;font-size:12px;color:#999;">Maple Bear Bento Gonçalves — sistema de solicitações online.</p>
      </div>
      `
    )

    return json({ ok: true })
  }

  return json({ error: 'Ação desconhecida' }, 400)
})
