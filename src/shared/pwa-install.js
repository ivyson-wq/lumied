const DISMISS_KEY = 'lumied_pwa_dismiss';
const DISMISS_DAYS = 7;

let _deferredPrompt = null;
let _banner = null;

function isMobile() {
  return window.innerWidth < 768;
}

function isDismissed() {
  const ts = localStorage.getItem(DISMISS_KEY);
  if (!ts) return false;
  return Date.now() - parseInt(ts, 10) < DISMISS_DAYS * 86400_000;
}

function dismiss() {
  localStorage.setItem(DISMISS_KEY, String(Date.now()));
  if (_banner) {
    _banner.style.transform = 'translateY(100%)';
    setTimeout(() => _banner?.remove(), 300);
    _banner = null;
  }
}

function createBanner() {
  const el = document.createElement('div');
  el.id = 'lumied-pwa-banner';
  el.style.cssText = [
    'position:fixed',
    'bottom:0',
    'left:0',
    'right:0',
    'z-index:99999',
    'background:#fff',
    'border-top:1px solid #e5e7eb',
    'padding:12px 16px',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'box-shadow:0 -4px 16px rgba(0,0,0,0.08)',
    'font-family:DM Sans,-apple-system,BlinkMacSystemFont,sans-serif',
    'transition:transform 0.3s ease',
    'transform:translateY(100%)',
  ].join(';');

  el.innerHTML = `
    <div style="flex:1;min-width:0">
      <p style="margin:0;font-size:14px;font-weight:600;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        Instalar Lumied no seu dispositivo
      </p>
      <p style="margin:2px 0 0;font-size:12px;color:#6b7280">Acesso rápido, sem abrir o navegador.</p>
    </div>
    <button id="lumied-pwa-install-btn" style="
      background:#C8102E;color:#fff;border:none;border-radius:8px;
      padding:8px 16px;font-family:inherit;font-size:13px;font-weight:600;
      cursor:pointer;white-space:nowrap;flex-shrink:0
    ">Instalar</button>
    <button id="lumied-pwa-dismiss-btn" style="
      background:none;border:none;color:#9ca3af;cursor:pointer;
      padding:4px;font-size:20px;line-height:1;flex-shrink:0
    " aria-label="Fechar">×</button>
  `;

  return el;
}

function showBanner() {
  if (_banner || !isMobile() || isDismissed() || !_deferredPrompt) return;

  _banner = createBanner();
  document.body.appendChild(_banner);

  // Animate in after paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (_banner) _banner.style.transform = 'translateY(0)';
    });
  });

  document.getElementById('lumied-pwa-install-btn').addEventListener('click', async () => {
    if (!_deferredPrompt) return;
    _deferredPrompt.prompt();
    const { outcome } = await _deferredPrompt.userChoice;
    _deferredPrompt = null;
    dismiss();
    if (outcome === 'accepted') {
      // Banner already removed by dismiss(); nothing else needed
    }
  });

  document.getElementById('lumied-pwa-dismiss-btn').addEventListener('click', dismiss);
}

export function initPWAInstall() {
  if (!isMobile()) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredPrompt = e;
    // Show after a brief delay so the page has loaded
    setTimeout(showBanner, 3000);
  });

  // Already installed — don't show
  window.addEventListener('appinstalled', () => {
    _deferredPrompt = null;
    dismiss();
  });
}
