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

  return null
}
