// School CRM - WhatsApp Web Extension
(function() {
  let templates = [];
  let panelOpen = false;
  let escolaNome = 'CRM';
  let currentLeadInfo = null;

  const PANEL_WIDTH = 330;

  function setPanelOpen(open) {
    panelOpen = open;
    panel.classList.toggle('hidden', !open);
    toggle.classList.toggle('mb-toggle-hidden', open);
    // Push WhatsApp content to the left
    const appEl = document.getElementById('app') || document.querySelector('[data-testid="web"]') || document.body;
    if (open) {
      appEl.style.transition = 'margin-right .3s cubic-bezier(.4,0,.2,1)';
      appEl.style.marginRight = PANEL_WIDTH + 'px';
    } else {
      appEl.style.marginRight = '0';
    }
    if (open && !templates.length) loadTemplates();
    if (open) {
      // Always refresh lead for current conversation
      _lastContactKey = null;
      currentLeadInfo = null;
      var cardEl = document.getElementById('mb-lead-card');
      if (cardEl) cardEl.classList.add('hidden');
      var qaEl = document.getElementById('mb-lead-quick-actions');
      if (qaEl) qaEl.querySelectorAll('button').forEach(function(b) { b.disabled = true; });
      autoLookupLead();
      checkPendingSnoozes();
    }
  }

  // Create toggle button with owl logo
  const toggle = document.createElement('button');
  toggle.id = 'mb-crm-toggle';
  toggle.title = 'Lumied CRM v1.7.3';
  toggle.innerHTML = `<img src="${chrome.runtime.getURL('lumied-icon.png')}" alt="Lumied" style="width:40px;height:40px;border-radius:50%;">`;
  toggle.onclick = () => setPanelOpen(!panelOpen);
  document.body.appendChild(toggle);

  // Create panel
  const panel = document.createElement('div');
  panel.id = 'mb-crm-panel';
  panel.classList.add('hidden');
  panel.innerHTML = `
    <div class="mb-panel-header">
      <img src="${chrome.runtime.getURL('lumied-icon.png')}" alt="Lumied" style="width:22px;height:22px;border-radius:4px;">
      <span id="mb-brand-name">Lumied CRM</span>
      <span class="mb-version-badge">v1.7.3</span>
      <button class="mb-close-btn" id="mb-close-panel">&times;</button>
    </div>
    <div class="mb-panel-body" id="mb-panel-body">
      <div class="mb-section-label">Lead</div>
      <div id="mb-lead-card" class="mb-lead-card hidden">
        <div id="mb-lead-card-content"></div>
      </div>
      <div class="mb-lead-actions">
        <button class="mb-lead-btn mb-btn-primary" id="mb-capture-lead">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          Capturar Lead
        </button>
        <button class="mb-lead-btn mb-btn-secondary" id="mb-refresh-lead">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          Atualizar info do lead
        </button>
      </div>
      <div id="mb-lead-status" class="mb-lead-status hidden"></div>
      <div id="mb-lead-quick-actions" class="mb-lead-actions-2">
        <button class="mb-qa-btn" id="mb-qa-stage" title="Mover estágio (capture o lead primeiro)" disabled><span>↗</span> Mover</button>
        <button class="mb-qa-btn" id="mb-qa-snooze" title="Agendar envio (capture o lead primeiro)" disabled><span>⏰</span> Agendar</button>
        <button class="mb-qa-btn" id="mb-qa-call" title="Registrar ligação (capture o lead primeiro)" disabled><span>📞</span> Ligar</button>
        <button class="mb-qa-btn" id="mb-qa-tag" title="Tags (capture o lead primeiro)" disabled><span>🏷</span> Tag</button>
        <button class="mb-qa-btn mb-qa-ai" id="mb-qa-score" title="Recalcular score (capture o lead primeiro)" disabled><span>✨</span> Score</button>
      </div>
      <hr class="mb-divider">
      <div class="mb-section-label">Templates</div>
      <input type="text" class="mb-search" id="mb-search" placeholder="Buscar template..." oninput="window.mbFilterTemplates()">
      <div id="mb-templates-list" style="color:#999;font-size:12px;text-align:center;padding:20px;">Carregando templates...</div>
    </div>
  `;
  document.body.appendChild(panel);

  // Fetch escola name for branding + template auto-fill
  apiCall('config_publica').then(function(cfg) {
    if (cfg && cfg.escola_nome) {
      escolaNome = cfg.escola_nome;
      var brandEl = document.getElementById('mb-brand-name');
      if (brandEl) brandEl.textContent = cfg.escola_nome + ' CRM';
    }
  }).catch(function() {});

  // --- HELPERS ---

  var STATUS_TEXT_RE = /ltima vez|online|digitando|clique aqui|clique para mostrar|last seen|typing|click here|click to show|visto por|sem intera|às \d{1,2}|as \d{1,2}:\d{2}|^\d{1,2}:\d{2}$|^hoje$|^ontem$|default-contact|refreshed|undefined|null|^\s*$|^Pesquisar$|^Comunidade$|^Status$/i;

  function isStatusText(t) {
    return !t || STATUS_TEXT_RE.test(t);
  }

  // --- PHONE VALIDATION ---
  // Rejects LIDs (14+ digit internal IDs) and accepts real phones
  function isValidPhone(num) {
    if (!num) return false;
    var clean = num.replace(/\D/g, '');
    // BR phone: 55 + DDD(2) + number(8-9) = 12-13 digits
    if (/^55\d{10,11}$/.test(clean)) return true;
    // Local BR without country code: DDD(2) + number(8-9) = 10-11 digits
    if (/^\d{10,11}$/.test(clean)) return true;
    // International with + prefix stripped: starts with known country codes
    if (/^(1|44|49|33|34|39|351|54|56|57|58|595|598)\d{7,12}$/.test(clean)) return true;
    // Reject: 14+ digits are almost certainly LIDs, not phones
    return false;
  }

  // --- STORE INFO (page-level script via CustomEvent) ---
  // Returns { phone, isGroup, jid } — group chats are flagged so caller can block.
  function checkNumberOnWhatsApp(phone) {
    return new Promise(function(resolve) {
      var done = false;
      var handler = function(e) {
        if (done) return; done = true;
        window.removeEventListener('lumied-check-number-result', handler);
        resolve(e.detail && typeof e.detail.exists === 'boolean' ? e.detail.exists : null);
      };
      window.addEventListener('lumied-check-number-result', handler);
      window.dispatchEvent(new CustomEvent('lumied-check-number', { detail: { phone: phone } }));
      setTimeout(function() { if (!done) { done = true; resolve(null); } }, 4000);
    });
  }

  function getStoreInfo() {
    return new Promise(function(resolve) {
      var resolved = false;
      var handler = function(e) {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('lumied-phone-result', handler);
        var result = {
          phone: e.detail?.phone || null,
          isGroup: !!e.detail?.isGroup,
          jid: e.detail?.jid || null,
          name: e.detail?.name || null
        };
        console.log('[Lumied CRM] Store info:', result, 'debug:', e.detail?.debug);
        resolve(result);
      };
      window.addEventListener('lumied-phone-result', handler);
      window.dispatchEvent(new Event('lumied-get-phone'));
      // Timeout after 3500ms (IndexedDB lookup may take time)
      setTimeout(function() { if (!resolved) { resolved = true; resolve({ phone: null, isGroup: false, jid: null, name: null }); } }, 3500);
    });
  }

  async function getContactInfo() {
    var nome = null;
    var telefone = null;
    var isGroup = false;
    var jid = null;

    // --- PHONE PRIORITY #1: window.Store ---
    // Note: WhatsApp Web now uses @lid (Linked Device IDs) instead of @c.us.
    // The LID is NOT a phone number. We validate by checking if it looks like
    // a real BR phone: 12-13 digits starting with 55, or 10-11 digits (local).
    try {
      var storeInfo = await getStoreInfo();
      isGroup = storeInfo.isGroup;
      jid = storeInfo.jid;
      if (storeInfo.phone && isValidPhone(storeInfo.phone)) {
        telefone = storeInfo.phone;
      } else if (storeInfo.phone) {
        console.warn('[Lumied CRM] Store returned LID (not phone):', storeInfo.phone);
      }
    } catch(e) { console.warn('[Lumied CRM] Store info failed:', e); }

    // --- NAME DETECTION ---
    // Strategy 1: conversation-info-header and conversation-title (data-testid)
    var selectors = [
      '#main header [data-testid="conversation-info-header"] span[title]',
      '#main header [data-testid="conversation-title"] span[title]',
      '#main header [data-testid="conversation-title"]',
      '#main header div[role="button"] span[title]',
      '#main header span[title]',
      'header span[dir="auto"][title]',
    ];

    for (var s = 0; s < selectors.length; s++) {
      var els = document.querySelectorAll(selectors[s]);
      for (var i = 0; i < els.length; i++) {
        var t = els[i].getAttribute('title') || els[i].textContent || '';
        t = t.trim();
        if (t && !isStatusText(t)) {
          nome = t;
          break;
        }
      }
      if (nome) break;
    }

    // Strategy 2: first non-status span inside the header's clickable area
    if (!nome) {
      var headerBtns = document.querySelectorAll('#main header div[role="button"] span, #main header [data-testid="conversation-panel-wrapper"] span');
      for (var k = 0; k < headerBtns.length; k++) {
        var txt = (headerBtns[k].textContent || '').trim();
        if (txt && txt.length > 1 && txt.length < 60 && !isStatusText(txt) && !/^\d[\d\s\-()]{7,}$/.test(txt)) {
          nome = txt;
          break;
        }
      }
    }

    // Strategy 3: aria-label on the header contact info button
    if (!nome) {
      var infoBtn = document.querySelector('#main header div[role="button"][aria-label]');
      if (infoBtn) {
        var ariaLabel = infoBtn.getAttribute('aria-label') || '';
        if (ariaLabel && ariaLabel.length > 1 && ariaLabel.length < 60 && !isStatusText(ariaLabel)) {
          nome = ariaLabel;
        }
      }
    }

    // Strategy 4 (fallback): nome limpo do Store quando DOM nao encontrou
    // Store devolve nome sem o '~' (que o WhatsApp adiciona quando o contato
    // nao esta na agenda do operador), entao so usamos como fallback.
    if (!nome && storeInfo && storeInfo.name) {
      nome = storeInfo.name;
      console.log('[Lumied CRM] nome fallback do Store:', nome);
    }

    // --- PHONE DETECTION (DOM fallbacks — only if Store didn't find it) ---
    if (!telefone) {
      // Strategy A: header span with phone-like title
      var phoneSelectors = ['#main header span[title^="+"]', 'header span[title^="+"]'];
      for (var p = 0; p < phoneSelectors.length; p++) {
        var phoneEl = document.querySelector(phoneSelectors[p]);
        if (phoneEl) { telefone = phoneEl.getAttribute('title'); break; }
      }
      // Strategy B: name itself is a phone number
      if (!telefone && nome && /^\+?\d[\d\s\-()]{7,}$/.test(nome)) telefone = nome;
      // Strategy C: header spans with phone pattern (title OR textContent)
      if (!telefone) {
        var allSpans = document.querySelectorAll('#main header span[title], #main header span[dir="auto"]');
        for (var j = 0; j < allSpans.length; j++) {
          var sv = allSpans[j].getAttribute('title') || allSpans[j].textContent || '';
          if (/^\+?\d[\d\s\-()]{7,}$/.test(sv.trim())) { telefone = sv.trim(); break; }
        }
      }
      // Strategy D: message data-id (false_PHONE@c.us = received from contact)
      if (!telefone) {
        var msgEls = document.querySelectorAll('#main div[data-id]');
        for (var m = msgEls.length - 1; m >= 0 && m >= msgEls.length - 50; m--) {
          var did = msgEls[m].getAttribute('data-id') || '';
          var phoneMatch = did.match(/false_(\d{10,15})@/);
          if (phoneMatch) { telefone = phoneMatch[1]; break; }
        }
      }
      // Strategy E: active chat list item
      if (!telefone) {
        var activeChat = document.querySelector('[data-testid="cell-frame-container"][aria-selected="true"]')
          || document.querySelector('[aria-selected="true"][data-id]');
        if (activeChat) {
          var chatDataId = activeChat.getAttribute('data-id') || activeChat.closest('[data-id]')?.getAttribute('data-id') || '';
          var chatPhone = chatDataId.match(/(\d{10,15})@/);
          if (chatPhone) telefone = chatPhone[1];
        }
      }
      // Strategy F: any element with @c.us in data-id
      if (!telefone) {
        var allDataIds = document.querySelectorAll('[data-id*="@c.us"], [data-id*="@s.whatsapp.net"]');
        for (var f = allDataIds.length - 1; f >= 0 && f >= allDataIds.length - 50; f--) {
          var fid = allDataIds[f].getAttribute('data-id') || '';
          var fMatch = fid.match(/(\d{10,15})@/);
          if (fMatch) { telefone = fMatch[1]; break; }
        }
      }
      // Strategy G: contact info drawer (right panel, if open)
      if (!telefone) {
        var drawerSpans = document.querySelectorAll('[data-testid="contact-info-drawer"] span, [data-testid="chat-info-drawer"] span');
        for (var g = 0; g < drawerSpans.length; g++) {
          var gt = (drawerSpans[g].textContent || '').trim();
          if (/^\+?\d[\d\s\-()]{7,}$/.test(gt)) { telefone = gt; break; }
        }
      }
      // Strategy H: aria-label on chat/message elements
      if (!telefone) {
        var ariaEls = document.querySelectorAll('#main [aria-label]');
        for (var h = 0; h < ariaEls.length && h < 30; h++) {
          var al = ariaEls[h].getAttribute('aria-label') || '';
          var alMatch = al.match(/\+?(\d[\d\s\-()]{7,})/);
          if (alMatch && isValidPhone(alMatch[1])) { telefone = alMatch[1]; break; }
        }
      }
    }

    // Normalize phone
    if (telefone) {
      telefone = telefone.replace(/[\s\-()]/g, '').replace(/^\+/, '');
      if (/^\d{10,11}$/.test(telefone)) telefone = '55' + telefone;
    }

    // Debug: log what we found (remove after confirming it works)
    console.log('[Lumied CRM] getContactInfo:', { nome: nome, telefone: telefone, isGroup: isGroup, jid: jid });

    return { nome: nome, telefone: telefone, isGroup: isGroup, jid: jid };
  }

  // --- LEAD PREVIEW MODAL ---
  // opts: { title, desc, fields: [{ label, key, value, oldValue?, hint? }], confirmLabel?, cancelLabel? }
  // Returns Promise<{ [key]: value } | null>. Null = cancelado.
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  function showLeadPreviewModal(opts) {
    return new Promise(function(resolve) {
      var existing = document.getElementById('lumied-preview-overlay');
      if (existing) existing.remove();

      var fieldsHtml = (opts.fields || []).map(function(f) {
        var diffHint = '';
        var hasOld = f.oldValue !== undefined && f.oldValue !== null && String(f.oldValue) !== '';
        if (hasOld && String(f.oldValue) !== String(f.value || '')) {
          diffHint = '<div class="lumied-preview-diff">Anterior: <s>' + escapeHtml(f.oldValue) + '</s></div>';
        } else if (f.hint) {
          diffHint = '<div class="lumied-preview-hint">' + escapeHtml(f.hint) + '</div>';
        }
        return '<div class="lumied-preview-field">' +
          '<label class="lumied-preview-label">' + escapeHtml(f.label) + '</label>' +
          '<input type="text" class="lumied-preview-input" data-key="' + escapeHtml(f.key) + '" value="' + escapeHtml(f.value) + '" />' +
          diffHint +
          '</div>';
      }).join('');

      var overlay = document.createElement('div');
      overlay.id = 'lumied-preview-overlay';
      overlay.className = 'lumied-preview-overlay';
      overlay.innerHTML =
        '<div class="lumied-preview-modal">' +
          '<div class="lumied-preview-title">' + escapeHtml(opts.title || 'Confirmar') + '</div>' +
          (opts.desc ? '<p class="lumied-preview-desc">' + escapeHtml(opts.desc) + '</p>' : '') +
          '<div class="lumied-preview-fields">' + fieldsHtml + '</div>' +
          '<div class="lumied-preview-actions">' +
            '<button type="button" class="lumied-preview-btn-cancel" id="lumied-preview-cancel">' + escapeHtml(opts.cancelLabel || 'Cancelar') + '</button>' +
            '<button type="button" class="lumied-preview-btn-confirm" id="lumied-preview-confirm">' + escapeHtml(opts.confirmLabel || 'Confirmar') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);

      var firstInput = overlay.querySelector('.lumied-preview-input');
      if (firstInput) { firstInput.focus(); firstInput.select(); }

      function close(result) {
        overlay.remove();
        resolve(result);
      }

      document.getElementById('lumied-preview-confirm').addEventListener('click', function() {
        var inputs = overlay.querySelectorAll('.lumied-preview-input');
        var result = {};
        for (var i = 0; i < inputs.length; i++) {
          result[inputs[i].getAttribute('data-key')] = inputs[i].value.trim();
        }
        close(result);
      });
      document.getElementById('lumied-preview-cancel').addEventListener('click', function() { close(null); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) close(null); });
      overlay.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
          e.preventDefault();
          document.getElementById('lumied-preview-confirm').click();
        }
      });
    });
  }

  function getConversationMessages(maxMessages = 50) {
    const msgs = [];
    const messageEls = document.querySelectorAll('div[data-id]');
    const rows = Array.from(messageEls).slice(-maxMessages);
    for (const row of rows) {
      const isOut = row.dataset.id?.startsWith('true_') || row.classList.contains('message-out');
      const textEl = row.querySelector('span.selectable-text')
        || row.querySelector('span[dir="ltr"]')
        || row.querySelector('.copyable-text span');
      if (textEl) {
        const text = textEl.textContent.trim();
        if (text) msgs.push((isOut ? '[Escola] ' : '[Contato] ') + text);
      }
    }
    return msgs;
  }

  function summarizeConversation(messages) {
    if (!messages.length) return 'Nenhuma mensagem encontrada na conversa.';
    const total = messages.length;
    const fromContact = messages.filter(m => m.startsWith('[Contato]')).length;
    const fromSchool = messages.filter(m => m.startsWith('[Escola]')).length;
    const lastMsgs = messages.slice(-20);
    return [`Resumo da conversa (${total} msgs: ${fromContact} do contato, ${fromSchool} da escola):`, '---', ...lastMsgs].join('\n');
  }

  async function apiCall(action, params) {
    return new Promise(function(resolve, reject) {
      chrome.runtime.sendMessage({ type: 'api', action: action, params: params || {} }, function(response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      });
    });
  }

  async function findLeadByPhone(telefone) {
    var leads = await apiCall('crm_leads_list');
    if (!Array.isArray(leads)) return null;
    var raw = telefone.replace(/\D/g, '');
    return leads.find(function(l) {
      if (!l.telefone) return false;
      var lRaw = l.telefone.replace(/\D/g, '');
      // Match if either ends with the other (handles +55, DDD variations)
      var shorter = raw.length <= lRaw.length ? raw : lRaw;
      var longer = raw.length > lRaw.length ? raw : lRaw;
      return shorter.length >= 8 && longer.slice(-shorter.length) === shorter;
    });
  }

  // --- LEAD INFO EXTRACTION FROM CONVERSATION ---

  // NLP via Claude (preferido) + fallback regex
  async function extractLeadInfoSmart(messages) {
    var conv = messages.join('\n');
    if (!conv) return { nomeCrianca: null, dataNascimento: null, idade: null };
    try {
      var r = await apiCall('crm_lead_nlp_extract', { conversa: conv });
      if (r && r.extracted) {
        var e = r.extracted;
        var idade = null;
        if (e.idade_anos) idade = { anos: e.idade_anos };
        else if (e.idade_meses) idade = { meses: e.idade_meses };
        return {
          nomeCrianca: e.nome_crianca || null,
          dataNascimento: e.data_nascimento || null,
          idade: idade,
          nomeResponsavel: e.nome_responsavel || null,
          serieInteresse: e.serie_interesse || null,
          objecoes: e.objecoes || [],
          urgencia: e.urgencia || null,
        };
      }
    } catch (err) { console.warn('[Lumied CRM] NLP AI falhou, usando regex:', err); }
    // Fallback: regex original
    return extractLeadInfoFromMessages(messages);
  }

  function extractLeadInfoFromMessages(messages) {
    const allText = messages.map(m => m.replace(/^\[(Escola|Contato)\]\s*/, '')).join(' ');

    // Extract child name patterns
    let nomeCrianca = null;
    const childPatterns = [
      /(?:filho|filha|crian[çc]a|nome)\s+(?:e|é|se chama|chamad[oa])\s+([A-Z][a-záàâãéèêíïóôõúç]+(?:\s+[A-Z][a-záàâãéèêíïóôõúç]+)?)/i,
      /(?:o|a)\s+([A-Z][a-záàâãéèêíïóôõúç]+)\s+(?:tem|vai|está|faz)\s+\d+\s*(?:ano|mes)/i,
      /(?:para|pra)\s+(?:o|a)\s+([A-Z][a-záàâãéèêíïóôõúç]+(?:\s+[A-Z][a-záàâãéèêíïóôõúç]+)?)\s*,?\s*(?:que|de|com)\s+\d/i,
    ];
    for (const p of childPatterns) {
      const m = allText.match(p);
      if (m) { nomeCrianca = m[1].trim(); break; }
    }

    // Extract birth date
    let dataNascimento = null;
    const birthPatterns = [
      /nasc(?:eu|imento|ida|ido)?\s*(?:em|dia|:)?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i,
      /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s*(?:nasc|nascimento|é a data)/i,
      /nasceu\s+(?:em\s+)?(?:dia\s+)?(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
    ];
    const mesesNomes = { janeiro:1, fevereiro:2, marco:3, março:3, abril:4, maio:5, junho:6, julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12 };
    for (const p of birthPatterns) {
      const m = allText.match(p);
      if (m) {
        if (mesesNomes[m[2]?.toLowerCase()]) {
          const mes = mesesNomes[m[2].toLowerCase()];
          dataNascimento = `${m[3]}-${String(mes).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
        } else {
          let year = parseInt(m[3]);
          if (year < 100) year += 2000;
          dataNascimento = `${year}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
        }
        break;
      }
    }

    // Extract age
    let idade = null;
    const agePatterns = [
      /(?:tem|faz|está com|completo[u]?)\s*(\d{1,2})\s*(?:ano|anos)/i,
      /(\d{1,2})\s*(?:ano|anos)\s*(?:de idade|completo|e\s+\d)/i,
      /(?:tem|faz)\s*(\d{1,2})\s*(?:mes|meses)/i,
    ];
    for (const p of agePatterns) {
      const m = allText.match(p);
      if (m) {
        idade = parseInt(m[1]);
        if (/mes/i.test(p.source)) {
          idade = { meses: parseInt(m[1]) };
        } else {
          idade = { anos: parseInt(m[1]) };
        }
        break;
      }
    }

    return { nomeCrianca, dataNascimento, idade };
  }

  // --- LEAD CARD DISPLAY ---

  function renderLeadCard(lead, serieInfo) {
    var cardEl = document.getElementById('mb-lead-card');
    var contentEl = document.getElementById('mb-lead-card-content');
    var quickActionsEl = document.getElementById('mb-lead-quick-actions');
    if (!cardEl || !contentEl) return;

    var estagio = (lead.crm_estagios && lead.crm_estagios.nome) || 'Novo Lead';
    var estagioColor = (lead.crm_estagios && lead.crm_estagios.cor) || '#6b7280';
    var tipoIcons = { ligacao:'📞', email:'📧', whatsapp:'💬', visita:'🏫', reuniao:'📅', nota:'📝', outro:'📌' };

    // Score visual (estrelas)
    var scoreHtml = '';
    if (typeof lead.score === 'number') {
      var stars = '';
      for (var s = 1; s <= 5; s++) stars += s <= lead.score ? '★' : '☆';
      scoreHtml = '<div class="mb-lc-score" title="' + escapeHtml(lead.score_motivo || '') + '">'
        + '<span class="mb-lc-stars">' + stars + '</span>'
        + (lead.score_motivo ? '<span class="mb-lc-score-motivo">' + escapeHtml(lead.score_motivo.substring(0, 60)) + '</span>' : '')
        + '</div>';
    }

    // Sentiment chip
    var sentimentHtml = '';
    if (lead.sentiment) {
      var sLabels = { quente:'🔥 Quente', morno:'☀️ Morno', frio:'❄️ Frio', em_risco:'⚠️ Em risco' };
      var sColors = { quente:'#ef4444', morno:'#f59e0b', frio:'#3b82f6', em_risco:'#dc2626' };
      var cor = sColors[lead.sentiment] || '#6b7280';
      sentimentHtml = '<div class="mb-lc-sentiment" style="background:' + cor + '22;color:' + cor + ';border:1px solid ' + cor + '55;" title="' + escapeHtml(lead.sentiment_motivo || '') + '">'
        + (sLabels[lead.sentiment] || lead.sentiment) + '</div>';
    }

    var html = '<div class="mb-lc-name">' + escapeHtml(lead.nome_responsavel || 'Sem nome') + '</div>'
      + '<div class="mb-lc-stage" style="background:' + estagioColor + '20;color:' + estagioColor + ';border:1px solid ' + estagioColor + '40;">' + escapeHtml(estagio) + '</div>'
      + sentimentHtml
      + scoreHtml;

    if (lead.telefone) html += '<div class="mb-lc-row"><span class="mb-lc-label">Tel:</span> ' + lead.telefone + '</div>';
    if (lead.nome_crianca) html += '<div class="mb-lc-row"><span class="mb-lc-label">Crianca:</span> ' + lead.nome_crianca + '</div>';
    if (lead.data_nascimento) {
      var dn = new Date(lead.data_nascimento);
      var diffMs = Date.now() - dn.getTime();
      var anos = Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000));
      var meses = Math.floor(diffMs / (30.44 * 24 * 60 * 60 * 1000));
      var idadeStr = anos >= 1 ? anos + ' ano' + (anos > 1 ? 's' : '') : meses + ' mes' + (meses > 1 ? 'es' : '');
      html += '<div class="mb-lc-row"><span class="mb-lc-label">Nasc:</span> ' + dn.toLocaleDateString('pt-BR') + ' (' + idadeStr + ')</div>';
    }
    if (serieInfo && serieInfo.serie) html += '<div class="mb-lc-turma"><span class="mb-lc-label">Turma ' + new Date().getFullYear() + ':</span> <strong>' + serieInfo.serie + '</strong></div>';
    if (lead.serie_interesse) html += '<div class="mb-lc-row"><span class="mb-lc-label">Serie:</span> ' + lead.serie_interesse + '</div>';
    if (lead.origem) html += '<div class="mb-lc-row"><span class="mb-lc-label">Origem:</span> ' + lead.origem + '</div>';
    if (lead.observacoes) html += '<div class="mb-lc-row" style="font-style:italic;color:#888;font-size:10px;">' + lead.observacoes.substring(0, 100) + (lead.observacoes.length > 100 ? '...' : '') + '</div>';

    // Tags inline (placeholder, carregadas async)
    html += '<div id="mb-lc-tags" class="mb-lc-tags"></div>';

    // Placeholder for interactions (loaded async)
    html += '<div id="mb-lc-interacoes" style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;"></div>';

    contentEl.innerHTML = html;
    cardEl.classList.remove('hidden');
    if (quickActionsEl) {
      quickActionsEl.classList.remove('hidden');
      quickActionsEl.querySelectorAll('button').forEach(function(b) {
        b.disabled = false;
        b.title = b.title.replace(' (capture o lead primeiro)', '');
      });
    }

    // Load tags async
    if (lead.id) {
      apiCall('crm_lead_tags_get', { lead_id: lead.id }).then(function(tagsData) {
        var tagsEl = document.getElementById('mb-lc-tags');
        if (!tagsEl) return;
        var items = Array.isArray(tagsData) ? tagsData : [];
        if (!items.length) { tagsEl.innerHTML = ''; return; }
        tagsEl.innerHTML = items.map(function(t) {
          var tag = t.crm_tags || {};
          var cor = tag.cor || '#6b7280';
          return '<span class="mb-lc-tag" style="background:' + cor + '22;color:#fff;border:1px solid ' + cor + ';">'
            + escapeHtml(tag.nome || '') + '</span>';
        }).join(' ');
      }).catch(function() {});
    }

    // Load last interactions async
    if (lead.id) {
      apiCall('crm_interacoes_list', { lead_id: lead.id }).then(function(data) {
        var intEl = document.getElementById('mb-lc-interacoes');
        if (!intEl) return;
        var items = Array.isArray(data) ? data : [];
        if (!items.length) {
          intEl.innerHTML = '<div style="font-size:10px;color:#aaa;">Nenhuma interacao registrada.</div>';
          return;
        }
        var recent = items.slice(0, 5);
        intEl.innerHTML = '<div style="font-size:10px;font-weight:700;color:#666;margin-bottom:4px;">Ultimas interacoes (' + items.length + ')</div>'
          + recent.map(function(i) {
            var icon = tipoIcons[i.tipo] || '📌';
            var desc = (i.descricao || '').length > 80 ? i.descricao.substring(0, 80) + '...' : (i.descricao || '');
            var dt = new Date(i.criado_em);
            var timeStr = dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' }) + ' ' + dt.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
            return '<div style="font-size:10px;padding:3px 0;border-bottom:1px solid #f5f5f5;">'
              + icon + ' <span style="color:#555;">' + desc + '</span>'
              + '<div style="font-size:9px;color:#bbb;">' + timeStr + (i.criado_por ? ' · ' + i.criado_por : '') + '</div>'
              + '</div>';
          }).join('');
      }).catch(function() {});
    }
  }

  // --- REFRESH LEAD INFO ---

  async function refreshLeadInfo() {
    const statusEl = document.getElementById('mb-lead-status');
    statusEl.classList.remove('hidden');
    statusEl.className = 'mb-lead-status loading';
    statusEl.textContent = 'Buscando informacoes do lead...';

    try {
      const info = await getContactInfo();
      let { nome, telefone } = info;

      // Bloquear grupos
      if (info.isGroup) {
        statusEl.className = 'mb-lead-status error';
        statusEl.innerHTML = '<strong>Conversa em grupo detectada.</strong><br>Abra a conversa individual com o responsavel para atualizar o lead.';
        return;
      }

      if (!telefone && !nome) {
        statusEl.className = 'mb-lead-status error';
        statusEl.textContent = 'Abra um chat para ver as informacoes.';
        return;
      }

      // Find existing lead (by phone first, then by name)
      let lead = null;
      if (telefone) lead = await findLeadByPhone(telefone);
      if (!lead && nome) {
        var leads = await apiCall('crm_leads_list');
        if (Array.isArray(leads)) {
          var nomeLower = nome.toLowerCase().trim();
          lead = leads.find(function(l) {
            return l.nome_responsavel && l.nome_responsavel.toLowerCase().trim() === nomeLower;
          });
        }
      }

      if (!lead) {
        // Tentar com telefone manual
        var manualTel = prompt('Lead nao encontrado automaticamente.\nDigite o telefone do contato para buscar (com DDD):', '');
        if (manualTel) {
          manualTel = manualTel.replace(/\D/g, '');
          if (manualTel.length >= 10) {
            if (/^\d{10,11}$/.test(manualTel)) manualTel = '55' + manualTel;
            telefone = manualTel;
            lead = await findLeadByPhone(telefone);
          }
        }
      }
      if (!lead) {
        statusEl.className = 'mb-lead-status error';
        statusEl.innerHTML = `Lead nao encontrado para este contato.<br>Use <strong>"Capturar Lead"</strong> primeiro.`;
        document.getElementById('mb-lead-card').classList.add('hidden');
        return;
      }

      // Extract info from conversation (AI-powered, com fallback regex)
      const messages = getConversationMessages();
      const extracted = await extractLeadInfoSmart(messages);
      const resumo = summarizeConversation(messages);

      // Preparar updates candidatos
      const updateCandidates = {};
      var aiNome = extracted.nomeResponsavel || nome;
      if (aiNome && aiNome !== telefone && !/^\+?\d[\d\s\-()]{7,}$/.test(aiNome)) updateCandidates.nome_responsavel = aiNome;
      if (extracted.nomeCrianca) updateCandidates.nome_crianca = extracted.nomeCrianca;
      if (extracted.dataNascimento) updateCandidates.data_nascimento = extracted.dataNascimento;
      if (extracted.serieInteresse) updateCandidates.serie_interesse = extracted.serieInteresse;

      // Filtrar apenas os que realmente mudam
      const realUpdates = {};
      for (const k in updateCandidates) {
        if (String(lead[k] || '') !== String(updateCandidates[k] || '')) {
          realUpdates[k] = updateCandidates[k];
        }
      }

      let confirmedUpdates = {};
      if (Object.keys(realUpdates).length > 0) {
        const fields = [];
        if ('nome_responsavel' in realUpdates) fields.push({ label: 'Nome do responsavel', key: 'nome_responsavel', value: realUpdates.nome_responsavel, oldValue: lead.nome_responsavel });
        if ('nome_crianca' in realUpdates) fields.push({ label: 'Nome da crianca', key: 'nome_crianca', value: realUpdates.nome_crianca, oldValue: lead.nome_crianca });
        if ('data_nascimento' in realUpdates) fields.push({ label: 'Data de nascimento (AAAA-MM-DD)', key: 'data_nascimento', value: realUpdates.data_nascimento, oldValue: lead.data_nascimento });

        statusEl.classList.add('hidden');
        const result = await showLeadPreviewModal({
          title: 'Atualizar dados do lead?',
          desc: 'Foram detectadas mudancas em relacao ao lead atual. Edite ou confirme:',
          fields: fields,
          confirmLabel: 'Atualizar',
          cancelLabel: 'Manter atual'
        });
        statusEl.classList.remove('hidden');
        statusEl.className = 'mb-lead-status loading';

        if (result) {
          confirmedUpdates = result;
          statusEl.textContent = 'Atualizando dados do lead...';
          await apiCall('crm_lead_save', { id: lead.id, ...confirmedUpdates });
          Object.assign(lead, confirmedUpdates);
        }
      }

      // Register conversation summary in history
      if (messages.length > 0) {
        statusEl.textContent = 'Registrando conversa no historico...';
        await apiCall('crm_interacao_save', {
          lead_id: lead.id, tipo: 'whatsapp', descricao: resumo
        });
      }

      // Calculate serie/turma if we have birth date
      let serieInfo = null;
      const birthDate = lead.data_nascimento || extracted.dataNascimento;
      if (birthDate) {
        try {
          serieInfo = await apiCall('crm_calcular_serie', { data_nascimento: birthDate });
        } catch (e) { /* ignore */ }
      }

      // If we only have age (no birth date), estimate
      if (!birthDate && extracted.idade) {
        const hoje = new Date();
        let estimatedBirth;
        if (extracted.idade.anos) {
          estimatedBirth = new Date(hoje.getFullYear() - extracted.idade.anos, hoje.getMonth(), 1);
        } else if (extracted.idade.meses) {
          estimatedBirth = new Date(hoje);
          estimatedBirth.setMonth(estimatedBirth.getMonth() - extracted.idade.meses);
        }
        if (estimatedBirth) {
          const estDateStr = estimatedBirth.toISOString().split('T')[0];
          try {
            serieInfo = await apiCall('crm_calcular_serie', { data_nascimento: estDateStr });
            if (serieInfo?.serie) serieInfo.serie += ' (estimado)';
          } catch (e) { /* ignore */ }
        }
      }

      currentLeadInfo = { lead, serieInfo };
      renderLeadCard(lead, serieInfo);

      const updatedFields = Object.keys(confirmedUpdates).length;
      statusEl.className = 'mb-lead-status success';
      statusEl.textContent = updatedFields > 0
        ? `Dados atualizados (${updatedFields}) + conversa registrada!`
        : 'Conversa registrada no historico!';
      setTimeout(() => { statusEl.classList.add('hidden'); }, 4000);

      // Dispara score + sentiment em background (não bloqueia)
      runScoreAndSentiment(lead, messages.join('\n')).catch(function() {});

    } catch (err) {
      statusEl.className = 'mb-lead-status error';
      statusEl.textContent = 'Erro: ' + err.message;
    }
  }

  // --- MANDATORY PHONE MODAL ---

  function requestPhoneModal(prefill) {
    return new Promise(function(resolve) {
      // Remove any existing modal
      var existing = document.getElementById('lumied-phone-overlay');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.id = 'lumied-phone-overlay';
      overlay.className = 'lumied-phone-overlay';
      overlay.innerHTML =
        '<div class="lumied-phone-modal">' +
          '<div class="lumied-phone-title">Telefone do contato</div>' +
          '<p class="lumied-phone-desc">O telefone nao foi detectado automaticamente.<br>Digite o numero com DDD para salvar o lead.</p>' +
          '<input type="tel" id="lumied-phone-input" class="lumied-phone-input" placeholder="Ex: 54 99902-1234" value="' + (prefill || '') + '" />' +
          '<div id="lumied-phone-error" class="lumied-phone-error" style="display:none"></div>' +
          '<button id="lumied-phone-btn" class="lumied-phone-btn">Confirmar</button>' +
        '</div>';
      document.body.appendChild(overlay);

      var input = document.getElementById('lumied-phone-input');
      var errorEl = document.getElementById('lumied-phone-error');
      var btn = document.getElementById('lumied-phone-btn');
      input.focus();

      function trySubmit() {
        var raw = input.value.replace(/\D/g, '');
        if (/^\d{10,11}$/.test(raw)) raw = '55' + raw;
        if (!isValidPhone(raw)) {
          errorEl.textContent = 'Telefone invalido. Digite DDD + numero (min 10 digitos).';
          errorEl.style.display = 'block';
          input.focus();
          return;
        }
        overlay.remove();
        resolve(raw);
      }

      btn.addEventListener('click', trySubmit);
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') trySubmit();
        if (e.key === 'Escape') e.preventDefault();
      });
      // Block Escape from closing
      overlay.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
      });
    });
  }

  // --- LEAD CAPTURE ---

  async function captureLead() {
    const statusEl = document.getElementById('mb-lead-status');
    statusEl.classList.remove('hidden');
    statusEl.className = 'mb-lead-status loading';
    statusEl.textContent = 'Extraindo informacoes do contato...';

    try {
      const info = await getContactInfo();
      let { nome, telefone } = info;

      // Bloquear grupos — sem telefone individual disponivel
      if (info.isGroup) {
        statusEl.className = 'mb-lead-status error';
        statusEl.innerHTML = '<strong>Conversa em grupo detectada.</strong><br>Abra a conversa individual com o responsavel para capturar o lead.';
        return;
      }

      if (!telefone && !nome) {
        statusEl.className = 'mb-lead-status error';
        statusEl.textContent = 'Abra um chat para capturar o lead.';
        return;
      }

      statusEl.textContent = 'Verificando se lead ja existe...';
      let existingLead = null;
      if (telefone) existingLead = await findLeadByPhone(telefone);

      statusEl.textContent = 'Lendo conversa e analisando via IA...';
      const messages = getConversationMessages();
      const resumo = summarizeConversation(messages);
      const extracted = await extractLeadInfoSmart(messages);
      const meetingInfo = detectMeeting(messages);

      if (existingLead) {
        statusEl.textContent = 'Lead encontrado.';

        // Preparar updates candidatos
        const updateCandidates = {};
        if (nome && nome !== telefone && !/^\+?\d[\d\s\-()]{7,}$/.test(nome)) updateCandidates.nome_responsavel = nome;
        if (extracted.nomeCrianca) updateCandidates.nome_crianca = extracted.nomeCrianca;
        if (extracted.dataNascimento) updateCandidates.data_nascimento = extracted.dataNascimento;

        // Filtrar apenas os que realmente mudam
        const realUpdates = {};
        for (const k in updateCandidates) {
          if (String(existingLead[k] || '') !== String(updateCandidates[k] || '')) {
            realUpdates[k] = updateCandidates[k];
          }
        }

        // Mostrar preview se ha mudancas
        let confirmedUpdates = null;
        if (Object.keys(realUpdates).length > 0) {
          const fields = [];
          if ('nome_responsavel' in realUpdates) fields.push({ label: 'Nome do responsavel', key: 'nome_responsavel', value: realUpdates.nome_responsavel, oldValue: existingLead.nome_responsavel });
          if ('nome_crianca' in realUpdates) fields.push({ label: 'Nome da crianca', key: 'nome_crianca', value: realUpdates.nome_crianca, oldValue: existingLead.nome_crianca });
          if ('data_nascimento' in realUpdates) fields.push({ label: 'Data de nascimento (AAAA-MM-DD)', key: 'data_nascimento', value: realUpdates.data_nascimento, oldValue: existingLead.data_nascimento });

          statusEl.classList.add('hidden');
          confirmedUpdates = await showLeadPreviewModal({
            title: 'Atualizar lead?',
            desc: 'Lead ja existe. Confira os dados novos do WhatsApp antes de atualizar:',
            fields: fields,
            confirmLabel: 'Atualizar lead',
            cancelLabel: 'Manter atual'
          });
          statusEl.classList.remove('hidden');
          statusEl.className = 'mb-lead-status loading';

          if (!confirmedUpdates) {
            // Operador escolheu manter dados atuais — so registra a conversa
            statusEl.textContent = 'Registrando conversa no historico...';
            await apiCall('crm_interacao_save', { lead_id: existingLead.id, tipo: 'whatsapp', descricao: resumo });
            currentLeadInfo = { lead: existingLead, serieInfo: null };
            renderLeadCard(existingLead, null);
            statusEl.className = 'mb-lead-status success';
            statusEl.textContent = 'Conversa registrada (dados do lead mantidos).';
            return;
          }
          statusEl.textContent = 'Atualizando dados do lead...';
          await apiCall('crm_lead_save', { id: existingLead.id, ...confirmedUpdates });
          Object.assign(existingLead, confirmedUpdates);
        }

        statusEl.textContent = 'Registrando conversa no historico...';
        await apiCall('crm_interacao_save', {
          lead_id: existingLead.id, tipo: 'whatsapp', descricao: resumo
        });

        // Calculate serie
        let serieInfo = null;
        const bd = existingLead.data_nascimento || extracted.dataNascimento;
        if (bd) {
          try { serieInfo = await apiCall('crm_calcular_serie', { data_nascimento: bd }); } catch(e) {}
        }

        currentLeadInfo = { lead: existingLead, serieInfo };
        renderLeadCard(existingLead, serieInfo);

        statusEl.className = 'mb-lead-status success';
        statusEl.innerHTML = `<strong>Lead atualizado!</strong><br>Historico da conversa registrado.`;

        // Score + sentiment em background
        runScoreAndSentiment(existingLead, messages.join('\n')).catch(function() {});

        if (meetingInfo) {
          statusEl.innerHTML += `<br><button class="mb-meeting-btn" id="mb-schedule-meeting">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Marcar reuniao na agenda</button>`;
          setTimeout(() => {
            const meetBtn = document.getElementById('mb-schedule-meeting');
            if (meetBtn) meetBtn.onclick = () => scheduleMeeting(existingLead.id, meetingInfo, existingLead.nome_responsavel || nome);
          }, 50);
        }
      } else {
        // Se telefone nao foi detectado automaticamente, exigir do usuario
        if (!telefone) {
          telefone = await requestPhoneModal('');
        }

        // Validacao defensiva: nunca salvar lead sem telefone
        if (!telefone || !isValidPhone(telefone)) {
          statusEl.className = 'mb-lead-status error';
          statusEl.textContent = 'Erro: telefone invalido. Tente novamente.';
          return;
        }

        // Safety: if nome looks like a status text, fall back to phone or generic
        var safeNome = nome;
        if (safeNome && STATUS_TEXT_RE.test(safeNome)) {
          safeNome = null;
        }

        // Preview-antes-de-salvar: operador confirma/edita nome+telefone+crianca
        statusEl.classList.add('hidden');
        const confirmedLead = await showLeadPreviewModal({
          title: 'Criar novo lead?',
          desc: 'Confira os dados capturados do WhatsApp. Edite se necessario antes de salvar:',
          fields: [
            { label: 'Nome do responsavel (do WhatsApp)', key: 'nome_responsavel', value: safeNome || '' },
            { label: 'Telefone (ID master)', key: 'telefone', value: telefone, hint: 'Formato: 55 + DDD + numero' },
            { label: 'Nome da crianca (opcional)', key: 'nome_crianca', value: extracted.nomeCrianca || '' }
          ],
          confirmLabel: 'Criar lead',
          cancelLabel: 'Cancelar'
        });
        if (!confirmedLead) {
          // Cancelado — limpa status
          return;
        }

        // Re-validar telefone (operador pode ter editado)
        var finalPhone = (confirmedLead.telefone || '').replace(/[\s\-()]/g, '').replace(/^\+/, '');
        if (/^\d{10,11}$/.test(finalPhone)) finalPhone = '55' + finalPhone;
        if (!isValidPhone(finalPhone)) {
          statusEl.classList.remove('hidden');
          statusEl.className = 'mb-lead-status error';
          statusEl.textContent = 'Telefone invalido. Use o formato 55 + DDD + numero.';
          return;
        }

        // Re-checar se telefone editado bate com lead existente
        const dupCheck = await findLeadByPhone(finalPhone);
        if (dupCheck) {
          statusEl.classList.remove('hidden');
          statusEl.className = 'mb-lead-status error';
          statusEl.innerHTML = '<strong>Lead ja existe com este telefone:</strong><br>' + escapeHtml(dupCheck.nome_responsavel || finalPhone) + '<br>Use "Atualizar info do lead" em vez de capturar.';
          return;
        }

        statusEl.classList.remove('hidden');
        statusEl.className = 'mb-lead-status loading';
        statusEl.textContent = 'Criando novo lead no pipeline...';

        const leadData = {
          nome_responsavel: confirmedLead.nome_responsavel || finalPhone || 'Contato WhatsApp',
          telefone: finalPhone,
          origem: 'whatsapp',
          observacoes: 'Lead capturado via extensao Chrome WhatsApp Web'
        };
        if (confirmedLead.nome_crianca) leadData.nome_crianca = confirmedLead.nome_crianca;
        if (extracted.dataNascimento) leadData.data_nascimento = extracted.dataNascimento;
        telefone = finalPhone; // garantir consistencia downstream

        const newLead = await apiCall('crm_lead_save', leadData);
        const leadId = newLead?.id;
        console.log('[Lumied CRM] Lead criado, id:', leadId);

        if (leadId && messages.length > 0) {
          await apiCall('crm_interacao_save', { lead_id: leadId, tipo: 'whatsapp', descricao: resumo });
        }

        // Calculate serie
        let serieInfo = null;
        if (extracted.dataNascimento) {
          try { serieInfo = await apiCall('crm_calcular_serie', { data_nascimento: extracted.dataNascimento }); } catch(e) {}
        }

        const fullLead = { ...leadData, id: leadId, crm_estagios: { nome: 'Novo Lead', cor: '#3B82F6' } };
        currentLeadInfo = { lead: fullLead, serieInfo };
        renderLeadCard(fullLead, serieInfo);

        statusEl.className = 'mb-lead-status success';
        statusEl.innerHTML = `<strong>Lead criado!</strong><br>Conversa registrada no historico.`;

        // Score + sentiment em background
        runScoreAndSentiment(fullLead, messages.join('\n')).catch(function() {});

        if (meetingInfo && leadId) {
          statusEl.innerHTML += `<br><button class="mb-meeting-btn" id="mb-schedule-meeting">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Marcar reuniao na agenda</button>`;
          setTimeout(() => {
            const meetBtn = document.getElementById('mb-schedule-meeting');
            if (meetBtn) meetBtn.onclick = () => scheduleMeeting(leadId, meetingInfo, leadData.nome_responsavel);
          }, 50);
        }
      }
    } catch (err) {
      statusEl.className = 'mb-lead-status error';
      statusEl.textContent = 'Erro: ' + err.message;
    }
  }

  // --- MEETING DETECTION ---

  function detectMeeting(messages) {
    const meetingKeywords = [
      /reuni[aã]o/i, /visita/i, /encontr[ao]/i, /agendar/i, /agendamos/i,
      /marcar/i, /marcamos/i, /comparecer/i, /presencial/i,
      /vamos.*conversar/i, /bate.?papo/i, /conhecer.*escola/i,
      /tour/i, /passar.*(aqui|a[ií])/i, /vir.*escola/i, /vem.*escola/i
    ];
    const datePatterns = [
      /dia\s+(\d{1,2})(?:\s*[\/\-]\s*(\d{1,2}))?(?:\s*[\/\-]\s*(\d{2,4}))?/i,
      /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/,
      /(segunda|ter[çc]a|quarta|quinta|sexta)/i,
      /(amanh[ãa]|hoje|semana\s+que\s+vem|pr[oó]xima\s+semana)/i,
    ];
    const timePatterns = [
      /[àa]s?\s*(\d{1,2})[h:]?(\d{0,2})/i,
      /(\d{1,2})\s*(?:h|hora|horas)/i,
      /(\d{1,2}):(\d{2})/,
    ];

    const recentMsgs = messages.slice(-30).map(m => m.replace(/^\[(Escola|Contato)\]\s*/, ''));
    const allText = recentMsgs.join(' ');
    if (!meetingKeywords.some(re => re.test(allText))) return null;

    let detectedDate = null;
    let detectedTime = null;

    for (const msg of recentMsgs.reverse()) {
      if (detectedDate && detectedTime) break;
      if (!detectedDate) {
        for (const pattern of datePatterns) {
          const match = msg.match(pattern);
          if (match) { detectedDate = parseDateMatch(match); break; }
        }
      }
      if (!detectedTime) {
        for (const pattern of timePatterns) {
          const match = msg.match(pattern);
          if (match) {
            const hour = parseInt(match[1]);
            const min = match[2] ? parseInt(match[2]) : 0;
            if (hour >= 0 && hour <= 23) {
              detectedTime = `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
            }
            break;
          }
        }
      }
    }

    return { hasMeeting: true, date: detectedDate, time: detectedTime };
  }

  function parseDateMatch(match) {
    const now = new Date();
    const currentYear = now.getFullYear();

    if (match[1] && /(amanh[ãa])/i.test(match[1])) {
      const d = new Date(now); d.setDate(d.getDate() + 1);
      return d.toISOString().split('T')[0];
    }
    if (match[1] && /hoje/i.test(match[1])) return now.toISOString().split('T')[0];
    if (match[1] && /semana|pr[oó]xima/i.test(match[1])) {
      const d = new Date(now); d.setDate(d.getDate() + 7);
      return d.toISOString().split('T')[0];
    }

    const daysMap = { 'segunda':1, 'terca':2, 'terça':2, 'quarta':3, 'quinta':4, 'sexta':5 };
    const dayName = match[1]?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (daysMap[dayName] !== undefined) {
      const target = daysMap[dayName];
      let diff = target - now.getDay();
      if (diff <= 0) diff += 7;
      const d = new Date(now); d.setDate(d.getDate() + diff);
      return d.toISOString().split('T')[0];
    }

    const day = parseInt(match[1]);
    if (day >= 1 && day <= 31) {
      let month = match[2] ? parseInt(match[2]) - 1 : now.getMonth();
      let year = match[3] ? parseInt(match[3]) : currentYear;
      if (year < 100) year += 2000;
      const d = new Date(year, month, day);
      if (d < now && !match[2]) d.setMonth(d.getMonth() + 1);
      return d.toISOString().split('T')[0];
    }
    return null;
  }

  async function scheduleMeeting(leadId, meetingInfo, contactName) {
    const statusEl = document.getElementById('mb-lead-status');
    const userDate = prompt('Reuniao detectada na conversa!\n\nData (AAAA-MM-DD):', meetingInfo.date || '');
    if (!userDate) return;
    const userTime = prompt('Horario (HH:MM):', meetingInfo.time || '10:00');
    if (!userTime) return;
    const titulo = prompt('Titulo da reuniao:', `Visita - ${contactName || 'Lead'}`);
    if (!titulo) return;

    statusEl.className = 'mb-lead-status loading';
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'Agendando reuniao no Google Calendar...';

    try {
      const result = await apiCall('crm_reuniao_save', {
        lead_id: leadId, titulo, data_hora: `${userDate}T${userTime}:00`,
        duracao_min: 30, local: 'Escola',
        descricao: `Reuniao agendada via WhatsApp Web com ${contactName || 'contato'}`
      });

      statusEl.className = 'mb-lead-status success';
      if (result.google_calendar_link) {
        statusEl.innerHTML = `<strong>Reuniao agendada!</strong><br>${titulo}<br>${userDate} as ${userTime}<br><a href="${result.google_calendar_link}" target="_blank" style="color:#065f46;text-decoration:underline;">Ver no Google Calendar</a>`;
      } else {
        statusEl.innerHTML = `<strong>Reuniao salva no CRM!</strong><br>${titulo}<br>${userDate} as ${userTime}`;
      }
    } catch (err) {
      statusEl.className = 'mb-lead-status error';
      statusEl.textContent = 'Erro ao agendar: ' + err.message;
    }
  }

  // ── QUICK ACTIONS (Onda 1/2 da v1.7) ────────────────────────

  // Modal genérico de picker (lista de items com onPick)
  function showPickerModal(opts) {
    return new Promise(function(resolve) {
      var existing = document.getElementById('lumied-picker-overlay');
      if (existing) existing.remove();
      var overlay = document.createElement('div');
      overlay.id = 'lumied-picker-overlay';
      overlay.className = 'lumied-preview-overlay';
      var itemsHtml = (opts.items || []).map(function(it) {
        var color = it.color ? 'background:' + it.color + '20;border-color:' + it.color + ';color:' + it.color : '';
        var checked = it.checked ? ' checked' : '';
        return '<button type="button" class="lumied-picker-item" data-value="' + escapeHtml(it.value) + '" style="' + color + '">'
          + (opts.multi ? '<input type="checkbox" data-val="' + escapeHtml(it.value) + '"' + checked + ' style="margin-right:8px;pointer-events:none">' : '')
          + escapeHtml(it.label || it.value)
          + (it.hint ? '<span class="lumied-picker-hint">' + escapeHtml(it.hint) + '</span>' : '')
          + '</button>';
      }).join('');
      var actionsHtml = opts.multi
        ? '<div class="lumied-preview-actions" style="margin-top:14px;"><button type="button" class="lumied-preview-btn-cancel" id="lumied-picker-cancel">Cancelar</button><button type="button" class="lumied-preview-btn-confirm" id="lumied-picker-confirm">Confirmar</button></div>'
        : '<div class="lumied-preview-actions" style="margin-top:14px;"><button type="button" class="lumied-preview-btn-cancel" id="lumied-picker-cancel">Cancelar</button></div>';
      overlay.innerHTML = '<div class="lumied-preview-modal">'
        + '<div class="lumied-preview-title">' + escapeHtml(opts.title || 'Selecione') + '</div>'
        + (opts.desc ? '<p class="lumied-preview-desc">' + escapeHtml(opts.desc) + '</p>' : '')
        + '<div class="lumied-picker-list">' + (itemsHtml || '<div class="lumied-preview-hint" style="padding:12px;text-align:center;">Nenhum item disponível.</div>') + '</div>'
        + actionsHtml
        + '</div>';
      document.body.appendChild(overlay);
      function close(r) { overlay.remove(); resolve(r); }
      overlay.querySelectorAll('.lumied-picker-item').forEach(function(b) {
        b.addEventListener('click', function() {
          if (opts.multi) {
            var cb = b.querySelector('input[type=checkbox]');
            cb.checked = !cb.checked;
            b.classList.toggle('lumied-picker-item-checked', cb.checked);
          } else {
            close(b.getAttribute('data-value'));
          }
        });
      });
      document.getElementById('lumied-picker-cancel').addEventListener('click', function() { close(null); });
      if (opts.multi) {
        document.getElementById('lumied-picker-confirm').addEventListener('click', function() {
          var values = [];
          overlay.querySelectorAll('input[type=checkbox]:checked').forEach(function(cb) {
            values.push(cb.getAttribute('data-val'));
          });
          close(values);
        });
      }
      overlay.addEventListener('click', function(e) { if (e.target === overlay) close(null); });
      overlay.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
      });
    });
  }

  async function openMoveStage() {
    if (!currentLeadInfo || !currentLeadInfo.lead) { alert('Capture o lead primeiro.'); return; }
    try {
      var estagios = await apiCall('crm_estagios_list');
      if (!Array.isArray(estagios) || !estagios.length) return alert('Nenhum estágio configurado.');
      var items = estagios.map(function(e) {
        return { value: e.id, label: e.nome, color: e.cor };
      });
      var chosen = await showPickerModal({ title: 'Mover para qual estágio?', items: items });
      if (!chosen) return;
      var statusEl = document.getElementById('mb-lead-status');
      statusEl.classList.remove('hidden');
      statusEl.className = 'mb-lead-status loading';
      statusEl.textContent = 'Movendo lead...';
      await apiCall('crm_lead_mover', { id: currentLeadInfo.lead.id, estagio_id: chosen });
      // refetch lead
      var leads = await apiCall('crm_leads_list');
      var updated = Array.isArray(leads) ? leads.find(function(l) { return l.id === currentLeadInfo.lead.id; }) : null;
      if (updated) {
        currentLeadInfo.lead = updated;
        renderLeadCard(updated, currentLeadInfo.serieInfo);
      }
      statusEl.className = 'mb-lead-status success';
      statusEl.textContent = 'Lead movido!';
      setTimeout(function() { statusEl.classList.add('hidden'); }, 2000);
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  }

  async function openSnooze() {
    if (!currentLeadInfo || !currentLeadInfo.lead) { alert('Capture o lead primeiro.'); return; }
    try {
      var templates = await apiCall('crm_templates_list');
      var tplItems = (Array.isArray(templates) ? templates : []).map(function(t) {
        return { value: t.id, label: t.nome, hint: '(' + t.categoria + ')' };
      });
      tplItems.unshift({ value: '', label: '— Nenhum template (só lembrete) —' });
      var tplChoice = await showPickerModal({ title: 'Qual template lembrar?', items: tplItems });
      if (tplChoice === null) return;
      // Modal pra data/hora
      var when = await showLeadPreviewModal({
        title: 'Quando lembrar?',
        desc: 'Você vai ser lembrado no painel quando esta data/hora chegar.',
        fields: [
          { label: 'Data', key: 'data', value: new Date(Date.now() + 86400000).toISOString().split('T')[0] },
          { label: 'Hora (HH:MM)', key: 'hora', value: '09:00' },
          { label: 'Observação (opcional)', key: 'preview', value: '' },
        ],
        confirmLabel: 'Agendar',
        cancelLabel: 'Cancelar',
      });
      if (!when) return;
      var dt = when.data + 'T' + (when.hora || '09:00') + ':00';
      var statusEl = document.getElementById('mb-lead-status');
      statusEl.classList.remove('hidden');
      statusEl.className = 'mb-lead-status loading';
      statusEl.textContent = 'Agendando lembrete...';
      var r = await apiCall('crm_snooze_create', {
        lead_id: currentLeadInfo.lead.id,
        template_id: tplChoice || null,
        agendado_para: dt,
        mensagem_preview: when.preview || null,
      });
      if (r && r.error) throw new Error(r.error);
      statusEl.className = 'mb-lead-status success';
      statusEl.innerHTML = '<strong>Lembrete agendado</strong><br>Você será avisado em ' + new Date(dt).toLocaleString('pt-BR') + '.';
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  }

  async function openCallLog() {
    if (!currentLeadInfo || !currentLeadInfo.lead) { alert('Capture o lead primeiro.'); return; }
    var lead = currentLeadInfo.lead;
    if (lead.telefone) {
      // tenta abrir o discador (tel:) — funciona com integrações de call/Hangouts/Zoiper
      try { window.open('tel:+' + lead.telefone, '_blank'); } catch(e) {}
    }
    var result = await showLeadPreviewModal({
      title: 'Registrar ligação',
      desc: 'Anote o resultado da ligação. Vai virar interação tipo=ligação no histórico.',
      fields: [
        { label: 'Duração (min)', key: 'duracao', value: '5' },
        { label: 'Observação', key: 'obs', value: '' },
      ],
      confirmLabel: 'Registrar',
      cancelLabel: 'Cancelar',
    });
    if (!result) return;
    var desc = '[Ligação' + (result.duracao ? ' ' + result.duracao + 'min' : '') + '] ' + (result.obs || 'Sem observações');
    try {
      await apiCall('crm_interacao_save', {
        lead_id: lead.id, tipo: 'ligacao', descricao: desc,
      });
      var statusEl = document.getElementById('mb-lead-status');
      statusEl.classList.remove('hidden');
      statusEl.className = 'mb-lead-status success';
      statusEl.textContent = 'Ligação registrada!';
      // re-render pra atualizar lista de interações
      renderLeadCard(lead, currentLeadInfo.serieInfo);
      setTimeout(function() { statusEl.classList.add('hidden'); }, 2000);
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  }

  async function openTagPicker() {
    if (!currentLeadInfo || !currentLeadInfo.lead) { alert('Capture o lead primeiro.'); return; }
    var lead = currentLeadInfo.lead;
    try {
      var allTags = await apiCall('crm_tags_list');
      var currentTags = await apiCall('crm_lead_tags_get', { lead_id: lead.id });
      var currentIds = new Set((Array.isArray(currentTags) ? currentTags : []).map(function(t) { return t.tag_id; }));
      var items = (Array.isArray(allTags) ? allTags : []).map(function(t) {
        return { value: t.id, label: t.nome, color: t.cor, checked: currentIds.has(t.id) };
      });
      if (!items.length) return alert('Nenhuma tag cadastrada. Crie tags no painel Lumied.');
      var selected = await showPickerModal({
        title: 'Tags do lead',
        desc: 'Marque/desmarque as tags pra este lead.',
        items: items, multi: true,
      });
      if (!Array.isArray(selected)) return;
      var newSet = new Set(selected);
      // add novas
      for (var id of newSet) { if (!currentIds.has(id)) await apiCall('crm_lead_tag_add', { lead_id: lead.id, tag_id: id }); }
      // remove desmarcadas
      for (var oldId of currentIds) { if (!newSet.has(oldId)) await apiCall('crm_lead_tag_remove', { lead_id: lead.id, tag_id: oldId }); }
      renderLeadCard(lead, currentLeadInfo.serieInfo);
    } catch (e) {
      alert('Erro: ' + e.message);
    }
  }

  async function runScoreAndSentiment(lead, conversa) {
    // dispara em paralelo (best-effort, não bloqueia UX)
    try {
      var [scoreR, sentR] = await Promise.allSettled([
        apiCall('crm_lead_score_calc', { lead_id: lead.id, conversa: conversa }),
        apiCall('crm_lead_sentiment_analyze', { lead_id: lead.id, conversa: conversa }),
      ]);
      if (scoreR.status === 'fulfilled' && scoreR.value && !scoreR.value.error) {
        lead.score = scoreR.value.score;
        lead.score_motivo = scoreR.value.motivo;
      }
      if (sentR.status === 'fulfilled' && sentR.value && !sentR.value.error) {
        lead.sentiment = sentR.value.sentiment;
        lead.sentiment_motivo = sentR.value.motivo;
      }
      renderLeadCard(lead, currentLeadInfo ? currentLeadInfo.serieInfo : null);
      if (lead.sentiment === 'em_risco') {
        var statusEl = document.getElementById('mb-lead-status');
        if (statusEl) {
          statusEl.classList.remove('hidden');
          statusEl.className = 'mb-lead-status error';
          statusEl.innerHTML = '<strong>⚠️ Lead em risco</strong><br>' + escapeHtml(lead.sentiment_motivo || '');
        }
      }
    } catch (e) { console.warn('[Lumied CRM] score/sentiment failed:', e); }
  }

  async function openScoreRecalc() {
    if (!currentLeadInfo || !currentLeadInfo.lead) { alert('Capture o lead primeiro.'); return; }
    var statusEl = document.getElementById('mb-lead-status');
    statusEl.classList.remove('hidden');
    statusEl.className = 'mb-lead-status loading';
    statusEl.textContent = 'Recalculando score e sentiment via IA...';
    var messages = getConversationMessages();
    var conv = messages.join('\n');
    await runScoreAndSentiment(currentLeadInfo.lead, conv);
    statusEl.className = 'mb-lead-status success';
    statusEl.textContent = 'Score atualizado!';
    setTimeout(function() { statusEl.classList.add('hidden'); }, 2000);
  }

  // ── Snooze popup: mostra lembretes pendentes do operador ─────
  async function checkPendingSnoozes() {
    try {
      var snoozes = await apiCall('crm_snooze_list', { pendentes: true });
      if (!Array.isArray(snoozes) || !snoozes.length) return;
      var due = snoozes.filter(function(s) { return new Date(s.agendado_para) <= new Date(); });
      if (!due.length) return;
      // Notifica via banner no painel
      var banner = document.getElementById('mb-snooze-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'mb-snooze-banner';
        banner.className = 'mb-snooze-banner';
        var bodyEl = document.getElementById('mb-panel-body');
        if (bodyEl) bodyEl.insertBefore(banner, bodyEl.firstChild);
      }
      banner.innerHTML = '<div class="mb-snooze-banner-title">⏰ ' + due.length + ' lembrete(s) pendentes</div>'
        + due.slice(0, 5).map(function(s) {
          var lead = s.crm_leads || {};
          var tpl = s.crm_templates || {};
          return '<div class="mb-snooze-item">'
            + '<strong>' + escapeHtml(lead.nome_responsavel || 'Lead') + '</strong>'
            + (tpl.nome ? ' · ' + escapeHtml(tpl.nome) : '')
            + (s.mensagem_preview ? '<div style="font-size:10px;opacity:.8;">' + escapeHtml(s.mensagem_preview) + '</div>' : '')
            + ' <button class="mb-snooze-done" data-id="' + s.id + '">Marcar feito</button>'
            + '</div>';
        }).join('');
      banner.querySelectorAll('.mb-snooze-done').forEach(function(btn) {
        btn.onclick = async function() {
          await apiCall('crm_snooze_cancel', { id: btn.getAttribute('data-id') });
          checkPendingSnoozes();
        };
      });
    } catch (e) { console.warn('[Lumied CRM] snooze check failed:', e); }
  }

  // Attach handlers
  setTimeout(() => {
    const captureBtn = document.getElementById('mb-capture-lead');
    if (captureBtn) captureBtn.onclick = captureLead;
    const refreshBtn = document.getElementById('mb-refresh-lead');
    if (refreshBtn) refreshBtn.onclick = refreshLeadInfo;
    const closeBtn = document.getElementById('mb-close-panel');
    if (closeBtn) closeBtn.onclick = () => setPanelOpen(false);
    // Quick actions
    var qaStage = document.getElementById('mb-qa-stage'); if (qaStage) qaStage.onclick = openMoveStage;
    var qaSnooze = document.getElementById('mb-qa-snooze'); if (qaSnooze) qaSnooze.onclick = openSnooze;
    var qaCall = document.getElementById('mb-qa-call'); if (qaCall) qaCall.onclick = openCallLog;
    var qaTag = document.getElementById('mb-qa-tag'); if (qaTag) qaTag.onclick = openTagPicker;
    var qaScore = document.getElementById('mb-qa-score'); if (qaScore) qaScore.onclick = openScoreRecalc;
  }, 100);

  // --- DETECT CONVERSATION CHANGE ---
  let _lastContactKey = null;

  async function checkConversationChange() {
    var info = await getContactInfo();
    var key = (info.nome || '') + '|' + (info.telefone || '');
    if (key === _lastContactKey || key === '|') return;
    _lastContactKey = key;
    // Reset lead card
    currentLeadInfo = null;
    var cardEl = document.getElementById('mb-lead-card');
    if (cardEl) cardEl.classList.add('hidden');
    var statusEl = document.getElementById('mb-lead-status');
    if (statusEl) { statusEl.classList.add('hidden'); statusEl.textContent = ''; }
    // Auto-lookup if panel is open
    if (panelOpen) autoLookupLead(info);
  }

  async function autoLookupLead(info) {
    var statusEl = document.getElementById('mb-lead-status');
    if (!info) info = getContactInfo();
    if (!info.telefone && !info.nome) {
      console.log('[Lumied CRM] autoLookup: no contact info found');
      return;
    }
    statusEl.classList.remove('hidden');
    statusEl.className = 'mb-lead-status loading';
    statusEl.textContent = 'Buscando lead...';
    try {
      // Fetch all leads once, search by phone then name
      var allLeads = await apiCall('crm_leads_list');
      if (!Array.isArray(allLeads)) allLeads = [];
      console.log('[Lumied CRM] autoLookup: searching', info, 'in', allLeads.length, 'leads');

      var lead = null;
      // Search by phone — normalize both sides to last 8-11 digits for flexible matching
      if (info.telefone) {
        var rawPhone = info.telefone.replace(/\D/g, '');
        // Try matching last 11, 10, 9, 8 digits (handles +55, DDD variations)
        var phoneVariants = [rawPhone];
        if (rawPhone.length > 11) phoneVariants.push(rawPhone.slice(-11));
        if (rawPhone.length > 10) phoneVariants.push(rawPhone.slice(-10));
        if (rawPhone.length > 9) phoneVariants.push(rawPhone.slice(-9));
        if (rawPhone.length > 8) phoneVariants.push(rawPhone.slice(-8));

        lead = allLeads.find(function(l) {
          if (!l.telefone) return false;
          var lRaw = l.telefone.replace(/\D/g, '');
          for (var v = 0; v < phoneVariants.length; v++) {
            if (lRaw === phoneVariants[v] || lRaw.slice(-phoneVariants[v].length) === phoneVariants[v] || phoneVariants[v].slice(-lRaw.length) === lRaw) return true;
          }
          return false;
        });
        console.log('[Lumied CRM] phone search:', rawPhone, 'variants:', phoneVariants, 'found:', lead ? lead.nome_responsavel : 'none');
      }
      // Search by exact name
      if (!lead && info.nome) {
        var lower = info.nome.toLowerCase();
        lead = allLeads.find(function(l) {
          return (l.nome_responsavel || '').toLowerCase() === lower
            || (l.nome_crianca || '').toLowerCase() === lower;
        });
      }
      // Search by partial name (first name match)
      if (!lead && info.nome) {
        var firstName = info.nome.split(' ')[0].toLowerCase();
        if (firstName.length >= 3) {
          lead = allLeads.find(function(l) {
            return (l.nome_responsavel || '').toLowerCase().indexOf(firstName) >= 0;
          });
        }
      }

      if (!lead) {
        console.log('[Lumied CRM] autoLookup: no match found');
        statusEl.className = 'mb-lead-status';
        statusEl.innerHTML = 'Lead nao encontrado. Use <strong>"Capturar Lead"</strong> para adicionar.';
        setTimeout(function() { statusEl.classList.add('hidden'); }, 4000);
        return;
      }
      console.log('[Lumied CRM] autoLookup: found lead', lead.nome_responsavel);
      currentLeadInfo = { lead: lead, serieInfo: null };
      renderLeadCard(lead, null);
      statusEl.classList.add('hidden');
    } catch(e) {
      console.error('[Lumied CRM] autoLookup error:', e);
      statusEl.className = 'mb-lead-status error';
      statusEl.textContent = 'Erro ao buscar: ' + e.message;
      setTimeout(function() { statusEl.classList.add('hidden'); }, 3000);
    }
  }

  // Observe #app for any DOM changes (conversation switches rebuild #main)
  // Use a broad observer with debounce to catch all conversation changes
  var _debounceTimer = null;
  function debouncedCheck() {
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(checkConversationChange, 400);
  }

  function startObserver() {
    var target = document.getElementById('app') || document.querySelector('[data-testid="web"]') || document.body;
    var obs = new MutationObserver(debouncedCheck);
    obs.observe(target, { childList: true, subtree: true });
    // Initial check
    checkConversationChange();
  }
  // Give WhatsApp Web time to render, then start observing
  setTimeout(startObserver, 2000);

  // --- TEMPLATES ---

  async function loadTemplates() {
    try {
      const data = await apiCall('crm_templates_list');
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
    var midiaIcons = { imagem:'🖼', doc:'📎', audio:'🎵', video:'🎬' };
    el.innerHTML = items.map((t, i) => `
      <div class="mb-tpl-card">
        <div class="tpl-name">${escapeHtml(t.nome)} ${t.midia_tipo ? '<span class="tpl-midia" title="Template com mídia anexada">' + (midiaIcons[t.midia_tipo] || '📎') + '</span>' : ''}</div>
        <div class="tpl-cat">${catLabels[t.categoria] || t.categoria}${t.usos ? ' · usado ' + t.usos + 'x' : ''}</div>
        <div class="tpl-preview">${escapeHtml((t.conteudo || '').substring(0, 80))}${t.conteudo && t.conteudo.length > 80 ? '...' : ''}</div>
        <button class="tpl-send" data-idx="${i}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          Enviar no chat
        </button>
      </div>
    `).join('');
    el.querySelectorAll('.tpl-send').forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); sendTemplate(items[parseInt(btn.dataset.idx)]); };
    });
  }

  async function sendTemplate(template) {
    let msg = template.conteudo;
    // Track uso em background (não bloqueia)
    if (template.id) apiCall('crm_template_track_use', { template_id: template.id }).catch(function() {});
    // Se template tem mídia, mostra aviso pro operador anexar manualmente
    if (template.midia_url && template.midia_tipo) {
      var labelMidia = { imagem:'imagem', doc:'documento', audio:'áudio', video:'vídeo' }[template.midia_tipo] || 'arquivo';
      alert('Esse template tem ' + labelMidia + ' anexada.\n\nLink:\n' + template.midia_url + '\n\nApós o texto ser inserido, baixe o arquivo e arraste no chat do WhatsApp Web. Vou abrir o link em outra aba.');
      try { window.open(template.midia_url, '_blank'); } catch(e) {}
    }
    // Build auto-fill values from WhatsApp contact + lead data
    var contact = await getContactInfo();
    var lead = currentLeadInfo ? currentLeadInfo.lead : null;
    var firstName = (contact.nome || '').split(' ')[0];
    var autoFill = {
      nome: contact.nome || (lead ? lead.nome_responsavel : '') || '',
      primeiro_nome: firstName || '',
      nome_responsavel: (lead ? lead.nome_responsavel : '') || contact.nome || '',
      nome_crianca: (lead ? lead.nome_crianca : '') || '',
      telefone: contact.telefone || (lead ? lead.telefone : '') || '',
      escola: escolaNome || '',
      serie: (lead ? lead.serie_interesse : '') || '',
    };
    const vars = msg.match(/\{\{(\w+)\}\}/g) || [];
    for (const v of vars) {
      const name = v.replace(/\{|\}/g, '');
      var defaultVal = autoFill[name] || autoFill[name.toLowerCase()] || '';
      const val = prompt('Valor para ' + name + ':', defaultVal);
      if (val === null) return;
      msg = msg.replace(new RegExp(v.replace(/[{}]/g, '\\$&'), 'g'), val);
    }
    const inputEl = document.querySelector('div[contenteditable="true"][data-tab="10"]')
      || document.querySelector('footer div[contenteditable="true"]')
      || document.querySelector('div[title="Digite uma mensagem"]');
    if (inputEl) {
      inputEl.focus();
      document.execCommand('insertText', false, msg);
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      setPanelOpen(false);
    } else {
      navigator.clipboard.writeText(msg);
      alert('Mensagem copiada! Cole no chat com Ctrl+V.\n(Abra um chat primeiro)');
    }
  }

  window.mbFilterTemplates = function() {
    const q = document.getElementById('mb-search').value.toLowerCase();
    renderTemplates(templates.filter(t =>
      t.nome.toLowerCase().includes(q) || t.conteudo.toLowerCase().includes(q) || (t.categoria||'').toLowerCase().includes(q)
    ));
  };
})();
