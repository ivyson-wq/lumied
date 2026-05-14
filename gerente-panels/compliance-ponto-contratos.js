// Auto-extraído do gerente.html (Onda 4 — mega batch).
// Ponto Compliance + Compliance Module + Feriados + Config Ponto + Banco Horas + Resumo + Conta + ROI + Contratos digitais
  // ═══ PONTO & COMPLIANCE — TAB SWITCHING ═══
  function _pcSwitchTab(prefix, tabs, activeTab, loadFn) {
    var activeStyle = 'padding:12px 20px;font-size:13px;font-weight:700;background:#fff;color:#C8102E;cursor:pointer;font-family:inherit;border:2px solid #C8102E;border-radius:10px;border-bottom:4px solid #C8102E;box-shadow:0 2px 8px rgba(0,0,0,0.08);';
    var inactiveStyle = 'padding:12px 20px;font-size:13px;font-weight:700;background:#fff;color:#888;cursor:pointer;font-family:inherit;border:2px solid #ddd;border-radius:10px;border-bottom:4px solid transparent;box-shadow:none;';
    tabs.forEach(function(t) {
      var btn = document.getElementById(prefix + 'Tab' + t.charAt(0).toUpperCase() + t.slice(1));
      var sec = document.getElementById(prefix + t.charAt(0).toUpperCase() + t.slice(1) + 'Section');
      if (btn) btn.style.cssText = (t === activeTab) ? activeStyle : inactiveStyle;
      if (sec) sec.style.display = (t === activeTab) ? '' : 'none';
    });
    if (loadFn) loadFn();
  }
  function switchCompTab(tab) { _pcSwitchTab('comp', ['score','incidentes','certificacoes','inspecoes','politicas'], tab, {incidentes:loadCompIncidentes,certificacoes:loadCompCertificacoes,inspecoes:loadCompInspecoes,politicas:loadCompPoliticas}[tab]); }
  function switchEmpTab(tab) { _pcSwitchTab('emp', ['func','horarios'], tab, tab==='horarios'?loadCompHorarios:null); }
  function switchMirrorTab(tab) { _pcSwitchTab('mirror', ['espelho','ocorrencias','banco','resumo'], tab, {ocorrencias:loadCompOcorrencias,banco:loadCompBancoHorasInit,resumo:loadCompResumoMensalInit}[tab]); }
  function switchCalTab(tab) { _pcSwitchTab('cal', ['calendario','feriados','alertas'], tab, {feriados:loadCompFeriados,alertas:loadCompAlertas}[tab]); }
  function switchCfgTab(tab) { _pcSwitchTab('cfg', ['config','setup'], tab, tab==='setup'?loadPontoSetup:null); }

  // ═══ COMPLIANCE MODULE ═══
  var COMPLIANCE_API = SUPABASE_URL + '/functions/v1/compliance';
  async function compApi(body) {
    const token = getToken();
    const r = await fetch(COMPLIANCE_API, { method:'POST', headers:{'Content-Type':'application/json','apikey':ANON,'Authorization':'Bearer '+ANON}, body: JSON.stringify({...body, _token: token}) });
    return r.json();
  }
  async function loadCompDashboard() {
    const d = await compApi({ action:'compliance_dashboard_completo' });
    if (d.error) return;
    const s = d.data || d;
    const el = document.getElementById('compScore');
    el.textContent = s.score_compliance ?? '—';
    el.parentElement.style.borderColor = (s.score_compliance >= 80 ? '#2d7a3a' : s.score_compliance >= 50 ? '#d4830a' : '#C8102E');
    document.getElementById('compIncidentesAbertos').textContent = s.incidentes_abertos ?? 0;
    document.getElementById('compCertVencidas').textContent = s.certificacoes_vencidas ?? 0;
    document.getElementById('compPrazosAtrasados').textContent = s.prazos_atrasados ?? 0;
    document.getElementById('compInspecoesPend').textContent = s.inspecoes_com_pendencias ?? 0;
    document.getElementById('compHoraExtraPend').textContent = s.hora_extra_pendentes ?? 0;
  }
  async function loadCompHorarios() { const d = await compApi({action:'compliance_horarios_list'}); const items = d.data||[]; document.getElementById('compHorariosBody').innerHTML = items.length ? items.map(h=>`<tr><td>${h.professoras?.nome||'—'}</td><td>${{1:'Seg',2:'Ter',3:'Qua',4:'Qui',5:'Sex'}[h.dia_semana]||h.dia_semana}</td><td>${h.hora_entrada}</td><td>${h.hora_saida}</td><td>${h.tolerancia_minutos}min</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">Nenhum horário.</td></tr>'; }
  function fmtMin(m) { m = parseInt(m)||0; const h = Math.floor(m/60); const r = m%60; return h > 0 ? h+'h '+(r>0?r+'min':'') : m+'min'; }
  function tipoDiaLabel(o) { if(o.feriado||o.tipo_dia==='feriado') return 'Feriado'; const dow = o.dia_semana||new Date(o.data_ocorrencia).getDay(); if(dow===0) return 'Domingo'; if(dow===6) return 'Sabado'; return 'Dia util'; }
  function adicionalLabel(o) { const td = tipoDiaLabel(o); return (td==='Domingo'||td==='Feriado') ? '100%' : '50%'; }
  function adicionalColor(pct) { return pct==='100%' ? '#C8102E' : '#d4830a'; }
  async function loadCompOcorrencias() { const d = await compApi({action:'compliance_ocorrencias_list'}); const items = d.data||[]; document.getElementById('compOcorrenciasBody').innerHTML = items.length ? items.map(o=>{ const td=tipoDiaLabel(o); const ad=adicionalLabel(o); return `<tr><td>${String(o.data_ocorrencia).split('-').reverse().join('/')}</td><td>${esc(o.professoras?.nome||o.professora_nome||'—')}</td><td>${esc(td)}</td><td>${o.hora_prevista_saida||'—'}</td><td>${o.hora_real_saida||'—'}</td><td><strong>${fmtMin(o.minutos_excedentes)}</strong></td><td><span class="status-pill" style="background:${adicionalColor(ad)};color:#fff;">${ad}</span></td><td><span class="status-pill" style="background:${{pendente:'#d4830a',confirmada:'#C8102E',paga:'#2d7a3a',aprovada:'#2d7a3a'}[o.status]||'#888'};color:#fff;">${esc(o.status||'pendente')}</span></td><td>${o.status==='pendente'?`<button onclick="compApi({action:'compliance_confirmar_ocorrencia',id:'${o.id}'}).then(()=>{showToast('Confirmada');loadCompOcorrencias()})" style="background:#C8102E;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;">Confirmar</button>`:''}</td></tr>`; }).join('') : '<tr><td colspan="9" class="empty-state">Nenhuma ocorrencia.</td></tr>'; }
  async function loadCompIncidentes() { const d = await compApi({action:'compliance_incidentes_list'}); const items = d.data||[]; document.getElementById('compIncidentesBody').innerHTML = items.length ? items.map(i=>`<tr><td>${String(i.data_ocorrencia).split('-').reverse().join('/')}</td><td>${i.tipo}</td><td><span class="status-pill" style="background:${{baixa:'#2d7a3a',media:'#d4830a',alta:'#C8102E',critica:'#7a0016'}[i.gravidade]||'#888'};color:#fff;">${i.gravidade}</span></td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${i.descricao}</td><td>${i.status}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">Nenhum.</td></tr>'; }
  async function loadCompCertificacoes() { const d = await compApi({action:'compliance_cert_list'}); const items = d.data||[]; document.getElementById('compCertBody').innerHTML = items.length ? items.map(c=>`<tr><td>${c.rh_funcionarios?.nome||'—'}</td><td>${c.compliance_certificacoes_tipos?.nome||'—'}</td><td>${String(c.data_obtencao).split('-').reverse().join('/')}</td><td>${c.data_vencimento?String(c.data_vencimento).split('-').reverse().join('/'):'—'}</td><td><span class="status-pill" style="background:${{valida:'#2d7a3a',vencida:'#C8102E',pendente:'#d4830a'}[c.status]||'#888'};color:#fff;">${c.status}</span></td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">Nenhuma.</td></tr>'; }
  async function loadCompInspecoes() { const d = await compApi({action:'compliance_inspecoes_list'}); const items = d.data||[]; document.getElementById('compInspecoesBody').innerHTML = items.length ? items.map(i=>`<tr><td>${String(i.data_inspecao).split('-').reverse().join('/')}</td><td>${i.compliance_inspecao_templates?.nome||'—'}</td><td>${i.compliance_inspecao_templates?.categoria||'—'}</td><td><strong>${i.conformidade_pct}%</strong></td><td><span class="status-pill" style="background:${{concluida:'#2d7a3a',pendencias:'#d4830a',reprovada:'#C8102E'}[i.status]||'#888'};color:#fff;">${i.status}</span></td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">Nenhuma.</td></tr>'; }
  async function loadCompPoliticas() { const d = await compApi({action:'compliance_politicas_list'}); const items = d.data||[]; document.getElementById('compPoliticasBody').innerHTML = items.length ? items.map(p=>`<tr><td>${p.titulo}</td><td>${p.categoria}</td><td>v${p.versao}</td><td>${p.vigente_desde?String(p.vigente_desde).split('-').reverse().join('/'):'—'}</td><td>${p.revisao_proxima?String(p.revisao_proxima).split('-').reverse().join('/'):'—'}</td><td><span class="status-pill" style="background:${{vigente:'#2d7a3a',rascunho:'#d4830a',revogada:'#888'}[p.status]||'#888'};color:#fff;">${p.status}</span></td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">Nenhuma.</td></tr>'; }
  async function loadCompCalendario() { const d = await compApi({action:'compliance_calendario_list'}); const items = d.data||[]; document.getElementById('compCalendarioBody').innerHTML = items.length ? items.map(c=>`<tr><td>${String(c.data_limite).split('-').reverse().join('/')}</td><td>${c.titulo}</td><td>${c.categoria}</td><td><span class="status-pill" style="background:${{baixa:'#888',normal:'#1a6bb5',alta:'#d4830a',critica:'#C8102E'}[c.prioridade]||'#888'};color:#fff;">${c.prioridade}</span></td><td><span class="status-pill" style="background:${{pendente:'#d4830a',em_andamento:'#1a6bb5',concluido:'#2d7a3a',atrasado:'#C8102E'}[c.status]||'#888'};color:#fff;">${c.status}</span></td><td>${c.status!=='concluido'?`<button onclick="compApi({action:'compliance_calendario_concluir',id:'${c.id}'}).then(()=>{showToast('Concluído');loadCompCalendario()})" style="background:#2d7a3a;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;">Concluir</button>`:'✓'}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">Nenhum.</td></tr>'; }
  async function loadCompAlertas() { const d = await compApi({action:'compliance_alertas_list'}); const items = d.data||[]; document.getElementById('compAlertasBody').innerHTML = items.length ? items.map(a=>`<tr><td>${new Date(a.criado_em).toLocaleDateString('pt-BR')}</td><td>${a.professoras?.nome||'—'}</td><td>${a.email_destino}</td><td>${a.assunto}</td><td>${a.enviado?'<span class="status-pill" style="background:#2d7a3a;color:#fff;">Sim</span>':'<span class="status-pill" style="background:#C8102E;color:#fff;">Não</span>'}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">Nenhum.</td></tr>'; }
  // ── Certificações: form toggle + salvar ──
  function toggleCompCertForm() { var el = document.getElementById('compCertForm'); el.style.display = el.style.display==='none'?'block':'none'; if (el.style.display==='block') loadCompCertFormData(); }
  async function loadCompCertFormData() {
    var [funcs, tipos] = await Promise.all([compApi({action:'compliance_funcionarios_list'}), compApi({action:'compliance_cert_tipos_list'})]);
    var fList = funcs.data||[]; var tList = tipos.data||[];
    document.getElementById('ccFunc').innerHTML = '<option value="">Selecione...</option>' + fList.map(function(f){return '<option value="'+f.id+'">'+esc(f.nome)+'</option>';}).join('');
    document.getElementById('ccTipo').innerHTML = '<option value="">Selecione...</option>' + tList.map(function(t){return '<option value="'+t.id+'">'+esc(t.nome)+'</option>';}).join('');
  }
  async function salvarCompCert() {
    var d = await compApi({action:'compliance_cert_criar', funcionario_id:document.getElementById('ccFunc').value, tipo_id:document.getElementById('ccTipo').value, data_obtencao:document.getElementById('ccData').value, instituicao:document.getElementById('ccInstituicao').value, numero_certificado:document.getElementById('ccNumero').value});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Certificação registrada!','success'); toggleCompCertForm(); loadCompCertificacoes();
  }

  // ── Inspeções: form toggle + salvar ──
  var _inspTemplates = [];
  function toggleCompInspForm() { var el = document.getElementById('compInspForm'); el.style.display = el.style.display==='none'?'block':'none'; if (el.style.display==='block') loadCompInspFormData(); }
  async function loadCompInspFormData() {
    if (!document.getElementById('ciData').value) document.getElementById('ciData').value = new Date().toISOString().split('T')[0];
    var d = await compApi({action:'compliance_inspecao_templates_list'}); _inspTemplates = d.data||[];
    document.getElementById('ciTemplate').innerHTML = '<option value="">Selecione...</option>' + _inspTemplates.map(function(t){return '<option value="'+t.id+'">'+esc(t.nome)+' ('+esc(t.categoria)+')</option>';}).join('');
    document.getElementById('ciTemplate').onchange = function(){ renderInspChecklist(this.value); };
    document.getElementById('ciChecklist').innerHTML = '';
  }
  function renderInspChecklist(tid) {
    var tmpl = _inspTemplates.find(function(t){return t.id===tid;});
    if (!tmpl || !tmpl.itens_checklist) { document.getElementById('ciChecklist').innerHTML=''; return; }
    var items = Array.isArray(tmpl.itens_checklist) ? tmpl.itens_checklist : [];
    document.getElementById('ciChecklist').innerHTML = items.length ? '<div style="font-weight:600;margin-bottom:8px;">Checklist</div>' + items.map(function(it,i){
      return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f5f0ea;font-size:13px;"><input type="checkbox" id="ciItem'+i+'" '+(it.obrigatorio?'required':'')+'>'+esc(it.item||it)+(it.obrigatorio?' <span style="color:#C8102E;">*</span>':'')+'</label>';
    }).join('') : '';
  }
  async function salvarCompInsp() {
    var tid = document.getElementById('ciTemplate').value;
    if (!tid) { showToast('Selecione um template.','warning'); return; }
    var tmpl = _inspTemplates.find(function(t){return t.id===tid;});
    var items = tmpl && Array.isArray(tmpl.itens_checklist) ? tmpl.itens_checklist : [];
    var respostas = items.map(function(it,i){ return {item:it.item||it, resposta:document.getElementById('ciItem'+i)?.checked||false, obrigatorio:!!it.obrigatorio}; });
    var d = await compApi({action:'compliance_inspecao_realizar', template_id:tid, data_inspecao:document.getElementById('ciData').value, respostas:respostas, observacoes:document.getElementById('ciObs').value});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Inspeção registrada! Conformidade: '+((d.data||{}).conformidade_pct||0)+'%','success'); toggleCompInspForm(); loadCompInspecoes();
  }

  // ── Políticas: form toggle + salvar ──
  function toggleCompPolForm() { var el = document.getElementById('compPolForm'); el.style.display = el.style.display==='none'?'block':'none'; }
  async function salvarCompPol() {
    var titulo = document.getElementById('cpTitulo').value;
    var categoria = document.getElementById('cpCategoria').value;
    if (!titulo || !categoria) { showToast('Título e categoria são obrigatórios.','warning'); return; }
    var d = await compApi({action:'compliance_politica_criar', titulo:titulo, categoria:categoria, conteudo_html:document.getElementById('cpConteudo').value, vigente_desde:document.getElementById('cpVigente').value||null, revisao_proxima:document.getElementById('cpRevisao').value||null, aceite_obrigatorio:document.getElementById('cpAceite').value==='true'});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Política criada!','success'); toggleCompPolForm(); loadCompPoliticas();
  }

  var compPontoRegistros = [];
  function previewPontoGerente() {
    const fileInput = document.getElementById('compArquivoPonto');
    const preview = document.getElementById('compPontoPreview');
    if (!fileInput.files.length) { showToast('Selecione um arquivo.','error'); return; }
    const reader = new FileReader();
    reader.onload = function(e) {
      const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
      compPontoRegistros = [];
      for (const line of lines) {
        const sep = line.includes(';') ? ';' : ',';
        const parts = line.split(sep).map(p => p.trim());
        if (parts.length >= 4) { compPontoRegistros.push({ professora_id: parts[0], data: parts[1], hora_entrada: parts[2], hora_saida: parts[3] }); }
        else if (parts.length === 3) { compPontoRegistros.push({ professora_id: parts[0], data: parts[1], hora_entrada: parts[2], hora_saida: null }); }
      }
      if (!compPontoRegistros.length) { showToast('Nenhum registro valido.','error'); preview.style.display='none'; return; }
      document.getElementById('compPontoQtd').textContent = compPontoRegistros.length;
      document.getElementById('compPontoPreviewContent').innerHTML = compPontoRegistros.slice(0,20).map((r,i) =>
        `<div style="padding:2px 0;${i%2?'background:rgba(0,0,0,.03);':''}">${esc(r.professora_id)} | ${esc(r.data)} | ${esc(r.hora_entrada||'')} → ${esc(r.hora_saida||'—')}</div>`
      ).join('') + (compPontoRegistros.length > 20 ? `<div style="color:var(--muted);padding:4px 0;">... e mais ${compPontoRegistros.length - 20} registros</div>` : '');
      preview.style.display = 'block';
      document.getElementById('compPontoEnviarBtn').disabled = false;
    };
    reader.readAsText(fileInput.files[0]);
  }
  async function importarPontoCompliance() {
    if (!compPontoRegistros.length) return showToast('Faca a pre-visualizacao primeiro.','error');
    const fileInput = document.getElementById('compArquivoPonto');
    const nomeArquivo = fileInput.files[0]?.name || 'import_manual.csv';
    const btn = document.getElementById('compPontoEnviarBtn');
    const status = document.getElementById('compPontoStatus');
    btn.disabled = true; btn.textContent = 'Importando...';
    status.style.display = 'block'; status.style.background = '#eef4ff'; status.style.color = '#1a6bb5';
    status.textContent = 'Enviando ' + compPontoRegistros.length + ' registros...';
    const d = await compApi({ action: 'compliance_importar_ponto', nome_arquivo: nomeArquivo, registros: compPontoRegistros });
    if (d.error) { status.style.background = '#fdf0f2'; status.style.color = '#C8102E'; status.textContent = 'Erro: ' + d.error; btn.disabled = false; btn.textContent = 'Importar'; return; }
    status.style.background = '#edf7ef'; status.style.color = '#2d7a3a';
    status.textContent = 'Importacao concluida! ' + (d.processados || compPontoRegistros.length) + ' processados, ' + (d.erros || 0) + ' erros.';
    btn.textContent = 'Importar'; compPontoRegistros = [];
    document.getElementById('compPontoPreview').style.display = 'none'; fileInput.value = '';
    showToast('Ponto importado com sucesso!','success'); loadCompImportacoes();
  }
  async function loadCompImportacoes() {
    const d = await compApi({action:'compliance_importacoes_list'}); const items = d.data||[];
    document.getElementById('compImportacoesBody').innerHTML = items.length ? items.map(i=>`<tr><td>${i.criado_em?new Date(i.criado_em).toLocaleDateString('pt-BR'):'—'}</td><td>${esc(i.nome_arquivo||i.arquivo||'—')}</td><td>${i.total_registros||'—'}</td><td>${i.processados||'—'}</td><td>${i.erros||'0'}</td><td><span class="status-pill" style="background:${i.status==='processado'?'#2d7a3a':'#d4830a'};color:#fff;">${esc(i.status||'—')}</span></td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">Nenhuma importacao.</td></tr>';
    // Init month/year selectors
    const selM = document.getElementById('compImportResumoMes'); const selA = document.getElementById('compImportResumoAno');
    if (!selM.options.length) { const meses = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']; meses.forEach((m,i)=>{ const o=document.createElement('option'); o.value=i+1; o.textContent=m; selM.appendChild(o); }); selM.value = new Date().getMonth()+1; }
    if (!selA.options.length) { const y=new Date().getFullYear(); for(let i=y-2;i<=y+1;i++){ const o=document.createElement('option'); o.value=i; o.textContent=i; selA.appendChild(o); } selA.value=y; }
  }
  async function loadCompImportResumo() {
    const mes = document.getElementById('compImportResumoMes').value; const ano = document.getElementById('compImportResumoAno').value;
    const d = await compApi({action:'compliance_ponto_resumo_mensal', mes: parseInt(mes), ano: parseInt(ano)});
    const r = d.data || d; const el = document.getElementById('compImportResumoCards');
    el.innerHTML = `<div class="stat-card" data-g="semi"><div class="stat-label">HE 50%</div><div class="stat-value">${fmtMin(r.total_he_50||0)}</div></div>` +
      `<div class="stat-card" data-g="integral"><div class="stat-label">HE 100%</div><div class="stat-value">${fmtMin(r.total_he_100||0)}</div></div>` +
      `<div class="stat-card" data-g="total"><div class="stat-label">Banco Horas</div><div class="stat-value">${fmtMin(r.banco_horas_saldo||0)}</div></div>` +
      `<div class="stat-card" data-g="diaria"><div class="stat-label">Atrasos</div><div class="stat-value">${r.atrasos||0}</div></div>` +
      `<div class="stat-card" data-g="semi"><div class="stat-label">Faltas</div><div class="stat-value">${r.faltas||0}</div></div>`;
  }
  // ═══ FERIADOS ═══
  async function loadCompFeriados() {
    const d = await compApi({action:'compliance_feriados_list'}); const items = d.data||[];
    document.getElementById('compFeriadosBody').innerHTML = items.length ? items.map(f=>`<tr><td>${String(f.data).split('-').reverse().join('/')}</td><td>${esc(f.descricao||'—')}</td><td><span class="status-pill" style="background:${{nacional:'#1a6bb5',estadual:'#d4830a',municipal:'#2d7a3a',ponto_facultativo:'#888'}[f.tipo]||'#888'};color:#fff;">${esc(f.tipo||'—')}</span></td><td><button onclick="excluirFeriado('${f.id}')" style="background:#C8102E;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;">Excluir</button></td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">Nenhum feriado cadastrado.</td></tr>';
  }
  async function salvarFeriado() {
    const data = document.getElementById('compFeriadoData').value; const desc = document.getElementById('compFeriadoDesc').value; const tipo = document.getElementById('compFeriadoTipo').value;
    if (!data || !desc) return showToast('Preencha data e descricao.','error');
    const d = await compApi({action:'compliance_feriados_save', data, descricao: desc, tipo});
    if (d.error) return showToast(d.error,'error');
    showToast('Feriado salvo.','success'); document.getElementById('compFeriadoData').value=''; document.getElementById('compFeriadoDesc').value=''; loadCompFeriados();
  }
  async function excluirFeriado(id) {
    if (!await _lumiedConfirm('Excluir este feriado?')) return;
    const d = await compApi({action:'compliance_feriados_delete', id});
    if (d.error) return showToast(d.error,'error');
    showToast('Feriado excluido.','success'); loadCompFeriados();
  }
  // ═══ CONFIG PONTO ═══
  async function loadCompConfig() {
    const d = await compApi({action:'compliance_config_ponto_list'}); const cfg = d.data || d || {};
    const el = document.getElementById('compConfigForm');
    const fields = [
      {key:'tolerancia_minutos', label:'Tolerancia (minutos)', type:'number', def:10},
      {key:'jornada_diaria_minutos', label:'Jornada diaria (minutos)', type:'number', def:480},
      {key:'adicional_dia_util_pct', label:'Adicional dia util (%)', type:'number', def:50},
      {key:'adicional_domingo_feriado_pct', label:'Adicional dom/feriado (%)', type:'number', def:100},
      {key:'banco_horas_habilitado', label:'Banco de horas habilitado', type:'checkbox', def:false},
      {key:'limite_he_diario_minutos', label:'Limite HE diario (min)', type:'number', def:120},
      {key:'limite_he_mensal_minutos', label:'Limite HE mensal (min)', type:'number', def:2640},
    ];
    el.innerHTML = fields.map(f => {
      const val = cfg[f.key] !== undefined ? cfg[f.key] : f.def;
      if (f.type === 'checkbox') return `<div class="ff" style="margin-bottom:10px;"><label style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="compCfg_${f.key}" ${val?'checked':''} style="width:auto;"> ${f.label}</label></div>`;
      return `<div class="ff" style="margin-bottom:10px;"><label>${f.label}</label><input type="${f.type}" id="compCfg_${f.key}" value="${val}" style="padding:8px 12px;border:1.5px solid #e2dbd1;border-radius:8px;font-size:13px;background:#fdfbf8;width:200px;"></div>`;
    }).join('') + `<button onclick="salvarCompConfig()" style="margin-top:10px;padding:10px 24px;background:#2d7a3a;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;">Salvar Configuracao</button>`;
  }
  async function salvarCompConfig() {
    const config = {};
    ['tolerancia_minutos','jornada_diaria_minutos','adicional_dia_util_pct','adicional_domingo_feriado_pct','limite_he_diario_minutos','limite_he_mensal_minutos'].forEach(k => { config[k] = parseInt(document.getElementById('compCfg_'+k).value)||0; });
    config.banco_horas_habilitado = document.getElementById('compCfg_banco_horas_habilitado').checked;
    const d = await compApi({action:'compliance_config_ponto_save', ...config});
    if (d.error) return showToast(d.error,'error');
    showToast('Configuracao salva.','success');
  }
  // ═══ BANCO DE HORAS ═══
  async function loadCompBancoHorasInit() {
    const selA = document.getElementById('compBhAno');
    if (!selA.options.length) { const y=new Date().getFullYear(); for(let i=y-2;i<=y+1;i++){ const o=document.createElement('option'); o.value=i; o.textContent=i; selA.appendChild(o); } selA.value=y; }
    const selP = document.getElementById('compBhProf');
    if (selP.options.length <= 1) {
      const d = await compApi({action:'compliance_horarios_list'});
      const profs = new Map(); (d.data||[]).forEach(h => { if(h.professoras) profs.set(h.professoras.id, h.professoras.nome); });
      profs.forEach((nome, id) => { const o = document.createElement('option'); o.value=id; o.textContent=nome; selP.appendChild(o); });
    }
    loadCompBancoHoras();
  }
  async function loadCompBancoHoras() {
    const ano = document.getElementById('compBhAno').value;
    const profId = document.getElementById('compBhProf').value;
    const body = {action:'compliance_banco_horas_list', ano: parseInt(ano)};
    if (profId) body.professora_id = profId;
    const d = await compApi(body);
    const items = d.data || [];
    const meses = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    // Summary cards
    const totalCred = items.reduce((s,i) => s + (i.creditos_min||0), 0);
    const totalDeb = items.reduce((s,i) => s + (i.debitos_min||0), 0);
    const saldoAtual = items.length ? items[items.length-1].saldo_final_min || 0 : 0;
    document.getElementById('compBhCards').innerHTML =
      `<div class="stat-card" data-g="semi"><div class="stat-label">Creditos (ano)</div><div class="stat-value">${fmtMin(totalCred)}</div></div>` +
      `<div class="stat-card" data-g="integral"><div class="stat-label">Debitos (ano)</div><div class="stat-value">${fmtMin(totalDeb)}</div></div>` +
      `<div class="stat-card" data-g="${saldoAtual >= 0 ? 'total' : 'diaria'}"><div class="stat-label">Saldo Atual</div><div class="stat-value">${fmtMin(saldoAtual)}</div></div>`;
    document.getElementById('compBhBody').innerHTML = items.length ? items.map(i => {
      const sf = i.saldo_final_min || 0;
      const color = sf > 0 ? '#2d7a3a' : sf < 0 ? '#C8102E' : '#888';
      return `<tr><td>${esc(i.professoras?.nome||'—')}</td><td>${meses[i.mes]||i.mes}/${i.ano}</td><td>${fmtMin(i.saldo_anterior_min||0)}</td><td style="color:#2d7a3a;font-weight:600;">+${fmtMin(i.creditos_min||0)}</td><td style="color:#C8102E;font-weight:600;">-${fmtMin(i.debitos_min||0)}</td><td style="color:${color};font-weight:700;">${fmtMin(sf)}</td><td>${i.fechado ? '<span class="status-pill" style="background:#2d7a3a;color:#fff;">Fechado</span>' : '<span class="status-pill" style="background:#d4830a;color:#fff;">Aberto</span>'}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty-state">Nenhum registro de banco de horas.</td></tr>';
  }
  // ═══ RESUMO MENSAL DETALHADO ═══
  async function loadCompResumoMensalInit() {
    const selM = document.getElementById('compRmMes'); const selA = document.getElementById('compRmAno');
    if (!selM.options.length) { const meses = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']; meses.forEach((m,i)=>{ const o=document.createElement('option'); o.value=i+1; o.textContent=m; selM.appendChild(o); }); selM.value = new Date().getMonth()+1; }
    if (!selA.options.length) { const y=new Date().getFullYear(); for(let i=y-2;i<=y+1;i++){ const o=document.createElement('option'); o.value=i; o.textContent=i; selA.appendChild(o); } selA.value=y; }
    loadCompResumoMensal();
  }
  async function loadCompResumoMensal() {
    const mes = document.getElementById('compRmMes').value; const ano = document.getElementById('compRmAno').value;
    const d = await compApi({action:'compliance_ponto_resumo_mensal', mes: parseInt(mes), ano: parseInt(ano)});
    const items = Array.isArray(d.data) ? d.data : (d.data ? [d.data] : []);
    // Totals
    const tNorm = items.reduce((s,i) => s + (i.total_horas_normais_min||0), 0);
    const tHe50 = items.reduce((s,i) => s + (i.total_he_50_min||0), 0);
    const tHe100 = items.reduce((s,i) => s + (i.total_he_100_min||0), 0);
    const tNot = items.reduce((s,i) => s + (i.total_noturnas_min||0), 0);
    const tAtr = items.reduce((s,i) => s + (i.total_atrasos_min||0), 0);
    const tFalt = items.reduce((s,i) => s + (i.total_faltas||0), 0);
    document.getElementById('compRmTotals').innerHTML =
      `<div class="stat-card" data-g="total"><div class="stat-label">Professoras</div><div class="stat-value">${items.length}</div></div>` +
      `<div class="stat-card" data-g="semi"><div class="stat-label">HE 50%</div><div class="stat-value">${fmtMin(tHe50)}</div></div>` +
      `<div class="stat-card" data-g="integral"><div class="stat-label">HE 100%</div><div class="stat-value">${fmtMin(tHe100)}</div></div>` +
      `<div class="stat-card" data-g="diaria"><div class="stat-label">Noturnas</div><div class="stat-value">${fmtMin(tNot)}</div></div>` +
      `<div class="stat-card" data-g="semi"><div class="stat-label">Atrasos</div><div class="stat-value">${fmtMin(tAtr)}</div></div>` +
      `<div class="stat-card" data-g="integral"><div class="stat-label">Faltas</div><div class="stat-value">${tFalt}</div></div>`;
    document.getElementById('compRmBody').innerHTML = items.length ? items.map(r => {
      const bhSaldo = r.banco_horas ? r.banco_horas.saldo_final_min : null;
      const bhColor = bhSaldo === null ? '#888' : (bhSaldo >= 0 ? '#2d7a3a' : '#C8102E');
      return `<tr><td>${esc(r.nome||'—')}</td><td>${r.dias_trabalhados}</td><td>${r.total_horas_normais_fmt||fmtMin(r.total_horas_normais_min||0)}</td><td style="color:#d4830a;font-weight:600;">${r.total_he_50_fmt||fmtMin(r.total_he_50_min||0)}</td><td style="color:#C8102E;font-weight:600;">${r.total_he_100_fmt||fmtMin(r.total_he_100_min||0)}</td><td>${fmtMin(r.total_noturnas_min||0)}</td><td>${fmtMin(r.total_atrasos_min||0)}</td><td>${r.total_faltas||0}</td><td>${r.dsr_fmt||fmtMin(r.dsr_min||0)}</td><td style="color:${bhColor};font-weight:600;">${bhSaldo !== null ? fmtMin(bhSaldo) : '—'}</td></tr>`;
    }).join('') : '<tr><td colspan="10" class="empty-state">Nenhum registro processado neste periodo.</td></tr>';
  }
  // ═══ CONTA & FINANCEIRO ═══
  async function loadContaFinanceiro() {
    const [resp, decisoes, consumo, extras] = await Promise.all([
      api({action:'financeiro_resp_get'}), api({action:'financeiro_decisoes_pendentes'}),
      api({action:'financeiro_wa_consumo'}), api({action:'financeiro_extras_disponiveis'}),
    ]);
    if(resp.data){const r=resp.data;document.getElementById('cfRespNome').value=r.resp_financeiro_nome||'';document.getElementById('cfRespEmail').value=r.resp_financeiro_email||'';document.getElementById('cfRespTel').value=r.resp_financeiro_telefone||'';document.getElementById('cfRespCargo').value=r.resp_financeiro_cargo||'';
    if(r.resp_financeiro_definido){document.getElementById('cfRespBloqueado').style.display='block';document.getElementById('cfRespEditavel').style.display='none';['cfRespNome','cfRespEmail','cfRespTel','cfRespCargo'].forEach(id=>{const el=document.getElementById(id);el.readOnly=true;el.style.background='#f5f0ea';el.style.color='#7a7169';});document.getElementById('cfRespSaveBtn').style.display='none';}else{document.getElementById('cfRespEditavel').style.display='block';document.getElementById('cfRespBloqueado').style.display='none';}}
    const dec=decisoes.data||[];document.getElementById('cfDecisoesPend').textContent=dec.length;
    document.getElementById('cfDecisoesBody').innerHTML=dec.length?dec.map(d=>{const dt=new Date(d.criado_em).toLocaleDateString('pt-BR');const tipoMap={excedente_whatsapp:'WhatsApp Extra',upgrade_tier:'Upgrade',downgrade_tier:'Downgrade',addon_msgs:'Add-on Msgs',addon_storage:'Add-on Storage',addon_usuarios:'Add-on Usuários'};return`<tr><td>${dt}</td><td>${tipoMap[d.tipo]||d.tipo}</td><td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.descricao}</td><td><strong>R$ ${(d.valor_estimado||0).toFixed(2)}</strong>${d.recorrente?'/mês':''}</td><td><button onclick="aprovarDecisao('${d.id}')" style="background:#2d7a3a;color:#fff;border:none;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px;margin-right:4px;">Aprovar</button><button onclick="rejeitarDecisao('${d.id}')" style="background:#C8102E;color:#fff;border:none;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:12px;">Rejeitar</button></td></tr>`}).join(''):'<tr><td colspan="5" class="empty-state">Nenhuma decisão pendente.</td></tr>';
    if(consumo.consumo){const c=consumo.consumo;document.getElementById('cfWaConsumo').textContent=c.templates_enviados||0;document.getElementById('cfWaLimite').textContent=`de ${c.limite_templates||0} msgs`;}
    const extrasArr=extras.data||[];document.getElementById('cfExtrasGrid').innerHTML=extrasArr.map(e=>`<div style="background:#fff;border:1px solid #e2dbd1;border-radius:12px;padding:16px;"><div style="font-size:14px;font-weight:700;margin-bottom:4px;">${e.nome}</div><div style="font-size:12px;color:#7a7169;margin-bottom:8px;">${e.descricao}</div><div style="font-size:18px;font-weight:900;color:#C8102E;margin-bottom:10px;">R$ ${e.preco.toFixed(2)}<span style="font-size:11px;font-weight:400;color:#7a7169;">${e.recorrente?'/mês':' único'}</span></div><button onclick="solicitarExtra('${e.id}')" style="width:100%;padding:8px;background:#1a6bb5;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:12px;">Solicitar</button></div>`).join('');
  }
  async function salvarRespFinanceiro(){const d=await api({action:'financeiro_resp_salvar',resp_financeiro_nome:document.getElementById('cfRespNome').value,resp_financeiro_email:document.getElementById('cfRespEmail').value,resp_financeiro_telefone:document.getElementById('cfRespTel').value,resp_financeiro_cargo:document.getElementById('cfRespCargo').value});if(d.error)return showToast(d.error,'error');showToast('Responsável financeiro salvo.','success');}
  async function aprovarDecisao(id){if(!await _lumiedConfirm('Aprovar esta decisão financeira?'))return;const d=await api({action:'financeiro_decisao_aprovar',id});if(d.error)return showToast(d.error,'error');showToast('Decisão aprovada.','success');loadContaFinanceiro();}
  async function rejeitarDecisao(id){const motivo=prompt('Motivo da rejeição:');if(!motivo)return;const d=await api({action:'financeiro_decisao_rejeitar',id,motivo});if(d.error)return showToast(d.error,'error');showToast('Decisão rejeitada.','info');loadContaFinanceiro();}
  async function solicitarExtra(extraId){if(!await _lumiedConfirm('Solicitar este extra? O responsável financeiro será notificado para aprovação.'))return;const d=await api({action:'financeiro_solicitar_extra',extra_id:extraId});if(d.error)return showToast(d.error,'error');showToast('Solicitação enviada ao responsável financeiro.','success');loadContaFinanceiro();}
  // ═══ ROI DASHBOARD ═══
  async function loadRoiDashboard(){try{const d=await fetch(SUPABASE_URL+'/functions/v1/lumied-ai',{method:'POST',headers:{'Content-Type':'application/json','apikey':ANON,'Authorization':'Bearer '+ANON},body:JSON.stringify({action:'roi_dashboard',_token:getToken()})}).then(r=>r.json());if(d.error)return;const r=d.data?.roi_estimado||{};const m=d.data?.metricas_reais||{};const fmt=n=>'R$ '+Math.round(n).toLocaleString('pt-BR');document.getElementById('roiEconMes').textContent=fmt(r.total_economia_mes||0);document.getElementById('roiEconAnual').textContent=fmt(r.total_economia_anual||0);document.getElementById('roiHoras').textContent=(r.horas_economizadas_mes||0)+'h';document.getElementById('roiRetidos').textContent=r.alunos_retidos_mes||0;document.getElementById('roiOpText').textContent=fmt(r.economia_operacional_mes||0)+'/mês — '+r.horas_economizadas_mes+'h de trabalho admin economizadas';document.getElementById('roiEvasaoText').textContent=fmt(r.evasao_evitada_mes||0)+'/mês — '+r.alunos_retidos_mes+' alunos que teriam saído foram retidos';document.getElementById('roiInadText').textContent=fmt(r.inadimplencia_evitada_mes||0)+'/mês em boletos que seriam perdidos';document.getElementById('roiResumo').textContent='Sua escola economiza '+fmt(r.total_economia_mes||0)+' por mês com o Lumied';document.getElementById('roiResumoSub').textContent='Isso equivale a '+fmt(r.total_economia_anual||0)+' por ano — com base nos dados reais da escola.';}catch(e){console.log('[ROI]',e);}}

  // ═══ CONTRATOS DIGITAIS ═══
  var contratosData = [];
  async function loadContratos() {
    const el = document.getElementById('contratosListContent');
    el.innerHTML = '<div class="empty-state">Carregando...</div>';
    const d = await api({ action: 'contratos_list' });
    if (d.error) { el.innerHTML = '<div class="empty-state">Erro: ' + d.error + '</div>'; return; }
    contratosData = Array.isArray(d) ? d : [];
    renderContratos();
  }

  function filtrarContratos() {
    renderContratos();
  }

  function renderContratos() {
    const el = document.getElementById('contratosListContent');
    const busca = (document.getElementById('contratosBusca').value || '').toLowerCase();
    const status = document.getElementById('contratosFiltroStatus').value;
    let list = contratosData;
    if (busca) list = list.filter(c => (c.familia_nome || '').toLowerCase().includes(busca) || (c.familia_email || '').toLowerCase().includes(busca));
    if (status) list = list.filter(c => c.status === status);
    if (!list.length) { el.innerHTML = '<div class="empty-state">Nenhum contrato encontrado.</div>'; return; }
    const statusBadge = s => {
      const map = { rascunho: ['Rascunho', '#f5f0ea', '#7a7169'], enviado: ['Enviado', '#EBF5FF', '#1a6bb5'], visualizado: ['Visualizado', '#FFF3CD', '#856404'], assinado: ['Assinado', '#D4EDDA', '#155724'], cancelado: ['Cancelado', '#fdf0f2', '#a00d24'] };
      const [label, bg, color] = map[s] || [s, '#f5f0ea', '#7a7169'];
      return '<span style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:100px;background:' + bg + ';color:' + color + ';">' + label + '</span>';
    };
    const fmtDate = d => d ? new Date(d).toLocaleDateString('pt-BR') + ' ' + new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
    let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="border-bottom:2px solid var(--border);text-align:left;">';
    html += '<th style="padding:10px;">Familia</th><th>Template</th><th>Status</th><th>Enviado</th><th>Assinaturas</th><th style="text-align:right;">Acoes</th></tr></thead><tbody>';
    list.forEach(c => {
      const tplName = c.contrato_templates?.nome || '—';
      const sigs = (c.contrato_assinaturas || []).length;
      html += '<tr style="border-bottom:1px solid var(--border);">';
      html += '<td style="padding:10px;"><strong>' + (c.familia_nome || '—') + '</strong><br><span style="font-size:11px;color:var(--muted);">' + (c.familia_email || '') + '</span></td>';
      html += '<td>' + tplName + '</td>';
      html += '<td>' + statusBadge(c.status) + '</td>';
      html += '<td style="font-size:12px;">' + fmtDate(c.enviado_em) + '</td>';
      html += '<td style="text-align:center;">' + sigs + '</td>';
      html += '<td style="text-align:right;white-space:nowrap;">';
      if (c.status === 'rascunho') html += '<button onclick="enviarContrato(\'' + c.id + '\')" style="padding:5px 10px;background:#EBF5FF;color:#1a6bb5;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;margin-right:4px;">Enviar</button>';
      if (c.status !== 'assinado' && c.status !== 'cancelado') html += '<button onclick="copiarLinkAssinatura(\'' + c.id + '\')" style="padding:5px 10px;background:#f5f0ea;color:var(--text);border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;margin-right:4px;">Link</button>';
      if (c.status !== 'assinado') html += '<button onclick="excluirContrato(\'' + c.id + '\')" style="padding:5px 10px;background:#fdf0f2;color:#a00d24;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;">Excluir</button>';
      html += '</td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  async function novoContratoModal() {
    // Load templates
    const d = await api({ action: 'contrato_templates_list' });
    const tpls = Array.isArray(d) ? d : [];
    const sel = document.getElementById('ncTemplate');
    sel.innerHTML = '<option value="">Selecione...</option>';
    tpls.forEach(t => { sel.innerHTML += '<option value="' + t.id + '">' + t.nome + '</option>'; });
    document.getElementById('ncEmail').value = '';
    document.getElementById('ncNome').value = '';
    document.getElementById('ncAluno').value = '';
    document.getElementById('ncTurma').value = '';
    document.getElementById('ncValor').value = '';
    document.getElementById('modalNovoContrato').style.display = 'flex';
  }

  function fecharModalContrato() {
    document.getElementById('modalNovoContrato').style.display = 'none';
  }

  async function gerarContrato(enviar) {
    const template_id = document.getElementById('ncTemplate').value;
    const familia_email = document.getElementById('ncEmail').value.trim();
    const familia_nome = document.getElementById('ncNome').value.trim();
    const nome_aluno = document.getElementById('ncAluno').value.trim();
    const turma = document.getElementById('ncTurma').value.trim();
    const valor = document.getElementById('ncValor').value.trim();
    if (!template_id) return showToast('Selecione um template.', 'error');
    if (!familia_email) return showToast('Informe o email da familia.', 'error');
    const dados = {};
    if (nome_aluno) dados.nome_aluno = nome_aluno;
    if (turma) dados.turma = turma;
    if (valor) dados.valor_mensalidade = valor;
    const d = await api({ action: 'contrato_gerar', template_id, familia_email, familia_nome, dados });
    if (d.error) return showToast(d.error, 'error');
    showToast('Contrato gerado com sucesso!', 'success');
    if (enviar && d.id) {
      await api({ action: 'contrato_enviar', id: d.id });
      showToast('Contrato enviado para ' + familia_email, 'success');
    }
    fecharModalContrato();
    loadContratos();
  }

  async function enviarContrato(id) {
    if (!await _lumiedConfirm('Enviar contrato para a familia?')) return;
    const d = await api({ action: 'contrato_enviar', id });
    if (d.error) return showToast(d.error, 'error');
    showToast('Contrato enviado!', 'success');
    loadContratos();
  }

  function copiarLinkAssinatura(id) {
    const url = location.origin + '/assinar.html?id=' + id;
    navigator.clipboard.writeText(url).then(() => showToast('Link copiado!', 'success')).catch(() => {
      prompt('Copie o link:', url);
    });
  }

  async function excluirContrato(id) {
    if (!await _lumiedConfirm('Excluir este contrato?')) return;
    const d = await api({ action: 'contrato_delete', id });
    if (d.error) return showToast(d.error, 'error');
    showToast('Contrato excluido.', 'success');
    loadContratos();
  }
