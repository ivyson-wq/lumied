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
      autoLookupLead();
    }
  }

  // Create toggle button with owl logo
  const toggle = document.createElement('button');
  toggle.id = 'mb-crm-toggle';
  toggle.title = 'Lumied CRM';
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

  function getContactInfo() {
    // WhatsApp Web: contact name is in the conversation header
    // Try multiple strategies to find the right element
    var nome = null;
    var telefone = null;

    // Strategy 1: conversation-info-header (data-testid based)
    var infoHeader = document.querySelector('#main header [data-testid="conversation-info-header"] span[title]');

    // Strategy 2: first span[title] inside the clickable header area (role="button")
    if (!infoHeader) {
      infoHeader = document.querySelector('#main header div[role="button"] span[title]');
    }

    // Strategy 3: first span[title] directly in #main header, but filter out status texts
    if (!infoHeader) {
      var candidates = document.querySelectorAll('#main header span[title]');
      for (var i = 0; i < candidates.length; i++) {
        var t = candidates[i].getAttribute('title') || '';
        // Skip "last seen", "online", "typing", "click here" status texts
        if (/ltima vez|online|digitando|clique aqui|last seen|typing|click here/i.test(t)) continue;
        infoHeader = candidates[i];
        break;
      }
    }

    // Strategy 4: legacy selectors
    if (!infoHeader) {
      infoHeader = document.querySelector('header span[dir="auto"][title]');
      // Verify it's not a status text
      if (infoHeader) {
        var val = infoHeader.getAttribute('title') || '';
        if (/ltima vez|online|digitando|clique aqui|last seen|typing|click here/i.test(val)) {
          infoHeader = null;
        }
      }
    }

    if (infoHeader) {
      nome = infoHeader.getAttribute('title') || infoHeader.textContent || null;
    }

    // Phone: look for elements with phone-like titles
    var phoneEl = document.querySelector('#main header span[title^="+"]');
    if (phoneEl) telefone = phoneEl.getAttribute('title');

    // If the name itself is a phone number
    if (!telefone && nome && /^\+?\d[\d\s\-()]{7,}$/.test(nome)) {
      telefone = nome;
    }

    // Search broader for phone numbers
    if (!telefone) {
      var spans = document.querySelectorAll('#main header span[title]');
      for (var j = 0; j < spans.length; j++) {
        var sv = spans[j].getAttribute('title') || '';
        if (/^\+?\d[\d\s\-()]{7,}$/.test(sv)) { telefone = sv; break; }
      }
    }

    if (telefone) telefone = telefone.replace(/[\s\-()]/g, '');
    return { nome: nome, telefone: telefone };
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
    const leads = await apiCall('crm_leads_list');
    if (!Array.isArray(leads)) return null;
    const normalizedSearch = telefone.replace(/\D/g, '').slice(-11);
    return leads.find(l => {
      if (!l.telefone) return false;
      return l.telefone.replace(/\D/g, '').slice(-11) === normalizedSearch;
    });
  }

  // --- LEAD INFO EXTRACTION FROM CONVERSATION ---

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
    const cardEl = document.getElementById('mb-lead-card');
    const contentEl = document.getElementById('mb-lead-card-content');
    if (!cardEl || !contentEl) return;

    const estagio = lead.crm_estagios?.nome || 'Novo Lead';
    const estagioColor = lead.crm_estagios?.cor || '#6b7280';

    let html = `
      <div class="mb-lc-name">${lead.nome_responsavel || 'Sem nome'}</div>
      <div class="mb-lc-stage" style="background:${estagioColor}20;color:${estagioColor};border:1px solid ${estagioColor}40;">${estagio}</div>
    `;

    if (lead.telefone) {
      html += `<div class="mb-lc-row"><span class="mb-lc-label">Tel:</span> ${lead.telefone}</div>`;
    }
    if (lead.nome_crianca) {
      html += `<div class="mb-lc-row"><span class="mb-lc-label">Crianca:</span> ${lead.nome_crianca}</div>`;
    }
    if (lead.data_nascimento) {
      const dn = new Date(lead.data_nascimento);
      const hoje = new Date();
      const diffMs = hoje - dn;
      const anos = Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000));
      const meses = Math.floor(diffMs / (30.44 * 24 * 60 * 60 * 1000));
      const idadeStr = anos >= 1 ? `${anos} ano${anos > 1 ? 's' : ''}` : `${meses} mes${meses > 1 ? 'es' : ''}`;
      html += `<div class="mb-lc-row"><span class="mb-lc-label">Nasc:</span> ${dn.toLocaleDateString('pt-BR')} (${idadeStr})</div>`;
    }
    if (serieInfo?.serie) {
      html += `<div class="mb-lc-turma"><span class="mb-lc-label">Turma em ${new Date().getFullYear()}:</span> <strong>${serieInfo.serie}</strong></div>`;
    }
    if (lead.serie_interesse) {
      html += `<div class="mb-lc-row"><span class="mb-lc-label">Serie interesse:</span> ${lead.serie_interesse}</div>`;
    }
    if (lead.origem) {
      html += `<div class="mb-lc-row"><span class="mb-lc-label">Origem:</span> ${lead.origem}</div>`;
    }

    contentEl.innerHTML = html;
    cardEl.classList.remove('hidden');
  }

  // --- REFRESH LEAD INFO ---

  async function refreshLeadInfo() {
    const statusEl = document.getElementById('mb-lead-status');
    statusEl.classList.remove('hidden');
    statusEl.className = 'mb-lead-status loading';
    statusEl.textContent = 'Buscando informacoes do lead...';

    try {
      const { nome, telefone } = getContactInfo();
      if (!telefone && !nome) {
        statusEl.className = 'mb-lead-status error';
        statusEl.textContent = 'Abra um chat para ver as informacoes.';
        return;
      }

      // Find existing lead
      let lead = null;
      if (telefone) lead = await findLeadByPhone(telefone);

      if (!lead) {
        statusEl.className = 'mb-lead-status error';
        statusEl.innerHTML = `Lead nao encontrado para este contato.<br>Use <strong>"Capturar Lead"</strong> primeiro.`;
        document.getElementById('mb-lead-card').classList.add('hidden');
        return;
      }

      // Extract info from conversation
      const messages = getConversationMessages();
      const extracted = extractLeadInfoFromMessages(messages);
      const resumo = summarizeConversation(messages);

      // Update lead with extracted info if we found new data
      const updates = {};
      if (extracted.nomeCrianca && !lead.nome_crianca) updates.nome_crianca = extracted.nomeCrianca;
      if (extracted.dataNascimento && !lead.data_nascimento) updates.data_nascimento = extracted.dataNascimento;
      if (nome && nome !== telefone && !lead.nome_responsavel) updates.nome_responsavel = nome;

      if (Object.keys(updates).length > 0) {
        statusEl.textContent = 'Atualizando dados do lead...';
        await apiCall('crm_lead_save', { id: lead.id, ...updates });
        Object.assign(lead, updates);
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

      const updatedFields = Object.keys(updates).length;
      statusEl.className = 'mb-lead-status success';
      statusEl.textContent = updatedFields > 0
        ? `Dados atualizados (${updatedFields}) + conversa registrada!`
        : 'Conversa registrada no historico!';
      setTimeout(() => { statusEl.classList.add('hidden'); }, 4000);

    } catch (err) {
      statusEl.className = 'mb-lead-status error';
      statusEl.textContent = 'Erro: ' + err.message;
    }
  }

  // --- LEAD CAPTURE ---

  async function captureLead() {
    const statusEl = document.getElementById('mb-lead-status');
    statusEl.classList.remove('hidden');
    statusEl.className = 'mb-lead-status loading';
    statusEl.textContent = 'Extraindo informacoes do contato...';

    try {
      const { nome, telefone } = getContactInfo();
      if (!telefone && !nome) {
        statusEl.className = 'mb-lead-status error';
        statusEl.textContent = 'Abra um chat para capturar o lead.';
        return;
      }

      statusEl.textContent = 'Verificando se lead ja existe...';
      let existingLead = null;
      if (telefone) existingLead = await findLeadByPhone(telefone);

      statusEl.textContent = 'Lendo conversa...';
      const messages = getConversationMessages();
      const resumo = summarizeConversation(messages);
      const extracted = extractLeadInfoFromMessages(messages);
      const meetingInfo = detectMeeting(messages);

      if (existingLead) {
        statusEl.textContent = 'Lead encontrado! Atualizando historico...';

        await apiCall('crm_interacao_save', {
          lead_id: existingLead.id, tipo: 'whatsapp', descricao: resumo
        });

        const updates = {};
        if (nome && nome !== telefone && !existingLead.nome_responsavel) updates.nome_responsavel = nome;
        if (extracted.nomeCrianca && !existingLead.nome_crianca) updates.nome_crianca = extracted.nomeCrianca;
        if (extracted.dataNascimento && !existingLead.data_nascimento) updates.data_nascimento = extracted.dataNascimento;
        if (Object.keys(updates).length > 0) {
          await apiCall('crm_lead_save', { id: existingLead.id, ...updates });
          Object.assign(existingLead, updates);
        }

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
        statusEl.textContent = 'Criando novo lead no pipeline...';
        const nomeCrianca = extracted.nomeCrianca || prompt('Nome da crianca (opcional):', '') || '';

        const leadData = {
          nome_responsavel: nome || telefone || 'Contato WhatsApp',
          telefone: telefone || '',
          origem: 'whatsapp',
          observacoes: 'Lead capturado via extensao Chrome WhatsApp Web'
        };
        if (nomeCrianca) leadData.nome_crianca = nomeCrianca;
        if (extracted.dataNascimento) leadData.data_nascimento = extracted.dataNascimento;

        const newLead = await apiCall('crm_lead_save', leadData);
        const leadId = newLead?.id || newLead?.[0]?.id;

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

  // Attach handlers
  setTimeout(() => {
    const captureBtn = document.getElementById('mb-capture-lead');
    if (captureBtn) captureBtn.onclick = captureLead;
    const refreshBtn = document.getElementById('mb-refresh-lead');
    if (refreshBtn) refreshBtn.onclick = refreshLeadInfo;
    const closeBtn = document.getElementById('mb-close-panel');
    if (closeBtn) closeBtn.onclick = () => setPanelOpen(false);
  }, 100);

  // --- DETECT CONVERSATION CHANGE ---
  let _lastContactKey = null;

  function checkConversationChange() {
    var info = getContactInfo();
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
    if (!info.telefone && !info.nome) return;
    statusEl.classList.remove('hidden');
    statusEl.className = 'mb-lead-status loading';
    statusEl.textContent = 'Buscando lead...';
    try {
      var lead = null;
      if (info.telefone) lead = await findLeadByPhone(info.telefone);
      if (!lead && info.nome) lead = await findLeadByName(info.nome);
      if (!lead) {
        statusEl.className = 'mb-lead-status';
        statusEl.innerHTML = 'Lead nao encontrado. <strong>Capture</strong> para adicionar ao CRM.';
        setTimeout(function() { statusEl.classList.add('hidden'); }, 3000);
        return;
      }
      currentLeadInfo = { lead: lead, serieInfo: null };
      renderLeadCard(lead, null);
      statusEl.classList.add('hidden');
    } catch(e) {
      statusEl.classList.add('hidden');
    }
  }

  async function findLeadByName(nome) {
    var leads = await apiCall('crm_leads_list');
    if (!Array.isArray(leads)) return null;
    var lower = nome.toLowerCase();
    return leads.find(function(l) {
      return (l.nome_responsavel || '').toLowerCase() === lower
        || (l.nome_crianca || '').toLowerCase() === lower;
    });
  }

  // Poll for conversation changes (header updates when switching chats)
  setInterval(checkConversationChange, 1500);

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
    el.innerHTML = items.map((t, i) => `
      <div class="mb-tpl-card">
        <div class="tpl-name">${t.nome}</div>
        <div class="tpl-cat">${catLabels[t.categoria] || t.categoria}</div>
        <div class="tpl-preview">${t.conteudo.substring(0, 80)}...</div>
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

  function sendTemplate(template) {
    let msg = template.conteudo;
    // Build auto-fill values from WhatsApp contact + lead data
    var contact = getContactInfo();
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
