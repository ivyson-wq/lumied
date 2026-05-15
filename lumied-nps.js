// ═══════════════════════════════════════════════════════════════
//  Lumied — NPS Widget (Sprint 18 LAP)
//
//  Aparece após D14 e a cada 90 dias. Carrega em portais de gestão.
//  Alimenta o pilar Sentimento do LHS.
// ═══════════════════════════════════════════════════════════════
(function() {
  if (typeof window === 'undefined') return;

  var path = location.pathname.toLowerCase();
  if (!/gerente|secretaria/.test(path)) return; // só pra papéis decisores

  var SUPABASE_URL = (window.CONFIG && window.CONFIG.SUPABASE_URL) || 'https://brgorknbrjlfwvrrlwxj.supabase.co';
  var SUPABASE_ANON = (window.CONFIG && window.CONFIG.SUPABASE_ANON) || '';
  var API_URL = SUPABASE_URL + '/functions/v1/api';
  var COOLDOWN_KEY = 'lumied_nps_dismiss_at';
  var COOLDOWN_DAYS = 30; // se dismisar, espera 30 dias pra perguntar de novo

  function getToken() {
    return localStorage.getItem('gerente_token') || localStorage.getItem('staff_token');
  }

  function api(body) {
    var token = getToken();
    if (!token) return Promise.resolve(null);
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON },
      body: JSON.stringify(Object.assign({ _token: token }, body)),
    }).then(function(r) { return r.json(); }).catch(function() { return null; });
  }

  function recentDismiss() {
    var d = localStorage.getItem(COOLDOWN_KEY);
    if (!d) return false;
    var diff = Date.now() - parseInt(d, 10);
    return diff < COOLDOWN_DAYS * 86400000;
  }

  function init() {
    if (!getToken()) return;
    if (recentDismiss()) return;
    setTimeout(function() {
      api({ action: 'lap_nps_state' }).then(function(d) {
        if (!d || !d.elegivel) return;
        setTimeout(open, 8000); // aparece 8s depois de chegar elegível
      });
    }, 3000);
  }

  var state = { score: null, comentario: '', el: null };

  function open() {
    if (state.el) return;
    state.el = document.createElement('div');
    state.el.className = 'lap-nps-card';
    state.el.innerHTML =
      '<div class="lap-nps-head">' +
        '<h3>📊 Como tá sendo o Lumied?</h3>' +
        '<p>O quanto você recomendaria pra outra escola?</p>' +
        '<button class="lap-nps-close" data-act="close">×</button>' +
      '</div>' +
      '<div class="lap-nps-body">' +
        '<div class="lap-nps-scale" id="lap-nps-scale">' +
          renderScores() +
        '</div>' +
        '<div class="lap-nps-labels"><span>Nada provável</span><span>Muito provável</span></div>' +
        '<textarea class="lap-nps-comment" id="lap-nps-comment" placeholder="O que mais te marcou (positivo ou negativo)? (opcional)"></textarea>' +
        '<div class="lap-nps-footer">' +
          '<button class="lap-nps-btn ghost" data-act="close">Depois</button>' +
          '<button class="lap-nps-btn primary" data-act="submit" id="lap-nps-submit" disabled>Enviar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(state.el);
    bind();
  }

  function renderScores() {
    var html = '';
    for (var i = 0; i <= 10; i++) {
      var cat = i <= 6 ? 'detractor' : i <= 8 ? 'passive' : 'promoter';
      html += '<div class="lap-nps-score" data-v="' + i + '" data-cat="' + cat + '">' + i + '</div>';
    }
    return html;
  }

  function bind() {
    state.el.querySelectorAll('.lap-nps-score').forEach(function(el) {
      el.onclick = function() {
        state.score = parseInt(el.getAttribute('data-v'), 10);
        state.el.querySelectorAll('.lap-nps-score').forEach(function(x) { x.classList.remove('selected'); });
        el.classList.add('selected');
        state.el.querySelector('#lap-nps-submit').disabled = false;
      };
    });
    state.el.querySelector('#lap-nps-comment').oninput = function(e) {
      state.comentario = e.target.value;
    };
    state.el.querySelectorAll('[data-act="close"]').forEach(function(b) { b.onclick = closeAndCooldown; });
    state.el.querySelector('[data-act="submit"]').onclick = submit;
  }

  function closeAndCooldown() {
    localStorage.setItem(COOLDOWN_KEY, String(Date.now()));
    if (state.el) { state.el.remove(); state.el = null; }
  }

  function submit() {
    if (state.score == null) return;
    var btn = state.el.querySelector('[data-act="submit"]');
    btn.disabled = true; btn.textContent = 'Enviando…';
    api({ action: 'lap_nps_responder', score: state.score, comentario: state.comentario || null, contexto: location.pathname }).then(function(d) {
      if (!d || d.error) { btn.disabled = false; btn.textContent = 'Enviar'; alert('Falha ao enviar.'); return; }
      state.el.innerHTML =
        '<div class="lap-nps-head"><h3>Obrigado!</h3></div>' +
        '<div class="lap-nps-body lap-nps-thanks">' +
          '<div class="icon">' + (state.score >= 9 ? '🎉' : state.score >= 7 ? '🙏' : '💜') + '</div>' +
          '<p style="font-size:13.5px;color:#475569;line-height:1.5;margin:8px 0 0">' +
            (state.score >= 9 ? 'Você é um(a) <b>promoter</b>! Que tal compartilhar a Lumied com uma escola amiga? Ofereça nosso link de indicação.' :
             state.score >= 7 ? 'Obrigado pelo feedback! Vamos continuar melhorando.' :
             'Obrigado por compartilhar. Vamos analisar com cuidado e voltar pra você.') +
          '</p>' +
          '<button class="lap-nps-btn ghost" data-act="close" style="margin-top:14px">Fechar</button>' +
        '</div>';
      state.el.querySelector('[data-act="close"]').onclick = function() {
        localStorage.setItem(COOLDOWN_KEY, String(Date.now()));
        if (state.el) { state.el.remove(); state.el = null; }
      };
      setTimeout(function() {
        if (state.el) { state.el.remove(); state.el = null; }
      }, 6000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
