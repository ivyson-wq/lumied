// School CRM - WhatsApp Web Extension
(function() {
  let templates = [];
  let panelOpen = false;
  let escolaNome = 'CRM';

  // Create toggle button
  const toggle = document.createElement('button');
  toggle.id = 'mb-crm-toggle';
  toggle.textContent = '🍁';
  toggle.title = 'CRM WhatsApp';
  toggle.onclick = () => {
    panelOpen = !panelOpen;
    panel.classList.toggle('hidden', !panelOpen);
    if (panelOpen && !templates.length) loadTemplates();
  };
  document.body.appendChild(toggle);

  // Create panel
  const panel = document.createElement('div');
  panel.id = 'mb-crm-panel';
  panel.classList.add('hidden');
  panel.innerHTML = `
    <div class="mb-panel-header">
      <span>🍁</span> <span id="mb-brand-name">CRM</span>
      <button onclick="document.getElementById('mb-crm-panel').classList.add('hidden')" style="margin-left:auto;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;">×</button>
    </div>
    <div class="mb-panel-body" id="mb-panel-body">
      <input type="text" class="mb-search" id="mb-search" placeholder="Buscar template..." oninput="window.mbFilterTemplates()">
      <div id="mb-templates-list" style="color:#999;font-size:12px;text-align:center;padding:20px;">Carregando templates...</div>
    </div>
  `;
  document.body.appendChild(panel);

  // Load templates from CRM
  async function loadTemplates() {
    const config = await new Promise(r => chrome.storage.local.get(['apiUrl','apiKey','token'], r));
    if (!config.apiUrl || !config.token) {
      document.getElementById('mb-templates-list').innerHTML = '<div style="color:#c00;padding:12px;font-size:12px;">Configure a extensao clicando no icone 🍁 na barra do Chrome.</div>';
      return;
    }
    try {
      const res = await fetch(config.apiUrl + '/functions/v1/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': config.apiKey, 'Authorization': 'Bearer ' + config.apiKey },
        body: JSON.stringify({ action: 'crm_templates_list', _token: config.token }),
      });
      const data = await res.json();
      templates = Array.isArray(data) ? data : [];
      renderTemplates(templates);
    } catch (e) {
      document.getElementById('mb-templates-list').innerHTML = '<div style="color:#c00;padding:12px;font-size:12px;">Erro ao carregar: ' + e.message + '</div>';
    }
  }

  function renderTemplates(items) {
    const el = document.getElementById('mb-templates-list');
    if (!items.length) { el.innerHTML = '<div style="color:#999;font-size:12px;padding:12px;">Nenhum template encontrado.</div>'; return; }
    const catLabels = { boas_vindas:'Boas-vindas', follow_up:'Follow-up', visita:'Visita', pos_visita:'Pos-Visita', proposta:'Proposta', matricula:'Matricula', geral:'Geral' };
    el.innerHTML = items.map((t, i) => `
      <div class="mb-tpl-card">
        <div class="tpl-name">${t.nome}</div>
        <div class="tpl-cat">${catLabels[t.categoria] || t.categoria}</div>
        <div class="tpl-preview">${t.conteudo.substring(0, 80)}...</div>
        <button class="tpl-send" data-idx="${i}">Enviar no chat</button>
      </div>
    `).join('');

    // Attach click handlers
    el.querySelectorAll('.tpl-send').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        sendTemplate(items[idx]);
      };
    });
  }

  function sendTemplate(template) {
    let msg = template.conteudo;
    // Replace variables with prompts
    const vars = msg.match(/\{\{(\w+)\}\}/g) || [];
    for (const v of vars) {
      const name = v.replace(/\{|\}/g, '');
      const val = prompt('Valor para ' + name + ':', '');
      if (val === null) return; // cancelled
      msg = msg.replace(new RegExp(v.replace(/[{}]/g, '\\$&'), 'g'), val);
    }

    // Insert into WhatsApp Web input
    const inputEl = document.querySelector('div[contenteditable="true"][data-tab="10"]')
      || document.querySelector('footer div[contenteditable="true"]')
      || document.querySelector('div[title="Digite uma mensagem"]');

    if (inputEl) {
      inputEl.focus();
      document.execCommand('insertText', false, msg);
      // Trigger input event
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      panel.classList.add('hidden');
      panelOpen = false;
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(msg);
      alert('Mensagem copiada! Cole no chat com Ctrl+V.\n(Abra um chat primeiro)');
    }
  }

  // Filter
  window.mbFilterTemplates = function() {
    const q = document.getElementById('mb-search').value.toLowerCase();
    const filtered = templates.filter(t =>
      t.nome.toLowerCase().includes(q) || t.conteudo.toLowerCase().includes(q) || (t.categoria||'').toLowerCase().includes(q)
    );
    renderTemplates(filtered);
  };
})();
