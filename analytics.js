// ═══════════════════════════════════════════════════════
//  Lumied — Google Analytics 4 + LGPD Consent
//  Incluir: <script src="/analytics.js" defer></script>
// ═══════════════════════════════════════════════════════
(function() {
  var GA_ID = 'G-QDFKQEVV4P';
  var CONSENT_KEY = 'lumied_analytics_consent';

  // Não rastrear em localhost
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;

  // ── LGPD Consent Mode ──
  var consent = localStorage.getItem(CONSENT_KEY);

  gtag('consent', 'default', {
    analytics_storage: consent === 'granted' ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });

  // Carrega o GTM script (consent mode controla o que é coletado)
  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(script);

  gtag('js', new Date());

  // Detecta portal e content_group
  var path = location.pathname;
  var portal = 'site';
  var config = { page_title: document.title, send_page_view: true };

  if (path.includes('gerente')) portal = 'gerente';
  else if (path.includes('professora')) portal = 'professora';
  else if (path.includes('secretaria')) portal = 'secretaria';
  else if (path.includes('aluno')) portal = 'aluno';
  else if (path.includes('admin')) portal = 'admin';
  else if (path === '/' || path.includes('familia')) portal = 'pais';

  // Blog content_group automático
  if (path.includes('/blog/') && path !== '/site/blog/' && path !== '/site/blog/index.html') {
    var section = document.querySelector('meta[property="article:section"]');
    config.content_group = 'Blog' + (section ? ' - ' + section.content : '');
  }

  gtag('config', GA_ID, config);
  gtag('set', 'user_properties', { portal: portal });

  // ── Consent Banner ──
  if (consent) return; // já escolheu

  function createBanner() {
    var banner = document.createElement('div');
    banner.id = 'lgpd-consent';
    banner.innerHTML =
      '<div style="position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#0F172A;color:#E2E8F0;' +
      'padding:16px 24px;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;' +
      'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:14px;' +
      'box-shadow:0 -4px 20px rgba(0,0,0,.3)">' +
      '<span style="flex:1;min-width:200px">Usamos cookies analíticos para melhorar sua experiência. ' +
      'Seus dados são tratados conforme nossa <a href="/site/privacidade/" style="color:#38BDF8;text-decoration:underline">Política de Privacidade</a> e a LGPD.</span>' +
      '<div style="display:flex;gap:8px;flex-shrink:0">' +
      '<button id="lgpd-deny" style="padding:8px 20px;border:1px solid #475569;background:transparent;color:#E2E8F0;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500">Recusar</button>' +
      '<button id="lgpd-accept" style="padding:8px 20px;border:none;background:#0EA5E9;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">Aceitar</button>' +
      '</div></div>';
    document.body.appendChild(banner);

    document.getElementById('lgpd-accept').onclick = function() {
      localStorage.setItem(CONSENT_KEY, 'granted');
      gtag('consent', 'update', { analytics_storage: 'granted' });
      banner.remove();
    };
    document.getElementById('lgpd-deny').onclick = function() {
      localStorage.setItem(CONSENT_KEY, 'denied');
      banner.remove();
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createBanner);
  } else {
    createBanner();
  }
})();
