/**
 * Gerente Portal — Main Entry Point (ES Module)
 * Imports shared modules and initializes the app
 */
import { createClient } from '../../shared/api-client.js';
import { appStore } from '../../shared/state.js';
import { showToast } from '../../shared/components/toast.js';
import { renderTable, fmt } from '../../shared/components/data-table.js';
import { createModal } from '../../shared/components/modal.js';
import { initSentry, setSentryUser } from '../../shared/sentry.js';

initSentry();

// ═══ CONFIG ═══
const SUPABASE_URL = 'https://brgorknbrjlfwvrrlwxj.supabase.co';
const SUPABASE_ANON = window.__SUPABASE_ANON || document.querySelector('meta[name="sb-anon"]')?.content || '';

// ═══ API CLIENT ═══
const api = createClient(SUPABASE_ANON, {
  tokenKey: 'mb_token',
  onAuthError: (data) => {
    showToast('Sessão expirada. Faça login novamente.', 'error');
    appStore.set('user', null);
    localStorage.removeItem('mb_token');
    setTimeout(() => location.reload(), 1500);
  },
});

// Update Sentry user context when user changes
appStore.subscribe('user', (user) => setSentryUser(user, appStore.get('escola_id')));
appStore.subscribe('escola_id', (id) => setSentryUser(appStore.get('user'), id));

// Expose for inline scripts (backward compat during migration)
window.__api = api;
window.__store = appStore;
window.__toast = showToast;
window.__table = renderTable;
window.__fmt = fmt;
window.__modal = createModal;

// ═══ FEATURE GATING ═══
async function loadModulosHabilitados() {
  try {
    const d = await api.api({ action: 'modulos_habilitados' });
    if (d?.modulos) {
      appStore.set('modulos', new Set(d.modulos));
      applyModuleGating();
    }
    if (d?.tema) {
      appStore.set('tema', d.tema);
      document.body.className = document.body.className.replace(/theme-\w+/g, '');
      document.body.classList.add('theme-' + d.tema);
    }
  } catch (e) {
    console.warn('[FeatureGating] Não disponível:', e);
  }
}

function applyModuleGating() {
  const modulos = appStore.get('modulos');
  if (!modulos) return;
  document.querySelectorAll('[data-modulo]').forEach(el => {
    el.style.display = modulos.has(el.dataset.modulo) ? '' : 'none';
  });
}

// ═══ THEME ═══
appStore.subscribe('tema', (tema) => {
  document.body.className = document.body.className.replace(/theme-\w+/g, '');
  document.body.classList.add('theme-' + tema);
});

// ═══ OFFLINE DETECTION ═══
appStore.subscribe('online', (online) => {
  if (!online) showToast('Sem conexão com a internet.', 'warning', 0);
  else showToast('Conexão restabelecida!', 'success', 2000);
});

// ═══ EXPORTS for inline usage ═══
window.__loadModulosHabilitados = loadModulosHabilitados;
window.__applyModuleGating = applyModuleGating;

console.log('[Lumied] Gerente module loaded. API client, state, and components ready.');
