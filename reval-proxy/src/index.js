// reval-proxy: contorna o anti-bot do reval.net.
// O servidor reage inconsistentemente: às vezes entrega HTML "completo" (~780KB
// com <input hddB1Prv1>), às vezes "vazio" (~434KB). Análise:
// - URLs `?busca=X` ou `?q=X&pagina=1` são mais consistentes que `?q=X` puro
// - Sessão ASP.NET prévia (cookie de uma visita à home) parece ajudar
// - Headers completos de browser (Sec-Fetch-*, Sec-Ch-Ua) também
// Estratégia: aquecimento → tentar 3 variantes de URL → considerar sucesso
// se qualquer uma retornar HTML com produtos.
//
// Endpoint: GET /produtos?q=<query> (com header x-secret)
// Resposta: { ok, status, len, attempts, hasItems, html, variant }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

const BROWSER_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  // 'Accept-Encoding' omitido propositalmente: quando declarado, o origin
  // pode responder gzipped e res.text() no Worker às vezes não descomprime.
  'User-Agent': UA,
  'Cache-Control': 'no-cache',
  'Sec-Ch-Ua': '"Chromium";v="123", "Not(A:Brand";v="8"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
}

async function getSessionCookies() {
  try {
    const res = await fetch('https://www.reval.net/', {
      headers: BROWSER_HEADERS,
      cf: { cacheTtl: 0, cacheEverything: false },
    })
    const sc = res.headers.get('set-cookie') || ''
    // ASP.NET_SessionId=ABC; path=/; HttpOnly, __AntiXsrfToken=DEF; ...
    const cookies = []
    for (const m of sc.matchAll(/(ASP\.NET_SessionId|__AntiXsrfToken)=([^;]+)/g)) {
      cookies.push(`${m[1]}=${m[2]}`)
    }
    return cookies.join('; ')
  } catch { return '' }
}

async function fetchVariant(url, cookieHeader) {
  const headers = { ...BROWSER_HEADERS, 'Referer': 'https://www.reval.net/' }
  if (cookieHeader) headers['Cookie'] = cookieHeader
  const res = await fetch(url, { headers, cf: { cacheTtl: 0, cacheEverything: false } })
  const html = res.ok ? await res.text() : ''
  return { res, html, hasItems: html.includes('hddB1Prv1') }
}

async function fetchReval(query) {
  const enc = encodeURIComponent(query)
  const cookie = await getSessionCookies()
  // Variantes que mantêm o filtro de busca. NÃO usar ?busca=X — retorna o
  // catálogo inteiro (~2MB) ignorando a query, contaminando os resultados.
  const variants = [
    `https://www.reval.net/produtos?q=${enc}`,
    `https://www.reval.net/produtos?q=${enc}&pagina=1`,
  ]
  let attempts = 0
  for (const url of variants) {
    attempts++
    const r = await fetchVariant(url, cookie)
    // Heurística: HTML > 1.4MB é catálogo bruto, descartar mesmo se hasItems.
    if (r.hasItems && r.html.length < 1_400_000) {
      return { res: r.res, html: r.html, attempts, variant: url }
    }
    await new Promise(res => setTimeout(res, 200))
  }
  // Retentativa de cada variante com cookies frescos
  for (const url of variants) {
    attempts++
    const fresh = await getSessionCookies()
    const r = await fetchVariant(url, fresh)
    if (r.hasItems && r.html.length < 1_400_000) {
      return { res: r.res, html: r.html, attempts, variant: url + ' (retry)' }
    }
    await new Promise(res => setTimeout(res, 300))
  }
  // Falhou: retornar último response (vazio) pra cliente decidir
  attempts++
  const last = await fetchVariant(variants[0], '')
  return { res: last.res, html: last.html, attempts, variant: variants[0] + ' (final)' }
}

// Cache key normalization: lower + collapse spaces — pra "Cola Bastao"
// e "cola  bastao" baterem na mesma entrada.
function cacheKey(q) {
  return 'reval:' + q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
}

