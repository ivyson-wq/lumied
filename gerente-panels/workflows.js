// Auto-extraído do gerente.html (Onda 4 — batch).
// Workflows / Automações — loadWorkflows + abrirModalWorkflow + salvarWorkflow
  // ═══ WORKFLOWS / AUTOMAÇÕES ═══════════════════════════
  var WF_API_URL = SUPABASE_URL + '/functions/v1/workflows';
  var wfEditingId = null;
  var wfCondCount = 0;
  var wfAcaoCount = 0;

  var WF_TEMPLATES = [
    { id: 'falta_alert',    nome: 'Alerta de Falta',      descricao: 'Notifica responsável quando aluno falta',        trigger_tipo: 'evento', trigger_config: { evento: 'aluno_falta' },     acoes: [{ tipo: 'enviar_whatsapp',    config: { template: 'falta_aluno',    destinatario: 'responsavel' } }] },
    { id: 'boleto_venc',    nome: 'Boleto Vencendo',       descricao: 'Lembrete 3 dias antes do vencimento',            trigger_tipo: 'evento', trigger_config: { evento: 'boleto_vencendo' }, acoes: [{ tipo: 'enviar_whatsapp',    config: { template: 'lembrete_boleto', destinatario: 'responsavel' } }] },
    { id: 'lead_parado',    nome: 'Lead Parado',           descricao: 'Alerta CRM quando lead não avança há 7 dias',    trigger_tipo: 'cron',   trigger_config: { cron: '0 8 * * 1' },        acoes: [{ tipo: 'criar_notificacao',  config: { titulo: 'Lead parado', mensagem: 'Lead sem movimentação há 7 dias' } }] },
    { id: 'matricula_bv',   nome: 'Boas-vindas Matrícula', descricao: 'Envia boas-vindas ao confirmar matrícula',       trigger_tipo: 'evento', trigger_config: { evento: 'matricula_nova' },  acoes: [{ tipo: 'enviar_email',       config: { template: 'boas_vindas',    destinatario: 'responsavel' } }] },
    { id: 'aniversario',    nome: 'Parabéns Aniversário',  descricao: 'Mensagem no dia do aniversário do aluno',        trigger_tipo: 'cron',   trigger_config: { cron: '0 8 * * *' },        acoes: [{ tipo: 'enviar_whatsapp',    config: { template: 'aniversario',    destinatario: 'responsavel' } }] },
  ];

  var WF_EVENTOS = [
    { value: 'aluno_falta',     label: 'Aluno faltou' },
    { value: 'boleto_vencendo', label: 'Boleto vencendo (3 dias)' },
    { value: 'lead_parado',     label: 'Lead parado (7 dias)' },
    { value: 'matricula_nova',  label: 'Nova matrícula confirmada' },
    { value: 'aniversario',     label: 'Aniversário do aluno' },
  ];

  var WF_ACAO_TIPOS = [
    { value: 'enviar_email',       label: '📧 Enviar e-mail' },
    { value: 'enviar_whatsapp',    label: '💬 Enviar WhatsApp' },
    { value: 'criar_notificacao',  label: '🔔 Criar notificação' },
    { value: 'criar_tarefa',       label: '📋 Criar tarefa' },
  ];

  async function wfApi(body) {
    const token = getToken();
    try {
      const r = await fetch(WF_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON }, body: JSON.stringify({ ...body, _token: token }) });
      return await r.json();
    } catch (e) {
      return { error: e.message };
    }
  }

  async function loadWorkflows() {
    document.getElementById('wfList').innerHTML = '<div class="empty-state">Carregando...</div>';
    const d = await wfApi({ action: 'workflow_list' });
    const wfs = Array.isArray(d) ? d : (d.workflows || []);
    if (d.error) {
      document.getElementById('wfStatAtivas').textContent = '0';
      document.getElementById('wfStatExecucoes').textContent = '0';
      document.getElementById('wfStatFalhas').textContent = '0';
      document.getElementById('wfList').innerHTML = wfEmptyState();
      return;
    }
    document.getElementById('wfStatAtivas').textContent = wfs.filter(function(w){ return w.ativo; }).length;
    document.getElementById('wfStatExecucoes').textContent = wfs.reduce(function(s,w){ return s + (w.execucoes_total||0); }, 0);
    document.getElementById('wfStatFalhas').textContent = '—';
    document.getElementById('wfList').innerHTML = wfs.length ? wfs.map(wfCard).join('') : wfEmptyState();
  }

  function wfEmptyState() {
    return '<div style="text-align:center;padding:60px 20px;background:var(--white);border:1px solid var(--border);border-radius:12px;">' +
      '<div style="font-size:48px;margin-bottom:12px;">⚡</div>' +
      '<div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:8px;">Nenhuma automação criada</div>' +
      '<p style="color:var(--muted);font-size:13px;margin-bottom:20px;">Automatize tarefas repetitivas para economizar tempo.</p>' +
      '<button onclick="abrirModalWorkflow()" style="padding:11px 20px;background:var(--red);color:#fff;border:none;border-radius:10px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;">Criar primeira automação</button>' +
      '</div>';
  }

  function wfEsc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function wfCard(wf) {
    var triggerLabels = { evento:'⚡ Evento', cron:'🕐 Agendamento', manual:'👆 Manual' };
    var triggerColors = { evento:'#1a6bb5', cron:'#6b3a9e', manual:'#5a5249' };
    var tipo = wf.trigger_tipo || 'manual';
    var lastRun = (wf.ultima_execucao||wf.last_run_at) ? new Date(wf.ultima_execucao||wf.last_run_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'Nunca executado';
    return '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:20px;display:flex;align-items:flex-start;gap:16px;margin-bottom:10px;flex-wrap:wrap;">' +
      '<div style="flex:1;min-width:180px;">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap;">' +
          '<span style="font-weight:600;font-size:14px;">' + wfEsc(wf.nome) + '</span>' +
          '<span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;color:#fff;background:' + (triggerColors[tipo]||'#5a5249') + ';">' + (triggerLabels[tipo]||tipo) + '</span>' +
        '</div>' +
        (wf.descricao ? '<p style="color:var(--muted);font-size:12px;margin-bottom:8px;">' + wfEsc(wf.descricao) + '</p>' : '') +
        '<div style="display:flex;gap:16px;font-size:11px;color:var(--muted);">' +
          '<span>🕐 ' + wfEsc(lastRun) + '</span>' +
          '<span>▶ ' + (wf.execucoes_total||wf.execucao_count||0) + ' execuções</span>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<div onclick="toggleWorkflow(\'' + wf.id + '\',' + (!wf.ativo) + ')" title="' + (wf.ativo ? 'Desativar' : 'Ativar') + '" style="display:flex;align-items:center;gap:6px;cursor:pointer;">' +
          '<div style="width:38px;height:20px;border-radius:20px;background:' + (wf.ativo ? 'var(--green)' : 'var(--border)') + ';position:relative;transition:background .2s;">' +
            '<div style="width:16px;height:16px;background:#fff;border-radius:50%;position:absolute;top:2px;left:' + (wf.ativo ? '20px' : '2px') + ';transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2);"></div>' +
          '</div>' +
          '<span style="font-size:11px;font-weight:600;color:' + (wf.ativo ? 'var(--green)' : 'var(--muted)') + ';">' + (wf.ativo ? 'Ativo' : 'Inativo') + '</span>' +
        '</div>' +
        '<button onclick="abrirModalWorkflow(\'' + wf.id + '\')" style="padding:7px 12px;background:none;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;cursor:pointer;">Editar</button>' +
        '<button onclick="executarWorkflow(\'' + wf.id + '\')" style="padding:7px 12px;background:none;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;cursor:pointer;color:#1a6bb5;">▶ Executar</button>' +
        '<button onclick="verHistoricoWorkflow(\'' + wf.id + '\',\'' + wfEsc(wf.nome) + '\')" style="padding:7px 12px;background:none;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;cursor:pointer;color:var(--muted);">Histórico</button>' +
      '</div>' +
    '</div>';
  }

  function abrirModalWorkflow(id) {
    wfEditingId = id || null;
    wfCondCount = 0;
    wfAcaoCount = 0;
    document.getElementById('wfEditId').value = id || '';
    document.getElementById('wfEditorTitle').textContent = id ? '⚡ Editar Automação' : '⚡ Nova Automação';
    document.getElementById('wfNome').value = '';
    document.getElementById('wfDesc').value = '';
    document.getElementById('wfTriggerTipo').value = 'evento';
    document.getElementById('wfCondList').innerHTML = '';
    document.getElementById('wfAcaoList').innerHTML = '';
    document.getElementById('wfTemplatesWrap').style.display = id ? 'none' : '';
    wfUpdateTriggerConfig();
    if (!id) wfRenderTemplates();
    if (id) wfCarregarWorkflow(id);
    document.getElementById('modalWorkflowEditor').style.display = 'flex';
  }

  function fecharModalWorkflow() {
    document.getElementById('modalWorkflowEditor').style.display = 'none';
  }

  async function wfCarregarWorkflow(id) {
    var d = await wfApi({ action: 'workflow_get', id: id });
    if (d.error) return;
    var wf = d.workflow || d;
    document.getElementById('wfNome').value = wf.nome || '';
    document.getElementById('wfDesc').value = wf.descricao || '';
    document.getElementById('wfTriggerTipo').value = wf.trigger_tipo || 'evento';
    wfUpdateTriggerConfig(wf.trigger_config);
    (wf.condicoes || []).forEach(function(c){ wfAddCondicao(c); });
    (wf.acoes || []).forEach(function(a){ wfAddAcao(a); });
  }

  function wfRenderTemplates() {
    var colors = ['#1a6bb5','#6b3a9e','#2d7a3a','#C8102E','#d4830a'];
    document.getElementById('wfTemplateCards').innerHTML = WF_TEMPLATES.map(function(t, i) {
      return '<div onclick="wfUseTemplate(\'' + t.id + '\')" style="padding:12px;background:var(--bg);border:1.5px solid var(--border);border-radius:10px;cursor:pointer;transition:border-color .15s;" ' +
        'onmouseover="this.style.borderColor=\'' + colors[i % colors.length] + '\'" onmouseout="this.style.borderColor=\'var(--border)\'">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px;">' + wfEsc(t.nome) + '</div>' +
        '<div style="font-size:11px;color:var(--muted);">' + wfEsc(t.descricao) + '</div>' +
        '</div>';
    }).join('');
  }

  function wfUseTemplate(id) {
    var t = WF_TEMPLATES.find(function(x){ return x.id === id; });
    if (!t) return;
    document.getElementById('wfNome').value = t.nome;
    document.getElementById('wfDesc').value = t.descricao;
    document.getElementById('wfTriggerTipo').value = t.trigger_tipo;
    document.getElementById('wfCondList').innerHTML = '';
    document.getElementById('wfAcaoList').innerHTML = '';
    wfCondCount = 0;
    wfAcaoCount = 0;
    wfUpdateTriggerConfig(t.trigger_config);
    (t.acoes || []).forEach(function(a){ wfAddAcao(a); });
  }

  function wfUpdateTriggerConfig(config) {
    var tipo = document.getElementById('wfTriggerTipo').value;
    var el = document.getElementById('wfTriggerConfigSection');
    if (tipo === 'evento') {
      var sel = config && config.evento ? config.evento : '';
      el.innerHTML = '<div class="ff"><label>Evento</label>' +
        '<select id="wfTriggerEvento" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;">' +
        WF_EVENTOS.map(function(e){ return '<option value="' + e.value + '"' + (sel === e.value ? ' selected' : '') + '>' + e.label + '</option>'; }).join('') +
        '</select></div>';
    } else if (tipo === 'cron') {
      var val = config && config.cron ? config.cron : '0 8 * * 1';
      el.innerHTML = '<div class="ff"><label>Expressão Cron</label>' +
        '<input id="wfTriggerCron" type="text" value="' + wfEsc(val) + '" placeholder="0 8 * * 1" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;">' +
        '<div style="font-size:11px;color:var(--muted);margin-top:4px;">Ex: 0 8 * * 1 = toda segunda às 8h · 0 9 * * * = todo dia às 9h</div></div>';
    } else {
      el.innerHTML = '<div style="padding:10px 14px;background:var(--bg);border-radius:8px;font-size:12px;color:var(--muted);">Esta automação só será executada manualmente.</div>';
    }
  }

  function wfAddCondicao(data) {
    var id = ++wfCondCount;
    var campo = data && data.campo ? data.campo : '';
    var op    = data && data.operador ? data.operador : 'igual';
    var val   = data && data.valor   ? data.valor   : '';
    var row = document.createElement('div');
    row.id = 'wfCond' + id;
    row.style.cssText = 'display:grid;grid-template-columns:1fr auto 1fr auto;gap:8px;align-items:center;';
    row.innerHTML =
      '<input type="text" placeholder="Campo (ex: turma)" value="' + wfEsc(campo) + '" style="padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;">' +
      '<select style="padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;">' +
        '<option value="igual"'     + (op==='igual'     ?' selected':'') + '>igual a</option>' +
        '<option value="diferente"' + (op==='diferente' ?' selected':'') + '>diferente de</option>' +
        '<option value="contem"'    + (op==='contem'    ?' selected':'') + '>contém</option>' +
        '<option value="maior"'     + (op==='maior'     ?' selected':'') + '>maior que</option>' +
        '<option value="menor"'     + (op==='menor'     ?' selected':'') + '>menor que</option>' +
      '</select>' +
      '<input type="text" placeholder="Valor" value="' + wfEsc(val) + '" style="padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;">' +
      '<button onclick="document.getElementById(\'wfCond' + id + '\').remove()" style="padding:8px 10px;background:none;border:1.5px solid var(--border);border-radius:8px;font-size:14px;cursor:pointer;color:var(--muted);">&times;</button>';
    document.getElementById('wfCondList').appendChild(row);
  }

  function wfAddAcao(data) {
    var id = ++wfAcaoCount;
    var tipo = data && data.tipo ? data.tipo : 'criar_notificacao';
    var cfg  = data && data.config ? data.config : {};
    var row = document.createElement('div');
    row.id = 'wfAcao' + id;
    row.style.cssText = 'background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;';
    row.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
        '<select onchange="wfUpdateAcaoCfg(' + id + ',this.value)" style="padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;background:var(--white);">' +
          WF_ACAO_TIPOS.map(function(t){ return '<option value="' + t.value + '"' + (tipo===t.value?' selected':'') + '>' + t.label + '</option>'; }).join('') +
        '</select>' +
        '<button onclick="document.getElementById(\'wfAcao' + id + '\').remove()" style="padding:6px 10px;background:none;border:1.5px solid var(--border);border-radius:8px;font-size:14px;cursor:pointer;color:var(--muted);">&times;</button>' +
      '</div>' +
      '<div id="wfAcaoCfg' + id + '"></div>';
    document.getElementById('wfAcaoList').appendChild(row);
    wfUpdateAcaoCfg(id, tipo, cfg);
  }

  function wfUpdateAcaoCfg(id, tipo, cfg) {
    cfg = cfg || {};
    var el = document.getElementById('wfAcaoCfg' + id);
    if (!el) return;
    var tplsEmail = ['boas_vindas','lembrete_boleto','comunicado','relatorio'];
    var tplsWpp   = ['falta_aluno','lembrete_boleto','aniversario','comunicado'];
    if (tipo === 'enviar_email' || tipo === 'enviar_whatsapp') {
      var tpls = tipo === 'enviar_email' ? tplsEmail : tplsWpp;
      el.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        '<div><label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);display:block;margin-bottom:4px;">Template</label>' +
          '<select style="width:100%;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;background:var(--white);">' +
            tpls.map(function(t){ return '<option value="' + t + '"' + (cfg.template===t?' selected':'') + '>' + t.replace(/_/g,' ') + '</option>'; }).join('') +
          '</select></div>' +
        '<div><label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);display:block;margin-bottom:4px;">Destinatário</label>' +
          '<select style="width:100%;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;background:var(--white);">' +
            '<option value="responsavel"' + (cfg.destinatario==='responsavel'?' selected':'') + '>Responsável</option>' +
            '<option value="gerente"'     + (cfg.destinatario==='gerente'    ?' selected':'') + '>Gerente</option>' +
            '<option value="professora"'  + (cfg.destinatario==='professora' ?' selected':'') + '>Professora</option>' +
          '</select></div>' +
        '</div>';
    } else if (tipo === 'criar_notificacao') {
      el.innerHTML = '<div style="display:grid;gap:8px;">' +
        '<input type="text" placeholder="Título da notificação" value="' + wfEsc(cfg.titulo||'') + '" style="width:100%;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;box-sizing:border-box;">' +
        '<input type="text" placeholder="Mensagem" value="' + wfEsc(cfg.mensagem||'') + '" style="width:100%;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;box-sizing:border-box;">' +
        '</div>';
    } else if (tipo === 'criar_tarefa') {
      el.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        '<input type="text" placeholder="Título da tarefa" value="' + wfEsc(cfg.titulo||'') + '" style="padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;">' +
        '<select style="padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;background:var(--white);">' +
          '<option value="gerente"'    + (cfg.atribuir==='gerente'    ?' selected':'') + '>Gerente</option>' +
          '<option value="secretaria"' + (cfg.atribuir==='secretaria' ?' selected':'') + '>Secretaria</option>' +
          '<option value="comercial"'  + (cfg.atribuir==='comercial'  ?' selected':'') + '>Comercial</option>' +
        '</select>' +
        '</div>';
    }
  }

  function wfReadAcoes() {
    var acoes = [];
    document.querySelectorAll('#wfAcaoList > div[id^="wfAcao"]').forEach(function(row) {
      var id = row.id.replace('wfAcao', '');
      var tipoSel = row.querySelector('select');
      if (!tipoSel) return;
      var tipo = tipoSel.value;
      var cfg = {};
      var cfgEl = document.getElementById('wfAcaoCfg' + id);
      if (cfgEl) {
        var keys = { enviar_email:['template','destinatario'], enviar_whatsapp:['template','destinatario'], criar_notificacao:['titulo','mensagem'], criar_tarefa:['titulo','atribuir'] };
        cfgEl.querySelectorAll('input,select').forEach(function(inp, i) {
          var k = (keys[tipo] || [])[i];
          if (k) cfg[k] = inp.value;
        });
      }
      acoes.push({ tipo: tipo, config: cfg });
    });
    return acoes;
  }

  function wfReadCondicoes() {
    var conds = [];
    document.querySelectorAll('#wfCondList > div[id^="wfCond"]').forEach(function(row) {
      var inps = row.querySelectorAll('input,select');
      if (inps.length >= 3) conds.push({ campo: inps[0].value, operador: inps[1].value, valor: inps[2].value });
    });
    return conds;
  }

  async function salvarWorkflow() {
    var nome = document.getElementById('wfNome').value.trim();
    if (!nome) { showToast('Informe o nome da automação', 'error'); return; }
    var tipo = document.getElementById('wfTriggerTipo').value;
    var trigger_config = {};
    if (tipo === 'evento') {
      var evEl = document.getElementById('wfTriggerEvento');
      if (evEl) trigger_config.evento = evEl.value;
    } else if (tipo === 'cron') {
      var cronEl = document.getElementById('wfTriggerCron');
      if (cronEl) trigger_config.cron = cronEl.value;
    }
    var acoes = wfReadAcoes();
    if (!acoes.length) { showToast('Adicione ao menos uma ação', 'error'); return; }
    var payload = {
      action: wfEditingId ? 'workflow_update' : 'workflow_create',
      id: wfEditingId,
      nome: nome,
      descricao: document.getElementById('wfDesc').value.trim(),
      trigger_tipo: tipo,
      trigger_config: trigger_config,
      condicoes: wfReadCondicoes(),
      acoes: acoes,
    };
    var d = await wfApi(payload);
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast(wfEditingId ? 'Automação atualizada!' : 'Automação criada!', 'success');
    fecharModalWorkflow();
    loadWorkflows();
  }

  async function toggleWorkflow(id, ativo) {
    var d = await wfApi({ action: 'workflow_toggle', id: id, ativo: ativo });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    loadWorkflows();
  }

  async function executarWorkflow(id) {
    showToast('Executando automação...', 'info');
    var d = await wfApi({ action: 'workflow_executar', id: id });
    if (d.error) { showToast('Erro ao executar: ' + d.error, 'error'); return; }
    showToast('Automação executada!', 'success');
    loadWorkflows();
  }

  async function verHistoricoWorkflow(id, nome) {
    document.getElementById('wfHistTitle').textContent = '📋 Histórico — ' + nome;
    document.getElementById('wfHistContent').innerHTML = '<div class="empty-state">Carregando...</div>';
    document.getElementById('modalWorkflowHistorico').style.display = 'flex';
    var d = await wfApi({ action: 'workflow_execucoes_list', workflow_id: id });
    var execucoes = Array.isArray(d) ? d : (d.execucoes || []);
    if (d.error || !execucoes.length) {
      document.getElementById('wfHistContent').innerHTML = '<div class="empty-state">Nenhuma execução registrada ainda.</div>';
      return;
    }
    var statusColors = { sucesso:'var(--green)', falha:'var(--red)', parcial:'#d4830a' };
    document.getElementById('wfHistContent').innerHTML = execucoes.map(function(ex) {
      var ts = new Date(ex.iniciado_em || ex.created_at).toLocaleString('pt-BR');
      var color = statusColors[ex.status] || 'var(--muted)';
      return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:8px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
          '<span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;color:#fff;background:' + color + ';">' + wfEsc(ex.status) + '</span>' +
          '<span style="font-size:11px;color:var(--muted);">' + wfEsc(ts) + '</span>' +
        '</div>' +
        (ex.resultado ? '<div style="font-size:12px;color:var(--text);margin-top:4px;">' + wfEsc(JSON.stringify(ex.resultado)) + '</div>' : '') +
        (ex.trigger_data ? '<div style="font-size:11px;color:var(--muted);margin-top:4px;">Trigger: ' + wfEsc(JSON.stringify(ex.trigger_data)) + '</div>' : '') +
        '</div>';
    }).join('');
  }
  // ════════════════════════════════════════════════════════
