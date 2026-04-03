// ═══════════════════════════════════════════════════════════
//  Lumied — Ticket Widget (suporte flutuante)
//  Inclua <script src="/ticket-widget.js"></script> em qualquer portal
// ═══════════════════════════════════════════════════════════
(function() {
  'use strict';

  // Esperar autenticacao — widgets so aparecem apos login
  function hasAuth() {
    return localStorage.getItem('mb_token') || localStorage.getItem('prof_token') || localStorage.getItem('mb_aluno_token');
  }
  if (!hasAuth()) {
    const chk = setInterval(() => { if (hasAuth()) { clearInterval(chk); startWidget(); } }, 2000);
    return;
  }
  startWidget();
  function startWidget() {

  // Detectar portal
  const path = location.pathname;
  let portal = 'pais';
  if (path.includes('gerente')) portal = 'gerente';
  else if (path.includes('professora')) portal = 'professora';
  else if (path.includes('secretaria')) portal = 'secretaria';
  else if (path.includes('aluno')) portal = 'aluno';
  else if (path.includes('admin')) return; // Não mostrar no admin

  // Detectar email do usuário logado
  function getUserEmail() {
    try {
      // Supabase Auth
      const sb = localStorage.getItem('sb-' + (typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_URL : '').split('//')[1]?.split('.')[0] + '-auth-token');
      if (sb) { const d = JSON.parse(sb); return d?.user?.email || ''; }
    } catch {}
    return '';
  }

  // CSS — botão acima da Lumi bar (bottom:72px) para não sobrepor
  const style = document.createElement('style');
  style.textContent = `
    #tw-btn{position:fixed;bottom:72px;right:20px;width:44px;height:44px;border-radius:50%;background:#C8102E;color:#fff;border:none;cursor:pointer;font-size:18px;box-shadow:0 4px 16px rgba(200,16,46,.4);z-index:9995;transition:transform .2s,box-shadow .2s;display:flex;align-items:center;justify-content:center;}
    #tw-btn:hover{transform:scale(1.1);box-shadow:0 6px 24px rgba(200,16,46,.5);}
    #tw-tooltip{position:fixed;bottom:80px;right:72px;background:#fff;color:#1a1a1a;padding:8px 14px;border-radius:10px;font-family:'DM Sans',system-ui,sans-serif;font-size:12px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.12);z-index:9995;white-space:nowrap;opacity:0;transform:translateX(8px);transition:all .3s;pointer-events:none;}
    #tw-tooltip.show{opacity:1;transform:translateX(0);}
    #tw-tooltip::after{content:'';position:absolute;right:-6px;top:50%;transform:translateY(-50%);border:6px solid transparent;border-left-color:#fff;}
    #tw-panel{position:fixed;bottom:124px;right:20px;width:340px;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.2);z-index:9999;display:none;animation:twSlide .25s ease;font-family:'DM Sans',system-ui,sans-serif;overflow:hidden;}
    @keyframes twSlide{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
    #tw-panel.show{display:block;}
    .tw-header{background:#1c1712;color:#fff;padding:16px 18px;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:space-between;}
    .tw-header button{background:none;border:none;color:rgba(255,255,255,.6);cursor:pointer;font-size:18px;padding:0 4px;}
    .tw-body{padding:16px 18px;}
    .tw-body label{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#7a7169;margin-bottom:5px;margin-top:12px;}
    .tw-body label:first-child{margin-top:0;}
    .tw-body select,.tw-body textarea{width:100%;padding:9px 11px;border:1.5px solid #e2dbd1;border-radius:8px;font-family:inherit;font-size:13px;outline:none;background:#fdfbf8;transition:border-color .2s;resize:vertical;}
    .tw-body select:focus,.tw-body textarea:focus{border-color:#C8102E;}
    .tw-submit{width:100%;padding:11px;background:#C8102E;color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;margin-top:16px;transition:background .2s;}
    .tw-submit:hover{background:#a00d24;}
    .tw-submit:disabled{opacity:.5;cursor:not-allowed;}
    .tw-success{text-align:center;padding:32px 16px;color:#2d7a3a;font-size:14px;}
    .tw-success span{font-size:36px;display:block;margin-bottom:10px;}
  `;
  document.head.appendChild(style);

  // Botão
  const btn = document.createElement('button');
  btn.id = 'tw-btn';
  btn.innerHTML = '?';
  btn.setAttribute('aria-label', 'Abrir suporte — enviar dúvida, bug ou sugestão');
  document.body.appendChild(btn);

  // Tooltip balão informativo
  const tooltip = document.createElement('div');
  tooltip.id = 'tw-tooltip';
  tooltip.textContent = 'Precisa de ajuda? Envie uma dúvida ou reporte um problema.';
  document.body.appendChild(tooltip);

  // Mostrar tooltip após 5s, esconder após 8s
  setTimeout(function() {
    tooltip.classList.add('show');
    setTimeout(function() { tooltip.classList.remove('show'); }, 5000);
  }, 5000);

  // Painel
  const panel = document.createElement('div');
  panel.id = 'tw-panel';
  panel.innerHTML = `
    <div class="tw-header">
      <span>Precisa de ajuda?</span>
      <button onclick="document.getElementById('tw-panel').classList.remove('show')">&times;</button>
    </div>
    <div class="tw-body" id="tw-form">
      <label>Tipo</label>
      <select id="tw-tipo">
        <option value="bug">Bug / Erro</option>
        <option value="duvida">Duvida</option>
        <option value="sugestao">Sugestao</option>
        <option value="urgente">Urgente</option>
      </select>
      <label>Descreva o problema</label>
      <textarea id="tw-desc" rows="4" placeholder="Descreva o que aconteceu ou o que precisa..."></textarea>
      <button class="tw-submit" id="tw-send" onclick="twEnviar()">Enviar</button>
      <a href="/ajuda/?portal=' + portal + '" target="_blank" style="display:block;text-align:center;margin-top:12px;font-size:12px;color:#7a7169;text-decoration:none;">📖 Consultar Manual de Ajuda</a>
    </div>
  `;
  document.body.appendChild(panel);

  btn.addEventListener('click', function() {
    panel.classList.toggle('show');
  });

  // Enviar
  window.twEnviar = async function() {
    const desc = document.getElementById('tw-desc').value.trim();
    if (!desc) return;
    const sendBtn = document.getElementById('tw-send');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Enviando...';

    const email = getUserEmail() || 'anonimo@lumied.com.br';
    const body = {
      action: 'ticket_create',
      email: email,
      portal: portal,
      tipo: document.getElementById('tw-tipo').value,
      descricao: desc,
      url_pagina: location.href,
      user_agent: navigator.userAgent,
      resolucao_tela: screen.width + 'x' + screen.height,
    };

    try {
      const url = (typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_URL : '') + '/functions/v1/api';
      const anon = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_ANON : '';
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': anon, 'Authorization': 'Bearer ' + anon },
        body: JSON.stringify(body)
      });
      document.getElementById('tw-form').innerHTML = '<div class="tw-success"><span>&#10003;</span>Ticket enviado!<br><small style="color:#7a7169;">Responderemos em breve.</small></div>';
      setTimeout(function() {
        panel.classList.remove('show');
        // Reset form
        setTimeout(function() {
          document.getElementById('tw-form').innerHTML = `
            <label>Tipo</label>
            <select id="tw-tipo">
              <option value="bug">Bug / Erro</option>
              <option value="duvida">Duvida</option>
              <option value="sugestao">Sugestao</option>
              <option value="urgente">Urgente</option>
            </select>
            <label>Descreva o problema</label>
            <textarea id="tw-desc" rows="4" placeholder="Descreva o que aconteceu ou o que precisa..."></textarea>
            <button class="tw-submit" id="tw-send" onclick="twEnviar()">Enviar</button>
            <a href="/ajuda/?portal=' + portal + '" target="_blank" style="display:block;text-align:center;margin-top:12px;font-size:12px;color:#7a7169;text-decoration:none;">📖 Consultar Manual de Ajuda</a>
          `;
        }, 300);
      }, 2500);
    } catch (e) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Enviar';
      alert('Erro ao enviar ticket. Tente novamente.');
    }
  };

  } // fim da function startWidget()
})();
