// Auto-extraído do gerente.html (Onda 4 do refator).
// Funções globais — chamadas de panel switchers + onclick handlers no HTML.
// Carregado via <script defer> após o inline script principal.
  // ═══ COMPLIANCE NOVOS MÓDULOS — LGPD, AVCB, ANVISA, ACESSIBILIDADE, SEGUROS, FISCAL ═══

  // Tab helpers reutilizáveis
  function _compTabSwitch(prefix, tabs, activeTab, loadFn) {
    var aS = 'padding:12px 20px;font-size:13px;font-weight:700;background:#fff;color:#C8102E;cursor:pointer;font-family:inherit;border:2px solid #C8102E;border-radius:10px;border-bottom:4px solid #C8102E;box-shadow:0 2px 8px rgba(0,0,0,0.08);';
    var iS = 'padding:12px 20px;font-size:13px;font-weight:700;background:#fff;color:#888;cursor:pointer;font-family:inherit;border:2px solid #ddd;border-radius:10px;border-bottom:4px solid transparent;box-shadow:none;';
    tabs.forEach(function(t) {
      var btn = document.getElementById(prefix + 'Tab' + t.charAt(0).toUpperCase() + t.slice(1));
      var sec = document.getElementById(prefix + t.charAt(0).toUpperCase() + t.slice(1) + 'Section');
      if (btn) btn.style.cssText = (t === activeTab) ? aS : iS;
      if (sec) sec.style.display = (t === activeTab) ? '' : 'none';
    });
    if (loadFn) loadFn();
  }

  function switchLgpdTab(t) { _compTabSwitch('lgpd', ['consent','incidentes','solicitacoes'], t, {consent:loadLgpdConsent,incidentes:loadLgpdInc,solicitacoes:loadLgpdSolic}[t]); }
  function switchAvcbTab(t) { _compTabSwitch('avcb', ['cert','ext','simulados','plano'], t, {cert:loadAvcbCert,ext:loadExtintores,simulados:loadSimulados,plano:loadPlanoEvac}[t]); }
  function switchAnvisaTab(t) { _compTabSwitch('anvisa', ['temp','pragas','manip'], t, {temp:loadAnvisaTemp,pragas:loadAnvisaPragas,manip:loadAnvisaManip}[t]); }
  function switchAcessTab(t) { _compTabSwitch('acess', ['audit','pei'], t, {audit:loadAcessAudit,pei:loadAcessPei}[t]); }

  // Load functions (entry points)
  function loadCompLgpd() { loadLgpdConsent(); }
  function loadCompAvcb() { loadAvcbCert(); }
  function loadCompAnvisa() { loadAnvisaTemp(); }
  function loadCompAcessibilidade() { loadAcessAudit(); }
  function loadCompSeguros() { loadSeguros(); }
  function loadCompFiscal() { loadFiscal(); }

  // ── INCIDENTES (form funcional) ──
  function toggleCompIncForm() { var el=document.getElementById('compIncForm'); el.style.display=el.style.display==='none'?'block':'none'; if(el.style.display==='block'&&!document.getElementById('cieData').value) document.getElementById('cieData').value=new Date().toISOString().split('T')[0]; }
  async function salvarCompInc() {
    var d = await compApi({action:'compliance_incidente_criar', tipo:document.getElementById('cieTipo').value, gravidade:document.getElementById('cieGrav').value, data_ocorrencia:document.getElementById('cieData').value, local_ocorrencia:document.getElementById('cieLocal').value, vitima_nome:document.getElementById('cieVitima').value, agressor_nome:document.getElementById('cieAgressor').value, descricao:document.getElementById('cieDesc').value});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Incidente registrado!','success'); toggleCompIncForm(); loadCompIncidentes();
  }

  // ── CALENDÁRIO (form funcional) ──
  function toggleCompCalForm() { var el=document.getElementById('compCalForm'); el.style.display=el.style.display==='none'?'block':'none'; }
  async function salvarCompCal() {
    var d = await compApi({action:'compliance_calendario_criar', titulo:document.getElementById('ccalTitulo').value, categoria:document.getElementById('ccalCat').value, data_limite:document.getElementById('ccalData').value, prioridade:document.getElementById('ccalPri').value});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Prazo criado!','success'); toggleCompCalForm(); loadCompCalendario();
  }

  // ── LGPD ──
  function toggleLgpdConsentForm() { var el=document.getElementById('lgpdConsentForm'); el.style.display=el.style.display==='none'?'block':'none'; }
  function toggleLgpdIncForm() { var el=document.getElementById('lgpdIncForm'); el.style.display=el.style.display==='none'?'block':'none'; if(el.style.display==='block'&&!document.getElementById('liData').value) document.getElementById('liData').value=new Date().toISOString().split('T')[0]; }
  function toggleLgpdSolicForm() { var el=document.getElementById('lgpdSolicForm'); el.style.display=el.style.display==='none'?'block':'none'; }

  async function loadLgpdConsent() {
    var d = await compApi({action:'lgpd_consentimentos_list'}); var list = d.data||[];
    var el = document.getElementById('lgpdConsentList');
    if (!list.length) { el.innerHTML='<div class="empty-state">Nenhum consentimento cadastrado.</div>'; return; }
    el.innerHTML = '<table class="data-table"><thead><tr><th>Tipo</th><th>Título</th><th>Obrigatório</th><th>Vigente desde</th></tr></thead><tbody>' +
      list.map(function(c){ return '<tr><td>'+esc(c.tipo)+'</td><td>'+esc(c.titulo)+'</td><td>'+(c.obrigatorio?'<span class="status-pill" style="background:#C8102E;color:#fff;">Sim</span>':'Não')+'</td><td>'+(c.vigente_desde?c.vigente_desde.split('-').reverse().join('/'):'—')+'</td></tr>'; }).join('') + '</tbody></table>';
  }
  async function salvarLgpdConsent() {
    var d = await compApi({action:'lgpd_consentimento_criar', tipo:document.getElementById('lcTipo').value, titulo:document.getElementById('lcTitulo').value, descricao:document.getElementById('lcDesc').value, obrigatorio:document.getElementById('lcObrig').value==='true'});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Consentimento criado!','success'); toggleLgpdConsentForm(); loadLgpdConsent();
  }
  async function loadLgpdInc() {
    var d = await compApi({action:'lgpd_incidentes_list'}); var list = d.data||[];
    var el = document.getElementById('lgpdIncList');
    if (!list.length) { el.innerHTML='<div class="empty-state">Nenhum incidente LGPD.</div>'; return; }
    var fmtD = function(s){ return s ? s.split('-').reverse().join('/') : '—'; };
    el.innerHTML = '<table class="data-table"><thead><tr><th>Data</th><th>Tipo</th><th>Gravidade</th><th>Titulares</th><th>ANPD</th><th>Status</th></tr></thead><tbody>' +
      list.map(function(i){ return '<tr><td>'+fmtD(i.data_ocorrencia)+'</td><td>'+esc(i.tipo)+'</td><td><span class="status-pill" style="background:'+({baixa:'#888',media:'#d4830a',alta:'#C8102E',critica:'#7a0016'}[i.gravidade]||'#888')+';color:#fff;">'+esc(i.gravidade)+'</span></td><td>'+(i.titulares_afetados||0)+'</td><td>'+(i.notificado_anpd?'Sim':'<span style="color:#C8102E;">Não</span>')+'</td><td>'+esc(i.status)+'</td></tr>'; }).join('') + '</tbody></table>';
  }
  async function salvarLgpdInc() {
    var d = await compApi({action:'lgpd_incidente_criar', tipo:document.getElementById('liTipo').value, gravidade:document.getElementById('liGrav').value, data_ocorrencia:document.getElementById('liData').value, dados_afetados:document.getElementById('liDados').value, titulares_afetados:parseInt(document.getElementById('liTit').value)||0, descricao:document.getElementById('liDesc').value});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Incidente LGPD registrado!','success'); toggleLgpdIncForm(); loadLgpdInc();
  }
  async function loadLgpdSolic() {
    var d = await compApi({action:'lgpd_solicitacoes_list'}); var list = d.data||[];
    var el = document.getElementById('lgpdSolicList');
    if (!list.length) { el.innerHTML='<div class="empty-state">Nenhuma solicitação.</div>'; return; }
    var fmtD = function(s){ return s ? s.split('-').reverse().join('/') : '—'; };
    el.innerHTML = '<table class="data-table"><thead><tr><th>Data</th><th>Tipo</th><th>Solicitante</th><th>Email</th><th>Prazo</th><th>Status</th></tr></thead><tbody>' +
      list.map(function(s){ return '<tr><td>'+new Date(s.criado_em).toLocaleDateString('pt-BR')+'</td><td>'+esc(s.tipo)+'</td><td>'+esc(s.solicitante_nome)+'</td><td>'+esc(s.solicitante_email)+'</td><td>'+fmtD(s.prazo_legal)+'</td><td><span class="status-pill" style="background:'+({pendente:'#d4830a',em_andamento:'#1a6bb5',concluido:'#2d7a3a',recusado:'#C8102E'}[s.status]||'#888')+';color:#fff;">'+esc(s.status)+'</span></td></tr>'; }).join('') + '</tbody></table>';
  }
  async function salvarLgpdSolic() {
    var d = await compApi({action:'lgpd_solicitacao_criar', tipo:document.getElementById('lsTipo').value, solicitante_nome:document.getElementById('lsNome').value, solicitante_email:document.getElementById('lsEmail').value, descricao:document.getElementById('lsDesc').value});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Solicitação registrada!','success'); toggleLgpdSolicForm(); loadLgpdSolic();
  }

  // ── AVCB ──
  async function loadAvcbCert() {
    var d = await compApi({action:'avcb_get'}); var a = d.data;
    var el = document.getElementById('avcbContent');
    if (!a) { el.innerHTML='<div class="empty-state">Nenhum AVCB cadastrado. <button onclick="salvarAvcb()" class="btn-create" style="width:auto;padding:8px 16px;font-size:12px;margin-top:8px;">Cadastrar AVCB</button></div>'; return; }
    var fmtD = function(s){ return s ? s.split('-').reverse().join('/') : '—'; };
    var cor = a.status==='vigente'?'#2d7a3a':a.status==='vencido'?'#C8102E':'#d4830a';
    el.innerHTML = '<div class="card" style="padding:20px;border-left:4px solid '+cor+';"><div style="display:flex;justify-content:space-between;align-items:center;"><div><div style="font-size:18px;font-weight:700;">AVCB nº '+esc(a.numero_avcb||'—')+'</div><div style="color:var(--muted);margin-top:4px;">Emissão: '+fmtD(a.data_emissao)+' | Validade: '+fmtD(a.data_validade)+'</div></div><span class="status-pill" style="background:'+cor+';color:#fff;">'+esc(a.status)+'</span></div></div>';
  }
  async function salvarAvcb() {
    var num = prompt('Número do AVCB:'); if (!num) return;
    var val = prompt('Data de validade (AAAA-MM-DD):'); if (!val) return;
    var d = await compApi({action:'avcb_salvar', numero_avcb:num, data_emissao:new Date().toISOString().split('T')[0], data_validade:val, status:'vigente'});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('AVCB salvo!','success'); loadAvcbCert();
  }
  async function loadExtintores() {
    var d = await compApi({action:'extintores_list'}); var list = d.data||[];
    var el = document.getElementById('extintoresContent');
    el.innerHTML = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px;"><button onclick="addExtintor()" class="btn-create" style="width:auto;padding:8px 16px;font-size:12px;">+ Novo Extintor</button></div>' +
      (list.length ? '<table class="data-table"><thead><tr><th>Tipo</th><th>Localização</th><th>Patrimônio</th><th>Recarga</th><th>Próxima</th><th>Status</th></tr></thead><tbody>' +
      list.map(function(e){ var cor = e.status==='ok'?'#2d7a3a':'#C8102E'; return '<tr><td>'+esc(e.tipo)+'</td><td>'+esc(e.localizacao)+'</td><td>'+esc(e.numero_patrimonio||'—')+'</td><td>'+(e.data_recarga?e.data_recarga.split('-').reverse().join('/'):'—')+'</td><td>'+(e.proxima_recarga?e.proxima_recarga.split('-').reverse().join('/'):'—')+'</td><td><span class="status-pill" style="background:'+cor+';color:#fff;">'+esc(e.status)+'</span></td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty-state">Nenhum extintor cadastrado.</div>');
  }
  async function addExtintor() {
    var tipo = prompt('Tipo (agua, po_quimico, co2, abc):'); if (!tipo) return;
    var loc = prompt('Localização:'); if (!loc) return;
    var d = await compApi({action:'extintor_salvar', tipo:tipo, localizacao:loc, status:'ok'});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Extintor adicionado!','success'); loadExtintores();
  }
  async function loadSimulados() {
    var d = await compApi({action:'simulados_list'}); var list = d.data||[];
    var el = document.getElementById('simuladosContent');
    var fmtD = function(s){ return s ? s.split('-').reverse().join('/') : '—'; };
    el.innerHTML = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px;"><button onclick="addSimulado()" class="btn-create" style="width:auto;padding:8px 16px;font-size:12px;">+ Registrar Simulado</button></div>' +
      (list.length ? '<table class="data-table"><thead><tr><th>Data</th><th>Tipo</th><th>Participantes</th><th>Tempo Evacuação</th><th>Próximo</th></tr></thead><tbody>' +
      list.map(function(s){ return '<tr><td>'+fmtD(s.data_simulado)+'</td><td>'+esc(s.tipo)+'</td><td>'+(s.participantes||'—')+'</td><td>'+(s.tempo_evacuacao_seg?s.tempo_evacuacao_seg+'s':'—')+'</td><td>'+fmtD(s.proximo_simulado)+'</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty-state">Nenhum simulado registrado.</div>');
  }
  async function addSimulado() {
    var data = prompt('Data do simulado (AAAA-MM-DD):'); if (!data) return;
    var part = prompt('Número de participantes:');
    var tempo = prompt('Tempo de evacuação (segundos):');
    var d = await compApi({action:'simulado_criar', data_simulado:data, tipo:'incendio', participantes:parseInt(part)||0, tempo_evacuacao_seg:parseInt(tempo)||null});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Simulado registrado!','success'); loadSimulados();
  }
  async function loadPlanoEvac() {
    var d = await compApi({action:'plano_evacuacao_get'}); var p = d.data;
    var el = document.getElementById('planoEvacContent');
    if (!p) { el.innerHTML='<div class="empty-state">Nenhum plano cadastrado. <button onclick="salvarPlanoEvac()" class="btn-create" style="width:auto;padding:8px 16px;font-size:12px;margin-top:8px;">Criar Plano</button></div>'; return; }
    el.innerHTML = '<div class="card" style="padding:20px;"><div style="font-weight:700;margin-bottom:8px;">Ponto de encontro: '+esc(p.ponto_encontro||'—')+'</div><div>Responsável geral: '+esc(p.responsavel_geral||'—')+'</div><div style="color:var(--muted);margin-top:8px;">Atualizado em: '+new Date(p.atualizado_em).toLocaleDateString('pt-BR')+'</div></div>';
  }
  async function salvarPlanoEvac() {
    var ponto = prompt('Ponto de encontro:'); if (!ponto) return;
    var resp = prompt('Responsável geral:');
    var d = await compApi({action:'plano_evacuacao_salvar', ponto_encontro:ponto, responsavel_geral:resp});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Plano salvo!','success'); loadPlanoEvac();
  }

  // ── ANVISA ──
  async function loadAnvisaTemp() {
    var d = await compApi({action:'anvisa_temperaturas_list'}); var list = d.data||[];
    var el = document.getElementById('anvisaTempContent');
    var fmtDt = function(s){ return s ? new Date(s).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}) : '—'; };
    el.innerHTML = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px;"><button onclick="addAnvisaTemp()" class="btn-create" style="width:auto;padding:8px 16px;font-size:12px;">+ Registrar Temperatura</button></div>' +
      (list.length ? '<table class="data-table"><thead><tr><th>Data/Hora</th><th>Equipamento</th><th>Temp (°C)</th><th>Limite</th><th>Status</th><th>Responsável</th></tr></thead><tbody>' +
      list.map(function(t){ var cor = t.dentro_limite?'#2d7a3a':'#C8102E'; return '<tr><td>'+fmtDt(t.registrado_em)+'</td><td>'+esc(t.equipamento)+'</td><td style="font-weight:700;">'+t.temperatura+'°C</td><td>'+(t.limite_min!=null?t.limite_min+'~'+t.limite_max+'°C':'—')+'</td><td><span class="status-pill" style="background:'+cor+';color:#fff;">'+(t.dentro_limite?'OK':'FORA')+'</span></td><td>'+esc(t.registrado_por||'—')+'</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty-state">Nenhum registro.</div>');
  }
  async function addAnvisaTemp() {
    var equip = prompt('Equipamento (ex: Geladeira 1, Freezer):'); if (!equip) return;
    var temp = prompt('Temperatura (°C):'); if (!temp) return;
    var lmin = prompt('Limite mínimo (°C, ou vazio):');
    var lmax = prompt('Limite máximo (°C, ou vazio):');
    var d = await compApi({action:'anvisa_temperatura_registrar', equipamento:equip, temperatura:parseFloat(temp), limite_min:lmin?parseFloat(lmin):null, limite_max:lmax?parseFloat(lmax):null});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Temperatura registrada!','success'); loadAnvisaTemp();
  }
  async function loadAnvisaPragas() {
    var d = await compApi({action:'anvisa_pragas_list'}); var list = d.data||[];
    var el = document.getElementById('anvisaPragasContent');
    var fmtD = function(s){ return s ? s.split('-').reverse().join('/') : '—'; };
    el.innerHTML = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px;"><button onclick="addAnvisaPraga()" class="btn-create" style="width:auto;padding:8px 16px;font-size:12px;">+ Registrar Serviço</button></div>' +
      (list.length ? '<table class="data-table"><thead><tr><th>Data</th><th>Empresa</th><th>Tipo</th><th>Próximo</th></tr></thead><tbody>' +
      list.map(function(p){ return '<tr><td>'+fmtD(p.data_servico)+'</td><td>'+esc(p.empresa)+'</td><td>'+esc(p.tipo_servico||'—')+'</td><td>'+fmtD(p.proximo_servico)+'</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty-state">Nenhum registro.</div>');
  }
  async function addAnvisaPraga() {
    var empresa = prompt('Empresa:'); if (!empresa) return;
    var data = prompt('Data do serviço (AAAA-MM-DD):'); if (!data) return;
    var tipo = prompt('Tipo (desinsetizacao, desratizacao, completo):');
    var d = await compApi({action:'anvisa_praga_criar', empresa:empresa, data_servico:data, tipo_servico:tipo});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Serviço registrado!','success'); loadAnvisaPragas();
  }
  async function loadAnvisaManip() {
    var d = await compApi({action:'anvisa_manipuladores_list'}); var list = d.data||[];
    var el = document.getElementById('anvisaManipContent');
    var fmtD = function(s){ return s ? s.split('-').reverse().join('/') : '—'; };
    el.innerHTML = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px;"><button onclick="addAnvisaManip()" class="btn-create" style="width:auto;padding:8px 16px;font-size:12px;">+ Novo Manipulador</button></div>' +
      (list.length ? '<table class="data-table"><thead><tr><th>Nome</th><th>Curso</th><th>Instituição</th><th>Conclusão</th><th>Validade</th></tr></thead><tbody>' +
      list.map(function(m){ return '<tr><td>'+esc(m.funcionario_nome)+'</td><td>'+esc(m.curso)+'</td><td>'+esc(m.instituicao||'—')+'</td><td>'+fmtD(m.data_conclusao)+'</td><td>'+fmtD(m.validade)+'</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty-state">Nenhum manipulador.</div>');
  }
  async function addAnvisaManip() {
    var nome = prompt('Nome do funcionário:'); if (!nome) return;
    var curso = prompt('Curso (ex: Boas Práticas de Manipulação):'); if (!curso) return;
    var d = await compApi({action:'anvisa_manipulador_salvar', funcionario_nome:nome, curso:curso});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Manipulador adicionado!','success'); loadAnvisaManip();
  }

  // ── ACESSIBILIDADE ──
  async function loadAcessAudit() {
    var d = await compApi({action:'acessibilidade_audit_list'}); var list = d.data||[];
    var el = document.getElementById('acessAuditContent');
    el.innerHTML = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px;"><button onclick="addAcessItem()" class="btn-create" style="width:auto;padding:8px 16px;font-size:12px;">+ Novo Item</button></div>' +
      (list.length ? '<table class="data-table"><thead><tr><th>Área</th><th>Item</th><th>Conforme</th><th>Plano de Ação</th><th>Prazo</th><th>Corrigido</th></tr></thead><tbody>' +
      list.map(function(a){ var cor = a.conforme?'#2d7a3a':a.corrigido?'#1a6bb5':'#C8102E'; return '<tr><td>'+esc(a.area)+'</td><td>'+esc(a.item)+'</td><td><span class="status-pill" style="background:'+cor+';color:#fff;">'+(a.conforme?'Sim':a.corrigido?'Corrigido':'Não')+'</span></td><td>'+esc(a.plano_acao||'—')+'</td><td>'+(a.prazo_correcao?a.prazo_correcao.split('-').reverse().join('/'):'—')+'</td><td>'+(a.corrigido?'✓':'<button onclick="compApi({action:\'acessibilidade_corrigir\',id:\''+a.id+'\'}).then(function(){showToast(\'Marcado!\');loadAcessAudit();})" style="padding:4px 10px;background:#2d7a3a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Corrigir</button>')+'</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty-state">Nenhum item auditado.</div>');
  }
  async function addAcessItem() {
    var area = prompt('Área (entrada, corredores, salas, banheiros, patio, refeitorio):'); if (!area) return;
    var item = prompt('Item (rampa, corrimao, piso_tatil, banheiro_acessivel, sinalizacao_braille):'); if (!item) return;
    var conforme = confirm('Item está conforme?');
    var d = await compApi({action:'acessibilidade_audit_salvar', area:area, item:item, conforme:conforme});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Item adicionado!','success'); loadAcessAudit();
  }
  async function loadAcessPei() {
    var d = await compApi({action:'pei_list'}); var list = d.data||[];
    var el = document.getElementById('acessPeiContent');
    el.innerHTML = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px;"><button onclick="addPei()" class="btn-create" style="width:auto;padding:8px 16px;font-size:12px;">+ Novo PEI</button></div>' +
      (list.length ? '<table class="data-table"><thead><tr><th>Aluno</th><th>Diagnóstico</th><th>CID</th><th>Prof. AEE</th><th>Revisão</th><th>Status</th></tr></thead><tbody>' +
      list.map(function(p){ return '<tr><td>'+esc(p.aluno_nome)+'</td><td>'+esc(p.diagnostico||'—')+'</td><td>'+esc(p.cid||'—')+'</td><td>'+esc(p.professor_aee||'—')+'</td><td>'+(p.data_revisao?p.data_revisao.split('-').reverse().join('/'):'—')+'</td><td>'+esc(p.status)+'</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty-state">Nenhum PEI cadastrado.</div>');
  }
  async function addPei() {
    var nome = prompt('Nome do aluno:'); if (!nome) return;
    var diag = prompt('Diagnóstico:');
    var cid = prompt('CID (opcional):');
    var prof = prompt('Professor AEE:');
    var d = await compApi({action:'pei_salvar', aluno_nome:nome, diagnostico:diag, cid:cid, professor_aee:prof, data_inicio:new Date().toISOString().split('T')[0]});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('PEI criado!','success'); loadAcessPei();
  }

  // ── SEGUROS ──
  function toggleSeguroForm() { var el=document.getElementById('seguroForm'); el.style.display=el.style.display==='none'?'block':'none'; }
  async function loadSeguros() {
    var d = await compApi({action:'seguros_list'}); var list = d.data||[];
    var el = document.getElementById('segurosList');
    var fmtD = function(s){ return s ? s.split('-').reverse().join('/') : '—'; };
    var fmtR = function(v){ return v ? 'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2}) : '—'; };
    if (!list.length) { el.innerHTML='<div class="empty-state">Nenhum seguro cadastrado.</div>'; return; }
    el.innerHTML = '<table class="data-table"><thead><tr><th>Tipo</th><th>Seguradora</th><th>Apólice</th><th>Cobertura</th><th>Prêmio/mês</th><th>Vigência</th><th>Status</th></tr></thead><tbody>' +
      list.map(function(s){ var cor = s.status==='vigente'?'#2d7a3a':s.status==='vencido'?'#C8102E':'#d4830a'; return '<tr><td>'+esc(s.tipo)+'</td><td>'+esc(s.seguradora)+'</td><td>'+esc(s.numero_apolice||'—')+'</td><td>'+fmtR(s.valor_cobertura)+'</td><td>'+fmtR(s.premio_mensal)+'</td><td>'+fmtD(s.data_inicio)+' a '+fmtD(s.data_fim)+'</td><td><span class="status-pill" style="background:'+cor+';color:#fff;">'+esc(s.status)+'</span></td></tr>'; }).join('') + '</tbody></table>';
  }
  async function salvarSeguro() {
    var d = await compApi({action:'seguro_salvar', tipo:document.getElementById('sgTipo').value, seguradora:document.getElementById('sgSeguradora').value, numero_apolice:document.getElementById('sgApolice').value, valor_cobertura:parseFloat(document.getElementById('sgCobertura').value)||null, premio_mensal:parseFloat(document.getElementById('sgPremio').value)||null, data_inicio:document.getElementById('sgInicio').value||null, data_fim:document.getElementById('sgFim').value||null, cobertura_resumo:document.getElementById('sgResumo').value});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Seguro salvo!','success'); toggleSeguroForm(); loadSeguros();
  }

  // ── FISCAL ──
  function toggleFiscalForm() { var el=document.getElementById('fiscalForm'); el.style.display=el.style.display==='none'?'block':'none'; }
  async function loadFiscal() {
    var d = await compApi({action:'fiscal_obrigacoes_list', ano:new Date().getFullYear()}); var list = d.data||[];
    var el = document.getElementById('fiscalList');
    var fmtD = function(s){ return s ? s.split('-').reverse().join('/') : '—'; };
    var fmtR = function(v){ return v ? 'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2}) : '—'; };
    if (!list.length) { el.innerHTML='<div class="empty-state">Nenhuma obrigação registrada para este ano.</div>'; return; }
    el.innerHTML = '<table class="data-table"><thead><tr><th>Obrigação</th><th>Competência</th><th>Valor</th><th>Envio</th><th>Protocolo</th><th>Status</th></tr></thead><tbody>' +
      list.map(function(f){ var cor = {pendente:'#d4830a',enviado:'#1a6bb5',confirmado:'#2d7a3a',erro:'#C8102E',atrasado:'#7a0016'}[f.status]||'#888'; return '<tr><td>'+esc(f.obrigacao).toUpperCase()+'</td><td>'+esc(f.competencia)+'</td><td>'+fmtR(f.valor)+'</td><td>'+fmtD(f.data_envio)+'</td><td>'+esc(f.protocolo||'—')+'</td><td><span class="status-pill" style="background:'+cor+';color:#fff;">'+esc(f.status)+'</span></td></tr>'; }).join('') + '</tbody></table>';
  }
  async function salvarFiscal() {
    var d = await compApi({action:'fiscal_obrigacao_salvar', obrigacao:document.getElementById('foObrig').value, competencia:document.getElementById('foComp').value, status:document.getElementById('foStatus').value, data_envio:document.getElementById('foDataEnvio').value||null, protocolo:document.getElementById('foProtocolo').value||null, valor:parseFloat(document.getElementById('foValor').value)||null});
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Obrigação salva!','success'); toggleFiscalForm(); loadFiscal();
  }

