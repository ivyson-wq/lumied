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
  // ━━ ALMOXARIFADO: MANAGER ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━
  // Duas camadas:
  //   • READ + APROVAR/REJEITAR: gerente OU almoxarifado
  //   • EDITAR (orçamento, catálogo, turma, mass price, set_turma): APENAS gerente

  const isAlmEditOnlyAction = [
    'alm_orcamento_set',                      // definir orçamento (papel almox NÃO pode)
    'alm_insumo_save', 'alm_insumo_del', 'alm_insumo_excluir',
    'alm_insumo_set_referencia', 'alm_insumo_atualizar_auto',
    'alm_entrada_estoque',
    'alm_turma_save', 'alm_turma_del',
    'alm_atualizar_precos', 'alm_prof_set_turma',
    'alm_criar_req_gerente',
    'alm_orfaos_promover',                    // promover itens órfãos → cria insumo (gerente only)
    // alm_inventario_* removido daqui — almoxarifado pode operar de ponta a ponta
    // (criar/contar/finalizar/cancelar) pra ser autônomo na função designada.
  ].includes(action)

  // Mesma armadilha do isAlmProfAction: handler dentro do bloco abaixo só roda
  // se o nome estiver aqui. Adicionou `if (action === '...')` novo? Inclua aqui.
  const isAlmGerenteAction = [
    'alm_painel', 'alm_pendentes', 'alm_todas_reqs',
    'alm_aprovar', 'alm_rejeitar',
    'alm_insumos_list', 'alm_insumo_save', 'alm_insumo_del', 'alm_insumo_excluir', 'alm_insumo_set_referencia',
    'alm_insumo_atualizar_auto', 'alm_insumo_historico', 'alm_entrada_estoque',
    'alm_series_list', 'alm_turma_save', 'alm_turma_del',
    'alm_orcamentos_list', 'alm_orcamento_set',
    'alm_relatorio', 'alm_relatorio_query',
    'alm_relatorio_export_xlsx', 'alm_relatorio_export_pdf',
    'alm_relatorio_visualizacoes_list', 'alm_relatorio_visualizacao_save', 'alm_relatorio_visualizacao_delete',
    'alm_prof_set_turma',
    'alm_pdf_pendentes', 'alm_pdf_aprovados', 'alm_pdf_observacoes', 'alm_excel_observacoes',
    'alm_pdf_entregues', 'alm_pdf_guia_recebimento', 'alm_pdf_romaneio_turma',
    'alm_movimentacoes_list', 'alm_conferencia_inventario',
    'alm_inventario_criar', 'alm_inventario_list', 'alm_inventario_get',
    'alm_inventario_contar', 'alm_inventario_finalizar', 'alm_inventario_cancelar',
    'alm_orfaos_list', 'alm_orfaos_promover',
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
          sb.from('alm_requisicoes').select('total, turma_id, status, itens').eq('mes', mes).eq('escola_id', gerente.escola_id).in('status', ['aprovado', 'pendente']),
          sb.from('series').select('id, nome').eq('ativo', true).eq('escola_id', gerente.escola_id),
          sb.from('alm_orcamentos').select('turma_id, valor').eq('mes', mes).eq('escola_id', gerente.escola_id),
        ])
      const totalAprovado = (reqsMes ?? []).filter((r: any) => r.status === 'aprovado').reduce((s: number, r: any) => s + (r.total ?? 0), 0)
      const orcMap: Record<string, number> = {}
      for (const o of orcamentos ?? []) orcMap[o.turma_id] = o.valor
      const gastoAprovMap: Record<string, number> = {}
      const gastoPendMap: Record<string, number> = {}
      const gastoEstoqueMap: Record<string, number> = {}
      const gastoCompraMap:  Record<string, number> = {}
      let totalEstoque = 0
      let totalCompra  = 0
      for (const r of reqsMes ?? []) {
        if (r.status === 'aprovado') {
          gastoAprovMap[r.turma_id] = (gastoAprovMap[r.turma_id] ?? 0) + r.total
          for (const it of (((r as any).itens as any[]) || [])) {
            const pu = parseFloat(it.preco_unit || 0)
            const e = parseFloat(it.qty_do_estoque || 0) * pu
            const c = parseFloat(it.qty_a_comprar  || 0) * pu
            gastoEstoqueMap[r.turma_id] = (gastoEstoqueMap[r.turma_id] ?? 0) + e
            gastoCompraMap[r.turma_id]  = (gastoCompraMap[r.turma_id]  ?? 0) + c
            totalEstoque += e
            totalCompra  += c
          }
        }
        if (r.status === 'pendente') gastoPendMap[r.turma_id] = (gastoPendMap[r.turma_id] ?? 0) + r.total
      }
      const turmasStats = (turmas ?? []).map((t: any) => {
        const orc = orcMap[t.id] ?? 0
        const gastoAprov = gastoAprovMap[t.id] ?? 0
        const gastoPend = gastoPendMap[t.id] ?? 0
        return {
          ...t, orcamento: orc, gasto: gastoAprov + gastoPend,
          gasto_aprovado: gastoAprov, gasto_pendente: gastoPend,
          gasto_estoque: gastoEstoqueMap[t.id] ?? 0,
          gasto_compra:  gastoCompraMap[t.id]  ?? 0,
          disponivel: Math.max(0, orc - gastoAprov - gastoPend),
        }
      })
      return json({
        pendentes: pendentes ?? 0,
        totalAprovado, total_estoque: totalEstoque, total_compra: totalCompra,
        turmas: turmasStats, mes,
      })
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
        // Quantidade já entregue de fonte=compra (estoque não conta aqui — não
        // reduz o que ainda é esperado do fornecedor)
        const reqIds = (reqs ?? []).map((r: any) => r.id)
        const entregueMap: Record<string, number> = {}
        if (reqIds.length) {
          const { data: entregasTodas } = await sb.from('alm_entregas')
            .select('requisicao_id, insumo_id, qty_entregue, fonte')
            .in('requisicao_id', reqIds)
            .eq('fonte', 'compra')
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

        // Pendências reais com fornecedor: alm_compras pendente/comprado
        // (itens vindos do estoque NÃO entram aqui — já estão na escola).
        const compraPendenteMap: Record<string, number> = {}
        if (reqIds.length) {
          const { data: comprasPend } = await sb.from('alm_compras')
            .select('requisicao_id, insumo_id, qty, status')
            .eq('escola_id', escolaId)
            .in('requisicao_id', reqIds)
            .in('status', ['pendente', 'comprado'])
          for (const c of (comprasPend ?? []) as any[]) {
            const k = `${c.requisicao_id}|${c.insumo_id || ''}`
            compraPendenteMap[k] = (compraPendenteMap[k] || 0) + Number(c.qty || 0)
          }
        }

        // Agrupa por turma — facilita conferência por sala (pedido do usuário)
        const turmas: Record<string, { nome: string; itens: any[] }> = {}
        let count = 0
        for (const r of (reqs ?? []) as any[]) {
          const tNome = r.series?.nome || 'Sem turma'
          for (const it of (r.itens || [])) {
            const k = `${r.id}|${it.insumo_id || ''}`
            const aReceberTotal = compraPendenteMap[k] || 0
            // Já recebido (alm_entregas fonte=compra, normalmente)
            const jaEntregue = entregueMap[k] || 0
            const aReceber = aReceberTotal - jaEntregue
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
      // Romaneio: tudo que está PRONTO PRA ENTREGAR à turma — vem de duas fontes:
      //  • estoque (alm_entregas.fonte='estoque', auto-criado em alm_aprovar)
      //  • compra recebida (alm_entregas.fonte='compra', via alm_distribuir_grupo
      //    OU alm_compras com status='comprado' aguardando distribuir).
      const escolaId = (gerente as any).escola_id
      const { data: reqs } = await sb.from('alm_requisicoes')
        .select('id, professora_id, professoras(nome, email), series(nome), itens')
        .eq('status', 'aprovado').eq('escola_id', escolaId).order('criado_em')
      const reqIds = (reqs ?? []).map((r: any) => r.id)

      // Entregas já registradas (estoque + compra) — fonte pra mostrar origem
      type Entrega = { req: string; insumo: string; qty: number; fonte: string }
      const entregasPorChave: Record<string, Entrega[]> = {}
      if (reqIds.length) {
        const { data: entregas } = await sb.from('alm_entregas')
          .select('requisicao_id, insumo_id, qty_entregue, fonte')
          .in('requisicao_id', reqIds)
        for (const e of (entregas ?? []) as any[]) {
          const k = `${e.requisicao_id}|${e.insumo_id || ''}`
          ;(entregasPorChave[k] ||= []).push({
            req: e.requisicao_id, insumo: e.insumo_id, qty: Number(e.qty_entregue || 0), fonte: e.fonte || 'compra',
          })
        }
      }
      // Compras já comprado (mas ainda sem distribuir) também entram no romaneio
      // como "pra entregar" — fonte=compra
      if (reqIds.length) {
        const { data: comprasComp } = await sb.from('alm_compras')
          .select('requisicao_id, insumo_id, qty')
          .eq('escola_id', escolaId)
          .in('requisicao_id', reqIds)
          .eq('status', 'comprado')
        for (const c of (comprasComp ?? []) as any[]) {
          const k = `${c.requisicao_id}|${c.insumo_id || ''}`
          // Soma só o que ainda não foi registrado em alm_entregas fonte=compra
          const jaRegistradoCompra = (entregasPorChave[k] || [])
            .filter(e => e.fonte === 'compra')
            .reduce((s, e) => s + e.qty, 0)
          const aRegistrar = Number(c.qty || 0) - jaRegistradoCompra
          if (aRegistrar > 0) {
            ;(entregasPorChave[k] ||= []).push({
              req: c.requisicao_id, insumo: c.insumo_id, qty: aRegistrar, fonte: 'compra',
            })
          }
        }
      }

      const porTurma: Record<string, { profs: Set<string>; items: any[] }> = {}
      for (const r of (reqs ?? []) as any[]) {
        const t = r.series?.nome || '—'
        const p = r.professoras?.nome || '—'
        const bucket = (porTurma[t] ||= { profs: new Set(), items: [] })
        bucket.profs.add(p)
        for (const it of (r.itens || [])) {
          const key = `${r.id}|${it.insumo_id || ''}`
          const linhas = entregasPorChave[key] || []
          if (!linhas.length) continue
          const totalEstoque = linhas.filter(l => l.fonte === 'estoque').reduce((s, l) => s + l.qty, 0)
          const totalCompra  = linhas.filter(l => l.fonte === 'compra').reduce((s, l) => s + l.qty, 0)
          const total = totalEstoque + totalCompra
          if (total <= 0) continue
          const fonteLbl = totalEstoque > 0 && totalCompra > 0
            ? `📦${totalEstoque} estoque · 🛒${totalCompra} comprado`
            : totalEstoque > 0 ? '📦 estoque' : '🛒 comprado'
          bucket.items.push({ ...it, total, fonteLbl, prof: p, req: r.id })
        }
      }
      const tables = Object.entries(porTurma)
        .filter(([, b]) => b.items.length)
        .map(([turma, b]) => ({
          heading: `TURMA ${turma}  —  Professoras: ${[...b.profs].join(', ')}`,
          columns: [
            { label: '▢', width: 20, align: 'center' as const },
            { label: 'Item', width: 180 },
            { label: 'Qtd', width: 50, align: 'right' as const },
            { label: 'Origem', width: 120 },
            { label: 'Professora', width: 110 },
            { label: 'Req', width: 50 },
          ],
          rows: b.items.map((it: any) => [
            '',
            it.nome,
            `${it.total} ${it.unidade || 'un'}`,
            it.fonteLbl,
            it.prof,
            `#${String(it.req).slice(0, 8)}`,
          ]),
          footer: ['', `Assinatura: ________________________________`, '', '', '', `Data: ___/___/____`],
        }))
      if (!tables.length) tables.push({ columns: [{ label: 'Info', width: 515 }], rows: [['Nenhum item pronto pra entrega. Itens vindos do estoque entram automaticamente na aprovação; itens comprados entram quando marcados como "comprado".']] })
      const bytes = await generatePdf({
        title: 'Romaneio de Entrega por Turma',
        subtitle: 'Lista apenas itens já recebidos do fornecedor (status "comprado" ou "entregue"). Marque o ▢ ao entregar e peça a assinatura da professora ao final de cada turma.',
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
            valor: parseFloat((it.qty_aprovado ?? it.qty_solicitado ?? 0)) * parseFloat(it.preco_unit || 0),
            tipo: it.tipo === 'emprestimo' ? 'emprestimo' : 'comprar',
            localizacao: it.localizacao || null,
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
          map[key].qty += l.qty_aprovado ?? l.qty_solicitado
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
            qty: parseFloat((it.qty_aprovado ?? it.qty_solicitado ?? 0)),
            preco: parseFloat(it.preco_unit || 0),
            valor: parseFloat((it.qty_aprovado ?? it.qty_solicitado ?? 0)) * parseFloat(it.preco_unit || 0),
            tipo: it.tipo === 'emprestimo' ? 'Empréstimo' : 'Compra',
            link: it.link_referencia || it.localizacao || '',
          })
        }
      }
      if (action === 'alm_relatorio_export_xlsx') {
        const headers = ['Data', 'Mês', 'Status', 'Turma', 'Professora', 'Item', 'Tipo', 'Categoria', 'Qty', 'Unid.', 'Preço', 'Valor', 'Link/Local']
        const rows = linhas.map(l => [l.data, l.mes, l.status, l.turma, l.professora, l.nome, l.tipo, l.categoria, String(l.qty), l.unidade, l.preco.toFixed(2), l.valor.toFixed(2), l.link])
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
      // itens_aprovados: optional override of qty_aprovado per item; pode trazer
      // rejeitado:true (gerente rejeitou item específico mantendo os demais).
      const { data: req } = await sb.from('alm_requisicoes').select('*')
        .eq('id', id).eq('escola_id', (gerente as any).escola_id).maybeSingle()
      if (!req) return json({ error: 'Requisição não encontrada.' }, 404)
      if (req.status !== 'pendente') return json({ error: 'Requisição já processada.' }, 400)
      // Merge approved quantities into items + flag rejeitado (qty=0 → rejeitado)
      const itens = (req.itens as any[]).map((it: any) => {
        const override = itens_aprovados?.find((x: any) => x.insumo_id === it.insumo_id)
        const qtyAprov = override?.qty_aprovado ?? it.qty_solicitado
        const rejeitado = override?.rejeitado === true || Number(qtyAprov) <= 0
        return { ...it, qty_aprovado: rejeitado ? 0 : qtyAprov, rejeitado }
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
            // Auto-entrega: itens vindos do estoque já são "alocados" pra turma
            // ao aprovar — sem passo manual. Aparecem no romaneio direto.
            await sb.from('alm_entregas').insert({
              escola_id: (gerente as any).escola_id,
              requisicao_id: id,
              insumo_id: it.insumo_id,
              qty_entregue: saidaEstoque,
              entregue_por: gerente.nome,
              fonte: 'estoque',
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
        // Empréstimo não vira insumo de catálogo (já existe na escola, sem cotação)
        if (it.tipo === 'emprestimo') continue
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

      // Calcula resumo de estoque pro frontend (toast)
      const totalDoEstoque = itens.reduce((s: number, it: any) => s + Number(it.qty_do_estoque || 0), 0)
      const totalAComprar  = itens.reduce((s: number, it: any) => s + Number(it.qty_a_comprar  || 0), 0)
      const itensAtendidosTotalmente = itens.filter((it: any) =>
        Number(it.qty_aprovado) > 0 && Number(it.qty_a_comprar || 0) === 0
      ).length

      // Notify the teacher — destaca itens rejeitados se houver
      const rejeitados = itens.filter((it: any) => it.rejeitado).map((it: any) => it.nome)
      const aprovParcial = rejeitados.length > 0
      const dataReq = new Date(req.criado_em).toLocaleDateString('pt-BR')
      const msg = aprovParcial
        ? `Sua requisição de ${dataReq} foi ⚠️ aprovada parcialmente. ${rejeitados.length} ${rejeitados.length === 1 ? 'item rejeitado' : 'itens rejeitados'}: ${rejeitados.join(', ')}.${nota_gerente ? ' Nota: ' + nota_gerente : ''}`
        : `Sua requisição de ${dataReq} foi ✅ aprovada.${nota_gerente ? ' Nota: ' + nota_gerente : ''}`
      await sb.from('alm_notificacoes').insert({
        professora_id: req.professora_id,
        requisicao_id: id,
        mensagem: msg,
      })
      const resp: Record<string, unknown> = {
        ok: true,
        total_do_estoque: totalDoEstoque,
        total_a_comprar: totalAComprar,
        itens_atendidos_totalmente: itensAtendidosTotalmente,
      }
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

    // ─── Inventário físico (sessão persistida) ──────────────────────
    if (action === 'alm_inventario_criar') {
      const { nome, descricao, filtro_categoria, filtro_localizacao } = body
      if (!nome) return json({ error: 'Nome da sessão obrigatório.' }, 400)
      const escolaId = (gerente as any).escola_id

      // Bloqueia abrir 2ª sessão simultânea (rascunho)
      const { count: abertas } = await sb.from('alm_inventarios')
        .select('*', { count: 'exact', head: true })
        .eq('escola_id', escolaId).eq('status', 'rascunho')
      if ((abertas || 0) > 0) {
        return json({ error: 'Já existe uma contagem em andamento. Finalize ou cancele antes de abrir outra.' }, 400)
      }

      // Lista insumos ativos, opcionalmente filtrando
      let q = sb.from('alm_insumos').select('id, nome, unidade, categoria, localizacao, estoque_qty')
        .eq('escola_id', escolaId).eq('ativo', true)
      if (filtro_categoria) q = q.eq('categoria', filtro_categoria)
      if (filtro_localizacao) q = q.eq('localizacao', filtro_localizacao)
      const { data: insumos } = await q
      if (!insumos || insumos.length === 0) {
        return json({ error: 'Nenhum insumo ativo encontrado para os filtros selecionados.' }, 400)
      }

      const { data: inv, error: errInv } = await sb.from('alm_inventarios').insert({
        escola_id: escolaId,
        nome,
        descricao: descricao || null,
        filtro_categoria: filtro_categoria || null,
        filtro_localizacao: filtro_localizacao || null,
        total_itens: insumos.length,
        criado_por: (gerente as any).id || null,
      }).select('id').single()
      if (errInv || !inv) return json({ error: errInv?.message || 'Erro ao criar sessão.' }, 400)

      const itens = insumos.map((i: any) => ({
        escola_id: escolaId,
        inventario_id: inv.id,
        insumo_id: i.id,
        nome_snapshot: i.nome,
        unidade_snapshot: i.unidade,
        categoria_snapshot: i.categoria,
        localizacao_snapshot: i.localizacao,
        saldo_sistema: Number(i.estoque_qty || 0),
      }))
      const { error: errIts } = await sb.from('alm_inventario_itens').insert(itens)
      if (errIts) {
        await sb.from('alm_inventarios').delete().eq('id', inv.id)
        return json({ error: errIts.message }, 400)
      }
      return json({ ok: true, id: inv.id, total: insumos.length })
    }

    if (action === 'alm_inventario_list') {
      const { data } = await sb.from('alm_inventarios').select('*')
        .eq('escola_id', (gerente as any).escola_id)
        .order('criado_em', { ascending: false }).limit(50)
      return json({ data: data ?? [] })
    }

    if (action === 'alm_inventario_get') {
      const { id } = body
      if (!id) return json({ error: 'id obrigatório.' }, 400)
      const escolaId = (gerente as any).escola_id
      const { data: inv } = await sb.from('alm_inventarios').select('*')
        .eq('id', id).eq('escola_id', escolaId).maybeSingle()
      if (!inv) return json({ error: 'Sessão não encontrada.' }, 404)
      const { data: itens } = await sb.from('alm_inventario_itens').select('*')
        .eq('inventario_id', id).eq('escola_id', escolaId)
        .order('localizacao_snapshot', { ascending: true, nullsFirst: false })
        .order('categoria_snapshot', { ascending: true, nullsFirst: false })
        .order('nome_snapshot', { ascending: true })
      return json({ inventario: inv, itens: itens ?? [] })
    }

    if (action === 'alm_inventario_contar') {
      const { item_id, saldo_contado, observacao } = body
      if (!item_id) return json({ error: 'item_id obrigatório.' }, 400)
      const escolaId = (gerente as any).escola_id

      // Valida que item pertence a sessão em rascunho
      const { data: it } = await sb.from('alm_inventario_itens')
        .select('id, inventario_id, alm_inventarios(status)')
        .eq('id', item_id).eq('escola_id', escolaId).maybeSingle()
      if (!it) return json({ error: 'Item não encontrado.' }, 404)
      const status = (it as any).alm_inventarios?.status
      if (status !== 'rascunho') return json({ error: 'Sessão já finalizada/cancelada.' }, 400)

      const isClear = saldo_contado === null || saldo_contado === undefined || saldo_contado === ''
      const novo = isClear ? null : parseFloat(String(saldo_contado).replace(',', '.'))
      if (!isClear && (Number.isNaN(novo as number) || (novo as number) < 0)) {
        return json({ error: 'saldo_contado inválido.' }, 400)
      }

      const { error } = await sb.from('alm_inventario_itens').update({
        saldo_contado: novo,
        contado: !isClear,
        observacao: observacao ?? null,
        contado_por: isClear ? null : ((gerente as any).id || null),
        contado_em: isClear ? null : new Date().toISOString(),
      }).eq('id', item_id).eq('escola_id', escolaId)
      if (error) return json({ error: error.message }, 400)

      // Atualiza contadores do header
      const { data: stats } = await sb.from('alm_inventario_itens')
        .select('contado, saldo_sistema, saldo_contado')
        .eq('inventario_id', (it as any).inventario_id).eq('escola_id', escolaId)
      const total = (stats || []).length
      const contados = (stats || []).filter((x: any) => x.contado).length
      const divs = (stats || []).filter((x: any) => x.contado && Number(x.saldo_contado) !== Number(x.saldo_sistema)).length
      await sb.from('alm_inventarios').update({
        total_contados: contados,
        total_divergencias: divs,
        total_itens: total,
      }).eq('id', (it as any).inventario_id).eq('escola_id', escolaId)

      return json({ ok: true, total_contados: contados, total_divergencias: divs })
    }

    if (action === 'alm_inventario_finalizar') {
      const { id, aplicar_nao_contados } = body
      if (!id) return json({ error: 'id obrigatório.' }, 400)
      const escolaId = (gerente as any).escola_id

      const { data: inv } = await sb.from('alm_inventarios').select('*')
        .eq('id', id).eq('escola_id', escolaId).maybeSingle()
      if (!inv) return json({ error: 'Sessão não encontrada.' }, 404)
      if (inv.status !== 'rascunho') return json({ error: 'Sessão já finalizada/cancelada.' }, 400)

      const { data: itens } = await sb.from('alm_inventario_itens').select('*')
        .eq('inventario_id', id).eq('escola_id', escolaId)
      const lista = itens || []

      const naoContados = lista.filter((x: any) => !x.contado).length
      if (naoContados > 0 && !aplicar_nao_contados) {
        return json({
          error: `Existem ${naoContados} itens não contados. Conte todos ou confirme finalização parcial.`,
          code: 'PENDING_ITEMS',
          nao_contados: naoContados,
        }, 400)
      }

      // Aplica ajustes: para cada item contado com divergência → update insumo + insert movimentação
      let aplicados = 0
      let divergencias = 0
      for (const it of lista as any[]) {
        if (!it.contado) continue
        const antes = Number(it.saldo_sistema || 0)
        const depois = Number(it.saldo_contado || 0)
        if (antes === depois) continue
        divergencias++

        // Releia saldo atual do insumo para evitar race com saídas durante a contagem
        const { data: insAtual } = await sb.from('alm_insumos').select('estoque_qty')
          .eq('id', it.insumo_id).eq('escola_id', escolaId).maybeSingle()
        const atual = insAtual ? Number((insAtual as any).estoque_qty || 0) : antes
        const diff = depois - antes  // ajuste que o conferente intencionou
        const novoSaldo = atual + diff
        const novoSaldoSafe = novoSaldo < 0 ? 0 : novoSaldo

        await sb.from('alm_insumos').update({ estoque_qty: novoSaldoSafe })
          .eq('id', it.insumo_id).eq('escola_id', escolaId)
        await sb.from('alm_movimentacoes').insert({
          escola_id: escolaId,
          insumo_id: it.insumo_id,
          tipo: 'ajuste',
          qty: Math.abs(diff),
          motivo: `Inventário "${inv.nome}": ${antes} → ${depois}${it.observacao ? ' · ' + it.observacao : ''}`,
          saldo_antes: atual,
          saldo_depois: novoSaldoSafe,
          usuario_id: (gerente as any).id || null,
        })
        aplicados++
      }

      await sb.from('alm_inventarios').update({
        status: 'finalizado',
        finalizado_em: new Date().toISOString(),
        finalizado_por: (gerente as any).id || null,
        total_divergencias: divergencias,
      }).eq('id', id).eq('escola_id', escolaId)

      return json({ ok: true, aplicados, divergencias, nao_contados: naoContados })
    }

    if (action === 'alm_inventario_cancelar') {
      const { id } = body
      if (!id) return json({ error: 'id obrigatório.' }, 400)
      const escolaId = (gerente as any).escola_id
      const { data: inv } = await sb.from('alm_inventarios').select('status')
        .eq('id', id).eq('escola_id', escolaId).maybeSingle()
      if (!inv) return json({ error: 'Sessão não encontrada.' }, 404)
      if ((inv as any).status !== 'rascunho') return json({ error: 'Apenas rascunhos podem ser cancelados.' }, 400)
      const { error } = await sb.from('alm_inventarios').update({
        status: 'cancelado', cancelado_em: new Date().toISOString(),
      }).eq('id', id).eq('escola_id', escolaId)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
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
      const { id, nome, descricao, unidade, estoque_qty, preco, categoria, unidade_compra, qtd_por_embalagem, localizacao } = body
      if (!nome) return json({ error: 'Nome obrigatório.' }, 400)
      const data: Record<string, unknown> = { nome, descricao, unidade, estoque_qty, preco, categoria, unidade_compra: unidade_compra || null, qtd_por_embalagem: qtd_por_embalagem || 1, localizacao: localizacao || null }
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

    if (action === 'alm_insumo_excluir') {
      const { id } = body
      if (!id) return json({ error: 'ID não informado.' }, 400)
      // Check if used in any requisition items (JSONB array) or purchases
      const { data: compras } = await sb.from('alm_compras').select('id').eq('insumo_id', id).limit(1)
      if (compras && compras.length > 0) {
        return json({ error: 'Este insumo está vinculado a compras e não pode ser excluído. Use "Desativar" em vez disso.' }, 400)
      }
      const { data: movs } = await sb.from('alm_movimentacoes').select('id').eq('insumo_id', id).limit(1)
      if (movs && movs.length > 0) {
        return json({ error: 'Este insumo possui movimentações de estoque e não pode ser excluído. Use "Desativar" em vez disso.' }, 400)
      }
      const { error } = await sb.from('alm_insumos').delete().eq('id', id).eq('escola_id', (gerente as any).escola_id)
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
      // Group by turma — separa gasto em fonte=estoque vs fonte=compra
      const turmaMap: Record<string, any> = {}
      for (const r of reqs ?? []) {
        const tid = r.turma_id ?? 'sem_turma'
        if (!turmaMap[tid]) turmaMap[tid] = {
          turma: (r as any).series ?? { nome: 'Sem turma' },
          orcamento: orcMap[tid] ?? 0,
          gasto: 0, gasto_estoque: 0, gasto_compra: 0,
          pendente: 0, rejeitado: 0, requisicoes: [],
        }
        if (r.status === 'aprovado') {
          turmaMap[tid].gasto += r.total
          // Quebra por fonte usando jsonb itens (qty_do_estoque / qty_a_comprar gravados em alm_aprovar)
          for (const it of ((r.itens as any[]) || [])) {
            const pu = parseFloat(it.preco_unit || 0)
            turmaMap[tid].gasto_estoque += parseFloat(it.qty_do_estoque || 0) * pu
            turmaMap[tid].gasto_compra  += parseFloat(it.qty_a_comprar  || 0) * pu
          }
        }
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

    // ━━ Itens órfãos: requisições aprovadas com item sem insumo_id ━━
    // Cobre o gap deixado pelo bug do auto-create em alm_aprovar (pré-2026-05-07,
    // commit 95d13dc). Lista agrupa por nome normalizado pra dedupe; gerente
    // revisa e promove em lote → cria insumos + atualiza itens das reqs.
    const normalizarNome = (s: string): string =>
      String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

    if (action === 'alm_orfaos_list') {
      const { data: reqs } = await sb.from('alm_requisicoes')
        .select('id, itens, criado_em, mes, turma_id, series(nome)')
        .eq('escola_id', (gerente as any).escola_id)
        .eq('status', 'aprovado')
        .order('criado_em', { ascending: false })
      type ItemOrfao = { req_id: string; req_data: string; turma: string; nome: string; unidade: string; preco: number; categoria: string | null; qty: number }
      const orfaos: ItemOrfao[] = []
      for (const r of reqs ?? []) {
        const itens = Array.isArray((r as any).itens) ? (r as any).itens : []
        for (const it of itens) {
          const semId = !it?.insumo_id || it.insumo_id === 'null' || it.insumo_id === 'undefined'
          const qtyAprov = parseFloat(it?.qty_aprovado ?? it?.qty_solicitado ?? 0)
          if (semId && it?.nome && qtyAprov > 0 && it?.rejeitado !== true) {
            orfaos.push({
              req_id: r.id,
              req_data: (r as any).criado_em,
              turma: ((r as any).series?.nome) || '—',
              nome: String(it.nome).trim(),
              unidade: String(it.unidade || 'unidade'),
              preco: parseFloat(it.preco_unit ?? it.preco ?? 0) || 0,
              categoria: it.categoria || null,
              qty: qtyAprov,
            })
          }
        }
      }
      // Agrupa por nome normalizado
      const grupos = new Map<string, {
        chave: string;
        nome_canonico: string;
        variantes: Set<string>;
        unidades: Map<string, number>;
        categorias: Map<string, number>;
        precos: number[];
        req_ids: Set<string>;
        ocorrencias: number;
        primeira_data: string;
        ultima_data: string;
      }>()
      for (const o of orfaos) {
        const k = normalizarNome(o.nome)
        if (!k) continue
        let g = grupos.get(k)
        if (!g) {
          g = {
            chave: k,
            nome_canonico: o.nome,
            variantes: new Set([o.nome]),
            unidades: new Map(),
            categorias: new Map(),
            precos: [],
            req_ids: new Set(),
            ocorrencias: 0,
            primeira_data: o.req_data,
            ultima_data: o.req_data,
          }
          grupos.set(k, g)
        }
        g.variantes.add(o.nome)
        g.unidades.set(o.unidade, (g.unidades.get(o.unidade) || 0) + 1)
        if (o.categoria) g.categorias.set(o.categoria, (g.categorias.get(o.categoria) || 0) + 1)
        if (o.preco > 0) g.precos.push(o.preco)
        g.req_ids.add(o.req_id)
        g.ocorrencias++
        if (o.req_data < g.primeira_data) g.primeira_data = o.req_data
        if (o.req_data > g.ultima_data) g.ultima_data = o.req_data
      }
      // Cross-check: já existe insumo no catálogo com nome similar? Sinaliza.
      const { data: catalogo } = await sb.from('alm_insumos')
        .select('id, nome, unidade')
        .eq('escola_id', (gerente as any).escola_id)
        .eq('ativo', true)
      const catMap = new Map<string, { id: string; nome: string; unidade: string }>()
      for (const c of catalogo ?? []) catMap.set(normalizarNome((c as any).nome), c as any)

      const lista = Array.from(grupos.values())
        .map(g => {
          const unidadeDom = [...g.unidades.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'unidade'
          const categoriaDom = [...g.categorias.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
          const precoMedio = g.precos.length
            ? Math.round(g.precos.reduce((s, p) => s + p, 0) / g.precos.length * 100) / 100
            : 0
          const existente = catMap.get(g.chave) || null
          return {
            chave: g.chave,
            nome: g.nome_canonico,
            variantes: Array.from(g.variantes),
            unidade: unidadeDom,
            categoria: categoriaDom,
            preco: precoMedio,
            preco_min: g.precos.length ? Math.min(...g.precos) : 0,
            preco_max: g.precos.length ? Math.max(...g.precos) : 0,
            ocorrencias: g.ocorrencias,
            req_ids: Array.from(g.req_ids),
            primeira_data: g.primeira_data,
            ultima_data: g.ultima_data,
            insumo_existente: existente,
          }
        })
        .sort((a, b) => b.ocorrencias - a.ocorrencias || a.nome.localeCompare(b.nome))
      return json({ data: lista, total_grupos: lista.length, total_itens: orfaos.length })
    }

    if (action === 'alm_orfaos_promover') {
      const { grupos } = body as { grupos?: Array<{ nome: string; unidade?: string; preco?: number; categoria?: string | null; variantes: string[]; req_ids: string[]; insumo_existente_id?: string | null }> }
      if (!Array.isArray(grupos) || !grupos.length) return json({ error: 'Nenhum grupo informado.' }, 400)
      const escolaId = (gerente as any).escola_id
      let promovidos = 0
      let itensAtualizados = 0
      const falhas: Array<{ nome: string; error: string }> = []
      for (const g of grupos) {
        const nome = String(g.nome || '').trim()
        if (!nome) { falhas.push({ nome: '(vazio)', error: 'nome obrigatório' }); continue }
        const variantesNorm = new Set((g.variantes || []).map(v => normalizarNome(v)))
        if (variantesNorm.size === 0) variantesNorm.add(normalizarNome(nome))
        // Cria insumo OU usa existente
        let insumoId = g.insumo_existente_id || null
        if (!insumoId) {
          const { data: novo, error: errIns } = await sb.from('alm_insumos').insert({
            nome,
            unidade: g.unidade || 'unidade',
            preco: Math.max(0, Number(g.preco) || 0),
            estoque_qty: 0,
            categoria: g.categoria || null,
            escola_id: escolaId,
            referencia_fonte: 'professora',
          }).select('id').single()
          if (errIns || !novo) {
            falhas.push({ nome, error: errIns?.message || 'falha desconhecida no INSERT' })
            continue
          }
          insumoId = novo.id
          promovidos++
        }
        // Atualiza JSONB.itens de cada req
        for (const reqId of (g.req_ids || [])) {
          const { data: r } = await sb.from('alm_requisicoes').select('itens').eq('id', reqId).eq('escola_id', escolaId).maybeSingle()
          if (!r) continue
          const itens = Array.isArray((r as any).itens) ? (r as any).itens : []
          let mudou = false
          for (const it of itens) {
            const semId = !it?.insumo_id || it.insumo_id === 'null' || it.insumo_id === 'undefined'
            if (!semId) continue
            if (it?.nome && variantesNorm.has(normalizarNome(it.nome))) {
              it.insumo_id = insumoId
              mudou = true
              itensAtualizados++
            }
          }
          if (mudou) await sb.from('alm_requisicoes').update({ itens }).eq('id', reqId).eq('escola_id', escolaId)
        }
      }
      return json({ ok: true, promovidos, itens_atualizados: itensAtualizados, falhas })
    }
  }

  return null
}
