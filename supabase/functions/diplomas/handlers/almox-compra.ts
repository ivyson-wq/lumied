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
      const tipo = it.tipo === 'emprestimo' ? 'emprestimo' : 'comprar'
      if (tipo === 'emprestimo') {
        const loc = String(it.localizacao || '').trim()
        if (loc.length < 3) return json({ error: `Informe onde está "${it.nome || '?'}" (mínimo 3 caracteres).` }, 400)
        it.tipo = 'emprestimo'; it.localizacao = loc; it.link_referencia = null; it.preco_unit = 0
        continue
      }
      it.tipo = 'comprar'; it.localizacao = null
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
    'alm_compras_compilado', 'alm_distribuir_grupo',
    'alm_compras_compilado_pdf', 'alm_compras_compilado_xlsx',
    'alm_insumos_referencia_suspeita', 'alm_insumos_corrigir_referencia_suspeita',
    'alm_compra_aprovar_financeiro',
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
      // qty é tratado como TETO (qty_aprovado) — backend cruza com qty_a_comprar
      // do alm_aprovar pra excluir o que já foi atendido pelo estoque.
      const { requisicao_id, itens } = body
      if (!requisicao_id || !itens?.length)
        return json({ error: 'requisicao_id e itens são obrigatórios.' }, 400)

      // Lê itens da requisição pra pegar qty_a_comprar (calculado em alm_aprovar)
      const { data: req } = await sb.from('alm_requisicoes').select('itens')
        .eq('id', requisicao_id).eq('escola_id', (gerente as any).escola_id).maybeSingle()
      const reqItens: any[] = ((req as any)?.itens as any[]) || []

      const rows = (itens as any[]).map((it: any) => {
        // Encontra item correspondente na req — match por insumo_id ou nome
        const reqIt = reqItens.find((r: any) =>
          (it.insumo_id && r.insumo_id === it.insumo_id) ||
          (!it.insumo_id && r.nome === it.insumo_nome)
        )
        const qtyAComprar = reqIt && reqIt.qty_a_comprar != null
          ? Number(reqIt.qty_a_comprar)
          : Number(it.qty || 0)
        const qtyFinal = Math.min(Number(it.qty || qtyAComprar), qtyAComprar)
        return {
          requisicao_id,
          insumo_nome:     it.insumo_nome,
          insumo_id:       it.insumo_id   || null,
          qty:             qtyFinal,
          plataforma:      it.plataforma,
          produto_nome:    it.produto_nome || null,
          preco_unit:      it.preco_unit  ?? null,
          preco_total:     it.preco_unit != null ? it.preco_unit * qtyFinal : null,
          match_pct:       it.match_pct   ?? null,
          url_produto:     it.url_produto || null,
          url_carrinho:    it.url_carrinho|| null,
          encaminhado_por: gerente.nome,
          escola_id: (gerente as any).escola_id,
          aprovado_financeiro: true,  // fluxo de turma: requisição já passou pela aprovação do orçamento
          _skip: qtyFinal <= 0,
        }
      }).filter((r: any) => !r._skip).map(({ _skip, ...rest }: any) => rest)

      const skipped = (itens as any[]).length - rows.length
      if (rows.length === 0) {
        return json({ ok: true, encaminhados: 0, atendidos_estoque: skipped })
      }
      const { error } = await sb.from('alm_compras').insert(rows)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, encaminhados: rows.length, atendidos_estoque: skipped })
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

    // Helper: compila as compras agrupadas. Reusado nos endpoints
    // alm_compras_compilado, _pdf e _xlsx.
    const compilarCompras = async (statusFiltro: string) => {
      const escolaId = (gerente as any).escola_id
      // Compilado é o fluxo de DISTRIBUIÇÃO POR TURMA — só faz sentido pra
      // origem=requisicao_turma. Manut/ad_hoc não tem turma destino e seria
      // agrupada com itens de turma, gerando entregas com requisicao_id null.
      let q = sb.from('alm_compras')
        .select('id, insumo_id, insumo_nome, qty, plataforma, produto_nome, preco_unit, match_pct, url_produto, url_carrinho, status, encaminhado_em, requisicao_id, alm_requisicoes(mes, professoras(nome), series(nome))')
        .eq('escola_id', escolaId)
        .eq('origem', 'requisicao_turma')
        .order('encaminhado_em', { ascending: false })
      if (statusFiltro !== 'todos') q = q.eq('status', statusFiltro)
      const { data: linhas } = await q
      const norm = (s: string) => (s || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
      type FilhaInfo = { compra_id: string; requisicao_id: string; turma: string; professora: string; qty: number; status: string };
      type Grupo = {
        chave: string; insumo_id: string | null; nome: string; qty_total: number;
        ids: string[]; filhas: FilhaInfo[];
        turmas: Set<string>; professoras: Set<string>; meses: Set<string>;
        precos: number[]; plataformas: Record<string, number>;
        produto_nome_sugestao: string | null; match_pct_max: number;
        url_produto: string | null; url_carrinho: string | null; statuses: Set<string>;
      }
      // Pre-fetch insumos catalogados pra ter qtd_por_embalagem ANTES do
      // loop. alm_compras.preco_unit é o preço da EMBALAGEM da plataforma
      // (resma de 50, caixa c/3, cento), NÃO da unidade de consumo. Precisa
      // dividir por qtd_por_embalagem antes de usar como preço/un.
      const idsCat = Array.from(new Set((linhas ?? []).map((l: any) => l.insumo_id).filter(Boolean)))
      const insumoMap: Record<string, any> = {}
      if (idsCat.length) {
        const { data: insumos } = await sb.from('alm_insumos')
          .select('id, referencia_url, referencia_nome, preco_referencia, preco, qtd_por_embalagem, unidade, unidade_compra')
          .in('id', idsCat as string[]).eq('escola_id', escolaId)
        for (const ins of (insumos ?? []) as any[]) insumoMap[ins.id] = ins
      }
      const grupos: Record<string, Grupo> = {}
      for (const l of (linhas ?? []) as any[]) {
        const chave = l.insumo_id ? `id:${l.insumo_id}` : `nome:${norm(l.insumo_nome)}`
        if (!grupos[chave]) {
          grupos[chave] = {
            chave, insumo_id: l.insumo_id, nome: l.insumo_nome,
            qty_total: 0, ids: [], filhas: [], turmas: new Set(), professoras: new Set(), meses: new Set(),
            precos: [], plataformas: {}, produto_nome_sugestao: null, match_pct_max: 0,
            url_produto: null, url_carrinho: null, statuses: new Set(),
          }
        }
        const g = grupos[chave]
        const qty = parseFloat(l.qty || 0)
        g.qty_total += qty
        g.ids.push(l.id)
        g.filhas.push({
          compra_id: l.id, requisicao_id: l.requisicao_id,
          turma: l.alm_requisicoes?.series?.nome || '—',
          professora: l.alm_requisicoes?.professoras?.nome || '—',
          qty, status: l.status,
        })
        g.statuses.add(l.status)
        if (l.alm_requisicoes?.series?.nome) g.turmas.add(l.alm_requisicoes.series.nome)
        if (l.alm_requisicoes?.professoras?.nome) g.professoras.add(l.alm_requisicoes.professoras.nome)
        if (l.alm_requisicoes?.mes) g.meses.add(l.alm_requisicoes.mes)
        // alm_compras.preco_unit vem de scraper Zoom/ML/Shopee. Quando
        // match_pct < 80% o produto retornado provavelmente não é o que a
        // professora pediu (ex: "maça" → kit aleatório R$818). Ignoramos
        // pra não inflar total — fallback usa preco_referencia/preco do
        // insumo no próximo passo.
        if (l.preco_unit != null && (l.match_pct ?? 0) >= 80) {
          const ins = l.insumo_id ? insumoMap[l.insumo_id] : null
          const qtdEmb = parseFloat(ins?.qtd_por_embalagem) || 1
          g.precos.push(parseFloat(l.preco_unit) / qtdEmb)
        }
        if (l.plataforma) g.plataformas[l.plataforma] = (g.plataformas[l.plataforma] || 0) + 1
        if ((l.match_pct ?? 0) > g.match_pct_max) {
          g.match_pct_max = l.match_pct ?? 0
          g.produto_nome_sugestao = l.produto_nome
          g.url_produto = l.url_produto
          g.url_carrinho = l.url_carrinho
        }
      }
      // preco_origem por grupo: 'scraper' (preco_unit pesquisado), 'referencia'
      // (manual), 'cadastro' (preco do insumo), 'nenhuma' (sem fonte). Quando
      // todos preços vieram de scraper com baixo match, marca low_confidence.
      const precoOrigemMap: Record<string, string> = {}
      for (const k of Object.keys(grupos)) {
        precoOrigemMap[k] = grupos[k].precos.length > 0 ? 'scraper' : 'nenhuma'
      }
      // Fallback via insumoMap. Lógica defensiva contra dados ruins:
      // muitos preco_referencia foram cadastrados como preço da EMBALAGEM
      // inteira (ex: Cartolina ref=R$226,55 com qemb=20 → na verdade ~R$11/un).
      // Se a referência é >= 5x maior que (preco/qtd_emb), suspeitamos
      // que é preço da embalagem por engano — preferimos o cadastro.
      for (const id of Object.keys(insumoMap)) {
        const ins = insumoMap[id]
        const g = Object.values(grupos).find(x => x.insumo_id === id)
        if (!g) continue
        if (!g.url_produto && ins.referencia_url) g.url_produto = ins.referencia_url
        if (!g.produto_nome_sugestao && ins.referencia_nome) g.produto_nome_sugestao = ins.referencia_nome
        if (g.precos.length === 0) {
          const qtdEmb = parseFloat(ins.qtd_por_embalagem) || 1
          const ref = ins.preco_referencia != null ? parseFloat(ins.preco_referencia) : null
          const precoCad = ins.preco != null ? parseFloat(ins.preco) / qtdEmb : null
          // Detecta referência suspeita: qemb > 1 e ref >= 5x preço/qemb
          // → ref é provavelmente da embalagem inteira, não da unidade.
          const refSuspeita = ref != null && precoCad != null && qtdEmb > 1 && ref >= precoCad * 5
          if (ref != null && !refSuspeita) {
            g.precos.push(ref)
            precoOrigemMap[g.chave] = 'referencia'
          } else if (precoCad != null) {
            g.precos.push(precoCad)
            precoOrigemMap[g.chave] = refSuspeita ? 'cadastro_ref_suspeita' : 'cadastro'
          } else if (ref != null) {
            // Sem preco/qemb pra comparar — confia na referência
            g.precos.push(ref)
            precoOrigemMap[g.chave] = 'referencia'
          }
        }
      }
      const out = Object.values(grupos).map(g => {
        const precoMedio = g.precos.length ? g.precos.reduce((s, p) => s + p, 0) / g.precos.length : null
        const plataformaMaisComum = Object.entries(g.plataformas).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
        const statusArr = Array.from(g.statuses)
        const statusGrupo = statusArr.length === 1 ? statusArr[0] : 'misto'
        // Sanity check: se o preço unitário > R$ 50 e o item não está catalogado,
        // muito provavelmente é uma sugestão errada do scraper. Marca como
        // baixa confiança pra UI sinalizar e zerar do total estimado.
        const baixaConfianca = (precoMedio != null && precoMedio > 50 && !g.insumo_id) ||
                                precoOrigemMap[g.chave] === 'nenhuma'
        return {
          chave: g.chave, insumo_id: g.insumo_id, nome: g.nome, qty_total: g.qty_total,
          n_requisicoes: g.ids.length, ids: g.ids, filhas: g.filhas, status_grupo: statusGrupo,
          turmas: Array.from(g.turmas).sort(),
          professoras: Array.from(g.professoras).sort(),
          meses: Array.from(g.meses).sort(),
          preco_unit_medio: baixaConfianca ? null : precoMedio,
          preco_total_estimado: (baixaConfianca || precoMedio == null) ? null : precoMedio * g.qty_total,
          preco_origem: precoOrigemMap[g.chave] || 'nenhuma',
          preco_baixa_confianca: baixaConfianca,
          plataforma_sugerida: plataformaMaisComum,
          produto_nome_sugestao: g.produto_nome_sugestao,
          match_pct_max: g.match_pct_max || null,
          url_produto: g.url_produto, url_carrinho: g.url_carrinho,
        }
      }).sort((a, b) => b.qty_total - a.qty_total)
      return {
        data: out,
        total_grupos: out.length,
        total_linhas: (linhas ?? []).length,
        valor_estimado: out.reduce((s, g) => s + (g.preco_total_estimado || 0), 0),
      }
    }

    if (action === 'alm_compras_compilado_pdf' || action === 'alm_compras_compilado_xlsx') {
      const statusFiltro: string = body.status_filtro || 'pendente'
      const r = await compilarCompras(statusFiltro)
      const grupos = r.data
      const fmt = (v: number) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      if (action === 'alm_compras_compilado_xlsx') {
        const headers = ['Item', 'Qty Total', 'Turmas', 'Detalhe por turma', 'Sugestão', 'Plataforma', 'Match%', 'Preço/un', 'Total estim.', 'Mês', 'Link']
        const rows = grupos.map(g => [
          g.nome,
          String(g.qty_total),
          g.turmas.join(', '),
          g.filhas.map((f: any) => `${f.turma}×${f.qty}`).join('; '),
          g.produto_nome_sugestao || '',
          g.plataforma_sugerida || '',
          g.match_pct_max ? String(g.match_pct_max) + '%' : '',
          g.preco_unit_medio != null ? fmt(g.preco_unit_medio) : '',
          g.preco_total_estimado != null ? fmt(g.preco_total_estimado) : '',
          g.meses.join(', '),
          g.url_carrinho || g.url_produto || '',
        ])
        // Linha de total
        rows.push(['TOTAL', String(grupos.reduce((s: number, g: any) => s + g.qty_total, 0)), '', '', '', '', '', '', fmt(r.valor_estimado), '', ''])
        const xlsx = generateXlsx(headers, rows)
        return xlsxResponse(xlsx, `compras-compilado-${statusFiltro}-${new Date().toISOString().slice(0,10)}.xlsx`)
      }
      // PDF: lista compacta com totalizador
      const sections: any[] = []
      sections.push({
        heading: `${grupos.length} item(ns) únicos · ${r.total_linhas} pedido(s) · ${fmt(r.valor_estimado)} estimado`,
        lines: [`Status: ${statusFiltro}  ·  Gerado em ${new Date().toLocaleString('pt-BR')}`, ''],
      })
      for (const g of grupos) {
        const linhas = [
          `Qty: ${g.qty_total}  ·  ${g.preco_unit_medio != null ? fmt(g.preco_unit_medio) + '/un · total ' + fmt(g.preco_total_estimado) : 'sem preço de referência'}`,
          `Turmas: ${(g as any).filhas.map((f: any) => `${f.turma}×${f.qty}`).join(', ')}`,
        ]
        if (g.produto_nome_sugestao) linhas.push(`Sugestão: ${g.produto_nome_sugestao}${g.match_pct_max ? ` (${g.match_pct_max}%)` : ''}`)
        if (g.plataforma_sugerida) linhas.push(`Plataforma: ${g.plataforma_sugerida}`)
        if (g.url_carrinho || g.url_produto) linhas.push(`Link: ${g.url_carrinho || g.url_produto}`)
        linhas.push('─────────────────────────────────────────────')
        sections.push({ heading: g.nome, lines: linhas })
      }
      const bytes = await generatePdf({
        title: 'Compras compiladas — Almoxarifado',
        subtitle: `Itens iguais agregados entre turmas. Status: ${statusFiltro}.`,
        sections,
      })
      return pdfResponse(bytes, `compras-compilado-${statusFiltro}-${new Date().toISOString().slice(0,10)}.pdf`)
    }

    if (action === 'alm_compras_compilado') {
      const r = await compilarCompras(body.status_filtro || 'pendente')
      return json(r)
    }

    // Lista insumos onde preco_referencia parece estar errado (provavelmente
    // foi cadastrado como preço da embalagem em vez de preço unitário).
    if (action === 'alm_insumos_referencia_suspeita') {
      const escolaId = (gerente as any).escola_id
      const { data } = await sb.from('alm_insumos')
        .select('id, nome, unidade, unidade_compra, preco, preco_referencia, qtd_por_embalagem, ativo')
        .eq('escola_id', escolaId).eq('ativo', true)
        .not('preco_referencia', 'is', null)
        .gt('qtd_por_embalagem', 1)
      const suspeitos = (data ?? []).filter((i: any) => {
        const ref = parseFloat(i.preco_referencia)
        const preco = parseFloat(i.preco || 0)
        const qemb = parseFloat(i.qtd_por_embalagem || 1)
        if (!preco || !qemb) return false
        const cadastro = preco / qemb
        return ref >= cadastro * 5
      }).map((i: any) => ({
        id: i.id, nome: i.nome, unidade: i.unidade, unidade_compra: i.unidade_compra,
        preco_atual: parseFloat(i.preco),
        qtd_por_embalagem: parseFloat(i.qtd_por_embalagem),
        preco_referencia_atual: parseFloat(i.preco_referencia),
        preco_referencia_sugerido: parseFloat(i.preco) / parseFloat(i.qtd_por_embalagem),
      }))
      return json({ data: suspeitos, total: suspeitos.length })
    }

    // Corrige em batch: zera preco_referencia em insumos onde está claramente
    // errado (>5x o preço/qtd_emb), forçando o sistema a usar preco/qtd_emb.
    // Idempotente. ids opcional pra corrigir só os escolhidos pelo gerente.
    if (action === 'alm_insumos_corrigir_referencia_suspeita') {
      const escolaId = (gerente as any).escola_id
      const idsAlvo: string[] | null = body.ids || null
      const { data } = await sb.from('alm_insumos')
        .select('id, preco, preco_referencia, qtd_por_embalagem')
        .eq('escola_id', escolaId).eq('ativo', true)
        .not('preco_referencia', 'is', null)
        .gt('qtd_por_embalagem', 1)
      const aCorrigir = (data ?? []).filter((i: any) => {
        if (idsAlvo && !idsAlvo.includes(i.id)) return false
        const ref = parseFloat(i.preco_referencia)
        const preco = parseFloat(i.preco || 0)
        const qemb = parseFloat(i.qtd_por_embalagem || 1)
        if (!preco || !qemb) return false
        return ref >= (preco / qemb) * 5
      }).map((i: any) => i.id)
      if (!aCorrigir.length) return json({ ok: true, corrigidos: 0 })
      const { error } = await sb.from('alm_insumos').update({
        preco_referencia: null,
        referencia_fonte: null,
      }).in('id', aCorrigir).eq('escola_id', escolaId)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, corrigidos: aCorrigir.length })
    }


    // Distribuir grupo recebido pelas turmas que pediram. Recebe array de
    // { compra_id, requisicao_id, insumo_id, qty_entregue }. Cria registros em
    // alm_entregas + marca alm_compras.status='entregue' nos compra_id afetados.
    // Excedente (qty_entregue > qty pedida) vai pro estoque do insumo se
    // catalogado.
    if (action === 'alm_distribuir_grupo') {
      const escolaId = (gerente as any).escola_id
      const distribuicao: any[] = body.distribuicao || []
      const compraIds: string[] = body.compra_ids || []
      const insumoIdGrupo: string | null = body.insumo_id || null
      const excedente: number = parseFloat(body.excedente_estoque || 0) || 0
      if (!distribuicao.length) return json({ error: 'Nenhuma turma para distribuir.' }, 400)

      const entregas = distribuicao
        .filter(d => parseFloat(d.qty_entregue) > 0)
        .map(d => ({
          requisicao_id: d.requisicao_id,
          insumo_id: d.insumo_id || insumoIdGrupo || null,
          qty_entregue: parseFloat(d.qty_entregue),
          entregue_por: gerente.nome,
          escola_id: escolaId,
          fonte: 'compra',
        }))
      if (entregas.length) {
        const { error: errEnt } = await sb.from('alm_entregas').insert(entregas)
        if (errEnt) return json({ error: 'Falha ao registrar entrega: ' + errEnt.message }, 400)
      }

      // Atualiza alm_compras → status entregue (todas linhas do grupo)
      if (compraIds.length) {
        await sb.from('alm_compras').update({
          status: 'entregue',
          entregue_em: new Date().toISOString(),
          entregue_por: gerente.nome,
        }).in('id', compraIds).eq('escola_id', escolaId)
      }

      // Excedente entra no estoque (se item catalogado)
      if (excedente > 0 && insumoIdGrupo) {
        const { data: ins } = await sb.from('alm_insumos')
          .select('estoque_qty').eq('id', insumoIdGrupo).eq('escola_id', escolaId).maybeSingle()
        if (ins) {
          const antes = Number((ins as any).estoque_qty || 0)
          const depois = antes + excedente
          await sb.from('alm_insumos').update({ estoque_qty: depois })
            .eq('id', insumoIdGrupo).eq('escola_id', escolaId)
          await sb.from('alm_movimentacoes').insert({
            escola_id: escolaId, insumo_id: insumoIdGrupo,
            tipo: 'entrada', qty: excedente,
            motivo: 'Excedente da compra distribuída',
            saldo_antes: antes, saldo_depois: depois,
          })
        }
      }

      return json({ ok: true, entregas_criadas: entregas.length, excedente_para_estoque: excedente })
    }

    if (action === 'alm_compras_todas') {
      const status: string = body.status || ''
      const origem: string = body.origem || ''
      let q = sb.from('alm_compras')
        .select('*, alm_requisicoes(mes, professoras(nome), series(nome))')
        .eq('escola_id', (gerente as any).escola_id)
        .order('encaminhado_em', { ascending: false })
        .limit(200)
      if (status) q = q.eq('status', status)
      if (origem) q = q.eq('origem', origem)
      const { data } = await q
      // Anexa contexto da manutenção para linhas com origem='manutencao' (batch)
      const rows = (data ?? []) as any[]
      const manutIds = Array.from(new Set(rows.filter(r => r.origem === 'manutencao' && r.origem_id).map(r => r.origem_id))) as string[]
      if (manutIds.length) {
        const { data: manuts } = await sb.from('manutencoes')
          .select('id, descricao, localizacao, urgencia, status, equipe_responsavel')
          .eq('escola_id', (gerente as any).escola_id).in('id', manutIds)
        const idx: Record<string, any> = {}
        for (const m of (manuts ?? []) as any[]) idx[m.id] = m
        for (const r of rows) if (r.origem === 'manutencao' && r.origem_id) r.manutencao = idx[r.origem_id] || null
      }
      return json({ data: rows })
    }

    // Aprovação financeira (compras acima do teto). Quem aprova: papel
    // financeiro, diretor ou gerente. Almoxarifado NÃO aprova financeiro.
    if (action === 'alm_compra_aprovar_financeiro') {
      const { ids, decisao } = body as { ids: string[]; decisao: 'aprovar' | 'rejeitar' }
      if (!ids?.length) return json({ error: 'IDs não informados.' }, 400)
      const papeis: string[] = ((gerente as any).papeis as string[]) || []
      const podeAprovar = papeis.includes('gerente') || papeis.includes('diretor') || papeis.includes('financeiro')
      if (!podeAprovar) return json({ error: 'Apenas gerente, diretor ou financeiro podem aprovar compras.' }, 403)
      const aprov = decisao !== 'rejeitar'
      const { data: updated, error } = await sb.from('alm_compras').update({
        aprovado_financeiro: aprov,
        aprovado_financeiro_em: new Date().toISOString(),
        aprovado_financeiro_por: (gerente as any).nome || null,
      }).in('id', ids).eq('escola_id', (gerente as any).escola_id).select('id')
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, atualizados: updated?.length ?? 0, decisao: aprov ? 'aprovado' : 'rejeitado' })
    }

    if (action === 'alm_marcar_comprado') {
      const { ids } = body   // array of alm_compras IDs
      if (!ids?.length) return json({ error: 'IDs não informados.' }, 400)
      // Gate financeiro: bloqueia se algum item ainda precisa de aprovação
      const { data: pendAprov } = await sb.from('alm_compras')
        .select('id, insumo_nome')
        .in('id', ids).eq('escola_id', (gerente as any).escola_id)
        .is('aprovado_financeiro', null)
      if (pendAprov?.length) {
        const nomes = (pendAprov as any[]).map(r => r.insumo_nome).slice(0, 3).join(', ')
        return json({ error: `Aguardando aprovação financeira: ${nomes}${pendAprov.length > 3 ? ` (+${pendAprov.length - 3})` : ''}.` }, 400)
      }
      const { data: rejeitados } = await sb.from('alm_compras')
        .select('id, insumo_nome')
        .in('id', ids).eq('escola_id', (gerente as any).escola_id)
        .eq('aprovado_financeiro', false)
      if (rejeitados?.length) {
        const nomes = (rejeitados as any[]).map(r => r.insumo_nome).slice(0, 3).join(', ')
        return json({ error: `Compra rejeitada pelo financeiro: ${nomes}. Cancele ou solicite revisão.` }, 400)
      }
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
      const escolaId = (gerente as any).escola_id
      // Captura origem antes de cancelar pra saber se precisa recalcar manutencoes.precisa_material
      const { data: compra } = await sb.from('alm_compras')
        .select('origem, origem_id').eq('id', id).eq('escola_id', escolaId).maybeSingle()
      const { error } = await sb.from('alm_compras')
        .update({ status: 'cancelado' }).eq('id', id).eq('escola_id', escolaId)
      if (error) return json({ error: error.message }, 400)
      // Se era da manutenção e não sobrou nenhuma compra ativa, zera flag precisa_material
      if (compra?.origem === 'manutencao' && compra.origem_id) {
        const { count } = await sb.from('alm_compras')
          .select('id', { count: 'exact', head: true })
          .eq('escola_id', escolaId).eq('origem', 'manutencao').eq('origem_id', compra.origem_id)
          .not('status', 'in', '(cancelado)')
        if (!count) {
          await sb.from('manutencoes').update({ precisa_material: false })
            .eq('id', compra.origem_id).eq('escola_id', escolaId)
        }
      }
      return json({ ok: true })
    }
  }

  return null
}
