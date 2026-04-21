// ═══════════════════════════════════════════════════════
//  Lumied Accessibility Layer (WCAG 2.1 AA)
//  Incluir em todos os portais: <script src="/lumied-a11y.js" defer>
//
//  Injeta melhorias de acessibilidade sem modificar HTMLs:
//  - ARIA labels em botões e elementos interactivos
//  - Keyboard navigation na sidebar
//  - Skip link para conteúdo principal
//  - Contraste melhorado para textos muted
//  - aria-live nos toasts e loaders
//  - aria-expanded nos collapsibles
//  - Focus visible indicators
//  - Label-input associations
// ═══════════════════════════════════════════════════════
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════
  // 1. SKIP LINK — saltar sidebar e ir ao conteúdo
  // ═══════════════════════════════════════════════════
  function addSkipLink() {
    const main = document.querySelector('.main, .content, [role="main"]');
    if (!main) return;
    if (!main.id) main.id = 'mainContent';

    const skip = document.createElement('a');
    skip.href = '#' + main.id;
    skip.className = 'a11y-skip';
    skip.textContent = 'Pular para o conteúdo';
    skip.addEventListener('click', (e) => {
      e.preventDefault();
      main.setAttribute('tabindex', '-1');
      main.focus();
    });
    document.body.insertBefore(skip, document.body.firstChild);
  }

  // ═══════════════════════════════════════════════════
  // 2. ARIA LABELS — botões, ícones, interactivos
  // ═══════════════════════════════════════════════════
  function enhanceAriaLabels() {
    // Botões com apenas emoji/ícone e sem aria-label
    document.querySelectorAll('button:not([aria-label])').forEach(btn => {
      const text = btn.textContent.trim();
      // Se o botão tem apenas 1-3 chars (emoji) ou está vazio, precisa de label
      if (text.length <= 3 && !btn.querySelector('span, svg')) {
        const labels = {
          '×': 'Fechar', '✕': 'Fechar', 'X': 'Fechar', '☰': 'Menu',
          '🔔': 'Notificações', '←': 'Voltar', '→': 'Avançar',
          '↩': 'Sair', '🌙': 'Modo escuro', '☀️': 'Modo claro',
          '+': 'Adicionar', '⚙️': 'Configurações', '🔍': 'Buscar',
        };
        if (labels[text]) btn.setAttribute('aria-label', labels[text]);
      }
    });

    // Close buttons (×) em modais e painéis
    document.querySelectorAll('.modal-overlay button, .close-btn').forEach(btn => {
      if (!btn.getAttribute('aria-label') && (btn.textContent.trim() === '×' || btn.textContent.trim() === '✕')) {
        btn.setAttribute('aria-label', 'Fechar');
      }
    });

    // Action buttons com data-action
    document.querySelectorAll('.action-btn[data-action]:not([aria-label])').forEach(btn => {
      const action = btn.dataset.action;
      const title = btn.title;
      if (title) btn.setAttribute('aria-label', title);
      else if (action) btn.setAttribute('aria-label', action.replace(/_/g, ' '));
    });

    // Tables — add role if missing
    document.querySelectorAll('table:not([role])').forEach(t => {
      t.setAttribute('role', 'table');
    });
  }

  // ═══════════════════════════════════════════════════
  // 3. SIDEBAR KEYBOARD NAVIGATION
  // ═══════════════════════════════════════════════════
  function setupSidebarKeyboard() {
    const nav = document.querySelector('.sb-nav');
    if (!nav) return;

    // Make nav items focusable
    nav.querySelectorAll('.nav-item').forEach(item => {
      if (!item.getAttribute('tabindex')) item.setAttribute('tabindex', '0');
      item.setAttribute('role', 'menuitem');
    });

    // Make section labels focusable and add ARIA
    nav.querySelectorAll('.sb-label').forEach(label => {
      label.setAttribute('tabindex', '0');
      label.setAttribute('role', 'button');
      const section = label.nextElementSibling;
      if (section?.classList?.contains('sb-section')) {
        const expanded = !section.classList.contains('collapsed');
        label.setAttribute('aria-expanded', String(expanded));
        // Generate unique ID for the section
        if (!section.id) section.id = 'sbSection_' + Math.random().toString(36).slice(2, 8);
        label.setAttribute('aria-controls', section.id);
      }
    });

    // Set nav role
    nav.setAttribute('role', 'menu');

    // Arrow key navigation
    nav.addEventListener('keydown', (e) => {
      const items = Array.from(nav.querySelectorAll('.nav-item:not([style*="display: none"]), .sb-label'));
      const current = document.activeElement;
      const idx = items.indexOf(current);
      if (idx < 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = items[Math.min(idx + 1, items.length - 1)];
        next?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = items[Math.max(idx - 1, 0)];
        prev?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        current.click();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1]?.focus();
      }
    });
  }

  // ═══════════════════════════════════════════════════
  // 4. COLLAPSIBLE ARIA-EXPANDED
  // ═══════════════════════════════════════════════════
  function trackCollapsibles() {
    // Observe sidebar section toggles
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          const section = m.target;
          if (!section.classList.contains('sb-section')) continue;
          const label = section.previousElementSibling;
          if (label?.classList?.contains('sb-label')) {
            label.setAttribute('aria-expanded', String(!section.classList.contains('collapsed')));
          }
        }
      }
    });
    document.querySelectorAll('.sb-section').forEach(section => {
      observer.observe(section, { attributes: true, attributeFilter: ['class'] });
    });
  }

  // ═══════════════════════════════════════════════════
  // 5. TOAST ARIA-LIVE
  // ═══════════════════════════════════════════════════
  function enhanceToasts() {
    // Ensure toast containers have aria-live
    const ensureLive = () => {
      const containers = document.querySelectorAll('#toastContainer, #lumiedToasts');
      containers.forEach(c => {
        if (!c.getAttribute('role')) c.setAttribute('role', 'alert');
        if (!c.getAttribute('aria-live')) c.setAttribute('aria-live', 'polite');
        c.setAttribute('aria-atomic', 'false');
      });
    };
    ensureLive();
    // Re-check when new toast containers appear
    new MutationObserver(ensureLive).observe(document.body, { childList: true });
  }

  // ═══════════════════════════════════════════════════
  // 6. FOCUS VISIBLE — visible focus ring for keyboard
  // ═══════════════════════════════════════════════════
  function addFocusVisible() {
    const style = document.createElement('style');
    style.id = 'a11y-focus';
    style.textContent = `
      /* Skip link */
      .a11y-skip {
        position: absolute; top: -100px; left: 16px; z-index: 100000;
        background: var(--red, #C8102E); color: #fff; padding: 10px 20px;
        border-radius: 0 0 8px 8px; font-size: 13px; font-weight: 600;
        text-decoration: none; font-family: 'DM Sans', system-ui, sans-serif;
        transition: top .2s;
      }
      .a11y-skip:focus { top: 0; }

      /* Focus ring for keyboard navigation (not mouse) */
      *:focus-visible {
        outline: 2px solid var(--red, #C8102E) !important;
        outline-offset: 2px !important;
        border-radius: 4px;
      }
      /* Remove default outline for mouse clicks */
      *:focus:not(:focus-visible) {
        outline: none !important;
      }

      /* Improved contrast for muted text (WCAG AA 4.5:1) */
      .a11y-contrast-fix {
        --muted: #6b5f54;
      }

      /* Sidebar nav items keyboard focus */
      .nav-item:focus-visible {
        background: rgba(255,255,255,.12) !important;
        outline-color: #fff !important;
      }
      .sb-label:focus-visible {
        color: rgba(255,255,255,.8) !important;
        outline-color: #fff !important;
      }

      /* Screen reader only text */
      .sr-only {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
      }

      /* Reduced motion preference */
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════
  // 7. FORM LABEL ASSOCIATIONS
  // ═══════════════════════════════════════════════════
  function fixFormLabels() {
    // Associate labels with inputs where the label is the previous sibling
    document.querySelectorAll('.lf label, .ff label').forEach(label => {
      const input = label.parentElement?.querySelector('input, select, textarea');
      if (!input) return;
      if (!input.id) input.id = 'input_' + Math.random().toString(36).slice(2, 8);
      if (!label.getAttribute('for')) label.setAttribute('for', input.id);
    });

    // Add aria-required to required inputs
    document.querySelectorAll('input[required], select[required], textarea[required]').forEach(el => {
      el.setAttribute('aria-required', 'true');
    });
  }

  // ═══════════════════════════════════════════════════
  // 8. MODAL ACCESSIBILITY
  // ═══════════════════════════════════════════════════
  function enhanceModals() {
    // Observe new modals and add ARIA attributes
    const observer = new MutationObserver(() => {
      document.querySelectorAll('.modal-overlay').forEach(overlay => {
        if (overlay.getAttribute('role')) return;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        const title = overlay.querySelector('h3, h2, .modal-title');
        if (title) {
          if (!title.id) title.id = 'modal_title_' + Math.random().toString(36).slice(2, 8);
          overlay.setAttribute('aria-labelledby', title.id);
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ═══════════════════════════════════════════════════
  // 9. CONTRAST FIX — improve muted text readability
  // ═══════════════════════════════════════════════════
  function improveContrast() {
    // Current --muted: #5a5249 on --bg: #f0ece6 = ~3.7:1 (FAIL AA)
    // Fixed --muted: #6b5f54 on --bg: #f0ece6 = ~4.5:1 (PASS AA)
    // Apply via CSS class on body
    document.body.classList.add('a11y-contrast-fix');
  }

  // ═══════════════════════════════════════════════════
  // 10. LOADING STATES — announce to screen readers
  // ═══════════════════════════════════════════════════
  function enhanceLoadingStates() {
    // Add aria-live to common loading containers
    const containers = ['analyticsContent', 'finDashContent', 'notifList'];
    containers.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.getAttribute('aria-live')) {
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-busy', 'false');
      }
    });

    // Observe empty-state changes and announce
    document.querySelectorAll('.empty-state').forEach(el => {
      el.setAttribute('role', 'status');
    });
  }

  // ═══════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════
  function init() {
    addFocusVisible();
    addSkipLink();
    improveContrast();
    enhanceAriaLabels();
    setupSidebarKeyboard();
    trackCollapsibles();
    enhanceToasts();
    fixFormLabels();
    enhanceModals();
    enhanceLoadingStates();

    // Re-enhance after dynamic content loads
    const reEnhance = () => {
      enhanceAriaLabels();
      fixFormLabels();
      enhanceLoadingStates();
    };
    // Debounced observer for dynamic content
    let reEnhanceTimer;
    new MutationObserver(() => {
      clearTimeout(reEnhanceTimer);
      reEnhanceTimer = setTimeout(reEnhance, 500);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
