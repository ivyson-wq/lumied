// ═══════════════════════════════════════════════════════
//  Lumied — Google Analytics 4
//  Incluir: <script src="/analytics.js"></script>
//  Trocar GA_ID abaixo quando tiver o ID real
// ═══════════════════════════════════════════════════════
(function() {
  var GA_ID = 'G-LUMIED'; // TODO: substituir pelo ID real do GA4

  // Não rastrear em localhost
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;

  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA_ID, {
    page_title: document.title,
    send_page_view: true,
  });

  // Track portal type
  var path = location.pathname;
  var portal = 'site';
  if (path.includes('gerente')) portal = 'gerente';
  else if (path.includes('professora')) portal = 'professora';
  else if (path.includes('secretaria')) portal = 'secretaria';
  else if (path.includes('aluno')) portal = 'aluno';
  else if (path.includes('admin')) portal = 'admin';
  else if (path === '/' || path.includes('index')) portal = 'pais';

  gtag('set', 'user_properties', { portal: portal });
})();
