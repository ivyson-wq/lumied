// ═══════════════════════════════════════════════════════════════
//  Lumied — Help Drawer in-context (Sprint 8 LAP)
//
//  Botão `?` flutuante (canto inferior esquerdo) abre drawer lateral
//  com artigos de ajuda contextuais à tela atual. Reusa /ajuda/ existente.
//
//  Uso:
//    <script src="/lumied-help.js" defer></script>
//    <link rel="stylesheet" href="/lumied-help.css">
//
//  Detecção de contexto:
//   - Portal: pais / gerente / professora / secretaria / admin (via path)
//   - Módulo: detectado por hash (#financeiro, #manutencao) ou keyword no DOM
//
//  Fonte de conteúdo: fetch único de /ajuda/, parse em memória, cache em
//  sessionStorage.
// ═══════════════════════════════════════════════════════════════
(function() {
  if (typeof window === 'undefined') return;

  // Não rodar dentro da própria Central de Ajuda
  if (location.pathname.indexOf('/ajuda') === 0) return;

  // Não rodar em telas onde a aparição atrapalha (login standalone, etc.)
  // Limita aos portais autenticados
  var path = location.pathname.toLowerCase();
  var IS_PORTAL = /(?:gerente|secretaria|professora|familia|admin|aluno|area-restrita|index\.html|^\/$)/.test(path);
  if (!IS_PORTAL) return;

  var CACHE_KEY = 'lumied_help_cache_v1';
  var CACHE_TTL_MS = 30 * 60 * 1000; // 30min
  var WA_NUMBER = '5554997021634';

  function detectPortal() {
    if (path.indexOf('familia') >= 0 || path === '/' || path.indexOf('index.html') >= 0) return 'pais';
    if (path.indexOf('professora') >= 0) return 'professora';
    if (path.indexOf('secretaria') >= 0) return 'secretaria';
    if (path.indexOf('admin') >= 0) return 'admin';
    if (path.indexOf('aluno') >= 0) return 'aluno';
    if (path.indexOf('gerente') >= 0) return 'gerente';
    return 'gerente';
  }

  function detectModulo() {
    var h = (location.hash || '').toLowerCase();
    var m = h.match(/^#(\w+)/);
    if (m) return m[1];
    // Fallback: olhar para classes/IDs ativos no DOM
    var active = document.querySelector('.menu-item.active, .nav-item.active, [data-active="true"]');
    if (active) {
      var oc = active.getAttribute('onclick') || '';
      var mm = oc.match(/show(?:Panel|Tab)\(['"](\w+)['"]/);
      if (mm) return mm[1].toLowerCase();
    }
    return null;
  }

  function getCached() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
      return parsed.articles;
    } catch (e) { return null; }
  }
  function setCached(articles) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), articles: articles })); } catch (e) {}
  }

  function loadArticles() {
    var cached = getCached();
    if (cached) return Promise.resolve(cached);
    return fetch('/ajuda/')
      .then(function(r) { return r.ok ? r.text() : ''; })
      .then(function(html) {
        if (!html) return [];
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var nodes = doc.querySelectorAll('article.help-article');
        var arr = [];
        nodes.forEach(function(n) {
          var id = n.id || '';
          // Tenta extrair título de h1/h2/h3 dentro do article
          var titleEl = n.querySelector('h1, h2, h3');
          var title = titleEl ? titleEl.textContent.trim() : id;
          // Snippet = 1º parágrafo
          var pEl = n.querySelector('p');
          var snippet = pEl ? pEl.textContent.trim().slice(0, 140) : '';
          arr.push({
            id: id,
            title: title,
            snippet: snippet,
            portal: n.dataset.portal || '',
            modulo: n.dataset.modulo || '',
            keywords: (n.dataset.keywords || '').toLowerCase(),
            html: n.innerHTML,
          });
        });
        setCached(arr);
        return arr;
      })
      .catch(function() { return []; });
  }

  function rankArticles(articles, q) {
    var portal = detectPortal();
    var modulo = detectModulo();
    var qLower = (q || '').toLowerCase().trim();

    return articles
      .map(function(a) {
        var score = 0;
        if (a.portal === portal) score += 30;
        if (modulo && a.modulo === modulo) score += 50;
        if (qLower) {
          if (a.title.toLowerCase().indexOf(qLower) >= 0) score += 40;
          if (a.snippet.toLowerCase().indexOf(qLower) >= 0) score += 20;
          if (a.keywords.indexOf(qLower) >= 0) score += 30;
          if (score === 0) return null; // sem busca match
        }
        return { article: a, score: score };
      })
      .filter(Boolean)
      .sort(function(a, b) { return b.score - a.score; })
      .map(function(x) { return x.article; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ─── UI ──────────────────────────────────────────────────────
  var fab = null;
  var overlay = null;
  var drawer = null;
  var allArticles = [];
  var currentView = 'list'; // 'list' | 'article'
  var currentArticleId = null;

  function init() {
    fab = document.createElement('button');
    fab.className = 'lap-help-fab';
    fab.setAttribute('aria-label', 'Abrir ajuda');
    fab.title = 'Ajuda contextual';
    fab.textContent = '?';
    fab.onclick = open;
    document.body.appendChild(fab);
  }

  function open() {
    if (drawer) return;
    overlay = document.createElement('div');
    overlay.className = 'lap-help-drawer-overlay';
    overlay.onclick = close;
    document.body.appendChild(overlay);

    drawer = document.createElement('aside');
    drawer.className = 'lap-help-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Ajuda contextual');
    document.body.appendChild(drawer);

    currentView = 'list';
    currentArticleId = null;
    renderShell();
    loadArticles().then(function(arr) {
      allArticles = arr;
      renderList('');
    });
  }

  function close() {
    if (overlay) { overlay.remove(); overlay = null; }
    if (drawer) { drawer.remove(); drawer = null; }
  }

  function renderShell() {
    var portal = detectPortal();
    var modulo = detectModulo();
    var ctx = portal + (modulo ? ' · ' + modulo : '');
    drawer.innerHTML =
      '<header class="lap-help-header">' +
        '<div>' +
          '<div class="lap-help-title">Como podemos ajudar?</div>' +
          '<div class="lap-help-sub">Contexto: ' + esc(ctx) + '</div>' +
        '</div>' +
        '<button class="lap-help-close" aria-label="Fechar">×</button>' +
      '</header>' +
      '<div class="lap-help-search">' +
        '<input class="lap-help-search-input" placeholder="🔍 Buscar dúvida..." />' +
      '</div>' +
      '<div class="lap-help-body" id="lap-help-body">' +
        '<div class="lap-help-empty">Carregando…</div>' +
      '</div>' +
      '<footer class="lap-help-footer">' +
        '<a class="lap-help-cta wa" target="_blank" rel="noopener" href="https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent('Oi! Estou em ' + portal + (modulo ? '/' + modulo : '') + ' e preciso de ajuda com...') + '">' +
          '💬 Falar no WhatsApp' +
        '</a>' +
        '<a class="lap-help-cta outline" target="_blank" rel="noopener" href="/ajuda/#' + esc(portal) + '">📖 Central de Ajuda completa</a>' +
      '</footer>';

    drawer.querySelector('.lap-help-close').onclick = close;
    var search = drawer.querySelector('.lap-help-search-input');
    var debounced;
    search.oninput = function() {
      clearTimeout(debounced);
      debounced = setTimeout(function() { renderList(search.value); }, 150);
    };
  }

  function renderList(q) {
    var body = drawer.querySelector('#lap-help-body');
    var ranked = rankArticles(allArticles, q);
    if (ranked.length === 0) {
      body.innerHTML = '<div class="lap-help-empty">Nada encontrado pra "' + esc(q || '') + '". Tenta outras palavras ou fala com a gente no WhatsApp.</div>';
      return;
    }
    var portal = detectPortal();
    var modulo = detectModulo();
    var contextualHtml = '';
    var others = [];
    var contextual = ranked.filter(function(a) {
      var match = a.portal === portal && (!modulo || a.modulo === modulo);
      if (match) return true;
      others.push(a);
      return false;
    });

    function cardHtml(a) {
      var tag = a.modulo ? '<span class="lap-help-article-tag">' + esc(a.modulo) + '</span>' : '';
      return '<div class="lap-help-article-card" data-id="' + esc(a.id) + '">' +
        '<div class="lap-help-article-title">' + esc(a.title) + '</div>' +
        (a.snippet ? '<div class="lap-help-article-snippet">' + esc(a.snippet) + '</div>' : '') +
        tag +
        '</div>';
    }

    contextualHtml = contextual.slice(0, 6).map(cardHtml).join('');
    var othersHtml = others.slice(0, 6).map(cardHtml).join('');

    body.innerHTML =
      (contextualHtml ? '<div class="lap-help-section-label">Para esta tela</div>' + contextualHtml : '') +
      (othersHtml ? '<div class="lap-help-section-label">Outros relacionados</div>' + othersHtml : '');

    body.querySelectorAll('.lap-help-article-card').forEach(function(c) {
      c.onclick = function() { openArticle(c.getAttribute('data-id')); };
    });
  }

  function openArticle(id) {
    var a = allArticles.find(function(x) { return x.id === id; });
    if (!a) return;
    currentArticleId = id;
    currentView = 'article';
    var body = drawer.querySelector('#lap-help-body');
    body.innerHTML =
      '<div class="lap-help-article-view">' +
        '<button class="lap-help-article-view-back">← Voltar</button>' +
        '<h2 class="lap-help-article-view-title">' + esc(a.title) + '</h2>' +
        '<div class="lap-help-article-view-content">' + a.html + '</div>' +
        '<div style="margin-top:18px;padding-top:14px;border-top:1px solid #f1f5f9;font-size:11.5px;color:#94a3b8;">' +
          'Foi útil? Resposta rápida pelo WhatsApp lá embaixo 👇' +
        '</div>' +
      '</div>';
    body.querySelector('.lap-help-article-view-back').onclick = function() {
      currentView = 'list';
      currentArticleId = null;
      renderList(drawer.querySelector('.lap-help-search-input').value || '');
    };
    body.scrollTop = 0;
  }

  // Keyboard: Esc fecha; '?' abre (se não estiver em input)
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && drawer) close();
    if (e.key === '?' && !drawer) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') open();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
