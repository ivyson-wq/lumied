import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateChallenge, verifyRegistration, verifyAuthentication, b64urlEncode, b64urlDecode } from '../_shared/webauthn.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

async function criarNotif(sb: any, portal: string, destinatario: string, titulo: string, mensagem: string, tipo = 'info') {
  await sb.from('notificacoes').insert({ portal, destinatario, titulo, mensagem, tipo })
}

// ── PBKDF2 helpers ─────────────────────────────────────────
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

// ── Session validators ──────────────────────────────────────
async function getProfessora(sb: ReturnType<typeof createClient>, token: string) {
  if (!token) return null
  // Tenta sessão legada (professora_sessoes)
  const { data: sessao } = await sb
    .from('professora_sessoes').select('professora_id, expira_em')
    .eq('token', token).maybeSingle()
  if (sessao && new Date(sessao.expira_em) >= new Date()) {
    const { data } = await sb
      .from('professoras').select('id, nome, email')
      .eq('id', sessao.professora_id).maybeSingle()
    if (data) return data
  }
  // Fallback: sessão unificada (tabela sessoes/usuarios)
  const user = await getUsuario(sb, token)
  if (user && (user.papel === 'professora' || user.papel === 'gerente')) {
    // Busca dados da professora pelo mesmo ID ou email
    const { data: prof } = await sb
      .from('professoras').select('id, nome, email')
      .eq('id', user.id).maybeSingle()
    if (prof) return prof
    // Fallback por email
    const { data: profByEmail } = await sb
      .from('professoras').select('id, nome, email')
      .ilike('email', user.email).maybeSingle()
    if (profByEmail) return profByEmail
    // Se não existe na tabela professoras, retorna dados do usuario
    return { id: user.id, nome: user.nome, email: user.email }
  }
  return null
}

async function getGerente(sb: ReturnType<typeof createClient>, token: string) {
  if (!token) return null
  // Tenta sessão legada (gerente_sessoes)
  const { data: sessao } = await sb
    .from('gerente_sessoes').select('gerente_id, expira_em')
    .eq('token', token).maybeSingle()
  if (sessao && new Date(sessao.expira_em) >= new Date()) {
    const { data } = await sb
      .from('gerentes').select('id, nome, email')
      .eq('id', sessao.gerente_id).maybeSingle()
    if (data) return data
  }
  // Fallback: sessão unificada
  const user = await getUsuario(sb, token)
  if (user && user.papel === 'gerente') {
    const { data: ger } = await sb
      .from('gerentes').select('id, nome, email')
      .ilike('email', user.email).maybeSingle()
    if (ger) return ger
    return { id: user.id, nome: user.nome, email: user.email }
  }
  return null
}

async function getSecretaria(sb: ReturnType<typeof createClient>, token: string) {
  if (!token) return null
  // Tenta sessão legada (secretaria_sessoes)
  const { data: sessao } = await sb
    .from('secretaria_sessoes').select('secretaria_id, expira_em')
    .eq('token', token).maybeSingle()
  if (sessao && new Date(sessao.expira_em) >= new Date()) {
    const { data } = await sb
      .from('secretarias').select('id, nome, email')
      .eq('id', sessao.secretaria_id).maybeSingle()
    if (data) return data
  }
  // Fallback: sessão unificada
  const user = await getUsuario(sb, token)
  if (user && user.papel === 'secretaria') {
    const { data: sec } = await sb
      .from('secretarias').select('id, nome, email')
      .ilike('email', user.email).maybeSingle()
    if (sec) return sec
    return { id: user.id, nome: user.nome, email: user.email }
  }
  return null
}

// ── Unified session validator (new) ──────────────────────────
async function getUsuario(sb: ReturnType<typeof createClient>, token: string) {
  if (!token) return null
  const { data: sessao } = await sb
    .from('sessoes').select('usuario_id, expira_em')
    .eq('token', token).maybeSingle()
  if (!sessao || new Date(sessao.expira_em) < new Date()) return null
  const { data } = await sb
    .from('usuarios').select('id, nome, email, papel')
    .eq('id', sessao.usuario_id).maybeSingle()
  return data ?? null
}

// ── Parent (Supabase Auth JWT) validator ────────────────────
async function getPaiEmail(sb: ReturnType<typeof createClient>, token: string, fallbackEmail?: string): Promise<string | null> {
  if (token) {
    try {
      const { data: { user } } = await sb.auth.getUser(token)
      if (user?.email) return user.email.toLowerCase().trim()
    } catch (_) { /* ignora */ }
  }
  return fallbackEmail ? fallbackEmail.toLowerCase().trim() : null
}

