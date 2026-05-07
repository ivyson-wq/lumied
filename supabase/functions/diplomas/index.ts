import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  generateChallenge, verifyRegistration, verifyAuthentication, b64urlEncode,
  getModulosHabilitados, getModulosResolvidos, getEscolaPadrao,
  resolveEscolaId,
  getCorsHeaders,
  checkRateLimit, getClientIP,
  sanitizeBody,
  createLogger,
  hashSenha, verificarSenhaAuto as verificarSenha, gerarToken as randomToken, uploadArquivo, getSignedFileUrl,
  resolveUsuario,
  logAudit,
  generatePdf, pdfResponse, generateXlsx, xlsxResponse,
  b64urlDecode,
} from '../_shared/mod.ts'

const log = createLogger('diplomas')

// CORS headers are set dynamically per-request inside serve()
let CORS: Record<string, string> = getCorsHeaders()

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

async function criarNotif(sb: any, portal: string, destinatario: string, titulo: string, mensagem: string, tipo = 'info', escola_id?: string) {
  const row: Record<string, unknown> = { portal, destinatario, titulo, mensagem, tipo }
  if (escola_id) row.escola_id = escola_id
  await sb.from('notificacoes').insert(row)
}

// ── Verificação de horário de acesso ────────────────────────
async function verificarHorarioAcesso(sb: ReturnType<typeof createClient>, professoraId: string): Promise<{ permitido: boolean; mensagem?: string }> {
  const now = new Date()
  const brNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const diaSemana = brNow.getDay()
  const { data: regras } = await sb
    .from('professora_horario_acesso').select('dia_semana, hora_inicio, hora_fim, ativo')
    .eq('professora_id', professoraId).eq('ativo', true)
  if (!regras || regras.length === 0) return { permitido: true }
  const regraHoje = regras.find((r: any) => r.dia_semana === diaSemana)
  if (!regraHoje) {
    return { permitido: false, mensagem: 'Acesso não permitido neste dia da semana.' }
  }
  if (!regraHoje.hora_inicio || !regraHoje.hora_fim) return { permitido: true }
  const horaAtual = brNow.getHours() * 60 + brNow.getMinutes()
  const [hi, mi] = regraHoje.hora_inicio.split(':').map(Number)
  const [hf, mf] = regraHoje.hora_fim.split(':').map(Number)
  if (isNaN(hi) || isNaN(mi) || isNaN(hf) || isNaN(mf)) return { permitido: true }
  const inicio = hi * 60 + mi
  const fim = hf * 60 + mf
  if (horaAtual < inicio || horaAtual > fim) {
    return { permitido: false, mensagem: `Acesso permitido apenas das ${regraHoje.hora_inicio} às ${regraHoje.hora_fim}.` }
  }
  return { permitido: true }
}

// ── Session validators (delegated to _shared/auth.ts) ──────
// These are thin wrappers that maintain the same call signature for
// backward compatibility with the 100+ call sites in this file.
import {
  resolveProfessora,
  resolveGerente,
  resolveSecretaria,
  resolveAlmoxarifado,
} from '../_shared/mod.ts'

const getProfessora = (sb: ReturnType<typeof createClient>, token: string) => resolveProfessora(sb, token)
const getGerente = (sb: ReturnType<typeof createClient>, token: string) => resolveGerente(sb, token)
const getSecretaria = (sb: ReturnType<typeof createClient>, token: string) => resolveSecretaria(sb, token)
const getAlmoxarifado = (sb: ReturnType<typeof createClient>, token: string) => resolveAlmoxarifado(sb, token)
const getUsuario = (sb: ReturnType<typeof createClient>, token: string) => resolveUsuario(sb, token)

// ── Parent (Supabase Auth JWT) validator ────────────────────
async function getPaiEmail(sb: ReturnType<typeof createClient>, token: string, fallbackEmail?: string): Promise<string | null> {
  if (token) {
    try {
      const { data: { user } } = await sb.auth.getUser(token)
      if (user?.email) return user.email.toLowerCase().trim()
    } catch (e) { console.warn('[diplomas] getPaiEmail auth failed:', (e as Error).message) }
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

// uploadArquivo imported from _shared/auth.ts (includes 10MB size check)

const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID') || ''
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET') || ''
const ML_REDIRECT_URI = Deno.env.get('ML_REDIRECT_URI') || `${Deno.env.get('SUPABASE_URL')}/functions/v1/diplomas?action=ml_oauth_callback`

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
        signal: AbortSignal.timeout(10000),
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
    } catch (e) { console.warn('[diplomas] ML token refresh failed:', (e as Error).message) }
    return null
  }
  return data.access_token
}

