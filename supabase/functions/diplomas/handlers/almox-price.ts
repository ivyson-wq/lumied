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
  // ━━ ALMOXARIFADO: PRICE SEARCH (public, no auth required) ━━━━━━

  // Aquecimento do cache do Reval: itera por insumos do catálogo e dispara
  // pré-busca via worker. Chamado por pg_cron 1×/h. Autenticado via
  // CRON_INTERNAL_KEY ou staff. Processa 3 itens por chamada (limite do
  // worker) → ~72 itens/dia, suficiente pro catálogo escolar típico.
  if (action === 'alm_reval_warmup') {
    const cronKey = Deno.env.get('CRON_INTERNAL_KEY') || ''
    const authH = req.headers.get('Authorization')?.replace('Bearer ', '') || ''
    if (!cronKey || authH !== cronKey) return json({ error: 'forbidden' }, 403)
    const proxyUrl = Deno.env.get('REVAL_PROXY_URL') || ''
    const proxySecret = Deno.env.get('REVAL_PROXY_SECRET') || ''
    if (!proxyUrl || !proxySecret) return json({ error: 'REVAL_PROXY_* não configurados' }, 500)
    // Pega 3 insumos ativos cujo preço esteja desatualizado há mais tempo
    // (preco_atualizado_em ASC; nulls primeiro). Cada execução do cron
    // avança naturalmente porque preco_atualizado_em é atualizado via
    // outras flows; pra warmup força atualização do timestamp aqui.
    const { data: insumos } = await sb.from('alm_insumos')
      .select('id, nome, descricao, escola_id, preco_atualizado_em')
      .eq('ativo', true)
      .order('preco_atualizado_em', { ascending: true, nullsFirst: true })
      .limit(2)
    if (!insumos?.length) return json({ ok: true, count: 0, msg: 'Nenhum insumo ativo' })
    const queries = insumos.map((i: any) => (i.descricao ? `${i.nome.trim()} ${i.descricao.trim()}` : i.nome.trim()))
    try {
      const r = await fetch(`${proxyUrl.replace(/\/$/, '')}/warmup`, {
        method: 'POST',
        headers: { 'x-secret': proxySecret, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries }),
        signal: AbortSignal.timeout(30000),
      })
      if (!r.ok) return json({ error: `worker HTTP ${r.status}` }, 502)
      const data = await r.json()
      // Avança round-robin — bate timestamp em todos os 3 processados
      for (const ins of insumos) {
        await sb.from('alm_insumos').update({ preco_atualizado_em: new Date().toISOString() }).eq('id', ins.id)
      }
      return json({ ok: true, ...data })
    } catch (e) {
      return json({ error: (e as Error).message }, 500)
    }
  }

  if (action === 'alm_buscar_precos') {
    const { nome, unidade, descricao } = body as any
    if (!nome) return json({ error: 'Nome do item não informado.' }, 400)

    // Inclui descricao (especificação) na busca para encontrar produto correto (ex: "250ml")
    const query = descricao ? `${nome.trim()} ${descricao.trim()}` : nome.trim()
    const encoded = encodeURIComponent(query)

    // ── helper: word-overlap match % ────────────────────────
    function matchPct(qry: string, title: string): number {
      const norm = (s: string) =>
        s.toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)
      const qWords = norm(qry)
      if (!qWords.length) return 0
      const tSet = new Set(norm(title))
      return Math.round((qWords.filter(w => tSet.has(w)).length / qWords.length) * 100)
    }

    type PriceResult = {
      plataforma: string
      nome: string
      preco: number | null
      preco_fmt: string
      url_produto: string
      url_carrinho: string | null   // pre-filled cart link where available
      item_id: string | null        // platform product ID (ML: "MLB...", Shopee: shopid/itemid)
      match: number
      tipo: 'produto' | 'busca'
      frete_gratis?: boolean
      full?: boolean
      condicao?: 'novo' | 'usado' | null
      qty_pacote?: number | null
      unidade_pacote?: string | null
      preco_unit_norm?: number | null
      preco_unit_norm_fmt?: string | null
      pack_mult?: number             // multiplicador (Kit 4 / 3x / Pack 10)
      pack_label?: string | null     // ex: "Kit 4" — pra exibir badge
      qty_total?: number | null      // pack_mult × qty_pacote (total efetivo)
    }
    const results: PriceResult[] = []
    const fontes: Record<string, { status: string; produtos: number; erro?: string }> = {}

    function parsePackQty(title: string): { qty: number; unidade: string } | null {
      const t = (title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      // "folhas" antes de "g" porque "75g 500 folhas" deve normalizar por folha.
      // "c/X un" antes de "X un" — segundo casaria "Kit 4" como 4 unidades.
      const patterns: Array<{ rx: RegExp; un: string; mul?: number }> = [
        { rx: /(\d+)\s*(?:folhas?|fls?|fl)\b/, un: 'fl' },
        { rx: /(?:c\/|com|contendo|pacote\s*c\/|pct\s*c\/|caixa\s*c\/|cx\s*c\/)\s*(\d+)\s*(?:un|unid|unidades?|pe[çc]as?|pcs?)?\b/, un: 'un' },
        { rx: /(\d+(?:[.,]\d+)?)\s*(?:litros?|lt|l)\b/, un: 'ml', mul: 1000 },
        { rx: /(\d+(?:[.,]\d+)?)\s*(?:ml|mililitros?)\b/, un: 'ml' },
        { rx: /(\d+(?:[.,]\d+)?)\s*(?:kg|kilos?|quilos?)\b/, un: 'g', mul: 1000 },
        { rx: /(\d+(?:[.,]\d+)?)\s*(?:gr|gramas?|g)\b/, un: 'g' },
        { rx: /(\d+)\s*(?:un|unid|unidades?|pe[çc]as?|pcs?)\b/, un: 'un' },
      ]
      for (const p of patterns) {
        const m = p.rx.exec(t)
        if (m) {
          const qty = parseFloat(m[1].replace(',', '.'))
          if (qty > 0 && qty < 100000) return { qty: qty * (p.mul || 1), unidade: p.un }
        }
      }
      return null
    }

    // Detecta multiplicador de pacote no título: "Kit 4 ...", "3x ...", "Pack 10 ...",
    // "Combo 5 ...", "4 unidades de ..." (formato kit, não conteúdo). Captura no
    // INÍCIO do título, antes de qualquer "Resma 500fls" — pra distinguir
    // multiplicador de embalagem (Kit 4) do conteúdo (500 folhas).
    function parsePackMultiplier(title: string): { mult: number; label: string } | null {
      const t = (title || '').trim()
      // Padrões só no começo do título (até ~30 chars iniciais)
      const head = t.slice(0, 60).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      const patterns: Array<{ rx: RegExp; lbl: (n: number) => string }> = [
        { rx: /^(?:kit|combo|conjunto|conj|jogo)\s+(\d+)\b/i, lbl: n => `Kit ${n}` },
        { rx: /^(?:pack|pacote)\s+(\d+)\b/i, lbl: n => `Pack ${n}` },
        { rx: /^(\d+)\s*x\s+(?!\d)/i, lbl: n => `${n}x` },     // "3x ..." (não "3x500ml")
        { rx: /^(\d+)\s+unidades?\b/i, lbl: n => `${n} un` },  // "4 unidades"
      ]
      for (const p of patterns) {
        const m = p.rx.exec(head)
        if (m) {
          const n = parseInt(m[1], 10)
          if (n >= 2 && n <= 100) return { mult: n, label: p.lbl(n) }
        }
      }
      return null
    }

    function fmtUnitPrice(n: number, un: string): string {
      const v = n.toLocaleString('pt-BR', { minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: 4 })
      return `R$ ${v}/${un}`
    }

    // ── 0. Zoom.com.br (comparador de preços — scraping) ─────
    try {
      const zoomRes = await fetch(
        `https://www.zoom.com.br/search?q=${encoded}`,
        { headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
      )
      if (zoomRes.ok) {
        const html = await zoomRes.text()
        // Extract product cards via regex
        const cardRegex = /data-testid="product-card"[\s\S]*?<\/a>/g
        const titleRegex = /class="[^"]*ProductCard_ProductCard_Name[^"]*"[^>]*>([^<]+)/
        const priceRegex = /R\$\s*([\d]+[.,][\d]{2})/
        const hrefRegex = /href="(\/[^"]+)"/
        let cm
        let zoomCount = 0
        while ((cm = cardRegex.exec(html)) !== null && zoomCount < 5) {
          const block = cm[0]
          const tMatch = titleRegex.exec(block)
          const pMatch = priceRegex.exec(block)
          const hMatch = hrefRegex.exec(block)
          if (tMatch && pMatch) {
            const nome = tMatch[1].trim()
            const preco = parseFloat(pMatch[1].replace('.','').replace(',','.'))
            const m = matchPct(query, nome)
            results.push({
              plataforma: 'Zoom',
              nome,
              preco: isNaN(preco) ? null : preco,
              preco_fmt: !isNaN(preco) ? `R$ ${preco.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—',
              url_produto: hMatch ? `https://www.zoom.com.br${hMatch[1]}` : `https://www.zoom.com.br/search?q=${encoded}`,
              url_carrinho: null,
              item_id: null,
              match: m,
              tipo: 'produto',
            })
            zoomCount++
          }
        }
        // Fallback: parse simple price pattern if product cards not found
        if (zoomCount === 0) {
          const simplePrices = html.match(/R\$\s*([\d]+[.,][\d]{2})/g)
          if (simplePrices?.length) {
            const p = parseFloat(simplePrices[0].replace('R$','').trim().replace('.','').replace(',','.'))
            if (!isNaN(p) && p > 0) {
              results.push({
                plataforma: 'Zoom', nome: `${query} (melhor preço Zoom)`, preco: p,
                preco_fmt: `R$ ${p.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                url_produto: `https://www.zoom.com.br/search?q=${encoded}`,
                url_carrinho: null, item_id: null, match: 70, tipo: 'produto',
              })
            }
          }
        }
        fontes['Zoom'] = { status: 'ok', produtos: results.filter(r => r.plataforma === 'Zoom' && r.tipo === 'produto').length }
      } else {
        fontes['Zoom'] = { status: 'bloqueado', produtos: 0, erro: `HTTP ${zoomRes.status}` }
      }
    } catch (e) { fontes['Zoom'] = { status: 'erro', produtos: 0, erro: (e as Error).message?.substring(0, 50) } }

    if (!results.some(r => r.plataforma === 'Zoom' && r.tipo === 'produto')) {
      if (!fontes['Zoom']) fontes['Zoom'] = { status: 'sem resultados', produtos: 0 }
      results.push({ plataforma: 'Zoom', nome: `Buscar "${query}" no Zoom`, preco: null, preco_fmt: 'Ver no Zoom', url_produto: `https://www.zoom.com.br/search?q=${encoded}`, url_carrinho: null, item_id: null, match: 0, tipo: 'busca' })
    }

    // ── 1. Mercado Livre — endpoint público de anúncios, ordenado por preço ─
    // Antes usávamos /products/search + /products/{id}/items?limit=1, que retorna o
    // "vencedor da BuyBox" (reputação + frete + envio rápido), NÃO o mais barato.
    // Trocamos para /sites/MLB/search?sort=price_asc — mesmo endpoint que ordena
    // a busca pública na web por menor preço. Filtra `condition=new` para evitar
    // usados misturados; mantemos a flag `condicao` no resultado caso queiram exibir.
    // /sites/MLB/search foi restringido a apps parceiras em 2026 (retorna 403
    // mesmo com OAuth). Usamos /products/search (catálogo canônico) +
    // /products/{id}/items?limit=8 — pega vários anúncios por produto e
    // mescla. Antes pegávamos limit=1 (BuyBox winner, raramente o mais
    // barato); agora coletamos até 8 por produto canônico e 3 produtos.
    try {
      const mlToken = await getMLToken(sb)
      if (!mlToken) {
        fontes['Mercado Livre'] = { status: 'sem token', produtos: 0, erro: 'OAuth ML não conectado' }
      } else {
        const mlHeaders: Record<string, string> = {
          'Accept': 'application/json',
          'Authorization': `Bearer ${mlToken}`,
        }
        const mlSearchRes = await fetch(
          `https://api.mercadolibre.com/products/search?status=active&site_id=MLB&q=${encoded}&limit=8`,
          { headers: mlHeaders }
        )
        let mlCount = 0
        if (mlSearchRes.ok) {
          const mlSearchData = await mlSearchRes.json()
          const products = mlSearchData.results ?? []

          for (const prod of products.slice(0, 6)) {
            try {
              const itemsRes = await fetch(
                `https://api.mercadolibre.com/products/${prod.id}/items?limit=8`,
                { headers: mlHeaders }
              )
              if (!itemsRes.ok) continue // 404 "No winners found" é comum, ignora
              const itemsData = await itemsRes.json()
              // /products/{id}/items retorna campos parciais — geralmente só
              // item_id + price + algumas flags. title/permalink vêm como
              // string vazia. Usamos `||` (não `??`) pra tratar vazio como
              // ausente, e construímos a URL no formato oficial MLB-{num}.
              // Endpoints /items e /items?ids= estão 403 (restritos a apps
              // parceiras desde 2026), então não dá pra hidratar mais.
              for (const it of (itemsData.results ?? [])) {
                if (!(it.price > 0)) continue
                if (it.condition && it.condition !== 'new') continue
                const title = (it.title || prod.name || '').trim()
                if (!title) continue
                const m = matchPct(query, title)
                const mlId: string | null = it.item_id || it.id || null
                const numericId = mlId ? mlId.replace(/^MLB/, '') : null
                const freteGratis = it?.shipping?.free_shipping === true
                const isFull = it?.shipping?.logistic_type === 'fulfillment'
                const cond = it.condition === 'new' ? 'novo' : null
                const pack = parsePackQty(title)
                const mult = parsePackMultiplier(title)
                const packMult = mult?.mult || 1
                const qtyTotal = pack ? pack.qty * packMult : null
                let precoNorm: number | null = null
                let precoNormFmt: string | null = null
                if (qtyTotal && qtyTotal > 0) {
                  precoNorm = it.price / qtyTotal
                  precoNormFmt = fmtUnitPrice(precoNorm, pack!.unidade)
                }
                const itemUrl = (it.permalink && it.permalink.length > 0)
                  ? it.permalink
                  : (numericId ? `https://produto.mercadolivre.com.br/MLB-${numericId}` : `https://www.mercadolivre.com.br/p/${prod.id}`)
                results.push({
                  plataforma: 'Mercado Livre',
                  nome: title,
                  preco: it.price,
                  preco_fmt: `R$ ${parseFloat(it.price).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                  url_produto: itemUrl,
                  url_carrinho: null,
                  item_id: mlId,
                  match: m,
                  tipo: 'produto',
                  frete_gratis: freteGratis,
                  full: isFull,
                  condicao: cond,
                  qty_pacote: pack?.qty ?? null,
                  unidade_pacote: pack?.unidade ?? null,
                  preco_unit_norm: precoNorm,
                  preco_unit_norm_fmt: precoNormFmt,
                  pack_mult: packMult,
                  pack_label: mult?.label ?? null,
                  qty_total: qtyTotal,
                })
                mlCount++
              }
            } catch (e) { console.warn('[diplomas] ML product items skipped:', (e as Error).message) }
          }
          fontes['Mercado Livre'] = { status: mlCount > 0 ? 'ok' : 'sem resultados', produtos: mlCount }
        } else {
          fontes['Mercado Livre'] = { status: 'bloqueado', produtos: 0, erro: `HTTP ${mlSearchRes.status}` }
        }
      }
    } catch (e) { fontes['Mercado Livre'] = { status: 'erro', produtos: 0, erro: (e as Error).message?.substring(0, 50) } }

    if (!results.some(r => r.plataforma === 'Mercado Livre' && r.tipo === 'produto')) {
      results.push({
        plataforma: 'Mercado Livre',
        nome: `Buscar "${query}" no Mercado Livre`,
        preco: null, preco_fmt: 'Ver no ML',
        url_produto: `https://lista.mercadolivre.com.br/${query.replace(/\s+/g, '-')}`,
        url_carrinho: null, item_id: null, match: 0, tipo: 'busca',
      })
    }

    // ── 2. Shopee Brasil — best-effort. API interna v4 é não documentada e
    // bloqueia frequentemente (403). Mantemos com timeout curto pra não
    // travar a UI quando estiver fora; UI mostra link de busca como fallback.
    try {
      const shopeeRes = await fetch(
        `https://shopee.com.br/api/v4/search/search_items?keyword=${encoded}&limit=5&newest=0&by=price&order=asc&page_type=search&scenario=PAGE_GLOBAL_SEARCH`,
        {
          headers: {
            'Accept': 'application/json',
            'Referer': `https://shopee.com.br/search?keyword=${encoded}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'x-shopee-language': 'pt-BR',
            'x-requested-with': 'XMLHttpRequest',
            'x-api-source': 'pc',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
          },
          signal: AbortSignal.timeout(5000),
        }
      )
      if (shopeeRes.ok) {
        const shopeeData = await shopeeRes.json()
        const items: any[] = shopeeData?.items ?? shopeeData?.data?.items ?? []
        for (const raw of items.slice(0, 5)) {
          const it = raw.item_basic ?? raw
          const shopid = it.shopid ?? it.shop_id
          const itemid = it.itemid ?? it.item_id
          const rawPrice = it.price_min ?? it.price ?? null
          const preco = rawPrice != null ? rawPrice / 100000 : null
          const urlProd = shopid && itemid
            ? `https://shopee.com.br/product/${shopid}/${itemid}`
            : `https://shopee.com.br/search?keyword=${encoded}`
          // Shopee has no public add-to-cart URL — product page is the entry point
          const m = matchPct(query, it.name ?? '')
          results.push({
            plataforma: 'Shopee',
            nome: it.name ?? '',
            preco,
            preco_fmt: preco != null
              ? `R$ ${preco.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
              : '—',
            url_produto: urlProd,
            url_carrinho: null,
            item_id: shopid && itemid ? `${shopid}/${itemid}` : null,
            match: m,
            tipo: 'produto',
          })
        }
        fontes['Shopee'] = { status: 'ok', produtos: results.filter(r => r.plataforma === 'Shopee' && r.tipo === 'produto').length }
      } else {
        fontes['Shopee'] = { status: 'bloqueado', produtos: 0, erro: `HTTP ${shopeeRes.status}` }
      }
    } catch (e) { fontes['Shopee'] = { status: 'erro', produtos: 0, erro: (e as Error).message?.substring(0, 50) } }

    // Fallback Shopee: link de busca quando API bloquear
    if (!results.some(r => r.plataforma === 'Shopee' && r.tipo === 'produto')) {
      results.push({
        plataforma: 'Shopee',
        nome: `Buscar "${query}" na Shopee`,
        preco: null, preco_fmt: 'Ver na Shopee',
        url_produto: `https://shopee.com.br/search?keyword=${encoded}`,
        url_carrinho: null, item_id: null, match: 0, tipo: 'busca',
      })
    }

    // ── 3. Reval (atacado reval.net) — via Cloudflare Worker (reval-proxy).
    // O servidor Reval entrega HTML "vazio" (~434KB) pra IPs de DC; o worker
    // roda em PoP Cloudflare BR e recebe a versão completa (~780KB).
    // Estrutura Magento + ASP.NET: preço no <input ... hddB1Prv1 ... value="X,XX">,
    // qty da caixa em <span class="product-cod">CX.C/N</span>. Como é atacado,
    // o preço listado é da caixa — dividimos por N pra ter R$/un.
    const revalProxyUrl = Deno.env.get('REVAL_PROXY_URL') || ''
    const revalProxySecret = Deno.env.get('REVAL_PROXY_SECRET') || ''
    if (!revalProxyUrl || !revalProxySecret) {
      fontes['Reval'] = { status: 'apenas link', produtos: 0 }
    } else {
      try {
        const proxyRes = await fetch(
          `${revalProxyUrl.replace(/\/$/, '')}/produtos?q=${encoded}`,
          { headers: { 'x-secret': revalProxySecret }, signal: AbortSignal.timeout(10000) }
        )
        if (proxyRes.ok) {
          const proxyData = await proxyRes.json() as { ok: boolean; html: string; len: number; hasItems: boolean }
          const html = proxyData.html || ''
          const blocks = html.split('<li class="item">').slice(1)
          let revalCount = 0
          for (const blk of blocks) {
            if (revalCount >= 6) break
            const hrefM = /<a href="(\/produto\/[^"]+)"[^>]*title="([^"]+)"\s*class="product-image"/.exec(blk)
            const cxM = /<span class="product-cod">CX\.C\/(\d+)<\/span>/.exec(blk)
            const precoM = /hddB1Prv1[^"]*"\s+value="([\d.,]+)"/.exec(blk)
            const dispM = /hddB1Disponivel[^"]*"\s+value="(\d+)"/.exec(blk)
            if (!hrefM || !precoM) continue
            const precoCaixa = parseFloat(precoM[1].replace(/\./g, '').replace(',', '.'))
            if (!precoCaixa || precoCaixa <= 0) continue
            if (dispM && dispM[1] === '0') continue
            const cxQty = cxM ? parseInt(cxM[1], 10) : 1
            const precoUnit = cxQty > 1 ? precoCaixa / cxQty : precoCaixa
            const titleRaw = hrefM[2].replace(/^\d+-/, '').trim()
            const m = matchPct(query, titleRaw)
            const cxLabel = cxQty > 1 ? `Caixa c/${cxQty}` : null
            const pack = parsePackQty(titleRaw)
            let precoNorm: number | null = null
            let precoNormFmt: string | null = null
            if (pack && pack.qty > 0) {
              precoNorm = precoUnit / pack.qty
              precoNormFmt = fmtUnitPrice(precoNorm, pack.unidade)
            }
            results.push({
              plataforma: 'Reval',
              nome: titleRaw,
              preco: precoUnit,
              preco_fmt: `R$ ${precoUnit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
              url_produto: `https://www.reval.net${hrefM[1]}`,
              url_carrinho: null,
              item_id: null,
              match: m,
              tipo: 'produto',
              qty_pacote: pack?.qty ?? null,
              unidade_pacote: pack?.unidade ?? null,
              preco_unit_norm: precoNorm,
              preco_unit_norm_fmt: precoNormFmt,
              pack_mult: cxQty,
              pack_label: cxLabel,
              qty_total: pack ? pack.qty * cxQty : null,
            })
            revalCount++
          }
          fontes['Reval'] = { status: revalCount > 0 ? 'ok' : 'sem resultados', produtos: revalCount }
        } else {
          fontes['Reval'] = { status: 'bloqueado', produtos: 0, erro: `proxy HTTP ${proxyRes.status}` }
        }
      } catch (e) { fontes['Reval'] = { status: 'erro', produtos: 0, erro: (e as Error).message?.substring(0, 50) } }
    }
    if (!results.some(r => r.plataforma === 'Reval')) {
      results.push({
        plataforma: 'Reval',
        nome: `Buscar "${query}" na Reval`,
        preco: null, preco_fmt: 'Ver na Reval',
        url_produto: `https://www.reval.net/produtos?q=${encoded}`,
        url_carrinho: null, item_id: null, match: 0, tipo: 'busca',
      })
    }

    // ── 4. Amazon Brasil (no free API — search link only) ────
    results.push({
      plataforma: 'Amazon',
      nome: `Buscar "${query}" na Amazon Brasil`,
      preco: null,
      preco_fmt: 'Ver na Amazon',
      url_produto: `https://www.amazon.com.br/s?k=${encoded}`,
      url_carrinho: null,
      item_id: null,
      match: 0,
      tipo: 'busca',
    })

    // Sort: produtos com preço, mais barato primeiro. Quando há preço unitário
    // normalizado (R$/fl, R$/g, R$/ml, R$/un), agrupamos por unidade e ranqueamos
    // os com a unidade mais frequente pelo preço unitário (compara pacotes de
    // tamanhos diferentes). O resto cai pro sort por preço total.
    const produtosTodos = results.filter(r => r.tipo === 'produto' && r.preco != null)
    const unidadeFreq: Record<string, number> = {}
    for (const r of produtosTodos) {
      if (r.preco_unit_norm != null && r.unidade_pacote) {
        unidadeFreq[r.unidade_pacote] = (unidadeFreq[r.unidade_pacote] || 0) + 1
      }
    }
    const unidadeRef = Object.entries(unidadeFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || null
    const produtos = produtosTodos.sort((a, b) => {
      if (unidadeRef) {
        const aRef = a.unidade_pacote === unidadeRef && a.preco_unit_norm != null
        const bRef = b.unidade_pacote === unidadeRef && b.preco_unit_norm != null
        if (aRef && bRef) return (a.preco_unit_norm ?? 0) - (b.preco_unit_norm ?? 0)
        if (aRef) return -1
        if (bRef) return 1
      }
      return (a.preco ?? 0) - (b.preco ?? 0)
    })
    const semPreco = results.filter(r => r.tipo === 'produto' && r.preco == null)
    const links    = results.filter(r => r.tipo === 'busca')

    fontes['Amazon'] = { status: 'apenas link', produtos: 0 }

    return json({ data: [...produtos, ...semPreco, ...links], query, fontes, unidade_ref: unidadeRef })
  }

  // ── ATUALIZAÇÃO AUTOMÁTICA DE PREÇOS ────────────────────
  if (action === 'alm_atualizar_precos') {
    // Atualiza preços via Zoom.com.br (funciona server-side)
    const { data: insumos } = await sb.from('alm_insumos').select('id, nome, unidade, preco, descricao, referencia_fonte').eq('ativo', true)
    if (!insumos?.length) return json({ ok: true, atualizados: 0, pulados: 0 })
    // Pula insumos com preço atualizado manualmente pelo gerente
    const autoInsumos = insumos.filter((i: any) => i.referencia_fonte !== 'manual')
    const pulados = insumos.length - autoInsumos.length

    let atualizados = 0
    for (const insumo of autoInsumos) {
      try {
        const query = insumo.descricao ? `${insumo.nome.trim()} ${insumo.descricao.trim()}` : insumo.nome.trim()
        const encoded = encodeURIComponent(query)
        let melhorPreco: number | null = null

        // Zoom.com.br (comparador de preços — funciona server-side)
        try {
          const zRes = await fetch(`https://www.zoom.com.br/search?q=${encoded}`, {
            headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          })
          if (zRes.ok) {
            const html = await zRes.text()
            // Extract prices from Zoom HTML
            const prices = html.match(/R\$\s*([\d]+[.,][\d]{2})/g) || []
            for (const ps of prices.slice(0, 10)) {
              const p = parseFloat(ps.replace('R$','').trim().replace('.','').replace(',','.'))
              if (!isNaN(p) && p > 1 && p < 10000) {
                if (melhorPreco === null || p < melhorPreco) melhorPreco = p
              }
            }
          }
        } catch (e) { console.warn('[diplomas] Zoom price scrape failed:', (e as Error).message) }

        // ML (tentativa — pode falhar com 403)
        try {
          const mlRes = await fetch(`https://api.mercadolibre.com/sites/MLB/search?q=${encoded}&limit=3&sort=price_asc`, { headers: { 'Accept': 'application/json' } })
          if (mlRes.ok) {
            const mlData = await mlRes.json()
            for (const item of (mlData.results ?? []).slice(0, 3)) {
              const m = matchPct(query, item.title ?? '')
              if (m >= 70 && item.price != null) {
                if (melhorPreco === null || item.price < melhorPreco) melhorPreco = item.price
              }
            }
          }
        } catch (e) { console.warn('[diplomas] ML price scrape failed:', (e as Error).message) }

        if (melhorPreco !== null && melhorPreco > 0) {
          await sb.from('alm_insumos').update({ preco: melhorPreco }).eq('id', insumo.id)
          atualizados++
        }

        await new Promise(r => setTimeout(r, 300))
      } catch (e) { console.warn('[diplomas] Price update loop error for insumo:', (e as Error).message) }
    }

    return json({ ok: true, atualizados, total: insumos.length, pulados })
  }

  return null
}
