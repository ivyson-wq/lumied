// Auto-extraído do diplomas/index.ts (Onda 3 do refator).
// Bloco preservado verbatim — vars `sb`/`body`/`action`/`token`/`req`/`clientIp`/`cors`
// vêm do ctx desestruturado abaixo. Returns Response quando uma action interna
// matcha; null pra fall-through pro próximo handler em index.ts.
import {
  generateChallenge, verifyRegistration, verifyAuthentication, b64urlEncode,
  getModulosHabilitados, getModulosResolvidos, getEscolaPadrao,
  resolveEscolaId,
  checkRateLimit, getClientIP,
  sanitizeBody,
  hashSenha, verificarSenhaAuto as verificarSenha, gerarToken as randomToken,
  uploadArquivo, getSignedFileUrl,
  logAudit,
  generatePdf, pdfResponse, generateXlsx, xlsxResponse,
  b64urlDecode,
} from '../../_shared/mod.ts'
import {
  type Any, type HandlerCtx,
  json as _libJson, criarNotif, verificarHorarioAcesso,
  getProfessora, getGerente, getSecretaria, getAlmoxarifado, getUsuario,
  getPaiEmail, calcEtaGoogleMaps, calcEtaLocal, getMLToken,
  ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI,
  log,
} from '../_lib.ts'

export async function handle(ctx: HandlerCtx): Promise<Response | null> {
  const { sb, body, action, token, req, clientIp, cors: CORS } = ctx
  const json = (data: unknown, status = 200) => _libJson(data, status, CORS)
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


  return null
}
