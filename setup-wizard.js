// ═══════════════════════════════════════════════════════════════
//  Lumied — Setup Wizard (Sprint 6 LAP)
//
//  Modal full-screen no 1º login do superadmin. 5 passos:
//   1. Qual seu papel?
//   2. Quantos alunos?
//   3. Em que mês escolar você está?
//   4. Que ERP usava antes?
//   5. Convide 2 colegas (opcional)
//
//  Persiste estado em escola_config via api(action=lap_wizard_*).
//  Auto-aparece quando: login OK + papel gerente/diretor + não-completed
//  + não-skipped-nas-últimas-24h.
//
//  Uso:
//    <script src="/setup-wizard.js" defer></script>
// ═══════════════════════════════════════════════════════════════
(function() {
  if (typeof window === 'undefined') return;

  // Só rodar em portais de gestão
  var path = location.pathname.toLowerCase();
  if (!/gerente|secretaria|admin/.test(path)) return;

  function getToken() {
    return localStorage.getItem('gerente_token') || localStorage.getItem('staff_token') || null;
  }

  var SUPABASE_URL = (window.CONFIG && window.CONFIG.SUPABASE_URL) || 'https://brgorknbrjlfwvrrlwxj.supabase.co';
  var SUPABASE_ANON = (window.CONFIG && window.CONFIG.SUPABASE_ANON) || '';
  var API_URL = SUPABASE_URL + '/functions/v1/api';

  function api(body) {
    var token = getToken();
    if (!token) return Promise.resolve(null);
    return fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SUPABASE_ANON,
      },
      body: JSON.stringify(Object.assign({ _token: token }, body)),
    })
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var state = {
    currentStep: 1,
    answers: {},
    completed: false,
    overlay: null,
  };

  // ─── Definição dos passos ─────────────────────────────────────
  var STEPS = [
    {
      key: 1,
      q: 'Qual é o seu papel?',
      help: 'Isso ajuda a personalizar seu painel inicial com os atalhos mais úteis pra você.',
      type: 'options',
      field: 'role',
      options: [
        { v: 'diretor',     icon: '👔', label: 'Diretor(a)',     hint: 'Visão executiva' },
        { v: 'financeiro',  icon: '💰', label: 'Financeiro',     hint: 'Cobranças e fluxo' },
        { v: 'secretaria',  icon: '📋', label: 'Secretaria',     hint: 'Alunos e CRM' },
        { v: 'manutencao',  icon: '🔧', label: 'Manutenção',     hint: 'Chamados e equipe' },
        { v: 'coord',       icon: '📚', label: 'Coordenação',    hint: 'Pedagógico' },
        { v: 'outro',       icon: '🙂', label: 'Outro',          hint: '' },
      ],
    },
    {
      key: 2,
      q: 'Quantos alunos a escola tem hoje?',
      help: 'Estimativa serve para escalar listas, paginação e relatórios. Você pode mudar depois.',
      type: 'number',
      field: 'alunos_estimados',
      placeholder: 'Ex: 150',
      min: 1, max: 5000,
    },
    {
      key: 3,
      q: 'Em que momento do ano letivo você está?',
      help: 'Isso decide se mostramos atalho de matrícula nova, cobrança ou fechamento.',
      type: 'select',
      field: 'mes_escolar',
      options: [
        { v: 'pre_matricula', label: 'Pré-matrícula / captação' },
        { v: 'inicio_ano',    label: 'Início do ano letivo' },
        { v: '1_bimestre',    label: '1º bimestre / trimestre' },
        { v: '2_bimestre',    label: '2º bimestre / trimestre' },
        { v: 'recesso',       label: 'Recesso (julho)' },
        { v: '3_bimestre',    label: '3º bimestre / trimestre' },
        { v: '4_bimestre',    label: '4º bimestre / fechamento' },
        { v: 'fechamento',    label: 'Final de ano / rematrícula' },
      ],
    },
    {
      key: 4,
      q: 'Que sistema usava antes do Lumied?',
      help: 'Se for um ERP que migramos, vamos te oferecer importação assistida dos dados.',
      type: 'options',
      field: 'erp_anterior',
      options: [
        { v: 'excel',      icon: '📊', label: 'Excel / Planilhas', hint: 'A migração mais comum' },
        { v: 'escolaweb',  icon: '🏫', label: 'Escolaweb',         hint: 'Importação assistida' },
        { v: 'sponte',     icon: '🏫', label: 'Sponte',            hint: 'Importação assistida' },
        { v: 'wpensar',    icon: '🏫', label: 'WPensar',           hint: 'Importação assistida' },
        { v: 'sophia',     icon: '🏫', label: 'Sophia',            hint: 'Importação assistida' },
        { v: 'totvs',      icon: '🏫', label: 'TOTVS',             hint: 'Importação assistida' },
        { v: 'outro',      icon: '🤷', label: 'Outro',             hint: '' },
        { v: 'nenhum',     icon: '✨', label: 'Primeiro sistema',  hint: 'Bem-vindo!' },
      ],
    },
    {
      key: 5,
      q: 'Convide até 2 colegas pra usar com você',
      help: 'Escolas com 2+ usuários têm 3x mais retenção. Você pode pular e convidar depois.',
      type: 'invites',
      field: 'convites',
      max: 2,
    },
  ];

  // ─── Inicialização ────────────────────────────────────────────
  function init() {
    if (!getToken()) return;
    // Delay pra não atrapalhar 1ª render
    setTimeout(function() {
      api({ action: 'lap_wizard_state' }).then(function(s) {
        if (!s || s.error) return;
        if (s.completed) return; // já finalizado
        if (s.skipped_until) {
          var sk = new Date(s.skipped_until);
          if (sk > new Date()) return; // ainda no período de skip
        }
        state.answers = s.answers || {};
        // Decide passo inicial — se já tem algumas respostas, avança
        var first = 1;
        for (var i = 0; i < STEPS.length; i++) {
          if (state.answers[STEPS[i].field] == null) { first = STEPS[i].key; break; }
          if (i === STEPS.length - 1) first = STEPS.length; // tudo respondido?
        }
        state.currentStep = first;
        render();
      });
    }, 800);
  }

  function render() {
    if (!state.overlay) {
      state.overlay = document.createElement('div');
      state.overlay.className = 'lap-wizard-overlay';
      document.body.appendChild(state.overlay);
    }
    var step = STEPS[state.currentStep - 1];
    if (!step) return;

    var dots = STEPS.map(function(s, i) {
      var cls = 'lap-wizard-dot';
      if (i + 1 === state.currentStep) cls += ' active';
      else if (i + 1 < state.currentStep) cls += ' done';
      return '<div class="' + cls + '"></div>';
    }).join('');

    var bodyHtml = renderStep(step);

    var canGoBack = state.currentStep > 1;
    var isLast = state.currentStep === STEPS.length;

    state.overlay.innerHTML =
      '<div class="lap-wizard-card" role="dialog" aria-modal="true" aria-labelledby="lap-wiz-title">' +
        '<div class="lap-wizard-header">' +
          '<button class="lap-wizard-skip" data-act="skip">Pular por agora</button>' +
          '<h2 id="lap-wiz-title" class="lap-wizard-title">Bem-vindo ao Lumied 👋</h2>' +
          '<p class="lap-wizard-subtitle">2 minutos pra personalizar sua experiência</p>' +
          '<div class="lap-wizard-progress">' +
            '<span>Passo ' + state.currentStep + ' de ' + STEPS.length + '</span>' +
            '<div class="lap-wizard-dots">' + dots + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="lap-wizard-body">' + bodyHtml + '</div>' +
        '<div class="lap-wizard-footer">' +
          (canGoBack ? '<button class="lap-wizard-btn ghost" data-act="back">← Voltar</button>' : '<span></span>') +
          '<button class="lap-wizard-btn primary" data-act="next" id="lap-wiz-next">' +
            (isLast ? 'Concluir 🎉' : 'Próximo →') +
          '</button>' +
        '</div>' +
      '</div>';

    bindEvents(step);
    validateNextButton(step);
  }

  function renderStep(step) {
    if (step.type === 'options') {
      var optsHtml = step.options.map(function(opt) {
        var selected = state.answers[step.field] === opt.v ? ' selected' : '';
        return '<div class="lap-wizard-opt' + selected + '" data-v="' + esc(opt.v) + '">' +
          '<div class="lap-wizard-opt-icon">' + opt.icon + '</div>' +
          '<div class="lap-wizard-opt-label">' + esc(opt.label) + '</div>' +
          (opt.hint ? '<div class="lap-wizard-opt-hint">' + esc(opt.hint) + '</div>' : '') +
          '</div>';
      }).join('');
      return '<h3 class="lap-wizard-q">' + esc(step.q) + '</h3>' +
             '<p class="lap-wizard-help">' + esc(step.help) + '</p>' +
             '<div class="lap-wizard-options">' + optsHtml + '</div>';
    }
    if (step.type === 'number') {
      var val = state.answers[step.field] ?? '';
      return '<h3 class="lap-wizard-q">' + esc(step.q) + '</h3>' +
             '<p class="lap-wizard-help">' + esc(step.help) + '</p>' +
             '<input type="number" class="lap-wizard-input" id="lap-wiz-num" placeholder="' + esc(step.placeholder || '') + '" min="' + step.min + '" max="' + step.max + '" value="' + esc(val) + '" />';
    }
    if (step.type === 'select') {
      var current = state.answers[step.field];
      var opts = step.options.map(function(o) {
        var sel = current === o.v ? ' selected' : '';
        return '<option value="' + esc(o.v) + '"' + sel + '>' + esc(o.label) + '</option>';
      }).join('');
      return '<h3 class="lap-wizard-q">' + esc(step.q) + '</h3>' +
             '<p class="lap-wizard-help">' + esc(step.help) + '</p>' +
             '<select class="lap-wizard-select" id="lap-wiz-sel">' +
               '<option value="">— escolha —</option>' + opts +
             '</select>';
    }
    if (step.type === 'invites') {
      var convites = (state.answers[step.field] || []);
      var c0 = convites[0] || { email: '', papel: 'secretaria' };
      var c1 = convites[1] || { email: '', papel: 'financeiro' };
      var papeisOpts = function(sel) {
        return ['diretor','financeiro','secretaria','manutencao','comercial','professora'].map(function(p) {
          return '<option value="' + p + '"' + (sel === p ? ' selected' : '') + '>' + p + '</option>';
        }).join('');
      };
      return '<h3 class="lap-wizard-q">' + esc(step.q) + '</h3>' +
             '<p class="lap-wizard-help">' + esc(step.help) + '</p>' +
             '<div class="lap-wizard-invite-row">' +
               '<input type="email" class="lap-wizard-input" id="lap-wiz-inv-email-0" placeholder="email@escola.com.br" value="' + esc(c0.email) + '" />' +
               '<select class="lap-wizard-select" id="lap-wiz-inv-papel-0">' + papeisOpts(c0.papel) + '</select>' +
             '</div>' +
             '<div class="lap-wizard-invite-row">' +
               '<input type="email" class="lap-wizard-input" id="lap-wiz-inv-email-1" placeholder="email@escola.com.br" value="' + esc(c1.email) + '" />' +
               '<select class="lap-wizard-select" id="lap-wiz-inv-papel-1">' + papeisOpts(c1.papel) + '</select>' +
             '</div>' +
             '<p style="font-size:11.5px;color:#94a3b8;margin-top:6px;">Os convites vão por e-mail. Eles aceitam clicando no link e definem a própria senha. Você pode deixar em branco e convidar depois.</p>';
    }
    return '';
  }

  function bindEvents(step) {
    var ov = state.overlay;
    ov.querySelectorAll('.lap-wizard-opt').forEach(function(el) {
      el.onclick = function() {
        var v = el.getAttribute('data-v');
        state.answers[step.field] = v;
        ov.querySelectorAll('.lap-wizard-opt').forEach(function(x) { x.classList.remove('selected'); });
        el.classList.add('selected');
        validateNextButton(step);
        // Auto-avança 250ms após seleção (UX padrão Notion)
        setTimeout(function() { goNext(step); }, 250);
      };
    });

    var numEl = ov.querySelector('#lap-wiz-num');
    if (numEl) numEl.oninput = function() {
      var n = Number(numEl.value);
      if (!isNaN(n) && n > 0) state.answers[step.field] = n;
      validateNextButton(step);
    };

    var selEl = ov.querySelector('#lap-wiz-sel');
    if (selEl) selEl.onchange = function() {
      if (selEl.value) state.answers[step.field] = selEl.value;
      validateNextButton(step);
    };

    // Invites: live capture
    var inv0e = ov.querySelector('#lap-wiz-inv-email-0');
    var inv0p = ov.querySelector('#lap-wiz-inv-papel-0');
    var inv1e = ov.querySelector('#lap-wiz-inv-email-1');
    var inv1p = ov.querySelector('#lap-wiz-inv-papel-1');
    function captureInvites() {
      var arr = [];
      if (inv0e && inv0e.value) arr.push({ email: inv0e.value.trim(), papel: inv0p.value });
      if (inv1e && inv1e.value) arr.push({ email: inv1e.value.trim(), papel: inv1p.value });
      state.answers[step.field] = arr;
      validateNextButton(step);
    }
    [inv0e, inv0p, inv1e, inv1p].forEach(function(el) {
      if (el) el.oninput = captureInvites, el.onchange = captureInvites;
    });

    // Skip
    ov.querySelector('[data-act="skip"]').onclick = function() {
      api({ action: 'lap_wizard_skip', current_step: state.currentStep }).then(close);
    };
    var bk = ov.querySelector('[data-act="back"]');
    if (bk) bk.onclick = function() { state.currentStep--; render(); };

    ov.querySelector('[data-act="next"]').onclick = function() { goNext(step); };
  }

  function validateNextButton(step) {
    var btn = state.overlay.querySelector('#lap-wiz-next');
    if (!btn) return;
    var ok = isStepValid(step);
    // Invites é sempre opcional → next sempre habilitado no passo 5
    if (step.type === 'invites') ok = true;
    btn.disabled = !ok;
  }

  function isStepValid(step) {
    var v = state.answers[step.field];
    if (step.type === 'number') return typeof v === 'number' && v >= step.min && v <= step.max;
    if (step.type === 'options' || step.type === 'select') return v != null && v !== '';
    if (step.type === 'invites') return true;
    return false;
  }

  function goNext(step) {
    if (!isStepValid(step) && step.type !== 'invites') return;

    // Salva o passo no backend (não-bloqueante)
    var value = {};
    value[step.field] = state.answers[step.field];
    api({ action: 'lap_wizard_save_step', step: state.currentStep, value: value });

    if (state.currentStep === STEPS.length) {
      // Último — completa
      api({ action: 'lap_wizard_complete' }).then(function() {
        showSuccess();
      });
    } else {
      state.currentStep++;
      render();
    }
  }

  function showSuccess() {
    state.overlay.innerHTML =
      '<div class="lap-wizard-card">' +
        '<div class="lap-wizard-body lap-wizard-success">' +
          '<div class="lap-wizard-success-icon">🎉</div>' +
          '<h2 class="lap-wizard-title" style="color:#1a1a1a">Pronto!</h2>' +
          '<p class="lap-wizard-help" style="max-width:380px;margin:8px auto 0">Personalizamos seu painel. Você pode continuar a ativação pelo widget 🚀 no canto inferior direito da tela.</p>' +
          '<div style="margin-top:24px"><button class="lap-wizard-btn primary" data-act="done">Começar a usar →</button></div>' +
        '</div>' +
      '</div>';
    state.overlay.querySelector('[data-act="done"]').onclick = close;
    setTimeout(close, 5000); // auto-fecha em 5s
  }

  function close() {
    if (state.overlay) {
      state.overlay.style.animation = 'lapWizFadeIn .25s reverse ease-out';
      setTimeout(function() {
        if (state.overlay) { state.overlay.remove(); state.overlay = null; }
        // Trigga refresh do checklist se existir
        if (window.__lumiedRefreshChecklist) window.__lumiedRefreshChecklist();
      }, 250);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
