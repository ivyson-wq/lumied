// ═══════════════════════════════════════════════════════════════
//  Lumied — Invite Modal + Auto-redeem (Sprint 10 LAP)
//
//  Comportamento:
//   - Em portais de gestão: botão "👥 Convidar" no topo direito,
//     abre modal pra gerar magic link e enviar via WA/Email.
//   - Em QUALQUER página (incluindo familia.html, index.html):
//     se URL tem ?invite=TOKEN, faz auto-redeem ao carregar.
//
//  Auto-redeem:
//   - Chama lap_invite_redeem público
//   - Salva token no localStorage do papel certo (gerente_token,
//     prof_token, secretaria_token, family/aluno_token...)
//   - Redireciona pro portal apropriado
// ═══════════════════════════════════════════════════════════════
(function() {
  if (typeof window === 'undefined') return;

  var SUPABASE_URL = (window.CONFIG && window.CONFIG.SUPABASE_URL) || 'https://brgorknbrjlfwvrrlwxj.supabase.co';
  var SUPABASE_ANON = (window.CONFIG && window.CONFIG.SUPABASE_ANON) || '';
  var API_URL = SUPABASE_URL + '/functions/v1/api';

  function apiPublic(body) {
    return fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SUPABASE_ANON,
      },
      body: JSON.stringify(body),
    }).then(function(r) { return r.json(); }).catch(function() { return null; });
  }

  function apiAuth(body) {
    var token = localStorage.getItem('gerente_token') || localStorage.getItem('staff_token');
    if (!token) return Promise.resolve(null);
    return apiPublic(Object.assign({ _token: token }, body));
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ─── 1. AUTO-REDEEM se URL tem ?invite=TOKEN ──────────────────
  function tryAutoRedeem() {
    var match = location.search.match(/[?&]invite=([A-Za-z0-9_-]{20,})/);
    if (!match) return false;
    var token = match[1];

    var loader = document.createElement('div');
    loader.className = 'lap-redeem-loader';
    loader.innerHTML =
      '<div class="lap-redeem-spinner"></div>' +
      '<div class="lap-redeem-msg">Validando seu convite...</div>';
    document.body.appendChild(loader);

    apiPublic({ action: 'lap_invite_redeem', token: token }).then(function(d) {
      if (!d || d.error) {
        var msg = (d && d.error && (d.error.message || d.error.code)) || 'Convite inválido';
        if (msg === 'INVITE_USED') msg = 'Esse convite já foi usado. Faça login normalmente.';
        else if (msg === 'INVITE_EXPIRED') msg = 'Esse convite expirou. Peça um novo.';
        loader.innerHTML =
          '<div class="lap-redeem-err">' + esc(msg) + '</div>' +
          '<a href="/" style="font-size:12.5px;color:#6C63FF;text-decoration:none;font-weight:600">← Voltar pra tela inicial</a>';
        return;
      }

      // Salva token conforme papel
      var papel = d.papel;
      var key = 'gerente_token';
      var destino = '/gerente.html';
      if (papel === 'professora' || papel === 'professora_assistente') {
        key = 'prof_token'; destino = '/professora.html';
      } else if (papel === 'secretaria' || papel === 'comercial' || papel === 'manutencao' ||
                 papel === 'almoxarifado' || papel === 'nutricionista' || papel === 'impressao') {
        key = 'secretaria_token'; destino = '/secretaria.html';
      } else if (papel === 'diretor' || papel === 'gerente' || papel === 'financeiro' ||
                 papel === 'coord_pedagogico') {
        key = 'gerente_token'; destino = '/gerente.html';
      }
      localStorage.setItem(key, d.token);
      localStorage.setItem('lap_invite_first_login', 'yes');

      loader.innerHTML =
        '<div style="font-size:42px">🎉</div>' +
        '<div class="lap-redeem-msg">Bem-vindo(a), ' + esc(d.nome || '') + '! Redirecionando...</div>';

      setTimeout(function() {
        // Remove ?invite= da URL pra limpar
        location.replace(destino);
      }, 1500);
    });
    return true;
  }

  // ─── 2. MODAL DE CONVITE (em portais de gestão) ────────────────
  function isPortalGestao() {
    var p = location.pathname.toLowerCase();
    return /gerente|secretaria|admin/.test(p) && !p.includes('/ajuda');
  }

  function isLoggedAsGestor() {
    return !!(localStorage.getItem('gerente_token') || localStorage.getItem('staff_token'));
  }

  function injectFab() {
    if (document.getElementById('lap-invite-fab')) return;
    var btn = document.createElement('button');
    btn.id = 'lap-invite-fab';
    btn.className = 'lap-invite-fab';
    btn.innerHTML = '<span style="font-size:14px">👥</span> Convidar';
    btn.title = 'Convidar colega (WhatsApp ou Email)';
    btn.onclick = openModal;
    document.body.appendChild(btn);
  }

  var modalState = { canal: 'whatsapp', papel: 'secretaria', result: null };

  function openModal() {
    var ov = document.createElement('div');
    ov.className = 'lap-invite-overlay';
    ov.id = 'lap-invite-overlay';
    ov.onclick = function(e) { if (e.target === ov) closeModal(); };
    document.body.appendChild(ov);
    renderModalForm();
  }

  function closeModal() {
    var ov = document.getElementById('lap-invite-overlay');
    if (ov) ov.remove();
    modalState.result = null;
  }

  function renderModalForm() {
    var ov = document.getElementById('lap-invite-overlay');
    if (!ov) return;
    ov.innerHTML =
      '<div class="lap-invite-modal" role="dialog">' +
        '<div class="lap-invite-header">' +
          '<div><h2>👥 Convidar colega</h2><p>Magic link sem senha · válido 7 dias</p></div>' +
          '<button class="lap-invite-close" data-act="close">×</button>' +
        '</div>' +
        '<div class="lap-invite-body">' +
          '<div class="lap-invite-field">' +
            '<label class="lap-invite-label">Nome (opcional)</label>' +
            '<input class="lap-invite-input" id="lap-inv-nome" placeholder="Ex: Maria Silva">' +
          '</div>' +
          '<div class="lap-invite-field">' +
            '<label class="lap-invite-label">E-mail *</label>' +
            '<input type="email" class="lap-invite-input" id="lap-inv-email" placeholder="email@escola.com.br" autofocus>' +
          '</div>' +
          '<div class="lap-invite-field">' +
            '<label class="lap-invite-label">Papel *</label>' +
            '<select class="lap-invite-select" id="lap-inv-papel">' +
              '<option value="diretor">Diretor(a)</option>' +
              '<option value="financeiro">Financeiro</option>' +
              '<option value="secretaria" selected>Secretaria</option>' +
              '<option value="comercial">Comercial / CRM</option>' +
              '<option value="manutencao">Manutenção</option>' +
              '<option value="almoxarifado">Almoxarifado</option>' +
              '<option value="nutricionista">Nutricionista</option>' +
              '<option value="coord_pedagogico">Coordenação Pedagógica</option>' +
              '<option value="professora">Professora</option>' +
            '</select>' +
          '</div>' +
          '<div class="lap-invite-field">' +
            '<label class="lap-invite-label">Como enviar? *</label>' +
            '<div class="lap-invite-canal">' +
              '<div class="lap-invite-canal-opt ' + (modalState.canal==='whatsapp'?'selected':'') + '" data-canal="whatsapp">' +
                '<div class="lap-invite-canal-icon">💬</div>' +
                '<div class="lap-invite-canal-label">WhatsApp</div>' +
              '</div>' +
              '<div class="lap-invite-canal-opt ' + (modalState.canal==='email'?'selected':'') + '" data-canal="email">' +
                '<div class="lap-invite-canal-icon">✉️</div>' +
                '<div class="lap-invite-canal-label">E-mail</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="lap-invite-field" id="lap-inv-tel-wrap" style="' + (modalState.canal==='whatsapp'?'':'display:none') + '">' +
            '<label class="lap-invite-label">Telefone (WhatsApp) *</label>' +
            '<input type="tel" class="lap-invite-input" id="lap-inv-tel" placeholder="(54) 99999-9999">' +
          '</div>' +
        '</div>' +
        '<div class="lap-invite-footer">' +
          '<button class="lap-invite-btn ghost" data-act="close">Cancelar</button>' +
          '<button class="lap-invite-btn primary" data-act="submit" id="lap-inv-submit">Gerar link →</button>' +
        '</div>' +
      '</div>';

    ov.querySelectorAll('[data-act="close"]').forEach(function(b) { b.onclick = closeModal; });
    ov.querySelectorAll('.lap-invite-canal-opt').forEach(function(el) {
      el.onclick = function() {
        modalState.canal = el.getAttribute('data-canal');
        renderModalForm();
        setTimeout(function() {
          var f = document.getElementById('lap-inv-email');
          if (f && f.value === '') f.focus();
        }, 0);
      };
    });
    ov.querySelector('[data-act="submit"]').onclick = submit;
  }

  function submit() {
    var nome = document.getElementById('lap-inv-nome').value.trim();
    var email = document.getElementById('lap-inv-email').value.trim().toLowerCase();
    var papel = document.getElementById('lap-inv-papel').value;
    var telefone = (document.getElementById('lap-inv-tel') || {}).value || '';

    if (!email || !email.includes('@')) return alert('E-mail inválido.');
    if (modalState.canal === 'whatsapp' && telefone.replace(/\D/g, '').length < 10) {
      return alert('Telefone obrigatório p/ WhatsApp.');
    }

    var btn = document.getElementById('lap-inv-submit');
    btn.disabled = true;
    btn.textContent = 'Gerando…';

    apiAuth({
      action: 'lap_invite_create',
      nome: nome || null,
      email: email,
      papel: papel,
      canal: modalState.canal,
      telefone: telefone,
    }).then(function(d) {
      if (!d || d.error) {
        var msg = (d && d.error && (d.error.message || d.error)) || 'Falha ao gerar convite.';
        btn.disabled = false; btn.textContent = 'Gerar link →';
        return alert(msg);
      }
      modalState.result = d;
      renderModalResult();
    });
  }

  function renderModalResult() {
    var ov = document.getElementById('lap-invite-overlay');
    if (!ov || !modalState.result) return;
    var r = modalState.result;
    ov.innerHTML =
      '<div class="lap-invite-modal" role="dialog">' +
        '<div class="lap-invite-header">' +
          '<div><h2>✅ Link de convite criado</h2><p>Válido por 7 dias · 1 uso</p></div>' +
          '<button class="lap-invite-close" data-act="close">×</button>' +
        '</div>' +
        '<div class="lap-invite-body">' +
          '<div class="lap-invite-result">' +
            '<div class="lap-invite-result-title">Pronto pra enviar</div>' +
            '<div style="font-size:12px;color:#475569;margin-top:4px">Papel: <b>' + esc(r.papel) + '</b> · Canal: <b>' + esc(r.canal) + '</b></div>' +
            '<input class="lap-invite-result-link" id="lap-inv-link-input" readonly value="' + esc(r.url) + '">' +
            '<div class="lap-invite-result-actions">' +
              (r.wa_url ? '<a class="wa" href="' + esc(r.wa_url) + '" target="_blank" rel="noopener">💬 Abrir WhatsApp</a>' : '') +
              '<button class="copy" id="lap-inv-copy">📋 Copiar link</button>' +
            '</div>' +
          '</div>' +
          '<p style="font-size:11.5px;color:#94a3b8;margin:6px 0 0">Ao clicar no link, a pessoa entra direto no Lumied — sem senha. Pode definir senha depois em "Minha conta".</p>' +
        '</div>' +
        '<div class="lap-invite-footer">' +
          '<button class="lap-invite-btn primary" data-act="close">Pronto</button>' +
        '</div>' +
      '</div>';

    ov.querySelectorAll('[data-act="close"]').forEach(function(b) { b.onclick = closeModal; });
    document.getElementById('lap-inv-copy').onclick = function() {
      var inp = document.getElementById('lap-inv-link-input');
      inp.select();
      try {
        navigator.clipboard.writeText(inp.value).then(function() {
          document.getElementById('lap-inv-copy').textContent = '✓ Copiado!';
        });
      } catch (e) {
        document.execCommand('copy');
        document.getElementById('lap-inv-copy').textContent = '✓ Copiado!';
      }
    };
  }

  // ─── Init ─────────────────────────────────────────────────────
  function init() {
    // Sempre tenta auto-redeem primeiro (se houver ?invite=, processa e para)
    if (tryAutoRedeem()) return;

    // Em portais de gestão, mostra botão Convidar (se logado)
    if (isPortalGestao() && isLoggedAsGestor()) injectFab();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
