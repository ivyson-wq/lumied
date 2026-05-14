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
  // ━━ ALMOXARIFADO: TEACHER ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━

  // Allowlist de actions que entram no bloco da professora.
  // ATENÇÃO: ao adicionar um novo handler `if (action === 'alm_xxx')` dentro do
  // bloco `if (isAlmProfAction)` abaixo, INCLUA o nome aqui também — caso contrário
  // o bloco é pulado e a request cai no fallback "Ação desconhecida".
  const isAlmProfAction = [
    'alm_catalogo', 'alm_minha_turma', 'alm_minhas_reqs',
    'alm_criar_req', 'alm_editar_req', 'alm_cancelar_req',
    'alm_rascunho_get', 'alm_rascunho_salvar', 'alm_rascunho_descartar',
    'alm_historico_turma',
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

  return null
}
