// Auto-extraído do gerente.html (Onda 4 — mega batch).
// Offline detection + Cleanup unload + Onboarding wizard + Morning briefing + Busca rápida Ctrl+K
  // ── OFFLINE DETECTION ──────────────────────────────────
  function showOfflineBanner(show) {
    let b = document.getElementById('offlineBanner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'offlineBanner';
      b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#a16207;color:#fff;text-align:center;padding:10px;font-size:13px;font-weight:600;z-index:9999;font-family:"DM Sans",sans-serif;transition:transform .3s;';
      b.textContent = '📡 Sem conexão com a internet';
      document.body.appendChild(b);
    }
    b.style.transform = show ? 'translateY(0)' : 'translateY(100%)';
  }
  window.addEventListener('offline', () => showOfflineBanner(true));
  window.addEventListener('online', () => showOfflineBanner(false));
  if (!navigator.onLine) showOfflineBanner(true);

  // ── CLEANUP ON UNLOAD ─────────────────────────────────
  window.addEventListener('beforeunload', () => { if (realtimeChannel) sbClient.removeChannel(realtimeChannel); });

  // ═══ ONBOARDING WIZARD ═══
  async function checkOnboarding() {
    // Show wizard if escola has no series, no professoras, no familias
    try {
      const [sRes, pRes, fRes] = await Promise.all([
        api({ action: 'series_list' }),
        api({ action: 'professoras_list' }),
        api({ action: 'familias_list' })
      ]);
      const series = Array.isArray(sRes) ? sRes : (sRes.data || []);
      const profs = Array.isArray(pRes) ? pRes : (pRes.data || []);
      const fams = Array.isArray(fRes) ? fRes : (fRes.data || []);
      // If all empty or very few, show wizard
      if (series.length <= 1 && profs.length === 0 && fams.length === 0) {
        document.getElementById('onboardingWizard').style.display = 'flex';
      }
      // Mark completed steps
      if (series.length > 0) markOnboardingStep(2);
      if (profs.length > 0) markOnboardingStep(3);
      if (fams.length > 0) markOnboardingStep(4);
    } catch(e) {}
  }
  function markOnboardingStep(n) {
    const el = document.getElementById('obCheck' + n);
    if (el) { el.textContent = '✓'; el.style.background = 'var(--green)'; el.style.color = '#fff'; el.style.borderColor = 'var(--green)'; }
  }
  function goOnboardingStep(n) {
    closeOnboarding();
    if (n === 1) showPanel('logo');
    if (n === 2) showPanel('series');
    if (n === 3) showPanel('equipe');
    if (n === 4) showPanel('familias');
    if (n === 5) showPanel('chatConversas');
  }
  function closeOnboarding() { document.getElementById('onboardingWizard').style.display = 'none'; localStorage.setItem('mb_onboarding_done', '1'); }

  // ═══ MORNING BRIEFING + DASHBOARD KPIs ═══
  function loadMorningBriefing() {
    var now = new Date();
    var hour = now.getHours();
    var greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    var firstName = (currentGerente && currentGerente.nome || 'Gestor').split(/\s/)[0];
    document.getElementById('briefingGreeting').textContent = greeting + ', ' + firstName + '!';
    document.getElementById('briefingDate').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    loadDashboardResumo();
  }

  function _fmtBRLShort(v) {
    var n = Number(v) || 0;
    if (Math.abs(n) >= 1000000) return 'R$ ' + (n/1000000).toFixed(1).replace('.',',') + 'M';
    if (Math.abs(n) >= 1000) return 'R$ ' + (n/1000).toFixed(1).replace('.',',') + 'k';
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  function _fmtBRL(v) {
    return 'R$ ' + (Number(v)||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function _setTrend(elId, current, previous, invertGood) {
    var el = document.getElementById(elId); if (!el) return;
    var c = Number(current||0), p = Number(previous||0);
    if (!p && !c) { el.style.display = 'none'; return; }
    el.style.display = 'inline-block';
    if (!p) { el.className = 'bm-trend flat'; el.textContent = 'novo'; return; }
    var pct = Math.round(((c - p) / Math.abs(p)) * 100);
    var isUp = pct > 0;
    var isGood = invertGood ? !isUp : isUp;
    if (Math.abs(pct) < 2) { el.className = 'bm-trend flat'; el.textContent = '≈ ' + Math.abs(pct) + '%'; }
    else if (isGood) { el.className = 'bm-trend up'; el.textContent = (isUp?'↑ ':'↓ ') + Math.abs(pct) + '%'; }
    else { el.className = 'bm-trend down'; el.textContent = (isUp?'↑ ':'↓ ') + Math.abs(pct) + '%'; }
  }

  // ── Modal de drill-down dos itens pendentes ────────────────
  function fecharPendenciasModal() {
    document.getElementById('pendenciasModal').style.display = 'none';
  }

  async function abrirPendenciasModal() {
    const wrap = document.getElementById('pendenciasContent');
    wrap.innerHTML = '⏳ Carregando…';
    document.getElementById('pendenciasModal').style.display = 'block';

    // Resumo + listas em paralelo (cada uma falha isoladamente)
    const [resumo, manut, almox, mens, leads] = await Promise.all([
      api({ action: 'dashboard_resumo_gerente' }).catch(() => ({})),
      api({ action: 'manutencao_list', somente_abertas: true, limit: 50 }).catch(() => []),
      callDiplomas({ action: 'alm_pendentes' }).catch(() => ({ data: [] })),
      api({ action: 'fin_mensalidades_list', mes: new Date().toISOString().slice(0,7) }).catch(() => []),
      api({ action: 'crm_leads_list' }).catch(() => []),
    ]);
    const pend = (resumo?.pendencias) || {};

    const arrManut = Array.isArray(manut) ? manut : (manut?.data || []);
    const arrAlmox = (almox?.data) || (Array.isArray(almox) ? almox : []);
    const arrMens = Array.isArray(mens) ? mens : (mens?.data || []);
    const arrMensAtr = arrMens.filter(m => m.status === 'atrasado');
    const arrLeads = Array.isArray(leads) ? leads : (leads?.data || []);
    // Leads parados: sem atualização em mais de 7 dias e ainda em estágio aberto
    const corteLead = Date.now() - 7 * 86400000;
    const arrLeadsParados = arrLeads.filter(l => {
      const ts = l.atualizado_em ? new Date(l.atualizado_em).getTime() : 0;
      return ts && ts < corteLead && !['ganho','perdido','cancelado','matriculado'].includes(l.estagio_nome || '');
    });

    const totalUrgentes = (pend.manutencao_urgentes || 0)
      + (pend.mensalidades_atrasadas || arrMensAtr.length || 0);
    const totalGeral = pend.total ?? (arrManut.length + arrAlmox.length + arrMensAtr.length + arrLeadsParados.length);

    const sec = (icone, titulo, panelAlvo, items, renderItem) => {
      const top = items.slice(0, 5);
      const restante = items.length - top.length;
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${items.length?'8px':'0'};">
          <div><strong>${icone} ${titulo}</strong> <span style="color:var(--muted);font-size:12px;">(${items.length})</span></div>
          ${panelAlvo ? `<button onclick="fecharPendenciasModal();showPanel('${panelAlvo}')" style="background:#1a6bb5;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:11px;cursor:pointer;font-family:inherit;">Ver tudo →</button>` : ''}
        </div>
        ${items.length === 0 ? '' : '<div style="display:flex;flex-direction:column;gap:6px;">' + top.map(renderItem).join('') + (restante > 0 ? `<div style="font-size:11px;color:var(--muted);text-align:center;padding:4px;">+${restante} item(ns) — clique em "Ver tudo →"</div>` : '') + '</div>'}
      </div>`;
    };

    const URG = { critica:'🔴', alta:'🟠', media:'🟡', baixa:'⚪' };
    wrap.innerHTML = `
      <div style="background:linear-gradient(135deg,#fef3f2,#fff);border:1px solid #fecaca;border-radius:10px;padding:12px 16px;margin-bottom:14px;">
        <strong style="color:#9a3412;">${totalGeral} item(ns) pendentes</strong>
        ${totalUrgentes > 0 ? ` · <span style="color:#b91c1c;font-weight:600;">${totalUrgentes} urgente(s)</span>` : ''}
        <div style="font-size:11px;color:var(--muted);margin-top:4px;">Clique em qualquer item pra abrir os detalhes no painel.</div>
      </div>
      ${sec('🔧', 'Manutenções pendentes', 'manutencao', arrManut, (m) =>
        `<button onclick="fecharPendenciasModal();showPanel('manutencao');setTimeout(()=>typeof openManutModal==='function'&&openManutModal('${m.id}'),100)" style="background:#fafafa;border:1px solid #f0ece6;border-radius:8px;padding:8px 12px;cursor:pointer;text-align:left;font-family:inherit;display:flex;justify-content:space-between;gap:10px;">
          <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">
            <span style="font-weight:600;">${URG[m.urgencia]||''} ${esc((m.descricao||'').slice(0,80))}</span>
            <div style="font-size:10px;color:var(--muted);margin-top:2px;">${esc(m.localizacao||'—')} · ${m.criado_em?new Date(m.criado_em).toLocaleDateString('pt-BR'):'—'}</div>
          </div>
          <span style="color:#1a6bb5;font-weight:600;align-self:center;">→</span>
        </button>`
      )}
      ${sec('📦', 'Requisições almoxarifado', 'almPend', arrAlmox, (r) =>
        `<button onclick="fecharPendenciasModal();showPanel('almPend');setTimeout(()=>typeof almAbrirReview==='function'&&almAbrirReview('${r.id}'),100)" style="background:#fafafa;border:1px solid #f0ece6;border-radius:8px;padding:8px 12px;cursor:pointer;text-align:left;font-family:inherit;display:flex;justify-content:space-between;gap:10px;">
          <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">
            <span style="font-weight:600;">${esc(r.professoras?.nome||'?')}</span> · ${esc(r.series?.nome||'—')}
            <div style="font-size:10px;color:var(--muted);margin-top:2px;">${(r.itens||[]).length} item(ns) · ${almFmtBRL?almFmtBRL(r.total||0):'R$ '+(r.total||0)} · ${r.criado_em?new Date(r.criado_em).toLocaleDateString('pt-BR'):'—'}</div>
          </div>
          <span style="color:#1a6bb5;font-weight:600;align-self:center;">→</span>
        </button>`
      )}
      ${sec('💸', 'Mensalidades atrasadas', 'finMens', arrMensAtr, (m) =>
        `<button onclick="fecharPendenciasModal();showPanel('finMens')" style="background:#fafafa;border:1px solid #f0ece6;border-radius:8px;padding:8px 12px;cursor:pointer;text-align:left;font-family:inherit;display:flex;justify-content:space-between;gap:10px;">
          <div style="flex:1;min-width:0;">
            <span style="font-weight:600;">${esc(m.crianca_nome||m.familia_nome||'?')}</span>
            <div style="font-size:10px;color:var(--muted);margin-top:2px;">${esc(m.familia_email||'')} · venc. ${m.data_vencimento?new Date(m.data_vencimento+'T12:00').toLocaleDateString('pt-BR'):'—'} · R$ ${Number(m.valor_total||0).toFixed(2)}</div>
          </div>
          <span style="color:#1a6bb5;font-weight:600;align-self:center;">→</span>
        </button>`
      )}
      ${sec('📋', 'Leads parados +7d', 'crmKanban', arrLeadsParados, (l) =>
        `<button onclick="fecharPendenciasModal();showPanel('crmKanban')" style="background:#fafafa;border:1px solid #f0ece6;border-radius:8px;padding:8px 12px;cursor:pointer;text-align:left;font-family:inherit;display:flex;justify-content:space-between;gap:10px;">
          <div style="flex:1;min-width:0;">
            <span style="font-weight:600;">${esc(l.nome_responsavel||l.nome_crianca||'?')}</span>
            <div style="font-size:10px;color:var(--muted);margin-top:2px;">${esc(l.estagio_nome||'')} · sem update há ${Math.round((Date.now()-new Date(l.atualizado_em).getTime())/86400000)}d</div>
          </div>
          <span style="color:#1a6bb5;font-weight:600;align-self:center;">→</span>
        </button>`
      )}
      ${totalGeral === 0 ? '<div style="padding:30px;text-align:center;color:#15803d;font-weight:600;">✨ Tudo em dia — nenhuma pendência.</div>' : ''}
    `;
  }

  async function loadDashboardResumo() {
    var d;
    try { d = await api({ action: 'dashboard_resumo_gerente' }); } catch(_) { return; }
    if (!d || d.error) return;

    // KPIs do hero
    var al = d.alunos || {};
    var fin = d.financeiro || {};
    var pend = d.pendencias || {};
    document.getElementById('bmAlunos').textContent = al.ativos != null ? al.ativos : '—';
    document.getElementById('bmPresenca').textContent = al.presenca_pct != null ? al.presenca_pct + '%' : (al.freq_registrada ? '0%' : '—');
    // Inadimplência do mês
    var inadPct = d.inadimplencia_pct;
    var bmInadEl = document.getElementById('bmInadimplencia');
    if (bmInadEl) bmInadEl.textContent = inadPct != null ? inadPct + '%' : '—';
    var inadTrend = document.getElementById('bmInadimplenciaTrend');
    if (inadTrend && inadPct != null) {
      inadTrend.style.display = 'inline-block';
      if (inadPct === 0) { inadTrend.className = 'bm-trend up'; inadTrend.textContent = 'Em dia'; }
      else if (inadPct <= 10) { inadTrend.className = 'bm-trend flat'; inadTrend.textContent = fin.qtd_atrasado + ' família(s)'; }
      else { inadTrend.className = 'bm-trend down'; inadTrend.textContent = fin.qtd_atrasado + ' família(s)'; }
    }
    // Próximos vencimentos
    var bmVencEl = document.getElementById('bmVencimentos');
    if (bmVencEl) bmVencEl.textContent = d.proximos_vencimentos_count != null ? d.proximos_vencimentos_count : '—';
    var vencTrend = document.getElementById('bmVencimentosTrend');
    if (vencTrend && d.proximos_vencimentos_count > 0) {
      vencTrend.style.display = 'inline-block'; vencTrend.className = 'bm-trend flat'; vencTrend.textContent = 'em 7 dias';
    }
    var alunosTrend = document.getElementById('bmAlunosTrend');
    if (al.ausentes_hoje > 0) { alunosTrend.style.display='inline-block'; alunosTrend.className='bm-trend down'; alunosTrend.textContent = al.ausentes_hoje + ' ausentes'; }
    else if (al.presentes_hoje > 0) { alunosTrend.style.display='inline-block'; alunosTrend.className='bm-trend up'; alunosTrend.textContent = al.presentes_hoje + ' presentes'; }

    // Alertas section
    var alertas = [];
    var fc = d.freq_critica || {};
    if (fc.total > 0) {
      var fcNomes = (fc.alunos || []).slice(0, 3).map(function(a) { return a.nome + ' (' + a.pct + '%)'; }).join(', ');
      alertas.push({ icon: '🚨', text: '<strong>' + fc.total + ' aluno(s) com frequência abaixo de 75%</strong> — ' + esc(fcNomes) + (fc.total > 3 ? ' e mais...' : ''), cls: 'ba-urgent', panel: 'frequencia' });
    }
    if (pend.leads_parados > 0) {
      alertas.push({ icon: '📋', text: '<strong>' + pend.leads_parados + ' lead(s) parado(s) há mais de 7 dias</strong> — sem atualização no CRM', cls: 'ba-warn', panel: 'crmKanban' });
    }
    var alertasEl = document.getElementById('briefingAlertas');
    if (alertasEl) {
      if (alertas.length > 0) {
        alertasEl.style.display = 'flex';
        alertasEl.innerHTML = '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;opacity:.6;margin-bottom:4px;">Alertas</div>'
          + alertas.map(function(a) {
            return '<button class="ba-item ' + a.cls + '" onclick="showPanel(\'' + a.panel + '\')">'
              + '<span class="ba-icon">' + a.icon + '</span>'
              + '<span class="ba-text">' + a.text + '</span>'
              + '<span class="ba-arrow">→</span></button>';
          }).join('');
      } else {
        alertasEl.style.display = 'none';
      }
    }

    // Action strip
    var actions = [];
    if (pend.mensalidades_atrasadas > 0) actions.push({ icon:'💸', count: pend.mensalidades_atrasadas, label:'Mensalidades atrasadas', cls:'urgent', panel:'finMens' });
    if (pend.manutencao_pendente > 0) actions.push({ icon:'🔧', count: pend.manutencao_pendente, label:'Manutenções pendentes', cls: pend.manutencao_urgentes>0?'urgent':'warn', panel:'manutencao' });
    if (pend.almox_pendente_qtd > 0) actions.push({ icon:'📦', count: pend.almox_pendente_qtd, label:'Requisições almox.', cls:'warn', panel:'almPend' });
    if (pend.leads_parados > 0) actions.push({ icon:'📋', count: pend.leads_parados, label:'Leads parados +7d', cls:'warn', panel:'crmKanban' });
    if (al.ausentes_hoje > 0) actions.push({ icon:'🚨', count: al.ausentes_hoje, label:'Faltas hoje', cls:'urgent', panel:'frequencia' });
    if (!actions.length) actions.push({ icon:'✨', count: '0', label:'Tudo em dia!', cls:'ok', panel:'analytics' });
    var stripEl = document.getElementById('dashActionStrip');
    if (stripEl) stripEl.innerHTML = actions.map(function(a) {
      return '<button class="dash-action ' + a.cls + '" onclick="showPanel(\'' + a.panel + '\')">'
        + '<div class="da-icon">' + a.icon + '</div>'
        + '<div class="da-body"><div class="da-count">' + a.count + '</div><div class="da-label">' + esc(a.label) + '</div></div>'
        + '<div class="da-arrow">→</div></button>';
    }).join('');

    // Receita widget
    var revEl = document.getElementById('receitaWidgetContent');
    if (revEl) {
      var pago = Number(fin.mens_pago||0), pend2 = Number(fin.mens_pendente||0), atr = Number(fin.mens_atrasado||0);
      var total = pago + pend2 + atr;
      var pctPago = total ? Math.round((pago/total)*100) : 0;
      var pctPend = total ? Math.round((pend2/total)*100) : 0;
      var pctAtr = total ? Math.round((atr/total)*100) : 0;
      var diffPct = fin.receita_mes_anterior ? Math.round(((fin.receita_mes - fin.receita_mes_anterior) / fin.receita_mes_anterior) * 100) : 0;
      var trendCls = !fin.receita_mes_anterior ? 'flat' : diffPct >= 2 ? 'up' : diffPct <= -2 ? 'down' : 'flat';
      var trendTxt = !fin.receita_mes_anterior ? 'sem comparativo' : (diffPct>0?'↑ ':diffPct<0?'↓ ':'≈ ') + Math.abs(diffPct) + '% vs mês anterior';
      revEl.innerHTML = ''
        + '<div class="rev-hero">'
        +   '<span class="rh-value">' + _fmtBRL(fin.receita_mes) + '</span>'
        +   '<span class="rh-trend ' + trendCls + '">' + trendTxt + '</span>'
        + '</div>'
        + '<div style="font-size:12px;color:var(--muted);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Mensalidades do mês</div>'
        + '<div class="rev-progress">'
        +   '<div class="rp-bar">'
        +     (pctPago>0?'<div class="rp-pago" style="width:'+pctPago+'%"></div>':'')
        +     (pctPend>0?'<div class="rp-pendente" style="width:'+pctPend+'%"></div>':'')
        +     (pctAtr>0?'<div class="rp-atrasado" style="width:'+pctAtr+'%"></div>':'')
        +   '</div>'
        +   '<span class="rp-pct">' + pctPago + '%</span>'
        + '</div>'
        + '<div class="rev-bars">'
        +   '<div class="rev-bar-item"><span class="rbi-label">Pago</span><span class="rbi-val" style="color:#15803d;">' + _fmtBRL(pago) + ' <span style="font-size:11px;color:var(--muted);font-weight:500;">(' + (fin.qtd_pago||0) + ')</span></span></div>'
        +   '<div class="rev-bar-item"><span class="rbi-label">A receber</span><span class="rbi-val" style="color:#a16207;">' + _fmtBRL(pend2) + ' <span style="font-size:11px;color:var(--muted);font-weight:500;">(' + (fin.qtd_pendente||0) + ')</span></span></div>'
        + '</div>'
        + (atr > 0 ? '<div style="margin-top:10px;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:12px;color:#b91c1c;font-weight:600;">⚠️ ' + _fmtBRL(atr) + ' atrasados (' + (fin.qtd_atrasado||0) + ' famílias)</div>' : '')
        + '<div class="rev-legend">'
        +   '<span><span class="rl-dot" style="background:#22c55e;"></span>Pago</span>'
        +   '<span><span class="rl-dot" style="background:#facc15;"></span>A vencer</span>'
        +   '<span><span class="rl-dot" style="background:#ef4444;"></span>Atrasado</span>'
        + '</div>';
    }

    // Devedores widget
    var devEl = document.getElementById('devedoresWidgetContent');
    if (devEl) {
      var devs = d.top_devedores || [];
      if (!devs.length) {
        devEl.innerHTML = '<div class="dc-empty" style="color:#15803d;font-style:normal;font-weight:600;">✓ Nenhuma família inadimplente</div>';
      } else {
        devEl.innerHTML = devs.map(function(dv, i) {
          return '<div class="devedor-row" onclick="showPanel(\'finMens\')">'
            + '<div class="dr-rank">' + (i+1) + '</div>'
            + '<div style="flex:1;min-width:0;"><div class="dr-name">' + esc(dv.nome) + '</div>'
            + '<div class="dr-info">' + dv.qtd + ' mensalidade' + (dv.qtd>1?'s':'') + ' atrasada' + (dv.qtd>1?'s':'') + '</div></div>'
            + '<div class="dr-val">' + _fmtBRL(dv.total) + '</div>'
            + '</div>';
        }).join('');
      }
    }

    // Vencimentos widget
    var vencEl = document.getElementById('vencimentosWidgetContent');
    if (vencEl) {
      var vencs = d.proximos_vencimentos || [];
      if (!vencs.length) {
        vencEl.innerHTML = '<div class="dc-empty">Sem vencimentos para os próximos 7 dias</div>';
      } else {
        var meses = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
        vencEl.innerHTML = vencs.map(function(v) {
          var dt = new Date(v.vencimento + 'T12:00:00');
          return '<div class="venc-row">'
            + '<div class="vr-day"><div class="vr-d">' + dt.getDate() + '</div><div class="vr-m">' + meses[dt.getMonth()] + '</div></div>'
            + '<div class="vr-body"><div class="vr-desc">' + esc(v.descricao || '—') + '</div>'
            + '<div class="vr-sub">' + (v.fornecedor ? esc(v.fornecedor) : (v.tipo === 'receita' ? 'A receber' : 'A pagar')) + '</div></div>'
            + '<div class="vr-val ' + v.tipo + '">' + (v.tipo==='receita'?'+':'−') + ' ' + _fmtBRL(v.valor) + '</div>'
            + '</div>';
        }).join('');
      }
    }

    // Agenda widget (eventos + aniversariantes intercalados por proximidade)
    var agEl = document.getElementById('agendaWidgetContent');
    if (agEl) {
      var items = [];
      (d.eventos_proximos || []).forEach(function(e) {
        var dt = new Date(e.data_inicio + 'T12:00:00');
        var hoje0 = new Date(); hoje0.setHours(0,0,0,0);
        var dias = Math.round((dt - hoje0) / 86400000);
        items.push({ kind:'evento', dias:dias, dt:dt, titulo:e.titulo, cor:e.cor||'#1a6bb5', tipo:e.tipo });
      });
      (d.aniversariantes || []).forEach(function(a) {
        items.push({ kind:'bday', dias:a.dias_falta, titulo:a.nome, idade:a.idade, serie:a.serie, dia:a.dia });
      });
      items.sort(function(a,b){ return a.dias - b.dias; });
      items = items.slice(0, 6);
      if (!items.length) {
        agEl.innerHTML = '<div class="dc-empty">Nada agendado para os próximos 7 dias</div>';
      } else {
        agEl.innerHTML = items.map(function(it) {
          var whenTxt = it.dias === 0 ? 'hoje' : it.dias === 1 ? 'amanhã' : 'em ' + it.dias + 'd';
          var whenCls = it.dias === 0 ? 'today' : '';
          if (it.kind === 'bday') {
            return '<div class="bday-row">'
              + '<div class="br-icon">🎂</div>'
              + '<div class="br-body"><div class="br-name">' + esc(it.titulo) + '</div>'
              + '<div class="br-info">faz ' + it.idade + ' anos' + (it.serie?' · '+esc(it.serie):'') + '</div></div>'
              + '<div class="br-when ' + whenCls + '">' + whenTxt + '</div>'
              + '</div>';
          }
          return '<div class="bday-row">'
            + '<div class="br-icon" style="background:' + it.cor + '20;color:' + it.cor + ';">📅</div>'
            + '<div class="br-body"><div class="br-name">' + esc(it.titulo) + '</div>'
            + '<div class="br-info">' + esc(it.tipo || 'evento') + '</div></div>'
            + '<div class="br-when ' + whenCls + '">' + whenTxt + '</div>'
            + '</div>';
        }).join('');
      }
    }
  }
  // Chamar após login
  var _origShowApp = showApp;
  showApp = function(user) {
    _origShowApp(user);
    loadMorningBriefing();
    if (!localStorage.getItem('mb_onboarding_done')) checkOnboarding();
  };

  // ═══ BUSCA RÁPIDA (Ctrl+K) ═══
  var searchData = [
    {icon:'📊',text:'Dashboard Analytics',panel:'analytics'},
    {icon:'📝',text:'Notas / Visão Geral',panel:'notasVisao'},
    {icon:'✅',text:'Frequência',panel:'frequencia'},
    {icon:'📖',text:'Diário de Classe',panel:'diarioClasse'},
    {icon:'🏆',text:'Diplomas',panel:'diplomas'},
    {icon:'📈',text:'Growth Plan',panel:'pdi'},
    {icon:'📦',text:'Almoxarifado Dashboard',panel:'almDash'},
    {icon:'⏳',text:'Almoxarifado Pendentes',panel:'almPend'},
    {icon:'🗃️',text:'Insumos',panel:'almInsumos'},
    {icon:'💰',text:'Dashboard Financeiro',panel:'finDash'},
    {icon:'📝',text:'Lançamentos',panel:'finLanc'},
    {icon:'🧾',text:'Mensalidades',panel:'finMens'},
    {icon:'📈',text:'DRE',panel:'finDre'},
    {icon:'⚖️',text:'Balanço Patrimonial',panel:'finBalanco'},
    {icon:'🧾',text:'Mensalidades & Boletos',panel:'finMens'},
    {icon:'📋',text:'CRM Pipeline',panel:'crmKanban'},
    {icon:'👥',text:'Leads',panel:'crmLeads'},
    {icon:'💬',text:'Templates WhatsApp',panel:'crmTemplates'},
    {icon:'🎯',text:'Vagas',panel:'crmVagas'},
    {icon:'📝',text:'Matrículas',panel:'crmMatriculas'},
    {icon:'💬',text:'Chat / Conversas',panel:'chatConversas'},
    {icon:'📊',text:'Pesquisas',panel:'pesquisas'},
    {icon:'📅',text:'Calendário',panel:'calendario'},
    {icon:'👥',text:'Equipe',panel:'equipe'},
    {icon:'👨‍👩‍👧',text:'Famílias',panel:'familias'},
    {icon:'🔧',text:'Manutenção',panel:'manutencao'},
    {icon:'🔍',text:'Achados & Perdidos',panel:'achados'},
    {icon:'🖨️',text:'Impressões',panel:'impressoes'},
    {icon:'🚨',text:'Emergência',panel:'emergencia'},
    {icon:'⚙️',text:'Config Notas',panel:'notasConfig'},
    {icon:'📚',text:'Disciplinas',panel:'notasDisciplinas'},
    {icon:'📅',text:'Períodos Letivos',panel:'notasPeriodos'},
    {icon:'📋',text:'Formulários Matrícula',panel:'matriculaForm'},
    {icon:'📊',text:'Status Matrículas',panel:'matriculaStatus'},
  ];

  // Create search overlay
  var searchOverlay = document.createElement('div');
  searchOverlay.className = 'search-overlay';
  searchOverlay.innerHTML = '<div class="search-box"><div class="search-input-wrap"><span class="search-icon">🔍</span><input id="searchInput" placeholder="Buscar funcionalidade..." autocomplete="off"><span style="font-size:11px;color:var(--muted);padding:4px 8px;border:1px solid var(--border);border-radius:4px;">ESC</span></div><div class="search-results" id="searchResults"></div></div>';
  searchOverlay.addEventListener('click', (e) => { if (e.target === searchOverlay) closeSearch(); });
  document.body.appendChild(searchOverlay);

  function openSearch() {
    searchOverlay.classList.add('show');
    const input = document.getElementById('searchInput');
    input.value = '';
    input.focus();
    renderSearchResults('');
  }
  function closeSearch() { searchOverlay.classList.remove('show'); }

  function renderSearchResults(query) {
    const q = query.toLowerCase();
    const filtered = q ? searchData.filter(s => s.text.toLowerCase().includes(q)) : searchData.slice(0, 8);
    document.getElementById('searchResults').innerHTML = filtered.map((s, i) =>
      '<div class="search-result' + (i === 0 ? ' selected' : '') + '" onclick="showPanel(\'' + s.panel + '\');closeSearch()"><span class="sr-icon">' + s.icon + '</span><div><div class="sr-text">' + s.text + '</div></div></div>'
    ).join('') || '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">Nenhum resultado</div>';
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
    if (e.key === 'Escape' && searchOverlay.classList.contains('show')) closeSearch();
    if (searchOverlay.classList.contains('show') && e.key === 'Enter') {
      const sel = document.querySelector('.search-result.selected');
      if (sel) sel.click();
    }
  });
  document.getElementById('searchInput')?.addEventListener('input', (e) => renderSearchResults(e.target.value));

  // Indicador de autosave compartilhado (usado pelos handlers que de fato salvam)
  // Cada feature que tem autosave real chama window.lumiedShowAutoSaved() depois
  // de receber confirmação do servidor. NÃO existe handler global "todo input
  // salva automaticamente" — isso mentia pro usuário sem persistir nada.
  var autoSaveIndicator = document.createElement('div');
  autoSaveIndicator.className = 'autosave-indicator';
  autoSaveIndicator.textContent = '✓ Salvo';
  document.body.appendChild(autoSaveIndicator);
  window.lumiedShowAutoSaved = function() {
    autoSaveIndicator.classList.add('show');
    setTimeout(() => autoSaveIndicator.classList.remove('show'), 1500);
  };

