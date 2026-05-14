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
  // ━━ TEACHER ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const isTeacherAction = [
    'professora_logout', 'diploma_submit', 'meus_diplomas',
    'atestado_submit', 'meus_atestados',
    'minhas_impressoes',
    'pdi_meu_status', 'pdi_autoavaliacao', 'pdi_autoavaliacao_rascunho',
    'pdi_metas_submit', 'pdi_metas_rascunho',
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

    // Autosave da autoavaliação — aceita competências parciais. Não exige todas as 7
    // áreas nem nota mínima. Não muda status; só persiste o que tiver. Idempotente.
    if (action === 'pdi_autoavaliacao_rascunho') {
      const competencias: Array<{ area: string; nota_auto?: number; comentario?: string }> =
        body.competencias || []
      const AREAS = [
        'linguagem', 'metodologia', 'avaliacao',
        'intercultural', 'colaboracao', 'inovacao', 'desenvolvimento',
      ]
      const validas = competencias.filter(c =>
        AREAS.includes(c.area) &&
        ((c.nota_auto !== undefined && c.nota_auto !== null) || (c.comentario && c.comentario.trim()))
      )
      const { data: ciclo } = await sb
        .from('pdi_ciclos').select('id').eq('ativo', true).maybeSingle()
      if (!ciclo) return json({ error: 'Não há ciclo de PDI ativo no momento.' }, 400)

      let pdiId: string
      const { data: pdiExist } = await sb
        .from('pdis').select('id, status').eq('professora_id', prof.id).eq('ciclo_id', ciclo.id).maybeSingle()
      if (pdiExist) {
        if (['em_andamento', 'encerrado'].includes(pdiExist.status))
          return json({ error: 'PDI já aprovado. Contate a gestora para alterações.' }, 400)
        pdiId = pdiExist.id
      } else {
        if (!validas.length) return json({ ok: true, pdi_id: null, salvas: 0 })
        const { data: novo, error: errCria } = await sb
          .from('pdis').insert({ professora_id: prof.id, ciclo_id: ciclo.id, status: 'rascunho', escola_id: (prof as any).escola_id })
          .select('id').single()
        if (errCria) return json({ error: errCria.message }, 400)
        pdiId = novo.id
      }

      for (const c of validas) {
        const nota = c.nota_auto && c.nota_auto >= 1 && c.nota_auto <= 4 ? c.nota_auto : null
        await sb.from('pdi_competencias').upsert(
          { pdi_id: pdiId, area: c.area, nota_auto: nota, comentario: c.comentario ?? null, escola_id: (prof as any).escola_id },
          { onConflict: 'pdi_id,area' }
        )
      }
      return json({ ok: true, pdi_id: pdiId, salvas: validas.length })
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

    // Autosave de metas — aceita metas parciais (campos vazios), não muda status do PDI.
    // Sobrescreve o conjunto de metas em rascunho a cada chamada (delete + insert).
    if (action === 'pdi_metas_rascunho') {
      const { pdi_id } = body
      const metas: Array<{ descricao?: string; indicador?: string; prazo?: string; area_vinculada?: string }> =
        body.metas || []
      if (!pdi_id) return json({ error: 'pdi_id obrigatório.' }, 400)
      if (metas.length > 5) return json({ error: 'Máximo 5 metas.' }, 400)

      const { data: pdi } = await sb
        .from('pdis').select('id, status').eq('id', pdi_id).eq('professora_id', prof.id).maybeSingle()
      if (!pdi) return json({ error: 'PDI não encontrado.' }, 404)
      if (['em_andamento', 'encerrado'].includes(pdi.status))
        return json({ error: 'PDI já aprovado. Contate a gestora para alterações.' }, 400)

      const naoVazias = metas.filter(m =>
        (m.descricao && m.descricao.trim()) ||
        (m.indicador && m.indicador.trim()) ||
        (m.prazo && m.prazo.trim()) ||
        (m.area_vinculada && m.area_vinculada.trim())
      )

      await sb.from('pdi_metas').delete().eq('pdi_id', pdi_id).eq('escola_id', (prof as any).escola_id)
      if (naoVazias.length) {
        const { error } = await sb.from('pdi_metas').insert(
          naoVazias.map(m => ({
            pdi_id,
            descricao: m.descricao ?? '',
            indicador: m.indicador ?? '',
            prazo: m.prazo || null,
            area_vinculada: m.area_vinculada ?? null,
            status: 'pendente',
            progressao_pct: 0,
            escola_id: (prof as any).escola_id,
          }))
        )
        if (error) return json({ error: error.message }, 400)
      }
      return json({ ok: true, salvas: naoVazias.length })
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

  return null
}