const CACHE_TTL_OK = 86400      // 24h quando obteve produtos
const CACHE_TTL_NEG = 600       // 10min quando vier vazio (evita martelar Reval enquanto rate-limited)

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url)
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, worker: 'reval-proxy', kv: !!env.REVAL_CACHE }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const secret = req.headers.get('x-secret') || ''
    if (!env.REVAL_PROXY_SECRET || secret !== env.REVAL_PROXY_SECRET) {
      return new Response('unauthorized', { status: 401 })
    }

    // Endpoint de pré-aquecimento: recebe { queries: [string] } e processa
    // sequencialmente com delay aleatório pra não estressar o anti-bot do Reval.
    // Ignora queries já cacheadas com sucesso há < 12h. Limita a 3 itens por
    // request pra caber no timeout de 30s do Worker (3 × ~8s = 24s).
    if (url.pathname === '/warmup' && req.method === 'POST') {
      let body
      try { body = await req.json() } catch { return new Response('invalid json', { status: 400 }) }
      const queries = Array.isArray(body?.queries) ? body.queries.slice(0, 2) : []
      const results = []
      for (const q of queries) {
        if (!q || typeof q !== 'string') continue
        const key = cacheKey(q)
        const existing = env.REVAL_CACHE ? await env.REVAL_CACHE.get(key, { type: 'json' }) : null
        if (existing && existing.hasItems && (Date.now() - existing.cachedAt) < (CACHE_TTL_OK / 2) * 1000) {
          results.push({ q, skipped: true, reason: 'fresh_cache', age_s: Math.round((Date.now() - existing.cachedAt) / 1000) })
          continue
        }
        const { res, html, attempts, variant } = await fetchReval(q)
        const hasItems = html.includes('hddB1Prv1') && html.length < 1_400_000
        const payload = {
          ok: res.ok, status: res.status, len: html.length, attempts, hasItems, variant,
          html: hasItems ? html : '', cachedAt: Date.now(),
        }
        if (env.REVAL_CACHE) {
          const ttl = hasItems ? CACHE_TTL_OK : CACHE_TTL_NEG
          await env.REVAL_CACHE.put(key, JSON.stringify(payload), { expirationTtl: ttl })
        }
        results.push({ q, hasItems, attempts, len: html.length })
        // Delay aleatório 5-9s entre buscas pra simular comportamento humano
        if (queries.indexOf(q) < queries.length - 1) {
          await new Promise(r => setTimeout(r, 5000 + Math.random() * 4000))
        }
      }
      const ok = results.filter(r => r.hasItems).length
      return new Response(JSON.stringify({ ok: true, count: results.length, hits: ok, results }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname !== '/produtos') {
      return new Response('not found', { status: 404 })
    }
    const q = (url.searchParams.get('q') || '').trim()
    if (!q) return new Response(JSON.stringify({ error: 'q ausente' }), { status: 400, headers: { 'Content-Type': 'application/json' } })

    const key = cacheKey(q)
    const force = url.searchParams.get('force') === '1' // ?force=1 invalida

    // 1. Tentar cache primeiro
    if (env.REVAL_CACHE && !force) {
      const cached = await env.REVAL_CACHE.get(key, { type: 'json' })
      if (cached && cached.html && cached.hasItems) {
        return new Response(JSON.stringify({ ...cached, fromCache: true, age: Math.round((Date.now() - cached.cachedAt) / 1000) }), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
        })
      }
      // Cache negativo: se há entrada com hasItems=false mais recente que CACHE_TTL_NEG, retornar
      if (cached && !cached.hasItems && (Date.now() - cached.cachedAt) < CACHE_TTL_NEG * 1000) {
        return new Response(JSON.stringify({ ...cached, fromCache: true, neg: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // 2. Cache miss → buscar
    const { res, html, attempts, variant } = await fetchReval(q)
    const hasItems = html.includes('hddB1Prv1') && html.length < 1_400_000

    const payload = {
      ok: res.ok,
      status: res.status,
      len: html.length,
      attempts,
      hasItems,
      variant,
      html: hasItems ? html : '', // não armazena HTML inválido pra economizar espaço
      cachedAt: Date.now(),
    }

    // 3. Salvar no cache (positivo 24h, negativo 10min)
    // ctx.waitUntil garante que o put complete mesmo após retornarmos response.
    if (env.REVAL_CACHE) {
      const ttl = hasItems ? CACHE_TTL_OK : CACHE_TTL_NEG
      ctx.waitUntil(env.REVAL_CACHE.put(key, JSON.stringify(payload), { expirationTtl: ttl }).catch(() => {}))
    }

    const responseHeaders = { 'Content-Type': 'application/json' }
    if (hasItems) responseHeaders['Cache-Control'] = 'public, max-age=1800'

    return new Response(JSON.stringify({ ...payload, html, fromCache: false }), { headers: responseHeaders })
  },
}
