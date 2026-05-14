// Auto-extraído do gerente.html (Onda 4 — batch final).
// FAVORITOS + MINI SIDEBAR + TOPBAR NAV PILLS + MOBILE BOTTOM BAR
  // ── FAVORITOS & PERSONALIZAÇÃO ─────────────────────────
  var FAV_KEY = 'lumied_fav_gerente';
  var RECENT_KEY = 'lumied_recent_gerente';
  var USAGE_KEY = 'lumied_usage_gerente';
  var customizeMode = false;

  // Panel metadata for display
  var panelMeta = {
    dashboard:{icon:'📊',label:'Dashboard Turnos'},series:{icon:'🎒',label:'Séries'},
    dashAtiv:{icon:'📊',label:'Ativ. Extra'},atividades:{icon:'🎯',label:'Gerenciar Ativ.'},
    diplomas:{icon:'🏆',label:'Diplomas'},atestados:{icon:'🏥',label:'Atestados'},
    pdi:{icon:'📈',label:'Growth Plan'},impressoes:{icon:'🖨️',label:'Impressões'},
    almDash:{icon:'📦',label:'Visão Geral'},almReqs:{icon:'📋',label:'Requisições'},almConfig:{icon:'⚙️',label:'Configuração'},
    almPend:{icon:'📋',label:'Requisições'},almTodas:{icon:'📋',label:'Requisições'},almInsumos:{icon:'⚙️',label:'Configuração'},
    almTurmas:{icon:'⚙️',label:'Configuração'},almOrc:{icon:'⚙️',label:'Configuração'},
    almRel:{icon:'📦',label:'Visão Geral'},almCompras:{icon:'📋',label:'Requisições'},
    manutencao:{icon:'🔧',label:'Manutenção'},achados:{icon:'🔍',label:'Achados'},
    finDash:{icon:'💰',label:'Dashboard & Análise'},finLanc:{icon:'📝',label:'Lançamentos & Recibos'},
    finMens:{icon:'🧾',label:'Mensalidades & Boletos'},finContas:{icon:'📊',label:'Plano Contas'},
    finDre:{icon:'📈',label:'DRE & Balanço'},finBalanco:{icon:'⚖️',label:'Balanço'},
    finConciliacao:{icon:'🔄',label:'Conciliação & Contas'},finBoletos:{icon:'🏦',label:'Boletos'},
    finDescontos:{icon:'🏷️',label:'Descontos & Reajuste'},finFluxoCaixa:{icon:'💹',label:'Fluxo & Fechamento'},
    finConfig:{icon:'⚙️',label:'Exportar & Notificações'},
    crmKanban:{icon:'📋',label:'Pipeline & Leads'},crmLeads:{icon:'📋',label:'Pipeline & Leads'},
    crmTemplates:{icon:'💬',label:'Templates'},crmVagas:{icon:'🎓',label:'Matrículas & Vagas'},
    crmMatriculas:{icon:'🎓',label:'Matrículas & Vagas'},crmMetas:{icon:'🏆',label:'Metas'},crmConfigSeries:{icon:'⚙️',label:'Séries/Idade'},
    notasConfig:{icon:'⚙️',label:'Config Notas'},notasDisciplinas:{icon:'📚',label:'Disciplinas'},
    notasPeriodos:{icon:'📅',label:'Períodos'},notasVisao:{icon:'📝',label:'Visão Notas'},
    frequencia:{icon:'✅',label:'Frequência'},diarioClasse:{icon:'📖',label:'Diário'},
    calendario:{icon:'📅',label:'Calendário'},chatConversas:{icon:'💬',label:'Conversas'},
    pesquisas:{icon:'📊',label:'Pesquisas'},matriculaForm:{icon:'📋',label:'Formulários'},
    matriculaStatus:{icon:'📊',label:'Status Matrícula'},equipe:{icon:'👥',label:'Equipe'},
    reunioes:{icon:'📅',label:'Reuniões'},logo:{icon:'🖼️',label:'Logotipo'},
    acesso:{icon:'🔒',label:'Acesso'},familias:{icon:'👨‍👩‍👧',label:'Famílias'},
    compDash:{icon:'⚖️',label:'Compliance'},compHorarios:{icon:'🕐',label:'Horários'},
    compImportar:{icon:'📂',label:'Importar Ponto'},compOcorrencias:{icon:'⚠️',label:'Hora Extra'},
    compIncidentes:{icon:'🛡️',label:'Incidentes'},compCertificacoes:{icon:'🎓',label:'Certificações'},
    compInspecoes:{icon:'📋',label:'Inspeções'},compPoliticas:{icon:'📄',label:'Políticas'},
    compCalendario:{icon:'📅',label:'Cal. Regulatório'},compAlertas:{icon:'📧',label:'Alertas'},compFeriados:{icon:'📅',label:'Feriados'},compConfig:{icon:'⚙️',label:'Config. Ponto'},
    contaFinanceiro:{icon:'💳',label:'Conta & Plano'},roi:{icon:'📈',label:'ROI'},
    emergencia:{icon:'🚨',label:'Emergência'},
    pontoSetup:{icon:'✅',label:'Setup Relógio'},pontoDash:{icon:'📊',label:'Dashboard Ponto'},pontoEmployees:{icon:'👥',label:'Funcionários & Horários'},
    pontoImport:{icon:'📥',label:'Importar Ponto'},pontoMirror:{icon:'🪞',label:'Espelho & Análise'},pontoJustif:{icon:'📝',label:'Justificativas'},
    compCalendario:{icon:'📅',label:'Calendário & Feriados'},compDash:{icon:'⚖️',label:'Compliance'},compConfig:{icon:'⚙️',label:'Configuração'}
  };

  function getFavorites() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; }
  }
  function saveFavorites(favs) { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); }

  function getRecents() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
  }
  function getUsage() {
    try { return JSON.parse(localStorage.getItem(USAGE_KEY)) || {}; } catch { return {}; }
  }

  function trackPanelUsage(id) {
    try {
      // Update recents (max 8, no duplicates)
      let recents = getRecents().filter(r => r !== id);
      recents.unshift(id);
      if (recents.length > 8) recents = recents.slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(recents));

      // Update usage count
      const usage = getUsage();
      usage[id] = (usage[id] || 0) + 1;
      localStorage.setItem(USAGE_KEY, JSON.stringify(usage));

      // Update recently used chips on dashboard
      renderRecentChips();
      // Update less-used styling
      updateLessUsedItems();
    } catch(_) {}
  }

  function toggleFavorite(panelId, e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    let favs = getFavorites();
    const idx = favs.indexOf(panelId);
    if (idx >= 0) { favs.splice(idx, 1); } else { favs.push(panelId); }
    saveFavorites(favs);
    renderFavSection();
    renderDashFavGrid();
    updateStarStates();
    renderBottomBar();
    renderTopbarPills();
  }

  function renderFavSection() {
    const container = document.getElementById('favSection');
    const favs = getFavorites();
    if (!favs.length) { container.innerHTML = ''; return; }
    let html = '<div class="fav-header"><span class="fh-star">★</span> Favoritos</div>';
    favs.forEach(id => {
      const meta = panelMeta[id];
      if (!meta) return;
      html += `<a class="nav-item fav-clone" href="#" onclick="showPanel('${id}',this)"><span class="ic">${meta.icon}</span> ${meta.label}<span class="fav-star is-fav" onclick="toggleFavorite('${id}',event)">★</span></a>`;
    });
    container.innerHTML = html;
  }

  function updateStarStates() {
    const favs = getFavorites();
    document.querySelectorAll('.sb-nav .nav-item:not(.fav-clone)').forEach(item => {
      const onclick = item.getAttribute('onclick') || '';
      const match = onclick.match(/showPanel\('([^']+)'/);
      if (!match) return;
      const id = match[1];
      let star = item.querySelector('.fav-star');
      if (!star) {
        star = document.createElement('span');
        star.className = 'fav-star';
        star.onclick = (e) => toggleFavorite(id, e);
        item.appendChild(star);
      }
      star.textContent = favs.includes(id) ? '★' : '☆';
      star.classList.toggle('is-fav', favs.includes(id));
    });
  }

  function renderDashFavGrid() {
    const grid = document.getElementById('dashFavGrid');
    if (!grid) return;
    const favs = getFavorites();
    const recents = getRecents();
    // Show favorites first, then top recents to fill at least 6 slots
    let items = [...favs];
    recents.forEach(r => { if (!items.includes(r) && items.length < 6) items.push(r); });
    // If still less than 6, add defaults
    const defaults = ['crmKanban','almPend','finMens','notasVisao','impressoes','emergencia'];
    defaults.forEach(d => { if (!items.includes(d) && items.length < 6) items.push(d); });

    let html = '';
    items.slice(0, 8).forEach(id => {
      const meta = panelMeta[id] || { icon: '📄', label: id };
      const isFav = favs.includes(id);
      html += `<div class="dash-fav-card" onclick="showPanel('${id}')">
        <span class="dfc-icon">${meta.icon}</span>
        <span class="dfc-label">${meta.label}</span>
        ${customizeMode ? `<span class="fav-star ${isFav ? 'is-fav' : ''}" onclick="event.stopPropagation();toggleFavorite('${id}')" style="opacity:1;font-size:14px;">${isFav ? '★' : '☆'}</span>` : ''}
      </div>`;
    });
    if (customizeMode) {
      html += `<div class="dash-fav-card add-fav" onclick="showAllPanelsToFavorite()">
        <span class="dfc-icon">+</span>
        <span class="dfc-label">Adicionar</span>
      </div>`;
    }
    grid.innerHTML = html;
  }

  function renderRecentChips() {
    const container = document.getElementById('recentChips');
    const wrapper = document.getElementById('recentlyUsed');
    if (!container || !wrapper) return;
    const recents = getRecents();
    const favs = getFavorites();
    // Show recents that aren't already in favorites grid
    const shown = recents.filter(r => r !== 'analytics').slice(0, 5);
    if (!shown.length) { wrapper.style.display = 'none'; return; }
    wrapper.style.display = '';
    container.innerHTML = shown.map(id => {
      const meta = panelMeta[id] || { icon: '📄', label: id };
      return `<button class="ru-chip" onclick="showPanel('${id}')">${meta.icon} ${meta.label}</button>`;
    }).join('');
  }

  function toggleCustomizeMode() {
    customizeMode = !customizeMode;
    document.getElementById('customizeToggle').classList.toggle('active', customizeMode);
    document.getElementById('customizeToggle').textContent = customizeMode ? 'Concluir' : 'Personalizar';
    renderDashFavGrid();
    // Show/hide star icons in sidebar
    document.querySelectorAll('.sb-nav .fav-star').forEach(s => {
      s.style.opacity = customizeMode ? '1' : '';
    });
  }

  function showAllPanelsToFavorite() {
    const favs = getFavorites();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.style.zIndex = '210';
    let items = Object.entries(panelMeta).map(([id, m]) => {
      const isFav = favs.includes(id);
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1.5px solid ${isFav ? 'var(--red)' : 'var(--border)'};border-radius:9px;cursor:pointer;transition:all .15s;background:${isFav ? 'var(--red-light)' : '#fff'};" onclick="toggleFavorite('${id}');this.closest('.modal-overlay').remove();showAllPanelsToFavorite()">
        <span style="font-size:18px;">${m.icon}</span>
        <span style="flex:1;font-size:13px;font-weight:500;">${m.label}</span>
        <span style="color:${isFav ? '#f6a623' : 'var(--muted)'};font-size:16px;">${isFav ? '★' : '☆'}</span>
      </div>`;
    }).join('');
    overlay.innerHTML = `<div class="modal" style="max-height:80vh;overflow-y:auto;">
      <h3>Escolher Favoritos</h3>
      <p class="msub">Clique para adicionar ou remover dos seus atalhos.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">${items}</div>
      <div class="modal-actions"><button class="btn-save" onclick="this.closest('.modal-overlay').remove()">Fechar</button></div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  function updateLessUsedItems() {
    const usage = getUsage();
    const totalVisits = Object.values(usage).reduce((a, b) => a + b, 0);
    if (totalVisits < 10) return; // Not enough data yet
    const avg = totalVisits / Math.max(Object.keys(usage).length, 1);
    document.querySelectorAll('.sb-nav .sb-section .nav-item:not(.fav-clone)').forEach(item => {
      const onclick = item.getAttribute('onclick') || '';
      const match = onclick.match(/showPanel\('([^']+)'/);
      if (!match) return;
      const id = match[1];
      const count = usage[id] || 0;
      // Mark as less-used if below 20% of average
      item.classList.toggle('is-less-used', count < avg * 0.2);
    });
  }

  function initFavorites() {
    renderFavSection();
    updateStarStates();
    renderDashFavGrid();
    renderRecentChips();
    updateLessUsedItems();
    // Auto-collapse sidebar sections with no favorites and low usage
    const favs = getFavorites();
    const usage = getUsage();
    const totalVisits = Object.values(usage).reduce((a, b) => a + b, 0);
    if (totalVisits > 15) {
      document.querySelectorAll('.sb-nav .sb-label').forEach(label => {
        const section = label.nextElementSibling;
        if (!section || !section.classList.contains('sb-section')) return;
        const items = section.querySelectorAll('.nav-item');
        let sectionUsage = 0;
        let hasFav = false;
        items.forEach(item => {
          const onclick = item.getAttribute('onclick') || '';
          const match = onclick.match(/showPanel\('([^']+)'/);
          if (match) {
            sectionUsage += usage[match[1]] || 0;
            if (favs.includes(match[1])) hasFav = true;
          }
        });
        // Auto-collapse low-usage sections (keep them already collapsed from HTML)
        if (!hasFav && sectionUsage === 0) {
          section.classList.add('collapsed');
          const arrow = label.querySelector('.sb-arrow');
          if (arrow) arrow.classList.add('collapsed');
        }
      });
    }
  }

  // ── MINI SIDEBAR ──────────────────────────────────────
  function toggleMiniSidebar() {
    document.body.classList.toggle('sb-mini');
    localStorage.setItem('lumied_sb_mini', document.body.classList.contains('sb-mini') ? '1' : '0');
  }
  function restoreMiniSidebar() {
    if (localStorage.getItem('lumied_sb_mini') === '1' && window.innerWidth > 640) {
      document.body.classList.add('sb-mini');
    }
    // Add data-tooltip to nav items for mini mode
    document.querySelectorAll('.sb-nav .nav-item:not(.fav-clone)').forEach(item => {
      const label = item.textContent.trim().replace(/[★☆]/g, '').trim();
      item.setAttribute('data-tooltip', label);
    });
  }

  // ── TOPBAR NAV PILLS ─────────────────────────────────
  function renderTopbarPills() {
    const container = document.getElementById('topbarPills');
    if (!container) return;
    const favs = getFavorites();
    const recents = getRecents();
    // Show up to 6 quick-nav pills: favorites first, then recents
    let items = [...favs];
    recents.forEach(r => { if (!items.includes(r) && items.length < 6) items.push(r); });
    if (!items.length) return;
    container.innerHTML = items.slice(0, 6).map(id => {
      const meta = panelMeta[id] || { icon: '📄', label: id };
      return `<button class="tnp" data-panel="${id}" onclick="showPanel('${id}')">${meta.icon} ${meta.label}</button>`;
    }).join('');
  }

  function updateTopbarPillActive(panelId) {
    document.querySelectorAll('.tnp').forEach(p => {
      p.classList.toggle('active', p.dataset.panel === panelId);
    });
  }

  // ── MOBILE BOTTOM BAR ────────────────────────────────
  function renderBottomBar() {
    const bar = document.getElementById('gerBottomBar');
    if (!bar) return;
    const favs = getFavorites();
    const recents = getRecents();
    // Up to 4 items + "Menu" button
    let items = [...favs];
    recents.forEach(r => { if (!items.includes(r) && items.length < 4) items.push(r); });
    // Defaults if not enough
    const defaults = ['analytics','finDash','crmLeads','almPend'];
    defaults.forEach(d => { if (!items.includes(d) && items.length < 4) items.push(d); });
    items = items.slice(0, 4);

    let html = items.map(id => {
      const meta = panelMeta[id] || { icon: '📄', label: id };
      return `<button class="ger-bb-item" data-panel="${id}" onclick="showPanel('${id}')"><span class="bb-icon">${meta.icon}</span><span class="bb-label">${meta.label}</span></button>`;
    }).join('');
    // "Menu" button to open sidebar
    html += `<button class="ger-bb-item" onclick="toggleSidebar()"><span class="bb-icon">☰</span><span class="bb-label">Menu</span></button>`;
    bar.innerHTML = html;
  }

  function updateBottomBarActive(panelId) {
    document.querySelectorAll('.ger-bb-item').forEach(b => {
      b.classList.toggle('active', b.dataset.panel === panelId);
    });
  }

