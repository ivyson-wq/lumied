// Auto-extraído do gerente.html (Onda 4 — mega batch).
// Notas Fiscais + Exclusões pendentes + Impressões + Horários professoras + Emergência + Achados e perdidos
  // ── NOTAS FISCAIS ─────────────────────────────────
  function toggleEmitirNf() { const el=document.getElementById('emitirNfForm'); el.style.display=el.style.display==='none'?'block':'none'; }

  async function emitirNf() {
    const cpf = document.getElementById('nfCpf').value.trim();
    const nome = document.getElementById('nfNome').value.trim();
    const valor = document.getElementById('nfValor').value;
    const desc = document.getElementById('nfDesc').value.trim();
    if (!valor || !desc) { showToast('Valor e descricao obrigatorios.','warning'); return; }
    const btn = document.getElementById('nfBtn');
    btn.disabled=true; btn.textContent='Registrando...';
    const d = await api({ action:'fin_nf_emitir', cpf_cnpj_tomador:cpf, familia_nome:nome, valor, descricao_servico:desc });
    btn.disabled=false; btn.textContent='Registrar NF';
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('NF registrada!','success');
    toggleEmitirNf();
    loadFinNfs();
  }

  async function loadFinNfs() {
    const d = await api({ action:'fin_nf_list' });
    const items = Array.isArray(d) ? d : [];
    const el = document.getElementById('finNfsContent');
    const fmtR = v => 'R$ '+parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2});
    if (!items.length) { el.innerHTML='<div class="empty-state">Nenhuma NF registrada.</div>'; return; }
    el.innerHTML = items.map(n => `<div style="display:flex;align-items:center;gap:12px;padding:12px;background:#fff;border:1px solid var(--border);border-left:4px solid ${n.status==='emitida'?'#2d7a3a':n.status==='erro'?'#e53e3e':'#f6a623'};border-radius:8px;margin-bottom:6px;">
      <div style="flex:1;">
        <div style="font-weight:600;font-size:13px;">${esc(n.familia_nome||n.cpf_cnpj_tomador||'—')}</div>
        <div style="font-size:11px;color:var(--muted);">${esc(n.descricao_servico||'—')} · ${new Date(n.criado_em).toLocaleDateString('pt-BR')}</div>
        ${n.numero_nf?`<div style="font-size:11px;color:#2d7a3a;margin-top:2px;">NF n° ${esc(n.numero_nf)}</div>`:''}
      </div>
      <div style="font-size:15px;font-weight:700;">${fmtR(n.valor)}</div>
      <span style="font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;${n.status==='emitida'?'background:#edf7f0;color:#2d7a3a;':n.status==='erro'?'background:#fdf0f2;color:#a00d24;':'background:#fff8e1;color:#b07d00;'}">${n.status}</span>
      ${n.status==='pendente'?`<button onclick="marcarNfEmitida('${n.id}')" style="padding:3px 8px;background:#2d7a3a;color:#fff;border:none;border-radius:5px;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;">Marcar Emitida</button>`:''}
    </div>`).join('');
  }

  async function marcarNfEmitida(id) {
    const num = prompt('Numero da NF:');
    if (!num) return;
    const cod = prompt('Codigo de verificacao (opcional):');
    await api({ action:'fin_nf_marcar_emitida', id, numero_nf:num, codigo_verificacao:cod||'' });
    showToast('NF marcada como emitida!','success');
    loadFinNfs();
  }

  // ══════════════════════════════════════════════════════
  //  CENTRAL DE APROVAÇÕES — Hub unificado de todas as pendências
  // ══════════════════════════════════════════════════════
  var _aprovData = null;
  var aprovTabAtual = 'pendentes';

  function setAprovTab(tab, btn) {
    document.querySelectorAll('#aprovTabs .aprov-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    aprovTabAtual = tab;
    document.getElementById('aprovViewPendentes').style.display = tab === 'pendentes' ? '' : 'none';
    document.getElementById('aprovViewAprovadas').style.display = tab === 'aprovadas' ? '' : 'none';
    document.getElementById('aprovViewRejeitadas').style.display = tab === 'rejeitadas' ? '' : 'none';
    if (tab === 'aprovadas') loadAprovHistorico('aprovado');
    if (tab === 'rejeitadas') loadAprovHistorico('rejeitado');
  }

  async function loadCentralAprovacoes() {
    var el = document.getElementById('aprovViewPendentes');
    if (el) el.innerHTML = '<div class="empty-state">Carregando...</div>';
    var d = await api({ action:'central_aprovacoes_resumo' });
    _aprovData = d && d.totais ? d : { matriculas:[], impressoes:[], almoxarifado:[], diplomas:[], pdis:[], acesso_alunos:[], totais:{ total:0 } };
    renderCentralPendentes();
    updateAprovBadges();
  }

  // Legacy compat — old code calls loadExclusoesPendentes
  function loadExclusoesPendentes() {
    if (!_aprovData) { _initAprovBadge(); return; }
    updateAprovBadges();
  }

  function updateAprovBadges() {
    var n = _aprovData?.totais?.total || 0;
    var b1 = document.getElementById('aprovBadgeSidebar');
    var b2 = document.getElementById('aprovTabBadge');
    var b3 = document.getElementById('aprovPendCount');
    var bExcl = document.getElementById('gExclBadge');
    if (b1) { b1.textContent = n || ''; b1.style.display = n ? 'inline-flex' : 'none'; }
    if (b2) { b2.textContent = n || ''; b2.style.display = n ? 'inline-flex' : 'none'; }
    if (b3) { b3.textContent = n + ' pendente' + (n !== 1 ? 's' : ''); b3.style.display = n ? '' : 'none'; }
    if (bExcl) { bExcl.textContent = _aprovData?.totais?.matriculas || ''; bExcl.style.display = (_aprovData?.totais?.matriculas) ? '' : 'none'; }
  }

  var _secConfig = {
    matriculas:    { icon:'🎓', label:'Matrículas', cor:'#1a6bb5' },
    impressoes:    { icon:'🖨️', label:'Impressões', cor:'#8b5cf6', panel:'impressoes' },
    almoxarifado:  { icon:'📦', label:'Almoxarifado', cor:'#d97706', panel:'almReqs' },
    diplomas:      { icon:'🏆', label:'Diplomas', cor:'#2d7a3a' },
    pdis:          { icon:'📈', label:'Growth Plan (PDI)', cor:'#0891b2' },
    acesso_alunos: { icon:'🔑', label:'Solicitações de Acesso', cor:'#be185d' },
  };
  var _matSubIcons = { desativar_matricula:'⛔', troca_turma:'🔄', nova_matricula:'➕' };
  var _matSubLabels = { desativar_matricula:'Desativação', troca_turma:'Troca de Turma', nova_matricula:'Nova Matrícula' };

  function renderCentralPendentes() {
    var el = document.getElementById('aprovViewPendentes');
    if (!el || !_aprovData) return;
    var t = _aprovData.totais;
    if (!t.total) { el.innerHTML = '<div class="empty-state" style="padding:40px 0;">Nenhuma pendência. Tudo em dia!</div>'; return; }
    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:24px;">';
    for (var _k of Object.keys(_secConfig)) { var _cfg = _secConfig[_k]; var _n = t[_k] || 0; if (!_n) continue;
      html += '<div style="background:'+_cfg.cor+'10;border:1.5px solid '+_cfg.cor+'30;border-radius:10px;padding:12px;text-align:center;cursor:pointer;" onclick="document.getElementById(\'aprovSec_'+_k+'\')?.scrollIntoView({behavior:\'smooth\',block:\'start\'})">'
        + '<div style="font-size:22px;">'+_cfg.icon+'</div><div style="font-size:22px;font-weight:800;color:'+_cfg.cor+';margin:2px 0;">'+_n+'</div><div style="font-size:11px;color:var(--muted);font-weight:600;">'+_cfg.label+'</div></div>';
    }
    html += '</div>';
    // MATRÍCULAS
    if (_aprovData.matriculas.length) { var cfg = _secConfig.matriculas;
      html += _renderSH('matriculas', cfg, _aprovData.matriculas.length);
      var grp = {}; for (var a of _aprovData.matriculas) { if (!grp[a.tipo]) grp[a.tipo] = []; grp[a.tipo].push(a); }
      for (var tp of ['troca_turma','desativar_matricula','nova_matricula']) { var its = grp[tp]; if (!its) continue;
        html += '<div style="font-size:12px;font-weight:700;color:var(--muted);margin:8px 0 6px 4px;">'+(_matSubIcons[tp]||'')+' '+(_matSubLabels[tp]||tp)+' ('+its.length+')</div>';
        for (var a of its) html += _renderMC(a);
      }
      html += '</div>';
    }
    // IMPRESSÕES
    if (_aprovData.impressoes.length) { var cfg = _secConfig.impressoes;
      html += _renderSH('impressoes', cfg, _aprovData.impressoes.length);
      for (var imp of _aprovData.impressoes.slice(0,5)) { var prof = imp.professoras?.nome||'—'; var dt = imp.criado_em?new Date(imp.criado_em).toLocaleDateString('pt-BR'):'';
        html += '<div style="background:#fff;border:1.5px solid '+cfg.cor+'30;border-radius:10px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><div style="width:8px;height:8px;border-radius:50%;background:'+cfg.cor+';flex-shrink:0;"></div><div style="flex:1;min-width:150px;"><div style="font-size:13px;font-weight:600;">Solicitação de '+esc(prof)+'</div><div style="font-size:11px;color:var(--muted);">'+(imp.copias||1)+' cópia(s) · '+esc(imp.tipo_papel||'Sulfite A4')+' · '+(imp.cor?'Colorido':'P&B')+' · '+dt+'</div>'+(imp.observacao?'<div style="font-size:11px;color:#666;margin-top:2px;">'+esc(imp.observacao)+'</div>':'')+'</div></div>';
      }
      if (_aprovData.impressoes.length > 5) html += '<div style="font-size:11px;color:var(--muted);margin-bottom:8px;">+ '+(_aprovData.impressoes.length-5)+' mais...</div>';
      html += '<button onclick="showPanel(\'impressoes\')" style="padding:6px 16px;background:none;border:1.5px solid '+cfg.cor+';color:'+cfg.cor+';border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:\'DM Sans\',sans-serif;margin-bottom:8px;">Ir para Impressões →</button></div>';
    }
    // ALMOXARIFADO
    if (_aprovData.almoxarifado.length) { var cfg = _secConfig.almoxarifado;
      html += _renderSH('almoxarifado', cfg, _aprovData.almoxarifado.length);
      for (var req of _aprovData.almoxarifado.slice(0,5)) { var prof = req.professoras?.nome||'—'; var turma = req.alm_turmas?.nome||''; var dt = req.criado_em?new Date(req.criado_em).toLocaleDateString('pt-BR'):''; var nI = Array.isArray(req.itens)?req.itens.length:0;
        html += '<div style="background:#fff;border:1.5px solid '+cfg.cor+'30;border-radius:10px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><div style="width:8px;height:8px;border-radius:50%;background:'+cfg.cor+';flex-shrink:0;"></div><div style="flex:1;min-width:150px;"><div style="font-size:13px;font-weight:600;">'+esc(prof)+(turma?' · '+esc(turma):'')+'</div><div style="font-size:11px;color:var(--muted);">'+nI+' ite'+(nI!==1?'ns':'m')+' · R$ '+(req.total||0).toFixed(2)+' · '+dt+'</div></div></div>';
      }
      if (_aprovData.almoxarifado.length > 5) html += '<div style="font-size:11px;color:var(--muted);margin-bottom:8px;">+ '+(_aprovData.almoxarifado.length-5)+' mais...</div>';
      html += '<button onclick="showPanel(\'almReqs\')" style="padding:6px 16px;background:none;border:1.5px solid '+cfg.cor+';color:'+cfg.cor+';border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:\'DM Sans\',sans-serif;margin-bottom:8px;">Ir para Almoxarifado →</button></div>';
    }
    // DIPLOMAS
    if (_aprovData.diplomas.length) { var cfg = _secConfig.diplomas;
      html += _renderSH('diplomas', cfg, _aprovData.diplomas.length);
      for (var d of _aprovData.diplomas) { var prof = d.professoras?.nome||'—'; var dt = d.criado_em?new Date(d.criado_em).toLocaleDateString('pt-BR'):'';
        html += '<div style="background:#fff;border:1.5px solid '+cfg.cor+'30;border-radius:10px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><div style="width:8px;height:8px;border-radius:50%;background:'+cfg.cor+';flex-shrink:0;"></div><div style="flex:1;min-width:150px;"><div style="font-size:13px;font-weight:600;">'+esc(d.nome_curso||'')+'</div><div style="font-size:11px;color:var(--muted);">'+esc(prof)+' · '+esc(d.instituicao||'')+' · '+(d.carga_horaria||0)+'h · '+dt+'</div></div><div style="display:flex;gap:6px;flex-shrink:0;"><button onclick="_aprovDiploma(\''+d.id+'\')" style="padding:5px 12px;background:#2d7a3a;color:#fff;border:none;border-radius:6px;font-size:11px;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-weight:600;">Aprovar</button><button onclick="_rejDiploma(\''+d.id+'\')" style="padding:5px 12px;background:none;border:1.5px solid #e53e3e;color:#e53e3e;border-radius:6px;font-size:11px;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-weight:600;">Rejeitar</button></div></div>';
      }
      html += '</div>';
    }
    // PDI
    if (_aprovData.pdis.length) { var cfg = _secConfig.pdis;
      html += _renderSH('pdis', cfg, _aprovData.pdis.length);
      for (var p of _aprovData.pdis) { var prof = p.professoras?.nome||'—'; var dt = p.submetido_em?new Date(p.submetido_em).toLocaleDateString('pt-BR'):'';
        html += '<div style="background:#fff;border:1.5px solid '+cfg.cor+'30;border-radius:10px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><div style="width:8px;height:8px;border-radius:50%;background:'+cfg.cor+';flex-shrink:0;"></div><div style="flex:1;min-width:150px;"><div style="font-size:13px;font-weight:600;">Growth Plan '+(p.ano||'')+' — '+esc(prof)+'</div><div style="font-size:11px;color:var(--muted);">Submetido em '+dt+'</div></div><div style="display:flex;gap:6px;flex-shrink:0;"><button onclick="_aprovPdi(\''+p.id+'\')" style="padding:5px 12px;background:#2d7a3a;color:#fff;border:none;border-radius:6px;font-size:11px;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-weight:600;">Aprovar</button><button onclick="_rejPdi(\''+p.id+'\')" style="padding:5px 12px;background:none;border:1.5px solid #e53e3e;color:#e53e3e;border-radius:6px;font-size:11px;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-weight:600;">Rejeitar</button></div></div>';
      }
      html += '</div>';
    }
    // ACESSO ALUNOS
    if (_aprovData.acesso_alunos.length) { var cfg = _secConfig.acesso_alunos;
      html += _renderSH('acesso_alunos', cfg, _aprovData.acesso_alunos.length);
      for (var s of _aprovData.acesso_alunos) { var dt = s.criado_em?new Date(s.criado_em).toLocaleDateString('pt-BR'):'';
        html += '<div style="background:#fff;border:1.5px solid '+cfg.cor+'30;border-radius:10px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><div style="width:8px;height:8px;border-radius:50%;background:'+cfg.cor+';flex-shrink:0;"></div><div style="flex:1;min-width:150px;"><div style="font-size:13px;font-weight:600;">'+esc(s.nome_crianca||'')+' — '+esc(s.nome_responsavel||'')+'</div><div style="font-size:11px;color:var(--muted);">'+esc(s.email||'')+' · Interesse: '+esc(s.serie_interesse||'—')+' · '+dt+'</div></div><div style="display:flex;gap:6px;flex-shrink:0;"><button onclick="_aprovAcesso(\''+s.id+'\')" style="padding:5px 12px;background:#2d7a3a;color:#fff;border:none;border-radius:6px;font-size:11px;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-weight:600;">Aprovar</button><button onclick="_rejAcesso(\''+s.id+'\')" style="padding:5px 12px;background:none;border:1.5px solid #e53e3e;color:#e53e3e;border-radius:6px;font-size:11px;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-weight:600;">Rejeitar</button></div></div>';
      }
      html += '</div>';
    }
    el.innerHTML = html;
  }

  function _renderSH(key, cfg, count) {
    return '<div id="aprovSec_'+key+'" style="margin-bottom:20px;scroll-margin-top:80px;"><div style="font-size:15px;font-weight:700;color:'+cfg.cor+';margin-bottom:10px;display:flex;align-items:center;gap:8px;padding-bottom:6px;border-bottom:2px solid '+cfg.cor+'20;"><span style="font-size:20px;">'+cfg.icon+'</span> '+cfg.label+' <span style="background:'+cfg.cor+';color:#fff;border-radius:12px;padding:1px 8px;font-size:11px;font-weight:700;">'+count+'</span></div>';
  }

  function _renderMC(a) {
    var m = a.crm_matriculas || {}; var p = a.payload || {}; var dt = a.criado_em?new Date(a.criado_em).toLocaleDateString('pt-BR'):'';
    var tipo = a.tipo; var cor = _secConfig.matriculas.cor; var det = '';
    if (tipo === 'troca_turma') det = '<span style="font-weight:600;color:#1a6bb5;">Turma '+esc(p.turma_atual||'')+' ➜ '+esc(p.turma_nova||'')+'</span>';
    else if (tipo === 'desativar_matricula' && p.motivo) det = 'Motivo: '+esc(p.motivo);
    else if (tipo === 'nova_matricula') det = esc(p.serie||'')+' '+esc(p.turma||'')+' · '+(p.status==='matriculado'?'Matriculado':'Reserva')+' · Ano '+(p.ano||'');
    var nome = p.nome_crianca||m.nome_crianca||'—'; var resp = p.nome_responsavel||m.nome_responsavel||''; var serie = p.serie||m.serie||'';
    return '<div style="background:#fff;border:1.5px solid '+cor+'30;border-radius:10px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><div style="width:8px;height:8px;border-radius:50%;background:'+cor+';flex-shrink:0;"></div><div style="flex:1;min-width:150px;"><div style="font-size:13px;font-weight:600;">'+(_matSubIcons[tipo]||'')+' '+esc(nome)+(serie?' · '+esc(serie):'')+'</div><div style="font-size:11px;color:var(--muted);">'+det+(resp?' · Resp: '+esc(resp):'')+'</div><div style="font-size:10px;color:var(--muted);margin-top:2px;">por '+esc(a.solicitado_nome||a.solicitado_por)+' em '+dt+'</div></div><div style="display:flex;gap:6px;flex-shrink:0;"><button onclick="aprovarAprovacao(\''+a.id+'\')" style="padding:5px 12px;background:#2d7a3a;color:#fff;border:none;border-radius:6px;font-size:11px;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-weight:600;">Aprovar</button><button onclick="rejeitarAprovacao(\''+a.id+'\')" style="padding:5px 12px;background:none;border:1.5px solid #e53e3e;color:#e53e3e;border-radius:6px;font-size:11px;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-weight:600;">Rejeitar</button></div></div>';
  }

  async function aprovarAprovacao(id) { var obs = prompt('Observação (opcional):'); if (obs === null) return; var d = await api({ action:'crm_aprovacao_aprovar', id, observacao: obs }); if (d.error) { showToast(d.error,'error'); return; } showToast('Aprovação realizada!','success'); loadCentralAprovacoes(); }
  async function rejeitarAprovacao(id) { var obs = prompt('Motivo da rejeição (opcional):'); if (obs === null) return; var d = await api({ action:'crm_aprovacao_rejeitar', id, observacao: obs }); if (d.error) { showToast(d.error,'error'); return; } showToast('Solicitação rejeitada.','success'); loadCentralAprovacoes(); }
  // Legacy compat
  async function aprovarExclusao(id) { aprovarAprovacao(id); }
  async function rejeitarExclusao(id) { rejeitarAprovacao(id); }

  async function _aprovDiploma(id) { var obs = prompt('Observação (opcional):'); if (obs === null) return; var d = await api({ action:'diploma_aprovar', id, observacao: obs }); if (d.error) { showToast(d.error,'error'); return; } showToast('Diploma aprovado!','success'); loadCentralAprovacoes(); }
  async function _rejDiploma(id) { var obs = prompt('Motivo da rejeição:'); if (!obs) return; var d = await api({ action:'diploma_rejeitar', id, observacao: obs }); if (d.error) { showToast(d.error,'error'); return; } showToast('Diploma rejeitado.','success'); loadCentralAprovacoes(); }
  async function _aprovPdi(id) { var fb = prompt('Feedback (opcional):'); if (fb === null) return; var d = await api({ action:'pdi_aprovar', pdi_id: id, feedback: fb }); if (d.error) { showToast(d.error,'error'); return; } showToast('Growth Plan aprovado!','success'); loadCentralAprovacoes(); }
  async function _rejPdi(id) { var fb = prompt('Feedback (obrigatório para devolução):'); if (!fb) { showToast('Feedback obrigatório.','error'); return; } var d = await api({ action:'pdi_rejeitar', pdi_id: id, feedback: fb }); if (d.error) { showToast(d.error,'error'); return; } showToast('Growth Plan devolvido.','success'); loadCentralAprovacoes(); }
  async function _aprovAcesso(id) { if (!confirm('Aprovar solicitação de acesso?')) return; var d = await api({ action:'aluno_solicitacao_aprovar', id }); if (d.error) { showToast(d.error,'error'); return; } showToast('Acesso aprovado! Magic link enviado.','success'); loadCentralAprovacoes(); }
  async function _rejAcesso(id) { var motivo = prompt('Motivo da rejeição (opcional):'); if (motivo === null) return; var d = await api({ action:'aluno_solicitacao_rejeitar', id, motivo }); if (d.error) { showToast(d.error,'error'); return; } showToast('Solicitação rejeitada.','success'); loadCentralAprovacoes(); }

  async function loadAprovHistorico(statusFilter) {
    var d = await api({ action:'crm_aprovacoes_historico', limite: 50 });
    var all = Array.isArray(d) ? d : []; var filtered = all.filter(function(a) { return a.status === statusFilter; });
    var elId = statusFilter === 'aprovado' ? 'aprovViewAprovadas' : 'aprovViewRejeitadas';
    var el = document.getElementById(elId); if (!el) return;
    if (!filtered.length) { el.innerHTML = '<div class="empty-state" style="padding:40px 0;">Nenhum registro encontrado.</div>'; return; }
    var html = '';
    for (var a of filtered) { var m = a.crm_matriculas||{}; var p = a.payload||{}; var nome = p.nome_crianca||m.nome_crianca||'—'; var dtR = a.respondido_em?new Date(a.respondido_em).toLocaleDateString('pt-BR'):''; var sCor = a.status==='aprovado'?'#2d7a3a':'#e53e3e';
      html += '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><div style="width:8px;height:8px;border-radius:50%;background:'+sCor+';flex-shrink:0;"></div><div style="flex:1;min-width:150px;"><div style="font-size:13px;font-weight:600;">'+(_matSubIcons[a.tipo]||'📋')+' '+esc(nome)+' — '+(_matSubLabels[a.tipo]||a.tipo)+'</div><div style="font-size:11px;color:var(--muted);">'+(a.status==='aprovado'?'Aprovado':'Rejeitado')+' por '+esc(a.aprovado_por||'—')+' em '+dtR+'</div>'+(a.observacao_resposta?'<div style="font-size:11px;color:#666;">Obs: '+esc(a.observacao_resposta)+'</div>':'')+'</div><div style="padding:3px 8px;background:'+sCor+'15;color:'+sCor+';border-radius:6px;font-size:10px;font-weight:700;">'+(a.status==='aprovado'?'Aprovada':'Rejeitada')+'</div></div>';
    }
    el.innerHTML = html;
  }

  async function _initAprovBadge() { try { var d = await api({ action:'central_aprovacoes_resumo' }); _aprovData = d && d.totais ? d : { totais:{ total:0 } }; updateAprovBadges(); } catch(e) {} }
  _initAprovBadge();

  async function criarMatriculaDoLead(leadId) {
    let lead = crmLeads.find(l => l.id === leadId);
    if (!lead) {
      const all = await api({ action:'crm_leads_list' });
      lead = (Array.isArray(all) ? all : []).find(l => l.id === leadId);
    }
    if (!lead) { showToast('Lead nao encontrado','error'); return; }
    const ano = prompt('Ano da matricula:', '2026');
    if (!ano) return;
    // Buscar vagas para saber quantas turmas existem
    const vagasD = await api({ action:'crm_vagas_list', ano: parseInt(ano) });
    const vagasList = Array.isArray(vagasD) ? vagasD : [];
    const serieVaga = vagasList.find(v => v.serie === lead.serie_interesse);
    let turma = 'A';
    if (serieVaga && serieVaga.qtd_turmas > 1) {
      const letras = 'ABCDEFGHIJ'.slice(0, serieVaga.qtd_turmas).split('');
      turma = prompt('Turma (' + letras.join(', ') + '):', 'A');
      if (!turma) return;
      turma = turma.toUpperCase();
    }
    const status = (await _lumiedConfirm('Ja tem contrato assinado?\n\nConfirmar = Matriculado\nCancelar = Reserva')) ? 'matriculado' : 'reserva';
    const d = await api({
      action: 'crm_matricula_criar',
      lead_id: leadId,
      nome_responsavel: lead.nome_responsavel,
      nome_crianca: lead.nome_crianca || '',
      serie: lead.serie_interesse || '',
      ano: parseInt(ano),
      status, turma,
      email: lead.email || '',
      telefone: lead.telefone || '',
      data_nascimento: lead.data_nascimento || ''
    });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast(status === 'matriculado' ? 'Matricula registrada!' : 'Reserva registrada!', 'success');
    // Move lead to 'fechado' stage if exists
    const estagios = await api({ action:'crm_estagios_list' });
    const stgFechado = Array.isArray(estagios) ? estagios.find(e => e.nome.toLowerCase().includes('fechado') || e.nome.toLowerCase().includes('ganho') || e.nome.toLowerCase().includes('won')) : null;
    if (stgFechado) {
      await api({ action:'crm_lead_save', id: leadId, estagio_id: stgFechado.id });
    }
    // Close modal and reload
    document.querySelector('div[style*=fixed]')?.remove();
    loadCrmKanban();
  }

  // ── IMPRESSOES (gerente) ────────────────────────────
  var impGerenteFilter = 'pendentes';
  window.IMP_STATUS_G = { pendente:'⏳ Pendente', aprovado:'✅ Aprovado', rejeitado:'❌ Rejeitado', impresso:'🖨️ Impresso', entregue:'📦 Entregue' };
  window.IMP_PAPEL_G = { sulfite:'Sulfite A4', desenho:'Papel Desenho', cartolina:'Cartolina', foto:'Fotográfico', adesivo:'Adesivo' };

  function setImpFilter(f, btn) {
    impGerenteFilter = f;
    document.querySelectorAll('#panelImpressoes .fb').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadImpressoesGerente();
  }

  // ── Aba Benchmark de Impressões ──────────────────────────
  // 3 camadas: histórico próprio (mediana 3m), peers do mesmo nível etário,
  // faixa de mercado por aluno. Bloqueia exibição se turma sem alunos cadastrados.
  async function renderImpBenchmark(el) {
    el.innerHTML = '<div class="empty-state">Carregando benchmark...</div>';
    const mes = new Date().toISOString().slice(0, 7);
    const d = await api({ action: 'impressoes_benchmark', mes });
    if (d && d.error) { el.innerHTML = '<div class="empty-state">Erro: ' + esc(d.error) + '</div>'; return; }
    const turmas = (d && d.turmas) || [];
    if (!turmas.length) { el.innerHTML = '<div class="empty-state">Nenhuma turma ativa.</div>'; return; }

    // Header + legenda
    const semCadastro = turmas.filter(t => t.alunos_cadastrados === 0).length;
    let html = `
      <div style="background:#fff8e1;border:1px solid #f6d365;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:12px;color:#7a5a00;">
        <strong>📈 Benchmark de impressões — ${mes}</strong><br>
        Comparativo em 3 camadas: <strong>histórico</strong> da turma, <strong>peers</strong> do mesmo nível etário e <strong>faixa de mercado</strong> (folhas/aluno/mês esperado pra escolas bilíngues de qualidade equivalente).
        ${semCadastro > 0 ? `<br>⚠ ${semCadastro} turma(s) sem alunos cadastrados — complete o cadastro pra ver o benchmark por aluno.` : ''}
      </div>`;

    // Agrupa por nível
    const niveis = {};
    for (const t of turmas) {
      const k = t.nivel_label || 'Outras';
      if (!niveis[k]) niveis[k] = [];
      niveis[k].push(t);
    }
    const ordemNiveis = ['Toddler (1-3 anos)','Nursery / Pre-K','Junior Kindergarten','Senior Kindergarten','Year 1-3 (alfabetização bilíngue)','Year 4-5','Outras (sem faixa)'];

    for (const niv of ordemNiveis) {
      const lista = niveis[niv]; if (!lista) continue;
      html += `<div style="font-size:13px;font-weight:700;margin:18px 0 8px;padding:6px 12px;background:#f5f0ea;border-radius:8px;">${esc(niv)} <span style="font-weight:400;color:var(--muted);font-size:11px;">(${lista.length} turma${lista.length>1?'s':''})</span></div>`;
      html += lista.map(t => renderTurmaBenchCard(t)).join('');
    }
    el.innerHTML = html;
  }

  function renderTurmaBenchCard(t) {
    // BLOQUEANTE: turma sem alunos cadastrados
    if (t.alunos_cadastrados === 0) {
      return `<div style="background:#fff;border:1.5px dashed #e5e1da;border-radius:10px;padding:14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
        <div style="flex:1;">
          <div style="font-weight:600;font-size:13px;">${esc(t.turma_nome)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px;">📋 Sem alunos cadastrados — não dá pra calcular benchmark por aluno.</div>
        </div>
        <div style="font-size:11px;color:var(--muted);">Folhas no mês: <strong style="color:var(--text);">${t.folhas_mes_atual}</strong></div>
        <button onclick="showPanel('alunos')" style="padding:6px 14px;background:var(--blue);color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">Cadastrar alunos →</button>
      </div>`;
    }

    const cor = t.outlier ? '#e53e3e' : (t.delta_pct_vs_historico > 30 ? '#b07d00' : '#2d7a3a');
    const folhasPorAluno = t.alunos_cadastrados > 0 ? (t.folhas_mes_atual / t.alunos_cadastrados).toFixed(1) : '—';
    const histTxt = t.historico_mediana_3m != null
      ? `<span style="color:var(--muted);">vs histórico:</span> <strong>${t.historico_mediana_3m}</strong>${t.delta_pct_vs_historico != null ? ` <span style="color:${t.delta_pct_vs_historico>0?'#b07d00':'#2d7a3a'};font-weight:600;">(${t.delta_pct_vs_historico>0?'+':''}${t.delta_pct_vs_historico}%)</span>` : ''}`
      : '<span style="color:var(--muted);">sem histórico anterior</span>';
    const peersTxt = t.peers_mediana_nivel != null
      ? `<span style="color:var(--muted);">peers do mesmo nível:</span> <strong>${t.peers_mediana_nivel}</strong>`
      : '';
    const benchTxt = t.benchmark_min != null && t.benchmark_max != null
      ? `<span style="color:var(--muted);">faixa esperada:</span> <strong>${t.benchmark_min}–${t.benchmark_max}</strong>`
      : '<span style="color:var(--muted);">faixa não aplicável</span>';

    return `<div style="background:#fff;border:1.5px solid ${t.outlier ? '#fecaca' : 'var(--border)'};border-radius:10px;padding:14px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <div style="font-weight:600;font-size:14px;">${esc(t.turma_nome)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${t.alunos_cadastrados} aluno${t.alunos_cadastrados>1?'s':''} · ${folhasPorAluno} folhas/aluno</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:22px;font-weight:700;color:${cor};line-height:1;">${t.folhas_mes_atual}</div>
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">folhas no mês</div>
        </div>
      </div>
      ${t.outlier ? `<div style="background:#fef2f2;border-left:3px solid #e53e3e;padding:6px 10px;font-size:11px;color:#991b1b;margin-top:8px;border-radius:4px;">⚠ ${esc(t.outlier_motivo || 'Outlier detectado')}</div>` : ''}
      <div style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;font-size:12px;">
        <div style="background:#fafaf8;padding:8px 10px;border-radius:6px;">${histTxt}</div>
        ${peersTxt ? `<div style="background:#fafaf8;padding:8px 10px;border-radius:6px;">${peersTxt}</div>` : ''}
        <div style="background:#fafaf8;padding:8px 10px;border-radius:6px;">${benchTxt}</div>
      </div>
    </div>`;
  }

  async function loadImpressoesGerente() {
    const el = document.getElementById('impGerenteContent');
    if (impGerenteFilter === 'benchmark') {
      await renderImpBenchmark(el);
      return;
    }
    if (impGerenteFilter === 'orcamento') {
      const d = await api({ action: 'impressoes_orcamento_list', mes: new Date().toISOString().slice(0,7) });
      const turmas = Array.isArray(d) ? d : [];
      el.innerHTML = turmas.length ? `
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr>
            <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Turma</th>
            <th style="text-align:center;padding:10px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Usado</th>
            <th style="text-align:center;padding:10px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Limite</th>
            <th style="padding:10px;border-bottom:1.5px solid var(--border);"></th>
          </tr></thead>
          <tbody>${turmas.map(t => {
            const pct = t.limite > 0 ? Math.min(100, (t.usado / t.limite) * 100) : 0;
            return `<tr>
              <td style="padding:10px 14px;font-size:13px;border-bottom:1px solid #f5f0ea;font-weight:600;">${esc(t.nome)}</td>
              <td style="padding:10px;text-align:center;border-bottom:1px solid #f5f0ea;font-size:13px;color:${pct>=90?'#e53e3e':pct>=70?'#b07d00':'#2d7a3a'};font-weight:600;">${t.usado}</td>
              <td style="padding:10px;text-align:center;border-bottom:1px solid #f5f0ea;">
                <input type="number" value="${t.limite}" min="0" style="width:70px;padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;text-align:center;font-size:13px;font-family:'DM Sans',sans-serif;" onchange="setImpLimite('${t.id}',this.value)">
              </td>
              <td style="padding:10px;border-bottom:1px solid #f5f0ea;">
                <div style="background:#f0ece6;border-radius:4px;height:8px;width:80px;">
                  <div style="height:100%;border-radius:4px;width:${pct}%;background:${pct>=90?'#e53e3e':pct>=70?'#f6a623':'#48bb78'};"></div>
                </div>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table>` : '<div class="empty-state">Nenhuma turma.</div>';
      return;
    }

    const d = impGerenteFilter === 'pendentes'
      ? await api({ action: 'impressoes_pendentes' })
      : await api({ action: 'impressoes_todas', mes: new Date().toISOString().slice(0,7) });
    const items = Array.isArray(d) ? d : [];
    window._impItemsCache = Object.fromEntries(items.map(x => [x.id, x]));
    if (!items.length) { el.innerHTML = '<div class="empty-state">Nenhuma solicitacao.</div>'; return; }
    el.innerHTML = items.map(it => {
      const dt = new Date(it.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      const acoes = [];
      if (it.status === 'pendente') {
        acoes.push(`<button onclick="impAprovar('${it.id}')" style="padding:4px 10px;background:#2d7a3a;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">Aprovar</button>`);
        acoes.push(`<button onclick="impRejeitar('${it.id}')" style="padding:4px 10px;background:#e53e3e;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">Rejeitar</button>`);
      }
      if (it.status === 'aprovado') acoes.push(`<button onclick="impMarcarImpresso('${it.id}')" style="padding:4px 10px;background:#1a6bb5;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">Impresso</button>`);
      if (it.status === 'impresso') acoes.push(`<button onclick="impMarcarEntregue('${it.id}')" style="padding:4px 10px;background:#2d7a3a;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">Entregue</button>`);
      return `<div style="display:flex;align-items:flex-start;gap:12px;padding:14px;background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <a href="${esc(it.arquivo_url)}" target="_blank" style="font-weight:600;font-size:13px;color:var(--blue);">📎 ${esc(it.arquivo_nome||'Arquivo')}</a>
            <span style="font-size:12px;font-weight:700;">${it.copias} copias</span>
            <span style="font-size:12px;color:var(--muted);">${(window.IMP_PAPEL_G||{})[it.tipo_papel]||it.tipo_papel||''}</span>
            <span style="font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;background:${it.status==='entregue'?'#edf7f0':it.status==='rejeitado'?'#fdf0f2':'#fff8e1'};color:${it.status==='entregue'?'#2d7a3a':it.status==='rejeitado'?'#a00d24':'#b07d00'};">${(window.IMP_STATUS_G||{})[it.status]||it.status||''}</span>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;">
            ${esc(it.professora_nome||'?')} · ${esc(it.turma_nome||'?')} · ${dt}
            ${it.para_dia ? ' · Para ' + new Date(it.para_dia+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}) : ''}
          </div>
          ${it.observacao ? `<div style="font-size:11px;color:#555;margin-top:2px;">${esc(it.observacao)}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;">${acoes.join('')}</div>
      </div>`;
    }).join('');
  }

  async function impAprovar(id) {
    const it = (window._impItemsCache || {})[id];
    if (!it) { showToast('Solicitação não encontrada.', 'error'); return; }
    impAbrirReviewModal(it, 'aprovar');
  }
  async function impRejeitar(id) {
    const it = (window._impItemsCache || {})[id];
    if (!it) { showToast('Solicitação não encontrada.', 'error'); return; }
    impAbrirReviewModal(it, 'rejeitar');
  }
  function impAbrirReviewModal(it, modo) {
    const isPdf = (it.arquivo_url || '').toLowerCase().endsWith('.pdf');
    const preview = isPdf
      ? `<iframe src="${esc(it.arquivo_url)}" style="width:100%;height:540px;border:1px solid var(--border);border-radius:8px;background:#f5f5f5;"></iframe>`
      : `<img src="${esc(it.arquivo_url)}" style="max-width:100%;max-height:540px;border:1px solid var(--border);border-radius:8px;display:block;margin:0 auto;background:#f5f5f5;">`;
    const totalFolhas = (it.copias || 1) * (it.num_paginas || 1);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `<div style="background:#fff;border-radius:14px;padding:22px;max-width:760px;width:100%;max-height:92vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="font-family:'Lora',serif;font-size:17px;">${modo === 'aprovar' ? '✅ Aprovar impressão' : '❌ Rejeitar impressão'}</h3>
        <button onclick="this.closest('div[style]').parentElement.remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);">×</button>
      </div>
      <div style="font-size:13px;margin-bottom:10px;">
        <strong>${esc(it.arquivo_nome || 'Arquivo')}</strong><br>
        <span style="color:var(--muted);">${esc(it.professora_nome || '?')} · ${esc(it.turma_nome || '?')} · ${it.copias || 1} cópias × ${it.num_paginas || 1} pág = <strong>${totalFolhas} folhas</strong></span>
      </div>
      ${preview}
      ${modo === 'rejeitar' ? `<div style="margin-top:12px;"><label style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;">Motivo (opcional)</label><textarea id="impRejNota" rows="2" style="width:100%;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:'DM Sans',sans-serif;font-size:13px;"></textarea></div>` : ''}
      <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;">
        <button onclick="this.closest('div[style]').parentElement.remove()" style="padding:9px 18px;background:#f0ece6;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;">Cancelar</button>
        <button id="impConfirma1" style="padding:9px 18px;background:${modo === 'aprovar' ? '#2d7a3a' : '#e53e3e'};color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">${modo === 'aprovar' ? '✅ Aprovar' : '❌ Rejeitar'}</button>
      </div>
      <div id="impConfirma2Wrap" style="display:none;margin-top:14px;padding:14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">
        <div style="font-size:13px;font-weight:600;color:#9a3412;margin-bottom:10px;">⚠️ Tem certeza? Esta ação ${modo === 'aprovar' ? 'dispara a impressão imediatamente' : 'rejeita o pedido e a professora será notificada'}.</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button onclick="document.getElementById('impConfirma2Wrap').style.display='none'" style="padding:8px 14px;background:#fff;border:1px solid var(--border);border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;">Voltar</button>
          <button id="impConfirma2" style="padding:8px 14px;background:${modo === 'aprovar' ? '#2d7a3a' : '#e53e3e'};color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Sim, ${modo === 'aprovar' ? 'aprovar' : 'rejeitar'}</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#impConfirma1').onclick = () => {
      overlay.querySelector('#impConfirma2Wrap').style.display = 'block';
    };
    overlay.querySelector('#impConfirma2').onclick = async () => {
      overlay.querySelector('#impConfirma2').disabled = true;
      overlay.querySelector('#impConfirma2').textContent = 'Enviando…';
      const action = modo === 'aprovar' ? 'impressao_aprovar' : 'impressao_rejeitar';
      const nota = modo === 'rejeitar' ? (overlay.querySelector('#impRejNota')?.value?.trim() || '') : undefined;
      const r = await api({ action, id: it.id, ...(nota !== undefined ? { nota } : {}) });
      if (r?.error) { alert('Erro: ' + r.error); overlay.querySelector('#impConfirma2').disabled = false; return; }
      overlay.remove();
      showToast(modo === 'aprovar' ? '✅ Impressão aprovada e em fila' : '❌ Impressão rejeitada', 'success');
      loadImpressoesGerente();
    };
  }
  async function impMarcarImpresso(id) {
    // Buscar turmas
    let turmas = window._impTurmasCache || [];
    if (!turmas.length) {
      try {
        const d = await api({ action: 'series_list_all' });
        turmas = (Array.isArray(d) ? d : (d?.data || [])).filter(t => t.ativo !== false);
        window._impTurmasCache = turmas;
      } catch { turmas = []; }
    }
    const turmaDestino = await new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-family:inherit;';
      overlay.innerHTML = `<div style="background:#fff;border-radius:16px;padding:28px;max-width:380px;width:90%;box-shadow:0 16px 48px rgba(0,0,0,.2);">
        <h3 style="font-family:'Lora',serif;font-size:16px;margin-bottom:12px;">🖨️ Turma de destino</h3>
        <select id="impTurmaSelGer" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-family:'DM Sans',sans-serif;font-size:14px;margin-bottom:16px;">
          <option value="">— Selecione —</option>
          ${turmas.map(t => '<option value="' + esc(t.nome) + '">' + esc(t.nome) + '</option>').join('')}
        </select>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button onclick="this.closest('div[style]').parentElement.remove()" style="padding:8px 18px;background:#f0ece6;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;">Cancelar</button>
          <button id="impConfirmGer" style="padding:8px 18px;background:#1a6bb5;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Confirmar</button>
        </div></div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => { if(e.target===overlay) { overlay.remove(); resolve(null); }});
      document.getElementById('impConfirmGer').onclick = () => {
        const v = document.getElementById('impTurmaSelGer').value;
        overlay.remove();
        resolve(v || null);
      };
    });
    if (!turmaDestino) return;
    await api({ action: 'impressao_marcar_impresso', id, turma_destino: turmaDestino });
    showToast('Marcado como impresso! Entregar para: ' + turmaDestino, 'success');
    loadImpressoesGerente();
  }
  async function impMarcarEntregue(id) {
    await api({ action: 'impressao_marcar_entregue', id });
    showToast('Marcado como entregue!', 'success');
    loadImpressoesGerente();
  }
  async function setImpLimite(turmaId, limite) {
    const mes = new Date().toISOString().slice(0,7);
    await api({ action: 'impressoes_orcamento_set', turma_id: turmaId, mes, limite });
    showToast('Limite atualizado!', 'success');
  }

  // ── HORÁRIOS DE ACESSO PROFESSORAS ──────────────────
  var HA_DIAS = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
  var haAllData = [], haProfs = [];

  async function loadHorarioAcesso() {
    const d = await api({ action: 'prof_horario_acesso_list' });
    haAllData = d.data || [];
    haProfs = d.professoras || [];
    // Preencher select
    const sel = document.getElementById('haSelectProf');
    const current = sel.value;
    sel.innerHTML = '<option value="">Selecione uma professora...</option>' +
      haProfs.map(p => '<option value="' + p.id + '">' + esc(p.nome) + ' (' + esc(p.email) + ')</option>').join('');
    if (current) sel.value = current;
    // Resumo
    haRenderResumo();
    // Se já tem uma selecionada, recarrega
    if (sel.value) haLoadProfessora();
  }

  function haRenderResumo() {
    const el = document.getElementById('haResumoList');
    if (!haProfs.length) { el.innerHTML = '<div class="empty-state">Nenhuma professora cadastrada.</div>'; return; }
    el.innerHTML = '<table class="data-table" style="font-size:12px;"><thead><tr><th>Professora</th><th>Restrição</th><th>Horários</th></tr></thead><tbody>' +
      haProfs.map(p => {
        const regras = haAllData.filter(r => r.professora_id === p.id && r.ativo);
        const hasRegras = regras.length > 0;
        const resumo = hasRegras
          ? regras.sort((a,b) => a.dia_semana - b.dia_semana).map(r => HA_DIAS[r.dia_semana].slice(0,3) + ' ' + r.hora_inicio.slice(0,5) + '-' + r.hora_fim.slice(0,5)).join(', ')
          : '<span style="color:var(--green);">Acesso livre</span>';
        return '<tr><td><strong>' + esc(p.nome) + '</strong></td>' +
          '<td>' + (hasRegras ? '<span style="color:#e53e3e;font-weight:600;">Restrito</span>' : '<span style="color:var(--green);">Livre</span>') + '</td>' +
          '<td>' + resumo + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  function haLoadProfessora() {
    const profId = document.getElementById('haSelectProf').value;
    const editor = document.getElementById('haEditor');
    if (!profId) { editor.style.display = 'none'; return; }
    editor.style.display = 'block';
    const regras = haAllData.filter(r => r.professora_id === profId);
    const tbody = document.getElementById('haTableBody');
    tbody.innerHTML = HA_DIAS.map((dia, i) => {
      const regra = regras.find(r => r.dia_semana === i);
      const checked = regra && regra.ativo ? 'checked' : '';
      const hi = regra ? regra.hora_inicio.slice(0,5) : '07:00';
      const hf = regra ? regra.hora_fim.slice(0,5) : '18:00';
      return '<tr>' +
        '<td><input type="checkbox" class="ha-check" data-dia="' + i + '" ' + checked + '></td>' +
        '<td>' + dia + '</td>' +
        '<td><input type="time" class="ha-inicio" data-dia="' + i + '" value="' + hi + '" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;"></td>' +
        '<td><input type="time" class="ha-fim" data-dia="' + i + '" value="' + hf + '" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-family:inherit;"></td>' +
        '</tr>';
    }).join('');
  }

  async function haSalvar() {
    const profId = document.getElementById('haSelectProf').value;
    if (!profId) return;
    const horarios = [];
    document.querySelectorAll('.ha-check').forEach(cb => {
      if (cb.checked) {
        const dia = parseInt(cb.dataset.dia);
        const inicio = document.querySelector('.ha-inicio[data-dia="' + dia + '"]').value;
        const fim = document.querySelector('.ha-fim[data-dia="' + dia + '"]').value;
        horarios.push({ dia_semana: dia, hora_inicio: inicio, hora_fim: fim, ativo: true });
      }
    });
    const btn = document.getElementById('haSaveBtn');
    btn.disabled = true; btn.textContent = 'Salvando...';
    const d = await api({ action: 'prof_horario_acesso_salvar', professora_id: profId, horarios });
    btn.disabled = false; btn.textContent = 'Salvar Horários';
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Horários salvos com sucesso!', 'success');
    loadHorarioAcesso();
  }

  function haAplicarPadrao() {
    // Marca Seg-Sex 07:00-18:00
    document.querySelectorAll('.ha-check').forEach(cb => {
      const dia = parseInt(cb.dataset.dia);
      cb.checked = dia >= 1 && dia <= 5; // Seg-Sex
    });
    document.querySelectorAll('.ha-inicio').forEach(inp => inp.value = '07:00');
    document.querySelectorAll('.ha-fim').forEach(inp => inp.value = '18:00');
    showToast('Horário comercial aplicado (Seg-Sex 07:00-18:00). Clique "Salvar" para confirmar.', 'info');
  }

  async function haRemoverTodos() {
    const profId = document.getElementById('haSelectProf').value;
    if (!profId) { showToast('Selecione uma professora.', 'error'); return; }
    const prof = haProfs.find(p => p.id === profId);
    if (!await _lumiedConfirm('Remover todas as restrições de horário de ' + (prof?.nome || 'esta professora') + '? Ela terá acesso livre ao sistema.')) return;
    const d = await api({ action: 'prof_horario_acesso_remover', professora_id: profId });
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Restrições removidas. Acesso livre.', 'success');
    loadHorarioAcesso();
  }

  // ── EMERGENCIA ──────────────────────────────────────
  var EMERG_TIPOS = { incendio:'🔥 Incêndio', intruso:'🚷 Intruso', emergencia_medica:'🚑 Emergência Médica', evacuacao:'🏃 Evacuação', outro:'⚠️ Outro' };

  async function acionarEmergencia(tipo) {
    const msg = prompt('Mensagem adicional (opcional):');
    if (!await _lumiedConfirm('ATENÇÃO: Isso vai notificar TODA a equipe da escola imediatamente. Confirma o alerta de ' + (EMERG_TIPOS[tipo]||tipo) + '?')) return;
    const d = await api({ action: 'emergencia_acionar', tipo, mensagem: msg || null });
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('ALERTA DE EMERGÊNCIA ACIONADO! Toda a equipe foi notificada.', 'error', 8000);
    loadEmergencia();
  }

  async function loadEmergencia() {
    const [ativos, hist] = await Promise.all([
      api({ action: 'emergencia_ativos' }),
      api({ action: 'emergencia_historico' }),
    ]);
    // Ativos
    const ativosArr = Array.isArray(ativos) ? ativos : [];
    const el = document.getElementById('emergenciaAtivos');
    if (ativosArr.length) {
      el.innerHTML = '<div class="sec-title" style="color:#e53e3e;">⚠️ ALERTAS ATIVOS</div>' +
        ativosArr.map(a => `<div style="background:#fdf0f0;border:2px solid #e53e3e;border-radius:12px;padding:16px;margin-bottom:10px;animation:pulse 2s infinite;">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <div>
              <div style="font-size:18px;font-weight:700;color:#e53e3e;">${EMERG_TIPOS[a.tipo]||a.tipo}</div>
              ${a.mensagem ? `<div style="font-size:13px;margin-top:4px;">${esc(a.mensagem)}</div>` : ''}
              <div style="font-size:11px;color:var(--muted);margin-top:4px;">Por ${esc(a.acionado_por)} · ${new Date(a.criado_em).toLocaleString('pt-BR')}</div>
            </div>
            <button onclick="resolverEmergencia('${a.id}')" style="padding:8px 20px;background:#2d7a3a;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">✅ Resolver</button>
          </div>
        </div>`).join('');
    } else {
      el.innerHTML = '';
    }
    // Historico
    const histArr = Array.isArray(hist) ? hist : [];
    document.getElementById('emergenciaHistorico').innerHTML = histArr.length ? histArr.map(a => {
      const dt = new Date(a.criado_em).toLocaleString('pt-BR');
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--white);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;">
        <div style="font-size:20px;">${EMERG_TIPOS[a.tipo]?.charAt(0)||'⚠️'}</div>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:13px;">${EMERG_TIPOS[a.tipo]||a.tipo}</div>
          <div style="font-size:11px;color:var(--muted);">${dt} · ${esc(a.acionado_por)}${a.resolvido_por ? ' · Resolvido por '+esc(a.resolvido_por) : ''}</div>
        </div>
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;${a.ativo?'background:#fdf0f0;color:#e53e3e;':'background:#edf7f0;color:#2d7a3a;'}">${a.ativo?'Ativo':'Resolvido'}</span>
      </div>`;
    }).join('') : '<div style="text-align:center;padding:16px;color:var(--muted);font-size:13px;">Nenhum alerta registrado.</div>';
  }

  async function resolverEmergencia(id) {
    if (!await _lumiedConfirm('Confirma que a emergência foi resolvida?')) return;
    await api({ action: 'emergencia_resolver', id });
    showToast('Emergência resolvida.', 'success');
    loadEmergencia();
  }

  // ── ACHADOS E PERDIDOS ───────────────────────────────
  async function loadAchadosGerente() {
    const d = await callDiplomas({ action: 'achados_lista_equipe' });
    const items = d.data || [];
    document.getElementById('achadosCount').textContent = items.length;
    const el = document.getElementById('achadosGerenteLista');
    if (!items.length) { el.innerHTML = '<div class="empty-state">Nenhum item registrado.</div>'; return; }
    el.innerHTML = items.map(it => {
      const dt = new Date(it.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      const isPublico = it.status === 'publico' || new Date(it.publicar_em) <= new Date();
      return `<div style="display:flex;gap:14px;align-items:flex-start;padding:14px;background:#fff;border:1.5px solid var(--border);border-radius:12px;margin-bottom:10px;">
        ${it.foto_url ? `<img src="${esc(it.foto_url)}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border);flex-shrink:0;">` : '<div style="width:72px;height:72px;background:#f0ece6;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;">📦</div>'}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:14px;">${esc(it.descricao)}</div>
          ${it.local_encontrado ? `<div style="font-size:12px;color:var(--muted);">📍 ${esc(it.local_encontrado)}</div>` : ''}
          <div style="font-size:11px;color:var(--muted);margin-top:4px;">Por ${esc(it.postado_por_nome||'—')} · ${dt}</div>
          <span style="display:inline-block;margin-top:4px;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;${isPublico?'background:#edf7f0;color:#2d7a3a;':'background:#fff8e1;color:#b07d00;'}">${isPublico?'Visível para pais':'Apenas equipe — publica em '+new Date(it.publicar_em).toLocaleString('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
          ${!isPublico ? `<button onclick="achadoPublicar('${it.id}')" style="padding:5px 12px;background:#2d7a3a;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">Publicar Agora</button>` : ''}
          <button onclick="achadoDevolver('${it.id}')" style="padding:5px 12px;background:#1a6bb5;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">Devolvido</button>
          <button onclick="achadoExcluir('${it.id}')" style="padding:5px 12px;background:none;border:1px solid #e53e3e;color:#e53e3e;border-radius:6px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Excluir</button>
        </div>
      </div>`;
    }).join('');
  }
  async function achadoPublicar(id) {
    await callDiplomas({ action: 'achados_publicar', id });
    showToast('Item publicado para os pais!', 'success');
    loadAchadosGerente();
  }
  async function achadoDevolver(id) {
    const para = prompt('Nome de quem retirou o item (opcional):');
    await callDiplomas({ action: 'achados_devolver', id, devolvido_para: para || '' });
    showToast('Item marcado como devolvido!', 'success');
    loadAchadosGerente();
  }
  async function achadoExcluir(id) {
    if (!await _lumiedConfirm('Excluir este item?')) return;
    await callDiplomas({ action: 'achados_excluir', id });
    loadAchadosGerente();
  }

  // Init — aguarda dist/gerente/index.js (defer) inicializar window.__api/__utils.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkSession);
  } else {
    checkSession();
  }

