// Auto-extraído do gerente.html (Onda 4 — batch).
// Almoxarifado core — TAB switching, relatórios, compras, distribuição, criar req gerente, rascunho, órfãos
  // ── ALMOXARIFADO ─────────────────────────────────────────
  var almReviewId = null;
  var almReviewItens = [];          // itens da req em análise
  var almSelectedPrices = {};       // idx → melhor resultado de preço por item
  var almFmtBRL = v => 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  var almMesBR  = mes => { const [y,m]=mes.split('-'); return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][parseInt(m)-1]+'/'+y; };

  function almShowTab(tab, btn) {
    document.querySelectorAll('#almTabs .alm-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#panelAlmoxarifado .alm-tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('almTab-' + tab).classList.add('active');
    if (tab === 'dashboard')  almLoadDashboard();
    if (tab === 'pendentes')  almLoadPendentes();
    if (tab === 'todas')      almLoadTodas();
    if (tab === 'insumos')    almLoadInsumos();
    if (tab === 'turmas')     almLoadTurmas();
    if (tab === 'orcamentos') almLoadOrcamentos();
    if (tab === 'relatorio')  almLoadRelatorio();
    if (tab === 'compras')    almSetModoCompras(almComprasModo || 'compilado');
  }

  // ── MONTH NAV HELPERS ──────────────────────────────────
  var MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  function monthNavSet(inputId, val) {
    document.getElementById(inputId).value = val;
    const [y, m] = val.split('-');
    const yEl = document.getElementById(inputId + 'Year');
    const mEl = document.getElementById(inputId + 'Month');
    if (yEl) yEl.textContent = y;
    if (mEl) mEl.textContent = MESES_PT[parseInt(m)-1];
  }
  function monthNavYear(inputId, delta, callback) {
    const cur = document.getElementById(inputId).value || new Date().toISOString().slice(0,7);
    const [y, m] = cur.split('-').map(Number);
    monthNavSet(inputId, (y + delta) + '-' + String(m).padStart(2,'0'));
    if (callback) callback();
  }
  function monthNavMonth(inputId, delta, callback) {
    const cur = document.getElementById(inputId).value || new Date().toISOString().slice(0,7);
    const [y, m] = cur.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    monthNavSet(inputId, d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'));
    if (callback) callback();
  }
  function monthNavToday(inputId, callback) {
    monthNavSet(inputId, new Date().toISOString().slice(0,7));
    if (callback) callback();
  }
  // Backward compat
  function monthNav(inputId, delta, callback) { monthNavMonth(inputId, delta, callback); }

  function almInitMonths() {
    const mes = new Date().toISOString().slice(0,7);
    ['almDashMes','almOrcMes','almRelMes','almTodasMes'].forEach(id => {
      if (!document.getElementById(id).value) monthNavSet(id, mes);
    });
  }
  // ── Almoxarifado tab switching ──
  function almReqsSetTab(tab, btn) {
    document.querySelectorAll('#almReqsTabs .alm-utab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('almReqTabPend').style.display = tab === 'pend' ? '' : 'none';
    document.getElementById('almReqTabHist').style.display = tab === 'hist' ? '' : 'none';
    document.getElementById('almReqTabCompras').style.display = tab === 'compras' ? '' : 'none';
    document.getElementById('almReqTabRelat').style.display = tab === 'relat' ? '' : 'none';
    if (tab === 'pend') almLoadPendentes();
    if (tab === 'hist') { almInitMonths(); almLoadTodas(); }
    if (tab === 'compras') almSetModoCompras(almComprasModo || 'compilado');
    if (tab === 'relat') almRelatInit();
  }

  // ── Relatórios dinâmicos ──────────────────────────────
  var almRelatLastResult = null;
  var almRelatVisCache = [];

  async function almRelatInit() {
    // Popula turmas no filtro
    const sel = document.getElementById('almRelatTurma');
    if (sel.options.length <= 1) {
      const d = await api({ action: 'series_list_all' });
      (Array.isArray(d) ? d : []).forEach(s => sel.add(new Option(s.nome, s.id)));
    }
    almRelatLoadVisualizacoes();
  }

  async function almRelatLoadVisualizacoes() {
    const d = await callDiplomas({ action: 'alm_relatorio_visualizacoes_list' });
    almRelatVisCache = d.data || [];
    const sel = document.getElementById('almRelatVis');
    sel.innerHTML = '<option value="">— minhas visualizações salvas —</option>' +
      almRelatVisCache.map(v => `<option value="${v.id}">${esc(v.nome)}</option>`).join('');
  }

  function almRelatColetar() {
    return {
      filtros: {
        status: document.getElementById('almRelatStatus').value || null,
        turma_id: document.getElementById('almRelatTurma').value || null,
        data_de: document.getElementById('almRelatDataDe').value || null,
        data_ate: document.getElementById('almRelatDataAte').value || null,
        fornecedor: document.getElementById('almRelatFornecedor').value.trim() || null,
      },
      agrupamento: document.getElementById('almRelatAgrup').value || null,
    };
  }

  async function almRelatRodar() {
    const wrap = document.getElementById('almRelatResultado');
    wrap.innerHTML = '⏳ Consultando…';
    const cfg = almRelatColetar();
    const d = await callDiplomas({ action: 'alm_relatorio_query', ...cfg });
    if (d.error) { wrap.innerHTML = `<div class="f-alert error show">${esc(d.error)}</div>`; return; }
    almRelatLastResult = d;
    document.getElementById('almRelatTotais').textContent =
      `${d.total_linhas} item(ns) · Total ${almFmtBRL(d.total_valor || 0)}` +
      (d.agrupamento ? ` · agrupado por ${d.agrupamento}` : '');
    if (d.agrupamento && d.grupos?.length) {
      wrap.innerHTML = d.grupos.map((g, i) => `
        <div style="border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="document.getElementById('almRelatGrp_${i}').style.display = document.getElementById('almRelatGrp_${i}').style.display==='none'?'block':'none'">
            <strong>${esc(g.chave)}</strong>
            <span style="font-size:11px;color:var(--muted);">${g.itens} itens · ${almFmtBRL(g.valor)} · ▾</span>
          </div>
          <div id="almRelatGrp_${i}" style="display:none;margin-top:8px;font-size:11px;">
            ${g.linhas.slice(0,30).map(l => `<div style="padding:4px 0;border-bottom:1px solid #f0ece6;">${new Date(l.data).toLocaleDateString('pt-BR')} · ${esc(l.nome)} ×${l.qty_aprovado || l.qty_solicitado} · ${almFmtBRL(l.valor)} · ${esc(l.status)}</div>`).join('')}
            ${g.linhas.length > 30 ? `<div style="color:var(--muted);font-size:10px;padding:4px 0;">+${g.linhas.length-30} linha(s)…</div>` : ''}
          </div>
        </div>`).join('');
    } else {
      const linhas = d.linhas || [];
      wrap.innerHTML = `<div style="overflow-x:auto;"><table style="width:100%;font-size:11px;border-collapse:collapse;">
        <tr style="background:#f9f7f4;text-align:left;"><th style="padding:6px 8px;">Data</th><th>Status</th><th>Turma</th><th>Professora</th><th>Item</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Valor</th></tr>
        ${linhas.map(l => `<tr style="border-bottom:1px solid #f0ece6;">
          <td style="padding:5px 8px;">${new Date(l.data).toLocaleDateString('pt-BR')}</td>
          <td>${esc(l.status)}</td><td>${esc(l.turma)}</td><td>${esc(l.professora)}</td><td>${esc(l.nome)}</td>
          <td style="text-align:right;">${l.qty_aprovado || l.qty_solicitado}</td>
          <td style="text-align:right;">${almFmtBRL(l.valor)}</td>
        </tr>`).join('')}
      </table></div>`;
    }
  }

  function almRelatExport(formato) {
    if (!almRelatLastResult) { showToast('Rode o relatório antes de exportar.', 'warning'); return; }
    // Reusa endpoint de relatório completo; passa filtros como query
    const cfg = almRelatColetar();
    const params = new URLSearchParams();
    if (cfg.filtros.status) params.set('status', cfg.filtros.status);
    if (cfg.filtros.turma_id) params.set('turma_id', cfg.filtros.turma_id);
    if (cfg.filtros.data_de) params.set('data_de', cfg.filtros.data_de);
    if (cfg.filtros.data_ate) params.set('data_ate', cfg.filtros.data_ate);
    if (cfg.agrupamento) params.set('agrupamento', cfg.agrupamento);
    almBaixarPdf(formato === 'xlsx' ? 'alm_relatorio_export_xlsx' : 'alm_relatorio_export_pdf', params.toString());
  }

  async function almRelatSalvarVis() {
    const nome = document.getElementById('almRelatVisNome').value.trim();
    if (!nome) { showToast('Dê um nome à visualização.', 'warning'); return; }
    const cfg = almRelatColetar();
    const d = await callDiplomas({ action: 'alm_relatorio_visualizacao_save', nome, config: cfg });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    document.getElementById('almRelatVisNome').value = '';
    showToast('Visualização salva.', 'success');
    almRelatLoadVisualizacoes();
  }

  async function almRelatExcluirVis() {
    const id = document.getElementById('almRelatVis').value;
    if (!id) { showToast('Selecione uma visualização salva primeiro.', 'warning'); return; }
    if (!await _lumiedConfirm('Excluir visualização?')) return;
    const d = await callDiplomas({ action: 'alm_relatorio_visualizacao_delete', id });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    almRelatLoadVisualizacoes();
  }

  function almRelatAplicarVis(id) {
    if (!id) return;
    const v = almRelatVisCache.find(x => x.id === id);
    if (!v?.config) return;
    const f = v.config.filtros || {};
    document.getElementById('almRelatStatus').value = f.status || '';
    document.getElementById('almRelatTurma').value = f.turma_id || '';
    document.getElementById('almRelatDataDe').value = f.data_de || '';
    document.getElementById('almRelatDataAte').value = f.data_ate || '';
    document.getElementById('almRelatFornecedor').value = f.fornecedor || '';
    document.getElementById('almRelatAgrup').value = v.config.agrupamento || '';
    almRelatRodar();
  }
  function almConfigSetTab(tab, btn) {
    document.querySelectorAll('#almConfigTabs .alm-utab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('almConfigTabCatalogo').style.display = tab === 'catalogo' ? '' : 'none';
    document.getElementById('almConfigTabTurmas').style.display = tab === 'turmas' ? '' : 'none';
    document.getElementById('almConfigTabOrc').style.display = tab === 'orcamentos' ? '' : 'none';
    if (tab === 'catalogo') { almLoadInsumos(); almLoadCategorias(); checkMLStatus(); almLoadOrfaos(); }
    if (tab === 'turmas') almLoadTurmas();
    if (tab === 'orcamentos') { almInitMonths(); almLoadOrcamentos(); }
  }

  async function almInitPanel() {
    almInitMonths();
    almLoadDashboard();
    almLoadPendentes();
    almLoadCategorias();
  }

  async function almLoadDashboard() {
    const mes = document.getElementById('almDashMes').value || new Date().toISOString().slice(0,7);
    const d = await callDiplomas({ action: 'alm_painel', mes });
    const stats = document.getElementById('almDashStats');
    const totalEst = Number(d.total_estoque || 0);
    const totalComp = Number(d.total_compra || 0);
    const subAprov = totalEst > 0 || totalComp > 0
      ? `📦 ${almFmtBRL(totalEst)} estoque · 🛒 ${almFmtBRL(totalComp)} compra`
      : `em ${almMesBR(mes)}`;
    stats.innerHTML = `
      <div class="stat-card" data-g="total"><div class="stat-label">Pendentes</div><div class="stat-value" style="color:#f6a623;">${d.pendentes??0}</div><div class="stat-sub">aguardando análise</div></div>
      <div class="stat-card" data-g="integral"><div class="stat-label">Total Aprovado</div><div class="stat-value">${almFmtBRL(d.totalAprovado)}</div><div class="stat-sub" style="font-size:10px;">${subAprov}</div></div>
      <div class="stat-card" data-g="semi"><div class="stat-label">Turmas Ativas</div><div class="stat-value">${(d.turmas||[]).length}</div><div class="stat-sub">com orçamento</div></div>`;
    const badge = document.getElementById('almPendBadge');
    if (d.pendentes > 0) { badge.textContent = d.pendentes; badge.style.display = 'inline'; }
    else badge.style.display = 'none';
    // Integrações (Mercado Livre, etc.) — checa OAuth real via ml_status
    const intEl = document.getElementById('almIntegracoes');
    const mlS = await callDiplomas({ action: 'ml_status' });
    const mlConectado = !!mlS?.connected;
    const integracoes = [
      { nome: 'Mercado Livre', icon: '🛒', conectado: mlConectado, desc: mlConectado ? 'Conectado — preços automáticos' : 'Desconectado — clique em 🛒 ML em Configuração → Catálogo para autorizar' },
      { nome: 'Banco Inter', icon: '🏦', conectado: false, desc: 'Não configurado — boletos de compra manual' },
    ];
    const desconectados = integracoes.filter(i => !i.conectado);
    if (desconectados.length) {
      intEl.innerHTML = `<div style="background:#fdf0f2;border:1.5px solid rgba(200,16,46,.2);border-radius:12px;padding:16px 20px;margin-bottom:8px;">
        <div style="font-weight:700;font-size:14px;color:#a00d24;margin-bottom:10px;">⚠️ Integrações Desconectadas</div>
        ${desconectados.map(i => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid rgba(200,16,46,.08);">
          <span style="font-size:20px;">${i.icon}</span>
          <div><strong style="font-size:13px;">${i.nome}</strong><div style="font-size:12px;color:#666;margin-top:2px;">${i.desc}</div></div>
          <span style="margin-left:auto;padding:4px 10px;background:#fdf0f2;border:1px solid rgba(200,16,46,.2);border-radius:6px;font-size:11px;font-weight:600;color:#a00d24;">Desconectado</span>
        </div>`).join('')}
      </div>`;
    } else { intEl.innerHTML = ''; }
    const turmasEl = document.getElementById('almDashTurmas');
    if (!(d.turmas||[]).length) { turmasEl.innerHTML = '<div class="empty-state">Nenhuma turma cadastrada.</div>'; return; }
    turmasEl.innerHTML = d.turmas.map(t => {
      const pct = t.orcamento > 0 ? Math.min(100, (t.gasto/t.orcamento)*100) : 0;
      const barColor = pct>=90 ? '#e53e3e' : pct>=70 ? '#f6a623' : '#48bb78';
      const pendLabel = t.gasto_pendente > 0 ? ` <span style="font-size:10px;color:#b07d00;">(${almFmtBRL(t.gasto_pendente)} pend.)</span>` : '';
      const estoqueLbl = (t.gasto_estoque > 0 || t.gasto_compra > 0)
        ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;">📦 ${almFmtBRL(t.gasto_estoque||0)} estoque · 🛒 ${almFmtBRL(t.gasto_compra||0)} compra</div>`
        : '';
      return `<div class="alm-budget-row">
        <div style="width:12px;height:12px;border-radius:50%;background:${t.cor||'#3B82F6'};flex-shrink:0;"></div>
        <div style="min-width:120px;">
          <div style="font-weight:600;font-size:13px;">${t.nome}</div>
          ${estoqueLbl}
        </div>
        <div class="alm-budget-bar-wrap"><div class="alm-budget-bar" style="width:${pct}%;background:${barColor};"></div></div>
        <div style="font-size:12px;color:var(--muted);white-space:nowrap;">${almFmtBRL(t.gasto)}${pendLabel} / ${almFmtBRL(t.orcamento)}</div>
      </div>`;
    }).join('');
  }

  // Cache do estoque atual por insumo_id — atualizado a cada load
  var _almEstoqueMap = {};

  async function _almRefreshEstoqueMap() {
    const dCat = await callDiplomas({ action: 'alm_insumos_list' });
    _almEstoqueMap = {};
    (dCat.data || []).forEach(i => { _almEstoqueMap[i.id] = Number(i.estoque_qty || 0); });
  }

  async function almLoadPendentes() {
    document.getElementById('almPendLoading').style.display = 'block';
    document.getElementById('almPendEmpty').style.display = 'none';
    document.getElementById('almPendList').innerHTML = '';
    const [d] = await Promise.all([
      callDiplomas({ action: 'alm_pendentes' }),
      _almRefreshEstoqueMap(),
    ]);
    document.getElementById('almPendLoading').style.display = 'none';
    const reqs = d.data || [];
    const badge = document.getElementById('almPendBadge');
    badge.textContent = reqs.length; badge.style.display = reqs.length ? 'inline' : 'none';
    if (!reqs.length) {
      const empty = document.getElementById('almPendEmpty');
      empty.style.display = 'block';
      empty.innerHTML = (window.lumiedEmpty ? window.lumiedEmpty({
        icon: '✅',
        title: 'Tudo em dia por aqui!',
        text: 'Nenhuma requisição de material aguardando aprovação. Quando uma professora pedir algo do almoxarifado, vai aparecer aqui pra você aprovar ou rejeitar.',
        secondary: { label: 'Ver catálogo de itens', onclick: "almShowTab && almShowTab('catalogo')" },
      }) : '✅ Nenhuma requisição pendente.');
      return;
    }
    document.getElementById('almPendList').innerHTML = reqs.map(r => almRenderReqRow(r, true)).join('');
  }

  async function almLoadTodas() {
    const mes    = document.getElementById('almTodasMes').value;
    const status = document.getElementById('almTodasStatus').value;
    document.getElementById('almTodasLoading').style.display = 'block';
    document.getElementById('almTodasList').innerHTML = '';
    const [d] = await Promise.all([
      callDiplomas({ action: 'alm_todas_reqs', mes, status }),
      _almRefreshEstoqueMap(),
    ]);
    document.getElementById('almTodasLoading').style.display = 'none';
    const reqs = d.data || [];
    if (!reqs.length) { document.getElementById('almTodasList').innerHTML = '<div class="empty-state">Nenhuma requisição encontrada.</div>'; return; }
    document.getElementById('almTodasList').innerHTML = reqs.map(r => almRenderReqRow(r, r.status==='pendente')).join('');
  }

  function almRenderReqRow(r, showBtn) {
    const statusLbl = {pendente:'⏳ Pendente',aprovado:'✅ Aprovado',rejeitado:'❌ Rejeitado'}[r.status]||r.status;
    const itens = r.itens || [];
    const turmaColor = r.series?.cor || '#3B82F6';
    const turmaNome  = r.series?.nome || '—';
    const profNome   = r.professoras?.nome || r.professoras?.email || '—';
    const data = new Date(r.criado_em).toLocaleDateString('pt-BR');
    const isAprovado = r.status === 'aprovado';
    const itensHtml = itens.map(it => {
      // Pendente: mostra estoque atual (preview do que poderá ser deduzido)
      // Aprovado: mostra qty_do_estoque e qty_a_comprar (já fixados em alm_aprovar)
      let badge = '';
      if (it.tipo === 'emprestimo') {
        badge = ` <span title="${(it.localizacao||'').replace(/"/g,'&quot;')}" style="background:#fef9c3;color:#854d0e;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;">🏫 Empréstimo</span>`;
      } else if (isAprovado) {
        const est = Number(it.qty_do_estoque || 0);
        const buy = Number(it.qty_a_comprar  || 0);
        if (est > 0 && buy > 0) {
          badge = ` <span title="Atendido pelo estoque + compra" style="background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;">📦${est} · 🛒${buy}</span>`;
        } else if (est > 0) {
          badge = ` <span title="100% atendido pelo estoque" style="background:#dcfce7;color:#166534;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;">📦${est}</span>`;
        } else if (buy > 0) {
          badge = ` <span title="Comprado integralmente" style="background:#dbeafe;color:#1e40af;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;">🛒${buy}</span>`;
        }
      } else if (it.insumo_id && _almEstoqueMap[it.insumo_id] > 0) {
        const est = _almEstoqueMap[it.insumo_id];
        badge = ` <span title="Disponível no estoque — será deduzido na aprovação" style="background:#dcfce7;color:#166534;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;">📦${est}</span>`;
      }
      return `<span style="display:inline-block;background:#f0ece6;border-radius:4px;padding:2px 8px;font-size:11px;margin:2px;">${it.nome} ×${it.qty_solicitado}${badge}</span>`;
    }).join('');
    return `<div class="alm-req-row ${r.status}">
      <div style="width:10px;align-self:stretch;border-radius:4px;background:${turmaColor};flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span class="alm-status ${r.status}">${statusLbl}</span>
          <span style="font-weight:600;font-size:13px;">${profNome}</span>
          <span style="font-size:12px;color:var(--muted);">${turmaNome} · ${almMesBR(r.mes)} · ${data}</span>
          <strong style="margin-left:auto;">${almFmtBRL(r.total)}</strong>
        </div>
        <div style="margin-top:4px;">${itensHtml}</div>
        ${r.observacao ? `<div style="font-size:12px;color:var(--muted);margin-top:4px;">📝 ${r.observacao}</div>` : ''}
        ${r.nota_gerente ? `<div style="font-size:12px;color:var(--muted);margin-top:4px;">💬 ${r.nota_gerente}</div>` : ''}
      </div>
      ${showBtn ? `<button onclick="almAbrirReview('${r.id}')" class="btn-create" style="width:auto;padding:8px 18px;font-size:12px;white-space:nowrap;flex-shrink:0;background:#1a6bb5;">✏️ Editar / Aprovar</button>` : ''}
    </div>`;
  }

  async function almAbrirReview(id) {
    almReviewId = id;
    almSelectedPrices = {};
    document.getElementById('almReviewNota').value = '';
    document.getElementById('almReviewErr').classList.remove('show');
    document.getElementById('almAprovInfo').style.display = 'none';
    const [d, dCat] = await Promise.all([
      callDiplomas({ action: 'alm_pendentes' }),
      callDiplomas({ action: 'alm_insumos_list' }),
    ]);
    const req = (d.data||[]).find(r => r.id === id);
    if (!req) { showToast('Requisição não encontrada.', 'warning'); return; }
    almReviewItens = req.itens || [];
    // Map insumo_id → estoque_qty pra mostrar saldo na revisão
    const estoqueMap = {};
    (dCat.data || []).forEach(i => { estoqueMap[i.id] = Number(i.estoque_qty || 0); });
    almReviewItens.forEach(it => {
      it._estoque_disponivel = it.insumo_id ? (estoqueMap[it.insumo_id] || 0) : 0;
    });

    // Checa status do ML para alertar a coordenadora se estiver desconectado
    callDiplomas({ action: 'ml_status' }).then(s => {
      const banner = document.getElementById('almReviewMlBanner');
      if (banner) banner.style.display = s.connected ? 'none' : 'flex';
    });

    document.getElementById('almReviewContent').innerHTML = `
      <div id="almReviewMlBanner" style="display:none;background:#fef2f2;border:1.5px solid #fecaca;color:#991b1b;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;align-items:center;gap:10px;">
        <span style="font-size:16px;">⚠️</span>
        <div style="flex:1;">
          <strong>Mercado Livre desconectado.</strong> Os preços do ML não estão sendo buscados — só Zoom/Shopee/Reval. Peça pro gerente clicar em <strong>🛒 ML</strong> em <em>Almoxarifado → Configuração → Catálogo</em> para reautorizar.
        </div>
      </div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:12px;">
        <strong>${req.professoras?.nome||'—'}</strong> · ${req.series?.nome||'—'} · ${almMesBR(req.mes)} · ${new Date(req.criado_em).toLocaleDateString('pt-BR')}
      </div>
      ${almReviewItens.map((it, i) => {
        const isEmp = it.tipo === 'emprestimo';
        return `
        <div class="alm-insumo-row" id="alm-row-${i}" data-rejeitado="0" data-tipo="${isEmp ? 'emprestimo' : 'comprar'}" style="flex-direction:column;align-items:stretch;gap:8px;${isEmp ? 'background:#fefce8;border-left:3px solid #ca8a04;' : ''}">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div style="flex:1;min-width:160px;">
              <div style="font-weight:600;" class="alm-item-titulo">
                ${it.nome}
                ${isEmp ? `<span style="display:inline-block;background:#fef9c3;color:#854d0e;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;margin-left:6px;vertical-align:middle;">🏫 Empréstimo</span>` : ''}
              </div>
              <div style="font-size:11px;color:var(--muted);">
                ${isEmp ? `Onde está: <strong style="color:#854d0e;">${(it.localizacao||'—')}</strong>` : `${almFmtBRL(it.preco_unit)} / ${it.unidade}`}
              </div>
            </div>
            <div style="font-size:12px;color:var(--muted);flex-shrink:0;">Pedido: <strong>${it.qty_solicitado}</strong></div>
            ${it._estoque_disponivel > 0 && !isEmp ? `
              <div id="alm-est-${i}" style="font-size:11px;flex-shrink:0;background:#dcfce7;color:#166534;padding:3px 8px;border-radius:10px;font-weight:600;" title="Disponível no estoque/inventário — será deduzido em vez de comprar">
                📦 ${it._estoque_disponivel} em estoque
              </div>` : ''}
            <div style="font-size:12px;flex-shrink:0;display:flex;align-items:center;gap:4px;">Aprovar:
              <input type="number" class="alm-item-qty" data-idx="${i}" data-id="${it.insumo_id || ''}" data-original="${it.qty_solicitado}" data-estoque="${it._estoque_disponivel || 0}" value="${it.qty_solicitado}" min="0" step="0.5" oninput="almReviewAtualizarBalanco(${i})" style="width:64px;">
            </div>
            <div id="alm-balanco-${i}" style="font-size:11px;flex-shrink:0;color:var(--muted);"></div>
            <button type="button" id="alm-rej-btn-${i}" onclick="almToggleRejeitarItem(${i})"
              style="padding:5px 10px;background:none;border:1.5px solid #fecaca;color:#b91c1c;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;flex-shrink:0;"
              title="Rejeitar este item (mantém os demais)">❌ Rejeitar</button>
          </div>
          <div id="alm-price-${i}" class="alm-price-results" style="display:block;">
            ${isEmp
              ? `<div style="font-size:11px;color:#854d0e;background:#fef9c3;border-radius:6px;padding:6px 10px;">🏫 Empréstimo — sem cotação. Aprovar autoriza a professora a retirar do local indicado.</div>`
              : `<div class="alm-price-skeleton">⏳ Buscando melhor preço em Mercado Livre, Shopee e Amazon…</div>`}
          </div>
        </div>`;
      }).join('')}
      <div style="text-align:right;font-weight:600;font-size:14px;margin-top:10px;">Total pedido: ${almFmtBRL(req.total)}</div>
      ${req.observacao ? `<div style="font-size:12px;color:var(--muted);margin-top:6px;">📝 ${req.observacao}</div>` : ''}`;

    document.getElementById('almReviewModal').style.display = 'block';

    // Inicializa balanço estoque/compra por linha
    almReviewItens.forEach((_, i) => almReviewAtualizarBalanco(i));

    // Buscar preços em paralelo sem bloquear o modal
    almReviewItens.forEach((it, i) => almFetchPrecos(it.nome, it.unidade, i, it));
  }

  function almReviewAtualizarBalanco(i) {
    const inp = document.querySelector(`#almReviewContent .alm-item-qty[data-idx="${i}"]`);
    const target = document.getElementById(`alm-balanco-${i}`);
    if (!inp || !target) return;
    const qty = parseFloat(inp.value) || 0;
    const estoque = parseFloat(inp.dataset.estoque) || 0;
    if (qty <= 0 || estoque <= 0) { target.innerHTML = ''; return; }
    const doEstoque = Math.min(estoque, qty);
    const aComprar  = Math.max(0, qty - estoque);
    if (aComprar === 0) {
      target.innerHTML = `<span style="color:#166534;font-weight:600;">✅ ${doEstoque} do estoque · 0 a comprar</span>`;
    } else {
      target.innerHTML = `<span style="color:#92400e;font-weight:600;">📦 ${doEstoque} do estoque · 🛒 ${aComprar} a comprar</span>`;
    }
  }

  var platIcon  = { 'Zoom': '🔎', 'Mercado Livre': '🛒', 'Shopee': '🧡', 'Amazon': '📦', 'Reval': '🏪' };
  var matchColor = m => m >= 80 ? '#2d7a2d' : m >= 50 ? '#b07d00' : '#c0392b';
  var matchLabel = m => m >= 80 ? 'Alta precisão' : m >= 50 ? 'Precisão média' : 'Baixa precisão';

  // Sempre vai pra página do produto (permalink). A "magic cart link" do ML
  // (/checkout/buy?item.id=...) é não-documentada e quebra com 'RequestHeaderSectionTooLarge'
  // em navegadores que têm muitos cookies acumulados no mercadolivre.com.br.
  // Página do produto tem botão "Comprar agora" e funciona universalmente.
  function almCartUrl(r, _qty) {
    return r.url_produto;
  }
  function almCartLabel(r) {
    if (r.tipo === 'busca') return '🔍 Buscar';
    if (r.plataforma === 'Mercado Livre') return '🛒 Comprar no ML';
    return '🔗 Ver produto';
  }

  function almRenderPriceOption(r, idx, rIdx, qty, selected) {
    const isBusca = r.tipo === 'busca';
    const cartUrl = almCartUrl(r, qty || 1);
    const radioName = 'almPriceSel_' + idx;
    const badges = [];
    if (r.pack_label)   badges.push(`<span style="background:#fde68a;color:#78350f;padding:1px 6px;border-radius:10px;font-size:9px;font-weight:700;" title="Pacote com múltiplas unidades">📦 ${r.pack_label}</span>`);
    if (r.frete_gratis) badges.push('<span style="background:#dcfce7;color:#166534;padding:1px 6px;border-radius:10px;font-size:9px;font-weight:700;">🚚 Grátis</span>');
    if (r.full)         badges.push('<span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:10px;font-size:9px;font-weight:700;">⚡ FULL</span>');
    if (r.condicao === 'usado') badges.push('<span style="background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:10px;font-size:9px;font-weight:700;">USADO</span>');
    const badgesHtml = badges.length ? ` · ${badges.join(' ')}` : '';
    const unitHtml = r.preco_unit_norm_fmt ? `<div style="font-size:10px;color:#1a6bb5;font-weight:700;">${r.preco_unit_norm_fmt}</div>` : '';
    return `<label style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;border:1.5px solid ${selected?'#2d7a2d':'transparent'};background:${selected?'#f0fdf4':'transparent'};transition:all .15s;margin-bottom:4px;" onclick="almSelectPrice(${idx},${rIdx})">
      <input type="radio" name="${radioName}" ${selected?'checked':''} style="accent-color:#2d7a2d;flex-shrink:0;">
      <span style="font-size:14px;flex-shrink:0;">${platIcon[r.plataforma]||'🔗'}</span>
      <div style="flex:1;min-width:0;overflow:hidden;">
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(r.nome||'').replace(/"/g,'&quot;')}">${r.nome||r.plataforma}</div>
        <div style="font-size:10px;color:var(--muted);">${r.plataforma}${!isBusca && r.match > 0 ? ` · <span style="color:${matchColor(r.match)};font-weight:700;">${r.match}%</span>` : ''}${badgesHtml}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:14px;font-weight:700;white-space:nowrap;color:${r.preco!=null?'#2d7a2d':'var(--muted)'};">${r.preco_fmt}</div>
        ${unitHtml}
      </div>
      <a href="${cartUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()"
        style="background:#1a6bb5;color:#fff;text-decoration:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;white-space:nowrap;font-family:'DM Sans',sans-serif;flex-shrink:0;">
        ${almCartLabel(r)}
      </a>
    </label>`;
  }

  var almAllPrices = {}; // idx -> array of results

  async function almFetchPrecos(nome, unidade, idx, itemData) {
    const el = document.getElementById('alm-price-' + idx);
    if (!el) return;
    const d = await callDiplomas({ action: 'alm_buscar_precos', nome, unidade, descricao: itemData?.descricao || '' });
    if (!document.getElementById('alm-price-' + idx)) return;
    if (d.error || !d.data || !d.data.length) {
      el.innerHTML = `<div class="alm-price-skeleton" style="color:#c0392b;">Nao foi possivel buscar precos.</div>`;
      return;
    }

    almAllPrices[idx] = { results: d.data, itemData, nome };
    almSelectPrice(idx, 0); // seleciona o mais barato por padrao
  }

  function almSelectPrice(idx, rIdx) {
    const info = almAllPrices[idx];
    if (!info) return;
    const all = info.results;
    const selected = all[rIdx];
    const qtyInput = document.querySelector(`#almReviewContent .alm-item-qty[data-idx="${idx}"]`);
    const qty = qtyInput ? parseFloat(qtyInput.value) || 1 : 1;

    // Salva selecao
    almSelectedPrices[idx] = {
      insumo_nome:  info.itemData?.nome || info.nome,
      insumo_id:    info.itemData?.insumo_id || null,
      qty,
      plataforma:   selected.plataforma,
      produto_nome: selected.nome,
      preco_unit:   selected.preco,
      match_pct:    selected.match,
      url_produto:  selected.url_produto,
      url_carrinho: almCartUrl(selected, qty),
    };

    // Mostra info quando todas buscas terminaram
    if (Object.keys(almSelectedPrices).length === almReviewItens.length)
      document.getElementById('almAprovInfo').style.display = 'block';

    // Renderiza todas as opcoes com radio
    const el = document.getElementById('alm-price-' + idx);
    if (!el) return;
    el.innerHTML = `
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px;">Escolha o fornecedor:</div>
      ${all.map((r, i) => almRenderPriceOption(r, idx, i, qty, i === rIdx)).join('')}
    `;
  }


  function almFecharReview() {
    document.getElementById('almReviewModal').style.display = 'none';
    almReviewId = null;
    almSelectedPrices = {};
    almReviewItens = [];
  }

  // Rejeita ou restaura um item individual da requisição. Item rejeitado
  // tem qty_aprovado=0 (não vai pro estoque nem pra compra) e fica marcado
  // visualmente. Outros itens da mesma requisição seguem o fluxo normal.
  function almToggleRejeitarItem(idx) {
    const row = document.getElementById('alm-row-' + idx);
    const inp = document.querySelector(`#almReviewContent .alm-item-qty[data-idx="${idx}"]`);
    const btn = document.getElementById('alm-rej-btn-' + idx);
    const titulo = row?.querySelector('.alm-item-titulo');
    const precos = document.getElementById('alm-price-' + idx);
    if (!row || !inp || !btn) return;
    const isRej = row.dataset.rejeitado === '1';
    if (isRej) {
      row.dataset.rejeitado = '0';
      inp.value = inp.dataset.original || '1';
      inp.disabled = false;
      row.style.background = '';
      if (titulo) titulo.style.textDecoration = '';
      if (precos) precos.style.opacity = '1';
      btn.textContent = '❌ Rejeitar';
      btn.style.borderColor = '#fecaca';
      btn.style.color = '#b91c1c';
      btn.style.background = 'none';
    } else {
      row.dataset.rejeitado = '1';
      inp.dataset.original = inp.value;
      inp.value = 0;
      inp.disabled = true;
      row.style.background = '#fef2f2';
      if (titulo) titulo.style.textDecoration = 'line-through';
      if (precos) precos.style.opacity = '0.45';
      btn.textContent = '↩️ Restaurar';
      btn.style.borderColor = '#86efac';
      btn.style.color = '#166534';
      btn.style.background = '#f0fdf4';
      delete almSelectedPrices[idx]; // não tenta encaminhar compra de item rejeitado
    }
  }

  async function almAprovar() {
    if (!almReviewId) return;
    const nota = document.getElementById('almReviewNota').value.trim();
    const errEl = document.getElementById('almReviewErr');
    errEl.classList.remove('show');

    // Collect qty overrides per item — qty_aprovado=0 e flag rejeitado=true
    // pra itens marcados (backend grava no JSON e usa pra mensagem da prof).
    const inputs = document.querySelectorAll('#almReviewContent .alm-item-qty');
    const itens_aprovados = Array.from(inputs).map(inp => {
      const idx = parseInt(inp.dataset.idx);
      const row = document.getElementById('alm-row-' + idx);
      const rejeitado = row?.dataset.rejeitado === '1';
      return {
        insumo_id: inp.dataset.id,
        qty_aprovado: rejeitado ? 0 : (parseFloat(inp.value) || 0),
        rejeitado,
      };
    });

    // Aborta se TODOS foram rejeitados — nesse caso usar o botão "Rejeitar"
    if (itens_aprovados.every(x => x.rejeitado || x.qty_aprovado <= 0)) {
      errEl.textContent = 'Todos os itens estão rejeitados. Use o botão "Rejeitar" pra negar a requisição inteira.';
      errEl.classList.add('show'); return;
    }

    // Sync qtys into selectedPrices (manager may have changed qty after prices loaded)
    inputs.forEach(inp => {
      const i = parseInt(inp.dataset.idx);
      if (almSelectedPrices[i]) {
        const qty = parseFloat(inp.value) || 1;
        almSelectedPrices[i].qty = qty;
        almSelectedPrices[i].url_carrinho = almCartUrl(
          { plataforma: almSelectedPrices[i].plataforma, url_carrinho: almSelectedPrices[i].url_carrinho, url_produto: almSelectedPrices[i].url_produto },
          qty
        );
      }
    });

    // 1. Approve the requisition
    const dAprov = await callDiplomas({ action: 'alm_aprovar', id: almReviewId, nota_gerente: nota, itens_aprovados });
    if (dAprov.error) { errEl.textContent = dAprov.error; errEl.classList.add('show'); return; }

    // 2. Encaminhar compras (for items where price was found) — backend filtra
    // qty já atendida pelo estoque (qty_a_comprar = 0 → não vira linha de compra)
    const itensCompra = Object.values(almSelectedPrices).filter(it => it.plataforma);
    let dEnc = { encaminhados: 0, atendidos_estoque: 0 };
    if (itensCompra.length) {
      dEnc = await callDiplomas({ action: 'alm_encaminhar_compra', requisicao_id: almReviewId, itens: itensCompra });
    }

    // Resumo: estoque atendido + compras encaminhadas
    const partes = [];
    if ((dAprov.total_do_estoque || 0) > 0) partes.push(`📦 ${dAprov.total_do_estoque} do estoque`);
    if ((dEnc.encaminhados || 0) > 0) partes.push(`🛒 ${dEnc.encaminhados} encaminhado${dEnc.encaminhados>1?'s':''} pra compra`);
    if (dAprov.itens_atendidos_totalmente > 0) partes.push(`${dAprov.itens_atendidos_totalmente} 100% pelo estoque`);
    showToast(`✅ Requisição aprovada${partes.length?' · '+partes.join(' · '):''}`, 'success');

    almFecharReview();
    almLoadPendentes();
    almLoadDashboard();
  }

  async function almRejeitar() {
    if (!almReviewId) return;
    const nota = document.getElementById('almReviewNota').value.trim();
    if (!nota && !await _lumiedConfirm('Rejeitar sem nota explicativa?')) return;
    const errEl = document.getElementById('almReviewErr');
    errEl.classList.remove('show');
    const d = await callDiplomas({ action: 'alm_rejeitar', id: almReviewId, nota_gerente: nota });
    if (d.error) { errEl.textContent = d.error; errEl.classList.add('show'); return; }
    almFecharReview();
    almLoadPendentes();
    almLoadDashboard();
  }

  // ── Aba Compras ───────────────────────────────────────────
  var almComprasItems = [];
  var almComprasModo = 'compilado'; // 'compilado' | 'detalhado'
  var debouncedAlmComprasSearch = debounce(() => almRenderCompras());

  function almSetModoCompras(modo) {
    almComprasModo = modo;
    const btnC = document.getElementById('almComprasModoCompilado');
    const btnD = document.getElementById('almComprasModoDetalhado');
    const help = document.getElementById('almComprasHelp');
    const filtros = document.getElementById('almComprasFiltrosDetalhado');
    const compiladoBox = document.getElementById('almComprasCompiladoBox');
    const lista = document.getElementById('almComprasList');
    const ativo = 'background:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 1px 2px rgba(0,0,0,.05);padding:6px 16px;color:#000';
    const inativo = 'background:none;border:none;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer;color:var(--muted);font-family:inherit;padding:6px 16px;';
    if (modo === 'compilado') {
      btnC.style.cssText = ativo; btnD.style.cssText = inativo;
      filtros.style.display = 'none';
      compiladoBox.style.display = '';
      if (lista) lista.style.display = 'none';
      help.textContent = 'Itens iguais entre turmas agregados em um único pedido — pesquisa + compra de cada item uma vez só.';
      almLoadCompiladoCompras();
    } else {
      btnD.style.cssText = ativo; btnC.style.cssText = inativo;
      filtros.style.display = 'flex';
      compiladoBox.style.display = 'none';
      if (lista) lista.style.display = '';
      help.textContent = 'Cada linha é um item de uma requisição (turma específica). Use checkboxes pra marcar comprado.';
      almLoadCompras();
    }
  }

  var almComprasCompiladoStatus = 'pendente';
  var _almGruposCache = {};

  async function almLoadCompiladoCompras() {
    const box = document.getElementById('almComprasCompiladoBox');
    box.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);">⏳ Compilando…</div>';

    // Carrega contadores de cada status em paralelo
    const [pend, comp, ent] = await Promise.all([
      callDiplomas({ action: 'alm_compras_compilado', status_filtro: 'pendente' }),
      callDiplomas({ action: 'alm_compras_compilado', status_filtro: 'comprado' }),
      callDiplomas({ action: 'alm_compras_compilado', status_filtro: 'entregue' }),
    ]);
    const escolha = almComprasCompiladoStatus === 'pendente' ? pend : almComprasCompiladoStatus === 'comprado' ? comp : ent;
    const grupos = escolha.data || [];
    _almGruposCache = Object.fromEntries(grupos.map(g => [g.chave, g]));

    const platIcons = { 'Mercado Livre':'🛒', 'Amazon':'📦', 'Shopee':'🛍️', 'Reval':'🏬' };
    const fmt = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // ── KPIs hero ──
    const turmasUnicas = new Set();
    grupos.forEach(g => g.turmas.forEach(t => turmasUnicas.add(t)));
    const hero = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px;">
      <div style="background:linear-gradient(135deg,#fef3c7,#fff);border:1px solid #fcd34d;border-radius:12px;padding:12px 16px;">
        <div style="font-size:10px;text-transform:uppercase;color:#92400e;font-weight:700;letter-spacing:.5px;">Itens únicos</div>
        <div style="font-size:24px;font-weight:800;color:#78350f;font-family:'Lora',serif;">${escolha.total_grupos || 0}</div>
        <div style="font-size:10px;color:#92400e;">${escolha.total_linhas || 0} pedido(s) de turma</div>
      </div>
      <div style="background:linear-gradient(135deg,#dbeafe,#fff);border:1px solid #93c5fd;border-radius:12px;padding:12px 16px;">
        <div style="font-size:10px;text-transform:uppercase;color:#1e40af;font-weight:700;letter-spacing:.5px;">Turmas atendidas</div>
        <div style="font-size:24px;font-weight:800;color:#1e3a8a;font-family:'Lora',serif;">${turmasUnicas.size}</div>
        <div style="font-size:10px;color:#1e40af;">${grupos.reduce((s,g)=>s+g.qty_total,0)} unidades</div>
      </div>
      <div style="background:linear-gradient(135deg,#dcfce7,#fff);border:1px solid #86efac;border-radius:12px;padding:12px 16px;">
        <div style="font-size:10px;text-transform:uppercase;color:#166534;font-weight:700;letter-spacing:.5px;">Valor estimado</div>
        <div style="font-size:20px;font-weight:800;color:#14532d;font-family:'Lora',serif;">${fmt(escolha.valor_estimado || 0)}</div>
        <div style="font-size:10px;color:#166534;">soma das sugestões</div>
      </div>
    </div>`;

    // ── Filtros por status ──
    const chip = (key, label, count) => `<button onclick="almComprasCompiladoStatus='${key}';almLoadCompiladoCompras()" style="padding:8px 16px;background:${almComprasCompiladoStatus===key?'#1c1712':'#fff'};color:${almComprasCompiladoStatus===key?'#fff':'var(--text)'};border:1px solid ${almComprasCompiladoStatus===key?'#1c1712':'var(--border)'};border-radius:100px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">
      ${label} <span style="display:inline-block;background:${almComprasCompiladoStatus===key?'rgba(255,255,255,.2)':'#f0ece6'};border-radius:100px;padding:1px 7px;font-size:10px;margin-left:4px;">${count}</span>
    </button>`;
    const filtros = `<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">
      ${chip('pendente', '⏳ A comprar', (pend.data||[]).length)}
      ${chip('comprado', '📦 Comprado · receber', (comp.data||[]).length)}
      ${chip('entregue', '✅ Entregue', (ent.data||[]).length)}
    </div>`;

    // Botões de export + auditoria de referência
    const exportBtns = `<div style="display:flex;gap:6px;margin-bottom:12px;justify-content:flex-end;flex-wrap:wrap;">
      <button onclick="almAuditarRefSuspeita()" title="Detecta insumos com preço de referência cadastrado errado (provavelmente da embalagem inteira)" style="padding:6px 14px;background:#fff;border:1px solid #fcd34d;color:#92400e;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">🔍 Auditar referências</button>
      <button onclick="almExportCompilado('xlsx')" style="padding:6px 14px;background:#0b7a4b;color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">📊 Excel</button>
      <button onclick="almExportCompilado('pdf')" style="padding:6px 14px;background:#b5591a;color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">📄 PDF</button>
    </div>`;

    if (!grupos.length) { box.innerHTML = hero + filtros + exportBtns + '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:36px;text-align:center;color:var(--muted);">✨ Nada por aqui.</div>'; return; }

    // ── Linhas compactas (tabela densa) ──
    const linhasHtml = grupos.map(g => {
      const linkBusca = g.url_carrinho || g.url_produto;
      const buscarNome = encodeURIComponent(g.nome);
      const turmasChips = g.filhas.map(f => `<span title="${esc(f.professora)}" style="background:rgba(200,16,46,.08);color:#C8102E;border-radius:100px;padding:1px 7px;font-size:10px;font-weight:600;white-space:nowrap;">${esc(f.turma)}×${f.qty}</span>`).join(' ');

      let acoesCol = '';
      if (almComprasCompiladoStatus === 'pendente') {
        acoesCol = `${linkBusca ? `<a href="${esc(linkBusca)}" target="_blank" rel="noopener" title="${g.url_carrinho?'Abrir carrinho':'Ver produto'}" style="background:#1a6bb5;color:#fff;text-decoration:none;border-radius:6px;padding:4px 8px;font-size:11px;font-family:'DM Sans',sans-serif;">${platIcons[g.plataforma_sugerida]||'🛒'}</a>` : ''}
          <a href="https://www.mercadolivre.com.br/jms/search?as_word=${buscarNome}" target="_blank" rel="noopener" title="Buscar no ML" style="background:#fff;border:1px solid var(--border);color:var(--text);text-decoration:none;border-radius:6px;padding:4px 8px;font-size:11px;font-family:'DM Sans',sans-serif;">🔍</a>
          <button onclick='almMarcarGrupoComprado(${JSON.stringify(g.ids)}, ${JSON.stringify(g.nome)})' title="Marcar grupo comprado" style="background:#2d7a3a;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">✅ Comprado</button>`;
      } else if (almComprasCompiladoStatus === 'comprado') {
        acoesCol = `<button onclick='almAbrirDistribuir(${JSON.stringify(g.chave)})' style="background:#0b7a4b;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">📥 Distribuir</button>`;
      } else {
        acoesCol = `<span style="font-size:11px;color:#15803d;">✅</span>`;
      }

      return `<div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:5px;display:grid;grid-template-columns:48px 1fr auto auto;gap:10px;align-items:center;">
        <div style="background:#f0ece6;border-radius:7px;padding:4px 0;text-align:center;">
          <div style="font-size:18px;font-weight:800;line-height:1;color:var(--text);font-family:'Lora',serif;">${g.qty_total}</div>
        </div>
        <div style="min-width:0;">
          <div style="font-weight:600;font-size:13px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(g.nome)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;">${turmasChips}</div>
          ${g.produto_nome_sugestao ? `<div style="font-size:10px;color:var(--muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">💡 ${esc(g.produto_nome_sugestao)}${g.match_pct_max ? ` <span style="color:${matchColor(g.match_pct_max)};font-weight:600;">(${g.match_pct_max}%)</span>` : ''}</div>` : ''}
        </div>
        <div style="text-align:right;white-space:nowrap;">
          ${g.preco_unit_medio != null
            ? `<div style="font-size:10px;color:var(--muted);">${fmt(g.preco_unit_medio)}/un.${g.preco_origem === 'referencia' ? ` <span title="preço de referência cadastrado — clique pra editar" style="font-size:9px;cursor:pointer;" onclick='almAbrirSetRef(${JSON.stringify(g.chave)})'>📌</span>` : g.preco_origem === 'cadastro_ref_suspeita' ? ` <span title="referência cadastrada parece errada — usando preço do cadastro ÷ embalagem. Clique pra corrigir." style="font-size:9px;cursor:pointer;color:#b45309;" onclick='almAbrirSetRef(${JSON.stringify(g.chave)})'>⚠️📋</span>` : g.preco_origem === 'cadastro' ? ` <span title="preço do cadastro do insumo — clique pra cadastrar referência" style="font-size:9px;cursor:pointer;" onclick='almAbrirSetRef(${JSON.stringify(g.chave)})'>📋</span>` : ''}</div><div style="font-size:12px;font-weight:700;">${fmt(g.preco_total_estimado)}</div>`
            : `<button onclick='almAbrirSetRef(${JSON.stringify(g.chave)})' title="${g.preco_baixa_confianca ? 'Busca retornou produto incerto. Clique pra cadastrar preço de referência.' : 'Cadastre preço de referência'}" style="background:#fef3c7;border:1px solid #fcd34d;color:#92400e;border-radius:6px;padding:4px 9px;font-size:10px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap;">⚠️ Cadastrar preço</button>`}
        </div>
        <div style="display:flex;gap:4px;align-items:center;">${acoesCol}</div>
      </div>`;
    }).join('');

    box.innerHTML = hero + filtros + exportBtns + linhasHtml;
  }

  function almExportCompilado(formato) {
    const action = formato === 'xlsx' ? 'alm_compras_compilado_xlsx' : 'alm_compras_compilado_pdf';
    almBaixarPdf(action, 'status_filtro=' + encodeURIComponent(almComprasCompiladoStatus));
  }

  // Detecta e corrige insumos com preco_referencia cadastrado errado
  // (geralmente preço da embalagem inteira em vez da unidade de consumo).
  async function almAuditarRefSuspeita() {
    const d = await callDiplomas({ action: 'alm_insumos_referencia_suspeita' });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    if (!d.total) { showToast('✅ Nenhuma referência suspeita.', 'success'); return; }
    const fmt = (v) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
    const lista = d.data.map((i, idx) => `${idx+1}. <strong>${esc(i.nome)}</strong> — atual: ${fmt(i.preco_referencia_atual)}/un · sugerido: ${fmt(i.preco_referencia_sugerido)}/un (preço cadastro ÷ ${i.qtd_por_embalagem})`).join('<br>');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1100;padding:20px;overflow-y:auto;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:680px;margin:30px auto;padding:24px;">
      <h3 style="font-family:'Lora',serif;font-size:17px;margin-bottom:10px;">🔍 ${d.total} referência(s) suspeita(s)</h3>
      <p style="font-size:12px;color:var(--muted);margin-bottom:14px;">Os preços abaixo foram cadastrados como preço da unidade mas parecem ser o preço da <strong>embalagem inteira</strong> (≥5× maior que o preço/qtd_por_embalagem). Você pode zerar todas pra que o sistema use o preço calculado automaticamente.</p>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;font-size:11px;max-height:340px;overflow-y:auto;line-height:1.7;">${lista}</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
        <button id="almAuditCancel" style="padding:8px 16px;background:#f0ece6;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;">Fechar</button>
        <button id="almAuditFix" class="btn-create" style="width:auto;padding:8px 18px;background:#b5591a;">🧹 Limpar todas referências suspeitas</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#almAuditCancel').onclick = () => overlay.remove();
    overlay.querySelector('#almAuditFix').onclick = async () => {
      if (!await _lumiedConfirm(`Limpar ${d.total} preço(s) de referência suspeitos? O sistema voltará a calcular preço pela divisão preço cadastrado ÷ embalagem.`)) return;
      const r = await callDiplomas({ action: 'alm_insumos_corrigir_referencia_suspeita' });
      if (r.error) { showToast('Erro: ' + r.error, 'error'); return; }
      overlay.remove();
      showToast(`✅ ${r.corrigidos} referência(s) limpa(s).`, 'success');
      almLoadCompiladoCompras();
    };
  }

  // Abre prompt pra cadastrar/editar preco_referencia. Se item não está
  // catalogado, cria o insumo automaticamente antes de setar a referência.
  async function almAbrirSetRef(chave) {
    const g = _almGruposCache[chave];
    if (!g) return;
    const valorAtual = g.preco_origem === 'referencia' && g.preco_unit_medio != null
      ? g.preco_unit_medio.toFixed(2).replace('.', ',') : '';
    const txt = window.prompt(
      `Preço de referência por unidade de "${g.nome}":\n\n` +
      `Use o preço REAL por unidade de consumo (ex: 1 folha, 1 frasco).\n` +
      `Use vírgula ou ponto como separador decimal.`,
      valorAtual
    );
    if (txt == null || txt === '') return;
    const preco = parseFloat(String(txt).replace(',', '.').replace(/[^\d.]/g, ''));
    if (Number.isNaN(preco) || preco < 0) { showToast('Preço inválido.', 'error'); return; }

    let insumoId = g.insumo_id;
    // Se item livre (sem cataloged), cria o insumo agora
    if (!insumoId) {
      const dCria = await callDiplomas({
        action: 'alm_insumo_save',
        nome: g.nome,
        unidade: 'unidade',
        estoque_qty: 0,
        preco: 0,
        categoria: null,
      });
      if (dCria.error) { showToast('Erro ao criar insumo: ' + dCria.error, 'error'); return; }
      insumoId = dCria.id;
    }
    const dRef = await callDiplomas({
      action: 'alm_insumo_set_referencia',
      id: insumoId,
      preco_referencia: preco,
      referencia_fonte: 'manual',
    });
    if (dRef.error) { showToast('Erro: ' + dRef.error, 'error'); return; }
    showToast(`✅ Preço de referência cadastrado: R$ ${preco.toFixed(2).replace('.', ',')}/un.`, 'success');
    almLoadCompiladoCompras();
  }

  async function almMarcarGrupoComprado(ids, nome) {
    if (!await _lumiedConfirm(`Marcar todas as ${ids.length} reservas de "${nome}" como compradas?`)) return;
    const d = await callDiplomas({ action: 'alm_marcar_comprado', ids });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast(`✅ ${d.marcados ?? ids.length} item(ns) marcado(s) como comprado(s).`, 'success');
    almLoadCompiladoCompras();
  }

  // ── Distribuição ao receber ──────────────────
  function almAbrirDistribuir(chave) {
    const g = _almGruposCache[chave];
    if (!g) return;
    const overlay = document.createElement('div');
    overlay.id = 'almDistribuirOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1100;padding:20px;overflow-y:auto;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:640px;margin:30px auto;padding:24px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="font-family:'Lora',serif;font-size:17px;">📥 Receber e distribuir: ${esc(g.nome)}</h3>
        <button onclick="document.getElementById('almDistribuirOverlay').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);">×</button>
      </div>
      <div style="background:#f9f7f4;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--muted);">
        <strong style="color:var(--text);">${g.qty_total}</strong> unidades pedidas no total. Confirme o que cada turma vai receber. Se chegou mais que o pedido, o excedente entra no estoque.
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="background:#f9f7f4;">
          <th style="padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted);">Turma / Professora</th>
          <th style="padding:8px 10px;text-align:right;font-size:10px;text-transform:uppercase;color:var(--muted);">Pediu</th>
          <th style="padding:8px 10px;text-align:right;font-size:10px;text-transform:uppercase;color:var(--muted);">Entregar</th>
        </tr></thead>
        <tbody>${g.filhas.map((f, idx) => `
          <tr style="border-bottom:1px solid #f0ece6;">
            <td style="padding:8px 10px;">${esc(f.turma)} <span style="font-size:11px;color:var(--muted);">· ${esc(f.professora)}</span></td>
            <td style="padding:8px 10px;text-align:right;color:var(--muted);">${f.qty}</td>
            <td style="padding:8px 10px;text-align:right;">
              <input type="number" class="alm-dist-qty" data-req="${f.requisicao_id}" data-compra="${f.compra_id}" data-pedido="${f.qty}" value="${f.qty}" min="0" step="0.5" oninput="almDistribuirRecalc()" style="width:80px;padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;text-align:right;font-size:13px;font-family:'DM Sans',sans-serif;">
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div id="almDistribuirResumo" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-top:14px;font-size:12px;color:#166534;"></div>
      <div class="f-alert error" id="almDistribuirErr" style="display:none;margin-top:8px;"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
        <button onclick="document.getElementById('almDistribuirOverlay').remove()" style="padding:8px 16px;background:#f0ece6;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;">Cancelar</button>
        <button onclick='almConfirmarDistribuir(${JSON.stringify(chave)})' class="btn-create" style="width:auto;padding:8px 18px;background:#0b7a4b;">✅ Confirmar distribuição</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    almDistribuirRecalc();
  }
  function almDistribuirRecalc() {
    const inputs = document.querySelectorAll('.alm-dist-qty');
    let total = 0, totalPedido = 0;
    inputs.forEach(i => { total += parseFloat(i.value) || 0; totalPedido += parseFloat(i.dataset.pedido) || 0; });
    const resumo = document.getElementById('almDistribuirResumo');
    const excedente = total - totalPedido;
    resumo.innerHTML = `Distribuído: <strong>${total}</strong> · Pedido: ${totalPedido} ${excedente > 0 ? `· Excedente pro estoque: <strong style="color:#d97706;">+${excedente}</strong>` : excedente < 0 ? `· Faltando: <strong style="color:#b91c1c;">${Math.abs(excedente)}</strong>` : ''}`;
  }
  async function almConfirmarDistribuir(chave) {
    const g = _almGruposCache[chave];
    if (!g) return;
    const inputs = document.querySelectorAll('.alm-dist-qty');
    const distribuicao = [];
    let totalDist = 0;
    inputs.forEach(i => {
      const qty = parseFloat(i.value) || 0;
      totalDist += qty;
      if (qty > 0) distribuicao.push({
        compra_id: i.dataset.compra,
        requisicao_id: i.dataset.req,
        insumo_id: g.insumo_id || null,
        qty_entregue: qty,
      });
    });
    const errEl = document.getElementById('almDistribuirErr');
    errEl.style.display = 'none';
    if (!distribuicao.length) { errEl.textContent = 'Informe pelo menos uma quantidade > 0.'; errEl.style.display = 'block'; return; }
    const excedente = Math.max(0, totalDist - g.qty_total);
    const d = await callDiplomas({
      action: 'alm_distribuir_grupo',
      compra_ids: g.ids,
      insumo_id: g.insumo_id,
      distribuicao,
      excedente_estoque: excedente,
    });
    if (d.error) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }
    document.getElementById('almDistribuirOverlay').remove();
    showToast(`✅ Distribuição registrada: ${d.entregas_criadas} entrega(s)${d.excedente_para_estoque ? ` + ${d.excedente_para_estoque} pro estoque` : ''}.`, 'success');
    almLoadCompiladoCompras();
  }

  async function almLoadCompras() {
    const status = document.getElementById('almComprasStatus').value;
    const origem = document.getElementById('almComprasOrigem')?.value || '';
    document.getElementById('almComprasLoading').style.display = 'block';
    document.getElementById('almComprasList').innerHTML = '';
    const d = await callDiplomas({ action: 'alm_compras_todas', status, origem });
    document.getElementById('almComprasLoading').style.display = 'none';
    almComprasItems = d.data || [];

    // Update badge (pending count) — sempre baseado no total carregado
    const pendentes = almComprasItems.filter(c => c.status === 'pendente').length;
    const badge = document.getElementById('almComprasBadge');
    badge.textContent = pendentes;
    badge.style.display = pendentes > 0 ? 'inline' : 'none';

    almRenderCompras();
  }

  function almRenderCompras() {
    const q = (document.getElementById('almComprasSearch')?.value || '').toLowerCase().trim();
    const items = !q ? almComprasItems : almComprasItems.filter(c => {
      const req = c.alm_requisicoes || {};
      const manut = c.manutencao || {};
      const hay = [
        c.insumo_nome, c.produto_nome, c.plataforma,
        req.professoras?.nome, req.series?.nome,
        manut.descricao, manut.localizacao,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });

    if (!items.length) {
      document.getElementById('almComprasList').innerHTML = `<div class="empty-state">${q ? 'Nenhum item bate com a busca.' : 'Nenhum item encontrado.'}</div>`;
      return;
    }

    // Group by plataforma
    const groups = {};
    for (const c of items) {
      if (!groups[c.plataforma]) groups[c.plataforma] = [];
      groups[c.plataforma].push(c);
    }

    document.getElementById('almComprasList').innerHTML = Object.entries(groups).map(([plat, cols]) => `
      <div style="margin-bottom:20px;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:6px;">
          ${platIcon[plat]||'🔗'} ${plat}
        </div>
        ${cols.map(c => {
          const req  = c.alm_requisicoes || {};
          const turma = req.series?.nome || '—';
          const prof  = req.professoras?.nome || '—';
          const comprado = c.status === 'comprado';
          const cancelado = c.status === 'cancelado';
          const manut = c.manutencao;
          const isManut = c.origem === 'manutencao';
          const ctxLine = isManut && manut
            ? `<div style="font-size:11px;color:#92400e;">🔧 ${esc(manut.descricao?.substring(0,60) || 'Manutenção')} · ${esc(manut.localizacao || '')}</div>`
            : `<div style="font-size:11px;color:var(--muted);">${prof} · ${turma} · ${req.mes ? almMesBR(req.mes) : '—'}</div>`;
          const aprovFin = c.aprovado_financeiro === null
            ? '<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:10px;font-weight:600;margin-left:6px;" title="Acima do teto — aguarda aprovação do financeiro">⏳ aprov. financeira</span>'
            : c.aprovado_financeiro === false
            ? '<span style="font-size:10px;background:#fee2e2;color:#991b1b;padding:2px 7px;border-radius:10px;font-weight:600;margin-left:6px;">✕ rejeitado fin.</span>'
            : '';
          return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fff;border:1.5px solid ${comprado?'#bbf7d0':cancelado?'#f5f5f5':isManut?'#fde68a':'var(--border)'};border-radius:10px;margin-bottom:6px;flex-wrap:wrap;">
            ${!comprado && !cancelado ? `<input type="checkbox" class="alm-compra-chk" data-id="${c.id}" style="width:16px;height:16px;cursor:pointer;flex-shrink:0;">` : '<span style="width:16px;flex-shrink:0;"></span>'}
            <div style="flex:1;min-width:160px;">
              <div style="font-weight:600;font-size:13px;">${c.insumo_nome}${aprovFin}</div>
              ${ctxLine}
              ${c.produto_nome ? `<div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;">${c.produto_nome}</div>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:13px;font-weight:700;">×${c.qty} ${c.preco_unit != null ? '· ' + almFmtBRL(c.preco_unit) + ' un.' : ''}</div>
              ${c.preco_total != null ? `<div style="font-size:12px;color:var(--muted);">Total: ${almFmtBRL(c.preco_total)}</div>` : ''}
              ${c.match_pct ? `<div style="font-size:10px;color:${matchColor(c.match_pct)};">${c.match_pct}% ${matchLabel(c.match_pct)}</div>` : ''}
            </div>
            ${c.url_carrinho ? `
            <a href="${c.url_carrinho}" target="_blank" rel="noopener"
              style="background:#1a6bb5;color:#fff;text-decoration:none;border-radius:7px;padding:7px 12px;font-size:12px;font-weight:600;white-space:nowrap;font-family:'DM Sans',sans-serif;">
              🛒 Abrir carrinho
            </a>` : c.url_produto ? `
            <a href="${c.url_produto}" target="_blank" rel="noopener"
              style="background:#1a6bb5;color:#fff;text-decoration:none;border-radius:7px;padding:7px 12px;font-size:12px;font-weight:600;white-space:nowrap;font-family:'DM Sans',sans-serif;">
              🔗 Ver produto
            </a>` : ''}
            ${comprado
              ? `<span style="background:#f0fff4;color:#2d7a2d;border:1px solid #bbf7d0;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;">✅ Comprado</span>`
              : cancelado
              ? `<span style="color:var(--muted);font-size:11px;">Cancelado</span>`
              : c.aprovado_financeiro === null
              ? `<button onclick="almAprovarFinanceiro(['${c.id}'], true)" style="background:#d97706;color:#fff;border:none;border-radius:7px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:'DM Sans',sans-serif;">💰 Aprovar p/ compra</button>
                 <button onclick="almAprovarFinanceiro(['${c.id}'], false)" style="background:#fff;color:#991b1b;border:1.5px solid #fecaca;border-radius:7px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:'DM Sans',sans-serif;">✕ Rejeitar</button>`
              : c.aprovado_financeiro === false
              ? `<button onclick="almCancelarCompra('${c.id}')" style="background:#fff;color:#991b1b;border:1.5px solid #fecaca;border-radius:7px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:'DM Sans',sans-serif;">Cancelar</button>`
              : `<button onclick="almMarcarComprado(['${c.id}'])" style="background:#2d7a2d;color:#fff;border:none;border-radius:7px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:'DM Sans',sans-serif;">✅ Marcar comprado</button>`
            }
          </div>`;
        }).join('')}
      </div>`).join('');
  }

  async function almMarcarComprado(ids) {
    if (!ids?.length) return;
    const d = await callDiplomas({ action: 'alm_marcar_comprado', ids });
    if (d.error) {
      showToast('Erro: ' + d.error, 'error');
      return;
    }
    const marcados = d.marcados ?? ids.length;
    const okEl = document.getElementById('almComprasOk');
    okEl.textContent = marcados > 0
      ? `✅ ${marcados} item(ns) marcado(s) como comprado.`
      : '⚠️ Nenhum item foi marcado (verifique se você tem permissão).';
    okEl.classList.add('show');
    setTimeout(() => okEl.classList.remove('show'), 3000);
    almLoadCompras();
  }

  async function almMarcarSelecionados() {
    const checks = document.querySelectorAll('.alm-compra-chk:checked');
    const ids = Array.from(checks).map(c => c.dataset.id);
    if (!ids.length) { showToast('Selecione ao menos um item.', 'warning'); return; }
    await almMarcarComprado(ids);
  }

  // Aprovação financeira (compras ≥ teto). Pode aprovar: gerente, diretor, financeiro.
  async function almAprovarFinanceiro(ids, aprovar) {
    if (!ids?.length) return;
    if (!aprovar && !await _lumiedConfirm('Rejeitar essa compra? O item ficará bloqueado até ser cancelado.')) return;
    const d = await callDiplomas({ action: 'alm_compra_aprovar_financeiro', ids, decisao: aprovar ? 'aprovar' : 'rejeitar' });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast(aprovar ? '✅ Compra aprovada.' : '✕ Compra rejeitada.', 'success');
    almLoadCompras();
  }
  async function almCancelarCompra(id) {
    if (!id) return;
    if (!await _lumiedConfirm('Cancelar essa compra?')) return;
    const d = await callDiplomas({ action: 'alm_cancelar_compra', id });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast('Compra cancelada.', 'success');
    almLoadCompras();
  }

  // ── Criar Requisição (gerente em nome de professora) ──────
  var almNRCart  = [];
  var almNRCatalogo = [];
  var almNRXlsxParsed = [];

  var almNRNorm = s => (s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
  var almNRFmtBRL = v => 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});

  function almGerarModelo() {
    const wb = XLSX.utils.book_new();
    const wsReq = XLSX.utils.aoa_to_sheet([
      ['Nome do Insumo *', 'Quantidade *', 'Unidade', 'Observação'],
      ['Papel Sulfite A4 75g Resma 500fls', 2, 'resma', 'Para impressão de avisos'],
      ['Caneta Esferográfica Azul', 10, 'unidade', ''],
      ['Fita Adesiva Transparente 45mm', 5, 'rolo', ''],
      ['', '', '', ''], ['', '', '', ''], ['', '', '', ''],
      ['', '', '', ''], ['', '', '', ''], ['', '', '', ''],
    ]);
    wsReq['!cols'] = [{ wch: 42 }, { wch: 14 }, { wch: 14 }, { wch: 36 }];
    XLSX.utils.book_append_sheet(wb, wsReq, 'Requisição');
    const wsInst = XLSX.utils.aoa_to_sheet([
      ['INSTRUÇÕES — Modelo de Requisição de Insumos · ' + SCHOOL_NAME],
      [''],
      ['1. Preencha a aba "Requisição" a partir da linha 2 (linha 1 é o cabeçalho).'],
      ['2. Não altere nem remova as colunas existentes.'],
      ['3. Salve e faça o upload no portal.'],
      [''],
      ['COLUNAS:'],
      ['  Nome do Insumo *  → Obrigatório. Nome do material. Seja específico.'],
      ['  Quantidade *      → Obrigatório. Número inteiro ou decimal. Ex: 2 ou 1.5'],
      ['  Unidade           → Opcional. Ex: unidade, resma, kg, litro, rolo, caixa.'],
      ['  Observação        → Opcional. Informações adicionais.'],
      [''],
      ['DICAS:'],
      ['  • Os nomes são comparados automaticamente com o catálogo do almoxarifado.'],
      ['  • Itens não encontrados no catálogo são marcados com ⚠ mas ainda aceitos.'],
    ]);
    wsInst['!cols'] = [{ wch: 72 }];
    XLSX.utils.book_append_sheet(wb, wsInst, 'Instruções');
    XLSX.writeFile(wb, 'modelo_requisicao_lumied.xlsx');
  }

  // ── Rascunho local da requisição-em-nome-da-professora ──
  // Server-side rascunho aqui complica (alm_rascunho_* é por professora_id da
  // sessão dela, não do gerente). localStorage cobre o caso "fechei a aba e
  // perdi o carrinho" sem inventar tabela paralela.
  const ALMNR_DRAFT_KEY = 'almnr_draft_v1';
  function almNRDraftSave() {
    try {
      const obs = document.getElementById('almNRObs')?.value || '';
      const profId = document.getElementById('almNRProfessora')?.value || '';
      if (!almNRCart.length && !obs.trim() && !profId) {
        localStorage.removeItem(ALMNR_DRAFT_KEY);
        const st = document.getElementById('almNRDraftStatus'); if (st) st.textContent = '';
        return;
      }
      localStorage.setItem(ALMNR_DRAFT_KEY, JSON.stringify({ cart: almNRCart, obs, profId, savedAt: Date.now() }));
      const st = document.getElementById('almNRDraftStatus');
      if (st) st.textContent = '💾 rascunho salvo localmente';
    } catch {}
  }
  function almNRDraftLoad() {
    try {
      const raw = localStorage.getItem(ALMNR_DRAFT_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (Array.isArray(d.cart)) almNRCart = d.cart;
      const obs = document.getElementById('almNRObs');
      const sel = document.getElementById('almNRProfessora');
      if (obs && d.obs) obs.value = d.obs;
      if (sel && d.profId) sel.value = d.profId;
      const st = document.getElementById('almNRDraftStatus');
      if (st) st.textContent = '↩️ rascunho recuperado';
      return true;
    } catch { return false; }
  }
  function almNRDraftClear() {
    try { localStorage.removeItem(ALMNR_DRAFT_KEY); } catch {}
    const st = document.getElementById('almNRDraftStatus'); if (st) st.textContent = '';
  }

  async function almAbrirNovaReq() {
    almNRCart = [];
    almNRXlsxParsed = [];
    document.getElementById('almNRObs').value = '';
    document.getElementById('almNRErr').classList.remove('show');
    document.getElementById('almNRSearchInput').value = '';
    document.getElementById('almNRXlsxResult').style.display = 'none';
    almNRSwitchTab('buscar');

    // Load catalog (use alm_insumos_list which is gerente-accessible)
    if (!almNRCatalogo.length) {
      const d = await callDiplomas({ action: 'alm_insumos_list' });
      almNRCatalogo = (d.data || []).filter(i => i.ativo);
    }
    almNRFiltrarCatalogo();

    // Load professoras into selector
    const profsRaw = await api({ action: 'professoras_list' }).catch(() => []);
    const profs = Array.isArray(profsRaw) ? profsRaw : [];
    const sel = document.getElementById('almNRProfessora');
    sel.innerHTML = '<option value="">— Selecione a professora —</option>' +
      profs.map(p => `<option value="${p.id}">${p.nome}${p.email?' · '+p.email:''}</option>`).join('');

    // Tenta recuperar rascunho do localStorage (carrinho/obs/professora)
    almNRDraftLoad();
    almNRRenderCart();

    document.getElementById('almNovaReqModal').style.display = 'block';
  }

  function almFecharNovaReq() {
    document.getElementById('almNovaReqModal').style.display = 'none';
    // Não limpa o rascunho aqui — só no submit OK. Se o gerente fechou sem
    // querer, o carrinho volta na próxima abertura.
  }

  function almNRSwitchTab(tab) {
    document.getElementById('almNRTabBuscar').style.display   = tab==='buscar'   ?'block':'none';
    document.getElementById('almNRTabPlanilha').style.display = tab==='planilha' ?'block':'none';
    document.getElementById('almNRTabBtnBuscar').classList.toggle('active',   tab==='buscar');
    document.getElementById('almNRTabBtnPlanilha').classList.toggle('active', tab==='planilha');
  }

  function almNRFiltrarCatalogo() {
    const q = document.getElementById('almNRSearchInput').value.toLowerCase();
    const filtered = almNRCatalogo.filter(it =>
      it.nome.toLowerCase().includes(q) || (it.categoria||'').toLowerCase().includes(q)
    );
    const el = document.getElementById('almNRCatalogList');
    if (!filtered.length) { el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px;">Nenhum insumo encontrado.</div>'; return; }
    const cats = {};
    for (const it of filtered) { const c = it.categoria||'Geral'; (cats[c]||(cats[c]=[])).push(it); }
    el.innerHTML = Object.entries(cats).map(([cat, items]) =>
      `<div style="padding:6px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);background:#f9f7f4;">${cat}</div>` +
      items.map(it => {
        const inCart = almNRCart.find(c => c.insumo_id === it.id);
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-bottom:1px solid #f0ece6;gap:10px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13px;">${it.nome}</div>
            <div style="font-size:11px;color:var(--muted);">${almNRFmtBRL(it.preco)} / ${it.unidade} · Estoque: ${it.estoque_qty}</div>
          </div>
          <button onclick="almNRAddCart('${it.id}')" style="background:${inCart?'#6b8c6b':'var(--red)'};color:#fff;border:none;border-radius:7px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:'DM Sans',sans-serif;">
            ${inCart?'✓ Adicionado':'+ Adicionar'}
          </button>
        </div>`;
      }).join('')
    ).join('');
  }

  function almNRAddCart(id) {
    if (almNRCart.find(c => c.insumo_id === id)) return;
    const it = almNRCatalogo.find(c => c.id === id);
    if (!it) return;
    almNRCart.push({ insumo_id: it.id, nome: it.nome, unidade: it.unidade, preco_unit: it.preco, qty_solicitado: 1 });
    almNRRenderCart();
    almNRFiltrarCatalogo();
    almNRDraftSave();
  }

  function almNRRemoveCart(id) {
    almNRCart = almNRCart.filter(c => c.insumo_id !== id);
    almNRRenderCart();
    almNRFiltrarCatalogo();
    almNRDraftSave();
  }

  function almNRRenderCart() {
    const emptyEl = document.getElementById('almNRCartEmpty');
    const listEl  = document.getElementById('almNRCartList');
    if (!almNRCart.length) { emptyEl.style.display='block'; listEl.innerHTML=''; almNRUpdateTotal(); return; }
    emptyEl.style.display = 'none';
    listEl.innerHTML = almNRCart.map(it =>
      `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f0ece6;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;">${it.nome}</div>
          <div style="font-size:11px;color:var(--muted);">${almNRFmtBRL(it.preco_unit)} / ${it.unidade}</div>
        </div>
        <input type="number" value="${it.qty_solicitado}" min="0.5" step="0.5" style="width:62px;padding:5px 7px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;text-align:center;" onchange="almNRUpdateQty('${it.insumo_id}',this.value)">
        <button onclick="almNRRemoveCart('${it.insumo_id}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;padding:2px 6px;">×</button>
      </div>`
    ).join('');
    almNRUpdateTotal();
  }

  function almNRUpdateQty(id, val) {
    const it = almNRCart.find(c => c.insumo_id === id);
    if (it) it.qty_solicitado = Math.max(0.5, parseFloat(val)||1);
    almNRUpdateTotal();
    almNRDraftSave();
  }

  function almNRUpdateTotal() {
    const t = almNRCart.reduce((s,it) => s + it.qty_solicitado * it.preco_unit, 0);
    document.getElementById('almNRTotal').textContent = almNRFmtBRL(t);
  }

  function almNRMatchCatalogo(nome) {
    const qNorm  = almNRNorm(nome);
    const qWords = qNorm.split(' ').filter(Boolean);
    if (!qWords.length) return null;
    let hit = almNRCatalogo.find(c => almNRNorm(c.nome) === qNorm);
    if (hit) return { item: hit, pct: 100 };
    let best = null, bestScore = 0;
    for (const c of almNRCatalogo) {
      const cSet  = new Set(almNRNorm(c.nome).split(' ').filter(Boolean));
      const score = qWords.filter(w => cSet.has(w)).length / qWords.length;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (bestScore >= 0.5) return { item: best, pct: Math.round(bestScore*100) };
    return null;
  }

  function almNRHandleDrop(e) { e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) almNRProcessarXlsx(f); }

  async function almNRProcessarXlsx(file) {
    almNRXlsxParsed = [];
    document.getElementById('almNRXlsxResult').style.display = 'none';
    if (!almNRCatalogo.length) {
      const d = await callDiplomas({ action: 'alm_catalogo' });
      almNRCatalogo = d.data || [];
    }
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(new Uint8Array(buf), { type:'array' });
      const sheetName = wb.SheetNames.find(n => !n.toLowerCase().includes('instru')) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, defval:'' });
      const data = rows.slice(1)
        .filter(r => String(r[0]||'').trim())
        .map(r => ({ nome:String(r[0]||'').trim(), qty:parseFloat(String(r[1]).replace(',','.'))||0, unidade:String(r[2]||'').trim()||null, obs:String(r[3]||'').trim() }))
        .filter(it => it.qty > 0);
      if (!data.length) { showToast('Nenhum item encontrado na planilha.', 'warning'); return; }
      let matched = 0;
      almNRXlsxParsed = data.map(it => {
        const hit = almNRMatchCatalogo(it.nome);
        if (hit) matched++;
        return { nome: hit?hit.item.nome:it.nome, insumo_id:hit?hit.item.id:null, qty_solicitado:it.qty, unidade:it.unidade||(hit?hit.item.unidade:'unidade'), preco_unit:hit?hit.item.preco:0, catalogado:!!hit, pct:hit?hit.pct:0 };
      });
      document.getElementById('almNRXlsxSummary').textContent = `${data.length} item(ns) · ${matched} no catálogo · ${data.length-matched} não catalogado(s)`;
      document.getElementById('almNRXlsxRows').innerHTML = almNRXlsxParsed.map((it,i) =>
        `<div class="alm-xlsx-row ${it.catalogado?'ok':'warn'}">
          <span>${it.catalogado?'✅':'⚠️'}</span>
          <div style="flex:1;min-width:0;font-size:12px;"><div style="font-weight:600;">${it.nome}</div>
            <div style="color:${it.catalogado?'#2d7a2d':'#b07d00'};">${it.catalogado?it.pct+'% precisão':'Não no catálogo'}</div></div>
          <div style="font-size:11px;color:var(--muted);">×${it.qty_solicitado} ${it.unidade}</div>
          <input type="number" value="${it.qty_solicitado}" min="0.5" step="0.5" style="width:56px;padding:4px;border:1.5px solid var(--border);border-radius:5px;font-size:12px;text-align:center;" onchange="almNRXlsxParsed[${i}].qty_solicitado=parseFloat(this.value)||1">
        </div>`
      ).join('');
      document.getElementById('almNRXlsxResult').style.display = 'block';
    } catch(e) { showToast('Erro ao ler o arquivo. Verifique o formato.', 'error'); }
  }

  function almNRImportarXlsx() {
    for (const it of almNRXlsxParsed) {
      const dup = almNRCart.find(c => it.insumo_id ? c.insumo_id===it.insumo_id : c.nome===it.nome);
      if (dup) dup.qty_solicitado += it.qty_solicitado;
      else almNRCart.push({ insumo_id:it.insumo_id, nome:it.nome, unidade:it.unidade, preco_unit:it.preco_unit, qty_solicitado:it.qty_solicitado });
    }
    almNRRenderCart();
    almNRSwitchTab('buscar');
    document.getElementById('almNRXlsxResult').style.display = 'none';
    almNRXlsxParsed = [];
  }

  async function almSubmitNovaReq() {
    const errEl = document.getElementById('almNRErr');
    errEl.classList.remove('show');
    const profId = document.getElementById('almNRProfessora').value;
    if (!profId) { errEl.textContent='Selecione a professora.'; errEl.classList.add('show'); return; }
    if (!almNRCart.length) { errEl.textContent='Adicione pelo menos um item.'; errEl.classList.add('show'); return; }
    const btn = document.getElementById('almNRBtnEnviar');
    btn.disabled = true; btn.textContent = 'Criando…';
    const d = await callDiplomas({
      action:        'alm_criar_req_gerente',
      professora_id: profId,
      itens:         almNRCart,
      observacao:    document.getElementById('almNRObs').value.trim(),
    });
    btn.disabled = false; btn.textContent = '✅ Criar Requisição';
    if (d.error) { errEl.textContent = d.error; errEl.classList.add('show'); return; }
    almNRDraftClear();
    almNRCart = [];
    almFecharNovaReq();
    almLoadCompras();
  }

  // ── ITENS ÓRFÃOS (reqs aprovadas sem insumo_id) ────────
  var _almOrfaosCache = [];

  async function almLoadOrfaos() {
    const d = await callDiplomas({ action: 'alm_orfaos_list' });
    if (d.error) { console.warn('[orfaos]', d.error); return; }
    _almOrfaosCache = d.data || [];
    const card = document.getElementById('almOrfaosCard');
    if (!card) return;
    if (!_almOrfaosCache.length) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    document.getElementById('almOrfaosStats').innerHTML =
      `<strong>${_almOrfaosCache.length}</strong> material${_almOrfaosCache.length===1?'':'is'} distinto${_almOrfaosCache.length===1?'':'s'} aguardando · `
      + `<strong>${d.total_itens || 0}</strong> linha${d.total_itens===1?'':'s'} de requisição afetada${d.total_itens===1?'':'s'}`;
    document.getElementById('almOrfaosList').innerHTML = _almOrfaosCache.map((g, idx) => {
      const variantes = (g.variantes||[]).length > 1
        ? `<div style="font-size:10px;color:#7a5a00;margin-top:2px;">Variações na req: ${(g.variantes||[]).map(v => `<code style="background:#fff4d6;padding:1px 4px;border-radius:3px;">${esc(v)}</code>`).join(' ')}</div>`
        : '';
      const existente = g.insumo_existente
        ? `<div style="font-size:10px;color:#0b7a4b;margin-top:4px;">↪ Já existe no catálogo: <strong>${esc(g.insumo_existente.nome)}</strong> — promover vai linkar nele (sem duplicar).</div>`
        : '';
      const dataPrimeira = g.primeira_data ? new Date(g.primeira_data).toLocaleDateString('pt-BR') : '';
      const dataUltima = g.ultima_data ? new Date(g.ultima_data).toLocaleDateString('pt-BR') : '';
      const precoRange = g.preco_min && g.preco_max && g.preco_min !== g.preco_max
        ? `<span style="font-size:10px;color:#7a5a00;">${almFmtBRL(g.preco_min)}–${almFmtBRL(g.preco_max)}</span>`
        : '';
      return `<div class="alm-orfao-row" data-idx="${idx}" style="background:#fff;border:1px solid #f0c14b;border-radius:8px;padding:10px 12px;margin-bottom:8px;display:grid;grid-template-columns:24px 1fr 110px 110px 110px;gap:8px;align-items:center;">
        <input type="checkbox" class="alm-orfao-chk" data-idx="${idx}" ${g.insumo_existente?'checked':''} onchange="almOrfaosUpdateCount()">
        <div style="min-width:0;">
          <input type="text" class="alm-orfao-nome" data-idx="${idx}" value="${esc(g.nome)}" style="width:100%;font-weight:600;font-size:13px;padding:4px 8px;border:1px solid #e7d99c;border-radius:6px;background:#fffbeb;">
          <div style="font-size:10px;color:var(--muted);margin-top:4px;">
            ${g.ocorrencias} ocorrência${g.ocorrencias===1?'':'s'} · ${(g.req_ids||[]).length} req${(g.req_ids||[]).length===1?'':'s'}
            ${dataPrimeira ? ` · ${dataPrimeira}${dataUltima && dataUltima!==dataPrimeira ? '–'+dataUltima : ''}` : ''}
            ${precoRange ? ' · '+precoRange : ''}
          </div>
          ${variantes}
          ${existente}
        </div>
        <input type="text" class="alm-orfao-unidade" data-idx="${idx}" value="${esc(g.unidade||'unidade')}" placeholder="unidade" style="padding:4px 8px;border:1px solid #e7d99c;border-radius:6px;font-size:12px;background:#fffbeb;">
        <input type="number" class="alm-orfao-preco" data-idx="${idx}" value="${Number(g.preco||0).toFixed(2)}" step="0.01" min="0" style="padding:4px 8px;border:1px solid #e7d99c;border-radius:6px;font-size:12px;background:#fffbeb;text-align:right;">
        <input type="text" class="alm-orfao-categoria" data-idx="${idx}" value="${esc(g.categoria||'')}" placeholder="(sem categoria)" style="padding:4px 8px;border:1px solid #e7d99c;border-radius:6px;font-size:12px;background:#fffbeb;">
      </div>`;
    }).join('');
    almOrfaosUpdateCount();
  }

  function almOrfaosToggleAll(checked) {
    document.querySelectorAll('.alm-orfao-chk').forEach(c => c.checked = checked);
    almOrfaosUpdateCount();
  }

  function almOrfaosUpdateCount() {
    const n = document.querySelectorAll('.alm-orfao-chk:checked').length;
    document.getElementById('almOrfaosSelCount').textContent = n ? `${n} selecionado${n===1?'':'s'}` : '';
  }

  async function almPromoverOrfaos() {
    const checks = Array.from(document.querySelectorAll('.alm-orfao-chk:checked'));
    if (!checks.length) { showToast('Selecione ao menos um item.', 'warning'); return; }
    const grupos = checks.map(c => {
      const idx = parseInt(c.dataset.idx);
      const orig = _almOrfaosCache[idx];
      const nome = document.querySelector(`.alm-orfao-nome[data-idx="${idx}"]`)?.value?.trim() || orig.nome;
      const unidade = document.querySelector(`.alm-orfao-unidade[data-idx="${idx}"]`)?.value?.trim() || 'unidade';
      const preco = parseFloat(document.querySelector(`.alm-orfao-preco[data-idx="${idx}"]`)?.value) || 0;
      const categoria = document.querySelector(`.alm-orfao-categoria[data-idx="${idx}"]`)?.value?.trim() || null;
      return {
        nome, unidade, preco, categoria,
        variantes: orig.variantes || [orig.nome],
        req_ids: orig.req_ids || [],
        insumo_existente_id: orig.insumo_existente?.id || null,
      };
    });
    if (!confirm(`Promover ${grupos.length} material${grupos.length===1?'':'is'} ao catálogo? Cada um virará um insumo oficial e as requisições serão vinculadas.`)) return;
    const d = await callDiplomas({ action: 'alm_orfaos_promover', grupos });
    if (d.error) { showToast('Erro: '+d.error, 'error'); return; }
    const msg = `✅ ${d.promovidos} insumo${d.promovidos===1?'':'s'} criado${d.promovidos===1?'':'s'} · ${d.itens_atualizados} item${d.itens_atualizados===1?'':'ns'} de requisição linkado${d.itens_atualizados===1?'':'s'}`;
    showToast(msg, 'success');
    if ((d.falhas||[]).length) {
      console.warn('Falhas ao promover:', d.falhas);
      showToast(`⚠️ ${d.falhas.length} falha(s) — ver console.`, 'warning');
    }
    await almLoadOrfaos();
    await almLoadInsumos();
  }

  async function almLoadInsumos() {
    const d = await callDiplomas({ action: 'alm_insumos_list' });
    const insumos = d.data || [];
    _almInvCatalogoCache = insumos;  // reaproveitado pelo modal de inventário
    document.getElementById('almInsumosCount').textContent = insumos.filter((i)=>i.ativo).length;
    // Popula datalist de localizações já cadastradas
    const dataList = document.getElementById('almLocalizacoesList');
    if (dataList) {
      const locs = [...new Set(insumos.map(i=>i.localizacao).filter(Boolean))].sort();
      dataList.innerHTML = locs.map(l=>`<option value="${esc(l)}">`).join('');
    }
    document.getElementById('almInsumosList').innerHTML = insumos.map((it) => {
      return `<div class="alm-insumo-row" style="${!it.ativo ? 'opacity:.5;' : ''}">
        <div style="display:flex;align-items:center;gap:10px;flex:1;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13px;">${it.nome}${it.descricao ? ` <span style="font-weight:400;color:var(--muted);font-size:11px;">(${esc(it.descricao)})</span>` : ''}</div>
            <div style="font-size:11px;color:var(--muted);">
              ${it.categoria||'Geral'} · Estoque: ${it.estoque_qty} ${it.unidade}
              ${it.qtd_por_embalagem > 1 ? ` · Embalagem: ${it.unidade_compra||'cx'} c/ ${it.qtd_por_embalagem} ${it.unidade}` : ''}
              ${it.localizacao ? ` · 📍 ${esc(it.localizacao)}` : ''}
            </div>
            <div style="font-size:11px;">
              <strong>${almFmtBRL(it.preco)}</strong>${it.qtd_por_embalagem > 1 ? `/${it.unidade_compra||'emb'} <span style="color:#2d7a3a;font-weight:600;">(${almFmtBRL(it.preco/it.qtd_por_embalagem)}/${it.unidade})</span>` : `/${it.unidade}`}
            </div>
          </div>
          <button onclick="almEditarInsumoById('${it.id}')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;flex-shrink:0;">Editar</button>
          <button onclick="almVerHistorico('${it.id}','${esc(it.nome)}')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;flex-shrink:0;${it.preco_atualizado_em?'color:#1a6bb5;':''}">📊${it.preco_atualizado_em?' '+new Date(it.preco_atualizado_em).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}):''}</button>
          <button onclick="almConferenciaModal('${it.id}','${esc(it.nome)}',${it.estoque_qty})" style="background:none;border:1px solid #d97706;color:#9a3412;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;flex-shrink:0;" title="Conferência física do estoque">📦</button>
          <button onclick="almMovimentacoesModal('${it.id}','${esc(it.nome)}')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;flex-shrink:0;" title="Movimentações de estoque">↕️</button>
          ${it.ativo ? `<button onclick="almDesativarInsumo('${it.id}')" style="background:none;border:1px solid #e53e3e;color:#e53e3e;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;flex-shrink:0;">Desativar</button>` : ''}
          <button onclick="almExcluirInsumo('${it.id}','${esc(it.nome)}')" style="background:none;border:1px solid #991b1b;color:#991b1b;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;flex-shrink:0;" title="Excluir permanentemente">🗑️ Excluir</button>
        </div>
      </div>`;
    }).join('') || '<div class="empty-state">Nenhum insumo cadastrado.</div>';
  }

  async function almConferenciaModal(id, nome, saldoAtual) {
    const real = window.prompt(`Conferência física: "${nome}"\n\nSaldo atual no sistema: ${saldoAtual}\nDigite o saldo real contado:`);
    if (real == null || real === '') return;
    const saldo_real = parseFloat(String(real).replace(',', '.'));
    if (Number.isNaN(saldo_real) || saldo_real < 0) { showToast('Saldo inválido.', 'error'); return; }
    if (saldo_real === Number(saldoAtual)) { showToast('Saldos iguais — sem ajuste.', 'info'); return; }
    const motivo = window.prompt('Motivo do ajuste (ex: contagem mensal, perda, doação):') || 'Conferência física';
    const d = await callDiplomas({ action: 'alm_conferencia_inventario', insumo_id: id, saldo_real, motivo });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast(`✅ Ajuste aplicado: ${d.antes} → ${d.depois} (${d.diff > 0 ? '+' : ''}${d.diff})`, 'success');
    almLoadInsumos();
  }

  async function almMovimentacoesModal(id, nome) {
    const d = await callDiplomas({ action: 'alm_movimentacoes_list', insumo_id: id });
    const movs = d.data || [];
    let html = `<h3 style="font-family:'Lora',serif;font-size:16px;margin-bottom:12px;">↕️ Movimentações: ${esc(nome)}</h3>`;
    if (!movs.length) html += '<div class="empty-state">Nenhuma movimentação registrada.</div>';
    else {
      html += '<div style="max-height:400px;overflow-y:auto;font-size:12px;">';
      const tipoLbl = { entrada:'⬆️ Entrada', saida:'⬇️ Saída', ajuste:'⚖️ Ajuste' };
      html += movs.map(m => `<div style="padding:8px 0;border-bottom:1px solid #f0ece6;">
        <div style="display:flex;justify-content:space-between;font-weight:600;">
          <span>${tipoLbl[m.tipo] || m.tipo}</span>
          <span>${m.qty} · ${new Date(m.criado_em).toLocaleString('pt-BR')}</span>
        </div>
        <div style="color:var(--muted);font-size:11px;">${esc(m.motivo || '')} · saldo ${m.saldo_antes ?? '?'} → ${m.saldo_depois ?? '?'}</div>
      </div>`).join('');
      html += '</div>';
    }
    html += '<div style="text-align:right;margin-top:12px;"><button onclick="document.getElementById(\'almMovModal\').remove()" class="btn-create" style="width:auto;padding:7px 18px;">Fechar</button></div>';
    let modal = document.getElementById('almMovModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'almMovModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1100;display:flex;align-items:center;justify-content:center;padding:20px;';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `<div style="background:#fff;border-radius:14px;padding:24px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;">${html}</div>`;
  }

