// Lumied Blog — Inline CTA injection
// Insere um CTA de newsletter após o 2º H2 de cada artigo
// Incluir: <script src="/blog/blog-cta.js" defer></script>
(function() {
  // Só executa em páginas de artigo (não no index do blog)
  if (location.pathname === '/blog/' || location.pathname === '/site/blog/' ||
      location.pathname.endsWith('/blog/index.html')) return;

  var SUPABASE_URL = 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/admin';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjU0NTUsImV4cCI6MjA4OTM0MTQ1NX0.QKX_6ZSfied60ZpB8VOx03hwiyD9J5lskKwfl-oXPYE';

  function init() {
    var h2s = document.querySelectorAll('article h2, .article-content h2, main h2');
    if (h2s.length < 3) return; // precisa de pelo menos 3 H2s para inserir após o 2º

    var target = h2s[2]; // insere ANTES do 3º H2 (= depois do 2º bloco)

    var box = document.createElement('div');
    box.className = 'blog-inline-cta';
    box.innerHTML =
      '<div style="background:linear-gradient(135deg,#F0EDFF,#E8F4FD);border:1px solid #D4CAFE;border-radius:16px;padding:32px;margin:40px 0;text-align:center;">' +
        '<div style="font-size:28px;margin-bottom:8px;">📬</div>' +
        '<h3 style="font-size:18px;font-weight:800;color:#1E1B4B;margin-bottom:8px;">Gostando do conteudo?</h3>' +
        '<p style="font-size:14px;color:#475569;margin-bottom:16px;max-width:400px;margin-left:auto;margin-right:auto;">Receba artigos como este direto no seu email. Conteudo pratico sobre gestao escolar, compliance e EdTech.</p>' +
        '<form id="inlineCta" style="display:flex;gap:8px;max-width:400px;margin:0 auto;flex-wrap:wrap;justify-content:center;" onsubmit="return false;">' +
          '<input type="email" id="inlineCtaEmail" placeholder="Seu email" required style="flex:1;min-width:200px;padding:10px 16px;border:1px solid #CBD5E1;border-radius:8px;font-size:14px;font-family:inherit;outline:none;">' +
          '<button type="submit" id="inlineCtaBtn" style="padding:10px 20px;background:linear-gradient(135deg,#6C63FF,#3B82F6);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;">Quero receber</button>' +
        '</form>' +
        '<div id="inlineCtaOk" style="display:none;padding:12px;background:#ECFDF5;border-radius:8px;color:#065F46;font-size:14px;font-weight:600;max-width:400px;margin:0 auto;">Inscrito! Voce recebera nossos artigos.</div>' +
      '</div>';

    target.parentNode.insertBefore(box, target);

    document.getElementById('inlineCta').onsubmit = function(e) {
      e.preventDefault();
      var email = document.getElementById('inlineCtaEmail').value;
      var btn = document.getElementById('inlineCtaBtn');
      btn.disabled = true; btn.textContent = 'Enviando...';

      fetch(SUPABASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
        body: JSON.stringify({ action: 'newsletter_subscribe', email: email, origem: 'inline_cta' })
      }).then(function() {
        document.getElementById('inlineCta').style.display = 'none';
        document.getElementById('inlineCtaOk').style.display = 'block';
        if (typeof gtag === 'function') gtag('event', 'newsletter_subscribe', { event_category: 'engagement', event_label: 'inline_cta' });
      }).catch(function() {
        btn.disabled = false; btn.textContent = 'Quero receber';
      });
      return false;
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Load SDR lead capture widget (exit-intent + sticky bar)
  var sdrScript = document.createElement('script');
  sdrScript.src = '/blog/sdr-capture.js';
  sdrScript.defer = true;
  document.head.appendChild(sdrScript);
})();
