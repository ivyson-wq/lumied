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
import { translatePage } from './i18n.js';
import { createLangSwitcher } from './components/lang-switcher.js';
import { initPWAInstall } from './pwa-install.js';
import { initWebVitals } from './web-vitals.js';
import { utils } from './utils.js';

/**
 * Bootstrap a portal: Sentry, API client, state, global bindings.
 * @param {Object} opts
 * @param {string} opts.tokenKey - localStorage key for auth token (e.g. 'mb_token')
 * @param {Function} [opts.onAuthError] - custom handler for expired sessions
 * @returns {{ api: ReturnType<typeof createClient> }}
 */
export function initPortal({ tokenKey, tokenField, onAuthError }) {
  initSentry();

  const SUPABASE_ANON = window.__SUPABASE_ANON
    || document.querySelector('meta[name="sb-anon"]')?.content
    || '';

  const api = createClient(SUPABASE_ANON, {
    tokenKey,
    tokenField,  // ex: '_staff_token' no admin-central, default '_token'
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

  // Global bindings for inline scripts (HTMLs ainda dependem disso até a
  // Onda 4 do refator quebrar os monolitos em módulos próprios).
  window.__api = api;
  window.__store = appStore;
  window.__toast = showToast;
  window.__utils = utils;
  window.__translatePage = translatePage;

  // i18n — translate page and add language switcher
  translatePage();
  _injectLangSwitcher();

  initPWAInstall();

  // Web Vitals — non-blocking, runs after load
  initWebVitals();

  return { api };
}

function _injectLangSwitcher() {
  const switcher = createLangSwitcher();

  // Try sidebar footer first (gerente, secretaria, admin)
  const footer = document.querySelector('.sb-footer');
  if (footer) {
    switcher.style.cssText = 'margin-bottom:10px;';
    footer.insertBefore(switcher, footer.firstChild);
    return;
  }

  // Try topbar user area (professora, aluno)
  const topbarUser = document.querySelector('.topbar-user');
  if (topbarUser) {
    topbarUser.prepend(switcher);
    return;
  }

  // Pais portal: inject into site-header
  const headerInner = document.querySelector('.header-inner');
  if (headerInner) {
    switcher.style.cssText = 'margin-top:12px;justify-content:center;';
    headerInner.appendChild(switcher);
  }
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
