import ptBR from '../../locales/pt-BR.json';
import en from '../../locales/en.json';

const SUPPORTED = ['pt-BR', 'en'];
const STORAGE_KEY = 'lumied_lang';

const catalog = { 'pt-BR': ptBR, 'en': en };

let currentLocale = _detectLocale();

function _detectLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
  } catch (_) { /* private/incognito may throw */ }
  const nav = (navigator.language || '').toLowerCase();
  return nav.startsWith('en') ? 'en' : 'pt-BR';
}

function _resolve(key, obj) {
  if (!obj) return undefined;
  const parts = key.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function setLocale(lang) {
  if (!SUPPORTED.includes(lang)) return;
  currentLocale = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
}

export function getLocale() {
  return currentLocale;
}

export function t(key, params) {
  const value = _resolve(key, catalog[currentLocale])
    ?? _resolve(key, catalog['pt-BR'])
    ?? key;
  if (!params) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in params ? params[k] : `{{${k}}}`));
}

export function translatePage() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const translated = t(key);
    if (translated !== key) el.textContent = translated;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    const translated = t(key);
    if (translated !== key) el.placeholder = translated;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    const translated = t(key);
    if (translated !== key) el.title = translated;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const key = el.dataset.i18nAria;
    const translated = t(key);
    if (translated !== key) el.setAttribute('aria-label', translated);
  });
}
