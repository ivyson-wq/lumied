// ═══════════════════════════════════════════════════════
//  Maple Bear Caxias do Sul — Google Analytics 4 + LGPD
//  Incluir: <script src="/maple-bear-blog/analytics.js" defer></script>
//  GA4 Measurement ID: definir após criar property
// ═══════════════════════════════════════════════════════
(function() {
  var GA_ID = '__GA4_ID__'; // Substituir pelo Measurement ID real
  var CONSENT_KEY = 'maplebear_analytics_consent';

  if (GA_ID === '__GA4_ID__') return; // Skip se não configurado
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;

  var consent = localStorage.getItem(CONSENT_KEY);

  gtag('consent', 'default', {
    analytics_storage: consent === 'granted' ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });

  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(script);

  gtag('js', new Date());

  var path = location.pathname;
  var config = { page_title: document.title, send_page_view: true };

  if (path.includes('/maple-bear-blog/') && path !== '/maple-bear-blog/' && path !== '/maple-bear-blog/index.html') {
    var section = document.querySelector('meta[property="article:section"]');
    config.content_group = 'Blog' + (section ? ' - ' + section.content : '');
  }

  gtag('config', GA_ID, config);

  // Scroll Depth
  var scrollMarks = { 25: false, 50: false, 75: false, 100: false };
  window.addEventListener('scroll', function() {
    var pct = Math.round((window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100);
    [25, 50, 75, 100].forEach(function(mark) {
      if (pct >= mark && !scrollMarks[mark]) {
        scrollMarks[mark] = true;
        gtag('event', 'scroll_depth', { event_label: mark + '%', value: mark, non_interaction: true });
      }
    });
  });

  // CTA Click Tracking
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('a[href*="wa.me"], a[href*="#contact"], a[href*="/agendar"], [data-track]').forEach(function(el) {
      el.addEventListener('click', function() {
        gtag('event', 'cta_click', { event_label: el.getAttribute('data-track') || el.textContent.trim().substring(0, 50) });
      });
    });
  });

  // Consent Banner
  if (consent) return;
  document.addEventListener('DOMContentLoaded', function() {
    var banner = document.createElement('div');
    banner.innerHTML =
      '<div style="position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#1a3a2a;color:#E2E8F0;' +
      'padding:16px 24px;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;' +
      'font-family:-apple-system,sans-serif;font-size:14px;box-shadow:0 -4px 20px rgba(0,0,0,.3)">' +
      '<span style="flex:1;min-width:200px">Usamos cookies analíticos para melhorar sua experiência. ' +
      'Seus dados são tratados conforme a LGPD.</span>' +
      '<div style="display:flex;gap:8px">' +
      '<button id="lgpd-deny" style="padding:8px 20px;border:1px solid #475569;background:transparent;color:#E2E8F0;border-radius:6px;cursor:pointer;font-size:13px">Recusar</button>' +
      '<button id="lgpd-accept" style="padding:8px 20px;border:none;background:#2E7D32;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">Aceitar</button>' +
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
  });
})();
