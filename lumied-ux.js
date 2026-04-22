// ═══════════════════════════════════════════════════════
//  Lumied UX Kit — Onboarding, Empty States, Confirmações,
//  Validação, Feedback, Touch targets, Busca sidebar
//  Incluir em todos os portais: <script src="/lumied-ux.js" defer>
// ═══════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Detectar portal ────────────────────────────────
  const path = location.pathname;
  let portal = 'pais';
  if (path.includes('gerente')) portal = 'gerente';
  else if (path.includes('professora')) portal = 'professora';
  else if (path.includes('aluno')) portal = 'aluno';
  else if (path.includes('secretaria')) portal = 'secretaria';
  else if (path.includes('admin')) portal = 'admin';

  // ═══════════════════════════════════════════════════
  // 1. ONBOARDING — Tour de primeiro uso
  // ═══════════════════════════════════════════════════
  const TOUR_KEY = `lumied_tour_${portal}`;

  const tourSteps = {
    pais: [
      { title: 'Bem-vindo ao Portal dos Pais! 👋', text: 'Aqui você acompanha notas, frequência, boletos e comunicados do seu filho.', icon: '🏠' },
      { title: 'Menu inferior', text: 'Use os botões na parte de baixo da tela para navegar entre as seções.', icon: '👇' },
      { title: 'Boletos e pagamentos', text: 'Acesse a seção "Boletos" para ver pendências e pagar via PIX.', icon: '💰' },
      { title: 'Precisa de ajuda?', text: 'Clique no botão "?" no canto inferior para falar com o suporte.', icon: '❓' },
    ],
    professora: [
      { title: 'Bem-vinda, professora! 👩‍🏫', text: 'Este é seu painel para chamada, notas, agenda digital e comunicação com famílias.', icon: '📚' },
      { title: 'Chamada rápida', text: 'Acesse "Chamada" no menu para registrar a frequência da turma em segundos.', icon: '✅' },
      { title: 'Agenda Digital', text: 'Envie recados com fotos para os pais. Eles recebem na hora!', icon: '📸' },
      { title: 'Notas', text: 'Lance notas no grid — a média é calculada automaticamente.', icon: '📝' },
    ],
    aluno: [
      { title: 'Portal do Aluno 🎓', text: 'Confira suas notas, frequência e provas neste painel.', icon: '📊' },
      { title: 'Navegação', text: 'Use os botões na parte inferior para trocar entre Notas, Frequência e Provas.', icon: '👇' },
      { title: 'Média para aprovação', text: 'Média ≥ 7.0 = Aprovado. Abaixo de 7.0 = Recuperação.', icon: '📌' },
    ],
    gerente: [
      { title: 'Painel do Gerente 👔', text: 'Aqui você gerencia tudo: alunos, financeiro, CRM, professoras e mais.', icon: '🏫' },
      { title: 'Sidebar', text: 'Use o menu à esquerda para navegar. As seções se expandem ao clicar.', icon: '📋' },
      { title: 'Dashboard', text: 'O dashboard mostra os números mais importantes da escola em tempo real.', icon: '📊' },
      { title: 'Busca rápida', text: 'Use a barra de busca no topo do menu para encontrar qualquer seção rapidamente.', icon: '🔍' },
    ],
    secretaria: [
      { title: 'Portal da Secretaria 📋', text: 'Gerencie atestados, documentos e solicitações das professoras.', icon: '🏥' },
      { title: 'Atestados', text: 'Revise atestados pendentes e aprove ou rejeite com observações.', icon: '✅' },
    ],
    admin: [
      { title: 'Painel Admin Lumied ⚙️', text: 'Gerencie escolas, planos, módulos e monitore o sistema.', icon: '🔧' },
      { title: 'Configuração', text: 'Acesse "Configuração" para definir tokens de API e ativar integrações.', icon: '🔑' },
    ],
  };

  function showOnboarding() {
    if (localStorage.getItem(TOUR_KEY)) return;
    const steps = tourSteps[portal];
    if (!steps || steps.length === 0) return;

    // Esperar o app carregar
    setTimeout(() => {
      let current = 0;
      const overlay = document.createElement('div');
      overlay.id = 'lumiedTourOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-family:"DM Sans",system-ui,sans-serif;';

      function render() {
        const s = steps[current];
        const isLast = current === steps.length - 1;
        overlay.innerHTML = `
          <div style="background:#fff;border-radius:20px;padding:36px 32px;max-width:400px;width:90%;text-align:center;animation:popIn .3s ease;box-shadow:0 24px 60px rgba(0,0,0,.3);">
            <div style="font-size:48px;margin-bottom:16px;">${s.icon}</div>
            <h2 style="font-size:20px;font-weight:800;margin-bottom:8px;color:#1a1a1a;">${s.title}</h2>
            <p style="font-size:14px;color:#7a7169;line-height:1.6;margin-bottom:24px;">${s.text}</p>
            <div style="display:flex;justify-content:center;gap:6px;margin-bottom:20px;">
              ${steps.map((_, i) => `<div style="width:8px;height:8px;border-radius:50%;background:${i === current ? '#C8102E' : '#e2dbd1'};"></div>`).join('')}
            </div>
            <div style="display:flex;gap:10px;justify-content:center;">
              <button onclick="document.getElementById('lumiedTourOverlay').remove();localStorage.setItem('${TOUR_KEY}','1')" style="padding:10px 20px;background:#f0ece6;border:none;border-radius:10px;font-size:13px;cursor:pointer;font-family:inherit;color:#7a7169;">Pular</button>
              <button id="tourNextBtn" style="padding:10px 24px;background:#C8102E;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">${isLast ? 'Começar! 🚀' : 'Próximo →'}</button>
            </div>
          </div>
        `;
        document.getElementById('tourNextBtn').onclick = () => {
          if (isLast) {
            overlay.remove();
            localStorage.setItem(TOUR_KEY, '1');
          } else {
            current++;
            render();
          }
        };
      }

      render();
      document.body.appendChild(overlay);
    }, 1500);
  }

  // ═══════════════════════════════════════════════════
  // 2. EMPTY STATES — Substituir "Carregando..." genérico
  // ═══════════════════════════════════════════════════
  function improveEmptyStates() {
    const observer = new MutationObserver(() => {
      document.querySelectorAll('.empty-state, .empty').forEach(el => {
        const text = el.textContent.trim();
        if (text === 'Carregando...' || text === 'Carregando') {
          el.innerHTML = '<div style="padding:20px;text-align:center;"><div style="font-size:32px;margin-bottom:8px;animation:spin 1s linear infinite;">⏳</div><div style="color:#7a7169;font-size:13px;">Buscando dados...</div></div>';
        }
        if (text === 'Nenhum dado' || text === 'Nenhum dado encontrado' || text === 'Nenhum resultado') {
          el.innerHTML = '<div style="padding:30px;text-align:center;"><div style="font-size:40px;margin-bottom:12px;">📭</div><div style="color:#7a7169;font-size:14px;line-height:1.6;">Nenhum dado por aqui ainda.<br><span style="font-size:12px;">Os dados aparecerão assim que forem cadastrados.</span></div></div>';
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ═══════════════════════════════════════════════════
  // 3. CONFIRMAÇÃO para ações destrutivas
  // ═══════════════════════════════════════════════════
  window._lumiedConfirm = function (msg, onConfirm) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-family:inherit;';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:28px;max-width:380px;width:90%;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.2);">
          <div style="font-size:36px;margin-bottom:12px;">⚠️</div>
          <h3 style="font-size:16px;font-weight:700;margin-bottom:8px;">Tem certeza?</h3>
          <p style="font-size:13px;color:#7a7169;line-height:1.5;margin-bottom:20px;">${msg}</p>
          <div style="display:flex;gap:10px;justify-content:center;">
            <button class="lumiedConfirmCancelBtn" style="padding:10px 20px;background:#f0ece6;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;">Cancelar</button>
            <button class="lumiedConfirmOkBtn" style="padding:10px 20px;background:#C8102E;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">Confirmar</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelector('.lumiedConfirmCancelBtn').onclick = () => { overlay.remove(); resolve(false); };
      overlay.querySelector('.lumiedConfirmOkBtn').onclick = () => { overlay.remove(); if (onConfirm) onConfirm(); resolve(true); };
    });
  };

  // ═══════════════════════════════════════════════════
  // 4. VALIDAÇÃO INLINE nos formulários
  // ═══════════════════════════════════════════════════
  function setupInlineValidation() {
    document.addEventListener('blur', (e) => {
      const input = e.target;
      if (!input.matches('input[required], input[type="email"]')) return;
      // Ignorar tela de login — nao validar campos de login
      if (input.closest('#loginScreen, #loginWall, .login-card, #loginForm')) return;
      clearValidation(input);

      if (input.required && !input.value.trim()) {
        showValidation(input, 'Este campo é obrigatório', 'error');
      } else if (input.type === 'email' && input.value && !input.value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        showValidation(input, 'E-mail inválido', 'error');
      } else if (input.value.trim()) {
        showValidation(input, '✓', 'success');
      }
    }, true);
  }

  function showValidation(input, msg, type) {
    input.style.borderColor = type === 'error' ? '#C8102E' : '#2d7a3a';
    const hint = document.createElement('div');
    hint.className = 'lumied-validation';
    hint.style.cssText = `font-size:11px;margin-top:3px;color:${type === 'error' ? '#C8102E' : '#2d7a3a'};`;
    hint.textContent = msg;
    input.parentElement.appendChild(hint);
  }

  function clearValidation(input) {
    input.style.borderColor = '';
    input.parentElement.querySelectorAll('.lumied-validation').forEach(el => el.remove());
  }

  // ═══════════════════════════════════════════════════
  // 5. FEEDBACK DE SUCESSO — toast global
  // ═══════════════════════════════════════════════════
  if (!window.showToast) {
    window.showToast = function (msg, type = 'info', duration = 3500) {
      let c = document.getElementById('lumiedToasts');
      if (!c) {
        c = document.createElement('div');
        c.id = 'lumiedToasts';
        c.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99997;display:flex;flex-direction:column;gap:8px;max-width:360px;pointer-events:none;';
        document.body.appendChild(c);
      }
      const colors = { success: '#2d7a3a', error: '#C8102E', info: '#1a6bb5', warning: '#d4830a' };
      const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
      const t = document.createElement('div');
      t.style.cssText = `pointer-events:auto;background:${colors[type] || colors.info};color:#fff;padding:12px 18px;border-radius:10px;font-family:'DM Sans',system-ui,sans-serif;font-size:13px;font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,.2);animation:slideIn .3s ease;display:flex;align-items:center;gap:8px;`;
      t.innerHTML = `<span>${icons[type] || ''}</span> ${msg}`;
      c.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, duration);
    };
  }

  // Toast de erro com ação opcional ("Tentar novamente")
  if (!window.showError) {
    window.showError = function (msg, onRetry) {
      let c = document.getElementById('lumiedToasts');
      if (!c) {
        c = document.createElement('div');
        c.id = 'lumiedToasts';
        c.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99997;display:flex;flex-direction:column;gap:8px;max-width:360px;pointer-events:none;';
        document.body.appendChild(c);
      }
      const t = document.createElement('div');
      t.style.cssText = `pointer-events:auto;background:#C8102E;color:#fff;padding:12px 18px;border-radius:10px;font-family:'DM Sans',system-ui,sans-serif;font-size:13px;font-weight:500;box-shadow:0 4px 20px rgba(0,0,0,.2);display:flex;align-items:center;gap:10px;`;
      const txt = document.createElement('span');
      txt.innerHTML = `❌ ${msg}`;
      t.appendChild(txt);
      if (typeof onRetry === 'function') {
        const btn = document.createElement('button');
        btn.textContent = 'Tentar novamente';
        btn.style.cssText = 'background:rgba(255,255,255,.2);color:#fff;border:0;padding:6px 12px;border-radius:6px;font:inherit;cursor:pointer;';
        btn.onclick = () => { t.remove(); onRetry(); };
        t.appendChild(btn);
      }
      c.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 6000);
    };
  }

  // ═══════════════════════════════════════════════════
  // 6. TOUCH TARGETS — aumentar áreas clicáveis no mobile
  // ═══════════════════════════════════════════════════
  function fixTouchTargets() {
    if (window.innerWidth > 768) return;
    const style = document.createElement('style');
    style.textContent = `
      .bnav-item, .nav-item, .action-btn, .login-btn, .btn-primary, .btn-secondary,
      button, a[onclick], [role="button"] {
        min-height: 44px !important;
        min-width: 44px !important;
      }
      .bnav { padding: 8px 4px !important; }
      .bnav-item { padding: 10px 8px !important; font-size: 11px !important; }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════
  // 7. BUSCA NA SIDEBAR (gerente)
  // ═══════════════════════════════════════════════════
  function addSidebarSearch() {
    if (portal !== 'gerente') return;
    const nav = document.querySelector('.sb-nav');
    if (!nav) return;

    const search = document.createElement('div');
    search.style.cssText = 'padding:0 0 12px;';
    search.innerHTML = `<input type="text" id="sidebarSearch" placeholder="🔍 Buscar painel..." style="width:100%;padding:9px 12px;border:1px solid rgba(255,255,255,.15);border-radius:8px;background:rgba(255,255,255,.06);color:#fff;font-size:12px;font-family:inherit;outline:none;" oninput="window._filterSidebar(this.value)">`;
    nav.insertBefore(search, nav.firstChild);

    window._filterSidebar = function (q) {
      const query = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      nav.querySelectorAll('.nav-item').forEach(item => {
        const text = item.textContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        item.style.display = text.includes(query) ? '' : 'none';
      });
      nav.querySelectorAll('.sb-label').forEach(label => {
        const section = label.nextElementSibling;
        if (section && query) {
          section.classList.remove('collapsed');
          label.querySelector('.sb-arrow')?.classList.remove('collapsed');
        }
      });
      nav.querySelectorAll('[data-modulo]').forEach(group => {
        const hasVisible = group.querySelector('.nav-item:not([style*="display: none"])');
        group.style.display = hasVisible || !query ? '' : 'none';
      });
    };
  }

  // ═══════════════════════════════════════════════════
  // 8. USAGE ANALYTICS — track tab/panel usage for smart ordering
  // ═══════════════════════════════════════════════════
  function setupUsageTracking() {
    const USAGE_KEY = `lumied_usage_${portal}`;
    const TAB_ORDER_KEY = `lumied_tab_order_${portal}`;

    // Track clicks on navigation items
    document.addEventListener('click', (e) => {
      const navItem = e.target.closest('.nav-item, .bnav-item');
      if (!navItem) return;
      const tab = navItem.dataset.tab;
      const onclick = navItem.getAttribute('onclick') || '';
      const id = tab || onclick.match(/(?:showPanel|switchTab)\('([^']+)'/)?.[1];
      if (!id) return;
      try {
        const usage = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}');
        usage[id] = (usage[id] || 0) + 1;
        localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
      } catch {}
    });

    // For pais portal: reorder bottom nav based on usage
    if (portal === 'pais') {
      reorderPaisNav();
    }
  }

  function reorderPaisNav() {
    const USAGE_KEY = `lumied_usage_pais`;
    const bottomNav = document.getElementById('bottomNav');
    if (!bottomNav) return;

    try {
      const usage = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}');
      const total = Object.values(usage).reduce((a, b) => a + b, 0);
      if (total < 8) return; // Not enough data

      // Get all tab buttons (excluding "Mais" button)
      const buttons = Array.from(bottomNav.querySelectorAll('.bnav-item'));
      const maisBtn = buttons.find(b => b.id === 'paisMoreBtn');
      const tabButtons = buttons.filter(b => b !== maisBtn && b.dataset.tab);

      // Sort by usage (descending), keep top 4 visible
      tabButtons.sort((a, b) => (usage[b.dataset.tab] || 0) - (usage[a.dataset.tab] || 0));

      // The most used tabs go first in the bottom nav
      const fragment = document.createDocumentFragment();
      tabButtons.forEach(btn => fragment.appendChild(btn));
      if (maisBtn) fragment.appendChild(maisBtn);
      bottomNav.innerHTML = '';
      bottomNav.appendChild(fragment);
    } catch {}
  }

  // ═══════════════════════════════════════════════════
  // 9. CSS GLOBAL — animações e melhorias
  // ═══════════════════════════════════════════════════
  function injectGlobalCSS() {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
      @keyframes popIn { from { opacity:0; transform:scale(.92) translateY(12px); } to { opacity:1; transform:scale(1) translateY(0); } }
      @keyframes spin { to { transform:rotate(360deg); } }
      @keyframes shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
      @keyframes panelIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      .lumied-validation { transition: opacity .2s; }
      input:focus, select:focus, textarea:focus { outline: none; }

      /* ── Skeleton loaders ── */
      .skel-row { display:flex; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border,#e2dbd1); }
      .skel-cell { height:14px; border-radius:6px; background:linear-gradient(90deg,#ede8e1 25%,#f5f1ec 50%,#ede8e1 75%); background-size:800px 100%; animation:shimmer 1.5s infinite linear; }
      .skel-cell:nth-child(1) { width:30%; }
      .skel-cell:nth-child(2) { width:20%; }
      .skel-cell:nth-child(3) { width:25%; }
      .skel-cell:nth-child(4) { width:15%; }
      .skel-cell:nth-child(5) { width:10%; }
      .skel-header { height:12px; opacity:.5; margin-bottom:4px; }

      /* ── Panel transitions ── */
      .panel.entering { animation: panelIn .25s ease both; }

      /* ── Command palette (Ctrl+K) ── */
      .cmd-overlay { position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding-top:min(20vh,120px);backdrop-filter:blur(4px);font-family:'DM Sans',system-ui,sans-serif; }
      .cmd-box { background:#fff;border-radius:16px;width:100%;max-width:520px;box-shadow:0 24px 80px rgba(0,0,0,.35);overflow:hidden;animation:popIn .2s ease; }
      .cmd-input { width:100%;padding:16px 20px;border:none;font-size:15px;font-family:inherit;outline:none;background:transparent;border-bottom:1px solid var(--border,#e2dbd1); }
      .cmd-results { max-height:360px;overflow-y:auto;padding:6px; }
      .cmd-item { display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;cursor:pointer;font-size:13px;color:var(--text,#1a1a1a);transition:background .1s; }
      .cmd-item:hover,.cmd-item.active { background:var(--red-light,rgba(200,16,46,.08)); }
      .cmd-item .cmd-ic { width:24px;text-align:center;font-size:16px;flex-shrink:0; }
      .cmd-item .cmd-label { flex:1; }
      .cmd-item .cmd-hint { font-size:11px;color:var(--muted,#5a5249);flex-shrink:0; }
      .cmd-empty { padding:24px;text-align:center;color:var(--muted,#888);font-size:13px; }
      .cmd-footer { padding:8px 14px;border-top:1px solid var(--border,#e2dbd1);display:flex;gap:12px;font-size:11px;color:var(--muted,#888); }
      .cmd-footer kbd { background:#f0ece6;padding:2px 6px;border-radius:4px;font-family:inherit;font-size:10px;border:1px solid #ddd; }
      .cmd-ai-thinking { padding:20px;text-align:center;color:#7c3aed;font-size:13px; }
      .cmd-ai-result { padding:10px; }
      .cmd-ai-bubble { background:linear-gradient(135deg,rgba(88,28,135,.07),rgba(139,92,246,.05));border:1px solid rgba(139,92,246,.2);border-radius:12px;padding:14px;font-size:13px;line-height:1.6;color:var(--text,#1a1a1a); }
      .cmd-ai-bubble .lumi-label { font-size:11px;font-weight:700;color:#7c3aed;margin-bottom:6px;letter-spacing:.04em; }
      .cmd-ai-bubble .lumi-text { white-space:pre-wrap; }
      .cmd-ai-goto { display:inline-flex;align-items:center;gap:4px;margin-top:10px;padding:5px 12px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit; }
      .cmd-ai-goto:hover { background:#6d28d9; }
      .cmd-ai-error { padding:14px;color:#dc2626;font-size:13px;text-align:center; }
      .cmd-box.cmd-ai-mode { border-top:3px solid #7c3aed; }
      .cmd-input.ai-active { border-bottom-color:#7c3aed; }
      body.theme-dark .cmd-ai-bubble { background:linear-gradient(135deg,rgba(139,92,246,.1),rgba(88,28,135,.08));border-color:rgba(139,92,246,.3); }

      /* ── Pagination ── */
      .lm-pagination { display:flex;align-items:center;justify-content:space-between;padding:12px 0;font-size:12px;color:var(--muted,#888);font-family:'DM Sans',system-ui,sans-serif; }
      .lm-pagination button { padding:6px 14px;border:1px solid var(--border,#e2dbd1);border-radius:8px;background:#fff;font-size:12px;cursor:pointer;font-family:inherit;transition:all .2s; }
      .lm-pagination button:hover:not(:disabled) { border-color:var(--red,#C8102E);color:var(--red,#C8102E); }
      .lm-pagination button:disabled { opacity:.4;cursor:not-allowed; }

      /* ── Dark mode ── */
      body.theme-dark { --bg:#1a1714;--white:#252220;--text:#e8e2da;--muted:#a09889;--border:#3a3530;--red:#e85566;--red-dark:#c7394a;--red-light:rgba(232,85,102,.1);--green:#5cb85c;--blue:#5bc0de; }
      body.theme-dark .sidebar { background:linear-gradient(180deg,#141210 0%,#1e1b18 100%); }
      body.theme-dark .topbar { background:rgba(37,34,32,.92);border-color:var(--border); }
      body.theme-dark .login-card { background:var(--white);box-shadow:0 24px 60px rgba(0,0,0,.5); }
      body.theme-dark table th { background:rgba(255,255,255,.04); }
      body.theme-dark .stats-card,.dark-card { background:var(--white);border-color:var(--border); }
      body.theme-dark input,body.theme-dark select,body.theme-dark textarea { background:rgba(255,255,255,.04);border-color:var(--border);color:var(--text); }
      body.theme-dark .modal { background:var(--white);color:var(--text); }
      body.theme-dark .skel-cell { background:linear-gradient(90deg,#2a2520 25%,#353028 50%,#2a2520 75%);background-size:800px 100%; }
      body.theme-dark .cmd-box { background:#252220; }
      body.theme-dark .cmd-input { color:#e8e2da;border-color:#3a3530; }

      /* ── Dark mode toggle ── */
      .dark-toggle { background:none;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:4px 8px;cursor:pointer;font-size:16px;line-height:1;transition:all .2s; }
      .dark-toggle:hover { background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.2); }

      /* ── Breadcrumb ── */
      .lm-breadcrumb { display:flex;align-items:center;gap:4px;font-size:11px;color:var(--muted,#888); }
      .lm-breadcrumb a { color:var(--blue,#1a6bb5);text-decoration:none;cursor:pointer; }
      .lm-breadcrumb a:hover { text-decoration:underline; }
      .lm-breadcrumb .sep { opacity:.4; }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════
  // 10. SKELETON LOADERS — show shimmer while loading
  // ═══════════════════════════════════════════════════
  window._showSkeleton = function (container, rows = 5, cols = 4) {
    let html = '<div class="skel-header skel-row">';
    for (let c = 0; c < cols; c++) html += '<div class="skel-cell" style="height:10px;"></div>';
    html += '</div>';
    for (let r = 0; r < rows; r++) {
      html += '<div class="skel-row">';
      for (let c = 0; c < cols; c++) html += '<div class="skel-cell"></div>';
      html += '</div>';
    }
    if (typeof container === 'string') container = document.getElementById(container);
    if (container) container.innerHTML = html;
  };

  // ═══════════════════════════════════════════════════
  // 11. COMMAND PALETTE (Ctrl+K)
  // ═══════════════════════════════════════════════════
  function setupCommandPalette() {
    if (portal !== 'gerente') return;

    function getNavItems() {
      const items = [];
      document.querySelectorAll('.nav-item').forEach(el => {
        const onclick = el.getAttribute('onclick') || '';
        const match = onclick.match(/showPanel\('([^']+)'/);
        if (!match) return;
        const panel = match[1];
        const icon = el.querySelector('.ic')?.textContent || '📄';
        const label = el.textContent.trim().replace(icon, '').trim();
        let section = '';
        const sectionEl = el.closest('.sb-section');
        if (sectionEl) {
          const labelEl = sectionEl.previousElementSibling;
          if (labelEl?.classList?.contains('sb-label')) section = labelEl.textContent.replace('▼', '').trim();
        }
        items.push({ panel, icon, label, section, element: el });
      });
      return items;
    }

    function openPalette() {
      if (document.getElementById('cmdPalette')) return;
      const allItems = getNavItems();
      let activeIdx = 0;
      let aiDebounce = null;
      let aiQueryPending = null;

      const overlay = document.createElement('div');
      overlay.id = 'cmdPalette';
      overlay.className = 'cmd-overlay';
      overlay.innerHTML = `
        <div class="cmd-box">
          <input class="cmd-input" placeholder="Buscar painel ou ? perguntar para Lumi..." autofocus>
          <div class="cmd-results"></div>
          <div class="cmd-footer"><span><kbd>↑↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span><kbd>?</kbd> modo IA</span><span><kbd>Esc</kbd> fechar</span></div>
        </div>
      `;
      document.body.appendChild(overlay);

      const box = overlay.querySelector('.cmd-box');
      const input = overlay.querySelector('.cmd-input');
      const results = overlay.querySelector('.cmd-results');

      function normalize(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

      function isAiQuery(q) {
        if (!q) return false;
        const l = q.toLowerCase().trim();
        if (l.startsWith('?') || l.startsWith('/lumi')) return true;
        const aiWords = ['quem ', 'quantos ', 'quais ', 'mostre ', 'liste ', 'qual é', 'como está', 'quando ', 'me diga', 'me mostre', 'me liste', 'analise ', 'busque ', 'buscar ', 'encontre '];
        return aiWords.some(w => l.includes(w));
      }

      function showAiResult(resposta, _dados) {
        const panelMap = {};
        allItems.forEach(i => { panelMap[normalize(i.label)] = i.panel; });
        let gotoPanel = null;
        const normalResp = normalize(resposta);
        for (const [label, panel] of Object.entries(panelMap)) {
          if (label.length > 3 && normalResp.includes(label)) { gotoPanel = panel; break; }
        }
        const safe = resposta.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const gotoBtn = gotoPanel ? `<button class="cmd-ai-goto" data-panel="${gotoPanel}">Ir para painel →</button>` : '';
        results.innerHTML = `
          <div class="cmd-ai-result">
            <div class="cmd-ai-bubble">
              <div class="lumi-label">🧠 Lumi</div>
              <div class="lumi-text">${safe}</div>
              ${gotoBtn}
            </div>
          </div>`;
        if (gotoPanel) {
          results.querySelector('.cmd-ai-goto').addEventListener('click', () => go(gotoPanel));
        }
      }

      async function askLumi(query) {
        box.classList.add('cmd-ai-mode');
        input.classList.add('ai-active');
        results.innerHTML = '<div class="cmd-ai-thinking">🧠 Lumi está pensando...</div>';

        const apiFn = typeof window.api === 'function' ? window.api : null;
        if (!apiFn) {
          results.innerHTML = '<div class="cmd-ai-error">Erro: API indisponível.</div>';
          return;
        }

        // Client-side timeout display (edge fn has its own 10s timeout)
        const timeoutId = setTimeout(() => {
          results.innerHTML = '<div class="cmd-ai-error">Tempo esgotado. Tente uma pergunta mais simples.</div>';
        }, 11000);

        try {
          const d = await apiFn({ action: 'ia_consulta_rapida', pergunta: query });
          clearTimeout(timeoutId);
          if (!d || d.error) {
            const msg = (d?.error || 'Erro desconhecido').replace(/&/g, '&amp;').replace(/</g, '&lt;');
            results.innerHTML = `<div class="cmd-ai-error">${msg}</div>`;
            return;
          }
          showAiResult(d.resposta || 'Sem resposta.', d.dados);
        } catch {
          clearTimeout(timeoutId);
          results.innerHTML = '<div class="cmd-ai-error">Erro ao conectar com Lumi. Tente novamente.</div>';
        }
      }

      function render(query) {
        const q = normalize(query);
        const rawQuery = query.trim();

        if (rawQuery && isAiQuery(rawQuery)) {
          if (aiDebounce) clearTimeout(aiDebounce);
          box.classList.add('cmd-ai-mode');
          input.classList.add('ai-active');
          results.innerHTML = '<div class="cmd-ai-thinking">🧠 Lumi está pensando...</div>';
          aiQueryPending = rawQuery;
          aiDebounce = setTimeout(() => {
            if (aiQueryPending === rawQuery) askLumi(rawQuery);
          }, 500);
          return;
        }

        if (aiDebounce) { clearTimeout(aiDebounce); aiDebounce = null; }
        aiQueryPending = null;
        box.classList.remove('cmd-ai-mode');
        input.classList.remove('ai-active');

        const filtered = q ? allItems.filter(i => normalize(i.label).includes(q) || normalize(i.section).includes(q)) : allItems;
        activeIdx = 0;
        if (filtered.length === 0) {
          results.innerHTML = '<div class="cmd-empty">Nenhum painel encontrado.</div>';
          return;
        }
        results.innerHTML = filtered.map((item, i) =>
          `<div class="cmd-item${i === 0 ? ' active' : ''}" data-panel="${item.panel}" data-idx="${i}">
            <span class="cmd-ic">${item.icon}</span>
            <span class="cmd-label">${item.label}</span>
            <span class="cmd-hint">${item.section}</span>
          </div>`
        ).join('');

        results.querySelectorAll('.cmd-item').forEach(el => {
          el.addEventListener('click', () => { go(el.dataset.panel); });
          el.addEventListener('mouseenter', () => {
            results.querySelector('.cmd-item.active')?.classList.remove('active');
            el.classList.add('active');
            activeIdx = parseInt(el.dataset.idx);
          });
        });
      }

      function go(panel) {
        closePalette();
        const navItem = document.querySelector(`.nav-item[onclick*="showPanel('${panel}'"]`);
        if (navItem) navItem.click();
        else if (typeof window.showPanel === 'function') window.showPanel(panel);
      }

      function closePalette() {
        if (aiDebounce) clearTimeout(aiDebounce);
        overlay.remove();
      }

      input.addEventListener('input', () => render(input.value));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closePalette(); });
      input.addEventListener('keydown', (e) => {
        const items = results.querySelectorAll('.cmd-item');
        if (e.key === 'Escape') { closePalette(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); }
        if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); }
        if (e.key === 'Enter') { const active = results.querySelector('.cmd-item.active'); if (active) go(active.dataset.panel); return; }
        items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
        items[activeIdx]?.scrollIntoView({ block: 'nearest' });
      });

      render('');
      input.focus();
    }

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openPalette();
      }
    });

    // Also expose globally
    window._openCommandPalette = openPalette;
  }

  // ═══════════════════════════════════════════════════
  // 12. PANEL TRANSITIONS — smooth fade on switch
  // ═══════════════════════════════════════════════════
  function setupPanelTransitions() {
    const origShowPanel = window.showPanel;
    if (typeof origShowPanel !== 'function') return;

    window.showPanel = function (panelId, navItem) {
      // Hide current active panel
      const current = document.querySelector('.panel.active');
      if (current && current.id !== panelId) {
        current.classList.remove('active', 'entering');
      }
      // Call original showPanel
      origShowPanel(panelId, navItem);
      // Animate new panel
      const next = document.getElementById(panelId);
      if (next) {
        next.classList.remove('entering');
        void next.offsetWidth; // force reflow
        next.classList.add('entering');
      }
    };
  }

  // ═══════════════════════════════════════════════════
  // 13. DARK MODE TOGGLE
  // ═══════════════════════════════════════════════════
  function setupDarkMode() {
    const DARK_KEY = 'lumied_dark_mode';
    const saved = localStorage.getItem(DARK_KEY);
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
    let isDark = saved === '1' || (saved === null && prefersDark);

    function apply() {
      document.body.classList.toggle('theme-dark', isDark);
      const toggle = document.getElementById('darkToggle');
      if (toggle) toggle.textContent = isDark ? '☀️' : '🌙';
    }

    window._toggleDarkMode = function () {
      isDark = !isDark;
      localStorage.setItem(DARK_KEY, isDark ? '1' : '0');
      apply();
    };

    // Inject toggle button into sidebar footer
    setTimeout(() => {
      const footer = document.querySelector('.sb-footer');
      if (footer) {
        const btn = document.createElement('button');
        btn.id = 'darkToggle';
        btn.className = 'dark-toggle';
        btn.title = 'Modo escuro';
        btn.onclick = window._toggleDarkMode;
        footer.insertBefore(btn, footer.firstChild);
      }
      apply();
    }, 500);
  }

  // ═══════════════════════════════════════════════════
  // 14. BREADCRUMBS
  // ═══════════════════════════════════════════════════
  function setupBreadcrumbs() {
    if (portal !== 'gerente') return;
    const origShowPanel = window.showPanel;
    if (typeof origShowPanel !== 'function') return;

    const panelHistory = [{ id: 'analytics', label: 'Dashboard' }];

    const _prevShowPanel = window.showPanel;
    window.showPanel = function (panelId, navItem) {
      _prevShowPanel(panelId, navItem);
      // Find label
      let label = panelId;
      if (navItem) {
        const text = navItem.textContent?.trim();
        const ic = navItem.querySelector('.ic')?.textContent || '';
        label = text.replace(ic, '').trim();
      }
      // Update breadcrumb trail
      const existing = panelHistory.findIndex(h => h.id === panelId);
      if (existing >= 0) panelHistory.length = existing + 1;
      else panelHistory.push({ id: panelId, label });
      if (panelHistory.length > 4) panelHistory.splice(1, panelHistory.length - 4);
      renderBreadcrumb();
    };

    function renderBreadcrumb() {
      const el = document.getElementById('breadcrumb');
      if (!el) return;
      el.innerHTML = panelHistory.map((h, i) => {
        if (i === panelHistory.length - 1) return `<span>${h.label}</span>`;
        return `<a onclick="showPanel('${h.id}')">${h.label}</a><span class="sep">›</span>`;
      }).join(' ');
      el.className = 'lm-breadcrumb';
    }
  }

  // ═══════════════════════════════════════════════════
  // 15. KEYBOARD SHORTCUTS — Enter to submit modals
  // ═══════════════════════════════════════════════════
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Enter → confirm modal (if no textarea focused)
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        if (document.activeElement?.tagName === 'TEXTAREA') return;
        const modal = document.querySelector('.modal-overlay[style*="flex"]');
        if (modal) {
          const confirmBtn = modal.querySelector('.modal-confirm, .lumiedConfirmOkBtn');
          if (confirmBtn && document.activeElement?.tagName !== 'INPUT') {
            e.preventDefault();
            confirmBtn.click();
          }
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════
  // 16. LANG SWITCHER — fallback injection for portals
  //     without a portal-init.js bundle
  // ═══════════════════════════════════════════════════
  function setupLangSwitcher() {
    // Skip if already injected by portal-init.js
    if (document.querySelector('.lang-switcher')) return;

    const STORAGE_KEY = 'lumied_lang';
    const STYLES = `
.lang-switcher{display:inline-flex;align-items:center;gap:2px;background:rgba(0,0,0,.2);border-radius:8px;padding:3px;flex-shrink:0;}
.lang-btn{padding:4px 10px;border:none;background:transparent;color:rgba(255,255,255,.55);font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;cursor:pointer;border-radius:6px;transition:all .2s;white-space:nowrap;line-height:1.4;}
.lang-btn:hover{background:rgba(255,255,255,.1);color:rgba(255,255,255,.9);}
.lang-btn.active{background:rgba(255,255,255,.14);color:#fff;}
`;

    if (!document.getElementById('lang-switcher-styles')) {
      const style = document.createElement('style');
      style.id = 'lang-switcher-styles';
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'lang-switcher';
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-label', 'Language / Idioma');

    const ptBtn = document.createElement('button');
    ptBtn.className = 'lang-btn';
    ptBtn.setAttribute('data-lang', 'pt-BR');
    ptBtn.setAttribute('aria-label', 'Português (Brasil)');
    ptBtn.textContent = '🇧🇷 PT';

    const enBtn = document.createElement('button');
    enBtn.className = 'lang-btn';
    enBtn.setAttribute('data-lang', 'en');
    enBtn.setAttribute('aria-label', 'English');
    enBtn.textContent = '🇺🇸 EN';

    function getCurrentLocale() {
      try { return localStorage.getItem(STORAGE_KEY) || 'pt-BR'; } catch (_) { return 'pt-BR'; }
    }

    function syncButtons() {
      const locale = getCurrentLocale();
      ptBtn.classList.toggle('active', locale === 'pt-BR');
      enBtn.classList.toggle('active', locale === 'en');
    }

    function switchLocale(lang) {
      try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
      syncButtons();
      // Use bundle-exposed translatePage if available, otherwise reload
      if (typeof window.__translatePage === 'function') {
        window.__translatePage();
      } else {
        location.reload();
      }
    }

    ptBtn.addEventListener('click', () => switchLocale('pt-BR'));
    enBtn.addEventListener('click', () => switchLocale('en'));

    wrapper.appendChild(ptBtn);
    wrapper.appendChild(enBtn);
    syncButtons();

    // Inject into the right location based on portal type
    if (['gerente', 'secretaria', 'admin'].includes(portal)) {
      const footer = document.querySelector('.sb-footer');
      if (footer) {
        wrapper.style.marginBottom = '10px';
        footer.insertBefore(wrapper, footer.firstChild);
        return;
      }
    }

    // Topbar portals (professora, aluno, pais)
    const topbarUser = document.querySelector('.topbar-user');
    if (topbarUser) {
      topbarUser.prepend(wrapper);
      return;
    }

    // Pais portal: inject into site-header
    const headerInner = document.querySelector('.header-inner');
    if (headerInner) {
      wrapper.style.cssText = 'margin-top:12px;justify-content:center;';
      headerInner.appendChild(wrapper);
    }
  }

  // ═══════════════════════════════════════════════════
  // 17. MIC BUTTON — floating toggle for voice commands (professora)
  // ═══════════════════════════════════════════════════
  function setupMicButton() {
    if (portal !== 'professora') return;
    // Hidden on desktop — teachers use mobile/tablet
    if (window.innerWidth > 1024) return;
    if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) return;

    const PREF_KEY = 'lumied_voice_enabled';

    const btn = document.createElement('button');
    btn.id = 'lumiMicBtn';
    btn.setAttribute('aria-label', 'Ativar comandos de voz Lumi');
    btn.style.cssText = [
      'position:fixed',
      'bottom:16px',
      'left:16px',
      'z-index:99989',
      'width:56px',
      'height:56px',
      'border-radius:50%',
      'border:none',
      'background:#1a1a1a',
      'color:#fff',
      'font-size:22px',
      'cursor:pointer',
      'box-shadow:0 4px 20px rgba(0,0,0,.35)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'transition:background .25s,transform .2s',
      'font-family:inherit',
    ].join(';');
    btn.textContent = '🎤';

    const style = document.createElement('style');
    style.textContent = `
      @keyframes micPulse {
        0%,100% { box-shadow:0 4px 20px rgba(0,0,0,.35),0 0 0 0 rgba(200,16,46,.4); }
        70%      { box-shadow:0 4px 20px rgba(0,0,0,.35),0 0 0 12px rgba(200,16,46,0); }
      }
      #lumiMicBtn.active { background:#C8102E !important; animation:micPulse 1.4s ease infinite; }
      #lumiMicBtn:hover { transform:scale(1.08); }
    `;
    document.head.appendChild(style);

    function syncState() {
      const isOn = window.__voice?.isListening?.() || localStorage.getItem(PREF_KEY) === '1';
      btn.classList.toggle('active', isOn);
      btn.setAttribute('aria-pressed', String(isOn));
      btn.title = isOn ? 'Desativar voz Lumi' : 'Ativar voz Lumi';
    }

    btn.addEventListener('click', () => {
      if (window.__voice) {
        window.__voice.toggle();
        syncState();
      }
    });

    // Keep button state in sync when voice module updates it
    window.__voiceOnChange = syncState;

    document.body.appendChild(btn);
    syncState();
  }

  // ═══════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════
  function init() {
    injectGlobalCSS();
    fixTouchTargets();
    setupInlineValidation();
    improveEmptyStates();
    addSidebarSearch();
    setupUsageTracking();
    setupCommandPalette();
    setupDarkMode();
    setupLangSwitcher();
    setupKeyboardShortcuts();
    // Panel transitions and breadcrumbs need showPanel to exist first
    setTimeout(() => {
      setupPanelTransitions();
      setupBreadcrumbs();
    }, 100);
    // Mic button for voice commands (professora portal, mobile only)
    setTimeout(setupMicButton, 600);
    // Onboarding after app loads
    const appShell = document.getElementById('appShell') || document.getElementById('appWrap');
    if (appShell) {
      const observer = new MutationObserver(() => {
        if (appShell.style.display !== 'none') {
          showOnboarding();
          observer.disconnect();
        }
      });
      observer.observe(appShell, { attributes: true });
    } else {
      showOnboarding();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ═══════════════════════════════════════════════════════
//  Error sanitizer — hide technical messages from users
// ═══════════════════════════════════════════════════════
window.sanitizeErrorMessage = function (msg) {
  if (typeof msg !== 'string') msg = String(msg || '');
  // Technical patterns that should never reach users
  const technicalPatterns = [
    /tenant isolation/i,
    /escola_id/i,
    /\b(INSERT|UPDATE|DELETE|SELECT)\b.*\b(INTO|FROM|SET|WHERE)\b/i,
    /\bconstraint\b/i,
    /\bviolation\b/i,
    /\bduplicate key\b/i,
    /\bforeign key\b/i,
    /\bnull value in column\b/i,
    /\brelation ".*" does not exist/i,
    /\bfunction .* does not exist/i,
    /\bpermission denied for\b/i,
    /\bsyntax error at or near\b/i,
    /\bROW LEVEL SECURITY\b/i,
    /pg_catalog/i,
    /supabase/i,
    /PGRST\d+/i,
  ];
  for (const pat of technicalPatterns) {
    if (pat.test(msg)) return 'Erro interno. Tente novamente.';
  }
  // Generic SQL / DB error fallback
  if (/\b(SQL|postgres|database|db error|internal server error)\b/i.test(msg)) {
    return 'Erro no servidor. Tente novamente.';
  }
  // User-facing messages pass through as-is
  return msg;
};

// ═══════════════════════════════════════════════════════
//  Double-submit prevention — withLoading(btn, asyncFn)
// ═══════════════════════════════════════════════════════
window.withLoading = async function (btn, asyncFn) {
  if (!btn || btn.disabled) return;
  const originalHtml = btn.innerHTML;
  const originalWidth = btn.offsetWidth;
  btn.disabled = true;
  btn.style.opacity = '0.7';
  btn.style.minWidth = originalWidth + 'px';
  btn.innerHTML = '<span class="spinner-sm" style="width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;display:inline-block;animation:spin .7s linear infinite;vertical-align:middle;"></span> Salvando...';
  try {
    return await asyncFn();
  } finally {
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.minWidth = '';
    btn.innerHTML = originalHtml;
  }
};

// ═══════════════════════════════════════════════════════
//  Focus trap for modals
// ═══════════════════════════════════════════════════════
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Tab') return;
  const modal = document.querySelector('.modal-overlay.show, .modal-overlay[style*="flex"]');
  if (!modal) return;
  const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
// Close modal on Escape
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  const modal = document.querySelector('.modal-overlay.show, .modal-overlay[style*="flex"]');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
});

// ═══════════════════════════════════════════════════════
//  Offline detection
// ═══════════════════════════════════════════════════════
(function() {
  let banner = null;
  function showOffline(show) {
    if (!banner) {
      banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#d4830a;color:#fff;text-align:center;padding:12px;font-size:14px;font-weight:600;z-index:99999;font-family:sans-serif;transition:transform .3s;transform:translateY(100%);';
      banner.textContent = 'Sem conexão com a internet';
      document.body.appendChild(banner);
    }
    banner.style.transform = show ? 'translateY(0)' : 'translateY(100%)';
  }
  window.addEventListener('offline', () => showOffline(true));
  window.addEventListener('online', () => showOffline(false));
  if (!navigator.onLine) setTimeout(() => showOffline(true), 1000);
})();
