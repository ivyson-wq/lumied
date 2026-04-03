/**
 * Portal das Professoras — Main Entry Point (ES Module)
 */
import { createClient } from '../../shared/api-client.js';
import { appStore } from '../../shared/state.js';
import { showToast } from '../../shared/components/toast.js';
import { initSentry, setSentryUser } from '../../shared/sentry.js';

initSentry();

const SUPABASE_ANON = window.__SUPABASE_ANON || '';

const api = createClient(SUPABASE_ANON, {
  tokenKey: 'prof_token',
  onAuthError: () => {
    showToast('Sessão expirada.', 'error');
    appStore.set('user', null);
  },
});

async function loadModulosHabilitadosProf() {
  try {
    const d = await api.diplomas({ action: 'modulos_habilitados' });
    if (d?.modulos) {
      appStore.set('modulos', new Set(d.modulos));
      document.querySelectorAll('[data-modulo]').forEach(el => {
        el.style.display = appStore.get('modulos').has(el.dataset.modulo) ? '' : 'none';
      });
    }
  } catch {}
}

// Update Sentry user context when user changes
appStore.subscribe('user', (user) => setSentryUser(user, appStore.get('escola_id')));
appStore.subscribe('escola_id', (id) => setSentryUser(appStore.get('user'), id));

window.__api = api;
window.__store = appStore;
window.__toast = showToast;
window.__loadModulosHabilitadosProf = loadModulosHabilitadosProf;

console.log('[Lumied] Professora module loaded.');
