/**
 * SDR Lead Capture Widget for Lumied Blog
 *
 * Triggers:
 *  - Exit-intent modal (desktop)
 *  - Inline CTA (after 30% scroll)
 *  - Sticky bottom bar (after 50% scroll)
 *
 * Posts to: https://insta-publisher.vercel.app/api/sdr/capture (proxy → gtm.lead_capture)
 * UTM-aware (captures from URL or sessionStorage); GA4 events fired.
 */
(function () {
  'use strict';

  var API = 'https://insta-publisher.vercel.app/api/sdr/capture';
  var STORAGE_KEY = 'lumied_sdr_captured';
  var SESSION_KEY = 'lumied_sdr_shown';
  var UTM_KEY = 'lumied_utm';

  if (localStorage.getItem(STORAGE_KEY)) return;
  if (sessionStorage.getItem(SESSION_KEY)) return;

  // ─── UTM persistence ────────────────────────────────
  var qs = new URLSearchParams(location.search);
  var utm = {
    utm_source: qs.get('utm_source') || '',
    utm_medium: qs.get('utm_medium') || '',
    utm_campaign: qs.get('utm_campaign') || '',
  };
  if (utm.utm_source || utm.utm_medium || utm.utm_campaign) {
    try { localStorage.setItem(UTM_KEY, JSON.stringify(utm)); } catch (e) { /* private mode */ }
  } else {
    try {
      var stored = JSON.parse(localStorage.getItem(UTM_KEY) || '{}');
      utm.utm_source = stored.utm_source || '';
      utm.utm_medium = stored.utm_medium || '';
      utm.utm_campaign = stored.utm_campaign || '';
    } catch (e) { /* ignore */ }
  }

  function track(action, label) {
    if (typeof gtag === 'function') {
      gtag('event', action, { event_category: 'sdr_capture', event_label: label });
    }
  }

  function postLead(payload, onSuccess, onError) {
    var body = Object.assign({}, payload, {
      utm_source: utm.utm_source || undefined,
      utm_medium: utm.utm_medium || undefined,
      utm_campaign: utm.utm_campaign || undefined,
    });
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (res.ok) {
          localStorage.setItem(STORAGE_KEY, '1');
          track('lead_captured', payload.source || 'unknown');
          if (onSuccess) onSuccess(res.body);
        } else if (onError) {
          onError(res.body);
        }
      })
      .catch(function (e) { if (onError) onError({ error: 'network', detail: String(e) }); });
  }

  // ─── STYLES ─────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = ''
    + '.sdr-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99998;display:none;align-items:center;justify-content:center;animation:sdr-fade .3s}'
    + '.sdr-overlay.active{display:flex}'
    + '.sdr-modal{background:#fff;border-radius:16px;padding:32px;max-width:480px;width:92%;position:relative;animation:sdr-slide .3s;max-height:90vh;overflow-y:auto}'
    + '.sdr-modal h2{font-size:22px;margin:0 0 8px;color:#1f2937;font-weight:800}'
    + '.sdr-modal p{font-size:14px;color:#6b7280;margin:0 0 20px;line-height:1.5}'
    + '.sdr-modal label{display:block;font-size:12px;color:#374151;margin:6px 0 4px;font-weight:600}'
    + '.sdr-modal input,.sdr-modal select{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;margin-bottom:6px;box-sizing:border-box;font-family:inherit}'
    + '.sdr-modal input:focus,.sdr-modal select:focus{outline:none;border-color:#7c3aed}'
    + '.sdr-modal .row{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
    + '.sdr-modal button[type=submit]{width:100%;padding:13px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;margin-top:14px}'
    + '.sdr-modal button[type=submit]:hover{opacity:.9}'
    + '.sdr-modal button[type=submit][disabled]{opacity:.6;cursor:wait}'
    + '.sdr-modal .close{position:absolute;top:12px;right:12px;background:none;border:none;font-size:22px;cursor:pointer;color:#9ca3af;padding:4px 8px}'
    + '.sdr-modal .success{text-align:center;color:#059669;padding:20px 0}'
    + '.sdr-modal .success h3{font-size:18px;margin-bottom:8px}'
    + '.sdr-modal .err{color:#b91c1c;font-size:13px;margin-top:8px;display:none}'
    + '.sdr-inline{background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1px solid #ddd6fe;border-radius:12px;padding:24px;margin:32px 0;display:none}'
    + '.sdr-inline h3{font-size:18px;margin:0 0 8px;color:#5b21b6;font-weight:800}'
    + '.sdr-inline p{font-size:13px;color:#6b7280;margin:0 0 16px}'
    + '.sdr-inline .row{display:flex;gap:8px;flex-wrap:wrap}'
    + '.sdr-inline input{flex:1;min-width:200px;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:inherit}'
    + '.sdr-inline button{padding:10px 20px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit}'
    + '.sdr-sticky{position:fixed;bottom:0;left:0;right:0;background:#7c3aed;color:#fff;padding:12px 20px;z-index:99997;display:none;align-items:center;justify-content:center;gap:12px;font-size:14px;box-shadow:0 -2px 10px rgba(0,0,0,.15)}'
    + '.sdr-sticky a{color:#fff;font-weight:700;text-decoration:underline}'
    + '.sdr-sticky .close-sticky{background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:18px;padding:0 8px}'
    + '@keyframes sdr-fade{from{opacity:0}to{opacity:1}}'
    + '@keyframes sdr-slide{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}'
    + '@media(max-width:520px){.sdr-modal .row{grid-template-columns:1fr}}';
  document.head.appendChild(style);

  // ─── EXIT-INTENT MODAL ──────────────────────────────
  var overlay = document.createElement('div');
  overlay.className = 'sdr-overlay';
  overlay.innerHTML =
      '<div class="sdr-modal">'
    +   '<button class="close" aria-label="Fechar" onclick="this.closest(\'.sdr-overlay\').classList.remove(\'active\')">&times;</button>'
    +   '<div id="sdr-exit-form">'
    +     '<h2>Antes de ir... 🎓</h2>'
    +     '<p>Receba grátis o guia <b>"Como Reduzir Inadimplência em 30%"</b> + análise personalizada da sua escola.</p>'
    +     '<form id="sdr-exit-capture">'
    +       '<label>Seu nome</label><input type="text" name="name" required placeholder="Ex.: Maria Silva">'
    +       '<label>E-mail profissional</label><input type="email" name="email" required placeholder="diretora@escola.com.br">'
    +       '<label>Nome da escola</label><input type="text" name="school_name" required placeholder="Ex.: Escola Bilíngue Caxias">'
    +       '<div class="row">'
    +         '<div><label>WhatsApp</label><input type="tel" name="phone" placeholder="(54) 9 8888-7777"></div>'
    +         '<div><label>Nº alunos</label><input type="number" name="alunos_estimados" min="10" max="20000" placeholder="287"></div>'
    +       '</div>'
    +       '<div class="row">'
    +         '<div><label>Cidade</label><input type="text" name="cidade" placeholder="Caxias do Sul"></div>'
    +         '<div><label>UF</label><input type="text" name="uf" maxlength="2" placeholder="RS"></div>'
    +       '</div>'
    +       '<label>Sistema atual</label>'
    +       '<select name="sistema_atual">'
    +         '<option value="">Selecione (opcional)</option>'
    +         '<option>Planilha / Caderno</option>'
    +         '<option>Escolaweb</option>'
    +         '<option>Sponte</option>'
    +         '<option>WPensar</option>'
    +         '<option>Class App</option>'
    +         '<option>Outro</option>'
    +       '</select>'
    +       '<button type="submit">Quero o Guia Grátis →</button>'
    +       '<div class="err" id="sdr-exit-err"></div>'
    +     '</form>'
    +   '</div>'
    +   '<div id="sdr-exit-success" class="success" style="display:none">'
    +     '<h3>✅ Recebido!</h3>'
    +     '<p>Em até 24h vamos te enviar o guia + uma análise personalizada. Fica de olho no e-mail.</p>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(overlay);

  // ─── INLINE CTA ─────────────────────────────────────
  var articleContent = document.querySelector('article, .blog-content, .post-content, main');
  if (articleContent) {
    var inlineCTA = document.createElement('div');
    inlineCTA.className = 'sdr-inline';
    inlineCTA.id = 'sdr-inline-cta';
    inlineCTA.innerHTML =
        '<h3>📊 Quanto sua escola perde sem automação?</h3>'
      + '<p>Calcule em 30s: Lumied recupera quanto da sua inadimplência por ano.</p>'
      + '<div class="row">'
      +   '<input type="email" id="sdr-inline-email" placeholder="Seu e-mail profissional">'
      +   '<button type="button" id="sdr-inline-btn">Calcular ROI →</button>'
      + '</div>';

    var children = articleContent.children;
    var insertAt = Math.floor(children.length * 0.4);
    if (children[insertAt]) children[insertAt].after(inlineCTA);
    else articleContent.appendChild(inlineCTA);

    document.getElementById('sdr-inline-btn').addEventListener('click', function () {
      var email = document.getElementById('sdr-inline-email').value;
      var roiUrl = 'https://lumied.com.br/roi/'
        + (email ? '?email=' + encodeURIComponent(email) : '')
        + (utm.utm_source ? (email ? '&' : '?') + 'utm_source=' + encodeURIComponent(utm.utm_source) : '');
      track('inline_cta_click', 'roi_calc');
      window.open(roiUrl, '_blank');
    });
  }

  // ─── STICKY BOTTOM BAR ──────────────────────────────
  var sticky = document.createElement('div');
  sticky.className = 'sdr-sticky';
  sticky.id = 'sdr-sticky-bar';
  sticky.innerHTML =
      '<span>🎓 <a href="https://lumied.com.br/roi/" target="_blank" data-track="sticky_roi">Calcule seu ROI</a> · '
    + '<a href="https://lumied.com.br/demo/" target="_blank" data-track="sticky_demo">Demo 20min</a> · '
    + '<a href="https://lumied.com.br/vs/escolaweb/" target="_blank" data-track="sticky_vs">vs. Escolaweb</a></span>'
    + '<button class="close-sticky" aria-label="Fechar" onclick="this.parentElement.style.display=\'none\'">&times;</button>';
  document.body.appendChild(sticky);
  sticky.querySelectorAll('a[data-track]').forEach(function (a) {
    a.addEventListener('click', function () { track('sticky_click', a.dataset.track); });
  });

  // ─── TRIGGERS ───────────────────────────────────────
  var exitShown = false;
  document.addEventListener('mouseout', function (e) {
    if (exitShown || sessionStorage.getItem(SESSION_KEY)) return;
    if (e.clientY < 10 && e.relatedTarget === null) {
      overlay.classList.add('active');
      sessionStorage.setItem(SESSION_KEY, '1');
      exitShown = true;
      track('exit_intent_shown', location.pathname);
    }
  });

  var inlineShown = false;
  var stickyShown = false;
  window.addEventListener('scroll', function () {
    var scrollPct = window.scrollY / Math.max(document.body.scrollHeight - window.innerHeight, 1);
    if (!inlineShown && scrollPct > 0.3) {
      var el = document.getElementById('sdr-inline-cta');
      if (el) { el.style.display = 'block'; inlineShown = true; track('inline_cta_shown', location.pathname); }
    }
    if (!stickyShown && scrollPct > 0.5) {
      var sk = document.getElementById('sdr-sticky-bar');
      if (sk) { sk.style.display = 'flex'; stickyShown = true; track('sticky_shown', location.pathname); }
    }
  });

  // ─── FORM HANDLER ───────────────────────────────────
  var form = document.getElementById('sdr-exit-capture');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var btn = form.querySelector('button[type=submit]');
      var err = document.getElementById('sdr-exit-err');
      btn.disabled = true; btn.textContent = 'Enviando...';
      err.style.display = 'none';

      var alunos = parseInt(fd.get('alunos_estimados') || '0', 10);
      postLead({
        name: fd.get('name'),
        email: fd.get('email'),
        school_name: fd.get('school_name'),
        phone: fd.get('phone') || undefined,
        alunos_estimados: alunos > 0 ? alunos : undefined,
        cidade: fd.get('cidade') || undefined,
        uf: (fd.get('uf') || '').toString().toUpperCase().slice(0, 2) || undefined,
        sistema_atual: fd.get('sistema_atual') || undefined,
        source: 'blog-exit-intent',
      }, function () {
        document.getElementById('sdr-exit-form').style.display = 'none';
        document.getElementById('sdr-exit-success').style.display = 'block';
      }, function (errBody) {
        btn.disabled = false; btn.textContent = 'Quero o Guia Grátis →';
        err.textContent = (errBody && errBody.detail) || 'Erro ao enviar. Tente de novo em alguns segundos.';
        err.style.display = 'block';
      });
    });
  }
})();
