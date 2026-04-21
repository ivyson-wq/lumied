/**
 * Portal Init — shared bootstrap for all Lumied portals
 * Eliminates repeated Sentry/API/Store/Toast setup across portals.
 *
 * Usage:
 *   import { initPortal, loadModulos } from '../../shared/portal-init.js';
 *   const { api } = initPortal({ tokenKey: 'mb_token' });
 */
import { createClient } from './api-client.js';
import { appStore } from './state.js';
import { showToast } from './components/toast.js';
import { initSentry, setSentryUser } from './sentry.js';

/**
 * Bootstrap a portal: Sentry, API client, state, global bindings.
 * @param {Object} opts
 * @param {string} opts.tokenKey - localStorage key for auth token (e.g. 'mb_token')
 * @param {Function} [opts.onAuthError] - custom handler for expired sessions
 * @returns {{ api: ReturnType<typeof createClient> }}
 */
export function initPortal({ tokenKey, onAuthError }) {
  initSentry();

  const SUPABASE_ANON = window.__SUPABASE_ANON
    || document.querySelector('meta[name="sb-anon"]')?.content
    || '';

  const api = createClient(SUPABASE_ANON, {
    tokenKey,
    onAuthError: onAuthError || (() => {
      showToast('Sessão expirada.', 'error');
      appStore.set('user', null);
    }),
  });

  // Sentry context
  appStore.subscribe('user', (user) => setSentryUser(user, appStore.get('escola_id')));
  appStore.subscribe('escola_id', (id) => setSentryUser(appStore.get('user'), id));

  // Offline detection
  appStore.subscribe('online', (online) => {
    if (!online) showToast('Sem conexão com a internet.', 'warning', 0);
    else showToast('Conexão restabelecida!', 'success', 2000);
  });

  // Global bindings for inline scripts
  window.__api = api;
  window.__store = appStore;
  window.__toast = showToast;

  return { api };
}

/**
 * Load enabled modules and apply feature gating + theme.
 * @param {Object} api - API client from initPortal
 * @param {string} [endpoint='api'] - edge function name ('api' or 'diplomas')
 */
export async function loadModulos(api, endpoint = 'api') {
  try {
    const d = await api[endpoint]({ action: 'modulos_habilitados' });
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

/** Show/hide elements based on [data-modulo] */
export function applyModuleGating() {
  const modulos = appStore.get('modulos');
  if (!modulos) return;
  document.querySelectorAll('[data-modulo]').forEach(el => {
    el.style.display = modulos.has(el.dataset.modulo) ? '' : 'none';
  });
}

// Theme subscription (auto-apply on change)
appStore.subscribe('tema', (tema) => {
  document.body.className = document.body.className.replace(/theme-\w+/g, '');
  document.body.classList.add('theme-' + tema);
});
