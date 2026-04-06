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
      .lumied-validation { transition: opacity .2s; }
      input:focus, select:focus, textarea:focus { outline: none; }
    `;
    document.head.appendChild(style);
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