Deno.serve(async (req) => {
  CORS = getCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  try {

  // Rate limiting
  const clientIp = getClientIP(req)
  const rl = checkRateLimit(clientIp, 'api')
  if (!rl.allowed) return json({ error: `Muitas requisições. Tente em ${rl.retryAfterSeconds}s.`, code: 'RATE_LIMITED' }, 429)

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
        signal: AbortSignal.timeout(10000),
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
        // Redirect to static success page on Vercel
        const appUrl = Deno.env.get('APP_URL') || 'https://maplebearcaxias.lumied.com.br'
        return Response.redirect(appUrl + '/ml-conectado.html', 302)
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
    // Tenant-scope: requer sessão válida (professora ou gerente) para derivar escola_id
    const prof = await getProfessora(sb, token)
    const gerente = !prof ? await getGerente(sb, token) : null
    const rankingEscolaId = (prof as any)?.escola_id || (gerente as any)?.escola_id
    if (!rankingEscolaId) return json({ error: 'Sessão sem escola associada.' }, 401)
    const { data: professoras } = await sb.from('professoras').select('id, nome').eq('escola_id', rankingEscolaId).order('nome')
    if (!professoras) return json({ data: [] })
    const profIds = professoras.map(p => p.id)
    const { data: diplomas } = await sb
      .from('diplomas_professoras').select('professora_id, pontuacao').eq('status', 'aprovado').in('professora_id', profIds)
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
    const papelEsperado: string = body.papel || ''
    if (!email || !senha) return json({ error: 'E-mail e senha são obrigatórios.', code: 'VALIDATION_FAILED' }, 400)
    const rlLogin = checkRateLimit(email || clientIp, 'login')
    if (!rlLogin.allowed) return json({ error: `Muitas tentativas de login. Tente em ${rlLogin.retryAfterSeconds}s.`, code: 'RATE_LIMITED' }, 429)
    const { data: user } = await sb
      .from('usuarios')
      .select('id, nome, email, senha_hash, papel, papeis, ativo')
      .eq('email', email)
      .maybeSingle()
    if (!user || !user.senha_hash) return json({ error: 'E-mail ou senha incorretos.', code: 'AUTH_BAD_CREDENTIALS' }, 401)
    if (user.ativo === false) return json({ error: 'Conta desativada. Contate o gerente.', code: 'AUTH_USER_DISABLED' }, 403)
    if (!await verificarSenha(senha, user.senha_hash)) return json({ error: 'E-mail ou senha incorretos.', code: 'AUTH_BAD_CREDENTIALS' }, 401)
    const userRoles: string[] = (user.papeis?.length ? user.papeis : (user.papel ? [user.papel] : []))
    if (papelEsperado && !userRoles.includes(papelEsperado)) {
      return json({ error: 'Este acesso não está disponível para o seu papel.', code: 'AUTH_ROLE_MISMATCH' }, 401)
    }
    const tok = randomToken()
    const { error: sessErr } = await sb.from('sessoes').insert({
      usuario_id: user.id,
      token: tok,
      expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    if (sessErr) {
      console.error('[auth] unified_login AUTH_SESSION_FAILED', { email, err: sessErr })
      return json({ error: 'Não foi possível criar a sessão. Tente novamente.', code: 'AUTH_SESSION_FAILED' }, 500)
    }
    return json({ token: tok, nome: user.nome, email: user.email, papel: user.papel, papeis: userRoles })
  }

  if (action === 'unified_logout') {
    await sb.from('sessoes').delete().eq('token', token)
    return json({ ok: true })
  }

  // ── Login legado (backward compat) ─────────────────────────
  if (action === 'professora_login') {
    const email: string = (body.email || '').toLowerCase().trim()
    const senha: string = body.senha || ''
    if (!email || !senha) return json({ error: 'E-mail e senha são obrigatórios.', code: 'VALIDATION_FAILED' }, 400)
    const rlLogin = checkRateLimit(email || clientIp, 'login')
    if (!rlLogin.allowed) return json({ error: `Muitas tentativas de login. Tente em ${rlLogin.retryAfterSeconds}s.`, code: 'RATE_LIMITED' }, 429)
    // Deriva escola via Origin para evitar colisão de email cross-tenant
    const escolaIdProf = await resolveEscolaId(req, sb, null, body)
    let q = sb.from('professoras').select('id, nome, email, senha_hash, escola_id').eq('email', email)
    if (escolaIdProf) q = q.eq('escola_id', escolaIdProf)
    const { data: matches } = await q.limit(2)
    if (!matches?.length) return json({ error: 'E-mail ou senha incorretos.', code: 'AUTH_BAD_CREDENTIALS' }, 401)
    if (matches.length > 1) {
      console.warn('[professora_login] multi-match', { email })
      return json({ error: 'E-mail ou senha incorretos.', code: 'AUTH_BAD_CREDENTIALS' }, 401)
    }
    const prof = matches[0]
    if (!prof.senha_hash) return json({ error: 'E-mail ou senha incorretos.', code: 'AUTH_BAD_CREDENTIALS' }, 401)
    if (!await verificarSenha(senha, prof.senha_hash)) return json({ error: 'E-mail ou senha incorretos.', code: 'AUTH_BAD_CREDENTIALS' }, 401)
    const horario = await verificarHorarioAcesso(sb, prof.id)
    if (!horario.permitido) return json({ error: horario.mensagem || 'Acesso fora do horário permitido.', code: 'AUTH_OUT_OF_HOURS' }, 403)
    const tok = randomToken()
    const { error: psErr } = await sb.from('professora_sessoes').insert({
      professora_id: prof.id, token: tok,
      expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    if (psErr) {
      console.error('[auth] professora_login AUTH_SESSION_FAILED', { email, err: psErr })
      return json({ error: 'Não foi possível criar a sessão.', code: 'AUTH_SESSION_FAILED' }, 500)
    }
    return json({ token: tok, nome: prof.nome, email: prof.email })
  }

  if (action === 'professora_verificar_horario') {
    const token = (body._token as string) || (body._prof_token as string)
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessao invalida.' }, 401)
    const horario = await verificarHorarioAcesso(sb, prof.id)
    return json({ permitido: horario.permitido, mensagem: horario.mensagem || null })
  }

  if (action === 'secretaria_login') {
    const email: string = (body.email || '').toLowerCase().trim()
    const senha: string = body.senha || ''
    if (!email || !senha) return json({ error: 'E-mail e senha são obrigatórios.', code: 'VALIDATION_FAILED' }, 400)
    const rlLogin = checkRateLimit(email || clientIp, 'login')
    if (!rlLogin.allowed) return json({ error: `Muitas tentativas de login. Tente em ${rlLogin.retryAfterSeconds}s.`, code: 'RATE_LIMITED' }, 429)
    const escolaIdSec = await resolveEscolaId(req, sb, null, body)
    let qs = sb.from('secretarias').select('id, nome, email, senha_hash, escola_id').eq('email', email)
    if (escolaIdSec) qs = qs.eq('escola_id', escolaIdSec)
    const { data: secMatches } = await qs.limit(2)
    if (!secMatches?.length) return json({ error: 'E-mail ou senha incorretos.', code: 'AUTH_BAD_CREDENTIALS' }, 401)
    if (secMatches.length > 1) {
      console.warn('[secretaria_login] multi-match', { email })
      return json({ error: 'E-mail ou senha incorretos.', code: 'AUTH_BAD_CREDENTIALS' }, 401)
    }
    const sec = secMatches[0]
    if (!sec.senha_hash) return json({ error: 'E-mail ou senha incorretos.', code: 'AUTH_BAD_CREDENTIALS' }, 401)
    if (!await verificarSenha(senha, sec.senha_hash)) return json({ error: 'E-mail ou senha incorretos.', code: 'AUTH_BAD_CREDENTIALS' }, 401)
    const tok = randomToken()
    const { error: ssErr } = await sb.from('secretaria_sessoes').insert({
      secretaria_id: sec.id, token: tok,
      expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    if (ssErr) {
      console.error('[auth] secretaria_login AUTH_SESSION_FAILED', { email, err: ssErr })
      return json({ error: 'Não foi possível criar a sessão.', code: 'AUTH_SESSION_FAILED' }, 500)
    }
    return json({ token: tok, nome: sec.nome, email: sec.email })
  }

  // ━━ TEACHER ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const isTeacherAction = [
    'professora_logout', 'diploma_submit', 'meus_diplomas',
    'atestado_submit', 'meus_atestados',
    'minhas_impressoes',
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
      const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
      if (!allowedMimes.includes(mime)) return json({ error: 'Tipo de arquivo não permitido. Envie PDF, JPEG, PNG ou WebP.' }, 400)
      const up = await uploadArquivo(sb, 'diplomas', prof.id, base64, mime)
      if ('error' in up) return json({ error: 'Erro ao fazer upload: ' + up.error }, 400)
      if (!(prof as any).escola_id) return json({ error: 'Professora sem escola associada.' }, 403)
      const { error } = await sb.from('diplomas_professoras').insert({
        professora_id: prof.id, nome_curso, carga_horaria,
        arquivo_url: up.url, status: 'pendente', pontuacao: 0,
        escola_id: (prof as any).escola_id,
      })
      if (error) return json({ error: error.message }, 400)
      // Notifica APENAS gerentes da mesma escola
      const { data: gerentes } = await sb.from('gerentes').select('email').eq('escola_id', (prof as any).escola_id)
      for (const g of gerentes ?? []) {
        await criarNotif(sb, 'gerente', g.email, 'Novo diploma', `${prof.nome} enviou o diploma "${nome_curso}" (${carga_horaria}h) para validação.`, 'info', (prof as any).escola_id)
      }
      return json({ ok: true })
    }

    if (action === 'meus_atestados') {
      const { data } = await sb
        .from('atestados_professoras').select('*')
        .eq('professora_id', prof.id).order('criado_em', { ascending: false })
      // Bucket atestados é privado (mig 278) — gera signed URL fresh
      const out = await Promise.all((data ?? []).map(async (r: any) => {
        if (r.arquivo_path) {
          const fresh = await getSignedFileUrl(sb, 'atestados', r.arquivo_path, 60 * 60)
          if (fresh) r.arquivo_url = fresh
        }
        return r
      }))
      return json({ data: out })
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
      const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
      if (!allowedMimes.includes(mime)) return json({ error: 'Tipo de arquivo não permitido. Envie PDF, JPEG, PNG ou WebP.' }, 400)
      const up = await uploadArquivo(sb, 'atestados', prof.id, base64, mime, { private: true })
      if ('error' in up) return json({ error: 'Erro ao fazer upload: ' + up.error }, 400)
      if (!(prof as any).escola_id) return json({ error: 'Professora sem escola associada.' }, 403)
      const { error } = await sb.from('atestados_professoras').insert({
        professora_id: prof.id, data_inicio, data_fim,
        motivo: motivo || null, arquivo_url: up.url, arquivo_path: up.path, status: 'pendente',
        escola_id: (prof as any).escola_id,
      })
      if (error) return json({ error: error.message }, 400)
      // Notifica APENAS secretárias da mesma escola
      const { data: secs } = await sb.from('secretarias').select('email').eq('escola_id', (prof as any).escola_id)
      for (const s of secs ?? []) {
        await criarNotif(sb, 'secretaria', s.email, 'Novo atestado', `${prof.nome} enviou um atestado (${data_inicio} a ${data_fim}) para validação.`, 'info', (prof as any).escola_id)
      }
      return json({ ok: true })
    }

    if (action === 'minhas_impressoes') {
      const { data } = await sb
        .from('impressoes').select('*')
        .eq('professora_id', prof.id).order('criado_em', { ascending: false })
      return json({ data: data ?? [] })
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
          .from('pdis').insert({ professora_id: prof.id, ciclo_id: ciclo.id, status: 'rascunho', escola_id: (prof as any).escola_id })
          .select('id').single()
        if (errCria) return json({ error: errCria.message }, 400)
        pdiId = novo.id
      }

      // Upsert competências
      for (const c of competencias) {
        await sb.from('pdi_competencias').upsert(
          { pdi_id: pdiId, area: c.area, nota_auto: c.nota_auto, comentario: c.comentario ?? null, escola_id: (prof as any).escola_id },
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
      await sb.from('pdi_metas').delete().eq('pdi_id', pdi_id).eq('escola_id', (prof as any).escola_id)
      const { error } = await sb.from('pdi_metas').insert(
        metas.map(m => ({
          pdi_id,
          descricao: m.descricao,
          indicador: m.indicador,
          prazo: m.prazo,
          area_vinculada: m.area_vinculada ?? null,
          status: 'pendente',
          progressao_pct: 0,
          escola_id: (prof as any).escola_id,
        }))
      )
      if (error) return json({ error: error.message }, 400)

      // Avança status do PDI para aguardando_aprovacao
      await sb.from('pdis').update({
        status: 'aguardando_aprovacao',
        submetido_em: new Date().toISOString(),
      }).eq('id', pdi_id).eq('escola_id', (prof as any).escola_id)

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
      }).eq('id', meta_id).eq('escola_id', (prof as any).escola_id)
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
        pdi_id, tipo, relato_professora: relato, escola_id: (prof as any).escola_id,
      })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
  }

  // ━━ SECRETARIA ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const isSecretariaAction = [
    'secretaria_logout', 'secretaria_perfil',
    'atestados_pendentes', 'atestados_all',
    'atestado_aprovar', 'atestado_rejeitar',
    'sec_crm_estagios_list', 'sec_crm_leads_list', 'sec_crm_leads_all',
    'sec_crm_lead_save', 'sec_crm_lead_mover',
    'sec_crm_interacoes_list', 'sec_crm_interacao_save',
    'sec_crm_templates_list', 'sec_crm_dashboard',
    'sec_metas_list',
  ].includes(action)

  if (isSecretariaAction) {
    const sec = await getSecretaria(sb, token)
    if (!sec) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    if (action === 'secretaria_logout') {
      await sb.from('secretaria_sessoes').delete().eq('token', token)
      return json({ ok: true })
    }

    // Helper local: troca arquivo_url por signed URL fresh quando o atestado tem path
    const refreshAtestUrls = async (rows: any[]) => Promise.all(rows.map(async (r) => {
      if (r.arquivo_path) {
        const fresh = await getSignedFileUrl(sb, 'atestados', r.arquivo_path, 60 * 60)
        if (fresh) r.arquivo_url = fresh
      }
      return r
    }))

    if (action === 'atestados_pendentes') {
      const { data } = await sb
        .from('atestados_professoras').select('*, professoras(nome, email)')
        .eq('escola_id', (sec as any).escola_id).eq('status', 'pendente').order('criado_em', { ascending: true })
      return json({ data: await refreshAtestUrls(data ?? []) })
    }

    if (action === 'atestados_all') {
      const filterStatus: string | undefined = body.status
      let query = sb
        .from('atestados_professoras').select('*, professoras(nome, email)')
        .eq('escola_id', (sec as any).escola_id).order('data_inicio', { ascending: false })
      if (filterStatus && filterStatus !== 'todos') query = query.eq('status', filterStatus)
      const { data } = await query
      return json({ data: await refreshAtestUrls(data ?? []) })
    }

    if (action === 'atestado_aprovar') {
      const { id } = body
      if (!id) return json({ error: 'ID do atestado não informado.' }, 400)
      const { data: atest } = await sb.from('atestados_professoras').select('professora_id, data_inicio, data_fim, professoras(email)').eq('id', id).eq('escola_id', (sec as any).escola_id).maybeSingle()
      const { error } = await sb.from('atestados_professoras').update({
        status: 'aprovado',
        validado_por: sec.nome,
        data_validacao: new Date().toISOString(),
        observacao: body.observacao || null,
      }).eq('id', id).eq('escola_id', (sec as any).escola_id)
      if (error) return json({ error: error.message }, 400)
      const profEmail = atest?.professoras?.email
      if (profEmail) await criarNotif(sb, 'professora', profEmail, 'Atestado aprovado', `Seu atestado (${atest.data_inicio} a ${atest.data_fim}) foi ✅ aprovado pela secretaria.`, 'success', (sec as any).escola_id)
      logAudit(sb, { ator_tipo: 'secretaria', ator_email: sec.email, recurso: 'atestado', recurso_id: id, acao: 'aprovar', metadata: { observacao: body.observacao } })
      return json({ ok: true })
    }

    if (action === 'atestado_rejeitar') {
      const { id } = body
      if (!id) return json({ error: 'ID do atestado não informado.' }, 400)
      const { data: atest } = await sb.from('atestados_professoras').select('professora_id, data_inicio, data_fim, professoras(email)').eq('id', id).eq('escola_id', (sec as any).escola_id).maybeSingle()
      const { error } = await sb.from('atestados_professoras').update({
        status: 'rejeitado',
        validado_por: sec.nome,
        data_validacao: new Date().toISOString(),
        observacao: body.observacao || null,
      }).eq('id', id).eq('escola_id', (sec as any).escola_id)
      if (error) return json({ error: error.message }, 400)
      const profEmail = atest?.professoras?.email
      if (profEmail) await criarNotif(sb, 'professora', profEmail, 'Atestado rejeitado', `Seu atestado (${atest.data_inicio} a ${atest.data_fim}) foi ❌ rejeitado.${body.observacao ? ' Motivo: ' + body.observacao : ''}`, 'error', (sec as any).escola_id)
      logAudit(sb, { ator_tipo: 'secretaria', ator_email: sec.email, recurso: 'atestado', recurso_id: id, acao: 'rejeitar', metadata: { observacao: body.observacao } })
      return json({ ok: true })
    }

    // ── Perfil (retorna features habilitadas) ──
    if (action === 'secretaria_perfil') {
      return json({ id: sec.id, nome: sec.nome, email: sec.email, features: sec.features })
    }

    // ── CRM: Estágios ──
    if (action === 'sec_crm_estagios_list') {
      if (!sec.features?.includes('crm')) return json({ error: 'Recurso não habilitado.' }, 403)
      const { data } = await sb.from('crm_estagios').select('*').eq('ativo', true).eq('escola_id', (sec as any).escola_id).order('ordem')
      return json(data ?? [])
    }

    // ── CRM: Leads (todos — visibilidade completa como gerente) ──
    if (action === 'sec_crm_leads_list' || action === 'sec_crm_leads_all') {
      if (!sec.features?.includes('crm')) return json({ error: 'Recurso não habilitado.' }, 403)
      const { data } = await sb.from('crm_leads').select('*, crm_estagios(nome, cor, ordem), secretarias(nome)')
        .eq('escola_id', (sec as any).escola_id).order('atualizado_em', { ascending: false })
      return json(data ?? [])
    }

    // ── CRM: Salvar lead ──
    if (action === 'sec_crm_lead_save') {
      if (!sec.features?.includes('crm')) return json({ error: 'Recurso não habilitado.' }, 403)
      const { id, nome_responsavel, email: leadEmail, telefone, nome_crianca, data_nascimento, serie_interesse, estagio_id, origem, valor_mensalidade, observacoes, data_proximo_contato, data_visita } = body
      if (!nome_responsavel) return json({ error: 'Nome obrigatório.' }, 400)
      const leadData: Record<string, unknown> = { nome_responsavel, email: leadEmail, telefone, nome_crianca, data_nascimento: data_nascimento || null, serie_interesse, estagio_id, origem, valor_mensalidade: valor_mensalidade ? parseFloat(valor_mensalidade as string) : null, observacoes, responsavel_interno: sec.nome, responsavel_id: sec.id, data_proximo_contato: data_proximo_contato || null, data_visita: data_visita || null, atualizado_em: new Date().toISOString() }
      if (id) { await sb.from('crm_leads').update(leadData).eq('id', id).eq('escola_id', (sec as any).escola_id) }
      else { await sb.from('crm_leads').insert({ ...leadData, escola_id: (sec as any).escola_id }) }
      return json({ ok: true })
    }

    // ── CRM: Mover lead de estágio ──
    if (action === 'sec_crm_lead_mover') {
      if (!sec.features?.includes('crm')) return json({ error: 'Recurso não habilitado.' }, 403)
      const { id, estagio_id } = body
      if (!id || !estagio_id) return json({ error: 'id e estagio_id obrigatórios.' }, 400)
      await sb.from('crm_leads').update({ estagio_id, atualizado_em: new Date().toISOString() }).eq('id', id).eq('escola_id', (sec as any).escola_id)
      return json({ ok: true })
    }

    // ── CRM: Interações ──
    if (action === 'sec_crm_interacoes_list') {
      if (!sec.features?.includes('crm')) return json({ error: 'Recurso não habilitado.' }, 403)
      const { lead_id } = body
      if (!lead_id) return json({ error: 'lead_id obrigatório.' }, 400)
      const { data } = await sb.from('crm_interacoes').select('*').eq('lead_id', lead_id).eq('escola_id', (sec as any).escola_id).order('criado_em', { ascending: false })
      return json(data ?? [])
    }

    if (action === 'sec_crm_interacao_save') {
      if (!sec.features?.includes('crm')) return json({ error: 'Recurso não habilitado.' }, 403)
      const { lead_id, tipo, descricao } = body
      if (!lead_id || !descricao) return json({ error: 'lead_id e descrição obrigatórios.' }, 400)
      await sb.from('crm_interacoes').insert({ lead_id, tipo: tipo || 'nota', descricao, criado_por: sec.nome, escola_id: (sec as any).escola_id })
      await sb.from('crm_leads').update({ atualizado_em: new Date().toISOString() }).eq('id', lead_id).eq('escola_id', (sec as any).escola_id)
      return json({ ok: true })
    }

    // ── CRM: Templates ──
    if (action === 'sec_crm_templates_list') {
      if (!sec.features?.includes('templates')) return json({ error: 'Recurso não habilitado.' }, 403)
      const { data } = await sb.from('crm_templates').select('*').eq('ativo', true).eq('escola_id', (sec as any).escola_id).order('categoria')
      return json(data ?? [])
    }

    // ── CRM: Dashboard ──
    if (action === 'sec_crm_dashboard') {
      if (!sec.features?.includes('crm')) return json({ error: 'Recurso não habilitado.' }, 403)
      const escolaId = (sec as any).escola_id
      const anoParam = parseInt(body.ano as string) || new Date().getFullYear()
      const { data: leads } = await sb.from('crm_leads').select('estagio_id, origem, valor_mensalidade, criado_em, crm_estagios(nome, ordem)')
        .eq('escola_id', escolaId)
      const porEstagio: Record<string, number> = {}
      const porOrigem: Record<string, number> = {}
      let valorPipeline = 0
      let novosMes = 0
      const now = new Date()
      const mesAtual = now.getMonth()
      const anoAtual = now.getFullYear()
      for (const l of leads ?? []) {
        // deno-lint-ignore no-explicit-any
        const est = (l as any).crm_estagios?.nome || '?'
        porEstagio[est] = (porEstagio[est] || 0) + 1
        if (l.origem) porOrigem[l.origem] = (porOrigem[l.origem] || 0) + 1
        if (l.valor_mensalidade) valorPipeline += l.valor_mensalidade
        if (l.criado_em) { const d = new Date(l.criado_em); if (d.getMonth() === mesAtual && d.getFullYear() === anoAtual) novosMes++ }
      }
      // deno-lint-ignore no-explicit-any
      const estagioOrdem: Record<string, number> = {}; for (const l of leads ?? []) { const e = (l as any).crm_estagios; if (e?.nome) estagioOrdem[e.nome] = e.ordem ?? 99 }
      const porEstagioSorted: Record<string, number> = {}
      for (const k of Object.keys(porEstagio).sort((a, b) => (estagioOrdem[a] ?? 99) - (estagioOrdem[b] ?? 99))) porEstagioSorted[k] = porEstagio[k]
      // Matriculas summary for requested year
      const { data: matrs } = await sb.from('crm_matriculas').select('status').eq('escola_id', escolaId).eq('ano', anoParam)
      let matriculados = 0, reservas = 0
      for (const m of matrs ?? []) { if (m.status === 'matriculado') matriculados++; if (m.status === 'reserva') reservas++ }
      const { data: vagas } = await sb.from('crm_turmas_vagas').select('vagas_total').eq('escola_id', escolaId).eq('ano', anoParam)
      const totalVagas = (vagas ?? []).reduce((s: number, v: { vagas_total: number }) => s + (v.vagas_total || 0), 0)
      // Metas for current year + realized counts from actual data
      const { data: metas } = await sb.from('comercial_metas').select('mes, meta_leads, meta_matriculas, meta_valor')
        .eq('escola_id', escolaId).eq('ano', anoAtual).order('mes')
      // Count leads/matriculas created per month this year
      const { data: leadsThisYear } = await sb.from('crm_leads').select('criado_em').eq('escola_id', escolaId).gte('criado_em', `${anoAtual}-01-01`).lte('criado_em', `${anoAtual}-12-31T23:59:59`)
      const { data: matsThisYear } = await sb.from('crm_matriculas').select('criado_em').eq('escola_id', escolaId).eq('ano', anoAtual)
      const leadsPorMes: Record<number, number> = {}
      const matsPorMes: Record<number, number> = {}
      for (const l of leadsThisYear ?? []) { const m = new Date(l.criado_em).getMonth() + 1; leadsPorMes[m] = (leadsPorMes[m] || 0) + 1 }
      for (const m of matsThisYear ?? []) { const mo = new Date(m.criado_em).getMonth() + 1; matsPorMes[mo] = (matsPorMes[mo] || 0) + 1 }
      // deno-lint-ignore no-explicit-any
      const metasEnriched = (metas ?? []).map((mt: any) => ({ ...mt, realizado_leads: leadsPorMes[mt.mes] || 0, realizado_matriculas: matsPorMes[mt.mes] || 0 }))
      return json({ total: (leads ?? []).length, novos_mes: novosMes, por_estagio: porEstagioSorted, por_origem: porOrigem, valor_pipeline: valorPipeline, matriculados, reservas, total_vagas: totalVagas, ano_mat: anoParam, metas: metasEnriched })
    }

    // ── Metas ──
    if (action === 'sec_metas_list') {
      if (!sec.features?.includes('metas')) return json({ error: 'Recurso não habilitado.' }, 403)
      const ano = parseInt(body.ano as string) || new Date().getFullYear()
      const { data } = await sb.from('comercial_metas').select('*').eq('secretaria_id', sec.id).eq('ano', ano).order('mes')
      return json(data ?? [])
    }
  }

  // ━━ MANAGER ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const isManagerAction = [
    'diplomas_pendentes', 'diplomas_all', 'diploma_aprovar', 'diploma_rejeitar',
    'professora_set_senha',
    'secretarias_list', 'secretaria_create', 'secretaria_update', 'secretaria_delete',
    'secretaria_metas_save', 'secretaria_metas_list_all',
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
        .eq('escola_id', (ger as any).escola_id).eq('status', 'pendente').order('criado_em', { ascending: true })
      return json({ data: data ?? [] })
    }

    if (action === 'diplomas_all') {
      const filterStatus: string | undefined = body.status
      let query = sb.from('diplomas_professoras').select('*, professoras(nome, email)')
        .eq('escola_id', (ger as any).escola_id).order('criado_em', { ascending: false })
      if (filterStatus && filterStatus !== 'todos') query = query.eq('status', filterStatus)
      const { data } = await query
      return json({ data: data ?? [] })
    }

    if (action === 'diploma_aprovar') {
      const { id } = body
      if (!id) return json({ error: 'ID do diploma não informado.' }, 400)
      const { data: diploma } = await sb
        .from('diplomas_professoras').select('carga_horaria, nome_curso, professora_id, professoras(email)').eq('id', id).eq('escola_id', (ger as any).escola_id).maybeSingle()
      if (!diploma) return json({ error: 'Diploma não encontrado.' }, 404)
      const { error } = await sb.from('diplomas_professoras').update({
        status: 'aprovado', pontuacao: diploma.carga_horaria,
        validado_por: ger.nome, data_validacao: new Date().toISOString(),
        observacao: body.observacao || null,
      }).eq('id', id).eq('escola_id', (ger as any).escola_id)
      if (error) return json({ error: error.message }, 400)
      const profEmail = diploma.professoras?.email
      if (profEmail) await criarNotif(sb, 'professora', profEmail, 'Diploma aprovado', `Seu diploma "${diploma.nome_curso}" foi ✅ aprovado! +${diploma.carga_horaria} pontos.`, 'success', (ger as any).escola_id)
      return json({ ok: true })
    }

    if (action === 'diploma_rejeitar') {
      const { id } = body
      if (!id) return json({ error: 'ID do diploma não informado.' }, 400)
      const { data: diploma } = await sb
        .from('diplomas_professoras').select('nome_curso, professora_id, professoras(email)').eq('id', id).eq('escola_id', (ger as any).escola_id).maybeSingle()
      const { error } = await sb.from('diplomas_professoras').update({
        status: 'rejeitado', pontuacao: 0,
        validado_por: ger.nome, data_validacao: new Date().toISOString(),
        observacao: body.observacao || null,
      }).eq('id', id).eq('escola_id', (ger as any).escola_id)
      if (error) return json({ error: error.message }, 400)
      const profEmail = diploma?.professoras?.email
      if (profEmail) await criarNotif(sb, 'professora', profEmail, 'Diploma rejeitado', `Seu diploma "${diploma.nome_curso}" foi ❌ rejeitado.${body.observacao ? ' Motivo: ' + body.observacao : ''}`, 'error', (ger as any).escola_id)
      return json({ ok: true })
    }

    if (action === 'secretarias_list') {
      if (!(ger as any)?.escola_id) return json({ error: 'Gerente sem escola.' }, 403)
      const { data } = await sb.from('secretarias').select('id, nome, email, telefone, features, ativo, criado_em').eq('escola_id', (ger as any).escola_id).order('nome')
      return json({ data: data ?? [] })
    }

    if (action === 'secretaria_create') {
      const nome: string = (body.nome || '').trim()
      const email: string = (body.email || '').toLowerCase().trim()
      const senha: string = body.senha || ''
      const telefone: string = (body.telefone || '').trim()
      const features: string[] = Array.isArray(body.features) ? body.features : ['atestados']
      if (!nome || !email || !senha) return json({ error: 'Preencha todos os campos.' }, 400)
      if (senha.length < 6) return json({ error: 'Senha mínima de 6 caracteres.' }, 400)
      if (!(ger as any)?.escola_id) return json({ error: 'Gerente sem escola.' }, 403)
      const { error } = await sb.from('secretarias').insert({ nome, email, senha_hash: await hashSenha(senha), telefone: telefone || null, features, escola_id: (ger as any).escola_id })
      if (error) return json({ error: error.code === '23505' ? 'E-mail já cadastrado.' : error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'secretaria_update') {
      const { id, nome, email, senha, telefone, features, ativo } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const update: Record<string, unknown> = {}
      if (nome) update.nome = (nome as string).trim()
      if (email) update.email = (email as string).toLowerCase().trim()
      if (telefone !== undefined) update.telefone = (telefone as string || '').trim() || null
      if (Array.isArray(features)) update.features = features
      if (ativo !== undefined) update.ativo = ativo
      if (senha) {
        if ((senha as string).length < 6) return json({ error: 'Senha mínima de 6 caracteres.' }, 400)
        update.senha_hash = await hashSenha(senha as string)
      }
      const { error } = await sb.from('secretarias').update(update).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'secretaria_delete') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      await sb.from('secretarias').update({ ativo: false }).eq('id', id)
      return json({ ok: true })
    }

    if (action === 'secretaria_metas_save') {
      const { secretaria_id, mes, ano, meta_leads, meta_matriculas, meta_valor } = body
      if (!secretaria_id || !mes || !ano) return json({ error: 'secretaria_id, mês e ano obrigatórios.' }, 400)
      await sb.from('comercial_metas').upsert({
        secretaria_id, mes: parseInt(mes as string), ano: parseInt(ano as string),
        meta_leads: parseInt(meta_leads as string) || 0,
        meta_matriculas: parseInt(meta_matriculas as string) || 0,
        meta_valor: parseFloat(meta_valor as string) || 0,
        escola_id: (ger as any).escola_id,
      }, { onConflict: 'secretaria_id,mes,ano' })
      return json({ ok: true })
    }

    if (action === 'secretaria_metas_list_all') {
      const ano = parseInt(body.ano as string) || new Date().getFullYear()
      const { data } = await sb.from('comercial_metas').select('*, secretarias(nome)').eq('ano', ano).eq('escola_id', (ger as any).escola_id).order('mes')
      return json(data ?? [])
    }

    // ── PDI: gestora ────────────────────────────────────────

    if (action === 'pdi_ciclos_list') {
      const { data } = await sb.from('pdi_ciclos').select('*').eq('escola_id', (ger as any).escola_id).order('ano', { ascending: false })
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
      if (!(ger as any)?.escola_id) return json({ error: 'Gerente sem escola.' }, 403)
      const { data: professoras } = await sb.from('professoras').select('id, nome, email').eq('escola_id', (ger as any).escola_id).order('nome')
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
      }).eq('id', pdi_id).eq('escola_id', (ger as any).escola_id)
      if (error) return json({ error: error.message }, 400)
      const profEmail = pdi.professoras?.email
      if (profEmail) await criarNotif(sb, 'professora', profEmail, 'Growth Plan aprovado', `Seu Annual Growth Plan foi ✅ aprovado e está em andamento.${feedback ? ' Feedback: ' + feedback : ''}`, 'success', (ger as any).escola_id)
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
      }).eq('id', pdi_id).eq('escola_id', (ger as any).escola_id)
      if (error) return json({ error: error.message }, 400)
      const profEmail = pdi.professoras?.email
      if (profEmail) await criarNotif(sb, 'professora', profEmail, 'Growth Plan devolvido', `Seu Annual Growth Plan foi devolvido para revisão. Feedback: ${feedback}`, 'warning', (ger as any).escola_id)
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
      }).eq('id', pdi_id).eq('escola_id', (ger as any).escola_id)
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
        .eq('id', acompanhamento_id).eq('escola_id', (ger as any).escola_id)
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
        .eq('email', emailPai).limit(1)
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
          .eq('email', emailPai).order('criado_em', { ascending: false })
        sols = data ?? []
      }

      // Fallback: busca também na tabela familias
      const { data: fams } = await sb
        .from('familias').select('nome_aluno, serie')
        .eq('email', emailPai)
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
          .eq('email', emailPai).limit(1)
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

      const pickupEscolaId = await resolveEscolaId(req, sb, null, body)
      const { data: novo, error: err } = await sb.from('pickup_notificacoes').insert({
        email_pai: emailPai, nome_resp, nome_crianca,
        serie: serie || null, lat_pai, lon_pai,
        eta_minutos, eta_modo, status: 'a_caminho',
        escola_id: pickupEscolaId,
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
        .from('pickup_notificacoes').select('id, crianca_nome, status, saiu_em, eta_minutos, modo_transporte')
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
      const { data } = await sb.from('series').select('nome').eq('escola_id', (prof as any).escola_id).order('nome')
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
        .eq('escola_id', (prof as any).escola_id)
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
    const { nome, unidade, descricao } = body as any
    if (!nome) return json({ error: 'Nome do item não informado.' }, 400)

    // Inclui descricao (especificação) na busca para encontrar produto correto (ex: "250ml")
    const query = descricao ? `${nome.trim()} ${descricao.trim()}` : nome.trim()
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
      frete_gratis?: boolean
      full?: boolean
      condicao?: 'novo' | 'usado' | null
      qty_pacote?: number | null
      unidade_pacote?: string | null
      preco_unit_norm?: number | null
      preco_unit_norm_fmt?: string | null
    }
    const results: PriceResult[] = []
    const fontes: Record<string, { status: string; produtos: number; erro?: string }> = {}

    function parsePackQty(title: string): { qty: number; unidade: string } | null {
      const t = (title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      // Ordem importa: padrões mais específicos/contextuais primeiro.
      // "folhas" antes de "g" porque títulos de papel costumam ter "75g 500 folhas"
      // — folhas representa o conteúdo do pacote, g é só a gramatura.
      // "c/X un" antes de "X un" pra capturar contexto de pacote.
      const patterns: Array<{ rx: RegExp; un: string; mul?: number }> = [
        { rx: /(\d+)\s*(?:folhas?|fls?|fl)\b/, un: 'fl' },
        { rx: /(?:c\/|com|contendo|pacote\s*c\/|pct\s*c\/|caixa\s*c\/|cx\s*c\/)\s*(\d+)\s*(?:un|unid|unidades?|pe[çc]as?|pcs?)?\b/, un: 'un' },
        { rx: /(\d+(?:[.,]\d+)?)\s*(?:litros?|lt|l)\b/, un: 'ml', mul: 1000 },
        { rx: /(\d+(?:[.,]\d+)?)\s*(?:ml|mililitros?)\b/, un: 'ml' },
        { rx: /(\d+(?:[.,]\d+)?)\s*(?:kg|kilos?|quilos?)\b/, un: 'g', mul: 1000 },
        { rx: /(\d+(?:[.,]\d+)?)\s*(?:gr|gramas?|g)\b/, un: 'g' },
        { rx: /(\d+)\s*(?:un|unid|unidades?|pe[çc]as?|pcs?)\b/, un: 'un' },
      ]
      for (const p of patterns) {
        const m = p.rx.exec(t)
        if (m) {
          const qty = parseFloat(m[1].replace(',', '.'))
          if (qty > 0 && qty < 100000) return { qty: qty * (p.mul || 1), unidade: p.un }
        }
      }
      return null
    }
    function fmtUnitPrice(n: number, un: string): string {
      const v = n.toLocaleString('pt-BR', { minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: 4 })
      return `R$ ${v}/${un}`
    }

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
        fontes['Zoom'] = { status: 'ok', produtos: results.filter(r => r.plataforma === 'Zoom' && r.tipo === 'produto').length }
      } else {
        fontes['Zoom'] = { status: 'bloqueado', produtos: 0, erro: `HTTP ${zoomRes.status}` }
      }
    } catch (e) { fontes['Zoom'] = { status: 'erro', produtos: 0, erro: (e as Error).message?.substring(0, 50) } }

    if (!results.some(r => r.plataforma === 'Zoom' && r.tipo === 'produto')) {
      if (!fontes['Zoom']) fontes['Zoom'] = { status: 'sem resultados', produtos: 0 }
      results.push({ plataforma: 'Zoom', nome: `Buscar "${query}" no Zoom`, preco: null, preco_fmt: 'Ver no Zoom', url_produto: `https://www.zoom.com.br/search?q=${encoded}`, url_carrinho: null, item_id: null, match: 0, tipo: 'busca' })
    }

    // ── 1. Mercado Livre — endpoint público de anúncios, ordenado por preço ─
    // Antes usávamos /products/search + /products/{id}/items?limit=1, que retorna o
    // "vencedor da BuyBox" (reputação + frete + envio rápido), NÃO o mais barato.
    // Trocamos para /sites/MLB/search?sort=price_asc — mesmo endpoint que ordena
    // a busca pública na web por menor preço. Filtra `condition=new` para evitar
    // usados misturados; mantemos a flag `condicao` no resultado caso queiram exibir.
    // /sites/MLB/search foi restringido a apps parceiras em 2026 (retorna 403
    // mesmo com OAuth). Usamos /products/search (catálogo canônico) +
    // /products/{id}/items?limit=8 — pega vários anúncios por produto e
    // mescla. Antes pegávamos limit=1 (BuyBox winner, raramente o mais
    // barato); agora coletamos até 8 por produto canônico e 3 produtos.
    try {
      const mlToken = await getMLToken(sb)
      if (!mlToken) {
        fontes['Mercado Livre'] = { status: 'sem token', produtos: 0, erro: 'OAuth ML não conectado' }
      } else {
        const mlHeaders: Record<string, string> = {
          'Accept': 'application/json',
          'Authorization': `Bearer ${mlToken}`,
        }
        const mlSearchRes = await fetch(
          `https://api.mercadolibre.com/products/search?status=active&site_id=MLB&q=${encoded}&limit=3`,
          { headers: mlHeaders }
        )
        let mlCount = 0
        if (mlSearchRes.ok) {
          const mlSearchData = await mlSearchRes.json()
          const products = mlSearchData.results ?? []

          for (const prod of products.slice(0, 3)) {
            try {
              const itemsRes = await fetch(
                `https://api.mercadolibre.com/products/${prod.id}/items?limit=8`,
                { headers: mlHeaders }
              )
              if (!itemsRes.ok) continue // 404 "No winners found" é comum, ignora
              const itemsData = await itemsRes.json()
              for (const it of (itemsData.results ?? [])) {
                if (!(it.price > 0)) continue
                if (it.condition && it.condition !== 'new') continue // só novos
                const title = it.title ?? prod.name ?? ''
                const m = matchPct(query, title)
                const mlId = it.item_id ?? it.id ?? null
                const freteGratis = it?.shipping?.free_shipping === true
                const isFull = it?.shipping?.logistic_type === 'fulfillment'
                const cond = it.condition === 'new' ? 'novo' : null
                const pack = parsePackQty(title)
                let precoNorm: number | null = null
                let precoNormFmt: string | null = null
                if (pack && pack.qty > 0) {
                  precoNorm = it.price / pack.qty
                  precoNormFmt = fmtUnitPrice(precoNorm, pack.unidade)
                }
                results.push({
                  plataforma: 'Mercado Livre',
                  nome: title,
                  preco: it.price,
                  preco_fmt: `R$ ${parseFloat(it.price).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                  url_produto: it.permalink ?? (mlId ? `https://produto.mercadolivre.com.br/${mlId}` : `https://www.mercadolivre.com.br/p/${prod.id}`),
                  url_carrinho: mlId ? `https://www.mercadolivre.com.br/checkout/buy?item.id=${mlId}&item.quantity=1` : null,
                  item_id: mlId,
                  match: m,
                  tipo: 'produto',
                  frete_gratis: freteGratis,
                  full: isFull,
                  condicao: cond,
                  qty_pacote: pack?.qty ?? null,
                  unidade_pacote: pack?.unidade ?? null,
                  preco_unit_norm: precoNorm,
                  preco_unit_norm_fmt: precoNormFmt,
                })
                mlCount++
              }
            } catch (e) { console.warn('[diplomas] ML product items skipped:', (e as Error).message) }
          }
          fontes['Mercado Livre'] = { status: mlCount > 0 ? 'ok' : 'sem resultados', produtos: mlCount }
        } else {
          fontes['Mercado Livre'] = { status: 'bloqueado', produtos: 0, erro: `HTTP ${mlSearchRes.status}` }
        }
      }
    } catch (e) { fontes['Mercado Livre'] = { status: 'erro', produtos: 0, erro: (e as Error).message?.substring(0, 50) } }

    if (!results.some(r => r.plataforma === 'Mercado Livre' && r.tipo === 'produto')) {
      results.push({
        plataforma: 'Mercado Livre',
        nome: `Buscar "${query}" no Mercado Livre`,
        preco: null, preco_fmt: 'Ver no ML',
        url_produto: `https://lista.mercadolivre.com.br/${query.replace(/\s+/g, '-')}`,
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
        fontes['Shopee'] = { status: 'ok', produtos: results.filter(r => r.plataforma === 'Shopee' && r.tipo === 'produto').length }
      } else {
        fontes['Shopee'] = { status: 'bloqueado', produtos: 0, erro: `HTTP ${shopeeRes.status}` }
      }
    } catch (e) { fontes['Shopee'] = { status: 'erro', produtos: 0, erro: (e as Error).message?.substring(0, 50) } }

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
        fontes['Reval'] = { status: 'ok', produtos: count }
      } else {
        fontes['Reval'] = { status: 'bloqueado', produtos: 0, erro: `HTTP ${revalRes.status}` }
      }
    } catch (e) { fontes['Reval'] = { status: 'erro', produtos: 0, erro: (e as Error).message?.substring(0, 50) } }

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

    // Sort: produtos com preço, mais barato primeiro. Quando há preço unitário
    // normalizado (R$/fl, R$/g, R$/ml, R$/un), agrupamos por unidade e ranqueamos
    // os com a unidade mais frequente pelo preço unitário (compara pacotes de
    // tamanhos diferentes). O resto cai pro sort por preço total.
    const produtosTodos = results.filter(r => r.tipo === 'produto' && r.preco != null)
    const unidadeFreq: Record<string, number> = {}
    for (const r of produtosTodos) {
      if (r.preco_unit_norm != null && r.unidade_pacote) {
        unidadeFreq[r.unidade_pacote] = (unidadeFreq[r.unidade_pacote] || 0) + 1
      }
    }
    const unidadeRef = Object.entries(unidadeFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || null
    const produtos = produtosTodos.sort((a, b) => {
      if (unidadeRef) {
        const aRef = a.unidade_pacote === unidadeRef && a.preco_unit_norm != null
        const bRef = b.unidade_pacote === unidadeRef && b.preco_unit_norm != null
        if (aRef && bRef) return (a.preco_unit_norm ?? 0) - (b.preco_unit_norm ?? 0)
        if (aRef) return -1
        if (bRef) return 1
      }
      return (a.preco ?? 0) - (b.preco ?? 0)
    })
    const semPreco = results.filter(r => r.tipo === 'produto' && r.preco == null)
    const links    = results.filter(r => r.tipo === 'busca')

    fontes['Amazon'] = { status: 'apenas link', produtos: 0 }

    return json({ data: [...produtos, ...semPreco, ...links], query, fontes, unidade_ref: unidadeRef })
  }

  // ── ATUALIZAÇÃO AUTOMÁTICA DE PREÇOS ────────────────────
  if (action === 'alm_atualizar_precos') {
    // Atualiza preços via Zoom.com.br (funciona server-side)
    const { data: insumos } = await sb.from('alm_insumos').select('id, nome, unidade, preco, descricao, referencia_fonte').eq('ativo', true)
    if (!insumos?.length) return json({ ok: true, atualizados: 0, pulados: 0 })
    // Pula insumos com preço atualizado manualmente pelo gerente
    const autoInsumos = insumos.filter((i: any) => i.referencia_fonte !== 'manual')
    const pulados = insumos.length - autoInsumos.length

    let atualizados = 0
    for (const insumo of autoInsumos) {
      try {
        const query = insumo.descricao ? `${insumo.nome.trim()} ${insumo.descricao.trim()}` : insumo.nome.trim()
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
        } catch (e) { console.warn('[diplomas] Zoom price scrape failed:', (e as Error).message) }

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
        } catch (e) { console.warn('[diplomas] ML price scrape failed:', (e as Error).message) }

        if (melhorPreco !== null && melhorPreco > 0) {
          await sb.from('alm_insumos').update({ preco: melhorPreco }).eq('id', insumo.id)
          atualizados++
        }

        await new Promise(r => setTimeout(r, 300))
      } catch (e) { console.warn('[diplomas] Price update loop error for insumo:', (e as Error).message) }
    }

    return json({ ok: true, atualizados, total: insumos.length, pulados })
  }

  // ━━ ALMOXARIFADO: PURCHASE TRACKING (gerente only) ━━━━━━━━

  // ── Gerente creates requisition on behalf of a teacher ──────
  if (action === 'alm_criar_req_gerente') {
    const gerente = await getGerente(sb, token)
    if (!gerente) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)
    const { professora_id, itens, observacao } = body
    if (!professora_id) return json({ error: 'professora_id obrigatório.' }, 400)
    if (!itens?.length)  return json({ error: 'Adicione pelo menos um item.' }, 400)
    for (const it of itens as any[]) {
      const semId = !it.insumo_id || it.insumo_id === 'null' || it.insumo_id === 'undefined'
      if (!semId) continue
      const link = String(it.link_referencia || '').trim()
      if (!link) return json({ error: `Inclua o link do produto para o setor de compras conferir o preço — material "${it.nome || '?'}".` }, 400)
      try {
        const u = new URL(link)
        if (u.protocol !== 'https:') return json({ error: `O link de "${it.nome || '?'}" precisa começar com https://` }, 400)
      } catch {
        return json({ error: `O link de "${it.nome || '?'}" é inválido.` }, 400)
      }
    }
    const mes = new Date().toISOString().slice(0, 7)
    const { data: profData } = await sb
      .from('professoras').select('serie_id').eq('id', professora_id).maybeSingle()
    const turma_id = (profData as any)?.serie_id ?? null
    const total = (itens as any[]).reduce((s: number, it: any) =>
      s + (parseFloat(it.qty_solicitado) * parseFloat(it.preco_unit || 0)), 0)
    if (!(gerente as any)?.escola_id) return json({ error: 'Sessão sem escola associada.' }, 403)
    const { data: nova, error: err } = await sb.from('alm_requisicoes').insert({
      professora_id, turma_id, mes,
      itens,
      total,
      observacao: observacao || `Criada pela gerente ${gerente.nome}`,
      escola_id: (gerente as any).escola_id,
    }).select('id').single()
    if (err) return json({ error: err.message }, 400)
    return json({ ok: true, id: nova.id })
  }

  const isAlmCompraAction = [
    'alm_encaminhar_compra', 'alm_compras_pendentes',
    'alm_compras_todas', 'alm_marcar_comprado', 'alm_cancelar_compra',
  ].includes(action)

  if (isAlmCompraAction) {
    // Almoxarifado também pode operar compras (parte do fluxo aprovar → comprar)
    let gerente: any = await getGerente(sb, token)
    if (!gerente) {
      const almox = await getAlmoxarifado(sb, token)
      if (almox) gerente = almox
    }
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
        escola_id: (gerente as any).escola_id,
      }))
      const { error } = await sb.from('alm_compras').insert(rows)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, encaminhados: rows.length })
    }

    if (action === 'alm_compras_pendentes') {
      const { data } = await sb
        .from('alm_compras')
        .select('*, alm_requisicoes(mes, professoras(nome), series(nome))')
        .eq('escola_id', (gerente as any).escola_id)
        .eq('status', 'pendente')
        .order('encaminhado_em', { ascending: false })
      return json({ data: data ?? [] })
    }

    if (action === 'alm_compras_todas') {
      const status: string = body.status || ''
      let q = sb.from('alm_compras')
        .select('*, alm_requisicoes(mes, professoras(nome), series(nome))')
        .eq('escola_id', (gerente as any).escola_id)
        .order('encaminhado_em', { ascending: false })
        .limit(200)
      if (status) q = q.eq('status', status)
      const { data } = await q
      return json({ data: data ?? [] })
    }

    if (action === 'alm_marcar_comprado') {
      const { ids } = body   // array of alm_compras IDs
      if (!ids?.length) return json({ error: 'IDs não informados.' }, 400)
      const { data: updated, error } = await sb.from('alm_compras').update({
        status:      'comprado',
        comprado_em:  new Date().toISOString(),
        comprado_por: gerente.nome,
      })
        .in('id', ids)
        .eq('escola_id', (gerente as any).escola_id)
        .select('id')
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, marcados: updated?.length ?? 0 })
    }

    if (action === 'alm_cancelar_compra') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('alm_compras')
        .update({ status: 'cancelado' })
        .eq('id', id)
        .eq('escola_id', (gerente as any).escola_id)
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
      let q = sb.from('alm_insumos').select('*').eq('ativo', true)
      if ((prof as any).escola_id) q = q.eq('escola_id', (prof as any).escola_id)
      const { data } = await q.order('categoria').order('nome')
      return json({ data: data ?? [] })
    }

    if (action === 'alm_minha_turma') {
      const mes = body.mes || new Date().toISOString().slice(0, 7)
      const { data: profData } = await sb
        .from('professoras').select('serie_id, series_monitoras')
        .eq('id', prof.id).maybeSingle()
      // Todas as turmas da professora (serie_id + series_monitoras)
      const turmaIds: string[] = [...new Set([
        (profData as any)?.serie_id,
        ...((profData as any)?.series_monitoras || [])
      ].filter(Boolean))]
      if (!turmaIds.length) return json({ turma: null, turmas: [], orcamento: null })
      const { data: turmasData } = await sb.from('series').select('id, nome').in('id', turmaIds).order('nome')
      const turmas = turmasData ?? []
      const turma = turmas[0] ?? null
      // Busca orçamento e gasto de cada turma
      const turmasInfo = []
      for (const t of turmas) {
        const { data: orc } = await sb.from('alm_orcamentos').select('valor').eq('turma_id', t.id).eq('mes', mes).eq('escola_id', (prof as any).escola_id).maybeSingle()
        const { data: reqs } = await sb.from('alm_requisicoes').select('total, status').eq('turma_id', t.id).eq('mes', mes).eq('escola_id', (prof as any).escola_id).in('status', ['aprovado', 'pendente'])
        const gasto = (reqs ?? []).reduce((s: number, r: any) => s + (r.total ?? 0), 0)
        const gastoAprovado = (reqs ?? []).filter((r: any) => r.status === 'aprovado').reduce((s: number, r: any) => s + (r.total ?? 0), 0)
        const gastoPendente = (reqs ?? []).filter((r: any) => r.status === 'pendente').reduce((s: number, r: any) => s + (r.total ?? 0), 0)
        const orcVal = orc?.valor ?? 0
        turmasInfo.push({ ...t, orcamento: orcVal, gasto, gasto_aprovado: gastoAprovado, gasto_pendente: gastoPendente, disponivel: Math.max(0, orcVal - gasto) })
      }
      return json({ turma, turmas: turmasInfo, orcamento: turmasInfo[0]?.orcamento ?? 0, gasto: turmasInfo[0]?.gasto ?? 0, gasto_aprovado: turmasInfo[0]?.gasto_aprovado ?? 0, gasto_pendente: turmasInfo[0]?.gasto_pendente ?? 0, disponivel: turmasInfo[0]?.disponivel ?? 0 })
    }

    if (action === 'alm_minhas_reqs') {
      const { data } = await sb
        .from('alm_requisicoes').select('*, series(nome)')
        .eq('professora_id', prof.id)
        .neq('is_draft', true)
        .order('criado_em', { ascending: false })
      return json({ data: data ?? [] })
    }

    // Carrega rascunho ativo (no máx 1 por professora) — usado pelo auto-save
    if (action === 'alm_rascunho_get') {
      const { data } = await sb.from('alm_requisicoes')
        .select('*')
        .eq('professora_id', prof.id)
        .eq('escola_id', (prof as any).escola_id)
        .eq('is_draft', true)
        .order('atualizado_em', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      return json({ rascunho: data ?? null })
    }

    // Salva/atualiza rascunho. Aceita id (update) ou cria novo se não vier.
    if (action === 'alm_rascunho_salvar') {
      const itens: any[] = body.itens || []
      const observacao: string = body.observacao || ''
      const turma_id: string | null = (body.turma_id as string) || null
      const mes = (body.mes as string) || new Date().toISOString().slice(0, 7)
      const total = itens.reduce((s: number, it: any) =>
        s + (parseFloat(it.qty_solicitado || 0) * parseFloat(it.preco_unit || 0)), 0)
      if (body.id) {
        const { error } = await sb.from('alm_requisicoes').update({
          itens, observacao, turma_id, mes, total, is_draft: true,
        }).eq('id', body.id).eq('professora_id', prof.id).eq('is_draft', true)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true, id: body.id })
      }
      const { data: nova, error } = await sb.from('alm_requisicoes').insert({
        professora_id: prof.id, turma_id, mes, itens, total, observacao,
        is_draft: true, escola_id: (prof as any).escola_id,
      }).select('id').single()
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, id: nova.id })
    }

    // Descarta rascunho atual
    if (action === 'alm_rascunho_descartar') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('alm_requisicoes').delete()
        .eq('id', id).eq('professora_id', prof.id).eq('is_draft', true)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    // Edita requisição PENDENTE (após enviada, antes de aprovação)
    if (action === 'alm_editar_req') {
      const { id, itens, observacao } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      if (!Array.isArray(itens) || !itens.length) return json({ error: 'Adicione pelo menos um item.' }, 400)
      // Aplica mesma validação de link_referencia que o criar
      for (const it of itens as any[]) {
        const semId = !it.insumo_id || it.insumo_id === 'null' || it.insumo_id === 'undefined'
        if (!semId) continue
        const link = String(it.link_referencia || '').trim()
        if (!link) return json({ error: `Inclua o link do produto — material "${it.nome || '?'}".` }, 400)
        try {
          const u = new URL(link)
          if (u.protocol !== 'https:') return json({ error: `O link de "${it.nome || '?'}" precisa começar com https://` }, 400)
        } catch {
          return json({ error: `O link de "${it.nome || '?'}" é inválido.` }, 400)
        }
      }
      const total = itens.reduce((s: number, it: any) =>
        s + (parseFloat(it.qty_solicitado || 0) * parseFloat(it.preco_unit || 0)), 0)
      const { error } = await sb.from('alm_requisicoes').update({
        itens, observacao: observacao ?? null, total,
      }).eq('id', id).eq('professora_id', prof.id).eq('status', 'pendente')
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    // Histórico de requisições aprovadas/finalizadas das turmas da prof — usado p/ clonar
    if (action === 'alm_historico_turma') {
      const dias = parseInt(body.dias || 90)
      const turmaId: string | null = body.turma_id || null
      const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
      let q = sb.from('alm_requisicoes').select('id, mes, itens, total, status, criado_em, turma_id, series(nome)')
        .eq('escola_id', (prof as any).escola_id)
        .eq('professora_id', prof.id)
        .neq('is_draft', true)
        .gte('criado_em', desde)
        .order('criado_em', { ascending: false })
        .limit(50)
      if (turmaId) q = q.eq('turma_id', turmaId)
      const { data } = await q
      return json({ data: data ?? [] })
    }

    if (action === 'alm_criar_req') {
      const itens: any[] = body.itens || []
      const observacao: string = body.observacao || ''
      if (!itens.length) return json({ error: 'Adicione pelo menos um item.' }, 400)
      // Itens novos (sem insumo_id) precisam de link_referencia https válido
      for (const it of itens) {
        const semId = !it.insumo_id || it.insumo_id === 'null' || it.insumo_id === 'undefined'
        if (!semId) continue
        const link = String(it.link_referencia || '').trim()
        if (!link) return json({ error: `Inclua o link do produto (Mercado Livre, site do fornecedor, etc.) para o setor de compras conferir o preço — material "${it.nome || '?'}".` }, 400)
        try {
          const u = new URL(link)
          if (u.protocol !== 'https:') return json({ error: `O link de "${it.nome || '?'}" precisa começar com https://` }, 400)
        } catch {
          return json({ error: `O link de "${it.nome || '?'}" é inválido.` }, 400)
        }
      }
      const mes = (body.mes as string) || new Date().toISOString().slice(0, 7)
      // Turma: aceita turma_id do frontend (multi-turma) ou fallback para serie_id
      let turma_id = (body.turma_id as string) || null
      if (!turma_id) {
        const { data: profData } = await sb
          .from('professoras').select('serie_id').eq('id', prof.id).maybeSingle()
        turma_id = (profData as any)?.serie_id ?? null
      }
      const total = itens.reduce((s: number, it: any) =>
        s + (parseFloat(it.qty_solicitado) * parseFloat(it.preco_unit || 0)), 0)
      const { data: nova, error: err } = await sb.from('alm_requisicoes').insert({
        professora_id: prof.id, turma_id, mes, itens, total, observacao, escola_id: (prof as any).escola_id,
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
  // Duas camadas:
  //   • READ + APROVAR/REJEITAR: gerente OU almoxarifado
  //   • EDITAR (orçamento, catálogo, turma, mass price, set_turma): APENAS gerente

  const isAlmEditOnlyAction = [
    'alm_orcamento_set',                      // definir orçamento (papel almox NÃO pode)
    'alm_insumo_save', 'alm_insumo_del',
    'alm_insumo_set_referencia', 'alm_insumo_atualizar_auto',
    'alm_entrada_estoque',
    'alm_turma_save', 'alm_turma_del',
    'alm_atualizar_precos', 'alm_prof_set_turma',
    'alm_criar_req_gerente',
  ].includes(action)

  const isAlmGerenteAction = [
    'alm_painel', 'alm_pendentes', 'alm_todas_reqs',
    'alm_aprovar', 'alm_rejeitar',
    'alm_insumos_list', 'alm_insumo_save', 'alm_insumo_del', 'alm_insumo_set_referencia',
    'alm_insumo_atualizar_auto', 'alm_insumo_historico', 'alm_entrada_estoque',
    'alm_series_list', 'alm_turma_save', 'alm_turma_del',
    'alm_orcamentos_list', 'alm_orcamento_set',
    'alm_relatorio', 'alm_prof_set_turma',
    'alm_pdf_pendentes', 'alm_pdf_aprovados', 'alm_pdf_observacoes', 'alm_excel_observacoes',
    'alm_pdf_entregues', 'alm_pdf_guia_recebimento', 'alm_pdf_romaneio_turma',
  ].includes(action)

  if (isAlmGerenteAction) {
    // Tenta gerente primeiro; se não for, aceita almoxarifado para ações permitidas
    let gerente: any = await getGerente(sb, token)
    if (!gerente) {
      const almox = await getAlmoxarifado(sb, token)
      if (almox) {
        if (isAlmEditOnlyAction) {
          return json({ error: 'Almoxarifado não pode editar este recurso — restrito ao gerente.', code: 'FORBIDDEN_ALMOXARIFADO' }, 403)
        }
        gerente = almox // adapta para o shape esperado abaixo (id, nome, email, escola_id)
      }
    }
    if (!gerente) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    if (action === 'alm_painel') {
      const mes = body.mes || new Date().toISOString().slice(0, 7)
      const [{ count: pendentes }, { data: reqsMes }, { data: turmas }, { data: orcamentos }] =
        await Promise.all([
          sb.from('alm_requisicoes').select('*', { count: 'exact', head: true }).eq('status', 'pendente').eq('escola_id', gerente.escola_id),
          sb.from('alm_requisicoes').select('total, turma_id, status').eq('mes', mes).eq('escola_id', gerente.escola_id).in('status', ['aprovado', 'pendente']),
          sb.from('series').select('id, nome').eq('ativo', true).eq('escola_id', gerente.escola_id),
          sb.from('alm_orcamentos').select('turma_id, valor').eq('mes', mes).eq('escola_id', gerente.escola_id),
        ])
      const totalAprovado = (reqsMes ?? []).filter((r: any) => r.status === 'aprovado').reduce((s: number, r: any) => s + (r.total ?? 0), 0)
      const orcMap: Record<string, number> = {}
      for (const o of orcamentos ?? []) orcMap[o.turma_id] = o.valor
      const gastoAprovMap: Record<string, number> = {}
      const gastoPendMap: Record<string, number> = {}
      for (const r of reqsMes ?? []) {
        if (r.status === 'aprovado') gastoAprovMap[r.turma_id] = (gastoAprovMap[r.turma_id] ?? 0) + r.total
        if (r.status === 'pendente') gastoPendMap[r.turma_id] = (gastoPendMap[r.turma_id] ?? 0) + r.total
      }
      const turmasStats = (turmas ?? []).map((t: any) => {
        const orc = orcMap[t.id] ?? 0
        const gastoAprov = gastoAprovMap[t.id] ?? 0
        const gastoPend = gastoPendMap[t.id] ?? 0
        return { ...t, orcamento: orc, gasto: gastoAprov + gastoPend, gasto_aprovado: gastoAprov, gasto_pendente: gastoPend, disponivel: Math.max(0, orc - gastoAprov - gastoPend) }
      })
      return json({ pendentes: pendentes ?? 0, totalAprovado, turmas: turmasStats, mes })
    }

    if (action === 'alm_pendentes') {
      const { data } = await sb
        .from('alm_requisicoes')
        .select('*, professoras(nome, email), series(nome)')
        .eq('status', 'pendente').eq('escola_id', gerente.escola_id).order('criado_em', { ascending: true })
      return json({ data: data ?? [] })
    }

    // ── PDFs do Almoxarifado ──
    if (action === 'alm_pdf_pendentes') {
      const { data: reqs } = await sb.from('alm_requisicoes')
        .select('*, professoras(nome), series(nome)')
        .eq('status', 'pendente').eq('escola_id', gerente.escola_id).order('criado_em', { ascending: true })
      const rows: string[][] = []
      let totalGeral = 0
      for (const r of (reqs ?? []) as any[]) {
        for (const it of (r.itens || [])) {
          const qty = Number(it.qty_solicitado || 0)
          const pu = Number(it.preco_unit || 0)
          const tot = qty * pu
          totalGeral += tot
          rows.push([
            r.series?.nome || '—',
            r.professoras?.nome || '—',
            it.nome || '—',
            `${qty} ${it.unidade || ''}`,
            `R$ ${pu.toFixed(2)}`,
            `R$ ${tot.toFixed(2)}`,
          ])
        }
      }
      const bytes = await generatePdf({
        title: 'Requisições Pendentes de Aprovação',
        subtitle: `${(reqs ?? []).length} requisição(ões)  ·  ${rows.length} item(ns)  ·  Total estimado: R$ ${totalGeral.toFixed(2)}`,
        tables: [{
          columns: [
            { label: 'Turma',   width: 80 },
            { label: 'Prof.',   width: 90 },
            { label: 'Item',    width: 160 },
            { label: 'Qtd',     width: 60, align: 'right' },
            { label: 'P. Unit', width: 55, align: 'right' },
            { label: 'Total',   width: 70, align: 'right' },
          ],
          rows: rows.length ? rows : [['(nenhum item pendente)', '', '', '', '', '']],
          footer: ['', '', '', '', 'TOTAL', `R$ ${totalGeral.toFixed(2)}`],
        }],
      })
      return pdfResponse(bytes, `pendentes-${new Date().toISOString().slice(0,10)}.pdf`)
    }

    if (action === 'alm_pdf_aprovados') {
      // "Ordem de compra" — agrupada por fornecedor/plataforma
      const { data: compras } = await sb.from('alm_compras')
        .select('*, alm_requisicoes!inner(professora_id, turma_id, escola_id, series(nome), professoras(nome))')
        .eq('status', 'pendente')
        .eq('alm_requisicoes.escola_id', gerente.escola_id)
        .order('plataforma')
      const grupos: Record<string, any[]> = {}
      for (const c of (compras ?? []) as any[]) {
        const k = c.plataforma || 'Sem fornecedor'
        ;(grupos[k] ||= []).push(c)
      }
      const tables = [] as any[]
      let totalGeral = 0
      for (const [plat, items] of Object.entries(grupos)) {
        let sub = 0
        const rows = items.map((c: any) => {
          const turma = c.alm_requisicoes?.series?.nome || '—'
          const prof = c.alm_requisicoes?.professoras?.nome || '—'
          const qty = Number(c.qty || 0)
          const pu = Number(c.preco_unit || 0)
          const tot = Number(c.preco_total || qty * pu)
          sub += tot
          return [
            c.produto_nome || c.insumo_nome,
            `${qty}`,
            `R$ ${pu.toFixed(2)}`,
            `R$ ${tot.toFixed(2)}`,
            `${turma} / ${prof}`,
            c.url_produto || '',
          ]
        })
        totalGeral += sub
        tables.push({
          heading: `${plat}  —  R$ ${sub.toFixed(2)}`,
          columns: [
            { label: 'Produto', width: 180 },
            { label: 'Qtd',     width: 40, align: 'right' },
            { label: 'P. Unit', width: 60, align: 'right' },
            { label: 'Subtotal',width: 65, align: 'right' },
            { label: 'Turma/Prof.', width: 110 },
            { label: 'Link',    width: 60 },
          ],
          rows,
          footer: ['', '', '', `R$ ${sub.toFixed(2)}`, '', ''],
        })
      }
      if (!tables.length) {
        tables.push({
          columns: [{ label: 'Info', width: 515 }],
          rows: [['Nenhuma compra pendente.']],
        })
      }
      const bytes = await generatePdf({
        title: 'Ordem de Compra — Itens Aprovados',
        subtitle: `Total geral: R$ ${totalGeral.toFixed(2)}  ·  Agrupado por fornecedor`,
        tables,
      })
      return pdfResponse(bytes, `ordem-compra-${new Date().toISOString().slice(0,10)}.pdf`)
    }

    if (action === 'alm_pdf_observacoes' || action === 'alm_excel_observacoes') {
      const mes = body.mes || new Date().toISOString().slice(0, 7)
      const landscape = body.landscape === true
      const { data: reqs } = await sb.from('alm_requisicoes')
        .select('*, professoras(nome), series(nome)')
        .eq('mes', mes)
        .order('criado_em', { ascending: true })
      const rows: string[][] = []
      let totalGeral = 0
      let comObs = 0
      let naoCatalogados = 0
      for (const r of (reqs ?? []) as any[]) {
        const prof = r.professoras?.nome || '—'
        const turma = r.series?.nome || '—'
        const obs = (r.observacao || '').trim()
        const status = r.status === 'aprovado' ? 'Aprovado' : r.status === 'rejeitado' ? 'Rejeitado' : 'Pendente'
        for (const it of (r.itens || [])) {
          const desc = (it.descricao || '').trim()
          const nota = [obs, desc].filter(Boolean).join(' | ')
          if (nota) comObs++
          if (!it.insumo_id) naoCatalogados++
          const catalogado = it.insumo_id ? 'Sim' : 'Novo'
          const qty = Number(it.qty_solicitado || 0)
          const pu = Number(it.preco_unit || 0)
          const tot = qty * pu
          totalGeral += tot
          rows.push([
            turma,
            prof,
            it.nome || '—',
            catalogado,
            `${qty} ${it.unidade || ''}`,
            status,
            `R$ ${tot.toFixed(2)}`,
            nota || '',
          ])
        }
      }

      if (action === 'alm_excel_observacoes') {
        const headers = ['Turma', 'Professora', 'Item', 'Catalogado?', 'Qtd', 'Status', 'Valor', 'Observação / Descrição / Link']
        const xlsxRows = rows.length ? rows : [['(nenhuma requisição neste mês)', '', '', '', '', '', '', '']]
        xlsxRows.push(['', '', '', '', '', '', `R$ ${totalGeral.toFixed(2)}`, ''])
        const bytes = generateXlsx(headers, xlsxRows)
        return xlsxResponse(bytes, `relatorio-completo-${mes}.xlsx`)
      }

      const colWidths = landscape
        ? [
            { label: 'Turma',    width: 70 },
            { label: 'Prof.',    width: 80 },
            { label: 'Item',     width: 120 },
            { label: 'Cat.?',   width: 35, align: 'center' as const },
            { label: 'Qtd',      width: 50, align: 'right' as const },
            { label: 'Status',   width: 55 },
            { label: 'Valor',    width: 60, align: 'right' as const },
            { label: 'Observação / Descrição / Link', width: 292 },
          ]
        : [
            { label: 'Turma',    width: 60 },
            { label: 'Prof.',    width: 65 },
            { label: 'Item',     width: 100 },
            { label: 'Cat.?',   width: 30, align: 'center' as const },
            { label: 'Qtd',      width: 45, align: 'right' as const },
            { label: 'Status',   width: 45 },
            { label: 'Valor',    width: 50, align: 'right' as const },
            { label: 'Observação / Descrição / Link', width: 120 },
          ]

      const bytes = await generatePdf({
        title: 'Relatório Completo de Requisições — com Observações',
        subtitle: `Mês: ${mes}  ·  ${rows.length} item(ns)  ·  ${comObs} com obs.  ·  ${naoCatalogados} não catalogado(s)  ·  Total: R$ ${totalGeral.toFixed(2)}`,
        landscape,
        tables: [{
          columns: colWidths,
          rows: rows.length ? rows : [['(nenhuma requisição neste mês)', '', '', '', '', '', '', '']],
          footer: ['', '', '', '', '', '', `R$ ${totalGeral.toFixed(2)}`, ''],
        }],
      })
      return pdfResponse(bytes, `relatorio-completo-${mes}.pdf`)
    }

    if (action === 'alm_pdf_entregues') {
      const mes = body.mes || new Date().toISOString().slice(0, 7)
      const ini = mes + '-01T00:00:00'
      const fim = mes + '-31T23:59:59'
      const { data: entregas } = await sb.from('alm_entregas')
        .select('*, alm_requisicoes(professoras(nome), series(nome)), alm_insumos(nome, unidade)')
        .eq('escola_id', gerente.escola_id).gte('entregue_em', ini).lte('entregue_em', fim)
        .order('entregue_em', { ascending: true })
      // Agrupa por turma
      const porTurma: Record<string, any[]> = {}
      for (const e of (entregas ?? []) as any[]) {
        const t = e.alm_requisicoes?.series?.nome || '—'
        ;(porTurma[t] ||= []).push(e)
      }
      const tables = Object.entries(porTurma).map(([turma, items]) => ({
        heading: `Turma: ${turma}  —  ${items.length} entrega(s)`,
        columns: [
          { label: 'Data',    width: 110 },
          { label: 'Item',    width: 200 },
          { label: 'Qtd',     width: 60, align: 'right' as const },
          { label: 'Professora', width: 110 },
          { label: 'Por',     width: 35 },
        ],
        rows: items.map((e: any) => [
          new Date(e.entregue_em).toLocaleString('pt-BR'),
          e.alm_insumos?.nome || '—',
          `${Number(e.qty_entregue || 0)} ${e.alm_insumos?.unidade || ''}`,
          e.alm_requisicoes?.professoras?.nome || '—',
          e.entregue_por || '—',
        ]),
      }))
      if (!tables.length) tables.push({ columns: [{ label: 'Info', width: 515 }], rows: [['Nenhuma entrega neste mês.']] })
      const bytes = await generatePdf({
        title: `Recibo de Entregas — ${mes}`,
        subtitle: `Total: ${(entregas ?? []).length} entrega(s) realizadas em ${mes}.  Arquivar para comprovação fiscal/pedagógica.`,
        tables,
      })
      return pdfResponse(bytes, `entregas-${mes}.pdf`)
    }

    if (action === 'alm_pdf_guia_recebimento') {
      try {
        const escolaId = (gerente as any).escola_id
        if (!escolaId) return json({ error: 'Sessão sem escola associada.' }, 403)
        // Itens aprovados e AINDA não entregues — com descrição completa p/ identificar quando chegar pelos correios
        const { data: reqs, error: errReqs } = await sb.from('alm_requisicoes')
          .select('*, professoras(nome), series(nome)')
          .eq('status', 'aprovado').eq('escola_id', escolaId).order('aprovado_em', { ascending: true })
        if (errReqs) {
          log.error(`alm_pdf_guia_recebimento: erro ao listar requisições: ${errReqs.message}`)
          return json({ error: 'Erro ao carregar requisições: ' + errReqs.message }, 500)
        }
        // Quantidade já entregue por (requisicao, insumo) — filtra por requisições da escola
        const reqIds = (reqs ?? []).map((r: any) => r.id)
        const entregueMap: Record<string, number> = {}
        if (reqIds.length) {
          const { data: entregasTodas } = await sb.from('alm_entregas')
            .select('requisicao_id, insumo_id, qty_entregue')
            .in('requisicao_id', reqIds)
          for (const e of (entregasTodas ?? []) as any[]) {
            const k = `${e.requisicao_id}|${e.insumo_id || ''}`
            entregueMap[k] = (entregueMap[k] || 0) + Number(e.qty_entregue || 0)
          }
        }
        // Catálogo p/ descrição/categoria
        const insumoIds = Array.from(new Set(
          (reqs ?? []).flatMap((r: any) => (r.itens || []).map((it: any) => it.insumo_id).filter(Boolean))
        ))
        const catMap: Record<string, any> = {}
        if (insumoIds.length) {
          const { data: ins } = await sb.from('alm_insumos')
            .select('id, descricao, categoria, unidade')
            .in('id', insumoIds as string[])
            .eq('escola_id', escolaId)
          for (const i of ins ?? []) catMap[i.id] = i
        }

        // Agrupa por turma — facilita conferência por sala (pedido do usuário)
        const turmas: Record<string, { nome: string; itens: any[] }> = {}
        let count = 0
        for (const r of (reqs ?? []) as any[]) {
          const tNome = r.series?.nome || 'Sem turma'
          for (const it of (r.itens || [])) {
            const aprov = Number(it.qty_aprovado || it.qty_solicitado || 0)
            const jaEntregue = entregueMap[`${r.id}|${it.insumo_id || ''}`] || 0
            const aReceber = aprov - jaEntregue
            if (aReceber <= 0) continue
            count++
            const cat = it.insumo_id ? catMap[it.insumo_id] : null
            if (!turmas[tNome]) turmas[tNome] = { nome: tNome, itens: [] }
            turmas[tNome].itens.push({
              nome: it.nome,
              aReceber,
              unidade: it.unidade || cat?.unidade || 'un',
              professora: r.professoras?.nome || '—',
              descricao: cat?.descricao || it.descricao || '',
              categoria: cat?.categoria || '',
              reqId: String(r.id).slice(0, 8),
              aprovadoEm: new Date(r.aprovado_em || r.criado_em).toLocaleDateString('pt-BR'),
              jaEntregue,
            })
          }
        }
        const sections: any[] = []
        for (const t of Object.values(turmas)) {
          sections.push({
            heading: `Turma ${t.nome}  —  ${t.itens.length} item(ns)`,
            lines: t.itens.flatMap(it => [
              `▢  ${it.nome}  —  ${it.aReceber} ${it.unidade}  ·  Prof. ${it.professora}`,
              `   ${it.descricao || '(sem descrição)'}${it.categoria ? '  ·  ' + it.categoria : ''}  ·  Req #${it.reqId}  ·  ${it.aprovadoEm}`,
              it.jaEntregue > 0 ? `   Já recebido: ${it.jaEntregue}` : '',
              '─────────────────────────────────────────────',
            ].filter(Boolean)),
          })
          // Espaço para assinatura ao final de cada turma
          sections.push({
            heading: '',
            lines: [
              `Recebido por (responsável da turma ${t.nome}): ____________________________`,
              `Data: ____/____/______      Assinatura: ____________________________`,
              '',
            ],
          })
        }
        if (!sections.length) sections.push({ heading: 'Tudo em dia', lines: ['Nenhum item aprovado aguardando chegada.'] })
        const bytes = await generatePdf({
          title: 'Guia de Recebimento por Turma',
          subtitle: `${count} item(ns) aguardando chegada dos fornecedores, agrupados por turma.\n` +
            'Use este guia ao abrir as caixas: marque o ▢ e peça assinatura do responsável de cada turma.',
          sections,
        })
        return pdfResponse(bytes, `guia-recebimento-${new Date().toISOString().slice(0,10)}.pdf`)
      } catch (e: any) {
        log.error(`alm_pdf_guia_recebimento: ${e?.message || e}`)
        return json({ error: 'Falha ao gerar PDF: ' + (e?.message || e) }, 500)
      }
    }

    if (action === 'alm_pdf_romaneio_turma') {
      // Romaneio para entrega às professoras: itens aprovados prontos para entrega agrupados por turma
      const { data: reqs } = await sb.from('alm_requisicoes')
        .select('*, professoras(nome, email), series(nome)')
        .eq('status', 'aprovado').eq('escola_id', gerente.escola_id).order('criado_em')
      const { data: entregasTodas } = await sb.from('alm_entregas').select('requisicao_id, insumo_id, qty_entregue')
      const entregueMap: Record<string, number> = {}
      for (const e of (entregasTodas ?? []) as any[]) {
        const k = `${e.requisicao_id}|${e.insumo_id || ''}`
        entregueMap[k] = (entregueMap[k] || 0) + Number(e.qty_entregue || 0)
      }
      const porTurma: Record<string, { profs: Set<string>; items: any[] }> = {}
      for (const r of (reqs ?? []) as any[]) {
        const t = r.series?.nome || '—'
        const p = r.professoras?.nome || '—'
        const bucket = (porTurma[t] ||= { profs: new Set(), items: [] })
        bucket.profs.add(p)
        for (const it of (r.itens || [])) {
          const aprov = Number(it.qty_aprovado || it.qty_solicitado || 0)
          const ja = entregueMap[`${r.id}|${it.insumo_id || ''}`] || 0
          const pend = aprov - ja
          if (pend > 0) bucket.items.push({ ...it, pend, prof: p, req: r.id })
        }
      }
      const tables = Object.entries(porTurma)
        .filter(([, b]) => b.items.length)
        .map(([turma, b]) => ({
          heading: `TURMA ${turma}  —  Professoras: ${[...b.profs].join(', ')}`,
          columns: [
            { label: '▢', width: 20, align: 'center' as const },
            { label: 'Item', width: 220 },
            { label: 'Qtd a entregar', width: 85, align: 'right' as const },
            { label: 'Professora', width: 130 },
            { label: 'Req', width: 60 },
          ],
          rows: b.items.map((it: any) => [
            '',
            it.nome,
            `${it.pend} ${it.unidade || 'un'}`,
            it.prof,
            `#${String(it.req).slice(0, 8)}`,
          ]),
          footer: ['', `Assinatura: ________________________________`, '', '', `Data: ___/___/____`],
        }))
      if (!tables.length) tables.push({ columns: [{ label: 'Info', width: 515 }], rows: [['Nada a entregar no momento.']] })
      const bytes = await generatePdf({
        title: 'Romaneio de Entrega por Turma',
        subtitle: 'Marque os itens entregues e peça a assinatura da professora ao final de cada turma.',
        tables,
      })
      return pdfResponse(bytes, `romaneio-${new Date().toISOString().slice(0,10)}.pdf`)
    }

    // ── Relatórios dinâmicos ─────────────────────────────────
    // Aceita: { filtros: {status?, turma_id?, professora_id?, data_de?, data_ate?, fornecedor?}, agrupamento? }
    // Retorna: linhas detalhadas (já filtradas) + grupos agregados
    if (action === 'alm_relatorio_query') {
      const escolaId = (gerente as any).escola_id
      const f = body.filtros || {}
      const agrup: string = body.agrupamento || ''
      let q = sb.from('alm_requisicoes')
        .select('*, professoras(nome), series(nome)')
        .eq('escola_id', escolaId)
        .neq('is_draft', true)
        .order('criado_em', { ascending: false })
        .limit(2000)
      if (f.status) q = q.eq('status', f.status)
      if (f.turma_id) q = q.eq('turma_id', f.turma_id)
      if (f.professora_id) q = q.eq('professora_id', f.professora_id)
      if (f.data_de) q = q.gte('criado_em', f.data_de)
      if (f.data_ate) q = q.lte('criado_em', f.data_ate)
      const { data: reqs } = await q
      let linhas: any[] = []
      for (const r of (reqs ?? []) as any[]) {
        for (const it of (r.itens || [])) {
          linhas.push({
            req_id: r.id,
            data: r.criado_em,
            mes: r.mes,
            status: r.status,
            turma_id: r.turma_id,
            turma: r.series?.nome || '—',
            professora_id: r.professora_id,
            professora: r.professoras?.nome || '—',
            insumo_id: it.insumo_id || null,
            nome: it.nome,
            unidade: it.unidade,
            categoria: it.categoria || null,
            qty_solicitado: parseFloat(it.qty_solicitado || 0),
            qty_aprovado: parseFloat(it.qty_aprovado || 0),
            preco_unit: parseFloat(it.preco_unit || 0),
            valor: parseFloat(it.qty_aprovado || it.qty_solicitado || 0) * parseFloat(it.preco_unit || 0),
            link: it.link_referencia || null,
          })
        }
      }
      if (f.fornecedor) {
        const term = String(f.fornecedor).toLowerCase()
        linhas = linhas.filter(l => (l.link || '').toLowerCase().includes(term))
      }
      // Agrupamento opcional
      let grupos: any[] = []
      if (agrup) {
        const map: Record<string, any> = {}
        for (const l of linhas) {
          const key = String(
            agrup === 'turma' ? l.turma :
            agrup === 'professora' ? l.professora :
            agrup === 'categoria' ? (l.categoria || 'Sem categoria') :
            agrup === 'mes' ? l.mes :
            agrup === 'status' ? l.status : 'Outros'
          )
          if (!map[key]) map[key] = { chave: key, itens: 0, qty: 0, valor: 0, linhas: [] }
          map[key].itens++
          map[key].qty += l.qty_aprovado || l.qty_solicitado
          map[key].valor += l.valor
          map[key].linhas.push(l)
        }
        grupos = Object.values(map).sort((a: any, b: any) => b.valor - a.valor)
      }
      return json({
        total_linhas: linhas.length,
        total_valor: linhas.reduce((s, l) => s + l.valor, 0),
        agrupamento: agrup || null,
        grupos,
        linhas: agrup ? [] : linhas.slice(0, 500),
      })
    }

    if (action === 'alm_relatorio_export_xlsx' || action === 'alm_relatorio_export_pdf') {
      // Reusa a query do relatório
      const escolaId = (gerente as any).escola_id
      const f = body.filtros || body
      const agrup: string = body.agrupamento || ''
      let q = sb.from('alm_requisicoes')
        .select('*, professoras(nome), series(nome)')
        .eq('escola_id', escolaId).neq('is_draft', true)
        .order('criado_em', { ascending: false }).limit(2000)
      if (f.status) q = q.eq('status', f.status)
      if (f.turma_id) q = q.eq('turma_id', f.turma_id)
      if (f.data_de) q = q.gte('criado_em', f.data_de)
      if (f.data_ate) q = q.lte('criado_em', f.data_ate)
      const { data: reqs } = await q
      const linhas: any[] = []
      for (const r of (reqs ?? []) as any[]) {
        for (const it of (r.itens || [])) {
          linhas.push({
            data: new Date(r.criado_em).toLocaleDateString('pt-BR'),
            mes: r.mes,
            status: r.status,
            turma: r.series?.nome || '—',
            professora: r.professoras?.nome || '—',
            nome: it.nome,
            unidade: it.unidade,
            categoria: it.categoria || '',
            qty: parseFloat(it.qty_aprovado || it.qty_solicitado || 0),
            preco: parseFloat(it.preco_unit || 0),
            valor: parseFloat(it.qty_aprovado || it.qty_solicitado || 0) * parseFloat(it.preco_unit || 0),
            link: it.link_referencia || '',
          })
        }
      }
      if (action === 'alm_relatorio_export_xlsx') {
        const headers = ['Data', 'Mês', 'Status', 'Turma', 'Professora', 'Item', 'Categoria', 'Qty', 'Unid.', 'Preço', 'Valor', 'Link']
        const rows = linhas.map(l => [l.data, l.mes, l.status, l.turma, l.professora, l.nome, l.categoria, String(l.qty), l.unidade, l.preco.toFixed(2), l.valor.toFixed(2), l.link])
        const xlsx = generateXlsx(headers, rows)
        return xlsxResponse(xlsx, `relatorio-requisicoes-${new Date().toISOString().slice(0,10)}.xlsx`)
      }
      // PDF: agrupa se vier, senão lista
      const sections: any[] = []
      if (agrup) {
        const map: Record<string, any> = {}
        for (const l of linhas) {
          const key = String(
            agrup === 'turma' ? l.turma :
            agrup === 'professora' ? l.professora :
            agrup === 'categoria' ? (l.categoria || 'Sem categoria') :
            agrup === 'mes' ? l.mes : agrup === 'status' ? l.status : 'Outros'
          )
          if (!map[key]) map[key] = { itens: 0, valor: 0, linhas: [] as any[] }
          map[key].itens++
          map[key].valor += l.valor
          map[key].linhas.push(l)
        }
        for (const [k, g] of Object.entries(map).sort(([,a]:any, [,b]:any) => b.valor - a.valor)) {
          sections.push({
            heading: `${k} — ${(g as any).itens} item(ns), R$ ${(g as any).valor.toFixed(2)}`,
            lines: (g as any).linhas.slice(0, 50).map((l: any) =>
              `${l.data} · ${l.nome} ×${l.qty} ${l.unidade} · R$ ${l.valor.toFixed(2)} · ${l.status}`),
          })
        }
      } else {
        sections.push({
          heading: `${linhas.length} item(ns) — Total R$ ${linhas.reduce((s, l) => s + l.valor, 0).toFixed(2)}`,
          lines: linhas.slice(0, 200).map(l =>
            `${l.data} · ${l.turma} · ${l.professora} · ${l.nome} ×${l.qty} ${l.unidade} · R$ ${l.valor.toFixed(2)} · ${l.status}`),
        })
      }
      const bytes = await generatePdf({
        title: 'Relatório dinâmico — Requisições',
        subtitle: `Filtros: ${[f.status && 'status='+f.status, f.turma_id && 'turma=…', f.data_de && 'de='+f.data_de, f.data_ate && 'até='+f.data_ate, agrup && 'agrup='+agrup].filter(Boolean).join('  ·  ') || 'sem filtros'}`,
        sections,
      })
      return pdfResponse(bytes, `relatorio-requisicoes-${new Date().toISOString().slice(0,10)}.pdf`)
    }

    if (action === 'alm_relatorio_visualizacoes_list') {
      const { data } = await sb.from('alm_relatorio_visualizacoes')
        .select('*').eq('escola_id', (gerente as any).escola_id)
        .order('atualizado_em', { ascending: false })
      return json({ data: data ?? [] })
    }

    if (action === 'alm_relatorio_visualizacao_save') {
      const { id, nome, config } = body
      if (!nome) return json({ error: 'Nome obrigatório.' }, 400)
      if (id) {
        const { error } = await sb.from('alm_relatorio_visualizacoes').update({
          nome, config, atualizado_em: new Date().toISOString(),
        }).eq('id', id).eq('escola_id', (gerente as any).escola_id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true, id })
      }
      const { data: nova, error } = await sb.from('alm_relatorio_visualizacoes').insert({
        nome, config: config || {}, criado_por: gerente.nome,
        escola_id: (gerente as any).escola_id,
      }).select('id').single()
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, id: nova.id })
    }

    if (action === 'alm_relatorio_visualizacao_delete') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('alm_relatorio_visualizacoes').delete()
        .eq('id', id).eq('escola_id', (gerente as any).escola_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'alm_todas_reqs') {
      const mes: string = body.mes || ''
      const status: string = body.status || ''
      let q = sb.from('alm_requisicoes')
        .select('*, professoras(nome, email), series(nome)')
        .eq('escola_id', gerente.escola_id)
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
        .eq('id', id).eq('escola_id', (gerente as any).escola_id).maybeSingle()
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
      }).eq('id', id).eq('escola_id', (gerente as any).escola_id)
      if (errUpdate) return json({ error: errUpdate.message }, 400)
      // Deduz estoque (regra: estoque cobre → retira; se cobre parcial,
      // retira o que tem e marca qty_a_comprar com o saldo faltante)
      for (const it of itens) {
        if (it.insumo_id && parseFloat(it.qty_aprovado) > 0) {
          const aprov = parseFloat(it.qty_aprovado)
          const { data: ins } = await sb.from('alm_insumos')
            .select('estoque_qty').eq('id', it.insumo_id)
            .eq('escola_id', (gerente as any).escola_id).maybeSingle()
          const estoqueAtual = ins ? Number((ins as any).estoque_qty || 0) : 0
          const saidaEstoque = Math.min(estoqueAtual, aprov)
          const aComprar = aprov - saidaEstoque
          if (saidaEstoque > 0) {
            await sb.from('alm_insumos').update({
              estoque_qty: estoqueAtual - saidaEstoque
            }).eq('id', it.insumo_id).eq('escola_id', (gerente as any).escola_id)
            await sb.from('alm_movimentacoes').insert({
              escola_id: (gerente as any).escola_id,
              insumo_id: it.insumo_id,
              tipo: 'saida',
              qty: saidaEstoque,
              requisicao_id: id,
              motivo: `Atendido do estoque (req aprovada)`,
              saldo_antes: estoqueAtual,
              saldo_depois: estoqueAtual - saidaEstoque,
            })
          }
          it.qty_do_estoque = saidaEstoque
          it.qty_a_comprar = aComprar
        } else if (it.qty_aprovado > 0) {
          // Item novo (sem id ainda) — auto-criação acontece logo abaixo;
          // Para esse caso, qty_a_comprar = qty_aprovado integral
          it.qty_do_estoque = 0
          it.qty_a_comprar = parseFloat(it.qty_aprovado)
        }
      }
      // Auto-create insumos for non-cataloged items
      // Trata insumo_id="null"/"undefined" (string vinda do frontend via dataset.id)
      // como ausente, e captura erros do INSERT (antes silenciados).
      const insumoWarnings: Array<{ nome: string; error: string }> = []
      for (const it of itens) {
        const semId = !it.insumo_id || it.insumo_id === 'null' || it.insumo_id === 'undefined'
        if (semId && it.nome && parseFloat(it.qty_aprovado) > 0) {
          it.insumo_id = null
          const { data: novo, error: errIns } = await sb.from('alm_insumos').insert({
            nome: it.nome,
            descricao: it.descricao || null,
            unidade: it.unidade || 'unidade',
            preco: parseFloat(it.preco_unit) || 0,
            estoque_qty: 0,
            categoria: it.categoria || null,
            referencia_url: it.link_referencia || null,
            referencia_fonte: it.link_referencia ? 'professora' : null,
            escola_id: (gerente as any).escola_id,
          }).select('id').single()
          if (errIns) {
            log.error(`alm_aprovar: falha ao criar insumo "${it.nome}" (req ${id}): ${errIns.message}`)
            insumoWarnings.push({ nome: it.nome, error: errIns.message })
          } else if (novo) {
            it.insumo_id = novo.id
          }
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
      const resp: Record<string, unknown> = { ok: true }
      if (insumoWarnings.length) resp.insumos_warnings = insumoWarnings
      return json(resp)
    }

    if (action === 'alm_rejeitar') {
      const { id, nota_gerente } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { data: req } = await sb.from('alm_requisicoes').select('professora_id, criado_em, status')
        .eq('id', id).eq('escola_id', (gerente as any).escola_id).maybeSingle()
      if (!req) return json({ error: 'Requisição não encontrada.' }, 404)
      if (req.status !== 'pendente') return json({ error: 'Requisição já processada.' }, 400)
      const { error } = await sb.from('alm_requisicoes').update({
        status: 'rejeitado', nota_gerente: nota_gerente || null,
        rejeitado_em: new Date().toISOString(),
      }).eq('id', id).eq('escola_id', (gerente as any).escola_id)
      if (error) return json({ error: error.message }, 400)
      await sb.from('alm_notificacoes').insert({
        professora_id: req.professora_id,
        requisicao_id: id,
        mensagem: `Sua requisição de ${new Date(req.criado_em).toLocaleDateString('pt-BR')} foi ❌ rejeitada.${nota_gerente ? ' Motivo: ' + nota_gerente : ''}`,
      })
      return json({ ok: true })
    }

    // Lista movimentações de um insumo (ou todas, com paginação)
    if (action === 'alm_movimentacoes_list') {
      const insumoId = body.insumo_id || null
      let q = sb.from('alm_movimentacoes')
        .select('*, alm_insumos(nome, unidade)')
        .eq('escola_id', (gerente as any).escola_id)
        .order('criado_em', { ascending: false }).limit(200)
      if (insumoId) q = q.eq('insumo_id', insumoId)
      const { data } = await q
      return json({ data: data ?? [] })
    }

    // Conferência física: registra ajuste com motivo
    if (action === 'alm_conferencia_inventario') {
      const { insumo_id, saldo_real, motivo } = body
      if (!insumo_id || saldo_real == null) return json({ error: 'insumo_id e saldo_real obrigatórios.' }, 400)
      const novo = parseFloat(saldo_real)
      if (Number.isNaN(novo) || novo < 0) return json({ error: 'saldo_real inválido.' }, 400)
      const { data: ins } = await sb.from('alm_insumos').select('estoque_qty')
        .eq('id', insumo_id).eq('escola_id', (gerente as any).escola_id).maybeSingle()
      if (!ins) return json({ error: 'Insumo não encontrado.' }, 404)
      const antes = Number((ins as any).estoque_qty || 0)
      const diff = novo - antes
      const { error: errUpd } = await sb.from('alm_insumos').update({ estoque_qty: novo })
        .eq('id', insumo_id).eq('escola_id', (gerente as any).escola_id)
      if (errUpd) return json({ error: errUpd.message }, 400)
      await sb.from('alm_movimentacoes').insert({
        escola_id: (gerente as any).escola_id,
        insumo_id,
        tipo: 'ajuste',
        qty: Math.abs(diff),
        motivo: motivo || `Conferência física: ${antes} → ${novo}`,
        saldo_antes: antes,
        saldo_depois: novo,
      })
      return json({ ok: true, antes, depois: novo, diff })
    }

    // Entrada de estoque manual (recebimento de compra)
    if (action === 'alm_entrada_estoque') {
      const { insumo_id, qty, motivo } = body
      if (!insumo_id || !qty || qty <= 0) return json({ error: 'insumo_id e qty>0 obrigatórios.' }, 400)
      const { data: ins } = await sb.from('alm_insumos').select('estoque_qty')
        .eq('id', insumo_id).eq('escola_id', (gerente as any).escola_id).maybeSingle()
      if (!ins) return json({ error: 'Insumo não encontrado.' }, 404)
      const antes = Number((ins as any).estoque_qty || 0)
      const depois = antes + parseFloat(qty)
      await sb.from('alm_insumos').update({ estoque_qty: depois })
        .eq('id', insumo_id).eq('escola_id', (gerente as any).escola_id)
      await sb.from('alm_movimentacoes').insert({
        escola_id: (gerente as any).escola_id,
        insumo_id, tipo: 'entrada', qty: parseFloat(qty),
        motivo: motivo || 'Entrada de estoque',
        saldo_antes: antes, saldo_depois: depois,
      })
      return json({ ok: true, antes, depois })
    }

    if (action === 'alm_insumos_list') {
      const { data } = await sb.from('alm_insumos').select('*').eq('escola_id', (gerente as any).escola_id).order('categoria').order('nome')
      return json({ data: data ?? [] })
    }

    if (action === 'alm_insumo_save') {
      const { id, nome, descricao, unidade, estoque_qty, preco, categoria, unidade_compra, qtd_por_embalagem } = body
      if (!nome) return json({ error: 'Nome obrigatório.' }, 400)
      const data: Record<string, unknown> = { nome, descricao, unidade, estoque_qty, preco, categoria, unidade_compra: unidade_compra || null, qtd_por_embalagem: qtd_por_embalagem || 1 }
      if (id) {
        // Se o gerente editou o preço manualmente, marcar como 'manual' para não sobrescrever na atualização automática
        const { data: old } = await sb.from('alm_insumos').select('preco').eq('id', id).maybeSingle()
        if (old && preco != null && Number(preco) !== Number(old.preco)) {
          data.referencia_fonte = 'manual'
          data.preco_atualizado_em = new Date().toISOString()
        }
        const { error } = await sb.from('alm_insumos').update(data).eq('id', id).eq('escola_id', (gerente as any).escola_id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      } else {
        const ins = { ...data, unidade: data.unidade || 'unidade', estoque_qty: data.estoque_qty || 0, preco: data.preco || 0 }
        const { data: novo, error } = await sb.from('alm_insumos').insert(ins).select('id').single()
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true, id: novo.id })
      }
    }

    if (action === 'alm_insumo_del') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('alm_insumos').update({ ativo: false }).eq('id', id).eq('escola_id', (gerente as any).escola_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'alm_insumo_set_referencia') {
      const { id, preco_referencia, referencia_nome, referencia_fonte, referencia_url } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('alm_insumos').update({
        preco_referencia: preco_referencia ?? null,
        referencia_nome: referencia_nome ?? null,
        referencia_fonte: referencia_fonte ?? null,
        referencia_url: referencia_url ?? null,
        preco_atualizado_em: preco_referencia ? new Date().toISOString() : null,
      }).eq('id', id).eq('escola_id', (gerente as any).escola_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    // Atualiza preco, embalagem e historico automaticamente a partir de busca
    if (action === 'alm_insumo_atualizar_auto') {
      const { id, preco, produto_nome, fonte, url, match_pct } = body
      if (!id || preco == null) return json({ error: 'id e preco obrigatorios.' }, 400)

      // Busca insumo atual
      const { data: ins } = await sb.from('alm_insumos').select('*').eq('id', id).maybeSingle()
      if (!ins) return json({ error: 'Insumo nao encontrado.' }, 404)

      // Tenta extrair embalagem do nome do produto encontrado
      const nomeProd = (produto_nome || '').toLowerCase()
      let unidadeCompra = ins.unidade_compra
      let qtdEmb = ins.qtd_por_embalagem || 1

      // Regex para detectar embalagem: "caixa com 100", "pacote 50un", "cx 12 un", "resma 500", etc.
      const embPatterns = [
        /(?:caixa|cx|pack|kit)\s*(?:com|c\/)?\s*(\d+)\s*(?:un|unid|pcs|pecas)?/i,
        /(?:pacote|pct|pc)\s*(?:com|c\/)?\s*(\d+)\s*(?:un|unid|folhas|fls)?/i,
        /(?:resma)\s*(?:com|c\/)?\s*(\d+)\s*(?:folhas|fls)?/i,
        /(\d+)\s*(?:un|unid|unidades|pecas|pcs|folhas|fls)\b/i,
        /(?:fardo|fd)\s*(?:com|c\/)?\s*(\d+)/i,
        /(?:rolo|rl)\s*(?:com|c\/)?\s*(\d+)\s*(?:m|metros)?/i,
      ]
      const embTypes: Record<string, string> = {
        'caixa': 'caixa', 'cx': 'caixa', 'pack': 'pacote', 'kit': 'kit',
        'pacote': 'pacote', 'pct': 'pacote', 'pc': 'pacote',
        'resma': 'resma', 'fardo': 'fardo', 'fd': 'fardo', 'rolo': 'rolo', 'rl': 'rolo',
      }

      for (const pat of embPatterns) {
        const m = pat.exec(nomeProd)
        if (m) {
          const qty = parseInt(m[1])
          if (qty > 1 && qty <= 10000) {
            qtdEmb = qty
            // Detecta tipo de embalagem
            const typeMatch = nomeProd.match(/\b(caixa|cx|pack|kit|pacote|pct|resma|fardo|fd|rolo|rl)\b/i)
            if (typeMatch) unidadeCompra = embTypes[typeMatch[1].toLowerCase()] || typeMatch[1]
            else if (qtdEmb >= 100) unidadeCompra = 'caixa'
            else unidadeCompra = 'pacote'
            break
          }
        }
      }

      // Salva historico
      await sb.from('alm_insumo_historico').insert({
        insumo_id: id,
        preco_anterior: ins.preco,
        preco_novo: preco,
        unidade_compra_anterior: ins.unidade_compra,
        unidade_compra_nova: unidadeCompra,
        qtd_emb_anterior: ins.qtd_por_embalagem,
        qtd_emb_nova: qtdEmb,
        produto_encontrado: produto_nome,
        fonte, url, match_pct,
      })

      // Atualiza insumo
      await sb.from('alm_insumos').update({
        preco: preco,
        unidade_compra: unidadeCompra,
        qtd_por_embalagem: qtdEmb,
        referencia_nome: produto_nome,
        referencia_fonte: fonte,
        referencia_url: url,
        preco_referencia: preco,
        preco_atualizado_em: new Date().toISOString(),
      }).eq('id', id).eq('escola_id', (gerente as any).escola_id)

      return json({ ok: true, qtd_por_embalagem: qtdEmb, unidade_compra: unidadeCompra })
    }

    // Historico de precos de um insumo
    if (action === 'alm_insumo_historico') {
      const { id } = body
      if (!id) return json({ error: 'ID obrigatorio.' }, 400)
      const { data } = await sb.from('alm_insumo_historico').select('*')
        .eq('insumo_id', id).order('criado_em', { ascending: false }).limit(20)
      return json({ data: data ?? [] })
    }

    // ── Entrada de estoque via XML/NF-e ──────────────────
    if (action === 'alm_entrada_estoque') {
      const { id, qty, preco, fonte, nNF, produto_nome } = body
      if (!id || qty == null) return json({ error: 'id e qty obrigatorios.' }, 400)

      const { data: ins } = await sb.from('alm_insumos').select('*').eq('id', id).maybeSingle()
      if (!ins) return json({ error: 'Insumo nao encontrado.' }, 404)

      const novoEstoque = (ins.estoque_qty || 0) + parseFloat(qty)
      const updateData: Record<string, any> = { estoque_qty: novoEstoque }

      // Atualiza preco se fornecido e diferente
      if (preco != null && preco > 0 && preco !== ins.preco) {
        // Salva historico de preco
        await sb.from('alm_insumo_historico').insert({
          insumo_id: id,
          preco_anterior: ins.preco,
          preco_novo: preco,
          unidade_compra_anterior: ins.unidade_compra,
          unidade_compra_nova: ins.unidade_compra,
          qtd_emb_anterior: ins.qtd_por_embalagem,
          qtd_emb_nova: ins.qtd_por_embalagem,
          produto_encontrado: produto_nome || `NF-e ${nNF || ''}`.trim(),
          fonte: fonte || 'NF-e',
          url: null,
          match_pct: 100,
        })
        updateData.preco = preco
        updateData.preco_referencia = preco
        updateData.referencia_nome = produto_nome || null
        updateData.referencia_fonte = fonte || 'NF-e'
        updateData.preco_atualizado_em = new Date().toISOString()
      }

      const { error } = await sb.from('alm_insumos').update(updateData).eq('id', id).eq('escola_id', (gerente as any).escola_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, estoque_anterior: ins.estoque_qty, estoque_novo: novoEstoque })
    }

    if (action === 'alm_series_list') {
      const { data } = await sb.from('series').select('*, professoras(id, nome, email)')
        .eq('ativo', true).eq('escola_id', gerente.escola_id).order('nome')
      return json({ data: data ?? [] })
    }

    if (action === 'alm_turma_save') {
      const { id, nome } = body
      if (!nome) return json({ error: 'Nome obrigatório.' }, 400)
      if (id) {
        const { error } = await sb.from('series').update({ nome }).eq('id', id).eq('escola_id', gerente.escola_id)
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true })
      } else {
        const { data: nova, error } = await sb.from('series').insert(
          { nome, ordem: 99, escola_id: gerente.escola_id }
        ).select('id').single()
        if (error) return json({ error: error.message }, 400)
        return json({ ok: true, id: nova.id })
      }
    }

    if (action === 'alm_turma_del') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('series').update({ ativo: false }).eq('id', id).eq('escola_id', gerente.escola_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'alm_orcamentos_list') {
      const mes = body.mes || new Date().toISOString().slice(0, 7)
      const { data: turmas } = await sb.from('series').select('id, nome').eq('ativo', true).eq('escola_id', gerente.escola_id).order('nome')
      const { data: orcs } = await sb.from('alm_orcamentos').select('turma_id, valor').eq('mes', mes).eq('escola_id', (gerente as any).escola_id)
      const map: Record<string, number> = {}
      for (const o of orcs ?? []) map[o.turma_id] = o.valor
      const result = (turmas ?? []).map((t: any) => ({ ...t, valor: map[t.id] ?? 0 }))
      return json({ data: result, mes })
    }

    if (action === 'alm_orcamento_set') {
      const { turma_id, mes, valor } = body
      if (!turma_id || !mes) return json({ error: 'turma_id e mes são obrigatórios.' }, 400)
      const { error } = await sb.from('alm_orcamentos').upsert(
        { turma_id, mes, valor: parseFloat(valor) || 0, escola_id: (gerente as any).escola_id },
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
        .eq('mes', mes).eq('escola_id', gerente.escola_id)
      const { data: orcs } = await sb.from('alm_orcamentos').select('turma_id, valor').eq('mes', mes).eq('escola_id', (gerente as any).escola_id)
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
      const { professora_id, turma_id, turma_ids } = body as any
      if (!professora_id) return json({ error: 'professora_id obrigatório.' }, 400)
      // Suporte multi-turma: turma_ids (array) ou turma_id (single, retrocompat)
      const ids: string[] = Array.isArray(turma_ids) ? turma_ids.filter(Boolean) : (turma_id ? [turma_id] : [])
      const serie_id = ids[0] || null
      const series_monitoras = ids.length > 0 ? ids : null
      const { error } = await sb.from('professoras')
        .update({ serie_id, series_monitoras }).eq('id', professora_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
  }

  // ━━ NOTIFICAÇÕES (qualquer portal) ━━━━━━━━━━━━━━━━━━━━━━━
  // Helper local: deriva { portal, email } da sessão ativa.
  // Aceita gerente, professora, secretaria (tokens legados/unificados) ou pai (Supabase Auth JWT).
  async function getNotifDestinatario(): Promise<{ portal: string; email: string } | null> {
    const ger = await getGerente(sb, token)
    if (ger) return { portal: 'gerente', email: ger.email }
    const prof = await getProfessora(sb, token)
    if (prof) return { portal: 'professora', email: prof.email }
    const sec = await getSecretaria(sb, token)
    if (sec) return { portal: 'secretaria', email: sec.email }
    const paiEmail = await getPaiEmail(sb, token, undefined)
    if (paiEmail) return { portal: 'pais', email: paiEmail }
    return null
  }

  if (action === 'notif_list') {
    const who = await getNotifDestinatario()
    if (!who) return json({ error: 'Sessão inválida.' }, 401)
    const { data } = await sb.from('notificacoes').select('*')
      .eq('portal', who.portal).eq('destinatario', who.email)
      .order('criado_em', { ascending: false }).limit(50)
    return json({ data: data ?? [] })
  }

  if (action === 'notif_marcar_lida') {
    const who = await getNotifDestinatario()
    if (!who) return json({ error: 'Sessão inválida.' }, 401)
    const { ids } = body
    if (!ids || !Array.isArray(ids)) return json({ error: 'ids obrigatório (array).' }, 400)
    // Restringe update às notificações do próprio destinatário
    await sb.from('notificacoes').update({ lida: true })
      .in('id', ids).eq('portal', who.portal).eq('destinatario', who.email)
    return json({ ok: true })
  }

  if (action === 'notif_marcar_todas') {
    const who = await getNotifDestinatario()
    if (!who) return json({ error: 'Sessão inválida.' }, 401)
    await sb.from('notificacoes').update({ lida: true }).eq('portal', who.portal).eq('destinatario', who.email).eq('lida', false)
    return json({ ok: true })
  }

  // ━━ IMPRESSOES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (action === 'impressao_enviar') {
    const token = (body._token as string) || (body._prof_token as string)
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessao invalida.' }, 401)
    // Resolve escola_id: prof.escola_id > professoras table > Origin
    let escolaId = (prof as any).escola_id as string | null
    if (!escolaId) {
      // Fallback: buscar escola_id direto da tabela professoras (pode ter sido adicionado depois da sessão)
      const { data: profFresh } = await sb.from('professoras').select('escola_id').eq('id', prof.id).maybeSingle()
      escolaId = profFresh?.escola_id ?? null
    }
    if (!escolaId) {
      // Fallback: resolver via Origin do request
      escolaId = await resolveEscolaId(req, sb, null, body)
    }
    if (!escolaId) return json({ error: 'Não foi possível identificar a escola. Faça login novamente.' }, 400)
    const { copias, tipo_papel, para_dia, observacao, base64, mime, arquivo_nome } = body as any
    if (!base64) return json({ error: 'Arquivo obrigatório (selecione um PDF ou imagem).' }, 400)
    const nCopiasIn = parseInt(copias)
    if (!nCopiasIn || nCopiasIn < 1) return json({ error: 'Informe a quantidade de cópias.' }, 400)
    if (nCopiasIn > 500) return json({ error: 'Quantidade de cópias acima do limite permitido (500).' }, 400)
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    if (mime && !allowedMimes.includes(mime)) return json({ error: 'Tipo de arquivo não permitido. Envie PDF, JPEG, PNG ou WebP.' }, 400)
    // Upload arquivo
    const ext = (mime || 'application/pdf').includes('pdf') ? 'pdf' : (mime || '').includes('png') ? 'png' : 'jpg'
    const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`
    const buf = Uint8Array.from(atob(base64 as string), c => c.charCodeAt(0))
    // Limite 30MB (mesmo do client-side)
    if (buf.length > 30 * 1024 * 1024) {
      return json({ error: `Arquivo muito grande (${(buf.length / 1024 / 1024).toFixed(1)} MB). Máximo permitido: 30 MB.` }, 400)
    }
    // Hash SHA-256 para deduplicação
    const hashBuf = await crypto.subtle.digest('SHA-256', buf)
    const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
    // Detecta duplicidade nos últimos 7d (mesma escola)
    const { data: dup } = await sb.from('impressoes')
      .select('id, criado_em, professora_nome, copias').eq('escola_id', escolaId)
      .eq('arquivo_hash', hashHex).gte('criado_em', new Date(Date.now() - 7 * 86400000).toISOString())
      .order('criado_em', { ascending: false }).limit(1).maybeSingle()
    const duplicadoAviso = dup ? `Atenção: arquivo idêntico já enviado em ${new Date((dup as any).criado_em).toLocaleString('pt-BR')} por ${(dup as any).professora_nome || '?'} (${(dup as any).copias} cópias). Continuamos com este novo pedido.` : null
    const { error: errUp } = await sb.storage.from('impressoes').upload(path, buf, { contentType: mime || 'application/pdf' })
    if (errUp) return json({ error: 'Falha no upload: ' + errUp.message }, 400)
    // Bucket privado (mig 281): signed URL com TTL = 7d (mesma retenção da mig 270)
    const { data: signed } = await sb.storage.from('impressoes').createSignedUrl(path, 60 * 60 * 24 * 7)
    const arquivoUrl = signed?.signedUrl || ''
    // Contar páginas do PDF
    let numPaginas = 1
    if (ext === 'pdf') {
      try {
        const text = new TextDecoder('latin1').decode(buf)
        // Método 1: contar /Type /Page (exclui /Type /Pages que é o catálogo)
        const pageMatches = text.match(/\/Type\s*\/Page[^s]/g)
        if (pageMatches && pageMatches.length > 0) {
          numPaginas = pageMatches.length
        } else {
          // Método 2: buscar /Count N no catálogo de páginas
          const countMatch = text.match(/\/Count\s+(\d+)/)
          if (countMatch) numPaginas = parseInt(countMatch[1]) || 1
        }
      } catch { numPaginas = 1 }
    }
    const nCopias = nCopiasIn
    const totalFolhas = nCopias * numPaginas
    // Buscar turma da professora
    const { data: profData } = await sb.from('professoras').select('serie_id, series(id, nome)').eq('id', prof.id).maybeSingle()
    const turma = (profData as any)?.series ?? null
    // Verificar limite mensal (baseado em folhas: copias × paginas)
    // Modo lançamento: escola_config.impressao_lancamento=true → sem limite (default true ao adotar)
    const mes = new Date().toISOString().slice(0, 7)
    const { data: cfgL } = await sb.from('escola_config').select('valor')
      .eq('escola_id', escolaId).eq('chave', 'impressao_lancamento').maybeSingle()
    const modoLancamento = cfgL ? Boolean((cfgL as any).valor) : true
    const { data: orc } = await sb.from('impressoes_orcamento').select('limite').eq('turma_id', turma?.id || '').eq('mes', mes).maybeSingle()
    const limite = orc?.limite ?? 50
    const { data: usadas } = await sb.from('impressoes').select('copias, num_paginas')
      .eq('turma_id', turma?.id || '').gte('criado_em', mes + '-01').in('status', ['pendente', 'aprovado', 'impresso', 'entregue'])
    const totalUsado = (usadas ?? []).reduce((s: number, r: any) => s + ((r.copias || 0) * (r.num_paginas || 1)), 0)
    if (!modoLancamento && totalUsado + totalFolhas > limite) {
      return json({ error: `Limite mensal de ${limite} folhas excedido. Já utilizado: ${totalUsado}. Disponível: ${limite - totalUsado}. Este arquivo: ${numPaginas} pag × ${nCopias} cópias = ${totalFolhas} folhas.` }, 400)
    }
    const { error } = await sb.from('impressoes').insert({
      escola_id: escolaId,
      professora_id: prof.id, professora_nome: prof.nome,
      turma_id: turma?.id || null, turma_nome: turma?.nome || null,
      arquivo_url: arquivoUrl, arquivo_path: path, arquivo_nome: arquivo_nome || path,
      arquivo_hash: hashHex, arquivo_tamanho: buf.length,
      expira_em: new Date(Date.now() + 7 * 86400000).toISOString(),
      copias: nCopias, num_paginas: numPaginas, tipo_papel: tipo_papel || 'sulfite',
      para_dia: para_dia || null, observacao: observacao || null,
    })
    if (error) return json({ error: error.message }, 400)
    // Backfill escola_id na professora se estava null
    if (!(prof as any).escola_id) {
      await sb.from('professoras').update({ escola_id: escolaId }).eq('id', prof.id).is('escola_id', null)
    }
    // Notifica gerentes
    const { data: gerentes } = await sb.from('gerentes').select('email').eq('escola_id', escolaId)
    for (const g of gerentes ?? []) {
      await criarNotif(sb, 'gerente', g.email, 'Nova impressao', `${prof.nome} solicitou ${nCopias} copias × ${numPaginas} pag = ${totalFolhas} folhas (${tipo_papel}).`, 'info', escolaId)
    }
    return json({ ok: true, usado: totalUsado + totalFolhas, limite, num_paginas: numPaginas, modo_lancamento: modoLancamento, duplicado: !!dup, aviso: duplicadoAviso })
  }

  if (action === 'impressao_minhas') {
    const token = (body._token as string) || (body._prof_token as string)
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessao invalida.' }, 401)
    const { data } = await sb.from('impressoes').select('*')
      .eq('professora_id', prof.id).order('criado_em', { ascending: false }).limit(30)
    // Bucket privado (mig 281): regenera signed URL TTL 1h em cada listagem
    const refreshed = await Promise.all((data ?? []).map(async (r: any) => {
      if (r.arquivo_path) {
        const { data: signed } = await sb.storage.from('impressoes').createSignedUrl(r.arquivo_path, 3600)
        if (signed?.signedUrl) r.arquivo_url = signed.signedUrl
      }
      return r
    }))
    // Buscar uso mensal
    const mes = new Date().toISOString().slice(0, 7)
    const { data: profData } = await sb.from('professoras').select('serie_id').eq('id', prof.id).maybeSingle()
    const turmaId = (profData as any)?.serie_id
    const { data: orc } = await sb.from('impressoes_orcamento').select('limite').eq('turma_id', turmaId || '').eq('mes', mes).maybeSingle()
    const limite = orc?.limite ?? 50
    const { data: usadas } = await sb.from('impressoes').select('copias, num_paginas')
      .eq('turma_id', turmaId || '').gte('criado_em', mes + '-01').in('status', ['pendente', 'aprovado', 'impresso', 'entregue'])
    const totalUsado = (usadas ?? []).reduce((s: number, r: any) => s + ((r.copias || 0) * (r.num_paginas || 1)), 0)
    return json({ data: refreshed, usado: totalUsado, limite })
  }

  // ━━ ALTERAR SENHA PROFESSORA ━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (action === 'prof_alterar_senha') {
    const token = (body._token as string) || (body._prof_token as string)
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessão inválida.' }, 401)
    const { senha_atual, nova_senha } = body as any
    if (!senha_atual || !nova_senha) return json({ error: 'Preencha todos os campos.' }, 400)
    if ((nova_senha as string).length < 6) return json({ error: 'Senha mínima de 6 caracteres.' }, 400)
    // Busca hash atual
    const { data: profData } = await sb.from('professoras').select('senha_hash').eq('id', prof.id).maybeSingle()
    if (!profData?.senha_hash) return json({ error: 'Conta sem senha definida.' }, 400)
    if (!await verificarSenha(senha_atual, profData.senha_hash)) return json({ error: 'Senha atual incorreta.' }, 401)
    const novoHash = await hashSenha(nova_senha)
    await sb.from('professoras').update({ senha_hash: novoHash }).eq('id', prof.id)
    // Atualiza também na tabela usuarios (se existir)
    await sb.from('usuarios').update({ senha_hash: novoHash }).eq('email', prof.email)
    return json({ ok: true })
  }

  // ━━ DASHBOARDS PROFESSORA (read-only) ━━━━━━━━━━━━━━━━━
  if (action === 'prof_turnos_dashboard') {
    const token = (body._token as string) || (body._prof_token as string)
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessao invalida.' }, 401)
    const { data: sols, error: solErr } = await sb.from('solicitacoes').select('*').eq('escola_id', (prof as any).escola_id).order('criado_em', { ascending: false }).limit(500)
    if (solErr) return json({ error: solErr.message }, 400)
    const TURNO_GROUPS: Record<string, string> = { 'Integral (7h-19h)':'integral','Semi-Integral (7h-13h30)':'semi','Semi-Integral (13h-19h)':'semi','Tarde (13h-17h)':'tarde','Diária (por dia)':'diaria' }
    const counts: Record<string, number> = { integral: 0, semi: 0, tarde: 0, diaria: 0 }
    const rows = (sols ?? []).map((s: any) => ({
      id: s.id, nome_crianca: s.nome_crianca || '', nome_resp: s.nome_resp || s.nome || '',
      email: s.email || '', serie: s.serie || '', turno: s.turno || '',
      dias_semana: s.dias_semana || [], status: s.status || '', criado_em: s.criado_em
    }))
    for (const s of rows) { const g = TURNO_GROUPS[s.turno]; if (g) counts[g]++; }
    return json({ data: rows, counts, total: rows.length })
  }

  if (action === 'prof_atividades_dashboard') {
    const token = (body._token as string) || (body._prof_token as string)
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessao invalida.' }, 401)
    const { data: ativs } = await sb.from('atividades').select('*').eq('ativo', true).eq('escola_id', (prof as any).escola_id).order('ordem')
    const { data: inscs } = await sb.from('inscricoes_atividades').select('*').eq('escola_id', (prof as any).escola_id).order('criado_em', { ascending: false }).limit(500)
    const atividades = (ativs ?? []).map((a: any) => {
      const horarios = (a.horarios || []).map((h: any) => ({
        turma: h.turma || h.dia || '', dia: h.dia || '', hora: h.hora || '', inicio: h.inicio || '', fim: h.fim || '',
        vagas: h.vagas ?? null, inscritos: h.inscritos || 0, vagas_disponiveis: h.vagas != null ? Math.max(0, (h.vagas || 0) - (h.inscritos || 0)) : null
      }))
      const totalVagas = horarios.reduce((s: number, h: any) => s + (h.vagas || 0), 0)
      const totalInscritos = horarios.reduce((s: number, h: any) => s + (h.inscritos || 0), 0)
      return { id: a.id, nome: a.nome, cor: a.cor, preco: a.preco || 0, totalVagas, totalInscritos, horarios, ativo: a.ativo }
    })
    return json({ atividades, inscricoes: inscs ?? [] })
  }

  // ━━ CALENDARIO PUBLICO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (action === 'calendario_publico') {
    const mes = (body.mes as string) || new Date().toISOString().slice(0, 7)
    const [y, m] = mes.split('-')
    const inicio = `${y}-${m}-01`
    const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate()
    const fim = `${y}-${m}-${lastDay}`
    const portal = (body.portal as string) || 'pais'
    let query = sb.from('calendario_eventos').select('id, titulo, descricao, data_inicio, data_fim, tipo, cor')
      .gte('data_inicio', inicio).lte('data_inicio', fim).order('data_inicio')
    if (portal === 'pais') query = query.eq('visivel_pais', true)
    else query = query.eq('visivel_professoras', true)
    const { data } = await query
    return json({ data: data ?? [] })
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
      const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
      if (!allowedMimes.includes(body.mime as string)) return json({ error: 'Tipo de arquivo não permitido. Envie PDF, JPEG, PNG ou WebP.' }, 400)
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
      escola_id: (prof as any).escola_id,
    })
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  if (action === 'achados_lista_equipe') {
    // Equipe vê todos os itens (internos + públicos, exceto devolvidos antigos)
    const escolaIdEquipe = await resolveEscolaId(req, sb, null, body)
    const { data } = await sb.from('achados_perdidos').select('*')
      .eq('escola_id', escolaIdEquipe)
      .neq('status', 'devolvido')
      .order('criado_em', { ascending: false })
    return json({ data: data ?? [] })
  }

  if (action === 'achados_lista_publica') {
    // Pais veem apenas itens públicos (status = publico OU publicar_em já passou)
    const escolaIdPub = await resolveEscolaId(req, sb, null, body)
    const agora = new Date().toISOString()
    const { data } = await sb.from('achados_perdidos').select('id, descricao, local_encontrado, foto_url, criado_em, status, publicar_em')
      .eq('escola_id', escolaIdPub)
      .or(`status.eq.publico,publicar_em.lte.${agora}`)
      .neq('status', 'devolvido')
      .order('criado_em', { ascending: false })
    return json({ data: data ?? [] })
  }

  if (action === 'achados_publicar') {
    // Gerente ou professora autoriza publicação imediata (escreve dado sensível)
    const ger = await getGerente(sb, token)
    const prof = !ger ? await getProfessora(sb, token) : null
    if (!ger && !prof) return json({ error: 'Sessão inválida.' }, 401)
    const { id } = body as { id: string }
    if (!id) return json({ error: 'ID obrigatório.' }, 400)
    const escolaIdAchado = (ger as any)?.escola_id || (prof as any)?.escola_id
    await sb.from('achados_perdidos').update({ status: 'publico', publicar_em: new Date().toISOString() }).eq('id', id).eq('escola_id', escolaIdAchado)
    return json({ ok: true })
  }

  if (action === 'achados_devolver') {
    // Marca como devolvido (professora ou gerente)
    const devToken = (body._token as string) || (body._prof_token as string)
    const prof = await getProfessora(sb, devToken)
    const ger = !prof ? await getGerente(sb, devToken) : null
    if (!prof && !ger) return json({ error: 'Sessão inválida.' }, 401)
    const { id, devolvido_para } = body as { id: string; devolvido_para: string }
    if (!id) return json({ error: 'ID obrigatório.' }, 400)
    const quem = prof?.nome || ger?.nome || 'Equipe'
    const escolaIdDev = (prof as any)?.escola_id || (ger as any)?.escola_id
    await sb.from('achados_perdidos').update({
      status: 'devolvido', devolvido_para: devolvido_para || null, devolvido_em: new Date().toISOString(),
    }).eq('id', id).eq('escola_id', escolaIdDev)
    return json({ ok: true })
  }

  if (action === 'achados_excluir') {
    // Apenas gerente pode excluir definitivamente
    const ger = await getGerente(sb, token)
    if (!ger) return json({ error: 'Sessão inválida.' }, 401)
    const { id } = body as { id: string }
    if (!id) return json({ error: 'ID obrigatório.' }, 400)
    await sb.from('achados_perdidos').delete().eq('id', id).eq('escola_id', (ger as any).escola_id)
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
      const { data: p } = await sb.from('professoras').select('id').eq('email', email).maybeSingle()
      if (p) usuario_id = p.id
    } else if (portal === 'secretaria') {
      const { data: s } = await sb.from('secretarias').select('id').eq('email', email).maybeSingle()
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
      // IMPORTANTE: professora_sessoes e secretaria_sessoes não têm defaults
      // para `token` e `expira_em`. Se não forem fornecidos, INSERT viola
      // NOT NULL, `.single()` retorna data=null, `sess!.token` vira undefined,
      // e o frontend salva "undefined" como token → loop de login.
      const tkn = randomToken()
      const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      if (cred.usuario_tipo === 'professora') {
        const { data: p } = await sb.from('professoras').select('nome, email').eq('id', cred.usuario_id).maybeSingle()
        if (!p) return json({ error: 'Professora não encontrada.', code: 'NOT_FOUND' }, 404)
        const { error: sErr } = await sb.from('professora_sessoes').insert({ professora_id: cred.usuario_id, token: tkn, expira_em: exp })
        if (sErr) {
          console.error('[auth] webauthn professora AUTH_SESSION_FAILED', { user: cred.usuario_id, err: sErr })
          return json({ error: 'Não foi possível criar a sessão.', code: 'AUTH_SESSION_FAILED' }, 500)
        }
        token = tkn; nome = p.nome; email = p.email
      } else if (cred.usuario_tipo === 'secretaria') {
        const { data: s } = await sb.from('secretarias').select('nome, email').eq('id', cred.usuario_id).maybeSingle()
        if (!s) return json({ error: 'Secretária não encontrada.', code: 'NOT_FOUND' }, 404)
        const { error: sErr } = await sb.from('secretaria_sessoes').insert({ secretaria_id: cred.usuario_id, token: tkn, expira_em: exp })
        if (sErr) {
          console.error('[auth] webauthn secretaria AUTH_SESSION_FAILED', { user: cred.usuario_id, err: sErr })
          return json({ error: 'Não foi possível criar a sessão.', code: 'AUTH_SESSION_FAILED' }, 500)
        }
        token = tkn; nome = s.nome; email = s.email
      }
      return json({ token, nome, email })
    } catch (e) { return json({ error: 'Verificação falhou: ' + (e as Error).message }, 400) }
  }

  // ═══════════════════════════════════════════════════════════
  //  PESQUISAS / ENQUETES / AUTORIZAÇÕES
  // ═══════════════════════════════════════════════════════════

  if (action === 'pesquisa_list') {
    const { ativo } = body as any
    let q = sb.from('pesquisas').select('*, pesquisa_perguntas(count)').order('criado_em', { ascending: false })
    if (ativo !== undefined) q = q.eq('ativo', ativo)
    const { data } = await q
    return json(data ?? [])
  }

  if (action === 'pesquisa_create') {
    const ger = await getGerente(sb, token)
    if (!ger) return json({ error: 'Sessão inválida.' }, 401)
    const { titulo, descricao, tipo, publico_alvo, data_limite } = body as any
    if (!titulo) return json({ error: 'Título obrigatório' }, 400)
    const { data, error } = await sb.from('pesquisas').insert({
      titulo, descricao, tipo: tipo || 'enquete', publico_alvo: publico_alvo || 'todos',
      data_limite: data_limite || null, criado_por: ger.nome || 'gerente'
    }).select().single()
    if (error) return json({ error: error.message }, 400)
    return json(data)
  }

  if (action === 'pesquisa_update') {
    const ger = await getGerente(sb, token)
    if (!ger) return json({ error: 'Sessão inválida.' }, 401)
    const b = body as any
    const { id } = b
    if (!id) return json({ error: 'ID obrigatório' }, 400)
    const ALLOWED = ['titulo', 'descricao', 'tipo', 'publico_alvo', 'data_limite', 'data_inicio', 'data_fim', 'ativo', 'ativa']
    const update: Record<string, unknown> = {}
    for (const k of ALLOWED) if (k in b) update[k] = b[k]
    const { error } = await sb.from('pesquisas').update(update).eq('id', id)
    if (error) return json({ error: error.message }, 400)
    return json({ success: true })
  }

  if (action === 'pesquisa_delete') {
    const ger = await getGerente(sb, token)
    if (!ger) return json({ error: 'Sessão inválida.' }, 401)
    const { id } = body as any
    if (!id) return json({ error: 'ID obrigatório' }, 400)
    const { error } = await sb.from('pesquisas').delete().eq('id', id)
    if (error) return json({ error: error.message }, 400)
    return json({ success: true })
  }

  if (action === 'pesquisa_perguntas_list') {
    const { pesquisa_id } = body as any
    if (!pesquisa_id) return json({ error: 'pesquisa_id obrigatório' }, 400)
    const { data } = await sb.from('pesquisa_perguntas').select('*').eq('pesquisa_id', pesquisa_id).order('ordem')
    return json(data ?? [])
  }

  if (action === 'pesquisa_perguntas_upsert') {
    const ger = await getGerente(sb, token)
    if (!ger) return json({ error: 'Sessão inválida.' }, 401)
    const { pesquisa_id, perguntas } = body as any
    if (!pesquisa_id || !Array.isArray(perguntas)) return json({ error: 'pesquisa_id e perguntas[] obrigatórios' }, 400)
    // Delete existing and re-insert
    await sb.from('pesquisa_perguntas').delete().eq('pesquisa_id', pesquisa_id).eq('escola_id', (ger as any).escola_id)
    if (perguntas.length > 0) {
      const rows = perguntas.map((p: any, i: number) => ({
        pesquisa_id, texto: p.texto, tipo: p.tipo || 'texto',
        opcoes: p.opcoes || [], obrigatoria: p.obrigatoria !== false, ordem: i
      }))
      const { error } = await sb.from('pesquisa_perguntas').insert(rows)
      if (error) return json({ error: error.message }, 400)
    }
    return json({ success: true })
  }

  if (action === 'pesquisa_responder') {
    // Pai/responsável autenticado via Supabase Auth JWT
    const paiEmail = await getPaiEmail(sb, token, undefined)
    if (!paiEmail) return json({ error: 'Sessão inválida.' }, 401)
    const { pesquisa_id, respostas } = body as any
    if (!pesquisa_id || !Array.isArray(respostas)) return json({ error: 'pesquisa_id e respostas[] obrigatórios' }, 400)
    const pesqRespostaEscolaId = await resolveEscolaId(req, sb, null, body)
    const rows = respostas.map((r: any) => ({
      pesquisa_id, pergunta_id: r.pergunta_id, respondido_por: paiEmail, valor: r.valor || '', escola_id: pesqRespostaEscolaId,
    }))
    const { error } = await sb.from('pesquisa_respostas').upsert(rows, { onConflict: 'pergunta_id,respondido_por' })
    if (error) return json({ error: error.message }, 400)
    return json({ success: true })
  }

  if (action === 'pesquisa_resultados') {
    const ger = await getGerente(sb, token)
    if (!ger) return json({ error: 'Sessão inválida.' }, 401)
    const { pesquisa_id } = body as any
    if (!pesquisa_id) return json({ error: 'pesquisa_id obrigatório' }, 400)
    const { data: perguntas } = await sb.from('pesquisa_perguntas').select('*').eq('pesquisa_id', pesquisa_id).order('ordem')
    const { data: respostas } = await sb.from('pesquisa_respostas').select('*').eq('pesquisa_id', pesquisa_id)
    // Count unique respondents
    const respondentes = new Set((respostas || []).map((r: any) => r.respondido_por))
    return json({ perguntas: perguntas ?? [], respostas: respostas ?? [], total_respondentes: respondentes.size })
  }

  if (action === 'autorizacao_assinar') {
    // Pai/responsável via Supabase Auth — email vem do JWT, NÃO do body
    const paiEmail = await getPaiEmail(sb, token, undefined)
    if (!paiEmail) return json({ error: 'Sessão inválida.' }, 401)
    const { pesquisa_id, aluno_nome, autorizado } = body as any
    if (!pesquisa_id) return json({ error: 'pesquisa_id obrigatório' }, 400)
    const autorizEscolaId = await resolveEscolaId(req, sb, null, body)
    const { error } = await sb.from('autorizacoes').upsert({
      pesquisa_id, familia_email: paiEmail, aluno_nome: aluno_nome || null,
      autorizado: autorizado !== false, assinatura_data: new Date().toISOString(),
      escola_id: autorizEscolaId,
    }, { onConflict: 'pesquisa_id,familia_email' })
    if (error) return json({ error: error.message }, 400)
    return json({ success: true })
  }

  if (action === 'autorizacao_list') {
    const ger = await getGerente(sb, token)
    if (!ger) return json({ error: 'Sessão inválida.' }, 401)
    const { pesquisa_id } = body as any
    if (!pesquisa_id) return json({ error: 'pesquisa_id obrigatório' }, 400)
    const { data } = await sb.from('autorizacoes').select('*').eq('pesquisa_id', pesquisa_id).order('assinatura_data', { ascending: false })
    return json(data ?? [])
  }

  // ── Módulos habilitados (feature gating) ──
  if (action === 'modulos_habilitados') {
    try {
      const escolaId = await resolveEscolaId(req, sb, null, body)
      if (!escolaId) return json({ modulos: [] })
      const modulos = await getModulosHabilitados(sb, escolaId)
      return json({ modulos: [...modulos] })
    } catch { return json({ modulos: [] }) }
  }

  // ── Módulos: gestão pelo gerente ──
  if (action === 'escola_modulos_get_all') {
    const gerente = await getGerente(sb, token)
    if (!gerente) return json({ error: 'Acesso restrito a gerentes.' }, 403)
    const escolaId = (gerente as any).escola_id || await resolveEscolaId(req, sb, null, body)
    if (!escolaId) return json({ error: 'Escola não encontrada.' }, 404)
    const resolvidos = await getModulosResolvidos(sb, escolaId)
    return json(resolvidos)
  }

  if (action === 'escola_modulos_set') {
    const gerente = await getGerente(sb, token)
    if (!gerente) return json({ error: 'Acesso restrito a gerentes.' }, 403)
    const { modulos: moduloToggles } = body as { modulos: Record<string, boolean> }
    if (!moduloToggles) return json({ error: 'modulos obrigatório.' }, 400)
    const escolaId = (gerente as any).escola_id || await resolveEscolaId(req, sb, null, body)
    if (!escolaId) return json({ error: 'Escola não encontrada.' }, 404)
    const slugs = Object.keys(moduloToggles)
    const { data: modulosDb } = await sb.from('modulos').select('id, slug').in('slug', slugs)
    if (!modulosDb) return json({ error: 'Nenhum módulo encontrado.' }, 404)
    const { data: escola } = await sb.from('escolas').select('plano_id').eq('id', escolaId).single()
    let planoSlugs = new Set<string>()
    if (escola?.plano_id) {
      const { data: pm } = await sb.from('plano_modulos').select('modulos(slug)').eq('plano_id', escola.plano_id)
      planoSlugs = new Set((pm || []).map((r: any) => r.modulos?.slug).filter(Boolean))
    }
    const moduloIds = modulosDb.map((m: any) => m.id)
    await sb.from('escola_modulos').delete().eq('escola_id', escolaId).in('modulo_id', moduloIds)
    const inserts: Array<{ escola_id: string; modulo_id: string; habilitado: boolean }> = []
    for (const m of modulosDb) {
      if (moduloToggles[m.slug] !== planoSlugs.has(m.slug)) {
        inserts.push({ escola_id: escolaId, modulo_id: m.id, habilitado: moduloToggles[m.slug] })
      }
    }
    if (inserts.length > 0) {
      const { error } = await sb.from('escola_modulos').insert(inserts)
      if (error) return json({ error: error.message }, 400)
    }
    return json({ success: true, overrides: inserts.length })
  }

  // ━━ CLEANUP IMPRESSÕES (pg_cron) ━━━━━━━━━━━━━━━━━━━━━━━━
  if (action === 'impressoes_cleanup') {
    const cronKey = Deno.env.get("CRON_INTERNAL_KEY") || ""
    const authH = req.headers.get("Authorization")?.replace("Bearer ", "") || ""
    if (!cronKey || authH !== cronKey) return json({ error: "Unauthorized" }, 401)

    // Buscar impressões entregues há mais de 15 dias ou rejeitadas há mais de 15 dias
    const { data: rows } = await sb.from('impressoes')
      .select('id, arquivo_url, status')
      .or('and(status.eq.entregue,entregue_em.lt.' + new Date(Date.now() - 15 * 86400000).toISOString() + '),and(status.eq.rejeitado,criado_em.lt.' + new Date(Date.now() - 15 * 86400000).toISOString() + ')')

    if (!rows || rows.length === 0) return json({ cleaned: 0 })

    // Extrair paths do storage a partir das URLs
    const paths = rows
      .map(r => r.arquivo_url?.split('/impressoes/')[1])
      .filter(Boolean) as string[]

    // Deletar arquivos do storage em batches de 100
    let deletedFiles = 0
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100)
      const { data: removed } = await sb.storage.from('impressoes').remove(batch)
      deletedFiles += removed?.length || 0
    }

    // Deletar registros do banco
    const ids = rows.map(r => r.id)
    const { error } = await sb.from('impressoes').delete().in('id', ids)

    console.log(`[impressoes_cleanup] Cleaned ${deletedFiles} files, ${ids.length} rows. Error: ${error?.message || 'none'}`)
    return json({ cleaned: ids.length, files: deletedFiles })
  }

  if (action === 'escola_modulos_reset') {
    const gerente = await getGerente(sb, token)
    if (!gerente) return json({ error: 'Acesso restrito a gerentes.' }, 403)
    const escolaId = (gerente as any).escola_id || await resolveEscolaId(req, sb, null, body)
    if (!escolaId) return json({ error: 'Escola não encontrada.' }, 404)
    await sb.from('escola_modulos').delete().eq('escola_id', escolaId)
    return json({ success: true })
  }

  return json({ error: 'Ação desconhecida' }, 400)

  } catch (e) {
    console.error('[diplomas] Unhandled error:', (e as Error).message, (e as Error).stack)
    return json({ error: 'Erro interno do servidor. Tente novamente.', code: 'INTERNAL_ERROR' }, 500)
  }
})