// ── Pickup ETA helpers ──────────────────────────────────────
async function calcEtaGoogleMaps(
  latPai: number, lonPai: number
): Promise<{ etaMinutos: number; modo: string } | null> {
  const key = Deno.env.get('GOOGLE_MAPS_KEY')
  if (!key) return null
  const schoolLat = Deno.env.get('SCHOOL_LAT') || '-28.8628'
  const schoolLon = Deno.env.get('SCHOOL_LON') || '-51.5201'
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${latPai},${lonPai}` +
      `&destinations=${schoolLat},${schoolLon}` +
      `&mode=driving&language=pt-BR&key=${key}`
    const r = await fetch(url)
    const d = await r.json()
    const secs: number | undefined = d?.rows?.[0]?.elements?.[0]?.duration?.value
    if (!secs) return null
    return { etaMinutos: Math.ceil(secs / 60), modo: 'google_maps' }
  } catch {
    return null
  }
}

function calcEtaLocal(latPai: number, lonPai: number): number {
  const schoolLat = parseFloat(Deno.env.get('SCHOOL_LAT') || '-28.8628')
  const schoolLon = parseFloat(Deno.env.get('SCHOOL_LON') || '-51.5201')
  const R = 6371
  const dLat = (schoolLat - latPai) * Math.PI / 180
  const dLon = (schoolLon - lonPai) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(latPai * Math.PI / 180) * Math.cos(schoolLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.max(1, Math.ceil(dist / 40 * 60)) // 40 km/h average urban speed
}

// ── Upload helper ───────────────────────────────────────────
async function uploadArquivo(
  sb: ReturnType<typeof createClient>,
  bucket: string,
  ownerId: string,
  base64: string,
  mime: string
): Promise<{ url: string } | { error: string }> {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1] || 'jpg'
  const fileName = `${ownerId}/${Date.now()}.${ext}`
  const { error } = await sb.storage.from(bucket).upload(fileName, bytes, { contentType: mime, upsert: false })
  if (error) return { error: error.message }
  const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(fileName)
  return { url: publicUrl }
}

const ML_CLIENT_ID = '1358685762306521'
const ML_CLIENT_SECRET = 'jTYGWwi1V8XOxS7cpcfyrSNoI2bLiPFB'
const ML_REDIRECT_URI = 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/diplomas?action=ml_oauth_callback'

async function getMLToken(sb: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await sb.from('ml_tokens').select('*').order('atualizado_em', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  // Check if expired (with 5 min margin)
  if (new Date(data.expires_at) <= new Date(Date.now() + 5 * 60000)) {
    // Refresh
    try {
      const res = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&client_id=${ML_CLIENT_ID}&client_secret=${ML_CLIENT_SECRET}&refresh_token=${data.refresh_token}`,
      })
      if (res.ok) {
        const t = await res.json()
        await sb.from('ml_tokens').update({
          access_token: t.access_token,
          refresh_token: t.refresh_token,
          expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
          atualizado_em: new Date().toISOString(),
        }).eq('id', data.id)
        return t.access_token
      }
    } catch (_) {}
    return null
  }
  return data.access_token
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Handle OAuth callback (GET request from ML redirect)
  const url = new URL(req.url)
  if (url.searchParams.get('action') === 'ml_oauth_callback') {
    const code = url.searchParams.get('code')
    if (!code) return new Response('Codigo nao recebido.', { status: 400 })
    try {
      const res = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=authorization_code&client_id=${ML_CLIENT_ID}&client_secret=${ML_CLIENT_SECRET}&code=${code}&redirect_uri=${encodeURIComponent(ML_REDIRECT_URI)}`,
      })
      const t = await res.json()
      if (t.access_token) {
        // Delete old tokens
        const { error: delErr } = await sb.from('ml_tokens').delete().gte('criado_em', '2000-01-01')
        // Save new token
        const { error: insErr } = await sb.from('ml_tokens').insert({
          access_token: t.access_token,
          refresh_token: t.refresh_token || t.access_token,
          expires_at: new Date(Date.now() + (t.expires_in || 21600) * 1000).toISOString(),
          user_id: String(t.user_id || ''),
        })
        if (insErr) return new Response('Erro ao salvar token: ' + insErr.message, { status: 500 })
        return new Response(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mercado Livre Conectado</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Lora:wght@600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'DM Sans',sans-serif;background:#f8f5f0;min-height:100vh;display:flex;align-items:center;justify-content:center;}
.card{background:#fff;border-radius:20px;padding:48px 40px;max-width:420px;width:90%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.08);border:1px solid #e6ddd3;}
.icon{width:80px;height:80px;background:linear-gradient(135deg,#ffe600,#ffcd00);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:36px;box-shadow:0 4px 16px rgba(255,230,0,.3);}
h1{font-family:'Lora',serif;font-size:22px;color:#1a1a1a;margin-bottom:8px;}
p{font-size:14px;color:#7a7169;line-height:1.6;margin-bottom:24px;}
.badge{display:inline-flex;align-items:center;gap:6px;padding:6px 16px;background:#edf7f0;color:#2d7a3a;border-radius:100px;font-size:13px;font-weight:600;border:1px solid rgba(45,122,58,.2);margin-bottom:20px;}
.btn{display:inline-block;padding:12px 28px;background:#C8102E;color:#fff;border:none;border-radius:10px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;transition:background .2s;}
.btn:hover{background:#a00d24;}
.footer{margin-top:24px;font-size:11px;color:#bbb;}
</style></head><body>
<div class="card">
  <div class="icon">🛒</div>
  <div class="badge">✅ Conexao realizada</div>
  <h1>Mercado Livre Conectado!</h1>
  <p>Sua conta do Mercado Livre foi vinculada com sucesso ao sistema Maple Bear. Os precos dos insumos serao atualizados automaticamente.</p>
  <a href="/gerente.html" class="btn">Voltar ao Painel</a>
  <div class="footer">Maple Bear Caxias do Sul</div>
</div>
</body></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } })
      }
      return new Response('Erro ao obter token do ML: ' + JSON.stringify(t), { status: 400, headers: { 'Content-Type': 'text/plain' } })
    } catch (e) { return new Response('Erro: ' + (e as Error).message, { status: 500 }) }
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch (_) { body = {} }
  const { action } = body
  // Token: usa _prof_token/_token do body se presente (para evitar conflito com JWT Verification do Supabase),
  // senão extrai do Authorization header
  const authHeader = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  const token = body._prof_token || body._token || authHeader

  // ━━ PUBLIC ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  if (action === 'ranking') {
    const { data: professoras } = await sb.from('professoras').select('id, nome').order('nome')
    if (!professoras) return json({ data: [] })
    const { data: diplomas } = await sb
      .from('diplomas_professoras').select('professora_id, pontuacao').eq('status', 'aprovado')
    const map: Record<string, number> = {}
    for (const d of diplomas ?? []) map[d.professora_id] = (map[d.professora_id] || 0) + d.pontuacao
    const ranking = professoras
      .map(p => ({ id: p.id, nome: p.nome, pontuacao: map[p.id] || 0 }))
      .sort((a, b) => b.pontuacao - a.pontuacao || a.nome.localeCompare(b.nome))
    return json({ data: ranking })
  }

  // ── Login Unificado ──────────────────────────────────────────
  if (action === 'unified_login') {
    const email: string = (body.email || '').toLowerCase().trim()
    const senha: string = body.senha || ''
    const papelEsperado: string = body.papel || '' // opcional: filtra por papel
    if (!email || !senha) return json({ error: 'E-mail e senha são obrigatórios.' }, 400)
    const query = sb.from('usuarios').select('id, nome, email, senha_hash, papel').ilike('email', email)
    if (papelEsperado) query.eq('papel', papelEsperado)
    const { data: user } = await query.maybeSingle()
    if (!user || !user.senha_hash) return json({ error: 'E-mail ou senha incorretos.' }, 401)
    if (!await verificarSenha(senha, user.senha_hash)) return json({ error: 'E-mail ou senha incorretos.' }, 401)
    const tok = randomToken()
    await sb.from('sessoes').insert({ usuario_id: user.id, token: tok, expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })
    return json({ token: tok, nome: user.nome, email: user.email, papel: user.papel })
  }

  if (action === 'unified_logout') {
    await sb.from('sessoes').delete().eq('token', token)
    return json({ ok: true })
  }

  // ── Login legado (backward compat) ─────────────────────────
  if (action === 'professora_login') {
    const email: string = (body.email || '').toLowerCase().trim()
    const senha: string = body.senha || ''
    if (!email || !senha) return json({ error: 'E-mail e senha são obrigatórios.' }, 400)
    const { data: prof } = await sb
      .from('professoras').select('id, nome, email, senha_hash').ilike('email', email).maybeSingle()
    if (!prof || !prof.senha_hash) return json({ error: 'E-mail ou senha incorretos.' }, 401)
    if (!await verificarSenha(senha, prof.senha_hash)) return json({ error: 'E-mail ou senha incorretos.' }, 401)
    const tok = randomToken()
    await sb.from('professora_sessoes').insert({
      professora_id: prof.id, token: tok,
      expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    return json({ token: tok, nome: prof.nome, email: prof.email })
  }

  if (action === 'secretaria_login') {
    const email: string = (body.email || '').toLowerCase().trim()
    const senha: string = body.senha || ''
    if (!email || !senha) return json({ error: 'E-mail e senha são obrigatórios.' }, 400)
    const { data: sec } = await sb
      .from('secretarias').select('id, nome, email, senha_hash').ilike('email', email).maybeSingle()
    if (!sec || !sec.senha_hash) return json({ error: 'E-mail ou senha incorretos.' }, 401)
    if (!await verificarSenha(senha, sec.senha_hash)) return json({ error: 'E-mail ou senha incorretos.' }, 401)
    const tok = randomToken()
    await sb.from('secretaria_sessoes').insert({
      secretaria_id: sec.id, token: tok,
      expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    return json({ token: tok, nome: sec.nome, email: sec.email })
  }

  // ━━ TEACHER ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const isTeacherAction = [
    'professora_logout', 'diploma_submit', 'meus_diplomas',
    'atestado_submit', 'meus_atestados',
    'pdi_meu_status', 'pdi_autoavaliacao', 'pdi_metas_submit',
    'pdi_meta_progresso', 'pdi_checkin',
  ].includes(action)

  if (isTeacherAction) {
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    if (action === 'professora_logout') {
      await sb.from('professora_sessoes').delete().eq('token', token)
      return json({ ok: true })
    }

    if (action === 'meus_diplomas') {
      const { data } = await sb
        .from('diplomas_professoras').select('*')
        .eq('professora_id', prof.id).order('criado_em', { ascending: false })
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
      const up = await uploadArquivo(sb, 'diplomas', prof.id, base64, mime)
      if ('error' in up) return json({ error: 'Erro ao fazer upload: ' + up.error }, 400)
      const { error } = await sb.from('diplomas_professoras').insert({
        professora_id: prof.id, nome_curso, carga_horaria,
        arquivo_url: up.url, status: 'pendente', pontuacao: 0,
      })
      if (error) return json({ error: error.message }, 400)
      // Notifica todos os gerentes
      const { data: gerentes } = await sb.from('gerentes').select('email')
      for (const g of gerentes ?? []) {
        await criarNotif(sb, 'gerente', g.email, 'Novo diploma', `${prof.nome} enviou o diploma "${nome_curso}" (${carga_horaria}h) para validação.`, 'info')
      }
      return json({ ok: true })
    }

    if (action === 'meus_atestados') {
      const { data } = await sb
        .from('atestados_professoras').select('*')
        .eq('professora_id', prof.id).order('criado_em', { ascending: false })
      return json({ data: data ?? [] })
    }

    if (action === 'atestado_submit') {
      const data_inicio: string = body.data_inicio || ''
      const data_fim: string = body.data_fim || ''
      const motivo: string = (body.motivo || '').trim()
      const base64: string = body.base64 || ''
      const mime: string = body.mime || 'application/pdf'
      if (!data_inicio || !data_fim) return json({ error: 'Informe as datas do atestado.' }, 400)
      if (data_fim < data_inicio) return json({ error: 'Data de fim não pode ser anterior à data de início.' }, 400)
      if (!base64) return json({ error: 'Selecione o arquivo do atestado.' }, 400)
      const up = await uploadArquivo(sb, 'atestados', prof.id, base64, mime)
      if ('error' in up) return json({ error: 'Erro ao fazer upload: ' + up.error }, 400)
      const { error } = await sb.from('atestados_professoras').insert({
        professora_id: prof.id, data_inicio, data_fim,
        motivo: motivo || null, arquivo_url: up.url, status: 'pendente',
      })
      if (error) return json({ error: error.message }, 400)
      // Notifica todas as secretárias
      const { data: secs } = await sb.from('secretarias').select('email')
      for (const s of secs ?? []) {
        await criarNotif(sb, 'secretaria', s.email, 'Novo atestado', `${prof.nome} enviou um atestado (${data_inicio} a ${data_fim}) para validação.`, 'info')
      }
      return json({ ok: true })
    }

    // ── PDI: professora ─────────────────────────────────────

    if (action === 'pdi_meu_status') {
      // Retorna o ciclo ativo e o PDI da professora nesse ciclo
      const { data: ciclo } = await sb
        .from('pdi_ciclos').select('*').eq('ativo', true).maybeSingle()
      if (!ciclo) return json({ ciclo: null, pdi: null })
      const { data: pdi } = await sb
        .from('pdis')
        .select('*, pdi_competencias(*), pdi_metas(*), pdi_acompanhamentos(*)')
        .eq('professora_id', prof.id)
        .eq('ciclo_id', ciclo.id)
        .maybeSingle()
      return json({ ciclo, pdi: pdi ?? null })
    }

    if (action === 'pdi_autoavaliacao') {
      // body: { competencias: [{ area, nota_auto, comentario }] }
      const competencias: Array<{ area: string; nota_auto: number; comentario?: string }> =
        body.competencias || []
      const AREAS = [
        'linguagem', 'metodologia', 'avaliacao',
        'intercultural', 'colaboracao', 'inovacao', 'desenvolvimento',
      ]
      if (competencias.length !== 7 || !competencias.every(c => AREAS.includes(c.area)))
        return json({ error: 'Informe as 7 áreas de competência.' }, 400)
      for (const c of competencias)
        if (!c.nota_auto || c.nota_auto < 1 || c.nota_auto > 4)
          return json({ error: `Nota inválida para a área "${c.area}". Use 1 a 4.` }, 400)

      // Obtém ciclo ativo
      const { data: ciclo } = await sb
        .from('pdi_ciclos').select('id').eq('ativo', true).maybeSingle()
      if (!ciclo) return json({ error: 'Não há ciclo de PDI ativo no momento.' }, 400)

      // Garante ou cria PDI rascunho
      let pdiId: string
      const { data: pdiExist } = await sb
        .from('pdis').select('id, status').eq('professora_id', prof.id).eq('ciclo_id', ciclo.id).maybeSingle()
      if (pdiExist) {
        if (['em_andamento', 'encerrado'].includes(pdiExist.status))
          return json({ error: 'PDI já aprovado. Contate a gestora para alterações.' }, 400)
        pdiId = pdiExist.id
      } else {
        const { data: novo, error: errCria } = await sb
          .from('pdis').insert({ professora_id: prof.id, ciclo_id: ciclo.id, status: 'rascunho' })
          .select('id').single()
        if (errCria) return json({ error: errCria.message }, 400)
        pdiId = novo.id
      }

      // Upsert competências
      for (const c of competencias) {
        await sb.from('pdi_competencias').upsert(
          { pdi_id: pdiId, area: c.area, nota_auto: c.nota_auto, comentario: c.comentario ?? null },
          { onConflict: 'pdi_id,area' }
        )
      }
      return json({ ok: true, pdi_id: pdiId })
    }

    if (action === 'pdi_metas_submit') {
      // body: { pdi_id, metas: [{ descricao, indicador, prazo, area_vinculada? }] }
      const { pdi_id } = body
      const metas: Array<{ descricao: string; indicador: string; prazo: string; area_vinculada?: string }> =
        body.metas || []
      if (!pdi_id) return json({ error: 'pdi_id obrigatório.' }, 400)
      if (metas.length < 1 || metas.length > 5)
        return json({ error: 'Informe entre 1 e 5 metas.' }, 400)
      for (const m of metas)
        if (!m.descricao || !m.indicador || !m.prazo)
          return json({ error: 'Todos os campos das metas são obrigatórios.' }, 400)

      // Verifica que o PDI pertence à professora
      const { data: pdi } = await sb
        .from('pdis').select('id, status').eq('id', pdi_id).eq('professora_id', prof.id).maybeSingle()
      if (!pdi) return json({ error: 'PDI não encontrado.' }, 404)
      if (['em_andamento', 'encerrado'].includes(pdi.status))
        return json({ error: 'PDI já aprovado. Contate a gestora para alterações.' }, 400)

      // Remove metas antigas e insere novas
      await sb.from('pdi_metas').delete().eq('pdi_id', pdi_id)
      const { error } = await sb.from('pdi_metas').insert(
        metas.map(m => ({
          pdi_id,
          descricao: m.descricao,
          indicador: m.indicador,
          prazo: m.prazo,
          area_vinculada: m.area_vinculada ?? null,
          status: 'pendente',
          progressao_pct: 0,
        }))
      )
      if (error) return json({ error: error.message }, 400)

      // Avança status do PDI para aguardando_aprovacao
      await sb.from('pdis').update({
        status: 'aguardando_aprovacao',
        submetido_em: new Date().toISOString(),
      }).eq('id', pdi_id)

      return json({ ok: true })
    }

    if (action === 'pdi_meta_progresso') {
      // body: { meta_id, progressao_pct, status, evidencia_texto?, diploma_id? }
      const { meta_id } = body
      const progressao_pct: number = parseInt(body.progressao_pct ?? '0')
      const status: string = body.status || ''
      if (!meta_id) return json({ error: 'meta_id obrigatório.' }, 400)
      if (progressao_pct < 0 || progressao_pct > 100)
        return json({ error: 'Progresso deve ser entre 0 e 100.' }, 400)
      const STATUS_VALIDOS = ['pendente', 'em_andamento', 'concluido', 'revisado']
      if (!STATUS_VALIDOS.includes(status))
        return json({ error: 'Status inválido.' }, 400)

      // Verifica ownership
      const { data: meta } = await sb
        .from('pdi_metas')
        .select('id, pdi_id, pdis!inner(professora_id)')
        .eq('id', meta_id)
        .maybeSingle()
      if (!meta) return json({ error: 'Meta não encontrada.' }, 404)
      const pdiOwner = (meta as Record<string, unknown> & { pdis: { professora_id: string } }).pdis
      if (pdiOwner.professora_id !== prof.id)
        return json({ error: 'Sem permissão.' }, 403)

      const { error } = await sb.from('pdi_metas').update({
        progressao_pct,
        status,
        evidencia_texto: body.evidencia_texto ?? null,
        diploma_id: body.diploma_id ?? null,
      }).eq('id', meta_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'pdi_checkin') {
      // body: { pdi_id, tipo, relato_professora }
      const { pdi_id } = body
      const tipo: string = body.tipo || ''
      const relato: string = (body.relato_professora || '').trim()
      if (!pdi_id || !tipo || !relato) return json({ error: 'Preencha todos os campos do check-in.' }, 400)
      if (!['semestral', 'final'].includes(tipo)) return json({ error: 'Tipo inválido.' }, 400)

      const { data: pdi } = await sb
        .from('pdis').select('id, status').eq('id', pdi_id).eq('professora_id', prof.id).maybeSingle()
      if (!pdi) return json({ error: 'PDI não encontrado.' }, 404)
      if (pdi.status !== 'em_andamento')
        return json({ error: 'Só é possível registrar check-in em PDIs em andamento.' }, 400)

      const { error } = await sb.from('pdi_acompanhamentos').insert({
        pdi_id, tipo, relato_professora: relato,
      })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
  }

  // ━━ SECRETARIA ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const isSecretariaAction = [
    'secretaria_logout', 'atestados_pendentes', 'atestados_all',
    'atestado_aprovar', 'atestado_rejeitar',
  ].includes(action)

  if (isSecretariaAction) {
    const sec = await getSecretaria(sb, token)
    if (!sec) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    if (action === 'secretaria_logout') {
      await sb.from('secretaria_sessoes').delete().eq('token', token)
      return json({ ok: true })
    }

    if (action === 'atestados_pendentes') {
      const { data } = await sb
        .from('atestados_professoras').select('*, professoras(nome, email)')
        .eq('status', 'pendente').order('criado_em', { ascending: true })
      return json({ data: data ?? [] })
    }

    if (action === 'atestados_all') {
      const filterStatus: string | undefined = body.status
      let query = sb
        .from('atestados_professoras').select('*, professoras(nome, email)')
        .order('data_inicio', { ascending: false })
      if (filterStatus && filterStatus !== 'todos') query = query.eq('status', filterStatus)
      const { data } = await query
      return json({ data: data ?? [] })
    }

    if (action === 'atestado_aprovar') {
      const { id } = body
      if (!id) return json({ error: 'ID do atestado não informado.' }, 400)
      const { data: atest } = await sb.from('atestados_professoras').select('professora_id, data_inicio, data_fim, professoras(email)').eq('id', id).maybeSingle()
      const { error } = await sb.from('atestados_professoras').update({
        status: 'aprovado',
        validado_por: sec.nome,
        data_validacao: new Date().toISOString(),
        observacao: body.observacao || null,
      }).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      const profEmail = atest?.professoras?.email
      if (profEmail) await criarNotif(sb, 'professora', profEmail, 'Atestado aprovado', `Seu atestado (${atest.data_inicio} a ${atest.data_fim}) foi ✅ aprovado pela secretaria.`, 'success')
      return json({ ok: true })
    }

    if (action === 'atestado_rejeitar') {
      const { id } = body
      if (!id) return json({ error: 'ID do atestado não informado.' }, 400)
      const { data: atest } = await sb.from('atestados_professoras').select('professora_id, data_inicio, data_fim, professoras(email)').eq('id', id).maybeSingle()
      const { error } = await sb.from('atestados_professoras').update({
        status: 'rejeitado',
        validado_por: sec.nome,
        data_validacao: new Date().toISOString(),
        observacao: body.observacao || null,
      }).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      const profEmail = atest?.professoras?.email
      if (profEmail) await criarNotif(sb, 'professora', profEmail, 'Atestado rejeitado', `Seu atestado (${atest.data_inicio} a ${atest.data_fim}) foi ❌ rejeitado.${body.observacao ? ' Motivo: ' + body.observacao : ''}`, 'error')
      return json({ ok: true })
    }
  }

  // ━━ MANAGER ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const isManagerAction = [
    'diplomas_pendentes', 'diplomas_all', 'diploma_aprovar', 'diploma_rejeitar',
    'professora_set_senha',
    'secretarias_list', 'secretaria_create', 'secretaria_delete',
    'pdi_ciclos_list', 'pdi_ciclo_criar', 'pdi_painel',
    'pdi_prof_view', 'pdi_aprovar', 'pdi_rejeitar',
    'pdi_competencias_gerente', 'pdi_nota_final', 'pdi_checkin_feedback',
  ].includes(action)

  if (isManagerAction) {
    const ger = await getGerente(sb, token)
    if (!ger) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    if (action === 'professora_set_senha') {
      const { professora_id, senha } = body
      if (!professora_id || !senha) return json({ error: 'Dados incompletos.' }, 400)
      if (senha.length < 6) return json({ error: 'Senha mínima de 6 caracteres.' }, 400)
      const { error } = await sb.from('professoras')
        .update({ senha_hash: await hashSenha(senha) }).eq('id', professora_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'diplomas_pendentes') {
      const { data } = await sb
        .from('diplomas_professoras').select('*, professoras(nome, email)')
        .eq('status', 'pendente').order('criado_em', { ascending: true })
      return json({ data: data ?? [] })
    }

    if (action === 'diplomas_all') {
      const filterStatus: string | undefined = body.status
      let query = sb.from('diplomas_professoras').select('*, professoras(nome, email)')
        .order('criado_em', { ascending: false })
      if (filterStatus && filterStatus !== 'todos') query = query.eq('status', filterStatus)
      const { data } = await query
      return json({ data: data ?? [] })
    }

    if (action === 'diploma_aprovar') {
      const { id } = body
      if (!id) return json({ error: 'ID do diploma não informado.' }, 400)
      const { data: diploma } = await sb
        .from('diplomas_professoras').select('carga_horaria, nome_curso, professora_id, professoras(email)').eq('id', id).maybeSingle()
      if (!diploma) return json({ error: 'Diploma não encontrado.' }, 404)
      const { error } = await sb.from('diplomas_professoras').update({
        status: 'aprovado', pontuacao: diploma.carga_horaria,
        validado_por: ger.nome, data_validacao: new Date().toISOString(),
        observacao: body.observacao || null,
      }).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      const profEmail = diploma.professoras?.email
      if (profEmail) await criarNotif(sb, 'professora', profEmail, 'Diploma aprovado', `Seu diploma "${diploma.nome_curso}" foi ✅ aprovado! +${diploma.carga_horaria} pontos.`, 'success')
      return json({ ok: true })
    }

    if (action === 'diploma_rejeitar') {
      const { id } = body
      if (!id) return json({ error: 'ID do diploma não informado.' }, 400)
      const { data: diploma } = await sb
        .from('diplomas_professoras').select('nome_curso, professora_id, professoras(email)').eq('id', id).maybeSingle()
      const { error } = await sb.from('diplomas_professoras').update({
        status: 'rejeitado', pontuacao: 0,
        validado_por: ger.nome, data_validacao: new Date().toISOString(),
        observacao: body.observacao || null,
      }).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      const profEmail = diploma?.professoras?.email
      if (profEmail) await criarNotif(sb, 'professora', profEmail, 'Diploma rejeitado', `Seu diploma "${diploma.nome_curso}" foi ❌ rejeitado.${body.observacao ? ' Motivo: ' + body.observacao : ''}`, 'error')
      return json({ ok: true })
    }

    if (action === 'secretarias_list') {
      const { data } = await sb.from('secretarias').select('id, nome, email, criado_em').order('nome')
      return json({ data: data ?? [] })
    }

    if (action === 'secretaria_create') {
      const nome: string = (body.nome || '').trim()
      const email: string = (body.email || '').toLowerCase().trim()
      const senha: string = body.senha || ''
      if (!nome || !email || !senha) return json({ error: 'Preencha todos os campos.' }, 400)
      if (senha.length < 6) return json({ error: 'Senha mínima de 6 caracteres.' }, 400)
      const { error } = await sb.from('secretarias').insert({ nome, email, senha_hash: await hashSenha(senha) })
      if (error) return json({ error: error.code === '23505' ? 'E-mail já cadastrado.' : error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'secretaria_delete') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('secretarias').delete().eq('id', id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    // ── PDI: gestora ────────────────────────────────────────

    if (action === 'pdi_ciclos_list') {
      const { data } = await sb.from('pdi_ciclos').select('*').order('ano', { ascending: false })
      return json({ data: data ?? [] })
    }

    if (action === 'pdi_ciclo_criar') {
      const nome: string = (body.nome || '').trim()
      const ano: number = parseInt(body.ano) || new Date().getFullYear()
      const data_inicio: string = body.data_inicio || ''
      const data_fim: string = body.data_fim || ''
      if (!nome || !data_inicio || !data_fim) return json({ error: 'Preencha todos os campos.' }, 400)
      // Desativa ciclos anteriores do mesmo ano
      await sb.from('pdi_ciclos').update({ ativo: false }).eq('ano', ano)
      const { error } = await sb.from('pdi_ciclos').insert({
        nome, ano, data_inicio, data_fim, ativo: true, criado_por: ger.nome,
      })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'pdi_painel') {
      // Retorna overview de todas as professoras para um ciclo
      // body: { ciclo_id? } — se omitido, usa o ciclo ativo
      let cicloId: string = body.ciclo_id || ''
      if (!cicloId) {
        const { data: ciclo } = await sb.from('pdi_ciclos').select('id').eq('ativo', true).maybeSingle()
        if (!ciclo) return json({ ciclo: null, professoras: [] })
        cicloId = ciclo.id
      }
      const { data: ciclo } = await sb.from('pdi_ciclos').select('*').eq('id', cicloId).maybeSingle()
      const { data: professoras } = await sb.from('professoras').select('id, nome, email').order('nome')
      const { data: pdis } = await sb
        .from('pdis').select('id, professora_id, status, submetido_em, aprovado_em, nota_final')
        .eq('ciclo_id', cicloId)

      const pdiMap: Record<string, typeof pdis[0]> = {}
      for (const p of pdis ?? []) pdiMap[p.professora_id] = p

      const resultado = (professoras ?? []).map(p => ({
        professora: p,
        pdi: pdiMap[p.id] ?? null,
      }))
      return json({ ciclo, professoras: resultado })
    }

    if (action === 'pdi_prof_view') {
      // Retorna PDI completo de uma professora em um ciclo
      const { pdi_id } = body
      if (!pdi_id) return json({ error: 'pdi_id obrigatório.' }, 400)
      const { data: pdi } = await sb
        .from('pdis')
        .select(`
          *,
          professoras(id, nome, email),
          pdi_ciclos(id, nome, ano),
          pdi_competencias(*),
          pdi_metas(*),
          pdi_acompanhamentos(*)
        `)
        .eq('id', pdi_id)
        .maybeSingle()
      if (!pdi) return json({ error: 'PDI não encontrado.' }, 404)
      return json({ data: pdi })
    }

    if (action === 'pdi_aprovar') {
      const { pdi_id, feedback } = body
      if (!pdi_id) return json({ error: 'pdi_id obrigatório.' }, 400)
      const { data: pdi } = await sb.from('pdis').select('id, status, professora_id, professoras(email)').eq('id', pdi_id).maybeSingle()
      if (!pdi) return json({ error: 'PDI não encontrado.' }, 404)
      if (pdi.status !== 'aguardando_aprovacao')
        return json({ error: 'PDI não está aguardando aprovação.' }, 400)
      const { error } = await sb.from('pdis').update({
        status: 'em_andamento',
        feedback_gestora: feedback ?? null,
        aprovado_em: new Date().toISOString(),
      }).eq('id', pdi_id)
      if (error) return json({ error: error.message }, 400)
      const profEmail = pdi.professoras?.email
      if (profEmail) await criarNotif(sb, 'professora', profEmail, 'PDI aprovado', `Seu PDI foi ✅ aprovado e está em andamento.${feedback ? ' Feedback: ' + feedback : ''}`, 'success')
      return json({ ok: true })
    }

    if (action === 'pdi_rejeitar') {
      const { pdi_id, feedback } = body
      if (!pdi_id || !feedback) return json({ error: 'Informe pdi_id e feedback.' }, 400)
      const { data: pdi } = await sb.from('pdis').select('id, status, professora_id, professoras(email)').eq('id', pdi_id).maybeSingle()
      if (!pdi) return json({ error: 'PDI não encontrado.' }, 404)
      const { error } = await sb.from('pdis').update({
        status: 'rascunho',
        feedback_gestora: feedback,
        submetido_em: null,
      }).eq('id', pdi_id)
      if (error) return json({ error: error.message }, 400)
      const profEmail = pdi.professoras?.email
      if (profEmail) await criarNotif(sb, 'professora', profEmail, 'PDI devolvido', `Seu PDI foi devolvido para revisão. Feedback: ${feedback}`, 'warning')
      return json({ ok: true })
    }

    if (action === 'pdi_competencias_gerente') {
      // body: { pdi_id, competencias: [{ area, nota_gestora, comentario? }] }
      const { pdi_id } = body
      const competencias: Array<{ area: string; nota_gestora: number; comentario?: string }> =
        body.competencias || []
      if (!pdi_id) return json({ error: 'pdi_id obrigatório.' }, 400)
      for (const c of competencias) {
        if (!c.nota_gestora || c.nota_gestora < 1 || c.nota_gestora > 4)
          return json({ error: `Nota inválida para "${c.area}".` }, 400)
        await sb.from('pdi_competencias').upsert(
          { pdi_id, area: c.area, nota_gestora: c.nota_gestora, comentario: c.comentario ?? null },
          { onConflict: 'pdi_id,area' }
        )
      }
      return json({ ok: true })
    }

    if (action === 'pdi_nota_final') {
      // body: { pdi_id, nota_final (1-4), feedback_gestora }
      const { pdi_id } = body
      const nota_final: number = parseInt(body.nota_final) || 0
      const feedback: string = (body.feedback_gestora || '').trim()
      if (!pdi_id) return json({ error: 'pdi_id obrigatório.' }, 400)
      if (nota_final < 1 || nota_final > 4) return json({ error: 'Nota final deve ser entre 1 e 4.' }, 400)
      if (!feedback) return json({ error: 'Informe o feedback final.' }, 400)
      const { data: pdi } = await sb.from('pdis').select('id, status').eq('id', pdi_id).maybeSingle()
      if (!pdi) return json({ error: 'PDI não encontrado.' }, 404)
      if (pdi.status !== 'em_andamento')
        return json({ error: 'Só é possível encerrar PDIs em andamento.' }, 400)
      const { error } = await sb.from('pdis').update({
        status: 'encerrado',
        nota_final,
        feedback_gestora: feedback,
        encerrado_em: new Date().toISOString(),
      }).eq('id', pdi_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'pdi_checkin_feedback') {
      // body: { acompanhamento_id, feedback_gestora }
      const { acompanhamento_id, feedback_gestora } = body
      if (!acompanhamento_id || !feedback_gestora)
        return json({ error: 'Informe acompanhamento_id e feedback.' }, 400)
      const { error } = await sb.from('pdi_acompanhamentos')
        .update({ feedback_gestora })
        .eq('id', acompanhamento_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
  }

  // ━━ PICKUP: PARENT ACTIONS (Supabase Auth JWT) ━━━━━━━━━━━━

  const isPickupPaiAction = [
    'pickup_meus_filhos', 'pickup_avisar', 'pickup_cancelar', 'pickup_chegou', 'pickup_meus_hoje',
  ].includes(action)

  if (isPickupPaiAction) {
    const emailPai = await getPaiEmail(sb, token, body._email)
    if (!emailPai) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    if (action === 'pickup_meus_filhos') {
      // Busca crianças pelo email logado E por outros emails do mesmo responsável
      const { data: meusRegs } = await sb
        .from('solicitacoes').select('nome_resp')
        .ilike('email', emailPai).limit(1)
      const nomeResp = meusRegs?.[0]?.nome_resp

      let sols: any[] = []
      if (nomeResp) {
        // Busca todas as crianças do mesmo responsável (qualquer email)
        const { data } = await sb
          .from('solicitacoes').select('nome_crianca, serie')
          .ilike('nome_resp', nomeResp).order('criado_em', { ascending: false })
        sols = data ?? []
      } else {
        // Fallback: busca apenas pelo email
        const { data } = await sb
          .from('solicitacoes').select('nome_crianca, serie')
          .ilike('email', emailPai).order('criado_em', { ascending: false })
        sols = data ?? []
      }

      // Fallback: busca também na tabela familias
      const { data: fams } = await sb
        .from('familias').select('nome_aluno, serie')
        .ilike('email', emailPai)
      if (fams?.length) {
        for (const f of fams) {
          sols.push({ nome_crianca: f.nome_aluno, serie: f.serie ?? null })
        }
      }

      const seen = new Set<string>()
      const filhos = sols.filter(s => {
        if (seen.has(s.nome_crianca)) return false
        seen.add(s.nome_crianca); return true
      })
      return json({ data: filhos })
    }

    if (action === 'pickup_avisar') {
      const nome_crianca: string = (body.nome_crianca || '').trim()
      const serie: string        = (body.serie || '').trim()
      // Busca nome real do responsável no banco
      let nome_resp: string = (body.nome_resp || '').trim()
      if (!nome_resp) {
        const { data: respData } = await sb
          .from('solicitacoes').select('nome_resp')
          .ilike('email', emailPai).limit(1)
        nome_resp = respData?.[0]?.nome_resp || emailPai
      }
      const lat_pai: number | null = body.lat_pai != null ? parseFloat(body.lat_pai) : null
      const lon_pai: number | null = body.lon_pai != null ? parseFloat(body.lon_pai) : null
      const eta_manual: number | null = body.eta_minutos ? parseInt(body.eta_minutos) : null

      if (!nome_crianca) return json({ error: 'Informe o nome da criança.' }, 400)

      // Check no active notification for this child today
      const today = new Date().toISOString().split('T')[0]
      const { data: existing } = await sb
        .from('pickup_notificacoes').select('id, status')
        .eq('email_pai', emailPai).eq('nome_crianca', nome_crianca)
        .gte('saiu_em', today + 'T00:00:00Z').in('status', ['a_caminho', 'chegou'])
        .maybeSingle()
      if (existing) return json({ error: 'Já existe um aviso ativo para essa criança hoje.' }, 400)

      // Calculate ETA
      let eta_minutos: number | null = eta_manual
      let eta_modo = 'manual'

      if (lat_pai != null && lon_pai != null) {
        const gmaps = await calcEtaGoogleMaps(lat_pai, lon_pai)
        if (gmaps) {
          eta_minutos = gmaps.etaMinutos
          eta_modo    = gmaps.modo
        } else {
          // Fallback: local calculation
          eta_minutos = calcEtaLocal(lat_pai, lon_pai)
          eta_modo    = 'calculo_local'
        }
      }

      const { data: novo, error: err } = await sb.from('pickup_notificacoes').insert({
        email_pai: emailPai, nome_resp, nome_crianca,
        serie: serie || null, lat_pai, lon_pai,
        eta_minutos, eta_modo, status: 'a_caminho',
      }).select('id, eta_minutos, eta_modo').single()
      if (err) return json({ error: err.message }, 400)
      return json({ ok: true, id: novo.id, eta_minutos: novo.eta_minutos, eta_modo: novo.eta_modo })
    }

    if (action === 'pickup_cancelar') {
      const { id } = body
      if (!id) return json({ error: 'ID do aviso não informado.' }, 400)
      const { error } = await sb.from('pickup_notificacoes').update({ status: 'cancelado' })
        .eq('id', id).eq('email_pai', emailPai).in('status', ['a_caminho', 'chegou'])
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'pickup_chegou') {
      const { id } = body
      if (!id) return json({ error: 'ID do aviso não informado.' }, 400)
      const { error } = await sb.from('pickup_notificacoes').update({
        status: 'chegou', chegou_em: new Date().toISOString()
      }).eq('id', id).eq('email_pai', emailPai).eq('status', 'a_caminho')
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'pickup_meus_hoje') {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await sb
        .from('pickup_notificacoes').select('*')
        .eq('email_pai', emailPai)
        .gte('saiu_em', today + 'T00:00:00Z')
        .order('saiu_em', { ascending: false })
      return json({ data: data ?? [] })
    }
  }

  // ━━ PICKUP: TEACHER ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const isPickupProfAction = [
    'pickup_fila_hoje', 'pickup_entregar', 'professora_update_series', 'series_list_pub',
  ].includes(action)

  if (isPickupProfAction) {
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    if (action === 'series_list_pub') {
      const { data } = await sb.from('series').select('nome').order('nome')
      return json({ data: (data ?? []).map((s: { nome: string }) => s.nome) })
    }

    if (action === 'professora_update_series') {
      const series_monitoras: string[] = body.series_monitoras || []
      const { error } = await sb.from('professoras').update({ series_monitoras }).eq('id', prof.id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'pickup_fila_hoje') {
      const today = new Date().toISOString().split('T')[0]
      // Get professora's monitored series
      const { data: profData } = await sb
        .from('professoras').select('series_monitoras').eq('id', prof.id).maybeSingle()
      const series: string[] = profData?.series_monitoras || []

      let query = sb
        .from('pickup_notificacoes').select('*')
        .gte('saiu_em', today + 'T00:00:00Z')
        .in('status', ['a_caminho', 'chegou'])
        .order('saiu_em', { ascending: true })

      // Filter by series only if the teacher has configured them
      if (series.length > 0) query = query.in('serie', series)

      const { data } = await query
      return json({ data: data ?? [], series_monitoras: series })
    }

    if (action === 'pickup_entregar') {
      const { id } = body
      if (!id) return json({ error: 'ID do aviso não informado.' }, 400)
      const { error } = await sb.from('pickup_notificacoes').update({
        status: 'entregue',
        entregue_em: new Date().toISOString(),
        entregue_por: prof.nome,
      }).eq('id', id).in('status', ['a_caminho', 'chegou'])
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
  }

  // ━━ ALMOXARIFADO: PRICE SEARCH (public, no auth required) ━━━━━━

  if (action === 'alm_buscar_precos') {
    const { nome, unidade } = body
    if (!nome) return json({ error: 'Nome do item não informado.' }, 400)

    const query = nome.trim()
    const encoded = encodeURIComponent(query)

    // ── helper: word-overlap match % ────────────────────────
    function matchPct(qry: string, title: string): number {
      const norm = (s: string) =>
        s.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)
      const qWords = norm(qry)
      if (!qWords.length) return 0
      const tSet = new Set(norm(title))
      return Math.round((qWords.filter(w => tSet.has(w)).length / qWords.length) * 100)
    }

    type PriceResult = {
      plataforma: string
      nome: string
      preco: number | null
      preco_fmt: string
      url_produto: string
      url_carrinho: string | null   // pre-filled cart link where available
      item_id: string | null        // platform product ID (ML: "MLB...", Shopee: shopid/itemid)
      match: number
      tipo: 'produto' | 'busca'
    }
    const results: PriceResult[] = []

    // ── 0. Zoom.com.br (comparador de preços — scraping) ─────
    try {
      const zoomRes = await fetch(
        `https://www.zoom.com.br/search?q=${encoded}`,
        { headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
      )
      if (zoomRes.ok) {
        const html = await zoomRes.text()
        // Extract product cards via regex
        const cardRegex = /data-testid="product-card"[\s\S]*?<\/a>/g
        const titleRegex = /class="[^"]*ProductCard_ProductCard_Name[^"]*"[^>]*>([^<]+)/
        const priceRegex = /R\$\s*([\d]+[.,][\d]{2})/
        const hrefRegex = /href="(\/[^"]+)"/
        let cm
        let zoomCount = 0
        while ((cm = cardRegex.exec(html)) !== null && zoomCount < 5) {
          const block = cm[0]
          const tMatch = titleRegex.exec(block)
          const pMatch = priceRegex.exec(block)
          const hMatch = hrefRegex.exec(block)
          if (tMatch && pMatch) {
            const nome = tMatch[1].trim()
            const preco = parseFloat(pMatch[1].replace('.','').replace(',','.'))
            const m = matchPct(query, nome)
            results.push({
              plataforma: 'Zoom',
              nome,
              preco: isNaN(preco) ? null : preco,
              preco_fmt: !isNaN(preco) ? `R$ ${preco.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—',
              url_produto: hMatch ? `https://www.zoom.com.br${hMatch[1]}` : `https://www.zoom.com.br/search?q=${encoded}`,
              url_carrinho: null,
              item_id: null,
              match: m,
              tipo: 'produto',
            })
            zoomCount++
          }
        }
        // Fallback: parse simple price pattern if product cards not found
        if (zoomCount === 0) {
          const simplePrices = html.match(/R\$\s*([\d]+[.,][\d]{2})/g)
          if (simplePrices?.length) {
            const p = parseFloat(simplePrices[0].replace('R$','').trim().replace('.','').replace(',','.'))
            if (!isNaN(p) && p > 0) {
              results.push({
                plataforma: 'Zoom', nome: `${query} (melhor preço Zoom)`, preco: p,
                preco_fmt: `R$ ${p.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                url_produto: `https://www.zoom.com.br/search?q=${encoded}`,
                url_carrinho: null, item_id: null, match: 70, tipo: 'produto',
              })
            }
          }
        }
      }
    } catch (_) { /* graceful skip */ }

    // Fallback Zoom
    if (!results.some(r => r.plataforma === 'Zoom')) {
      results.push({ plataforma: 'Zoom', nome: `Buscar "${query}" no Zoom`, preco: null, preco_fmt: 'Ver no Zoom', url_produto: `https://www.zoom.com.br/search?q=${encoded}`, url_carrinho: null, item_id: null, match: 0, tipo: 'busca' })
    }

    // ── 1. Mercado Livre (OAuth API) ──────
    try {
      const mlToken = await getMLToken(sb)
      const mlHeaders: Record<string, string> = { 'Accept': 'application/json' }
      if (mlToken) mlHeaders['Authorization'] = `Bearer ${mlToken}`
      const mlRes = await fetch(
        `https://api.mercadolibre.com/sites/MLB/search?q=${encoded}&limit=6&sort=price_asc`,
        { headers: mlHeaders }
      )
      if (mlRes.ok) {
        const mlData = await mlRes.json()
        for (const item of (mlData.results ?? []).slice(0, 5)) {
          const m = matchPct(query, item.title ?? '')
          const mlId = item.id ?? null   // e.g. "MLB2912484956"
          // ML checkout URL: pre-fills item in cart/checkout flow
          const urlCarrinho = mlId
            ? `https://www.mercadolivre.com.br/checkout/buy?item.id=${mlId}&item.quantity=1`
            : null
          results.push({
            plataforma: 'Mercado Livre',
            nome: item.title ?? '',
            preco: item.price ?? null,
            preco_fmt: item.price != null
              ? `R$ ${parseFloat(item.price).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
              : '—',
            url_produto: item.permalink ?? `https://lista.mercadolivre.com.br/${encoded}`,
            url_carrinho: urlCarrinho,
            item_id: mlId,
            match: m,
            tipo: 'produto',
          })
        }
      }
    } catch (_) { /* graceful skip */ }

    // Fallback: se ML não retornou produtos, adiciona link de busca
    if (!results.some(r => r.plataforma === 'Mercado Livre')) {
      results.push({
        plataforma: 'Mercado Livre',
        nome: `Buscar "${query}" no Mercado Livre`,
        preco: null, preco_fmt: 'Ver no ML',
        url_produto: `https://lista.mercadolivre.com.br/${encoded}`,
        url_carrinho: null, item_id: null, match: 0, tipo: 'busca',
      })
    }

    // ── 2. Shopee Brasil (unofficial endpoint, real prices) ──
    try {
      const shopeeRes = await fetch(
        `https://shopee.com.br/api/v4/search/search_items?keyword=${encoded}&limit=5&newest=0&by=price&order=asc&page_type=search&scenario=PAGE_GLOBAL_SEARCH`,
        {
          headers: {
            'Accept': 'application/json',
            'Referer': 'https://shopee.com.br/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'x-shopee-language': 'pt-BR',
          },
        }
      )
      if (shopeeRes.ok) {
        const shopeeData = await shopeeRes.json()
        const items: any[] = shopeeData?.items ?? shopeeData?.data?.items ?? []
        for (const raw of items.slice(0, 5)) {
          const it = raw.item_basic ?? raw
          const shopid = it.shopid ?? it.shop_id
          const itemid = it.itemid ?? it.item_id
          const rawPrice = it.price_min ?? it.price ?? null
          const preco = rawPrice != null ? rawPrice / 100000 : null
          const urlProd = shopid && itemid
            ? `https://shopee.com.br/product/${shopid}/${itemid}`
            : `https://shopee.com.br/search?keyword=${encoded}`
          // Shopee has no public add-to-cart URL — product page is the entry point
          const m = matchPct(query, it.name ?? '')
          results.push({
            plataforma: 'Shopee',
            nome: it.name ?? '',
            preco,
            preco_fmt: preco != null
              ? `R$ ${preco.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
              : '—',
            url_produto: urlProd,
            url_carrinho: null,
            item_id: shopid && itemid ? `${shopid}/${itemid}` : null,
            match: m,
            tipo: 'produto',
          })
        }
      }
    } catch (_) { /* graceful skip */ }

    // ── 3. Reval (loja escolar — scraping da busca) ──────
    try {
      const revalRes = await fetch(
        `https://www.rfreval.com.br/busca?q=${encoded}`,
        { headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }
      )
      if (revalRes.ok) {
        const html = await revalRes.text()
        // Parse products from search results HTML
        const productRegex = /<div[^>]*class="[^"]*product-item[^"]*"[\s\S]*?<\/div>\s*<\/div>/g
        const nameRegex = /class="[^"]*product-name[^"]*"[^>]*>([^<]+)/
        const priceRegex = /class="[^"]*product-price[^"]*"[^>]*>[^R]*R\$\s*([\d.,]+)/
        const linkRegex = /href="(https?:\/\/www\.rfreval\.com\.br\/[^"]+)"/
        let match
        let count = 0
        while ((match = productRegex.exec(html)) !== null && count < 5) {
          const block = match[0]
          const nameMatch = nameRegex.exec(block)
          const priceMatch = priceRegex.exec(block)
          const linkMatch = linkRegex.exec(block)
          if (nameMatch) {
            const nome = nameMatch[1].trim()
            const precoStr = priceMatch?.[1]?.replace('.','').replace(',','.') ?? null
            const preco = precoStr ? parseFloat(precoStr) : null
            const m = matchPct(query, nome)
            results.push({
              plataforma: 'Reval',
              nome,
              preco,
              preco_fmt: preco != null ? `R$ ${preco.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—',
              url_produto: linkMatch?.[1] ?? `https://www.rfreval.com.br/busca?q=${encoded}`,
              url_carrinho: null,
              item_id: null,
              match: m,
              tipo: 'produto',
            })
            count++
          }
        }
      }
    } catch (_) { /* graceful skip */ }

    // Fallback Reval: link de busca se não retornou produtos
    if (!results.some(r => r.plataforma === 'Reval')) {
      results.push({
        plataforma: 'Reval',
        nome: `Buscar "${query}" na Reval`,
        preco: null, preco_fmt: 'Ver na Reval',
        url_produto: `https://www.rfreval.com.br/busca?q=${encoded}`,
        url_carrinho: null, item_id: null, match: 0, tipo: 'busca',
      })
    }

    // ── 4. Amazon Brasil (no free API — search link only) ────
    results.push({
      plataforma: 'Amazon',
      nome: `Buscar "${query}" na Amazon Brasil`,
      preco: null,
      preco_fmt: 'Ver na Amazon',
      url_produto: `https://www.amazon.com.br/s?k=${encoded}`,
      url_carrinho: null,
      item_id: null,
      match: 0,
      tipo: 'busca',
    })

    // Sort: cheapest real products first, search links last
    const produtos = results
      .filter(r => r.tipo === 'produto' && r.preco != null)
      .sort((a, b) => (a.preco ?? 0) - (b.preco ?? 0))
    const semPreco = results.filter(r => r.tipo === 'produto' && r.preco == null)
    const links    = results.filter(r => r.tipo === 'busca')

    return json({ data: [...produtos, ...semPreco, ...links], query })
  }

  // ── ATUALIZAÇÃO AUTOMÁTICA DE PREÇOS ────────────────────
  if (action === 'alm_atualizar_precos') {
    // Atualiza preços via Zoom.com.br (funciona server-side)
    const { data: insumos } = await sb.from('alm_insumos').select('id, nome, unidade, preco').eq('ativo', true)
    if (!insumos?.length) return json({ ok: true, atualizados: 0 })

    let atualizados = 0
    for (const insumo of insumos) {
      try {
        const query = insumo.nome.trim()
        const encoded = encodeURIComponent(query)
        let melhorPreco: number | null = null

        // Zoom.com.br (comparador de preços — funciona server-side)
        try {
          const zRes = await fetch(`https://www.zoom.com.br/search?q=${encoded}`, {
            headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          })
          if (zRes.ok) {
            const html = await zRes.text()
            // Extract prices from Zoom HTML
            const prices = html.match(/R\$\s*([\d]+[.,][\d]{2})/g) || []
            for (const ps of prices.slice(0, 10)) {
              const p = parseFloat(ps.replace('R$','').trim().replace('.','').replace(',','.'))
              if (!isNaN(p) && p > 1 && p < 10000) {
                if (melhorPreco === null || p < melhorPreco) melhorPreco = p
              }
            }
          }
        } catch (_) {}

        // ML (tentativa — pode falhar com 403)
        try {
          const mlRes = await fetch(`https://api.mercadolibre.com/sites/MLB/search?q=${encoded}&limit=3&sort=price_asc`, { headers: { 'Accept': 'application/json' } })
          if (mlRes.ok) {
            const mlData = await mlRes.json()
            for (const item of (mlData.results ?? []).slice(0, 3)) {
              const m = matchPct(query, item.title ?? '')
              if (m >= 70 && item.price != null) {
                if (melhorPreco === null || item.price < melhorPreco) melhorPreco = item.price
              }
            }
          }
        } catch (_) {}

        if (melhorPreco !== null && melhorPreco > 0) {
          await sb.from('alm_insumos').update({ preco: melhorPreco }).eq('id', insumo.id)
          atualizados++
        }

        await new Promise(r => setTimeout(r, 300))
      } catch (_) {}
    }

    return json({ ok: true, atualizados, total: insumos.length })
  }

  // ━━ ALMOXARIFADO: PURCHASE TRACKING (gerente only) ━━━━━━━━

  // ── Gerente creates requisition on behalf of a teacher ──────
  if (action === 'alm_criar_req_gerente') {
    const gerente = await getGerente(sb, token)
    if (!gerente) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)
    const { professora_id, itens, observacao } = body
    if (!professora_id) return json({ error: 'professora_id obrigatório.' }, 400)
    if (!itens?.length)  return json({ error: 'Adicione pelo menos um item.' }, 400)
    const mes = new Date().toISOString().slice(0, 7)
    const { data: profData } = await sb
      .from('professoras').select('serie_id').eq('id', professora_id).maybeSingle()
    const turma_id = (profData as any)?.serie_id ?? null
    const total = (itens as any[]).reduce((s: number, it: any) =>
      s + (parseFloat(it.qty_solicitado) * parseFloat(it.preco_unit || 0)), 0)
    const { data: nova, error: err } = await sb.from('alm_requisicoes').insert({
      professora_id, turma_id, mes,
      itens,
      total,
      observacao: observacao || `Criada pela gerente ${gerente.nome}`,
    }).select('id').single()
    if (err) return json({ error: err.message }, 400)
    return json({ ok: true, id: nova.id })
  }

  const isAlmCompraAction = [
    'alm_encaminhar_compra', 'alm_compras_pendentes',
    'alm_compras_todas', 'alm_marcar_comprado', 'alm_cancelar_compra',
  ].includes(action)

  if (isAlmCompraAction) {
    const gerente = await getGerente(sb, token)
    if (!gerente) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    // Record items selected for purchase when approving a requisition
    if (action === 'alm_encaminhar_compra') {
      // itens: [{insumo_nome, insumo_id, qty, plataforma, produto_nome, preco_unit,
      //          match_pct, url_produto, url_carrinho}]
      const { requisicao_id, itens } = body
      if (!requisicao_id || !itens?.length)
        return json({ error: 'requisicao_id e itens são obrigatórios.' }, 400)
      const rows = (itens as any[]).map((it: any) => ({
        requisicao_id,
        insumo_nome:     it.insumo_nome,
        insumo_id:       it.insumo_id   || null,
        qty:             it.qty         || 1,
        plataforma:      it.plataforma,
        produto_nome:    it.produto_nome || null,
        preco_unit:      it.preco_unit  ?? null,
        preco_total:     it.preco_unit != null ? it.preco_unit * (it.qty || 1) : null,
        match_pct:       it.match_pct   ?? null,
        url_produto:     it.url_produto || null,
        url_carrinho:    it.url_carrinho|| null,
        encaminhado_por: gerente.nome,
      }))
      const { error } = await sb.from('alm_compras').insert(rows)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, encaminhados: rows.length })
    }

    if (action === 'alm_compras_pendentes') {
      const { data } = await sb
        .from('alm_compras')
        .select('*, alm_requisicoes(mes, professoras(nome), series(nome))')
        .eq('status', 'pendente')
        .order('encaminhado_em', { ascending: false })
      return json({ data: data ?? [] })
    }

    if (action === 'alm_compras_todas') {
      const status: string = body.status || ''
      let q = sb.from('alm_compras')
        .select('*, alm_requisicoes(mes, professoras(nome), series(nome))')
        .order('encaminhado_em', { ascending: false })
        .limit(200)
      if (status) q = q.eq('status', status)
      const { data } = await q
      return json({ data: data ?? [] })
    }

    if (action === 'alm_marcar_comprado') {
      const { ids } = body   // array of alm_compras IDs
      if (!ids?.length) return json({ error: 'IDs não informados.' }, 400)
      const { error } = await sb.from('alm_compras').update({
        status:      'comprado',
        comprado_em:  new Date().toISOString(),
        comprado_por: gerente.nome,
      }).in('id', ids)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'alm_cancelar_compra') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('alm_compras').update({ status: 'cancelado' }).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
  }

  // ━━ ALMOXARIFADO: TEACHER ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━

  const isAlmProfAction = [
    'alm_catalogo', 'alm_minha_turma', 'alm_minhas_reqs',
    'alm_criar_req', 'alm_cancelar_req',
    'alm_notif_list', 'alm_notif_marcar_lida',
  ].includes(action)

  if (isAlmProfAction) {
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    if (action === 'alm_catalogo') {
      const { data } = await sb
        .from('alm_insumos').select('*')
        .eq('ativo', true).order('categoria').order('nome')
      return json({ data: data ?? [] })
    }

    if (action === 'alm_minha_turma') {
      const mes = body.mes || new Date().toISOString().slice(0, 7)
      const { data: profData } = await sb
        .from('professoras').select('serie_id, series(id, nome)')
        .eq('id', prof.id).maybeSingle()
      const turma = (profData as any)?.series ?? null
      if (!turma) return json({ turma: null, orcamento: null })
      const { data: orc } = await sb
        .from('alm_orcamentos').select('valor')
        .eq('turma_id', turma.id).eq('mes', mes).maybeSingle()
      // Total spent (approved + pending) this month for this turma
      const { data: reqs } = await sb
        .from('alm_requisicoes').select('total, status')
        .eq('turma_id', turma.id).eq('mes', mes).in('status', ['aprovado', 'pendente'])
      const gasto = (reqs ?? []).reduce((s: number, r: any) => s + (r.total ?? 0), 0)
      const gastoPendente = (reqs ?? []).filter((r: any) => r.status === 'pendente').reduce((s: number, r: any) => s + (r.total ?? 0), 0)
      return json({ turma, orcamento: orc?.valor ?? 0, gasto, gasto_pendente: gastoPendente })
    }

    if (action === 'alm_minhas_reqs') {
      const { data } = await sb
        .from('alm_requisicoes').select('*, series(nome)')
        .eq('professora_id', prof.id)
        .order('criado_em', { ascending: false })
      return json({ data: data ?? [] })
    }

    if (action === 'alm_criar_req') {
      const itens: any[] = body.itens || []
      const observacao: string = body.observacao || ''
      if (!itens.length) return json({ error: 'Adicione pelo menos um item.' }, 400)
      const mes = (body.mes as string) || new Date().toISOString().slice(0, 7)
      // Get teacher's turma
      const { data: profData } = await sb
        .from('professoras').select('serie_id').eq('id', prof.id).maybeSingle()
      const turma_id = (profData as any)?.serie_id ?? null
      const total = itens.reduce((s: number, it: any) =>
        s + (parseFloat(it.qty_solicitado) * parseFloat(it.preco_unit || 0)), 0)
      const { data: nova, error: err } = await sb.from('alm_requisicoes').insert({
        professora_id: prof.id, turma_id, mes, itens, total, observacao,
      }).select('id').single()
      if (err) return json({ error: err.message }, 400)
      return json({ ok: true, id: nova.id })
    }

    if (action === 'alm_cancelar_req') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('alm_requisicoes')
        .delete().eq('id', id).eq('professora_id', prof.id).eq('status', 'pendente')
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'alm_notif_list') {
      const { data } = await sb
        .from('alm_notificacoes').select('*, alm_requisicoes(mes, total, status)')
        .eq('professora_id', prof.id)
        .order('criado_em', { ascending: false })
        .limit(50)
      return json({ data: data ?? [] })
    }

    if (action === 'alm_notif_marcar_lida') {
      const { id } = body  // if null, marks all
      let q = sb.from('alm_notificacoes').update({ lida: true }).eq('professora_id', prof.id)
      if (id) q = q.eq('id', id)
      const { error } = await q
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
  }

  // ━━ ALMOXARIFADO: MANAGER ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━

  const isAlmGerenteAction = [
    'alm_painel', 'alm_pendentes', 'alm_todas_reqs',
    'alm_aprovar', 'alm_rejeitar',
    'alm_insumos_list', 'alm_insumo_save', 'alm_insumo_del',
    'alm_series_list', 'alm_turma_save', 'alm_turma_del',
    'alm_orcamentos_list', 'alm_orcamento_set',
    'alm_relatorio', 'alm_prof_set_turma',
  ].includes(action)

  if (isAlmGerenteAction) {
    const gerente = await getGerente(sb, token)
    if (!gerente) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    if (action === 'alm_painel') {
      const mes = body.mes || new Date().toISOString().slice(0, 7)
      const [{ count: pendentes }, { data: aprovadas }, { data: turmas }, { data: orcamentos }] =
        await Promise.all([
          sb.from('alm_requisicoes').select('*', { count: 'exact', head: true }).eq('status', 'pendente'),
          sb.from('alm_requisicoes').select('total, turma_id').eq('mes', mes).eq('status', 'aprovado'),
          sb.from('series').select('id, nome').eq('ativo', true),
          sb.from('alm_orcamentos').select('turma_id, valor').eq('mes', mes),
        ])
      const totalAprovado = (aprovadas ?? []).reduce((s: number, r: any) => s + (r.total ?? 0), 0)
      const orcMap: Record<string, number> = {}
      for (const o of orcamentos ?? []) orcMap[o.turma_id] = o.valor
      const gastoMap: Record<string, number> = {}
      for (const r of aprovadas ?? []) gastoMap[r.turma_id] = (gastoMap[r.turma_id] ?? 0) + r.total
      const turmasStats = (turmas ?? []).map((t: any) => ({
        ...t,
        orcamento: orcMap[t.id] ?? 0,
        gasto: gastoMap[t.id] ?? 0,
      }))
      return json({ pendentes: pendentes ?? 0, totalAprovado, turmas: turmasStats, mes })
    }

    if (action === 'alm_pendentes') {
      const { data } = await sb
        .from('alm_requisicoes')
        .select('*, professoras(nome, email), series(nome)')
        .eq('status', 'pendente').order('criado_em', { ascending: true })
      return json({ data: data ?? [] })
    }

    if (action === 'alm_todas_reqs') {
      const mes: string = body.mes || ''
      const status: string = body.status || ''
      let q = sb.from('alm_requisicoes')
        .select('*, professoras(nome, email), series(nome)')
        .order('criado_em', { ascending: false })
      if (mes)    q = q.eq('mes', mes)
      if (status) q = q.eq('status', status)
      const { data } = await q.limit(200)
      return json({ data: data ?? [] })
    }

    if (action === 'alm_aprovar') {
      const { id, nota_gerente, itens_aprovados } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      // itens_aprovados: optional override of qty_aprovado per item
      const { data: req } = await sb.from('alm_requisicoes').select('*')
        .eq('id', id).maybeSingle()
      if (!req) return json({ error: 'Requisição não encontrada.' }, 404)
      if (req.status !== 'pendente') return json({ error: 'Requisição já processada.' }, 400)
      // Merge approved quantities into items
      const itens = (req.itens as any[]).map((it: any) => {
        const override = itens_aprovados?.find((x: any) => x.insumo_id === it.insumo_id)
        return { ...it, qty_aprovado: override?.qty_aprovado ?? it.qty_solicitado }
      })
      const total = itens.reduce((s: number, it: any) =>
        s + (parseFloat(it.qty_aprovado) * parseFloat(it.preco_unit || 0)), 0)
      const { error: errUpdate } = await sb.from('alm_requisicoes').update({
        status: 'aprovado', nota_gerente: nota_gerente || null,
        itens, total, aprovado_em: new Date().toISOString(),
      }).eq('id', id)
      if (errUpdate) return json({ error: errUpdate.message }, 400)
      // Deduct from stock
      for (const it of itens) {
        if (it.insumo_id && it.qty_aprovado > 0) {
          const { data: ins } = await sb.from('alm_insumos')
            .select('estoque_qty').eq('id', it.insumo_id).maybeSingle()
          if (ins) {
            await sb.from('alm_insumos').update({
              estoque_qty: Math.max(0, (ins as any).estoque_qty - parseFloat(it.qty_aprovado))
            }).eq('id', it.insumo_id)
          }
        }
      }
      // Auto-create insumos for non-cataloged items
      for (const it of itens) {
        if (!it.insumo_id && it.nome && it.qty_aprovado > 0) {
          const { data: novo } = await sb.from('alm_insumos').insert({
            nome: it.nome,
            unidade: it.unidade || 'unidade',
            preco: parseFloat(it.preco_unit) || 0,
            estoque_qty: 0,
            categoria: it.categoria || null,
          }).select('id').maybeSingle()
          if (novo) it.insumo_id = novo.id
        }
      }
      // Update items with new insumo_ids
      await sb.from('alm_requisicoes').update({ itens }).eq('id', id)

      // Notify the teacher
      await sb.from('alm_notificacoes').insert({
        professora_id: req.professora_id,
        requisicao_id: id,
        mensagem: `Sua requisição de ${new Date(req.criado_em).toLocaleDateString('pt-BR')} foi ✅ aprovada.${nota_gerente ? ' Nota: ' + nota_gerente : ''}`,
      })
      return json({ ok: true })
    }

    if (action === 'alm_rejeitar') {
      const { id, nota_gerente } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { data: req } = await sb.from('alm_requisicoes').select('professora_id, criado_em, status')
        .eq('id', id).maybeSingle()
      if (!req) return json({ error: 'Requisição não encontrada.' }, 404)
      if (req.status !== 'pendente') return json({ error: 'Requisição já processada.' }, 400)
      const { error } = await sb.from('alm_requisicoes').update({
        status: 'rejeitado', nota_gerente: nota_gerente || null,
        rejeitado_em: new Date().toISOString(),
      }).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      await sb.from('alm_notificacoes').insert({
        professora_id: req.professora_id,
        requisicao_id: id,
        mensagem: `Sua requisição de ${new Date(req.criado_em).toLocaleDateString('pt-BR')} foi ❌ rejeitada.${nota_gerente ? ' Motivo: ' + nota_gerente : ''}`,
      })
      return json({ ok: true })
    }

    if (action === 'alm_insumos_list') {
      const { data } = await sb.from('alm_insumos').select('*').order('categoria').order('nome')
      return json({ data: data ?? [] })
    }

    if (action === 'alm_insumo_save') {
      const { id, nome, descricao, unidade, estoque_qty, preco, categoria } = body
      if (!nome) return json({ error: 'Nome obrigatório.' }, 400)
      if (id) {
        const { error } = await sb.from('alm_insumos').update(
          { nome, descricao, unidade, estoque_qty, preco, categoria }
        ).eq('id', id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      } else {
        const { data: novo, error } = await sb.from('alm_insumos').insert(
          { nome, descricao, unidade: unidade || 'unidade', estoque_qty: estoque_qty || 0, preco: preco || 0, categoria }
        ).select('id').single()
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true, id: novo.id })
      }
    }

    if (action === 'alm_insumo_del') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('alm_insumos').update({ ativo: false }).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'alm_series_list') {
      const { data } = await sb.from('series').select('*, professoras(id, nome, email)')
        .eq('ativo', true).order('nome')
      return json({ data: data ?? [] })
    }

    if (action === 'alm_turma_save') {
      const { id, nome } = body
      if (!nome) return json({ error: 'Nome obrigatório.' }, 400)
      if (id) {
        const { error } = await sb.from('series').update({ nome }).eq('id', id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      } else {
        const { data: nova, error } = await sb.from('series').insert(
          { nome, ordem: 99 }
        ).select('id').single()
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true, id: nova.id })
      }
    }

    if (action === 'alm_turma_del') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('series').update({ ativo: false }).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'alm_orcamentos_list') {
      const mes = body.mes || new Date().toISOString().slice(0, 7)
      const { data: turmas } = await sb.from('series').select('id, nome').eq('ativo', true).order('nome')
      const { data: orcs } = await sb.from('alm_orcamentos').select('turma_id, valor').eq('mes', mes)
      const map: Record<string, number> = {}
      for (const o of orcs ?? []) map[o.turma_id] = o.valor
      const result = (turmas ?? []).map((t: any) => ({ ...t, valor: map[t.id] ?? 0 }))
      return json({ data: result, mes })
    }

    if (action === 'alm_orcamento_set') {
      const { turma_id, mes, valor } = body
      if (!turma_id || !mes) return json({ error: 'turma_id e mes são obrigatórios.' }, 400)
      const { error } = await sb.from('alm_orcamentos').upsert(
        { turma_id, mes, valor: parseFloat(valor) || 0 },
        { onConflict: 'turma_id,mes' }
      )
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'alm_relatorio') {
      const mes = body.mes || new Date().toISOString().slice(0, 7)
      const { data: reqs } = await sb
        .from('alm_requisicoes')
        .select('turma_id, total, status, itens, professoras(nome), series(nome)')
        .eq('mes', mes)
      const { data: orcs } = await sb.from('alm_orcamentos').select('turma_id, valor').eq('mes', mes)
      const orcMap: Record<string, number> = {}
      for (const o of orcs ?? []) orcMap[o.turma_id] = o.valor
      // Group by turma
      const turmaMap: Record<string, any> = {}
      for (const r of reqs ?? []) {
        const tid = r.turma_id ?? 'sem_turma'
        if (!turmaMap[tid]) turmaMap[tid] = {
          turma: (r as any).series ?? { nome: 'Sem turma' },
          orcamento: orcMap[tid] ?? 0,
          gasto: 0, pendente: 0, rejeitado: 0, requisicoes: [],
        }
        if (r.status === 'aprovado')  turmaMap[tid].gasto     += r.total
        if (r.status === 'pendente')  turmaMap[tid].pendente  += r.total
        if (r.status === 'rejeitado') turmaMap[tid].rejeitado += r.total
        turmaMap[tid].requisicoes.push(r)
      }
      return json({ data: Object.values(turmaMap), mes })
    }

    if (action === 'alm_prof_set_turma') {
      const { professora_id, turma_id } = body
      if (!professora_id) return json({ error: 'professora_id obrigatório.' }, 400)
      const { error } = await sb.from('professoras')
        .update({ serie_id: turma_id || null }).eq('id', professora_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
  }

  // ━━ NOTIFICAÇÕES (qualquer portal) ━━━━━━━━━━━━━━━━━━━━━━━
  if (action === 'notif_list') {
    const { portal, email } = body
    if (!portal || !email) return json({ error: 'portal e email obrigatórios.' }, 400)
    const { data } = await sb.from('notificacoes').select('*')
      .eq('portal', portal).eq('destinatario', email)
      .order('criado_em', { ascending: false }).limit(50)
    return json({ data: data ?? [] })
  }

  if (action === 'notif_marcar_lida') {
    const { ids } = body
    if (!ids || !Array.isArray(ids)) return json({ error: 'ids obrigatório (array).' }, 400)
    await sb.from('notificacoes').update({ lida: true }).in('id', ids)
    return json({ ok: true })
  }

  if (action === 'notif_marcar_todas') {
    const { portal, email } = body
    if (!portal || !email) return json({ error: 'portal e email obrigatórios.' }, 400)
    await sb.from('notificacoes').update({ lida: true }).eq('portal', portal).eq('destinatario', email).eq('lida', false)
    return json({ ok: true })
  }

  // ━━ MERCADO LIVRE OAUTH ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (action === 'ml_auth_url') {
    const authUrl = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${ML_CLIENT_ID}&redirect_uri=${encodeURIComponent(ML_REDIRECT_URI)}`
    return json({ url: authUrl })
  }
  if (action === 'ml_status') {
    const token = await getMLToken(sb)
    return json({ connected: !!token })
  }

  // ━━ ACHADOS E PERDIDOS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (action === 'achados_postar') {
    // Professora posta item achado
    const token = (body._token as string) || (body._prof_token as string)
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessão inválida.' }, 401)
    const descricao = (body.descricao as string || '').trim()
    const local_encontrado = (body.local_encontrado as string || '').trim()
    if (!descricao) return json({ error: 'Descrição obrigatória.' }, 400)
    let foto_url: string | null = null
    if (body.base64 && body.mime) {
      const ext = (body.mime as string).includes('png') ? 'png' : 'jpg'
      const path = `fotos/${Date.now()}-${crypto.randomUUID()}.${ext}`
      const buf = Uint8Array.from(atob(body.base64 as string), c => c.charCodeAt(0))
      await sb.storage.from('achados-perdidos').upload(path, buf, { contentType: body.mime as string })
      const { data: pub } = sb.storage.from('achados-perdidos').getPublicUrl(path)
      foto_url = pub.publicUrl
    }
    const { error } = await sb.from('achados_perdidos').insert({
      descricao, local_encontrado: local_encontrado || null, foto_url,
      postado_por_id: prof.id, postado_por_nome: prof.nome,
    })
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  if (action === 'achados_lista_equipe') {
    // Equipe vê todos os itens (internos + públicos, exceto devolvidos antigos)
    const { data } = await sb.from('achados_perdidos').select('*')
      .neq('status', 'devolvido')
      .order('criado_em', { ascending: false })
    return json({ data: data ?? [] })
  }

  if (action === 'achados_lista_publica') {
    // Pais veem apenas itens públicos (status = publico OU publicar_em já passou)
    const agora = new Date().toISOString()
    const { data } = await sb.from('achados_perdidos').select('id, descricao, local_encontrado, foto_url, criado_em, status, publicar_em')
      .or(`status.eq.publico,publicar_em.lte.${agora}`)
      .neq('status', 'devolvido')
      .order('criado_em', { ascending: false })
    return json({ data: data ?? [] })
  }

  if (action === 'achados_publicar') {
    // Gerente autoriza publicação imediata
    const { id } = body as { id: string }
    if (!id) return json({ error: 'ID obrigatório.' }, 400)
    await sb.from('achados_perdidos').update({ status: 'publico', publicar_em: new Date().toISOString() }).eq('id', id)
    return json({ ok: true })
  }

  if (action === 'achados_devolver') {
    // Marca como devolvido
    const { id, devolvido_para } = body as { id: string; devolvido_para: string }
    if (!id) return json({ error: 'ID obrigatório.' }, 400)
    await sb.from('achados_perdidos').update({
      status: 'devolvido', devolvido_para: devolvido_para || null, devolvido_em: new Date().toISOString()
    }).eq('id', id)
    return json({ ok: true })
  }

  if (action === 'achados_excluir') {
    const { id } = body as { id: string }
    if (!id) return json({ error: 'ID obrigatório.' }, 400)
    await sb.from('achados_perdidos').delete().eq('id', id)
    return json({ ok: true })
  }

  // ━━ WEBAUTHN / BIOMETRIA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (action === 'webauthn_register_challenge') {
    // Requires authenticated session (professora or secretaria)
    const rp_id = body.rp_id as string
    if (!rp_id) return json({ error: 'rp_id obrigatório.' }, 400)
    const token = (body._token as string) || (body._prof_token as string)
    let usuario_tipo = '', usuario_id = '', user_name = '', user_email = ''
    // Try professora/secretaria session first
    const prof = await getProfessora(sb, token)
    if (prof) { usuario_tipo = 'professora'; usuario_id = prof.id; user_name = prof.nome; user_email = prof.email }
    else {
      const sec = await getSecretaria(sb, token)
      if (sec) { usuario_tipo = 'secretaria'; usuario_id = sec.id; user_name = sec.nome; user_email = sec.email }
    }
    // Fallback: Supabase Auth user (portal dos pais)
    if (!usuario_id && body._email) {
      user_email = body._email as string
      usuario_tipo = 'pais'
      usuario_id = user_email // use email as ID for parents
      user_name = user_email.split('@')[0]
    }
    if (!usuario_id) return json({ error: 'Sessão inválida.' }, 401)
    const challenge = generateChallenge()
    // Cleanup expired first
    await sb.from('webauthn_challenges').delete().lt('expira_em', new Date().toISOString())
    const { error: insErr } = await sb.from('webauthn_challenges').insert({ challenge, usuario_tipo, usuario_id, tipo: 'register', rp_id })
    if (insErr) return json({ error: 'Erro ao criar challenge: ' + insErr.message }, 500)
    return json({ challenge, rp_id, user_id: b64urlEncode(new TextEncoder().encode(usuario_id)), user_name: user_email, user_display_name: user_name })
  }

  if (action === 'webauthn_register_verify') {
    const { credential, rp_id } = body as { credential: any; rp_id: string }
    if (!credential || !rp_id) return json({ error: 'Dados incompletos.' }, 400)
    // Extract challenge from clientDataJSON to find the matching record
    const cdJson = JSON.parse(new TextDecoder().decode(b64urlDecode(credential.response.clientDataJSON)))
    const sentChallenge = cdJson.challenge
    await sb.from('webauthn_challenges').delete().lt('expira_em', new Date().toISOString())
    const { data: ch } = await sb.from('webauthn_challenges').select('*')
      .eq('challenge', sentChallenge).eq('tipo', 'register').maybeSingle()
    if (!ch) return json({ error: 'Challenge expirado ou invalido. Tente novamente.' }, 400)
    await sb.from('webauthn_challenges').delete().eq('id', ch.id)
    try {
      const result = await verifyRegistration(credential.response.clientDataJSON, credential.response.attestationObject, ch.challenge, rp_id)
      await sb.from('webauthn_credentials').insert({
        usuario_tipo: ch.usuario_tipo, usuario_id: ch.usuario_id,
        credential_id: result.credentialId, public_key: result.publicKey,
        sign_count: result.signCount, transports: credential.transports || ['internal'], rp_id,
      })
      return json({ ok: true })
    } catch (e) { return json({ error: 'Verificação falhou: ' + (e as Error).message }, 400) }
  }

  if (action === 'webauthn_login_challenge') {
    const { email, portal, rp_id } = body as { email: string; portal: string; rp_id: string }
    if (!email || !portal || !rp_id) return json({ error: 'email, portal e rp_id obrigatórios.' }, 400)
    // Find user
    let usuario_id = ''
    if (portal === 'professora') {
      const { data: p } = await sb.from('professoras').select('id').ilike('email', email).maybeSingle()
      if (p) usuario_id = p.id
    } else if (portal === 'secretaria') {
      const { data: s } = await sb.from('secretarias').select('id').ilike('email', email).maybeSingle()
      if (s) usuario_id = s.id
    } else if (portal === 'pais') {
      usuario_id = email // parents use email as ID
    }
    if (!usuario_id) return json({ error: 'Usuário não encontrado.' }, 404)
    const { data: creds } = await sb.from('webauthn_credentials').select('credential_id, transports')
      .eq('usuario_tipo', portal).eq('usuario_id', usuario_id)
    if (!creds?.length) return json({ error: 'Nenhuma biometria cadastrada para este e-mail.' }, 404)
    const challenge = generateChallenge()
    await sb.from('webauthn_challenges').insert({ challenge, usuario_tipo: portal, usuario_id, email, tipo: 'login', rp_id })
    await sb.from('webauthn_challenges').delete().lt('expira_em', new Date().toISOString())
    return json({ challenge, rp_id, allowCredentials: creds.map(c => ({ id: c.credential_id, transports: c.transports })) })
  }

  if (action === 'webauthn_login_verify') {
    const { credential, rp_id } = body as { credential: any; rp_id: string }
    if (!credential || !rp_id) return json({ error: 'Dados incompletos.' }, 400)
    // Find credential
    const { data: cred } = await sb.from('webauthn_credentials').select('*').eq('credential_id', credential.id).maybeSingle()
    if (!cred) return json({ error: 'Credencial não encontrada.' }, 404)
    // Find challenge
    const { data: ch } = await sb.from('webauthn_challenges').select('*').eq('tipo', 'login')
      .eq('usuario_tipo', cred.usuario_tipo).eq('usuario_id', cred.usuario_id)
      .gt('expira_em', new Date().toISOString()).order('criado_em', { ascending: false }).limit(1).maybeSingle()
    if (!ch) return json({ error: 'Challenge expirado ou inválido.' }, 400)
    await sb.from('webauthn_challenges').delete().eq('id', ch.id)
    try {
      const result = await verifyAuthentication(
        credential.response.clientDataJSON, credential.response.authenticatorData,
        credential.response.signature, ch.challenge, rp_id, cred.public_key, cred.sign_count
      )
      await sb.from('webauthn_credentials').update({ sign_count: result.newSignCount }).eq('id', cred.id)
      // Create session
      let token = '', nome = '', email = ''
      if (cred.usuario_tipo === 'professora') {
        const { data: p } = await sb.from('professoras').select('nome, email').eq('id', cred.usuario_id).maybeSingle()
        if (!p) return json({ error: 'Professora não encontrada.' }, 404)
        const { data: sess } = await sb.from('professora_sessoes').insert({ professora_id: cred.usuario_id }).select('token').single()
        token = sess!.token; nome = p.nome; email = p.email
      } else if (cred.usuario_tipo === 'secretaria') {
        const { data: s } = await sb.from('secretarias').select('nome, email').eq('id', cred.usuario_id).maybeSingle()
        if (!s) return json({ error: 'Secretária não encontrada.' }, 404)
        const { data: sess } = await sb.from('secretaria_sessoes').insert({ secretaria_id: cred.usuario_id }).select('token').single()
        token = sess!.token; nome = s.nome; email = s.email
      }
      return json({ token, nome, email })
    } catch (e) { return json({ error: 'Verificação falhou: ' + (e as Error).message }, 400) }
  }

  return json({ error: 'Ação desconhecida' }, 400)
})
