// ═══════════════════════════════════════════════════════════════
//  Lumied — Empty State helper (Sprint 5 LAP)
//
//  Uso:
//    el.innerHTML = lumiedEmpty({
//      icon: '🧾',
//      title: 'Nenhuma cobrança ainda',
//      text: 'Crie sua primeira cobrança ou importe mensalidades em massa.',
//      cta: { label: '+ Nova cobrança', onclick: 'novaCobranca()' },
//      sample: { label: '📥 Carregar 5 exemplos', onclick: 'carregarExemplos()' },
//      secondary: { label: '▶ Ver em 60s', href: '/ajuda#financeiro' },
//      compact: false,
//    });
//
//    OR mount directly:
//    lumiedEmpty(el, { ... });
//
//  Returns: HTML string (when called with options only) OR void (when mounted).
// ═══════════════════════════════════════════════════════════════
(function() {
  if (typeof window === 'undefined') return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderBtn(opts, cls) {
    if (!opts || !opts.label) return '';
    var label = esc(opts.label);
    var attrs = '';
    if (opts.href) {
      attrs = 'href="' + esc(opts.href) + '"' + (opts.target ? ' target="' + esc(opts.target) + '"' : '');
      return '<a class="lap-empty-btn ' + cls + '" ' + attrs + '>' + label + '</a>';
    }
    if (opts.onclick) {
      // inline onclick string (legado-friendly)
      return '<button class="lap-empty-btn ' + cls + '" onclick="' + esc(opts.onclick) + '">' + label + '</button>';
    }
    return '<button class="lap-empty-btn ' + cls + '">' + label + '</button>';
  }

  function build(opts) {
    opts = opts || {};
    var compact = opts.compact ? ' compact' : '';
    var variant = opts.variant ? ' ' + esc(opts.variant) : '';
    var icon = opts.icon || '✨';
    var title = opts.title || 'Nada por aqui ainda';
    var text = opts.text || '';

    var primaryBtn = renderBtn(opts.cta, 'primary');
    var secondaryBtn = renderBtn(opts.secondary, 'secondary');
    var sampleBtn = renderBtn(opts.sample, 'ghost');

    var actions = '';
    if (primaryBtn || secondaryBtn) {
      actions = '<div class="lap-empty-actions">' + primaryBtn + secondaryBtn + '</div>';
    }
    var divider = (sampleBtn && actions) ? '<div class="lap-empty-divider">ou</div>' : '';
    var sampleBlock = sampleBtn ? '<div class="lap-empty-actions">' + sampleBtn + '</div>' : '';

    return '<div class="lap-empty' + compact + variant + '">'
      + '<div class="lap-empty-icon">' + esc(icon) + '</div>'
      + '<h3 class="lap-empty-title">' + esc(title) + '</h3>'
      + (text ? '<p class="lap-empty-text">' + esc(text) + '</p>' : '')
      + actions
      + divider
      + sampleBlock
      + '</div>';
  }

  // API: lumiedEmpty(opts) → string  /  lumiedEmpty(el, opts) → mounts
  window.lumiedEmpty = function(targetOrOpts, maybeOpts) {
    if (targetOrOpts && typeof targetOrOpts === 'object' && 'nodeType' in targetOrOpts) {
      // mount em element
      targetOrOpts.innerHTML = build(maybeOpts || {});
      return;
    }
    return build(targetOrOpts);
  };
})();
