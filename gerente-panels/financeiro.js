// Auto-extraído do gerente.html (Onda 4 — mega batch).
// Financeiro core + Batch item inline editing
  // ── FINANCEIRO ─────────────────────────────────────

  // initYearSel (util para selects de ano)
  function initYearSel(selId, spanId) {
    var y = new Date().getFullYear();
    var sel = document.getElementById(selId);
    if (!sel.options.length) {
      sel.innerHTML = [y-1,y,y+1].map(function(a){ return '<option value="'+a+'"'+(a===y?' selected':'')+'>'+a+'</option>'; }).join('');
    }
    var sp = document.getElementById(spanId);
    if (sp) sp.textContent = sel.value;
    return parseInt(sel.value);
  }

  // Helper genérico para switching de abas financeiras
  function _finSwitchTab(prefix, tabs, activeTab, loadFn) {
    var activeStyle = 'padding:14px 28px;font-size:14px;font-weight:700;background:#fff;color:#C8102E;cursor:pointer;font-family:inherit;border:2px solid #C8102E;border-radius:10px;border-bottom:4px solid #C8102E;box-shadow:0 2px 8px rgba(0,0,0,0.08);';
    var inactiveStyle = 'padding:14px 28px;font-size:14px;font-weight:700;background:#fff;color:#888;cursor:pointer;font-family:inherit;border:2px solid #ddd;border-radius:10px;border-bottom:4px solid transparent;box-shadow:none;';
    tabs.forEach(function(t) {
      var btn = document.getElementById(prefix + 'Tab' + t.charAt(0).toUpperCase() + t.slice(1));
      var sec = document.getElementById(prefix + t.charAt(0).toUpperCase() + t.slice(1) + 'Section');
      if (btn) btn.style.cssText = (t === activeTab) ? activeStyle : inactiveStyle;
      if (sec) sec.style.display = (t === activeTab) ? '' : 'none';
    });
    if (loadFn) loadFn();
  }

  // 1. Dashboard & Análise
  var _finDashCurrentTab = 'visao';
  function switchFinDashTab(tab) {
    _finDashCurrentTab = tab;
    _finSwitchTab('finDash', ['visao','analise'], tab, tab === 'analise' ? loadFinDashExt : null);
  }

  // 2. Lançamentos & Recibos
  var _finLancCurrentTab = 'lanc';
  function switchFinLancTab(tab) {
    _finLancCurrentTab = tab;
    _finSwitchTab('finLanc', ['lanc','recibos'], tab, tab === 'recibos' ? loadRecibos : null);
  }

  // 3. Descontos & Reajuste
  var _finDescCurrentTab = 'desc';
  function switchFinDescTab(tab) {
    _finDescCurrentTab = tab;
    _finSwitchTab('finDesc', ['desc','reaj'], tab, tab === 'reaj' ? loadReajustes : null);
  }

  // 4. Fluxo de Caixa & Fechamento
  var _finFluxoCurrentTab = 'fluxo';
  function switchFinFluxoTab(tab) {
    _finFluxoCurrentTab = tab;
    _finSwitchTab('finFluxo', ['fluxo','fech'], tab, tab === 'fech' ? loadFechamento : null);
  }

  // 5. Exportar & Notificações
  var _finCfgCurrentTab = 'export';
  function switchFinCfgTab(tab) {
    _finCfgCurrentTab = tab;
    _finSwitchTab('finCfg', ['export','notif'], tab, tab === 'notif' ? loadNotifConfig : null);
  }

  // 6. DRE & Balanço
  var _finDreCurrentTab = 'dre';
  function switchFinDreTab(tab) {
    _finDreCurrentTab = tab;
    _finSwitchTab('finDre', ['dre','balanco'], tab, tab === 'balanco' ? loadFinBalanco : null);
  }

  // 7. Conciliação & Plano de Contas
  var _finConcCurrentTab = 'conc';
  function switchFinConcTab(tab) {
    _finConcCurrentTab = tab;
    _finSwitchTab('finConc', ['conc','contas'], tab, tab === 'contas' ? loadFinContas : null);
  }

  var finTipoFilter = 'todos';
  function setFinTipo(t, btn) { finTipoFilter = t; document.querySelectorAll('#panelFinLanc .fb').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); loadFinLancamentos(); }
  function toggleFinLancForm() { const el = document.getElementById('finLancForm'); el.style.display = el.style.display==='none'?'block':'none'; }
  function toggleFinContaForm() { const el = document.getElementById('finContaForm'); el.style.display = el.style.display==='none'?'block':'none'; }

  async function loadFinDashboard() {
    const ano = document.getElementById('finDashAno').value;
    const d = await api({ action: 'fin_dashboard', ano });
    if (d.error) { document.getElementById('finDashContent').innerHTML = '<div class="empty-state">Erro.</div>'; return; }
    var z12f = [0,0,0,0,0,0,0,0,0,0,0,0];
    d.receitas_mes = d.receitas_mes || z12f;
    d.despesas_mes = d.despesas_mes || z12f;
    d.total_receitas = d.total_receitas || 0;
    d.total_despesas = d.total_despesas || 0;
    d.pendente = d.pendente || 0;
    const fmtR = v => 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2});
    const maxVal = Math.max(...d.receitas_mes, ...d.despesas_mes, 1);
    document.getElementById('finDashContent').innerHTML = `
      <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px;">
        <div class="stat-card" data-g="total"><div class="stat-label">Total Receitas</div><div class="stat-value" style="color:#2d7a3a;font-size:24px;">${fmtR(d.total_receitas)}</div></div>
        <div class="stat-card" data-g="integral"><div class="stat-label">Total Despesas</div><div class="stat-value" style="color:#e53e3e;font-size:24px;">${fmtR(d.total_despesas)}</div></div>
        <div class="stat-card" data-g="semi"><div class="stat-label">Saldo</div><div class="stat-value" style="color:${d.total_receitas-d.total_despesas>=0?'#2d7a3a':'#e53e3e'};font-size:24px;">${fmtR(d.total_receitas-d.total_despesas)}</div></div>
        <div class="stat-card" data-g="diaria"><div class="stat-label">Pendente</div><div class="stat-value" style="color:#b07d00;font-size:24px;">${fmtR(d.pendente)}</div></div>
      </div>
      <div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;">
        <div style="font-size:14px;font-weight:700;margin-bottom:12px;">Receitas x Despesas por Mes</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:140px;">
          ${MESES_CURTOS.map((m,i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">
            <div style="display:flex;gap:2px;align-items:flex-end;width:100%;justify-content:center;height:110px;">
              <div style="width:40%;background:#2d7a3a;border-radius:3px 3px 0 0;height:${Math.max(2,d.receitas_mes[i]/maxVal*100)}px;" title="Receita: ${fmtR(d.receitas_mes[i])}"></div>
              <div style="width:40%;background:#e53e3e;border-radius:3px 3px 0 0;height:${Math.max(2,d.despesas_mes[i]/maxVal*100)}px;" title="Despesa: ${fmtR(d.despesas_mes[i])}"></div>
            </div>
            <div style="font-size:9px;color:var(--muted);">${m}</div>
          </div>`).join('')}
        </div>
        <div style="display:flex;gap:16px;margin-top:8px;font-size:11px;">
          <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#2d7a3a;border-radius:2px;"></span> Receitas</span>
          <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#e53e3e;border-radius:2px;"></span> Despesas</span>
        </div>
      </div>
      ${d.mensalidades ? `<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:20px;">
        <div style="font-size:14px;font-weight:700;margin-bottom:8px;">Mensalidades ${ano}</div>
        <div style="display:flex;gap:20px;font-size:13px;">
          <span>Total: <strong>${fmtR(d.mensalidades.total)}</strong></span>
          <span style="color:#2d7a3a;">Pago: <strong>${fmtR(d.mensalidades.pago)}</strong></span>
          <span style="color:#b07d00;">Pendente: <strong>${fmtR(d.mensalidades.pendente)}</strong></span>
        </div>
      </div>` : ''}
      `;
  }

  async function loadFinLancamentos() {
    const mes = document.getElementById('finLancMes').value || new Date().toISOString().slice(0,7);
    if (!document.getElementById('finLancMes').value) monthNavSet('finLancMes', mes);
    const tipo = finTipoFilter === 'todos' ? undefined : finTipoFilter;
    const d = await api({ action: 'fin_lancamentos_list', mes, tipo });
    const items = Array.isArray(d) ? d : [];
    const el = document.getElementById('finLancList');
    if (!items.length) { el.innerHTML = '<div class="empty-state">Nenhum lancamento neste mes.</div>'; return; }
    // Carregar contas para o select do form
    const contas = await api({ action: 'fin_plano_contas_list' });
    const sel = document.getElementById('flConta');
    if (sel && sel.options.length <= 1) {
      sel.innerHTML = '<option value="">-- conta --</option>' + (Array.isArray(contas)?contas:[]).map(c => `<option value="${c.id}">${esc(c.codigo||'')} ${esc(c.nome)}</option>`).join('');
    }
    const fmtR = v => 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2});
    el.innerHTML = items.map(l => `<div style="display:flex;align-items:center;gap:12px;padding:12px;background:#fff;border:1px solid var(--border);border-left:4px solid ${l.tipo==='receita'?'#2d7a3a':'#e53e3e'};border-radius:8px;margin-bottom:6px;">
      <div style="flex:1;">
        <div style="font-weight:600;font-size:13px;">${esc(l.descricao)}</div>
        <div style="font-size:11px;color:var(--muted);">${l.fin_plano_contas?.nome||'—'} · ${l.fornecedor||'—'} · ${new Date(l.data_lancamento+'T12:00:00').toLocaleDateString('pt-BR')}</div>
      </div>
      <div style="font-size:15px;font-weight:700;color:${l.tipo==='receita'?'#2d7a3a':'#e53e3e'};">${l.tipo==='receita'?'+':'−'} ${fmtR(l.valor)}</div>
      <span style="font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;${l.status==='pago'?'background:#edf7f0;color:#2d7a3a;':l.status==='atrasado'?'background:#fdf0f2;color:#a00d24;':'background:#fff8e1;color:#b07d00;'}">${l.status}</span>
      ${l.status==='pendente'?`<button onclick="pagarFinLanc('${l.id}')" style="padding:3px 8px;background:#2d7a3a;color:#fff;border:none;border-radius:5px;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;">Pagar</button>`:''}
    </div>`).join('');
  }

  async function salvarFinLanc() {
    const d = await api({ action:'fin_lancamento_save', tipo:document.getElementById('flTipo').value, conta_id:document.getElementById('flConta').value||null, descricao:document.getElementById('flDesc').value.trim(), valor:document.getElementById('flValor').value, data_lancamento:document.getElementById('flData').value, data_vencimento:document.getElementById('flVenc').value||null, fornecedor:document.getElementById('flForn').value.trim()||null });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Lancamento salvo!','success'); toggleFinLancForm(); loadFinLancamentos();
  }
  async function pagarFinLanc(id) { await api({ action:'fin_lancamento_pagar', id }); showToast('Pago!','success'); loadFinLancamentos(); }

  var _finMensCurrentTab = 'preview';
  var _finMensPreviewData = [];
  var _finMensBoletosData = [];
  var _finMensPreviewSort = { col: 'nome', asc: true };
  var _finMensBoletosSort = { col: 'nome', asc: true };
  const _fmtR = v => 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2});
  const _catIcon = c => c==='mensalidade'?'📚':c==='alimentacao'?'🍽️':c==='atividade_extra'?'⚽':c==='ajuste'?'🏷️':'📋';

  function switchFinMensTab(tab) {
    _finMensCurrentTab = tab;
    document.getElementById('finMensPreviewSection').style.display = tab === 'preview' ? 'block' : 'none';
    document.getElementById('finMensBoletosSection').style.display = tab === 'boletos' ? 'block' : 'none';
    const tPrev = document.getElementById('finMensTabPreview');
    const tBol = document.getElementById('finMensTabBoletos');
    const acRed = '#C8102E';
    tPrev.style.color = tab === 'preview' ? acRed : '#888';
    tPrev.style.borderColor = tab === 'preview' ? acRed : '#ddd';
    tPrev.style.borderBottomColor = tab === 'preview' ? acRed : 'transparent';
    tPrev.style.boxShadow = tab === 'preview' ? '0 2px 8px rgba(0,0,0,0.08)' : 'none';
    tBol.style.color = tab === 'boletos' ? acRed : '#888';
    tBol.style.borderColor = tab === 'boletos' ? acRed : '#ddd';
    tBol.style.borderBottomColor = tab === 'boletos' ? acRed : 'transparent';
    tBol.style.boxShadow = tab === 'boletos' ? '0 2px 8px rgba(0,0,0,0.08)' : 'none';
    if (tab === 'boletos') loadFinMensBoletos();
  }

  function finMensToggleAll(checked) {
    document.querySelectorAll('.fmens-chk').forEach(c => { if (!c.disabled) c.checked = checked; });
    _finMensUpdateSelCount();
  }
  function _finMensUpdateSelCount() {
    const checked = document.querySelectorAll('.fmens-chk:checked');
    const el = document.getElementById('finMensSelCount');
    if (el) el.textContent = checked.length > 0 ? checked.length + ' selecionado(s)' : '';
  }
  function _finMensGetSelectedIds(cls) {
    return [...document.querySelectorAll((cls||'.fmens-chk')+':checked')].map(c => c.value);
  }

  function sortFinMensPreview(col) {
    if (_finMensPreviewSort.col === col) _finMensPreviewSort.asc = !_finMensPreviewSort.asc;
    else { _finMensPreviewSort.col = col; _finMensPreviewSort.asc = true; }
    renderFinMensPreview();
  }
  function sortFinMensBoletos(col) {
    if (_finMensBoletosSort.col === col) _finMensBoletosSort.asc = !_finMensBoletosSort.asc;
    else { _finMensBoletosSort.col = col; _finMensBoletosSort.asc = true; }
    renderFinMensBoletos();
  }
  function _sortIcon(sortState, col) {
    if (sortState.col !== col) return ' ↕';
    return sortState.asc ? ' ↑' : ' ↓';
  }

  async function loadFinMensalidades() {
    const mes = document.getElementById('finMensMes').value || new Date().toISOString().slice(0,7);
    if (!document.getElementById('finMensMes').value) monthNavSet('finMensMes', mes);
    const kpiEl = document.getElementById('finMensKpis');
    const previewEl = document.getElementById('finMensPreview');
    const batchPendEl = document.getElementById('finMensBatchPending');
    previewEl.innerHTML = '<div class="empty-state">Carregando mensalidades...</div>';
    const [previewData, batchesData] = await Promise.all([
      apiFinExt({ action:'mensalidades_preview', mes_referencia: mes }),
      apiFinExt({ action:'boletos_batch_list' })
    ]);
    _finMensPreviewData = previewData?.alunos || previewData?.data?.alunos || [];
    const totais = previewData?.totais || previewData?.data?.totais || {};
    const allBatches = Array.isArray(batchesData) ? batchesData : (batchesData?.data || []);
    const mesBatches = allBatches.filter(b => b.mes_referencia === mes);
    const pendingBatches = mesBatches.filter(b => b.status === 'aguardando_aprovacao');
    // KPIs
    const comBoleto = totais.com_boleto || 0;
    const semBoleto = _finMensPreviewData.filter(a => !a.boleto_status).length;
    kpiEl.innerHTML = `
      <div class="card" style="padding:12px;border-left:4px solid var(--accent);"><div style="font-size:20px;font-weight:700;">${totais.alunos||0}</div><div style="font-size:11px;color:var(--muted);">Alunos ativos</div></div>
      <div class="card" style="padding:12px;border-left:4px solid #1a6bb5;"><div style="font-size:20px;font-weight:700;">${_fmtR(totais.valor||0)}</div><div style="font-size:11px;color:var(--muted);">Total mensal previsto</div></div>
      <div class="card" style="padding:12px;border-left:4px solid #2d7a3a;"><div style="font-size:20px;font-weight:700;">${comBoleto}</div><div style="font-size:11px;color:var(--muted);">Com boleto emitido</div></div>
      <div class="card" style="padding:12px;border-left:4px solid ${semBoleto>0?'#d4830a':'var(--border)'};""><div style="font-size:20px;font-weight:700;${semBoleto>0?'color:#d4830a;':''}">${semBoleto}</div><div style="font-size:11px;color:var(--muted);">Sem boleto ainda</div></div>`;
    // Lotes aguardando aprovação — com edição inline
    window._batchEditCache = {};
    if (pendingBatches.length) {
      batchPendEl.style.display = 'block';
      batchPendEl.innerHTML = pendingBatches.map(b => {
        const items = b.fin_boleto_batch_items || b.itens || [];
        items.forEach(it => { window._batchEditCache[it.id] = JSON.parse(JSON.stringify(it.itens || [])); });
        const itensHtml = items.map((it,idx) => {
          const itArr = it.itens || [];
          const compRows = itArr.map((c,ci) =>
            `<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;" id="bi_${it.id}_row_${ci}">
              <span style="font-size:12px;">${_catIcon(c.categoria)}</span>
              <input type="text" value="${esc(c.nome)}" style="flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;font-family:inherit;" onchange="_batchItemNameChange('${it.id}',${ci},this.value)">
              <input type="number" value="${(c.valor||0).toFixed(2)}" step="0.01" style="width:90px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:11px;font-family:inherit;text-align:right;" onchange="_batchItemValorChange('${it.id}',${ci},this.value)">
              <button onclick="_batchItemRemove('${it.id}',${ci})" style="background:none;border:none;cursor:pointer;color:#EF4444;font-size:12px;" title="Remover">✕</button>
            </div>`
          ).join('');
          return `<tr style="border-bottom:1px solid #f5f0ea;">
            <td style="padding:8px;vertical-align:top;"><strong>${esc(it.crianca_nome||'—')}</strong><br><span style="font-size:11px;color:var(--muted);">${esc(it.familia_nome||'—')}</span></td>
            <td style="padding:8px;" id="bi_comp_${it.id}">${compRows}
              <button onclick="_batchItemAdd('${it.id}')" style="padding:2px 8px;font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-family:inherit;margin-top:2px;">+ item</button>
            </td>
            <td style="padding:8px;font-weight:700;text-align:right;vertical-align:top;" id="bi_total_${it.id}">${_fmtR(it.valor_total||0)}</td>
            <td style="padding:8px;vertical-align:top;"><button onclick="_batchItemSave('${it.id}')" style="padding:4px 10px;font-size:10px;background:var(--accent);color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit;font-weight:600;">Salvar</button></td>
          </tr>`;
        }).join('');
        return `<div class="card" style="border-left:4px solid #d4830a;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
            <div><span style="font-size:10px;padding:3px 10px;border-radius:10px;font-weight:600;background:#fff8e1;color:#b07d00;">Lote aguardando aprovação</span> <strong style="margin-left:8px;">${items.length} aluno(s)</strong> — <span style="font-weight:700;font-size:15px;" id="bi_batch_total_${b.id}">${_fmtR(b.valor_total||0)}</span></div>
            <div style="display:flex;gap:8px;">
              <button onclick="aprovarBatch('${b.id}')" class="btn-create" style="width:auto;padding:8px 18px;font-size:12px;">✅ Aprovar e Emitir</button>
              <button onclick="rejeitarBatch('${b.id}')" style="padding:8px 14px;background:none;border:1.5px solid var(--border);border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;">❌ Rejeitar</button>
            </div>
          </div>
          <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr>
            <th style="text-align:left;padding:8px;font-size:11px;font-weight:600;color:var(--muted);border-bottom:1.5px solid var(--border);">Aluno / Família</th>
            <th style="text-align:left;padding:8px;font-size:11px;font-weight:600;color:var(--muted);border-bottom:1.5px solid var(--border);">Composição (editável)</th>
            <th style="text-align:right;padding:8px;font-size:11px;font-weight:600;color:var(--muted);border-bottom:1.5px solid var(--border);">Valor</th>
            <th style="padding:8px;border-bottom:1.5px solid var(--border);width:60px;"></th>
          </tr></thead><tbody>${itensHtml}</tbody></table></div>
        </div>`;
      }).join('');
    } else { batchPendEl.style.display = 'none'; }
    renderFinMensPreview();
    switchFinMensTab(_finMensCurrentTab);
  }

  function _finMensFilterChanged() {
    if (_finMensCurrentTab === 'preview') renderFinMensPreview();
    else renderFinMensBoletos();
  }
  function _finMensGetBusca() {
    if (_finMensCurrentTab === 'boletos') return (document.getElementById('finBolBusca')?.value || '').trim().toLowerCase();
    return (document.getElementById('finMensBusca')?.value || '').trim().toLowerCase();
  }

  async function abrirFichaAlunoFinanceiro(alunoId) {
    if (!alunosData.length) await loadAlunos();
    var a = alunosData.find(function(x){return x.id===alunoId;});
    if (!a) { showToast('Aluno não encontrado','error'); return; }
    var modal = document.getElementById('finAlunoModal');
    if (!modal) {
      modal = document.createElement('div'); modal.id = 'finAlunoModal';
      modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
      modal.onclick = function(e){ if(e.target===modal) modal.style.display='none'; };
      document.addEventListener('keydown',function(e){ var m=document.getElementById('finAlunoModal'); if(e.key==='Escape'&&m&&m.style.display==='flex') m.style.display='none'; });
      document.body.appendChild(modal);
    }
    var ini = (a.nome||'??').split(' ').map(function(w){return w[0];}).join('').substring(0,2).toUpperCase();
    modal.innerHTML = '<div style="background:#fff;border-radius:14px;width:92%;max-width:920px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);font-family:inherit;">' +
      '<div style="padding:18px 24px;border-bottom:1px solid #eee;display:flex;align-items:center;gap:14px;position:sticky;top:0;background:#fff;border-radius:14px 14px 0 0;z-index:1;">' +
      '<div style="width:44px;height:44px;border-radius:50%;background:#fde8e8;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#C8102E;flex-shrink:0;">'+ini+'</div>' +
      '<div style="flex:1;min-width:0;"><div style="font-size:16px;font-weight:700;">'+esc(a.nome)+'</div><div style="font-size:12px;color:#888;">'+esc(a.serie||a.turma||'')+' \u00b7 '+esc(a.email||'')+' \u00b7 Resp: '+esc(a.responsavel_nome||a.resp_nome||'\u2014')+'</div></div>' +
      "<button onclick=\"document.getElementById('finAlunoModal').style.display='none'\" style=\"background:none;border:none;font-size:24px;cursor:pointer;color:#888;padding:4px 10px;\" title=\"Fechar (Esc)\">\u2715</button></div>" +
      '<div style="padding:24px;"><div id="fmKpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:20px;"></div><div id="fmBody"><div style="text-align:center;color:#888;padding:20px;">Carregando...</div></div><div id="fmAjustes" style="margin-top:16px;"></div></div></div>';
    modal.style.display = 'flex';
    _alunoFinAtual = a;
    var bols = await api({action:'fin_boletos_emitidos_list'});
    var bats = await apiFinExt({action:'boletos_batch_list'});
    var bList = (Array.isArray(bols)?bols:[]).filter(function(b){return b.crianca_nome===a.nome||b.aluno_id===a.id||b.familia_email===a.email;});
    var biArr = [];
    (Array.isArray(bats)?bats:(bats&&bats.data?bats.data:[])).forEach(function(bt){(bt.fin_boleto_batch_items||bt.itens||[]).forEach(function(it){if((it.crianca_nome===a.nome||it.aluno_id===a.id)&&(it.status==='aguardando'||it.status==='aprovado')){it._batch_mes=bt.mes_referencia;biArr.push(it);}});});
    bList.forEach(function(b){_cacheBoleto(b);});
    var tP=bList.filter(function(b){return b.status==='pago';}).reduce(function(s,b){return s+parseFloat(b.valor||0);},0);
    var tA=bList.filter(function(b){return b.status==='emitido';}).reduce(function(s,b){return s+parseFloat(b.valor||0);},0);
    var tV=bList.filter(function(b){return b.status==='emitido'&&b.vencimento<new Date().toISOString().slice(0,10);}).reduce(function(s,b){return s+parseFloat(b.valor||0);},0);
    var tPn=biArr.reduce(function(s,b){return s+parseFloat(b.valor_total||0);},0);
    document.getElementById('fmKpis').innerHTML =
      '<div class="card" style="padding:10px;border-left:3px solid #2d7a3a;"><div style="font-size:18px;font-weight:700;color:#2d7a3a;">'+_fmtR(tP)+'</div><div style="font-size:10px;color:#888;">Pago</div></div>' +
      '<div class="card" style="padding:10px;border-left:3px solid #1a6bb5;"><div style="font-size:18px;font-weight:700;color:#1a6bb5;">'+_fmtR(tA)+'</div><div style="font-size:10px;color:#888;">Em aberto</div></div>' +
      (tV>0?'<div class="card" style="padding:10px;border-left:3px solid #EF4444;"><div style="font-size:18px;font-weight:700;color:#EF4444;">'+_fmtR(tV)+'</div><div style="font-size:10px;color:#888;">Vencido</div></div>':'') +
      (tPn>0?'<div class="card" style="padding:10px;border-left:3px solid #d4830a;"><div style="font-size:18px;font-weight:700;color:#d4830a;">'+_fmtR(tPn)+'</div><div style="font-size:10px;color:#888;">Aguardando</div></div>':'');
    var h = '';
    window._fmBatchCache = {};
    if (biArr.length) {
      h += '<div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#d4830a;">Aguardando Aprova\u00e7\u00e3o (edit\u00e1vel)</div>';
      biArr.forEach(function(bi) {
        var arr = Array.isArray(bi.itens)?bi.itens:[];
        window._fmBatchCache[bi.id] = JSON.parse(JSON.stringify(arr));
        var vc = bi.vencimento?new Date(bi.vencimento+'T12:00:00').toLocaleDateString('pt-BR'):'\u2014';
        var canEdit = bi.status === 'aguardando';
        h += '<div class="card" style="padding:12px;margin-bottom:8px;border-left:3px solid #d4830a;">';
        h += '<div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span><strong>Lote '+esc(bi._batch_mes)+'</strong> \u00b7 Venc: '+vc+'</span><span style="font-weight:700;" id="fm_total_'+bi.id+'">'+_fmtR(bi.valor_total||0)+'</span></div>';
        arr.forEach(function(c,ci) {
          if (canEdit) {
            h += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">' +
              '<span style="font-size:12px;">'+_catIcon(c.categoria)+'</span>' +
              '<input type="text" value="'+esc(c.nome)+'" style="flex:1;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;font-family:inherit;" onchange="_fmItemNameChange(\''+bi.id+'\','+ci+',this.value)">' +
              '<input type="number" value="'+(c.valor||0).toFixed(2)+'" step="0.01" style="width:90px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;font-family:inherit;text-align:right;" onchange="_fmItemValorChange(\''+bi.id+'\','+ci+',this.value)">' +
              '<button onclick="_fmItemRemove(\''+bi.id+'\','+ci+',\''+a.id+'\')" style="background:none;border:none;cursor:pointer;color:#EF4444;font-size:12px;" title="Remover">\u2715</button></div>';
          } else {
            h += '<div style="display:flex;justify-content:space-between;font-size:11px;color:#888;"><span>'+_catIcon(c.categoria)+' '+esc(c.nome)+'</span><span>'+_fmtR(c.valor)+'</span></div>';
          }
        });
        if (canEdit) {
          h += '<div style="display:flex;gap:8px;margin-top:6px;">' +
            '<button onclick="_fmItemAdd(\''+bi.id+'\',\''+a.id+'\')" style="padding:3px 10px;font-size:10px;background:#f5f0ea;border:1px solid #e5e0d8;border-radius:4px;cursor:pointer;font-family:inherit;">+ item</button>' +
            '<button onclick="_fmItemSave(\''+bi.id+'\',\''+a.id+'\')" style="padding:3px 12px;font-size:10px;background:#5c6bc0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:inherit;font-weight:600;">Salvar</button></div>';
        }
        h += '</div>';
      });
    }
    if (bList.length) {
      bList.sort(function(x,y){return (y.vencimento||'').localeCompare(x.vencimento||'');});
      h += '<div style="font-size:13px;font-weight:700;margin:16px 0 8px;">Boletos Emitidos</div>';
      h += '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="border-bottom:2px solid #eee;"><th style="padding:6px;text-align:left;">Descri\u00e7\u00e3o</th><th style="padding:6px;text-align:center;">Venc.</th><th style="padding:6px;text-align:right;">Valor</th><th style="padding:6px;">Status</th><th style="padding:6px;">A\u00e7\u00f5es</th></tr></thead><tbody>';
      h += bList.map(function(b) {
        var vc = b.vencimento?new Date(b.vencimento+'T12:00:00').toLocaleDateString('pt-BR'):'\u2014';
        var isV = b.status==='emitido'&&b.vencimento<new Date().toISOString().slice(0,10);
        var bg = b.status==='pago'?'background:#edf7f0;color:#2d7a3a;':b.status==='cancelado'?'background:#f5f0ea;color:#888;':isV?'background:#fde8e8;color:#EF4444;':'background:#fff8e1;color:#b07d00;';
        var lb = b.status==='pago'?(b.baixa_manual?'Pago (manual)':'Pago'):b.status==='cancelado'?'Cancelado':isV?'Vencido':'Pendente';
        var ac = '';
        if (b.status==='emitido') ac += "<button onclick=\"alunoFinBaixaManual('"+b.id+"');setTimeout(function(){abrirFichaAlunoFinanceiro('"+a.id+"');},1500)\" style=\"padding:2px 6px;font-size:10px;background:#5c6bc0;color:#fff;border:none;border-radius:4px;cursor:pointer;\" title=\"Marcar pago\">\ud83d\udcb0</button> ";
        if (b.status!=='cancelado') {
          ac += "<button onclick=\"alunoFinBaixarPdf('"+b.id+"')\" style=\"padding:2px 6px;font-size:10px;background:#f5f0ea;border:1px solid #e5e0d8;border-radius:4px;cursor:pointer;\" title=\"PDF\">\ud83d\udcc4</button> ";
          ac += "<button onclick=\"alunoFinEnviarEmail('"+b.id+"','"+esc(b.familia_email||'')+"')\" style=\"padding:2px 6px;font-size:10px;background:#f5f0ea;border:1px solid #e5e0d8;border-radius:4px;cursor:pointer;\" title=\"Email\">\ud83d\udce7</button> ";
          ac += "<button onclick=\"alunoFinEnviarWhatsApp('"+b.id+"')\" style=\"padding:2px 6px;font-size:10px;background:#25D366;color:#fff;border:none;border-radius:4px;cursor:pointer;\" title=\"WhatsApp\">\ud83d\udcac</button>";
        }
        return '<tr style="border-bottom:1px solid #f0ece6;"><td style="padding:6px;">'+esc(b.descricao||'\u2014')+'</td><td style="padding:6px;text-align:center;">'+vc+'</td><td style="padding:6px;text-align:right;font-weight:700;">'+_fmtR(b.valor)+'</td><td style="padding:6px;"><span style="font-size:10px;padding:2px 6px;border-radius:8px;font-weight:600;'+bg+'">'+lb+'</span></td><td style="padding:6px;white-space:nowrap;">'+ac+'</td></tr>';
      }).join('');
      h += '</tbody></table>';
    }
    if (!bList.length && !biArr.length) h = '<div style="text-align:center;color:#888;padding:20px;">Nenhuma cobran\u00e7a registrada.</div>';
    document.getElementById('fmBody').innerHTML = h;
    try {
      var aj = await apiFinExt({action:'fin_ajustes_list',aluno_id:a.id});
      var ajL = (Array.isArray(aj)?aj:(aj&&aj.data?aj.data:[])).filter(function(x){return x.ativo;});
      var ajEl = document.getElementById('fmAjustes');
      if (ajL.length) {
        ajEl.innerHTML = '<div style="font-size:13px;font-weight:700;margin-bottom:8px;color:#d4830a;">Ajustes Recorrentes</div>' +
          ajL.map(function(x){return '<div style="display:flex;justify-content:space-between;padding:6px 10px;background:#faf8f5;border-radius:6px;margin-bottom:4px;font-size:12px;"><span>'+esc(x.descricao||x.tipo)+' <span style="color:#888;">('+esc(x.categoria_aplicacao||'total')+')</span></span><span style="font-weight:600;color:'+(x.tipo.indexOf('desconto')>=0?'#EF4444':'#2d7a3a')+';">'+((x.tipo.indexOf('percentual')>=0)?x.valor+'%':_fmtR(x.valor))+'</span></div>';}).join('');
      } else { ajEl.innerHTML = ''; }
    } catch(e) { /* best-effort */ }
  }
  function _fmRecalc(biId) {
    var itens = window._fmBatchCache[biId] || [];
    var total = Math.max(0, Math.round(itens.reduce(function(s,it){return s+(parseFloat(it.valor)||0);},0)*100)/100);
    var el = document.getElementById('fm_total_'+biId);
    if (el) el.textContent = _fmtR(total);
  }
  function _fmItemValorChange(biId, idx, val) {
    if (!window._fmBatchCache[biId]) return;
    window._fmBatchCache[biId][idx].valor = parseFloat(val) || 0;
    _fmRecalc(biId);
  }
  function _fmItemNameChange(biId, idx, val) {
    if (!window._fmBatchCache[biId]) return;
    window._fmBatchCache[biId][idx].nome = val;
  }
  function _fmItemRemove(biId, idx, alunoId) {
    if (!window._fmBatchCache[biId]) return;
    window._fmBatchCache[biId].splice(idx, 1);
    abrirFichaAlunoFinanceiro(alunoId);
  }
  function _fmItemAdd(biId, alunoId) {
    if (!window._fmBatchCache[biId]) window._fmBatchCache[biId] = [];
    window._fmBatchCache[biId].push({nome:'Novo item',valor:0,categoria:'extra'});
    abrirFichaAlunoFinanceiro(alunoId);
  }
  async function _fmItemSave(biId, alunoId) {
    var itens = window._fmBatchCache[biId] || [];
    var total = Math.max(0, Math.round(itens.reduce(function(s,it){return s+(parseFloat(it.valor)||0);},0)*100)/100);
    var desc = itens.map(function(it){return it.nome+': R$'+(it.valor||0).toFixed(2);}).join(' | ');
    showToast('Salvando...','info');
    var d = await apiFinExt({action:'boletos_batch_item_edit',id:biId,valor_total:total,itens:itens,descricao_detalhada:desc});
    if (d && d.error) { showToast('Erro: '+d.error,'error'); return; }
    showToast('Atualizado! Total: '+_fmtR(total),'success');
    abrirFichaAlunoFinanceiro(alunoId);
    loadFinMensalidades();
  }

  // ── Batch item inline editing ──
  function _batchItemRecalc(biId) {
    const itens = window._batchEditCache[biId] || [];
    const total = Math.max(0, Math.round(itens.reduce((s,it) => s + (parseFloat(it.valor)||0), 0) * 100) / 100);
    const el = document.getElementById('bi_total_' + biId);
    if (el) el.textContent = _fmtR(total);
  }
  function _batchItemValorChange(biId, idx, val) {
    if (!window._batchEditCache[biId]) return;
    window._batchEditCache[biId][idx].valor = parseFloat(val) || 0;
    _batchItemRecalc(biId);
  }
  function _batchItemNameChange(biId, idx, val) {
    if (!window._batchEditCache[biId]) return;
    window._batchEditCache[biId][idx].nome = val;
  }
  function _batchItemRemove(biId, idx) {
    if (!window._batchEditCache[biId]) return;
    window._batchEditCache[biId].splice(idx, 1);
    loadFinMensalidades(); // re-render to update DOM
  }
  function _batchItemAdd(biId) {
    if (!window._batchEditCache[biId]) window._batchEditCache[biId] = [];
    window._batchEditCache[biId].push({ nome: 'Novo item', valor: 0, categoria: 'extra' });
    loadFinMensalidades();
  }
  async function _batchItemSave(biId) {
    const itens = window._batchEditCache[biId] || [];
    const total = Math.max(0, Math.round(itens.reduce((s,it) => s + (parseFloat(it.valor)||0), 0) * 100) / 100);
    const desc = itens.map(it => it.nome + ': R$' + (it.valor||0).toFixed(2)).join(' | ');
    showToast('Salvando...', 'info');
    const d = await apiFinExt({ action:'boletos_batch_item_edit', id: biId, valor_total: total, itens: itens, descricao_detalhada: desc });
    if (d && d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast('Item atualizado! Total: ' + _fmtR(total), 'success');
    loadFinMensalidades();
  }

  function renderFinMensPreview() {
    const el = document.getElementById('finMensPreview');
    const busca = _finMensGetBusca();
    let data = [..._finMensPreviewData];
    if (busca) data = data.filter(a => (a.nome||'').toLowerCase().includes(busca) || (a.resp_nome||'').toLowerCase().includes(busca) || (a.familia_email||'').toLowerCase().includes(busca) || (a.serie||'').toLowerCase().includes(busca));
    if (!data.length) { el.innerHTML = '<div class="empty-state">Nenhum aluno ativo encontrado.</div>'; return; }
    const s = _finMensPreviewSort;
    data.sort((a,b) => {
      let va, vb;
      if (s.col==='nome') { va=a.nome||''; vb=b.nome||''; }
      else if (s.col==='turno') { va=a.turno||''; vb=b.turno||''; }
      else if (s.col==='valor') { va=a.valor_total||0; vb=b.valor_total||0; }
      else if (s.col==='vencimento') { va=a.vencimento||''; vb=b.vencimento||''; }
      else if (s.col==='status') { va=a.boleto_status||''; vb=b.boleto_status||''; }
      else { va=a.nome||''; vb=b.nome||''; }
      if (typeof va === 'number') return s.asc ? va-vb : vb-va;
      return s.asc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    const thS = 'padding:10px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);cursor:pointer;user-select:none;white-space:nowrap;';
    el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
      <span id="finMensSelCount" style="font-size:12px;font-weight:600;color:var(--accent);"></span>
    </div>
    <div style="margin-bottom:10px;"><input type="text" id="finMensBusca" placeholder="Buscar aluno, família ou CPF..." oninput="_finMensFilterChanged()" style="padding:8px 14px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;width:280px;"></div>
    <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr>
      <th style="${thS}text-align:center;width:70px;"><input type="checkbox" onchange="finMensToggleAll(this.checked)" style="cursor:pointer;"></th>
      <th style="${thS}text-align:left;" onclick="sortFinMensPreview('nome')">Aluno${_sortIcon(s,'nome')}</th>
      <th style="${thS}text-align:left;" onclick="sortFinMensPreview('turno')">Turno${_sortIcon(s,'turno')}</th>
      <th style="${thS}text-align:left;">Composição</th>
      <th style="${thS}text-align:right;" onclick="sortFinMensPreview('valor')">Valor${_sortIcon(s,'valor')}</th>
      <th style="${thS}text-align:left;" onclick="sortFinMensPreview('vencimento')">Vencimento${_sortIcon(s,'vencimento')}</th>
      <th style="${thS}text-align:left;" onclick="sortFinMensPreview('status')">Boleto${_sortIcon(s,'status')}</th>
    </tr></thead><tbody>${data.map((a,idx) => {
      const hasBoleto = !!a.boleto_status && a.boleto_status !== 'cancelado';
      const composicao = (a.itens||[]).map(it => `<div style="display:flex;justify-content:space-between;gap:6px;"><span>${_catIcon(it.categoria)} ${esc(it.nome)}</span>${a.itens.length > 1 ? `<span style="font-weight:600;white-space:nowrap;font-size:10px;color:var(--muted);">${_fmtR(it.valor)}</span>` : ''}</div>`).join('');
      const bS = a.boleto_status;
      const bBadge = bS==='pago'?'background:#edf7f0;color:#2d7a3a;':bS==='emitido'?'background:#fff8e1;color:#b07d00;':bS==='cancelado'?'background:#f5f0ea;color:var(--muted);':'';
      const bLabel = bS==='pago'?'Pago':bS==='emitido'?'Emitido':bS==='cancelado'?'Cancelado':'';
      return `<tr style="border-bottom:1px solid #f5f0ea;cursor:pointer;" ondblclick="abrirFichaAlunoFinanceiro('${a.aluno_id}')">
        <td style="padding:10px;text-align:center;"><span style="font-size:12px;color:var(--muted);margin-right:6px;min-width:18px;display:inline-block;text-align:right;">${idx+1}</span><input type="checkbox" class="fmens-chk" value="${a.aluno_id}" ${hasBoleto?'disabled title="Já tem boleto"':''} onchange="_finMensUpdateSelCount()" style="cursor:pointer;" onclick="event.stopPropagation()"></td>
        <td style="padding:10px;"><div style="font-weight:600;font-size:13px;">${esc(a.nome)}</div><div style="font-size:11px;color:var(--muted);">${esc(a.resp_nome||a.familia_email||'')}</div></td>
        <td style="padding:10px;font-size:12px;">${esc(a.serie||'—')}<br><span style="color:var(--muted);">${esc(a.turno||'—')}</span></td>
        <td style="padding:10px;font-size:11px;">${composicao}</td>
        <td style="padding:10px;font-weight:700;text-align:right;font-size:14px;">${_fmtR(a.valor_total)}</td>
        <td style="padding:10px;font-size:12px;">${a.vencimento ? new Date(a.vencimento+'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
        <td style="padding:10px;">${bLabel ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;${bBadge}">${bLabel}</span>` : '<span style="font-size:10px;color:var(--muted);">—</span>'}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function finBolToggleAll(checked) {
    document.querySelectorAll('.fbol-chk').forEach(c => c.checked = checked);
    _finBolUpdateSelCount();
  }
  function _finBolUpdateSelCount() {
    const n = document.querySelectorAll('.fbol-chk:checked').length;
    const el = document.getElementById('finBolSelCount');
    if (el) el.textContent = n > 0 ? n + ' selecionado(s)' : '';
    const btn = document.getElementById('finBolBulkEmailBtn');
    if (btn) btn.style.display = n > 0 ? 'inline-block' : 'none';
  }
  async function finBolEnviarEmailBatch() {
    const ids = _finMensGetSelectedIds('.fbol-chk');
    if (!ids.length) { showToast('Selecione boletos primeiro.', 'error'); return; }
    if (!await _lumiedConfirm('Enviar ' + ids.length + ' boleto(s) por email?')) return;
    showToast('Enviando ' + ids.length + ' email(s)...', 'info');
    const d = await api({ action:'fin_boletos_enviar_email_batch', ids });
    if (d && d.error) { showToast(d.error, 'error'); return; }
    showToast(d.enviados + ' email(s) enviado(s)' + (d.erros > 0 ? ', ' + d.erros + ' erro(s)' : ''), d.erros > 0 ? 'warning' : 'success');
  }

  async function loadFinMensBoletos() {
    const mes = document.getElementById('finMensMes').value || new Date().toISOString().slice(0,7);
    const el = document.getElementById('finMensList');
    el.innerHTML = '<div class="empty-state">Carregando boletos...</div>';
    const boletosData = await api({ action:'fin_boletos_emitidos_list', mes });
    _finMensBoletosData = Array.isArray(boletosData) ? boletosData : [];
    _finMensBoletosData.forEach(b => _cacheBoleto(b));
    renderFinMensBoletos();
  }

  function renderFinMensBoletos() {
    const el = document.getElementById('finMensList');
    const busca = _finMensGetBusca();
    let boletos = [..._finMensBoletosData];
    if (busca) boletos = boletos.filter(b => (b.crianca_nome||'').toLowerCase().includes(busca) || (b.familia_nome||'').toLowerCase().includes(busca) || (b.familia_email||'').toLowerCase().includes(busca) || (b.cpf_pagador||'').toLowerCase().includes(busca));
    if (!boletos.length) { el.innerHTML = '<div class="empty-state">Nenhum boleto emitido para este mês.</div>'; return; }
    const s = _finMensBoletosSort;
    boletos.sort((a,b) => {
      let va, vb;
      if (s.col==='nome') { va=(a.crianca_nome||a.familia_nome||''); vb=(b.crianca_nome||b.familia_nome||''); }
      else if (s.col==='vencimento') { va=a.vencimento||''; vb=b.vencimento||''; }
      else if (s.col==='valor') { va=parseFloat(a.valor||0); vb=parseFloat(b.valor||0); }
      else if (s.col==='status') { va=a.status||''; vb=b.status||''; }
      else { va=(a.crianca_nome||''); vb=(b.crianca_nome||''); }
      if (typeof va === 'number') return s.asc ? va-vb : vb-va;
      return s.asc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    const qtyEmitido = boletos.filter(b=>b.status==='emitido').length;
    const qtyPago = boletos.filter(b=>b.status==='pago').length;
    const thS = 'padding:10px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);cursor:pointer;user-select:none;white-space:nowrap;';
    el.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
      <span style="font-size:12px;color:var(--muted);">${boletos.length} boleto(s) · ${qtyPago} pago(s) · ${qtyEmitido} pendente(s)</span>
      <span id="finBolSelCount" style="font-size:12px;font-weight:600;color:var(--accent);"></span>
      <button id="finBolBulkEmailBtn" onclick="finBolEnviarEmailBatch()" style="display:none;padding:5px 14px;font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:600;">📧 Enviar selecionados por email</button>
    </div>
    <div style="margin-bottom:10px;"><input type="text" id="finBolBusca" placeholder="Buscar aluno, família ou CPF..." oninput="_finMensFilterChanged()" style="padding:8px 14px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;width:280px;"></div>
    <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr>
      <th style="${thS}text-align:center;width:70px;"><input type="checkbox" onchange="finBolToggleAll(this.checked)" style="cursor:pointer;"></th>
      <th style="${thS}text-align:left;" onclick="sortFinMensBoletos('nome')">Aluno${_sortIcon(s,'nome')}</th>
      <th style="${thS}text-align:left;" onclick="sortFinMensBoletos('vencimento')">Vencimento${_sortIcon(s,'vencimento')}</th>
      <th style="${thS}text-align:right;" onclick="sortFinMensBoletos('valor')">Valor${_sortIcon(s,'valor')}</th>
      <th style="${thS}text-align:left;" onclick="sortFinMensBoletos('status')">Status${_sortIcon(s,'status')}</th>
      <th style="${thS}text-align:left;">Ações</th>
    </tr></thead><tbody>${boletos.map((b,idx) => {
      const isManual = b.baixa_manual === true;
      const isVencido = b.status==='emitido' && b.vencimento < new Date().toISOString().slice(0,10);
      const badgeStyle = b.status==='pago'&&isManual?'background:#e8eaf6;color:#5c6bc0;border:1px solid #c5cae9;':b.status==='pago'?'background:#edf7f0;color:#2d7a3a;':b.status==='cancelado'?'background:#f5f0ea;color:var(--muted);':isVencido?'background:#fde8e8;color:#EF4444;':'background:#fff8e1;color:#b07d00;';
      const statusLabel = b.status==='pago'&&isManual?'Pago (manual)':b.status==='pago'?'Pago':b.status==='cancelado'?'Cancelado':isVencido?'Vencido':'Pendente';
      let acoes = '<div style="display:flex;flex-wrap:wrap;gap:3px;">';
      if (b.status==='emitido') {
        acoes += `<button onclick="alunoFinBaixaManual('${b.id}')" style="padding:3px 8px;font-size:10px;background:#5c6bc0;color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit;font-weight:600;" title="Marcar pago">💰 Pagar</button>`;
        acoes += `<button onclick="alunoFinCancelar('${b.id}')" style="padding:3px 8px;font-size:10px;background:#EF4444;color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit;" title="Cancelar">✕</button>`;
      }
      if (b.status!=='cancelado') {
        acoes += `<button onclick="alunoFinBaixarPdf('${b.id}')" style="padding:3px 8px;font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:5px;cursor:pointer;font-family:inherit;" title="Baixar PDF">📄 PDF</button>`;
        acoes += `<button onclick="alunoFinEnviarEmail('${b.id}','${esc(b.familia_email||'')}')" style="padding:3px 8px;font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:5px;cursor:pointer;font-family:inherit;" title="Enviar por email">📧</button>`;
        acoes += `<button onclick="alunoFinEnviarWhatsApp('${b.id}')" style="padding:3px 8px;font-size:10px;background:#25D366;color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit;" title="Enviar via WhatsApp">💬</button>`;
      }
      if (b.pix_copia_cola) acoes += `<button onclick="navigator.clipboard.writeText('${esc(b.pix_copia_cola)}');showToast('PIX copiado!','success')" style="padding:3px 8px;font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:5px;cursor:pointer;font-family:inherit;" title="Copiar PIX">📋 PIX</button>`;
      acoes += '</div>';
      const linhaCompacta = b.linha_digitavel ? `<div style="font-size:9px;color:var(--muted);font-family:monospace;margin-top:3px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;" onclick="navigator.clipboard.writeText('${esc(b.linha_digitavel)}');showToast('Linha digitável copiada!','success')" title="${esc(b.linha_digitavel)}">${esc(b.linha_digitavel)}</div>` : '';
      return `<tr style="border-bottom:1px solid #f5f0ea;${isManual?'background:#f5f5ff;':''}">
        <td style="padding:10px;text-align:center;"><span style="font-size:12px;color:var(--muted);margin-right:6px;min-width:18px;display:inline-block;text-align:right;">${idx+1}</span><input type="checkbox" class="fbol-chk" value="${b.id}" onchange="_finBolUpdateSelCount()" style="cursor:pointer;"></td>
        <td style="padding:10px;"><div style="font-weight:600;font-size:13px;">${esc(b.crianca_nome||b.familia_nome||b.cpf_pagador)}</div><div style="font-size:11px;color:var(--muted);">${esc(b.familia_nome||b.familia_email||'')}</div>${linhaCompacta}</td>
        <td style="padding:10px;font-size:12px;">${b.vencimento ? new Date(b.vencimento+'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
        <td style="padding:10px;font-weight:700;text-align:right;">${_fmtR(b.valor)}</td>
        <td style="padding:10px;"><span style="font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;${badgeStyle}">${statusLabel}</span></td>
        <td style="padding:10px;">${acoes}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  }

  async function gerarLoteMensalidades() {
    const mes = document.getElementById('finMensMes').value || new Date().toISOString().slice(0,7);
    const selectedIds = _finMensGetSelectedIds('.fmens-chk');
    const allSemBoleto = _finMensPreviewData.filter(a => !a.boleto_status || a.boleto_status === 'cancelado');
    const useSelection = selectedIds.length > 0;
    const count = useSelection ? selectedIds.length : allSemBoleto.length;
    if (count === 0) { showToast('Todos os alunos já possuem boleto neste mês.', 'info'); return; }
    const msg = useSelection
      ? 'Gerar boletos para ' + count + ' aluno(s) selecionado(s) em ' + mes + '?'
      : 'Gerar boletos para todos os ' + count + ' aluno(s) sem boleto em ' + mes + '?';
    if (!await _lumiedConfirm(msg)) return;
    showToast('Gerando lote...', 'info');
    const params = { action:'boletos_gerar_batch_manual', mes_referencia: mes };
    if (useSelection) params.aluno_ids = selectedIds;
    const d = await apiFinExt(params);
    if (d && d.error) { showToast(d.error, 'error'); return; }
    let result = (d.total_alunos||0) + ' aluno(s) incluído(s) no lote';
    if (d.pulados) result += ' (' + d.pulados + ' já tinham boleto)';
    if (d.total_alunos === 0) result = d.message || 'Nenhum aluno para gerar boleto.';
    showToast(result, d.total_alunos > 0 ? 'success' : 'info', 5000);
    loadFinMensalidades();
  }

  async function loadFinContas() {
    const d = await api({ action:'fin_plano_contas_list' });
    const items = Array.isArray(d) ? d : [];
    document.getElementById('finContasList').innerHTML = items.length ? items.map(c => `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#fff;border:1px solid var(--border);border-left:4px solid ${c.tipo==='receita'?'#2d7a3a':'#e53e3e'};border-radius:8px;margin-bottom:4px;">
      <span style="font-size:12px;font-weight:700;color:var(--muted);min-width:40px;">${esc(c.codigo||'')}</span>
      <span style="font-size:13px;font-weight:600;flex:1;">${esc(c.nome)}</span>
      <span style="font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;${c.tipo==='receita'?'background:#edf7f0;color:#2d7a3a;':'background:#fdf0f2;color:#a00d24;'}">${c.tipo}</span>
    </div>`).join('') : '<div class="empty-state">Nenhuma conta cadastrada.</div>';
  }
  async function salvarFinConta() {
    const d = await api({ action:'fin_plano_contas_save', codigo:document.getElementById('fcCodigo').value.trim(), nome:document.getElementById('fcNome').value.trim(), tipo:document.getElementById('fcTipo').value });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Conta salva!','success'); toggleFinContaForm(); loadFinContas();
    document.getElementById('fcCodigo').value=''; document.getElementById('fcNome').value='';
  }


