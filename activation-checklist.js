// ═══════════════════════════════════════════════════════════════
//  Lumied — Activation Checklist Widget
//
//  Sprint 4 do Lumied Activation Program. Widget persistente que
//  guia o superadmin pelos próximos passos de ativação. Inspirado
//  em HubSpot/Asana/Linear/ClickUp.
//
//  Uso:
//    <script src="/activation-checklist.js" defer></script>
//
//  Características:
//   - Auto-init no canto inferior direito
//   - Fetch /api?action=lap_checklist_get (token gerente)
//   - Re-busca a cada 5min ou ao recuperar foco
//   - Minimizar persiste em localStorage
//   - Esconder item até amanhã (1 click)
//   - Marcar item como feito manualmente
//   - 100% completo → mensagem de parabéns + autoesconde 7 dias
//   - Só renderiza se houver token de gerente (gerente.html etc.)
// ═══════════════════════════════════════════════════════════════
(function() {
  if (typeof window === 'undefined') return;

  // Só rodar em portais de gestão (não em familia/professora/aluno/index)
  var path = location.pathname.toLowerCase();
  var ALLOW_PATHS = ['gerente', 'secretaria', 'admin'];
  var IS_ALLOWED = ALLOW_PATHS.some(function(p) { return path.indexOf(p) >= 0; });
  if (!IS_ALLOWED) return;

  // Pegar token de gerente do localStorage
  function getToken() {
    return localStorage.getItem('gerente_token')
        || localStorage.getItem('staff_token')
        || null;
  }

  var SUPABASE_URL = (window.CONFIG && window.CONFIG.SUPABASE_URL) || 'https://brgorknbrjlfwvrrlwxj.supabase.co';
  var SUPABASE_ANON = (window.CONFIG && window.CONFIG.SUPABASE_ANON) || '';
  var API_URL = SUPABASE_URL + '/functions/v1/api';

  var STATE_KEY = 'lumied_lap_checklist_state'; // armazena: { minimized: bool, hidden_until_completion: bool }
  var REFRESH_MS = 5 * 60 * 1000;
  var POST_DISMISS_AUTO_HIDE_DAYS = 7;

  function loadLocalState() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : { minimized: false };
    } catch (e) { return { minimized: false }; }
  }
  function saveLocalState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) { /* */ }
  }

  var localState = loadLocalState();
  var serverState = null;
  var container = null;
  var refreshTimer = null;

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

  function fetchState() {
    return api({ action: 'lap_checklist_get' }).then(function(data) {
      if (!data || data.error) return null;
      serverState = data;
      return data;
    });
  }

  function init() {
    if (!getToken()) return;
    // delay 1.5s pra não atrapalhar 1ª impressão da tela
    setTimeout(function() {
      fetchState().then(function(s) {
        if (!s) return;
        render();
      });
      refreshTimer = setInterval(function() {
        fetchState().then(function() { render(); });
      }, REFRESH_MS);
      window.addEventListener('focus', function() {
        fetchState().then(function() { render(); });
      });
    }, 1500);
  }

  function render() {
    if (!serverState) return;
    // 100% completo + escondido até nova fase → não renderiza
    if (serverState.completed_all && localState.completed_dismissed_at) {
      var since = Date.now() - new Date(localState.completed_dismissed_at).getTime();
      if (since < POST_DISMISS_AUTO_HIDE_DAYS * 86400000) {
        hide();
        return;
      }
    }

    if (!container) {
      container = document.createElement('div');
      container.id = 'lumied-lap-checklist';
      document.body.appendChild(container);
    }

    if (localState.minimized) {
      renderMinimized();
    } else {
      renderExpanded();
    }
  }

  function hide() {
    if (container) { container.remove(); container = null; }
  }

  function renderMinimized() {
    var percent = serverState.percent;
    var done = serverState.done;
    var total = serverState.total;
    container.innerHTML = '';
    container.setAttribute('style', [
      'position:fixed','bottom:18px','right:18px','z-index:2147483600',
      'background:#0F172A','color:#fff','border-radius:12px',
      'padding:10px 14px','font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
      'font-size:13px','box-shadow:0 8px 24px rgba(0,0,0,0.2)','cursor:pointer',
      'display:flex','align-items:center','gap:10px','border:1px solid rgba(255,255,255,0.08)',
    ].join(';'));
    container.innerHTML =
      '<span style="font-size:18px">🚀</span>' +
      '<span><b>' + done + '/' + total + '</b> · ' + percent + '%</span>' +
      '<span style="opacity:.6;font-size:11px">[ expandir ]</span>';
    container.onclick = function() {
      localState.minimized = false; saveLocalState(localState); render();
    };
  }

  function renderExpanded() {
    var s = serverState;
    container.onclick = null;
    container.setAttribute('style', [
      'position:fixed','bottom:18px','right:18px','z-index:2147483600',
      'width:340px','max-width:calc(100vw - 36px)',
      'background:#fff','color:#1a1a1a','border-radius:14px',
      'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
      'font-size:13px','box-shadow:0 12px 40px rgba(0,0,0,0.18)',
      'border:1px solid #e5e7eb','overflow:hidden',
    ].join(';'));

    var header = '<div style="background:linear-gradient(135deg,#6C63FF,#3B82F6);color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;">'
      + '<div>'
      + '<div style="font-weight:800;font-size:14.5px;line-height:1.1;">🚀 Ativação Lumied</div>'
      + '<div style="font-size:11.5px;opacity:.85;margin-top:2px">' + s.done + ' de ' + s.total + ' concluídos</div>'
      + '</div>'
      + '<div style="display:flex;gap:6px">'
      + '<button class="lap-mini" title="Minimizar" style="background:rgba(255,255,255,0.15);border:none;color:#fff;width:26px;height:26px;border-radius:6px;cursor:pointer;font-size:14px">—</button>'
      + '</div>'
      + '</div>';

    var bar = '<div style="background:#F1F5F9;height:4px"><div style="background:#10b981;height:100%;width:' + s.percent + '%;transition:width .4s"></div></div>';

    var itemsHtml = '';
    if (s.completed_all) {
      itemsHtml = '<div style="padding:24px 18px;text-align:center;">'
        + '<div style="font-size:36px;margin-bottom:8px">🎉</div>'
        + '<div style="font-weight:800;font-size:14px;margin-bottom:6px">Ativação completa!</div>'
        + '<div style="color:#64748b;font-size:12px;margin-bottom:14px">Sua escola passou de todos os marcos iniciais. Continue acompanhando o progresso em Saúde CS no admin.</div>'
        + '<button class="lap-done" style="background:#10b981;color:#fff;border:none;padding:7px 14px;border-radius:7px;font-weight:600;font-size:12px;cursor:pointer">Esconder por 7 dias</button>'
        + '</div>';
    } else {
      itemsHtml = '<div style="max-height:340px;overflow-y:auto">';
      s.items.forEach(function(it, idx) {
        var bg = it.done ? '#F0FDF4' : (idx % 2 ? '#fafafa' : '#fff');
        var iconDone = it.done ? '✓' : it.icon;
        var iconColor = it.done ? '#16a34a' : '#64748b';
        var labelStyle = it.done ? 'text-decoration:line-through;color:#94a3b8' : '';
        var ctaTitle = (it.cta && it.cta.description) ? esc(it.cta.description) : '';
        itemsHtml += '<div data-key="' + esc(it.key) + '" style="display:flex;align-items:flex-start;gap:10px;padding:9px 14px;border-bottom:1px solid #f1f5f9;background:' + bg + '">'
          + '<div style="font-size:16px;color:' + iconColor + ';width:18px;text-align:center;line-height:1.4">' + iconDone + '</div>'
          + '<div style="flex:1;min-width:0">'
          + '  <div style="font-size:12.5px;font-weight:600;line-height:1.3;' + labelStyle + '">' + esc(it.label) + '</div>'
          + (ctaTitle && !it.done ? '<div style="font-size:11px;color:#64748b;line-height:1.3;margin-top:2px">' + ctaTitle + '</div>' : '')
          + '</div>'
          + (it.done ? '' :
              '<div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0">'
              + (it.cta && it.cta.href ? '<a class="lap-go" data-href="' + esc(it.cta.href) + '" title="Ir agora" style="background:#6C63FF;color:#fff;font-size:11px;padding:3px 8px;border-radius:5px;cursor:pointer;text-decoration:none;text-align:center;font-weight:600">Ir →</a>' : '')
              + '<button class="lap-mark" data-key="' + esc(it.key) + '" title="Marcar como feito" style="background:none;border:1px solid #e5e7eb;color:#64748b;font-size:10.5px;padding:2px 6px;border-radius:5px;cursor:pointer">Já fiz</button>'
              + '<button class="lap-dismiss" data-key="' + esc(it.key) + '" title="Esconder até amanhã" style="background:none;border:none;color:#94a3b8;font-size:11px;padding:2px;cursor:pointer">⊘</button>'
              + '</div>')
          + '</div>';
      });
      itemsHtml += '</div>';
    }

    var footer = '<div style="padding:8px 14px;background:#fafafa;font-size:10.5px;color:#94a3b8;text-align:center;border-top:1px solid #f1f5f9">'
      + 'Progresso da escola — atualizado a cada 5 min'
      + '</div>';

    container.innerHTML = header + bar + itemsHtml + footer;

    // Bindings
    container.querySelector('.lap-mini').onclick = function() {
      localState.minimized = true; saveLocalState(localState); render();
    };
    var doneBtn = container.querySelector('.lap-done');
    if (doneBtn) doneBtn.onclick = function() {
      localState.completed_dismissed_at = new Date().toISOString();
      saveLocalState(localState); hide();
    };
    Array.prototype.forEach.call(container.querySelectorAll('.lap-go'), function(a) {
      a.onclick = function(e) {
        e.preventDefault();
        var href = a.getAttribute('data-href');
        location.href = href;
      };
    });
    Array.prototype.forEach.call(container.querySelectorAll('.lap-mark'), function(b) {
      b.onclick = function() {
        var key = b.getAttribute('data-key');
        api({ action: 'lap_checklist_mark_done', item_key: key }).then(function() {
          fetchState().then(render);
        });
      };
    });
    Array.prototype.forEach.call(container.querySelectorAll('.lap-dismiss'), function(b) {
      b.onclick = function() {
        var key = b.getAttribute('data-key');
        api({ action: 'lap_checklist_dismiss', item_key: key, until_days: 1 }).then(function() {
          fetchState().then(render);
        });
      };
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
