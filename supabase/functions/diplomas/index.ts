import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

// ── PBKDF2 helpers (same pattern as gerentes) ──────────────
async function hashSenha(senha: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']
  )
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  const hashHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('')
  return saltHex + ':' + hashHex
}

async function verificarSenha(senha: string, hash: string): Promise<boolean> {
  const [saltHex, hashHex] = hash.split(':')
  if (!saltHex || !hashHex) return false
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']
  )
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  const computed = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('')
  return computed === hashHex
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Validate professora session token ──────────────────────
async function getProfessora(sb: ReturnType<typeof createClient>, token: string) {
  if (!token) return null
  const { data: sessao } = await sb
    .from('professora_sessoes')
    .select('professora_id, expira_em')
    .eq('token', token)
    .maybeSingle()
  if (!sessao || new Date(sessao.expira_em) < new Date()) return null
  const { data: prof } = await sb
    .from('professoras')
    .select('id, nome, email')
    .eq('id', sessao.professora_id)
    .maybeSingle()
  return prof ?? null
}

// ── Validate gerente session token ─────────────────────────
async function getGerente(sb: ReturnType<typeof createClient>, token: string) {
  if (!token) return null
  const { data: sessao } = await sb
    .from('gerente_sessoes')
    .select('gerente_id, expira_em')
    .eq('token', token)
    .maybeSingle()
  if (!sessao || new Date(sessao.expira_em) < new Date()) return null
  const { data: ger } = await sb
    .from('gerentes')
    .select('id, nome, email')
    .eq('id', sessao.gerente_id)
    .maybeSingle()
  return ger ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const body = await req.json()
  const { action } = body
  const authHeader = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()

  // ── PUBLIC: ranking (all teachers with approved points) ──
  if (action === 'ranking') {
    const { data: professoras } = await sb
      .from('professoras')
      .select('id, nome')
      .order('nome')

    if (!professoras) return json({ data: [] })

    // Sum approved diploma points per teacher
    const { data: diplomas } = await sb
      .from('diplomas_professoras')
      .select('professora_id, pontuacao')
      .eq('status', 'aprovado')

    const pontuacaoMap: Record<string, number> = {}
    for (const d of diplomas ?? []) {
      pontuacaoMap[d.professora_id] = (pontuacaoMap[d.professora_id] || 0) + d.pontuacao
    }

    const ranking = professoras.map(p => ({
      id: p.id,
      nome: p.nome,
      pontuacao: pontuacaoMap[p.id] || 0,
    })).sort((a, b) => b.pontuacao - a.pontuacao || a.nome.localeCompare(b.nome))

    return json({ data: ranking })
  }

  // ── PUBLIC: professora login ──────────────────────────────
  if (action === 'professora_login') {
    const email: string = (body.email || '').toLowerCase().trim()
    const senha: string = body.senha || ''
    if (!email || !senha) return json({ error: 'E-mail e senha são obrigatórios.' }, 400)

    const { data: prof } = await sb
      .from('professoras')
      .select('id, nome, email, senha_hash')
      .ilike('email', email)
      .maybeSingle()

    if (!prof || !prof.senha_hash) return json({ error: 'E-mail ou senha incorretos.' }, 401)

    const ok = await verificarSenha(senha, prof.senha_hash)
    if (!ok) return json({ error: 'E-mail ou senha incorretos.' }, 401)

    const token = randomToken()
    const expira_em = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
    await sb.from('professora_sessoes').insert({ professora_id: prof.id, token, expira_em })

    return json({ token, nome: prof.nome, email: prof.email })
  }

  // ── TEACHER AUTH ZONE ─────────────────────────────────────
  // All subsequent teacher actions need a valid professora token
  // Check if this is a teacher action or manager action
  const isTeacherAction = [
    'professora_logout', 'diploma_submit', 'meus_diplomas',
  ].includes(action)

  const isManagerAction = [
    'diplomas_pendentes', 'diplomas_all', 'diploma_aprovar',
    'diploma_rejeitar', 'professora_set_senha',
  ].includes(action)

  if (isTeacherAction) {
    const prof = await getProfessora(sb, authHeader)
    if (!prof) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    if (action === 'professora_logout') {
      await sb.from('professora_sessoes').delete().eq('token', authHeader)
      return json({ ok: true })
    }

    if (action === 'meus_diplomas') {
      const { data } = await sb
        .from('diplomas_professoras')
        .select('*')
        .eq('professora_id', prof.id)
        .order('criado_em', { ascending: false })
      return json({ data: data ?? [] })
    }

    if (action === 'diploma_submit') {
      const nome_curso: string = (body.nome_curso || '').trim()
      const carga_horaria: number = parseInt(body.carga_horaria) || 0
      const base64: string = body.base64 || ''
      const mime: string = body.mime || 'application/pdf'

      if (!nome_curso) return json({ error: 'Informe o nome do curso.' }, 400)
      if (carga_horaria <= 0) return json({ error: 'Carga horária deve ser maior que zero.' }, 400)
      if (!base64) return json({ error: 'Selecione o arquivo do diploma.' }, 400)

      // Upload file to Supabase Storage
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
      const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1] || 'jpg'
      const fileName = `${prof.id}/${Date.now()}.${ext}`

      const { error: uploadErr } = await sb.storage
        .from('diplomas')
        .upload(fileName, bytes, { contentType: mime, upsert: false })

      if (uploadErr) return json({ error: 'Erro ao fazer upload: ' + uploadErr.message }, 400)

      const { data: { publicUrl } } = sb.storage.from('diplomas').getPublicUrl(fileName)

      const { error: insErr } = await sb.from('diplomas_professoras').insert({
        professora_id: prof.id,
        nome_curso,
        carga_horaria,
        arquivo_url: publicUrl,
        status: 'pendente',
        pontuacao: 0,
      })

      if (insErr) return json({ error: insErr.message }, 400)
      return json({ ok: true })
    }
  }

  // ── MANAGER AUTH ZONE ─────────────────────────────────────
  if (isManagerAction) {
    const ger = await getGerente(sb, authHeader)
    if (!ger) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    if (action === 'professora_set_senha') {
      const { professora_id, senha } = body
      if (!professora_id || !senha) return json({ error: 'Dados incompletos.' }, 400)
      if (senha.length < 6) return json({ error: 'Senha mínima de 6 caracteres.' }, 400)
      const hash = await hashSenha(senha)
      const { error } = await sb
        .from('professoras')
        .update({ senha_hash: hash })
        .eq('id', professora_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'diplomas_pendentes') {
      const { data } = await sb
        .from('diplomas_professoras')
        .select('*, professoras(nome, email)')
        .eq('status', 'pendente')
        .order('criado_em', { ascending: true })
      return json({ data: data ?? [] })
    }

    if (action === 'diplomas_all') {
      const filterStatus: string | undefined = body.status
      let query = sb
        .from('diplomas_professoras')
        .select('*, professoras(nome, email)')
        .order('criado_em', { ascending: false })
      if (filterStatus && filterStatus !== 'todos') {
        query = query.eq('status', filterStatus)
      }
      const { data } = await query
      return json({ data: data ?? [] })
    }

    if (action === 'diploma_aprovar') {
      const { id } = body
      if (!id) return json({ error: 'ID do diploma não informado.' }, 400)

      const { data: diploma } = await sb
        .from('diplomas_professoras')
        .select('carga_horaria')
        .eq('id', id)
        .maybeSingle()

      if (!diploma) return json({ error: 'Diploma não encontrado.' }, 404)

      const { error } = await sb
        .from('diplomas_professoras')
        .update({
          status: 'aprovado',
          pontuacao: diploma.carga_horaria,
          validado_por: ger.nome,
          data_validacao: new Date().toISOString(),
          observacao: body.observacao || null,
        })
        .eq('id', id)

      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'diploma_rejeitar') {
      const { id, observacao } = body
      if (!id) return json({ error: 'ID do diploma não informado.' }, 400)

      const { error } = await sb
        .from('diplomas_professoras')
        .update({
          status: 'rejeitado',
          pontuacao: 0,
          validado_por: ger.nome,
          data_validacao: new Date().toISOString(),
          observacao: observacao || null,
        })
        .eq('id', id)

      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
  }

  return json({ error: 'Ação desconhecida' }, 400)
})
