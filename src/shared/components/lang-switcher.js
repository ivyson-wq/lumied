import { setLocale, getLocale, translatePage } from '../i18n.js';

const STYLES = `
.lang-switcher{display:inline-flex;align-items:center;gap:2px;background:rgba(0,0,0,.2);border-radius:8px;padding:3px;flex-shrink:0;}
.lang-btn{padding:4px 10px;border:none;background:transparent;color:rgba(255,255,255,.55);font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;cursor:pointer;border-radius:6px;transition:all .2s;white-space:nowrap;line-height:1.4;}
.lang-btn:hover{background:rgba(255,255,255,.1);color:rgba(255,255,255,.9);}
.lang-btn.active{background:rgba(255,255,255,.14);color:#fff;}
`;

let _stylesInjected = false;

function _injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'lang-switcher-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
}

export function createLangSwitcher() {
  _injectStyles();

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

  function sync() {
    const locale = getLocale();
    ptBtn.classList.toggle('active', locale === 'pt-BR');
    enBtn.classList.toggle('active', locale === 'en');
  }

  ptBtn.addEventListener('click', () => { setLocale('pt-BR'); sync(); translatePage(); });
  enBtn.addEventListener('click', () => { setLocale('en'); sync(); translatePage(); });

  wrapper.appendChild(ptBtn);
  wrapper.appendChild(enBtn);
  sync();

  return wrapper;
}
