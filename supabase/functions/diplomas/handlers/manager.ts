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

  return null
}
