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

  return null
}
