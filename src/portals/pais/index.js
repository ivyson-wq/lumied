/**
 * Portal dos Pais — Main Entry Point (ES Module)
 */
import { createClient } from '../../shared/api-client.js';
import { appStore } from '../../shared/state.js';
import { showToast } from '../../shared/components/toast.js';

const SUPABASE_ANON = window.__SUPABASE_ANON || '';

const api = createClient(SUPABASE_ANON, {
  tokenKey: 'mb_pais_token',
  onAuthError: () => {
    showToast('Sessão expirada.', 'error');
    appStore.set('user', null);
  },
});

async function loadModulosHabilitadosPais() {
  try {
    const d = await api.api({ action: 'modulos_habilitados' });
    if (d?.modulos) {
      appStore.set('modulos', new Set(d.modulos));
      document.querySelectorAll('[data-modulo]').forEach(el => {
        el.style.display = appStore.get('modulos').has(el.dataset.modulo) ? '' : 'none';
      });
    }
  } catch {}
}

window.__api = api;
window.__store = appStore;
window.__toast = showToast;
window.__loadModulosHabilitadosPais = loadModulosHabilitadosPais;

console.log('[Lumied] Pais module loaded.');
