// Auto-extraído do gerente.html (Onda 4 — quarta passada).
// Cluster financeiro-ext: inadimplência, histórico cobrança, descontos
// recorrentes, dashboard estendido, reajuste anual, export, recibos,
// fluxo de caixa, fechamento mensal, notif config, boletos em lote,
// folha de pagamento, conciliação sync. Funções chamadas via onclick
// e panel switcher 'finConciliacao'.
  // ═══ INADIMPLÊNCIA ═══
  async function loadInadimplencia() {
    var d = await apiFinExt({ action: 'inadimplencia_dashboard' });
    if (!d || d.error) { document.getElementById('inadimplBuckets').innerHTML = '<div class="empty-state">Erro ao carregar dados.</div>'; return; }
    var buckets = d.buckets || {};
    var ext = d.extrajudicial || { count: 0, total: 0 };
    document.getElementById('inadimplBuckets').innerHTML = `
      <div class="card" style="border-left:4px solid #EAB308;padding:12px;">
        <div style="font-size:24px;font-weight:700;color:#EAB308;">${buckets['7d']?.count || 0}</div>
        <div style="color:var(--muted);font-size:13px;">7 dias atraso</div>
        <div style="font-weight:600;">R$ ${(buckets['7d']?.total || 0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
      </div>
      <div class="card" style="border-left:4px solid #F97316;padding:12px;">
        <div style="font-size:24px;font-weight:700;color:#F97316;">${buckets['15d']?.count || 0}</div>
        <div style="color:var(--muted);font-size:13px;">15 dias atraso</div>
        <div style="font-weight:600;">R$ ${(buckets['15d']?.total || 0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
      </div>
      <div class="card" style="border-left:4px solid #EF4444;padding:12px;">
        <div style="font-size:24px;font-weight:700;color:#EF4444;">${buckets['28d']?.count || 0}</div>
        <div style="color:var(--muted);font-size:13px;">28+ dias atraso</div>
        <div style="font-weight:600;">R$ ${(buckets['28d']?.total || 0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
      </div>
      <div class="card" style="border-left:4px solid #7C3AED;padding:12px;">
        <div style="font-size:24px;font-weight:700;color:#7C3AED;">${ext.count}</div>
        <div style="color:var(--muted);font-size:13px;">Cobrança Extrajudicial</div>
        <div style="font-weight:600;">R$ ${(ext.total || 0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
      </div>`;
    var items = d.items || [];
    var tb = document.getElementById('inadimplTable');
    if (!items.length) { tb.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum inadimplente.</td></tr>'; return; }
    tb.innerHTML = items.map(function(i) {
      var color = i.bucket === '28d' ? '#EF4444' : i.bucket === '15d' ? '#F97316' : '#EAB308';
      var badge = i.status === 'cobranca_extrajudicial' ? 'badge-red' : i.status === 'resolvido' ? 'badge-green' : 'badge-orange';
      var email = esc(i.familia_email||'');
      var nome = esc(i.familia_nome||'—');
      var acoes = '<button class="btn btn-sm btn-outline" onclick="abrirHistoricoCobranca(\''+email+'\',\''+nome+'\')">📜 Histórico</button>'
        + (i.status !== 'resolvido' ? ' <button class="btn btn-sm" onclick="resolverInadimpl(\''+i.id+'\')">✅ Resolver</button>' : '');
      return '<tr><td>' + nome + '</td><td>' + esc(i.crianca_nome||'—') + '</td><td style="color:'+color+';font-weight:700;">' + i.dias_atraso + ' dias</td><td style="font-weight:600;">R$ ' + (i.valor_total_devedor||0).toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</td><td><span class="badge '+badge+'">' + esc(i.status) + '</span></td><td>' + acoes + '</td></tr>';
    }).join('');
  }
  async function resolverInadimpl(id) {
    if (!confirm('Marcar como resolvido?')) return;
    await apiFinExt({ action: 'inadimplencia_marcar_resolvido', id: id });
    showToast('Marcado como resolvido.');
    loadInadimplencia();
  }

  // ═══ HISTÓRICO DE COBRANÇA (envios + tratativas) ═══
  var _cobAtual = { email: null, nome: null };

  function abrirHistoricoCobranca(email, nome) {
    _cobAtual = { email: email, nome: nome };
    document.getElementById('cobModalNome').textContent = nome || '—';
    document.getElementById('cobModalEmail').textContent = email || '';
    document.getElementById('tratObs').value = '';
    document.getElementById('tratValor').value = '';
    document.getElementById('tratDataPrevista').value = '';
    document.getElementById('tratTipo').value = 'nota';
    document.getElementById('cobModal').style.display = 'flex';
    carregarTimelineCobranca();
  }
  function fecharHistoricoCobranca() {
    document.getElementById('cobModal').style.display = 'none';
  }
  async function carregarTimelineCobranca() {
    var el = document.getElementById('cobTimeline');
    el.innerHTML = '<div class="empty-state">Carregando...</div>';
    var d = await apiCobranca({ action: 'cobranca_timeline', familia_email: _cobAtual.email, limite: 200 });
    var items = (d && d.data) || [];
    if (!items.length) { el.innerHTML = '<div class="empty-state">Nenhum evento registrado.</div>'; return; }
    el.innerHTML = items.map(function(ev) {
      var isEnvio = ev.tipo_evento === 'envio';
      var icon = isEnvio ? (ev.canal_ou_tipo === 'email_advogado' ? '⚖️' : ev.canal_ou_tipo === 'email' ? '📧' : ev.canal_ou_tipo === 'whatsapp' ? '💬' : '📤') : '🗣️';
      var cor = isEnvio ? (ev.status === 'erro' ? '#EF4444' : '#2563EB') : '#16A34A';
      var data = new Date(ev.ocorrido_em).toLocaleString('pt-BR');
      var autor = isEnvio ? ('Automático · ' + esc(ev.canal_ou_tipo||'')) : (esc(ev.usuario_nome||'—') + (ev.extras && ev.extras.usuario_papel ? ' ('+esc(ev.extras.usuario_papel)+')' : ''));
      var extraHtml = '';
      if (isEnvio && ev.extras) {
        if (ev.extras.aberto_em) extraHtml += '<span style="color:#16A34A;font-size:11px;margin-left:6px;">✓ aberto</span>';
        if (ev.extras.erro_msg) extraHtml += '<div style="color:#EF4444;font-size:12px;margin-top:4px;">Erro: '+esc(ev.extras.erro_msg)+'</div>';
      }
      if (!isEnvio && ev.extras) {
        if (ev.extras.data_prevista_pagamento) extraHtml += '<div style="font-size:12px;color:var(--muted);margin-top:4px;">📅 Prevista: '+esc(ev.extras.data_prevista_pagamento)+'</div>';
        if (ev.extras.valor_negociado) extraHtml += '<div style="font-size:12px;color:var(--muted);">💰 Negociado: R$ '+Number(ev.extras.valor_negociado).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</div>';
      }
      var acoes = !isEnvio ? ' <button style="background:none;border:0;color:#EF4444;font-size:11px;cursor:pointer;" onclick="removerTratativa(\''+ev.evento_id+'\')">remover</button>' : '';
      return '<div class="card" style="padding:10px 12px;margin-bottom:8px;border-left:3px solid '+cor+';">'
        + '<div style="display:flex;justify-content:space-between;gap:8px;"><strong>'+icon+' '+esc(ev.titulo||'—')+'</strong><span style="color:var(--muted);font-size:12px;">'+data+'</span></div>'
        + '<div style="color:var(--muted);font-size:12px;margin:2px 0 6px;">'+autor+acoes+'</div>'
        + '<div style="white-space:pre-wrap;font-size:13px;">'+esc(ev.conteudo||'')+'</div>'
        + extraHtml
        + '</div>';
    }).join('');
  }
  async function salvarTratativa() {
    var obs = document.getElementById('tratObs').value.trim();
    if (!obs) { showToast('Digite uma observação.'); return; }
    var payload = {
      action: 'tratativa_create',
      familia_email: _cobAtual.email,
      tipo: document.getElementById('tratTipo').value,
      observacao: obs,
    };
    var dp = document.getElementById('tratDataPrevista').value;
    if (dp) payload.data_prevista_pagamento = dp;
    var vn = document.getElementById('tratValor').value;
    if (vn) payload.valor_negociado = parseFloat(vn);
    var d = await apiCobranca(payload);
    if (d && d.error) { showToast('Erro: ' + d.error); return; }
    document.getElementById('tratObs').value = '';
    document.getElementById('tratValor').value = '';
    document.getElementById('tratDataPrevista').value = '';
    showToast('Tratativa registrada.');
    carregarTimelineCobranca();
  }
  async function removerTratativa(id) {
    if (!confirm('Remover esta tratativa?')) return;
    var d = await apiCobranca({ action: 'tratativa_delete', id: id });
    if (d && d.error) { showToast('Erro: ' + d.error); return; }
    carregarTimelineCobranca();
  }

  // ═══ DESCONTOS & AJUSTES RECORRENTES ═══
  function toggleNovoAjuste() {
    var el = document.getElementById('novoAjusteForm');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
    if (el.style.display === 'block') {
      // Popular dropdown de alunos
      var sel = document.getElementById('ajAluno');
      sel.innerHTML = '<option value="">Selecione...</option>';
      (alunosData||[]).filter(function(a){return a.ativo!==false;}).forEach(function(a){
        sel.innerHTML += '<option value="'+a.id+'" data-nome="'+esc(a.nome)+'">'+esc(a.nome)+' — '+esc(a.serie||a.turno||'')+'</option>';
      });
    }
  }
  async function salvarAjuste() {
    var sel = document.getElementById('ajAluno');
    var alunoId = sel.value;
    var alunoNome = sel.selectedOptions[0]?.dataset?.nome || '';
    var tipo = document.getElementById('ajTipo').value;
    var valor = document.getElementById('ajValor').value;
    var desc = document.getElementById('ajDesc').value.trim();
    var cat = document.getElementById('ajCategoria').value;
    var dataFim = document.getElementById('ajDataFim').value || null;
    var errEl = document.getElementById('ajErr');
    errEl.classList.remove('show');
    if (!alunoId || !valor || !desc) { errEl.textContent='Preencha aluno, valor e descrição.'; errEl.classList.add('show'); return; }
    var btn = document.getElementById('ajBtn');
    btn.disabled=true; btn.textContent='Salvando...';
    var d = await apiFinExt({ action:'fin_ajuste_create', aluno_id:alunoId, aluno_nome:alunoNome, tipo:tipo, valor:valor, descricao:desc, categoria_aplicacao:cat, data_fim:dataFim });
    btn.disabled=false; btn.textContent='Criar Ajuste';
    if (d && d.error) { errEl.textContent=d.error; errEl.classList.add('show'); return; }
    showToast('Ajuste criado para '+alunoNome, 'success');
    toggleNovoAjuste();
    document.getElementById('ajValor').value='';
    document.getElementById('ajDesc').value='';
    document.getElementById('ajDataFim').value='';
    loadFinDescontos();
  }
  async function loadFinDescontos(filtroAlunoId) {
    var el = document.getElementById('ajustesList');
    el.innerHTML = '<div class="empty-state">Carregando...</div>';
    var payload = { action:'fin_ajustes_list' };
    if (filtroAlunoId) payload.aluno_id = filtroAlunoId;
    var d = await apiFinExt(payload);
    var list = Array.isArray(d) ? d : (d?.data || []);
    if (!list.length) { el.innerHTML='<div class="empty-state">Nenhum ajuste cadastrado.</div>'; return; }
    var fmtR = function(v){ return 'R$ '+parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:2}); };
    var tipoIcons = { desconto_fixo:'🔻', desconto_percentual:'🔻', acrescimo_fixo:'🔺' };
    var tipoLabels = { desconto_fixo:'Desconto fixo', desconto_percentual:'Desconto %', acrescimo_fixo:'Acréscimo' };
    var catLabels = { total:'Total', mensalidade:'Mensalidade', alimentacao:'Alimentação' };
    el.innerHTML = '<table style="width:100%;"><thead><tr><th>Aluno</th><th>Tipo</th><th>Descrição</th><th style="text-align:right;">Valor</th><th>Incide sobre</th><th>Vigência</th><th>Ações</th></tr></thead><tbody>' +
      list.map(function(aj) {
        var icon = tipoIcons[aj.tipo]||'📋';
        var valorStr = aj.tipo === 'desconto_percentual' ? aj.valor+'%' : fmtR(aj.valor);
        var cor = aj.tipo.startsWith('desconto') ? '#EF4444' : '#2d7a3a';
        var vigencia = aj.data_fim ? 'Até '+new Date(aj.data_fim+'T12:00:00').toLocaleDateString('pt-BR') : 'Permanente';
        var ativoClass = aj.ativo ? '' : ' style="opacity:.5;"';
        return '<tr'+ativoClass+'><td style="padding:8px;font-weight:600;">'+esc(aj.aluno_nome)+'</td>' +
          '<td style="padding:8px;font-size:12px;">'+icon+' '+esc(tipoLabels[aj.tipo]||aj.tipo)+'</td>' +
          '<td style="padding:8px;">'+esc(aj.descricao)+'</td>' +
          '<td style="padding:8px;text-align:right;font-weight:700;color:'+cor+';">'+(aj.tipo.startsWith('desconto')?'-':'+')+''+valorStr+'</td>' +
          '<td style="padding:8px;font-size:12px;">'+esc(catLabels[aj.categoria_aplicacao]||aj.categoria_aplicacao)+'</td>' +
          '<td style="padding:8px;font-size:12px;">'+vigencia+(aj.ativo?'':' · <span style="color:#EF4444;">Inativo</span>')+'</td>' +
          '<td style="padding:8px;white-space:nowrap;">' +
            (aj.ativo ? '<button class="action-btn" onclick="desativarAjuste(\''+aj.id+'\')">⏸ Pausar</button>' : '<button class="action-btn" onclick="ativarAjuste(\''+aj.id+'\')">▶ Reativar</button>') +
            ' <button class="action-btn del" onclick="removerAjuste(\''+aj.id+'\',\''+esc(aj.descricao)+'\')">🗑</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  async function desativarAjuste(id) {
    await apiFinExt({ action:'fin_ajuste_update', id:id, ativo:false });
    showToast('Ajuste pausado.'); loadFinDescontos();
  }
  async function ativarAjuste(id) {
    await apiFinExt({ action:'fin_ajuste_update', id:id, ativo:true });
    showToast('Ajuste reativado.'); loadFinDescontos();
  }
  async function removerAjuste(id, desc) {
    if (!confirm('Remover ajuste "'+desc+'"? Isto não afeta boletos já gerados.')) return;
    await apiFinExt({ action:'fin_ajuste_delete', id:id });
    showToast('Ajuste removido.'); loadFinDescontos();
  }

  // ═══ DASHBOARD ESTENDIDO ═══
  async function loadFinDashExt() {
    var ano = initYearSel('dashExtAnoSel','dashExtAno');
    var d = await api({ action:'fin_dashboard_extended', ano });
    if (!d || d.error) return;

    // Aging buckets
    var a = d.aging || {};
    var fmtR = function(v){ return 'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2}); };
    document.getElementById('agingBuckets').innerHTML = [
      {label:'A vencer / Corrente',val:a.current||0,cor:'#2d7a3a'},
      {label:'7-14 dias atraso',val:a.d7||0,cor:'#EAB308'},
      {label:'15-27 dias atraso',val:a.d15||0,cor:'#F97316'},
      {label:'28+ dias atraso',val:a.d28||0,cor:'#EF4444'}
    ].map(function(b){return '<div class="card" style="border-left:4px solid '+b.cor+';padding:12px;"><div style="font-size:20px;font-weight:700;color:'+b.cor+';">'+fmtR(b.val)+'</div><div style="color:var(--muted);font-size:12px;">'+b.label+'</div></div>';}).join('');

    // Previsto vs Realizado chart
    var MS = MESES_CURTOS;
    var maxV = Math.max(...(d.previsto||[]).concat(d.realizado||[]), 1);
    document.getElementById('previstoRealizadoChart').innerHTML = '<div style="display:flex;align-items:flex-end;gap:4px;height:180px;padding:10px 0;">'+
      (d.previsto||[]).map(function(p,i){
        var r = (d.realizado||[])[i]||0;
        var pH = Math.round((p/maxV)*150);
        var rH = Math.round((r/maxV)*150);
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;"><div style="display:flex;gap:1px;align-items:flex-end;height:155px;"><div style="width:10px;background:#cbd5e1;border-radius:2px 2px 0 0;height:'+pH+'px;" title="Previsto: '+fmtR(p)+'"></div><div style="width:10px;background:#2d7a3a;border-radius:2px 2px 0 0;height:'+rH+'px;" title="Realizado: '+fmtR(r)+'"></div></div><span style="font-size:9px;color:var(--muted);">'+MS[i]+'</span></div>';
      }).join('')+'</div><div style="display:flex;gap:16px;justify-content:center;margin-top:8px;font-size:11px;color:var(--muted);"><span><span style="display:inline-block;width:10px;height:10px;background:#cbd5e1;border-radius:2px;"></span> Previsto</span><span><span style="display:inline-block;width:10px;height:10px;background:#2d7a3a;border-radius:2px;"></span> Realizado</span></div>';

    // Inadimplência rate
    var pct = d.inadimplencia_pct || 0;
    var pctColor = pct > 15 ? '#EF4444' : pct > 5 ? '#F97316' : '#2d7a3a';
    document.getElementById('inadimplRate').innerHTML = '<div style="font-size:48px;font-weight:700;color:'+pctColor+';">'+pct+'%</div><div style="color:var(--muted);font-size:13px;">do mês atual</div>';

    // Série table
    var series = d.por_serie || [];
    document.getElementById('seriePgtoTable').innerHTML = series.length ? series.map(function(s){
      var taxaCor = s.taxa_pgto >= 80 ? '#2d7a3a' : s.taxa_pgto >= 50 ? '#F97316' : '#EF4444';
      return '<tr><td style="font-weight:600;">'+esc(s.serie)+'</td><td>'+s.total+'</td><td>'+s.pago+'</td><td style="text-align:right;">'+fmtR(s.valor_total)+'</td><td style="text-align:right;color:#2d7a3a;">'+fmtR(s.valor_pago)+'</td><td><span style="color:'+taxaCor+';font-weight:700;">'+s.taxa_pgto+'%</span></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty-state">Sem dados para o período.</td></tr>';

    // Top devedores
    var devs = d.top_devedores || [];
    document.getElementById('topDevedoresList').innerHTML = devs.length ? devs.map(function(d){
      return '<div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #f5f0ea;"><span>'+esc(d.familia||'—')+' <span style="color:var(--muted);font-size:11px;">'+d.dias+' dias</span></span><span style="font-weight:700;color:#EF4444;">'+fmtR(d.valor)+'</span></div>';
    }).join('') : '<div class="empty-state">Nenhum devedor 28d+.</div>';
  }

  // ═══ REAJUSTE ANUAL ═══
  function toggleNovoReajuste() {
    var el = document.getElementById('novoReajusteForm');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }
  async function salvarReajuste() {
    var d = await api({ action:'fin_reajuste_create', ano_letivo: parseInt(document.getElementById('reaAno').value), taxa_percentual: parseFloat(document.getElementById('reaTaxa').value), indice: document.getElementById('reaIndice').value, data_vigencia: document.getElementById('reaVigencia').value, motivo: document.getElementById('reaMotivo').value });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Reajuste criado!','success');
    toggleNovoReajuste();
    loadReajustes();
  }
  async function loadReajustes() {
    var d = await api({ action:'fin_reajuste_list' });
    var list = Array.isArray(d) ? d : [];
    var el = document.getElementById('reajustesList');
    if (!list.length) { el.innerHTML = '<div class="empty-state">Nenhum reajuste cadastrado.</div>'; return; }
    var fmtR = function(v){ return 'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2}); };
    el.innerHTML = list.map(function(r) {
      var badge = r.aplicado ? '<span class="badge badge-green">Aplicado</span>' : '<span class="badge badge-orange">Pendente</span>';
      var hist = (r.fin_reajuste_historico || []);
      var histHtml = hist.length ? '<div style="margin-top:8px;"><table style="font-size:12px;"><thead><tr><th>Turno</th><th style="text-align:right;">Anterior</th><th style="text-align:right;">Novo</th></tr></thead><tbody>'+hist.map(function(h){ return '<tr><td>'+esc(h.turno)+'</td><td style="text-align:right;">'+fmtR(h.preco_anterior)+'</td><td style="text-align:right;color:#2d7a3a;font-weight:600;">'+fmtR(h.preco_novo)+'</td></tr>'; }).join('')+'</tbody></table></div>' : '';
      var acoes = !r.aplicado ? '<button class="btn btn-sm" onclick="aplicarReajuste(\''+r.id+'\')">✅ Aplicar Agora</button>' : '';
      return '<div class="card" style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;align-items:center;"><div><strong>Ano '+r.ano_letivo+'</strong> — <span style="font-size:18px;font-weight:700;color:#1a6bb5;">+'+r.taxa_percentual+'%</span> <span style="color:var(--muted);font-size:12px;">('+esc(r.indice)+')</span></div><div style="display:flex;gap:8px;align-items:center;">'+badge+acoes+'</div></div><div style="color:var(--muted);font-size:12px;margin-top:4px;">Vigência: '+new Date(r.data_vigencia+'T12:00:00').toLocaleDateString('pt-BR')+(r.motivo?' · '+esc(r.motivo):'')+'</div>'+histHtml+'</div>';
    }).join('');
  }
  async function aplicarReajuste(id) {
    if (!confirm('Aplicar reajuste? Todos os preços de turno serão atualizados permanentemente.')) return;
    var d = await api({ action:'fin_reajuste_aplicar', id:id });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Reajuste aplicado! '+((d.historico||[]).length)+' turnos atualizados.','success');
    loadReajustes();
  }

  // ═══ EXPORT ═══
  function initExportPanel() {
    var y = new Date().getFullYear();
    document.getElementById('expInicio').value = y+'-01-01';
    document.getElementById('expFim').value = new Date().toISOString().slice(0,10);
  }
  async function exportarCSV() {
    var d = await api({ action:'fin_export', tipo: document.getElementById('expTipo').value, periodo_inicio: document.getElementById('expInicio').value, periodo_fim: document.getElementById('expFim').value, formato:'csv' });
    if (!d || d.error) { showToast(d?.error||'Erro','error'); return; }
    if (!d.csv) { showToast('Nenhum dado para exportar.','info'); return; }
    var blob = new Blob(['\ufeff'+d.csv], {type:'text/csv;charset=utf-8;'});
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = document.getElementById('expTipo').value+'_'+document.getElementById('expInicio').value+'_'+document.getElementById('expFim').value+'.csv';
    link.click();
    showToast(d.total+' registros exportados!','success');
  }
  async function exportarJSON() {
    var d = await api({ action:'fin_export', tipo: document.getElementById('expTipo').value, periodo_inicio: document.getElementById('expInicio').value, periodo_fim: document.getElementById('expFim').value });
    if (!d || d.error) { showToast(d?.error||'Erro','error'); return; }
    var blob = new Blob([JSON.stringify(d.data, null, 2)], {type:'application/json'});
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = document.getElementById('expTipo').value+'_export.json';
    link.click();
    showToast(d.total+' registros exportados!','success');
  }

  // ═══ RECIBOS ═══
  async function loadRecibos() {
    var mes = document.getElementById('recibosMes').value || new Date().toISOString().slice(0,7);
    if (!document.getElementById('recibosMes').value) document.getElementById('recibosMes').value = mes;
    var d = await api({ action:'fin_recibos_list', mes:mes });
    var list = Array.isArray(d) ? d : [];
    var el = document.getElementById('recibosList');
    var fmtR = function(v){ return 'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2}); };
    if (!list.length) { el.innerHTML='<div class="empty-state">Nenhum recibo no período.</div>'; return; }
    el.innerHTML = '<table><thead><tr><th>#</th><th>Família</th><th>Criança</th><th>Descrição</th><th style="text-align:right;">Valor</th><th>Data Pgto</th><th>Método</th></tr></thead><tbody>' +
      list.map(function(r) {
        var metodos = {boleto:'Boleto',pix:'PIX',cartao:'Cartão',dinheiro:'Dinheiro',ted:'TED',cheque:'Cheque'};
        return '<tr><td style="color:var(--muted);font-size:12px;">#'+r.numero_recibo+'</td><td style="font-weight:600;">'+esc(r.familia_nome||'—')+'</td><td>'+esc(r.crianca_nome||'—')+'</td><td>'+esc(r.descricao||'—')+'</td><td style="text-align:right;font-weight:600;color:#2d7a3a;">'+fmtR(r.valor)+'</td><td>'+new Date(r.data_pagamento+'T12:00:00').toLocaleDateString('pt-BR')+'</td><td>'+(metodos[r.metodo_pagamento]||r.metodo_pagamento||'—')+'</td></tr>';
      }).join('') + '</tbody></table>';
  }

  // ═══ FLUXO DE CAIXA ═══
  async function loadFluxoCaixa() {
    var d = await api({ action:'fin_fluxo_caixa', meses:3 });
    var list = Array.isArray(d) ? d : [];
    var el = document.getElementById('fluxoCaixaContent');
    var fmtR = function(v){ return 'R$ '+Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2}); };
    if (!list.length) { el.innerHTML='<div class="empty-state">Sem dados.</div>'; return; }
    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat('+list.length+',1fr);gap:16px;">' +
      list.map(function(m) {
        var saldoCor = m.saldo_projetado >= 0 ? '#2d7a3a' : '#EF4444';
        return '<div class="card" style="padding:16px;"><div style="font-weight:700;font-size:14px;margin-bottom:12px;">'+m.mes+'</div>' +
          '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f5f0ea;"><span style="color:var(--muted);font-size:13px;">Receita prevista</span><span style="font-weight:600;color:#2d7a3a;">'+fmtR(m.receita_prevista)+'</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f5f0ea;"><span style="color:var(--muted);font-size:13px;">  Já realizada</span><span style="font-size:12px;color:var(--muted);">'+fmtR(m.receita_realizada)+'</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f5f0ea;"><span style="color:var(--muted);font-size:13px;">Despesa prevista</span><span style="font-weight:600;color:#EF4444;">'+fmtR(m.despesa_prevista)+'</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f5f0ea;"><span style="color:var(--muted);font-size:13px;">  Já realizada</span><span style="font-size:12px;color:var(--muted);">'+fmtR(m.despesa_realizada)+'</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:10px 0;margin-top:8px;border-top:2px solid var(--border);"><span style="font-weight:700;">Saldo projetado</span><span style="font-weight:700;font-size:18px;color:'+saldoCor+';">'+fmtR(m.saldo_projetado)+'</span></div></div>';
      }).join('') + '</div>';
  }

  // ═══ FECHAMENTO MENSAL ═══
  async function loadFechamento() {
    var d = await api({ action:'fin_fechamento_list' });
    var list = Array.isArray(d) ? d : [];
    var el = document.getElementById('fechamentoList');
    if (!list.length) { el.innerHTML='<div class="empty-state">Nenhum mês fechado ainda. Selecione um mês e clique em "Fechar Mês".</div>'; return; }
    el.innerHTML = list.map(function(f) {
      var badge = f.fechado ? '<span class="badge badge-green">Fechado</span>' : '<span class="badge badge-orange">Reaberto</span>';
      var acoes = f.fechado ? '<button class="btn btn-sm btn-outline" onclick="reabrirMes(\''+f.mes+'\')">🔓 Reabrir</button>' : '<button class="btn btn-sm" onclick="fecharMesId(\''+f.mes+'\')">🔒 Fechar</button>';
      var info = f.fechado ? 'Fechado por '+esc(f.fechado_por||'—')+' em '+new Date(f.fechado_em).toLocaleDateString('pt-BR') : 'Reaberto por '+esc(f.reaberto_por||'—');
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid #f5f0ea;"><div><strong>'+f.mes+'</strong> '+badge+'<div style="font-size:11px;color:var(--muted);margin-top:2px;">'+info+'</div></div>'+acoes+'</div>';
    }).join('');
  }
  async function fecharMes() {
    var mes = document.getElementById('fechamentoMes').value;
    if (!mes) { showToast('Selecione um mês.','warning'); return; }
    if (!confirm('Fechar o mês '+mes+'? Novos lançamentos manuais serão bloqueados neste período.')) return;
    var d = await api({ action:'fin_fechamento_fechar', mes:mes });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Mês '+mes+' fechado!','success'); loadFechamento();
  }
  async function fecharMesId(mes) {
    if (!confirm('Fechar o mês '+mes+'?')) return;
    await api({ action:'fin_fechamento_fechar', mes:mes });
    showToast('Fechado.'); loadFechamento();
  }
  async function reabrirMes(mes) {
    if (!confirm('Reabrir o mês '+mes+'? Lançamentos poderão ser alterados.')) return;
    await api({ action:'fin_fechamento_reabrir', mes:mes });
    showToast('Mês '+mes+' reaberto.'); loadFechamento();
  }

  // ═══ CONFIG NOTIFICAÇÕES ═══
  async function loadNotifConfig() {
    var d = await api({ action:'fin_notificacao_config_list' });
    var list = Array.isArray(d) ? d : [];
    var el = document.getElementById('notifConfigList');
    var tipoLabels = {vencimento_proximo:'Lembrete pré-vencimento',vencido:'Cobrança pós-vencimento',pago:'Confirmação pagamento'};
    if (!list.length) { el.innerHTML='<div class="empty-state">Nenhuma regra configurada. Use o formulário abaixo para criar.</div>'; return; }
    el.innerHTML = list.map(function(c) {
      var badge = c.habilitado ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-orange">Desativado</span>';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid #f5f0ea;"><div><strong>'+esc(tipoLabels[c.tipo]||c.tipo)+'</strong> · '+esc(c.canal)+' · offset: '+c.dias_offset+'d '+badge+'</div></div>';
    }).join('');
  }
  async function salvarNotifConfig() {
    var d = await api({ action:'fin_notificacao_config_save', tipo:document.getElementById('ncTipo').value, canal:document.getElementById('ncCanal').value, dias_offset:parseInt(document.getElementById('ncDias').value)||0 });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Regra salva!','success'); loadNotifConfig();
  }

  // ═══ BOLETOS EM LOTE ═══
  function toggleGerarLoteManual() {
    var el = document.getElementById('gerarLoteForm');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
    if (el.style.display === 'block') {
      // Default: próximo mês
      var d = new Date(); d.setMonth(d.getMonth() + 1);
      document.getElementById('loteManualMes').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }
  }
  async function gerarLoteManual() {
    var mes = document.getElementById('loteManualMes').value;
    var errEl = document.getElementById('loteManualErr');
    errEl.classList.remove('show');
    if (!mes) { errEl.textContent = 'Selecione o mês.'; errEl.classList.add('show'); return; }
    var btn = document.getElementById('loteManualBtn');
    btn.disabled = true; btn.textContent = 'Gerando...';
    var d = await apiFinExt({ action: 'boletos_gerar_batch_manual', mes_referencia: mes });
    btn.disabled = false; btn.textContent = 'Gerar Lote';
    if (d && d.error) { errEl.textContent = d.error; errEl.classList.add('show'); return; }
    var msg = (d.total_alunos || 0) + ' alunos incluídos no lote';
    if (d.pulados) msg += ' (' + d.pulados + ' já tinham boleto — pulados)';
    if (d.total_alunos === 0) msg = d.message || 'Nenhum aluno para gerar boleto.';
    showToast(msg, d.total_alunos > 0 ? 'success' : 'info', 5000);
    toggleGerarLoteManual();
    loadBatchBoletos();
  }
  async function loadBatchBoletos() {
    var d = await apiFinExt({ action: 'boletos_batch_list' });
    var list = Array.isArray(d) ? d : (d?.data || []);
    var el = document.getElementById('batchList');
    if (!list.length) { el.innerHTML = '<div class="empty-state">Nenhum lote gerado. Clique em "+ Gerar Lote Sob Demanda" para criar.</div>'; return; }
    el.innerHTML = list.map(function(b) {
      var badge = b.status === 'emitido' ? 'badge-green' : b.status === 'aguardando_aprovacao' ? 'badge-orange' : b.status === 'rejeitado' ? 'badge-red' : 'badge-blue';
      var itens = b.fin_boleto_batch_items || b.itens || [];
      var itensHtml = itens.map(function(it) {
        var iBadge = it.status === 'emitido' ? 'badge-green' : it.status === 'erro' ? 'badge-red' : 'badge-orange';
        var composicao = '';
        if (it.itens && Array.isArray(it.itens) && it.itens.length > 0) {
          composicao = '<div style="margin-top:2px;">' + it.itens.map(function(comp) {
            var catIcon = comp.categoria === 'mensalidade' ? '📚' : comp.categoria === 'alimentacao' ? '🍽️' : comp.categoria === 'atividade_extra' ? '⚽' : '📋';
            return '<div style="font-size:11px;color:var(--muted);display:flex;justify-content:space-between;gap:8px;">' +
              '<span>' + catIcon + ' ' + esc(comp.nome) + '</span>' +
              '<span style="font-weight:600;white-space:nowrap;">R$ ' + (comp.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</span></div>';
          }).join('') + '</div>';
        } else {
          composicao = '<div style="font-size:11px;color:var(--muted);">' + esc(it.descricao_detalhada||'—') + '</div>';
        }
        return '<tr><td><div style="font-weight:600;">'+esc(it.crianca_nome||'—')+'</div><div style="font-size:11px;color:var(--muted);">'+esc(it.familia_nome||'—')+'</div></td><td>'+composicao+'</td><td style="font-weight:700;text-align:right;font-size:15px;">R$ '+(it.valor_total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</td><td><span class="badge '+iBadge+'">'+esc(it.status)+'</span></td></tr>';
      }).join('');
      return '<div class="card" style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;"><div><strong>Lote '+esc(b.mes_referencia)+'</strong> — '+b.total_boletos+' boletos — <span style="font-size:16px;font-weight:700;">R$ '+(b.valor_total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</span></div><div style="display:flex;gap:8px;align-items:center;"><span class="badge '+badge+'">'+esc((b.status||'').replace(/_/g,' '))+'</span>'+(b.status==='aguardando_aprovacao'?'<button class="btn btn-sm" onclick="aprovarBatch(\''+b.id+'\')">✅ Aprovar e Emitir</button><button class="btn btn-sm btn-outline" onclick="rejeitarBatch(\''+b.id+'\')">❌ Rejeitar</button>':'')+'</div></div>'+(itens.length?'<table style="width:100%;"><thead><tr><th>Aluno / Família</th><th>Composição do Boleto</th><th style="text-align:right;">Total</th><th>Status</th></tr></thead><tbody>'+itensHtml+'</tbody></table>':'')+'</div>';
    }).join('');
  }
  async function aprovarBatch(id) {
    if (!await _lumiedConfirm('Aprovar e emitir todos os boletos deste lote?\n\nEsta ação enviará os boletos para o Banco Inter.')) return;
    showToast('Emitindo boletos...', 'info');
    var d = await apiFinExt({ action: 'boletos_batch_aprovar', batch_id: id });
    if (d && !d.error) showToast('Lote aprovado! ' + (d.emitidos||0) + ' boletos emitidos.', 'success');
    else showToast('Erro: ' + (d?.error||'falha'), 'error');
    loadFinMensalidades();
  }
  async function rejeitarBatch(id) {
    if (!await _lumiedConfirm('Rejeitar este lote?')) return;
    await apiFinExt({ action: 'boletos_batch_rejeitar', batch_id: id });
    showToast('Lote rejeitado.', 'info');
    loadFinMensalidades();
  }

  // ═══ FOLHA DE PAGAMENTO ═══
  var _folhaData = [];
  async function uploadFolhaPdf(input) {
    var file = input.files[0];
    if (!file) return;
    document.getElementById('folhaStatus').textContent = 'Processando com IA...';
    var reader = new FileReader();
    reader.onload = async function(e) {
      var base64 = e.target.result.split(',')[1];
      var d = await apiFinExt({ action: 'folha_upload_parse', pdf_base64: base64 });
      if (d && d.data && Array.isArray(d.data)) {
        _folhaData = d.data;
        renderFolhaTable();
        document.getElementById('folhaPreview').style.display = 'block';
        document.getElementById('folhaStatus').textContent = d.data.length + ' funcionários extraídos.';
      } else {
        document.getElementById('folhaStatus').textContent = 'Erro ao processar: ' + (d?.error || 'formato inválido');
      }
    };
    reader.readAsDataURL(file);
  }
  function renderFolhaTable() {
    var tb = document.getElementById('folhaTable');
    tb.innerHTML = _folhaData.map(function(f, i) {
      return '<tr><td><input value="'+esc(f.nome||'')+'" onchange="_folhaData['+i+'].nome=this.value" style="width:120px;"></td><td><input value="'+esc(f.cpf||'')+'" onchange="_folhaData['+i+'].cpf=this.value" style="width:100px;"></td><td><input type="number" value="'+(f.salario_bruto||0)+'" onchange="_folhaData['+i+'].salario_bruto=+this.value" style="width:80px;"></td><td><input type="number" value="'+(f.descontos||0)+'" onchange="_folhaData['+i+'].descontos=+this.value" style="width:80px;"></td><td style="font-weight:600;">R$ '+(f.salario_liquido||0).toLocaleString('pt-BR',{minimumFractionDigits:2})+'</td><td>'+esc(f.banco||'')+'</td><td>'+esc(f.agencia||'')+'</td><td>'+esc(f.conta||'')+'</td><td>'+esc(f.pix||'')+'</td></tr>';
    }).join('');
  }
  function downloadFolhaXlsx() {
    if (!_folhaData.length) return showToast('Nenhum dado para exportar.', 'error');
    var rows = _folhaData.map(function(f) {
      return { 'Tipo Pagamento': f.pix ? 'PIX' : 'TED', 'CPF/CNPJ Favorecido': f.cpf, 'Nome Favorecido': f.nome, 'Banco': f.banco || '', 'Agência': f.agencia || '', 'Conta': f.conta || '', 'Tipo Conta': f.tipo_conta || 'corrente', 'Valor': f.salario_liquido, 'Data Pagamento': new Date().toISOString().slice(0,10), 'Descrição': 'Folha de Pagamento', 'Chave PIX': f.pix || '' };
    });
    var ws = XLSX.utils.json_to_sheet(rows);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Folha');
    XLSX.writeFile(wb, 'folha_pagamento_inter.xlsx');
    showToast('XLSX gerado com sucesso!');
  }
  async function salvarFolha() {
    var mes = new Date().toISOString().slice(0,7);
    await apiFinExt({ action: 'folha_upload_save', mes_referencia: mes, dados: _folhaData });
    showToast('Folha salva.');
  }

  // ═══ CONCILIAÇÃO SYNC ═══
  async function syncBancoInter() {
    showToast('Sincronizando com Banco Inter...', 'info');
    var d = await apiFinExt({ action: 'conciliacao_automatica' });
    if (d && !d.error) showToast('Sincronizado! ' + (d.matched||0) + ' conciliados, ' + (d.created||0) + ' criados, ' + (d.pendente_revisao||0) + ' pendentes.');
    else showToast('Erro: ' + (d?.error||'falha'), 'error');
    loadFinConciliacao();
  }
