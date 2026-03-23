// ══════════════════════════════════════════════════════════════
//  ACTIONS DE MANUTENÇÃO — Colar na edge function 'diplomas'
//
//  Instruções:
//  1. Abra a edge function 'diplomas' no Supabase Dashboard
//  2. Localize a linha: return json({ error: 'Ação desconhecida' }, 400)
//  3. Cole TODO este bloco ANTES dessa linha
//  4. Faça o Deploy
// ══════════════════════════════════════════════════════════════

  // ━━ MANUTENÇÃO: TEACHER ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━
  const isManutProfAction = [
    'manutencao_criar', 'manutencao_minhas',
  ].includes(action)

  if (isManutProfAction) {
    const prof = await getProfessora(sb, token)
    if (!prof) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    if (action === 'manutencao_criar') {
      const descricao: string = (body.descricao || '').trim()
      const localizacao: string = (body.localizacao || '').trim()
      const urgencia: string = body.urgencia || ''
      if (!descricao || !localizacao || !urgencia)
        return json({ error: 'Descrição, localização e urgência são obrigatórios.' }, 400)
      if (!['baixa', 'media', 'alta', 'critica'].includes(urgencia))
        return json({ error: 'Urgência inválida.' }, 400)

      let foto_url: string | null = null
      if (body.foto_base64) {
        const base64: string = body.foto_base64
        const mime: string = body.foto_mime || 'image/jpeg'
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        if (bytes.length > 10 * 1024 * 1024)
          return json({ error: 'Foto muito grande (máx. 10MB).' }, 400)
        const ext = mime === 'image/png' ? 'png' : 'jpg'
        const fileName = `${prof.id}/${Date.now()}.${ext}`
        // Garante que o bucket existe
        await sb.storage.createBucket('manutencoes', { public: true }).catch(() => {})
        const { error: upErr } = await sb.storage
          .from('manutencoes').upload(fileName, bytes, { contentType: mime, upsert: false })
        if (upErr) return json({ error: 'Erro ao fazer upload da foto: ' + upErr.message }, 400)
        const { data: { publicUrl } } = sb.storage.from('manutencoes').getPublicUrl(fileName)
        foto_url = publicUrl
      }

      const { error } = await sb.from('manutencoes').insert({
        professora_id: prof.id,
        descricao,
        localizacao,
        urgencia,
        foto_url,
        status: 'pendente',
      })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'manutencao_minhas') {
      const { data } = await sb
        .from('manutencoes').select('*')
        .eq('professora_id', prof.id)
        .order('criado_em', { ascending: false })
      return json({ data: data ?? [] })
    }
  }

  // ━━ MANUTENÇÃO: MANAGER ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━
  const isManutGerenteAction = [
    'manutencao_list_all', 'manutencao_aprovar', 'manutencao_rejeitar',
    'manutencao_definir_equipe', 'manutencao_iniciar_execucao', 'manutencao_concluir',
  ].includes(action)

  if (isManutGerenteAction) {
    const ger = await getGerente(sb, token)
    if (!ger) return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, 401)

    if (action === 'manutencao_list_all') {
      const filterStatus: string | undefined = body.status
      let query = sb.from('manutencoes').select('*, professoras(nome, email)')
        .order('criado_em', { ascending: false })
      if (filterStatus && filterStatus !== 'all') query = query.eq('status', filterStatus)
      const { data } = await query
      return json({ data: data ?? [] })
    }

    if (action === 'manutencao_aprovar') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('manutencoes').update({
        status: 'aprovada',
        observacao_gerente: body.observacao || null,
        atualizado_em: new Date().toISOString(),
      }).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'manutencao_rejeitar') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('manutencoes').update({
        status: 'rejeitada',
        observacao_gerente: body.observacao || null,
        atualizado_em: new Date().toISOString(),
      }).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'manutencao_definir_equipe') {
      const { id, equipe_responsavel } = body
      if (!id || !equipe_responsavel) return json({ error: 'ID e equipe são obrigatórios.' }, 400)
      const { error } = await sb.from('manutencoes').update({
        equipe_responsavel,
        atualizado_em: new Date().toISOString(),
      }).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'manutencao_iniciar_execucao') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('manutencoes').update({
        status: 'em_execucao',
        atualizado_em: new Date().toISOString(),
      }).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'manutencao_concluir') {
      const { id, data_conclusao } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      const { error } = await sb.from('manutencoes').update({
        status: 'concluida',
        data_conclusao: data_conclusao || new Date().toISOString().split('T')[0],
        observacao_gerente: body.observacao || null,
        atualizado_em: new Date().toISOString(),
      }).eq('id', id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
  }
