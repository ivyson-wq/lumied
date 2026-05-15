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
import { refreshSignedUrls } from '../../_shared/signed-url-cache.ts'
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
    // Notifica gerentes (bulk insert pra evitar N+1)
    const { data: gerentes } = await sb.from('gerentes').select('email').eq('escola_id', escolaId)
    if (gerentes?.length) {
      const titulo = 'Nova impressao'
      const mensagem = `${prof.nome} solicitou ${nCopias} copias × ${numPaginas} pag = ${totalFolhas} folhas (${tipo_papel}).`
      await sb.from('notificacoes').insert(
        (gerentes as any[]).map(g => ({
          portal: 'gerente', destinatario: g.email,
          titulo, mensagem, tipo: 'info', escola_id: escolaId,
        }))
      )
    }
    return json({ ok: true, usado: totalUsado + totalFolhas, limite, num_paginas: numPaginas, modo_lancamento: modoLancamento, duplicado: !!dup, aviso: duplicadoAviso })
  }

  if (action === 'impressao_minhas') {
    const token = (body._token as string) || (body._prof_token as string)
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessao invalida.' }, 401)
    const { data } = await sb.from('impressoes').select('*')
      .eq('professora_id', prof.id).order('criado_em', { ascending: false }).limit(30)
    // Bucket privado (mig 281): signed URL TTL 1h com cache in-memory
    // (helper refreshSignedUrls cuts N chamadas Storage por listagem).
    const refreshed = await refreshSignedUrls(sb.storage, 'impressoes', data ?? [], 'arquivo_path', 'arquivo_url', 3600)
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

  if (action === 'impressao_editar') {
    const token = (body._token as string) || (body._prof_token as string)
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessao invalida.' }, 401)
    const { id, copias, tipo_papel, para_dia, observacao } = body as any
    if (!id) return json({ error: 'ID obrigatório.' }, 400)
    const { data: imp, error: errFind } = await sb.from('impressoes')
      .select('id, professora_id, status, num_paginas, turma_id, escola_id')
      .eq('id', id).maybeSingle()
    if (errFind || !imp) return json({ error: 'Solicitação não encontrada.' }, 404)
    if ((imp as any).professora_id !== prof.id) return json({ error: 'Sem permissão.' }, 403)
    if ((imp as any).status !== 'pendente') return json({ error: 'Só é possível editar solicitações pendentes. Esta já foi processada pelo gerente.' }, 400)
    const upd: Record<string, unknown> = {}
    if (copias !== undefined) {
      const n = parseInt(copias)
      if (!n || n < 1) return json({ error: 'Quantidade de cópias inválida.' }, 400)
      if (n > 500) return json({ error: 'Quantidade de cópias acima do limite (500).' }, 400)
      upd.copias = n
    }
    if (tipo_papel !== undefined) {
      const allowed = ['sulfite', 'desenho', 'cartolina', 'foto', 'adesivo']
      if (!allowed.includes(tipo_papel)) return json({ error: 'Tipo de papel inválido.' }, 400)
      upd.tipo_papel = tipo_papel
    }
    if (para_dia !== undefined) upd.para_dia = para_dia || null
    if (observacao !== undefined) upd.observacao = observacao || null
    if (Object.keys(upd).length === 0) return json({ error: 'Nada para atualizar.' }, 400)
    // Revalida limite mensal se cópias mudou e turma existe (modo lançamento ignora)
    if (upd.copias !== undefined && (imp as any).turma_id) {
      const escolaId = (imp as any).escola_id
      const { data: cfgL } = await sb.from('escola_config').select('valor')
        .eq('escola_id', escolaId).eq('chave', 'impressao_lancamento').maybeSingle()
      const modoLancamento = cfgL ? Boolean((cfgL as any).valor) : true
      if (!modoLancamento) {
        const mes = new Date().toISOString().slice(0, 7)
        const { data: orc } = await sb.from('impressoes_orcamento').select('limite').eq('turma_id', (imp as any).turma_id).eq('mes', mes).maybeSingle()
        const limite = (orc as any)?.limite ?? 50
        const { data: usadas } = await sb.from('impressoes').select('id, copias, num_paginas')
          .eq('turma_id', (imp as any).turma_id).gte('criado_em', mes + '-01').in('status', ['pendente', 'aprovado', 'impresso', 'entregue'])
        const totalUsado = (usadas ?? []).reduce((s: number, r: any) => {
          const cop = r.id === id ? (upd.copias as number) : (r.copias || 0)
          return s + (cop * (r.num_paginas || 1))
        }, 0)
        if (totalUsado > limite) return json({ error: `Limite mensal de ${limite} folhas seria excedido (${totalUsado} com esta alteração).` }, 400)
      }
    }
    const { error } = await sb.from('impressoes').update(upd)
      .eq('id', id).eq('professora_id', prof.id).eq('status', 'pendente')
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  if (action === 'impressao_excluir') {
    const token = (body._token as string) || (body._prof_token as string)
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessao invalida.' }, 401)
    const { id } = body as any
    if (!id) return json({ error: 'ID obrigatório.' }, 400)
    const { data: imp, error: errFind } = await sb.from('impressoes')
      .select('id, professora_id, status, arquivo_path')
      .eq('id', id).maybeSingle()
    if (errFind || !imp) return json({ error: 'Solicitação não encontrada.' }, 404)
    if ((imp as any).professora_id !== prof.id) return json({ error: 'Sem permissão.' }, 403)
    if ((imp as any).status !== 'pendente') return json({ error: 'Só é possível excluir solicitações pendentes. Esta já foi processada pelo gerente.' }, 400)
    const path = (imp as any).arquivo_path
    if (path) {
      try { await sb.storage.from('impressoes').remove([path]) } catch { /* best-effort */ }
    }
    const { error } = await sb.from('impressoes').delete()
      .eq('id', id).eq('professora_id', prof.id).eq('status', 'pendente')
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
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
        const { data: p } = await sb.from('professoras').select('nome, email, escola_id').eq('id', cred.usuario_id).maybeSingle()
        if (!p) return json({ error: 'Professora não encontrada.', code: 'NOT_FOUND' }, 404)
        const { error: sErr } = await sb.from('professora_sessoes').insert({ professora_id: cred.usuario_id, token: tkn, expira_em: exp })
        if (sErr) {
          console.error('[auth] webauthn professora AUTH_SESSION_FAILED', { user: cred.usuario_id, err: sErr })
          return json({ error: 'Não foi possível criar a sessão.', code: 'AUTH_SESSION_FAILED' }, 500)
        }
        token = tkn; nome = p.nome; email = p.email
        try {
          const { trackEvent } = await import('../../_shared/track.ts')
          trackEvent(sb, {
            escola_id: (p as any).escola_id,
            user_id: cred.usuario_id,
            event_name: 'auth.user.logged_in',
            module: 'auth',
            persona: 'professora',
            payload: { sessao_table: 'professora_sessoes', via: 'webauthn' },
          })
        } catch (_) { /* silent */ }
      } else if (cred.usuario_tipo === 'secretaria') {
        const { data: s } = await sb.from('secretarias').select('nome, email, escola_id').eq('id', cred.usuario_id).maybeSingle()
        if (!s) return json({ error: 'Secretária não encontrada.', code: 'NOT_FOUND' }, 404)
        const { error: sErr } = await sb.from('secretaria_sessoes').insert({ secretaria_id: cred.usuario_id, token: tkn, expira_em: exp })
        if (sErr) {
          console.error('[auth] webauthn secretaria AUTH_SESSION_FAILED', { user: cred.usuario_id, err: sErr })
          return json({ error: 'Não foi possível criar a sessão.', code: 'AUTH_SESSION_FAILED' }, 500)
        }
        token = tkn; nome = s.nome; email = s.email
        try {
          const { trackEvent } = await import('../../_shared/track.ts')
          trackEvent(sb, {
            escola_id: (s as any).escola_id,
            user_id: cred.usuario_id,
            event_name: 'auth.user.logged_in',
            module: 'auth',
            persona: 'secretaria',
            payload: { sessao_table: 'secretaria_sessoes', via: 'webauthn' },
          })
        } catch (_) { /* silent */ }
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


  return null
}
