// ═══════════════════════════════════════════════════════════════
//  Lumied — First-time walkthrough engine (Sprint 9 LAP)
//
//  Engine de tooltips contextuais que aparecem na 1ª visita a uma
//  tela. Padrão Linear/Notion: 3-4 passos max, skip sempre visível,
//  marca "visto" persistente.
//
//  Uso:
//    LumiedTour.register('tour_financeiro', [
//      { selector: '#btnNovaCobranca', title: '...', text: '...', position: 'bottom' },
//      ...
//    ]);
//
//    LumiedTour.autoStart('tour_financeiro');  // só roda se ainda não viu
//    LumiedTour.start('tour_financeiro');      // força (do menu Help)
//    LumiedTour.reset('tour_financeiro');      // limpa o "visto" pra debug
// ═══════════════════════════════════════════════════════════════
(function() {
  if (typeof window === 'undefined') return;

  var SEEN_PREFIX = 'lumied_tour_seen_';
  var REGISTRY = {};
  var active = null; // { key, steps, index, refs }

  function seen(key) {
    try { return localStorage.getItem(SEEN_PREFIX + key) === '1'; } catch (e) { return false; }
  }
  function markSeen(key) {
    try { localStorage.setItem(SEEN_PREFIX + key, '1'); } catch (e) {}
  }
  function clearSeen(key) {
    try { localStorage.removeItem(SEEN_PREFIX + key); } catch (e) {}
  }

  function findEl(selector) {
    if (!selector) return null;
    try { return document.querySelector(selector); } catch (e) { return null; }
  }

  function rect(el) {
    var r = el.getBoundingClientRect();
    return {
      top: r.top, left: r.left, width: r.width, height: r.height,
      right: r.right, bottom: r.bottom,
    };
  }

  function positionPopover(pop, target, prefPos) {
    var r = rect(target);
    var pw = pop.offsetWidth;
    var ph = pop.offsetHeight;
    var GAP = 14;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    var pos = prefPos || 'auto';
    if (pos === 'auto') {
      // Decide automaticamente baseado em espaço disponível
      if (r.bottom + ph + GAP < vh) pos = 'bottom';
      else if (r.top - ph - GAP > 0) pos = 'top';
      else if (r.right + pw + GAP < vw) pos = 'right';
      else pos = 'left';
    }

    var top, left;
    if (pos === 'bottom') {
      top = r.bottom + GAP;
      left = r.left + r.width / 2 - pw / 2;
    } else if (pos === 'top') {
      top = r.top - ph - GAP;
      left = r.left + r.width / 2 - pw / 2;
    } else if (pos === 'right') {
      top = r.top + r.height / 2 - ph / 2;
      left = r.right + GAP;
    } else {
      top = r.top + r.height / 2 - ph / 2;
      left = r.left - pw - GAP;
    }

    // Clamp dentro da viewport
    left = Math.max(12, Math.min(left, vw - pw - 12));
    top = Math.max(12, Math.min(top, vh - ph - 12));

    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    pop.setAttribute('data-pos', pos);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderStep() {
    if (!active) return;
    var step = active.steps[active.index];
    if (!step) { finish(); return; }

    var target = findEl(step.selector);
    if (!target) {
      // Pula o passo se elemento não existe (UI condicional)
      active.index++;
      return renderStep();
    }

    // Highlight (borda + clip do backdrop simulado via box-shadow)
    var hl = active.refs.highlight;
    var r = rect(target);
    var pad = 4;
    hl.style.top = (r.top - pad) + 'px';
    hl.style.left = (r.left - pad) + 'px';
    hl.style.width = (r.width + pad * 2) + 'px';
    hl.style.height = (r.height + pad * 2) + 'px';
    hl.style.display = '';

    // Popover
    var pop = active.refs.popover;
    var total = active.steps.length;
    var num = active.index + 1;
    var isLast = num === total;
    var canBack = active.index > 0;
    var dots = active.steps.map(function(_, i) {
      var cls = 'lap-tour-dot';
      if (i === active.index) cls += ' active';
      else if (i < active.index) cls += ' done';
      return '<div class="' + cls + '"></div>';
    }).join('');

    pop.innerHTML =
      '<div class="lap-tour-arrow"></div>' +
      '<div class="lap-tour-step-num">PASSO ' + num + ' / ' + total + '</div>' +
      '<h3 class="lap-tour-title">' + esc(step.title || '') + '</h3>' +
      '<p class="lap-tour-text">' + esc(step.text || '') + '</p>' +
      '<div class="lap-tour-footer">' +
        '<div style="display:flex;gap:6px;align-items:center">' +
          (canBack ? '<button class="lap-tour-btn back" data-act="back">← Voltar</button>' : '<button class="lap-tour-btn ghost" data-act="skip">Pular</button>') +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<div class="lap-tour-dots">' + dots + '</div>' +
          '<button class="lap-tour-btn primary" data-act="next">' + (isLast ? 'Concluir 🎉' : 'Próximo →') + '</button>' +
        '</div>' +
      '</div>';

    pop.style.display = '';
    // Aguarda 1 frame pra ter dimensões corretas
    requestAnimationFrame(function() { positionPopover(pop, target, step.position); });

    // Scroll o target pra viewport se necessário
    if (r.top < 0 || r.bottom > window.innerHeight) {
      try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      setTimeout(function() {
        var t2 = findEl(step.selector);
        if (t2) {
          var r2 = rect(t2);
          hl.style.top = (r2.top - pad) + 'px';
          hl.style.left = (r2.left - pad) + 'px';
          positionPopover(pop, t2, step.position);
        }
      }, 300);
    }

    pop.querySelector('[data-act="next"]').onclick = function() {
      active.index++;
      if (active.index >= total) finish();
      else renderStep();
    };
    var backBtn = pop.querySelector('[data-act="back"]');
    if (backBtn) backBtn.onclick = function() {
      if (active.index > 0) { active.index--; renderStep(); }
    };
    var skipBtn = pop.querySelector('[data-act="skip"]');
    if (skipBtn) skipBtn.onclick = function() { finish(true); };
  }

  function finish(skipped) {
    if (!active) return;
    var key = active.key;
    var refs = active.refs;
    if (refs.popover) refs.popover.remove();
    if (refs.highlight) refs.highlight.remove();
    if (refs.backdrop) refs.backdrop.remove();
    active = null;
    markSeen(key);

    // Emite product event (best-effort)
    if (window.trackProductEvent) {
      window.trackProductEvent(skipped ? 'onboarding.tour.pulado' : 'onboarding.tour.concluido', {
        tour: key,
      });
    }
  }

  function start(key, opts) {
    if (active) return; // já está rodando
    var def = REGISTRY[key];
    if (!def || !def.length) return;

    var backdrop = document.createElement('div');
    backdrop.className = 'lap-tour-backdrop';
    backdrop.onclick = function() { finish(true); };
    document.body.appendChild(backdrop);

    var highlight = document.createElement('div');
    highlight.className = 'lap-tour-highlight';
    highlight.style.display = 'none';
    document.body.appendChild(highlight);

    var popover = document.createElement('div');
    popover.className = 'lap-tour-popover';
    popover.style.display = 'none';
    document.body.appendChild(popover);

    active = {
      key: key,
      steps: def,
      index: 0,
      refs: { backdrop: backdrop, highlight: highlight, popover: popover },
    };

    if (window.trackProductEvent) {
      window.trackProductEvent('onboarding.tour.iniciado', { tour: key });
    }

    // Pequeno delay pra DOM settle
    setTimeout(renderStep, 100);

    // Reposiciona em resize
    var onResize = function() { if (active) renderStep(); };
    window.addEventListener('resize', onResize, { passive: true });
  }

  function autoStart(key) {
    if (seen(key)) return false;
    start(key);
    return true;
  }

  window.LumiedTour = {
    register: function(key, steps) { REGISTRY[key] = steps; },
    start: start,
    autoStart: autoStart,
    reset: clearSeen,
    finish: function() { finish(true); },
    seen: seen,
  };
})();
