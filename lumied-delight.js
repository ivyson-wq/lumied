// ═══════════════════════════════════════════════════════════════
//  Lumied Delight Layer — micro-animações, atalhos, easter eggs,
//  presença online, smart defaults, white-label premium
//  Incluir em todos os portais: <script src="/lumied-delight.js" defer>
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const portal = (() => {
    const p = location.pathname;
    if (p.includes('gerente')) return 'gerente';
    if (p.includes('professora')) return 'professora';
    if (p.includes('secretaria')) return 'secretaria';
    if (p.includes('aluno')) return 'aluno';
    if (p.includes('admin')) return 'admin';
    return 'pais';
  })();

  // ═══════════════════════════════════════════════════
  // 1. COUNT-UP ANIMATION — números que contam de 0
  // ═══════════════════════════════════════════════════
  function setupCountUp() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        if (el.dataset.counted) return;
        el.dataset.counted = '1';
        const text = el.textContent.trim();
        // Parse number (supports R$ 1.234,56 and plain numbers)
        const match = text.match(/(R\$\s*)?([\d.,]+)(%?)/);
        if (!match) return;
        const prefix = match[1] || '';
        const suffix = match[3] || '';
        const raw = match[2].replace(/\./g, '').replace(',', '.');
        const target = parseFloat(raw);
        if (isNaN(target) || target === 0) return;
        const isCurrency = !!prefix;
        const hasDecimals = raw.includes('.') || isCurrency;
        const duration = 1200;
        const start = performance.now();
        const format = (n) => {
          if (isCurrency) return prefix + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          if (hasDecimals) return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + suffix;
          return Math.round(n).toLocaleString('pt-BR') + suffix;
        };
        function tick(now) {
          const elapsed = now - start;
          const progress = Math.min(elapsed / duration, 1);
          // ease-out cubic
          const eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = format(target * eased);
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.3 });

    // Observe stat values
    function observeStats() {
      document.querySelectorAll('.stat-value, .kpi-value, [data-countup]').forEach(el => {
        if (!el.dataset.counted) observer.observe(el);
      });
    }
    observeStats();
    // Re-observe when content changes (panels switch)
    new MutationObserver(() => setTimeout(observeStats, 200)).observe(document.body, { childList: true, subtree: true });
  }

  // ═══════════════════════════════════════════════════
  // 2. CONFETTI — celebração
  // ═══════════════════════════════════════════════════
  window._confetti = function (duration = 2500) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;z-index:999999;pointer-events:none;';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const colors = ['#C8102E', '#2d7a3a', '#1a6bb5', '#d4830a', '#8b5cf6', '#ec4899', '#f59e0b'];
    const particles = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height * -1,
      w: Math.random() * 8 + 4,
      h: Math.random() * 4 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 3 + 2,
      rot: Math.random() * 360,
      vr: (Math.random() - 0.5) * 10,
    }));
    const startTime = performance.now();
    function draw(now) {
      const elapsed = now - startTime;
      if (elapsed > duration) { canvas.remove(); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const fade = elapsed > duration - 500 ? (duration - elapsed) / 500 : 1;
      ctx.globalAlpha = fade;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot * Math.PI / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  };

  // ═══════════════════════════════════════════════════
  // 3. SHAKE ANIMATION — erro em formulários
  // ═══════════════════════════════════════════════════
  window._shake = function (el) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) return;
    el.style.animation = 'shakeX .4s ease';
    el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
  };

  // ═══════════════════════════════════════════════════
  // 4. HOVER 3D — cards com profundidade
  // ═══════════════════════════════════════════════════
  function setupHover3D() {
    document.addEventListener('mouseenter', (e) => {
      if (!e.target?.closest) return;
      const card = e.target.closest('.stat-card, .stats-card, [data-hover3d]');
      if (!card) return;
      card.style.transition = 'transform .2s ease, box-shadow .2s ease';
      card.style.transform = 'translateY(-3px)';
      card.style.boxShadow = '0 8px 24px rgba(0,0,0,.12)';
    }, true);
    document.addEventListener('mouseleave', (e) => {
      if (!e.target?.closest) return;
      const card = e.target.closest('.stat-card, .stats-card, [data-hover3d]');
      if (!card) return;
      card.style.transform = '';
      card.style.boxShadow = '';
    }, true);
  }

  // ═══════════════════════════════════════════════════
  // 5. KEYBOARD SHORTCUTS — vim-style navigation
  // ═══════════════════════════════════════════════════
  function setupShortcuts() {
    if (portal !== 'gerente') return;

    const SHORTCUTS = {
      'g+a': { panel: 'alunos', label: 'Alunos' },
      'g+f': { panel: 'panelFinDash', label: 'Financeiro' },
      'g+d': { panel: 'analytics', label: 'Dashboard' },
      'g+c': { panel: 'crmKanban', label: 'CRM Pipeline' },
      'g+e': { panel: 'equipe', label: 'Equipe' },
      'g+s': { panel: 'series', label: 'Séries' },
      'g+m': { panel: 'almDash', label: 'Almoxarifado' },
      'g+p': { panel: 'familias', label: 'Famílias' },
    };

    let pendingG = false;
    let pendingTimer = null;

    document.addEventListener('keydown', (e) => {
      // Don't capture when typing in inputs
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      // Don't capture in modals
      if (document.querySelector('.modal-overlay[style*="flex"], .cmd-overlay')) return;

      const key = e.key.toLowerCase();

      // "/" = open search (like GitHub)
      if (key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (typeof window._openCommandPalette === 'function') window._openCommandPalette();
        return;
      }

      // "?" = show shortcuts help
      if (key === '?' || (e.shiftKey && key === '/')) {
        e.preventDefault();
        showShortcutsHelp();
        return;
      }

      // "n" = New (context-aware)
      if (key === 'n' && !e.ctrlKey && !e.metaKey) {
        const activePanel = document.querySelector('.panel.active');
        if (!activePanel) return;
        const newBtn = activePanel.querySelector('[onclick*="novo"], [onclick*="criar"], [onclick*="add"], .btn-primary');
        if (newBtn) { e.preventDefault(); newBtn.click(); }
        return;
      }

      // G+key combos
      if (key === 'g' && !pendingG) {
        pendingG = true;
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => { pendingG = false; }, 800);
        return;
      }

      if (pendingG) {
        pendingG = false;
        clearTimeout(pendingTimer);
        const combo = 'g+' + key;
        const shortcut = SHORTCUTS[combo];
        if (shortcut && typeof window.showPanel === 'function') {
          e.preventDefault();
          window.showPanel(shortcut.panel);
          if (typeof window.__toast === 'function') {
            window.__toast('→ ' + shortcut.label, 'info', 1500);
          }
        }
      }
    });
  }

  function showShortcutsHelp() {
    const existing = document.getElementById('shortcutsHelp');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'shortcutsHelp';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:"DM Sans",system-ui,sans-serif;backdrop-filter:blur(4px);';
    overlay.innerHTML = `
      <div style="background:var(--white,#fff);border-radius:16px;padding:32px;max-width:480px;width:90%;box-shadow:0 24px 80px rgba(0,0,0,.35);animation:popIn .2s ease;">
        <h3 style="font-family:'Lora',serif;font-size:18px;margin-bottom:20px;">⌨️ Atalhos do Teclado</h3>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:13px;">
          <kbd style="background:#f0ece6;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #ddd;">Ctrl+K</kbd><span>Busca rápida / Command palette</span>
          <kbd style="background:#f0ece6;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #ddd;">/</kbd><span>Abrir busca</span>
          <kbd style="background:#f0ece6;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #ddd;">?</kbd><span>Mostrar estes atalhos</span>
          <kbd style="background:#f0ece6;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #ddd;">N</kbd><span>Novo (contexto do painel)</span>
          <kbd style="background:#f0ece6;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #ddd;">Esc</kbd><span>Fechar modal/overlay</span>
          <div style="grid-column:1/-1;border-top:1px solid var(--border,#e2dbd1);margin:8px 0;"></div>
          <kbd style="background:#f0ece6;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #ddd;">G A</kbd><span>Ir para Alunos</span>
          <kbd style="background:#f0ece6;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #ddd;">G F</kbd><span>Ir para Financeiro</span>
          <kbd style="background:#f0ece6;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #ddd;">G D</kbd><span>Ir para Dashboard</span>
          <kbd style="background:#f0ece6;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #ddd;">G C</kbd><span>Ir para CRM</span>
          <kbd style="background:#f0ece6;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #ddd;">G E</kbd><span>Ir para Equipe</span>
          <kbd style="background:#f0ece6;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #ddd;">G S</kbd><span>Ir para Séries</span>
          <kbd style="background:#f0ece6;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #ddd;">G M</kbd><span>Ir para Almoxarifado</span>
          <kbd style="background:#f0ece6;padding:3px 8px;border-radius:4px;font-family:monospace;font-size:11px;border:1px solid #ddd;">G P</kbd><span>Ir para Famílias</span>
        </div>
        <div style="margin-top:20px;text-align:center;">
          <button onclick="this.closest('#shortcutsHelp').remove()" style="padding:8px 20px;background:var(--red,#C8102E);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Entendi!</button>
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); } });
    document.body.appendChild(overlay);
  }

  // ═══════════════════════════════════════════════════
  // 6. SMART DEFAULTS — lembrar último painel
  // ═══════════════════════════════════════════════════
  function setupSmartDefaults() {
    if (portal !== 'gerente') return;
    const LAST_PANEL_KEY = 'lumied_last_panel';

    // Save last panel on navigation
    const origShowPanel = window.showPanel;
    if (typeof origShowPanel !== 'function') return;
    const _prev = window.showPanel;
    window.showPanel = function (panelId, navItem) {
      _prev(panelId, navItem);
      if (panelId && panelId !== 'analytics') {
        localStorage.setItem(LAST_PANEL_KEY, panelId);
      }
    };

    // Restore last panel after login (with slight delay)
    setTimeout(() => {
      const appShell = document.getElementById('appShell');
      if (!appShell || appShell.style.display === 'none') return;
      const last = localStorage.getItem(LAST_PANEL_KEY);
      if (last && typeof window.showPanel === 'function') {
        // Only restore if currently on dashboard (default)
        const active = document.querySelector('.panel.active');
        if (active && active.id === 'panelAnalytics') {
          window.showPanel(last);
        }
      }
    }, 1500);
  }

  // ═══════════════════════════════════════════════════
  // 7. EASTER EGGS — personalidade
  // ═══════════════════════════════════════════════════
  function setupEasterEggs() {
    // Rotating loading messages
    const messages = [
      'Organizando cadernos...',
      'Chamando a turma...',
      'Conferindo notas...',
      'Preparando a pauta...',
      'Contando mochilas...',
      'Afiando lápis...',
      'Abrindo o livro de chamada...',
      'Calculando médias...',
      'Consultando o diário...',
      'Verificando presenças...',
    ];
    const observer = new MutationObserver(() => {
      document.querySelectorAll('.empty-state').forEach(el => {
        const text = el.textContent.trim();
        if (text === 'Carregando...' || text === 'Carregando' || text === 'Buscando dados...') {
          const msg = messages[Math.floor(Math.random() * messages.length)];
          const spinner = el.querySelector('.spinner-sm') ? '' : '<div class="spinner-sm" style="margin:0 auto 8px;"></div>';
          el.innerHTML = `<div style="padding:20px;text-align:center;">${spinner}<div style="color:var(--muted,#6b5f54);font-size:13px;">${msg}</div></div>`;
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Birthday celebration
    checkBirthday();

    // Motivational quote on login screen
    addLoginQuote();
  }

  function checkBirthday() {
    // Check after app loads
    setTimeout(() => {
      const userNomeEl = document.getElementById('userNome');
      if (!userNomeEl) return;
      const nome = userNomeEl.textContent.trim();
      if (!nome || nome === 'Gerente') return;

      // Check if today is user's birthday (stored in localStorage or fetched)
      const today = new Date();
      const birthdayKey = 'lumied_birthday_' + nome;
      const lastCelebrated = localStorage.getItem(birthdayKey + '_celebrated');
      const todayStr = today.toISOString().slice(0, 10);

      // We can't know the birthday without DB query, but we can celebrate
      // if the school triggers it. Expose global function:
      window._celebrateBirthday = function (name) {
        if (localStorage.getItem(birthdayKey + '_celebrated') === todayStr) return;
        localStorage.setItem(birthdayKey + '_celebrated', todayStr);
        window._confetti(3000);
        setTimeout(() => {
          if (typeof window.__toast === 'function') {
            window.__toast('🎂 Feliz aniversário, ' + (name || nome) + '! Que seu dia seja incrível!', 'success', 8000);
          }
        }, 500);
      };
    }, 2000);
  }

  function addLoginQuote() {
    const quotes = [
      'Educação transforma o mundo. Você transforma educação.',
      'Cada aluno é uma história sendo escrita.',
      'Ensinar é tocar uma vida para sempre.',
      'O futuro pertence a quem educa hoje.',
      'Uma escola forte constrói uma comunidade forte.',
      'Inovação na educação começa com quem acredita.',
    ];
    setTimeout(() => {
      const loginCard = document.querySelector('.login-card');
      if (!loginCard) return;
      // Don't add if app shell is visible (user already logged in)
      const appShell = document.getElementById('appShell');
      if (appShell && appShell.style.display !== 'none') return;

      const existing = loginCard.querySelector('.login-quote');
      if (existing) return;

      const quote = quotes[Math.floor(Math.random() * quotes.length)];
      const el = document.createElement('p');
      el.className = 'login-quote';
      el.style.cssText = 'text-align:center;font-size:12px;color:var(--muted,#6b5f54);font-style:italic;margin-top:20px;line-height:1.5;opacity:.8;';
      el.textContent = '💡 ' + quote;
      loginCard.appendChild(el);
    }, 500);
  }

  // ═══════════════════════════════════════════════════
  // 8. WHO'S ONLINE — presença em tempo real
  // ═══════════════════════════════════════════════════
  function setupPresence() {
    if (portal !== 'gerente' && portal !== 'secretaria') return;

    // Inject presence container in topbar
    setTimeout(() => {
      const topbar = document.querySelector('.topbar');
      if (!topbar) return;

      const container = document.createElement('div');
      container.id = 'presenceAvatars';
      container.style.cssText = 'display:flex;align-items:center;gap:-4px;margin-right:8px;flex-shrink:0;';
      // Insert before the right-side buttons
      const rightSide = topbar.querySelector('div:last-child');
      if (rightSide) topbar.insertBefore(container, rightSide);

      // Track presence via Supabase Realtime (if available)
      trackPresence(container);
    }, 1000);
  }

  function trackPresence(container) {
    // Use the Supabase Realtime Presence if the client is available
    const anonKey = window.__SUPABASE_ANON || document.querySelector('meta[name="sb-anon"]')?.content;
    if (!anonKey || typeof supabase === 'undefined') return;

    try {
      const sb = supabase.createClient('https://brgorknbrjlfwvrrlwxj.supabase.co', anonKey, {
        realtime: { params: { eventsPerSecond: 2 } },
      });

      const userName = document.getElementById('userNome')?.textContent?.trim() || 'Anônimo';
      const userEmail = document.getElementById('userEmail')?.textContent?.trim() || '';

      const channel = sb.channel('online-users', { config: { presence: { key: userEmail || userName } } });

      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        renderPresence(container, state);
      });

      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            nome: userName,
            portal: portal,
            online_at: new Date().toISOString(),
          });
        }
      });

      // Update presence on panel change
      const origShowPanel = window.showPanel;
      if (typeof origShowPanel === 'function') {
        const _p = window.showPanel;
        window.showPanel = function (panelId, navItem) {
          _p(panelId, navItem);
          channel.track({
            nome: userName,
            portal: portal,
            painel: panelId,
            online_at: new Date().toISOString(),
          }).catch(() => {});
        };
      }
    } catch (e) {
      console.warn('[Presence] Failed to init:', e.message);
    }
  }

  function renderPresence(container, state) {
    const users = [];
    for (const [key, presences] of Object.entries(state)) {
      if (presences.length > 0) {
        users.push(presences[0]);
      }
    }
    // Show max 5 avatars + overflow count
    const max = 5;
    const visible = users.slice(0, max);
    const overflow = users.length - max;

    container.innerHTML = visible.map((u, i) => {
      const initials = (u.nome || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const colors = ['#C8102E', '#1a6bb5', '#2d7a3a', '#8b5cf6', '#d4830a'];
      const bg = colors[i % colors.length];
      const title = u.nome + (u.painel ? ' — ' + u.painel : '');
      return `<div title="${title}" style="width:28px;height:28px;border-radius:50%;background:${bg};color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid var(--white,#fff);margin-left:${i > 0 ? '-6px' : '0'};position:relative;z-index:${max - i};cursor:default;">${initials}</div>`;
    }).join('') + (overflow > 0 ? `<div style="width:28px;height:28px;border-radius:50%;background:var(--border,#e2dbd1);color:var(--muted,#6b5f54);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid var(--white,#fff);margin-left:-6px;">+${overflow}</div>` : '');
  }

  // ═══════════════════════════════════════════════════
  // 9. WHITE-LABEL — cor customizável + favicon dinâmico
  // ═══════════════════════════════════════════════════
  function setupWhiteLabel() {
    // After app loads, check for escola config
    setTimeout(async () => {
      try {
        const api = window.__api;
        if (!api) return;
        const d = await api.api({ action: 'config_publica' }, { cache: true, cacheTTL: 60000 });
        if (!d || d.error) return;

        // Custom primary color
        if (d.cor_primaria && d.cor_primaria !== '#C8102E') {
          document.documentElement.style.setProperty('--red', d.cor_primaria);
          document.documentElement.style.setProperty('--red-dark', darken(d.cor_primaria, 20));
          document.documentElement.style.setProperty('--red-light', d.cor_primaria + '14');
          // Update meta theme-color
          const meta = document.querySelector('meta[name="theme-color"]');
          if (meta) meta.content = d.cor_primaria;
        }

        // Custom favicon from logo
        if (d.escola_logo_url) {
          const link = document.querySelector('link[rel="icon"]') || document.createElement('link');
          link.rel = 'icon';
          link.href = d.escola_logo_url;
          if (!link.parentNode) document.head.appendChild(link);
        }

        // Custom page title
        if (d.escola_nome) {
          document.title = d.escola_nome + ' — Lumied';
        }

        // Show logo in sidebar
        if (d.escola_logo_url) {
          const logoImg = document.querySelector('.sb-logo-img');
          if (logoImg) {
            logoImg.src = d.escola_logo_url;
            logoImg.style.display = 'block';
          }
        }
      } catch (e) {
        // White-label is optional — never break the app
      }
    }, 2000);
  }

  function darken(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, (num >> 16) - amount);
    const g = Math.max(0, ((num >> 8) & 0xff) - amount);
    const b = Math.max(0, (num & 0xff) - amount);
    return '#' + (r << 16 | g << 8 | b).toString(16).padStart(6, '0');
  }

  // ═══════════════════════════════════════════════════
  // 10. INJECT CSS — animations
  // ═══════════════════════════════════════════════════
  function injectCSS() {
    const style = document.createElement('style');
    style.id = 'delight-css';
    style.textContent = `
      @keyframes shakeX {
        0%, 100% { transform: translateX(0); }
        10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
        20%, 40%, 60%, 80% { transform: translateX(4px); }
      }
      @keyframes glow {
        0%, 100% { box-shadow: 0 0 4px rgba(200,16,46,.2); }
        50% { box-shadow: 0 0 16px rgba(200,16,46,.4); }
      }
      .stat-card, .stats-card, [data-hover3d] {
        transition: transform .2s ease, box-shadow .2s ease;
      }
      /* Stagger animation for list items */
      .panel.entering tbody tr {
        animation: slideIn .3s ease both;
      }
      .panel.entering tbody tr:nth-child(1) { animation-delay: .0s; }
      .panel.entering tbody tr:nth-child(2) { animation-delay: .03s; }
      .panel.entering tbody tr:nth-child(3) { animation-delay: .06s; }
      .panel.entering tbody tr:nth-child(4) { animation-delay: .09s; }
      .panel.entering tbody tr:nth-child(5) { animation-delay: .12s; }
      .panel.entering tbody tr:nth-child(n+6) { animation-delay: .15s; }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════
  function init() {
    injectCSS();
    setupCountUp();
    setupHover3D();
    setupShortcuts();
    setupSmartDefaults();
    setupEasterEggs();
    setupPresence();
    setupWhiteLabel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
