/**
 * SDR Lead Capture Widget for Lumied Blog
 *
 * Features:
 * 1. Exit-intent popup (desktop: mouse leaves viewport, mobile: scroll up)
 * 2. Inline CTA banner (after 40% scroll)
 * 3. Sticky bottom bar (after 60% scroll)
 *
 * All forms POST to InstaPublisher /api/sdr/capture
 * Only shows once per session (localStorage flag)
 */
(function() {
  'use strict';

  const API = 'https://insta-publisher.vercel.app/api/sdr/capture';
  const STORAGE_KEY = 'lumied_sdr_captured';
  const SESSION_KEY = 'lumied_sdr_shown';

  // Don't show if already captured or shown this session
  if (localStorage.getItem(STORAGE_KEY)) return;
  if (sessionStorage.getItem(SESSION_KEY)) return;

  // ─── STYLES ─────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .sdr-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99998;display:none;align-items:center;justify-content:center;animation:sdr-fade .3s}
    .sdr-overlay.active{display:flex}
    .sdr-modal{background:#fff;border-radius:16px;padding:32px;max-width:440px;width:90%;position:relative;animation:sdr-slide .3s}
    .sdr-modal h2{font-size:22px;margin:0 0 8px;color:#1f2937}
    .sdr-modal p{font-size:14px;color:#6b7280;margin:0 0 20px;line-height:1.5}
    .sdr-modal input{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;margin-bottom:10px;box-sizing:border-box}
    .sdr-modal input:focus{outline:none;border-color:#7c3aed}
    .sdr-modal button[type=submit]{width:100%;padding:12px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
    .sdr-modal button[type=submit]:hover{opacity:.9}
    .sdr-modal .close{position:absolute;top:12px;right:12px;background:none;border:none;font-size:20px;cursor:pointer;color:#9ca3af;padding:4px 8px}
    .sdr-modal .success{text-align:center;color:#059669;padding:20px 0}
    .sdr-modal .success h3{font-size:18px;margin-bottom:8px}

    .sdr-inline{background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1px solid #ddd6fe;border-radius:12px;padding:24px;margin:32px 0;display:none}
    .sdr-inline h3{font-size:18px;margin:0 0 8px;color:#5b21b6}
    .sdr-inline p{font-size:13px;color:#6b7280;margin:0 0 16px}
    .sdr-inline .row{display:flex;gap:8px}
    .sdr-inline input{flex:1;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px}
    .sdr-inline button{padding:10px 20px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}

    .sdr-sticky{position:fixed;bottom:0;left:0;right:0;background:#7c3aed;color:#fff;padding:12px 20px;z-index:99997;display:none;align-items:center;justify-content:center;gap:12px;font-size:14px;box-shadow:0 -2px 10px rgba(0,0,0,.15)}
    .sdr-sticky a{color:#fff;font-weight:600;text-decoration:underline}
    .sdr-sticky .close-sticky{background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:18px;padding:0 8px}

    @keyframes sdr-fade{from{opacity:0}to{opacity:1}}
    @keyframes sdr-slide{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
  `;
  document.head.appendChild(style);

  // ─── EXIT-INTENT MODAL ──────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'sdr-overlay';
  overlay.innerHTML = `
    <div class="sdr-modal">
      <button class="close" onclick="this.closest('.sdr-overlay').classList.remove('active')">&times;</button>
      <div id="sdr-exit-form">
        <h2>Antes de ir... 🎓</h2>
        <p>Receba grátis nosso guia "Como Reduzir Inadimplência em 30% na Sua Escola" + uma análise personalizada.</p>
        <form id="sdr-exit-capture">
          <input type="text" name="name" placeholder="Seu nome" required>
          <input type="email" name="email" placeholder="Email profissional" required>
          <input type="text" name="school_name" placeholder="Nome da escola" required>
          <input type="tel" name="phone" placeholder="WhatsApp (opcional)">
          <button type="submit">Quero o Guia Grátis →</button>
        </form>
      </div>
      <div id="sdr-exit-success" class="success" style="display:none">
        <h3>✅ Enviado!</h3>
        <p>Verifique seu email. Em breve entraremos em contato!</p>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // ─── INLINE CTA ─────────────────────────────────────
  // Insert after the first <h2> or after 40% of article content
  const articleContent = document.querySelector('article, .blog-content, .post-content, main');
  if (articleContent) {
    const inlineCTA = document.createElement('div');
    inlineCTA.className = 'sdr-inline';
    inlineCTA.id = 'sdr-inline-cta';
    inlineCTA.innerHTML = `
      <h3>📊 Quanto sua escola perde sem automação?</h3>
      <p>Use nossa calculadora gratuita e descubra em 30 segundos.</p>
      <div class="row">
        <input type="email" id="sdr-inline-email" placeholder="Seu email profissional">
        <button onclick="window.open('https://lumied.com.br/materiais/calculadora-roi','_blank')">Calcular ROI →</button>
      </div>
    `;

    // Insert after ~40% of content
    const children = articleContent.children;
    const insertAt = Math.floor(children.length * 0.4);
    if (children[insertAt]) {
      children[insertAt].after(inlineCTA);
    } else {
      articleContent.appendChild(inlineCTA);
    }
  }

  // ─── STICKY BOTTOM BAR ──────────────────────────────
  const sticky = document.createElement('div');
  sticky.className = 'sdr-sticky';
  sticky.id = 'sdr-sticky-bar';
  sticky.innerHTML = `
    <span>🎓 Gestão escolar inteligente — <a href="https://lumied.com.br/materiais/guia-inadimplencia" target="_blank">Baixe o guia grátis</a> ou <a href="https://lumied.com.br/materiais/calculadora-roi" target="_blank">calcule seu ROI</a></span>
    <button class="close-sticky" onclick="this.parentElement.style.display='none'">&times;</button>
  `;
  document.body.appendChild(sticky);

  // ─── TRIGGERS ───────────────────────────────────────

  // Exit intent (desktop)
  let exitShown = false;
  document.addEventListener('mouseout', (e) => {
    if (exitShown || sessionStorage.getItem(SESSION_KEY)) return;
    if (e.clientY < 10 && e.relatedTarget === null) {
      overlay.classList.add('active');
      sessionStorage.setItem(SESSION_KEY, '1');
      exitShown = true;
    }
  });

  // Scroll triggers
  let inlineShown = false;
  let stickyShown = false;
  window.addEventListener('scroll', () => {
    const scrollPct = window.scrollY / (document.body.scrollHeight - window.innerHeight);

    // Inline CTA at 40% scroll
    if (!inlineShown && scrollPct > 0.3) {
      const el = document.getElementById('sdr-inline-cta');
      if (el) { el.style.display = 'block'; inlineShown = true; }
    }

    // Sticky bar at 60% scroll
    if (!stickyShown && scrollPct > 0.5) {
      const el = document.getElementById('sdr-sticky-bar');
      if (el) { el.style.display = 'flex'; stickyShown = true; }
    }
  });

  // ─── FORM HANDLER ───────────────────────────────────
  document.getElementById('sdr-exit-capture')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const data = {
      name: form.get('name'),
      email: form.get('email'),
      school_name: form.get('school_name'),
      phone: form.get('phone') || undefined,
      source: 'blog-exit-intent',
    };

    try {
      await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      document.getElementById('sdr-exit-form').style.display = 'none';
      document.getElementById('sdr-exit-success').style.display = 'block';
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      alert('Erro ao enviar. Tente novamente.');
    }
  });
})();
