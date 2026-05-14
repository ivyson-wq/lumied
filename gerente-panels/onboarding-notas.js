// Auto-extraído do gerente.html (Onda 4 — mega batch).
// Onboarding billing banners + Notas (config/períodos/disciplinas/visão geral)
  // ═══ ONBOARDING + BILLING BANNERS ═══
  async function loadOnboardingBilling() {
    try {
      const d = await api({ action: 'onboarding_status' });
      if (!d || d.error) return;

      // Billing banner
      const saas = d.saas || {};
      const bb = document.getElementById('billingBanner');
      if (bb) {
        const state = saas.estado;
        const dias = saas.dias_para_vencimento;
        if (state === 'aviso') {
          bb.style.display = 'block';
          bb.style.background = '#FEF3C7'; bb.style.color = '#92400E'; bb.style.border = '1px solid #FCD34D';
          bb.innerHTML = `⏰ <strong>Sua mensalidade vence em ${dias} dia(s)</strong> — ${saas.proximo_vencimento ? new Date(saas.proximo_vencimento+'T00:00:00').toLocaleDateString('pt-BR') : ''}. Garanta a continuidade do serviço.`;
        } else if (state === 'atraso' || state === 'grace') {
          bb.style.display = 'block';
          bb.style.background = '#FEE2E2'; bb.style.color = '#991B1B'; bb.style.border = '1px solid #FCA5A5';
          bb.innerHTML = `⚠️ <strong>Mensalidade em atraso</strong> (${Math.abs(dias || 0)} dia(s)). Envios automáticos e novas funcionalidades podem ser suspensos. Regularize para manter o acesso integral.`;
        } else if (state === 'suspenso') {
          bb.style.display = 'block';
          bb.style.background = '#FEE2E2'; bb.style.color = '#7F1D1D'; bb.style.border = '2px solid #DC2626';
          bb.innerHTML = `🚫 <strong>Plano suspenso.</strong> Alguns módulos foram desativados. Entre em contato com <a href="mailto:financeiro@lumied.com.br" style="color:inherit;font-weight:700;">financeiro@lumied.com.br</a> para regularizar.`;
        } else if (state === 'bloqueado') {
          bb.style.display = 'block';
          bb.style.background = '#1F2937'; bb.style.color = '#F9FAFB'; bb.style.border = '2px solid #111827';
          bb.innerHTML = `🔒 <strong>Acesso bloqueado por inadimplência.</strong> Dados preservados por 90 dias. Contato: <a href="mailto:financeiro@lumied.com.br" style="color:#93C5FD;">financeiro@lumied.com.br</a>.`;
        } else {
          bb.style.display = 'none';
        }
      }

      // Onboarding checklist
      const cl = d.checklist || {};
      const total = cl.total || 0;
      const feitas = cl.feitas || 0;
      const ob = document.getElementById('onbBanner');
      if (ob && total > 0 && feitas < total && !d.dismissed) {
        ob.style.display = 'block';
        const pct = Math.round((feitas / total) * 100);
        document.getElementById('onbProgresso').textContent = `${feitas}/${total} etapas concluídas · ${pct}%`;
        document.getElementById('onbProgressFill').style.width = pct + '%';
        const el = document.getElementById('onbEtapas');
        el.innerHTML = (cl.etapas || []).map(function(e) {
          const check = e.concluido ? '✅' : '⬜';
          const txt = e.concluido ? '<s style="color:var(--muted);">'+e.titulo+'</s>' : '<strong>'+e.titulo+'</strong>';
          const action = e.concluido
            ? '<button onclick="onbMarcar(\''+e.id+'\',false)" style="padding:4px 10px;background:none;border:1px solid var(--border);border-radius:6px;font-size:11px;cursor:pointer;margin-top:6px;">Desfazer</button>'
            : '<div style="display:flex;gap:6px;margin-top:6px;">'
              + (e.link ? '<a href="'+e.link+'" style="padding:4px 10px;background:#1a6bb5;color:#fff;border-radius:6px;font-size:11px;text-decoration:none;">Ir para</a>' : '')
              + '<button onclick="onbMarcar(\''+e.id+'\',true)" style="padding:4px 10px;background:#16A34A;color:#fff;border:0;border-radius:6px;font-size:11px;cursor:pointer;">Concluir</button>'
              + '</div>';
          return '<div style="padding:10px 12px;background:'+(e.concluido?'#F0FDF4':'#F8FAFC')+';border:1px solid '+(e.concluido?'#86EFAC':'var(--border)')+';border-radius:10px;">'
            + '<div style="display:flex;gap:8px;align-items:start;">'
            + '<span style="font-size:16px;">'+check+'</span>'
            + '<div style="flex:1;">'+txt+'<div style="color:var(--muted);font-size:12px;margin-top:2px;">'+(e.descricao||'')+'</div>'+action+'</div>'
            + '</div></div>';
        }).join('');
      } else if (ob) {
        ob.style.display = 'none';
      }
    } catch (e) {
      console.warn('onboarding/billing load failed', e);
    }
  }
  function onbToggleDetalhe() {
    const el = document.getElementById('onbEtapas');
    const btn = document.getElementById('onbBtnToggle');
    if (!el) return;
    const showing = el.style.display !== 'none' && el.style.display !== '';
    el.style.display = showing ? 'none' : 'grid';
    btn.textContent = showing ? 'Ver checklist' : 'Ocultar';
  }
  async function onbMarcar(etapa, concluido) {
    await api({ action: 'onboarding_marcar', etapa, concluido });
    loadOnboardingBilling();
  }
  async function onbDismiss() {
    if (!confirm('Dispensar o checklist? Pode reabri-lo no menu de configurações.')) return;
    await api({ action: 'onboarding_dismiss' });
    document.getElementById('onbBanner').style.display = 'none';
  }
  // Dispara após pequeno delay pra sessão estar validada (só se logado)
  setTimeout(function() { if (localStorage.getItem('mb_token')) loadOnboardingBilling(); }, 2000);

  // ═══════════════════════════════════════════════════════════
  //  COMUNICAÇÃO — CHAT
  // ═══════════════════════════════════════════════════════════
  var COMUNICACAO = SUPABASE_URL + '/functions/v1/comunicacao';
  async function apiCom(body) {
    const token = getToken();
    const r = await fetch(COMUNICACAO, { method:'POST', headers:{'Content-Type':'application/json','apikey':ANON,'Authorization':'Bearer '+ANON}, body: JSON.stringify({...body, _token: token}) });
    return r.json();
  }

  async function loadChatConversas() {
    const el = document.getElementById('chatConversasContent');
    el.innerHTML = '<div class="spinner-sm"></div> Carregando...';
    const d = await apiCom({ action:'chat_conversas_list', usuario_tipo:'gerente', usuario_id: currentGerente?.email });
    const convs = Array.isArray(d) ? d : [];
    if (!convs.length) { el.innerHTML = '<div class="empty-state">Nenhuma conversa. Envie um aviso para começar.</div>'; return; }
    el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Conversa</th><th>Última Mensagem</th><th>Não Lidas</th></tr></thead><tbody>' +
      convs.map(c => `<tr>
        <td><strong>${esc(c.titulo || c.tipo)}</strong><br><span style="font-size:11px;color:var(--muted);">${c.chat_participantes?.map(p=>p.usuario_nome).join(', ') || ''}</span></td>
        <td style="font-size:12px;">${c.ultima_mensagem ? esc(c.ultima_mensagem.conteudo?.substring(0,60)) : '—'}</td>
        <td>${c.nao_lidas > 0 ? '<span class="count-badge">'+c.nao_lidas+'</span>' : '—'}</td>
      </tr>`).join('') + '</tbody></table></div>';
  }

  async function novoChatAviso() {
    const conteudo = prompt('Mensagem do aviso:');
    if (!conteudo) return;
    const d = await apiCom({ action:'chat_avisos_turma', conteudo, titulo:'Aviso Geral' });
    if (d.error) return showToast(d.error,'error');
    showToast('Aviso enviado!');
    loadChatConversas();
  }

  // ═══════════════════════════════════════════════════════════
  //  PESQUISAS / ENQUETES
  // ═══════════════════════════════════════════════════════════
  var DIPLOMAS_FN = SUPABASE_URL + '/functions/v1/diplomas';
  async function apiDiplomas(body) {
    const token = getToken();
    const r = await fetch(DIPLOMAS_FN, { method:'POST', headers:{'Content-Type':'application/json','apikey':ANON,'Authorization':'Bearer '+ANON}, body: JSON.stringify({...body, _token: token}) });
    return r.json();
  }

  async function almBaixarPdf(action, extraQS) {
    const token = getToken();
    const extras = {};
    if (extraQS) {
      String(extraQS).split('&').forEach(function(p) {
        const [k, v] = p.split('=');
        if (k) extras[k] = decodeURIComponent(v || '');
      });
    }
    try {
      const r = await fetch(DIPLOMAS_FN, {
        method: 'POST',
        headers: { 'Content-Type':'application/json','apikey':ANON,'Authorization':'Bearer '+ANON },
        body: JSON.stringify({ action, _token: token, ...extras }),
      });
      if (!r.ok) {
        const j = await r.json().catch(()=>({error:'Falha'}));
        alert('Erro: ' + (j.error || r.status));
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = r.headers.get('Content-Disposition') || '';
      const m = /filename="([^"]+)"/.exec(cd);
      a.download = m ? m[1] : (action + '.pdf');
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch (e) {
      alert('Erro ao gerar PDF: ' + e.message);
    }
  }

  async function almBaixarRelatorio(tipo) {
    document.getElementById('almRelDropdown').classList.remove('show');
    const mes = document.getElementById('almTodasMes')?.value || new Date().toISOString().slice(0, 7);
    const token = getToken();
    const payload = { _token: token, mes };
    if (tipo === 'excel') {
      payload.action = 'alm_excel_observacoes';
    } else {
      payload.action = 'alm_pdf_observacoes';
      if (tipo === 'pdf-landscape') payload.landscape = true;
    }
    try {
      const r = await fetch(DIPLOMAS_FN, {
        method: 'POST',
        headers: { 'Content-Type':'application/json','apikey':ANON,'Authorization':'Bearer '+ANON },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(()=>({error:'Falha'}));
        alert('Erro: ' + (j.error || r.status));
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = r.headers.get('Content-Disposition') || '';
      const m = /filename="([^"]+)"/.exec(cd);
      a.download = m ? m[1] : ('relatorio-completo-' + mes + (tipo === 'excel' ? '.xlsx' : '.pdf'));
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch (e) {
      alert('Erro ao gerar relatório: ' + e.message);
    }
  }

  // Close dropdown on click outside
  document.addEventListener('click', function(e) {
    const dd = document.getElementById('almRelDropdown');
    if (dd && !e.target.closest('#almRelDropdown') && !e.target.closest('[onclick*="almRelDropdown"]')) {
      dd.classList.remove('show');
    }
  });

  async function loadPesquisasPanel() {
    const d = await apiDiplomas({ action:'pesquisa_list' });
    const pesquisas = Array.isArray(d) ? d : [];
    document.getElementById('pesquisasCount').textContent = pesquisas.length;
    const el = document.getElementById('pesquisasContent');
    if (!pesquisas.length) { el.innerHTML = '<div class="empty-state">Nenhuma pesquisa criada.</div>'; return; }
    el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Título</th><th>Tipo</th><th>Status</th><th>Limite</th><th>Ações</th></tr></thead><tbody>' +
      pesquisas.map(p => `<tr>
        <td><strong>${esc(p.titulo)}</strong></td>
        <td><span style="font-size:12px;text-transform:capitalize;">${esc(p.tipo)}</span></td>
        <td>${p.ativo ? '<span class="status-pill" style="background:rgba(45,122,58,.1);color:var(--green);">Ativa</span>' : '<span class="status-pill" style="background:rgba(200,16,46,.1);color:var(--red);">Inativa</span>'}</td>
        <td style="font-size:12px;color:var(--muted);">${p.data_limite ? new Date(p.data_limite+'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
        <td><button class="action-btn" onclick="verResultadosPesquisa('${p.id}')">📊</button>
        <button class="action-btn del" onclick="deletarPesquisa('${p.id}')">🗑️</button></td>
      </tr>`).join('') + '</tbody></table></div>';
  }

  function showPesquisaForm() { document.getElementById('pesquisaFormWrap').style.display='block'; document.getElementById('pesquisaId').value=''; document.getElementById('pesquisaTitulo').value=''; document.getElementById('pesquisaDesc').value=''; }
  function cancelarPesquisa() { document.getElementById('pesquisaFormWrap').style.display='none'; }

  async function salvarPesquisa() {
    const titulo = document.getElementById('pesquisaTitulo').value.trim();
    if (!titulo) return showToast('Título obrigatório','error');
    const d = await apiDiplomas({ action:'pesquisa_create', titulo, tipo: document.getElementById('pesquisaTipo').value, descricao: document.getElementById('pesquisaDesc').value, data_limite: document.getElementById('pesquisaLimite').value || null });
    if (d.error) return showToast(d.error,'error');
    showToast('Pesquisa criada!');
    cancelarPesquisa();
    loadPesquisasPanel();
  }

  async function deletarPesquisa(id) { if (!await _lumiedConfirm('Excluir?')) return; await apiDiplomas({ action:'pesquisa_delete', id }); loadPesquisasPanel(); }

  async function verResultadosPesquisa(id) {
    const d = await apiDiplomas({ action:'pesquisa_resultados', pesquisa_id: id });
    alert('Total de respondentes: ' + (d.total_respondentes || 0) + '\nPerguntas: ' + (d.perguntas?.length || 0) + '\nRespostas: ' + (d.respostas?.length || 0));
  }

  // ═══════════════════════════════════════════════════════════
  //  MATRÍCULA ONLINE
  // ═══════════════════════════════════════════════════════════
  async function loadMatriculaForms() {
    const d = await api({ action:'matricula_formulario_get', ano: new Date().getFullYear(), tipo:'nova' });
    const el = document.getElementById('matriculaFormContent');
    if (!d || !d.campos?.length) { el.innerHTML = '<div class="empty-state">Nenhum formulário configurado para este ano.</div>'; return; }
    el.innerHTML = `<div class="form-card"><div class="sec-title">${esc(d.titulo || 'Formulário')}</div>
      <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">${d.campos.length} campos configurados</p>
      <div style="overflow-x:auto;"><table><thead><tr><th>Campo</th><th>Tipo</th><th>Obrigatório</th></tr></thead><tbody>
      ${d.campos.map(c => `<tr><td>${esc(c.label || c.nome)}</td><td>${esc(c.tipo)}</td><td>${c.obrigatorio ? '✅' : '—'}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  async function loadMatriculaStatus() {
    const status = document.getElementById('matStatusFiltro')?.value || '';
    const d = await api({ action:'matricula_status_list', ano: new Date().getFullYear(), status: status || undefined });
    const mats = Array.isArray(d) ? d : [];
    document.getElementById('matStatusCount').textContent = mats.length;
    const el = document.getElementById('matStatusContent');
    if (!mats.length) { el.innerHTML = '<div class="empty-state">Nenhuma matrícula encontrada.</div>'; return; }
    const statusColors = { reserva:'background:rgba(212,131,10,.1);color:#c27800;', matriculado:'background:rgba(45,122,58,.1);color:var(--green);', cancelado:'background:rgba(200,16,46,.1);color:var(--red);' };
    el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Criança</th><th>Série</th><th>Responsável</th><th>Status</th><th>Docs</th></tr></thead><tbody>' +
      mats.map(m => `<tr>
        <td><strong>${esc(m.nome_crianca)}</strong></td>
        <td>${esc(m.serie || '—')}</td>
        <td>${esc(m.nome_responsavel || '—')}<br><span style="font-size:11px;color:var(--muted);">${esc(m.email || '')}</span></td>
        <td><span class="status-pill" style="${statusColors[m.status] || ''}">${esc(m.status)}</span></td>
        <td>${(m.matricula_documentos || []).length > 0 ? '📎 '+m.matricula_documentos.length : '—'}</td>
      </tr>`).join('') + '</tbody></table></div>';
  }

  // ═══════════════════════════════════════════════════════════
  //  ACADÊMICO — NOTAS / BOLETIM
  // ═══════════════════════════════════════════════════════════
  var ACADEMICO = SUPABASE_URL + '/functions/v1/academico';
  async function apiAcademico(body) {
    const token = getToken();
    const r = await fetch(ACADEMICO, {
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':ANON,'Authorization':'Bearer '+ANON},
      body: JSON.stringify({...body, _token: token})
    });
    return r.json();
  }

  // ── Config Notas ──
  async function loadNotasConfig() {
    const d = await apiAcademico({ action:'notas_config_get' });
    if (d.error) return;
    document.getElementById('ncTipo').value = d.tipo_avaliacao || 'numerico';
    document.getElementById('ncFormula').value = d.formula_media || 'aritmetica';
    document.getElementById('ncMedia').value = d.media_aprovacao || 7;
    document.getElementById('ncPeriodos').value = d.periodos_tipo || 'bimestral';
    document.getElementById('ncRecup').value = d.permite_recuperacao !== false ? 'true' : 'false';
    document.getElementById('ncPesoRecup').value = (d.peso_recuperacao || 0.4) * 100;
  }

  async function salvarNotasConfig() {
    const d = await apiAcademico({
      action:'notas_config_update',
      tipo_avaliacao: document.getElementById('ncTipo').value,
      formula_media: document.getElementById('ncFormula').value,
      media_aprovacao: parseFloat(document.getElementById('ncMedia').value) || 7,
      periodos_tipo: document.getElementById('ncPeriodos').value,
      permite_recuperacao: document.getElementById('ncRecup').value === 'true',
      peso_recuperacao: (parseFloat(document.getElementById('ncPesoRecup').value) || 40) / 100
    });
    if (d.error) return showToast(d.error, 'error');
    showToast('Configuração salva!', 'success');
  }

  // ── Períodos ──
  async function loadNotasPeriodos() {
    const ano = new Date().getFullYear();
    const d = await apiAcademico({ action:'notas_periodos_list', ano });
    const periodos = Array.isArray(d) ? d : [];
    document.getElementById('periodoCount').textContent = periodos.length;
    const tbody = document.getElementById('periodosBody');
    if (!periodos.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum período cadastrado</td></tr>'; return; }
    tbody.innerHTML = periodos.map(p => `<tr>
      <td><strong>${esc(p.nome)}</strong></td>
      <td>${p.numero}</td>
      <td>${p.ano}</td>
      <td>${p.data_inicio ? new Date(p.data_inicio+'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
      <td>${p.data_fim ? new Date(p.data_fim+'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
      <td><button class="action-btn" onclick="editarPeriodo('${p.id}')">✏️</button>
      <button class="action-btn del" onclick="deletarPeriodo('${p.id}')">🗑️</button></td>
    </tr>`).join('');
  }

  var _periodos = [];
  function showPeriodoForm() {
    document.getElementById('periodoEditId').value = '';
    document.getElementById('periodoNome').value = '';
    document.getElementById('periodoNum').value = '';
    document.getElementById('periodoAno').value = new Date().getFullYear();
    document.getElementById('periodoInicio').value = '';
    document.getElementById('periodoFim').value = '';
    document.getElementById('periodoFormWrap').style.display = 'block';
  }
  function cancelarPeriodo() { document.getElementById('periodoFormWrap').style.display = 'none'; }

  async function editarPeriodo(id) {
    const d = await apiAcademico({ action:'notas_periodos_list', ano: new Date().getFullYear() });
    const p = (Array.isArray(d) ? d : []).find(x => x.id === id);
    if (!p) return;
    document.getElementById('periodoEditId').value = p.id;
    document.getElementById('periodoNome').value = p.nome;
    document.getElementById('periodoNum').value = p.numero;
    document.getElementById('periodoAno').value = p.ano;
    document.getElementById('periodoInicio').value = p.data_inicio || '';
    document.getElementById('periodoFim').value = p.data_fim || '';
    document.getElementById('periodoFormWrap').style.display = 'block';
  }

  async function salvarPeriodo() {
    const id = document.getElementById('periodoEditId').value;
    const data = {
      nome: document.getElementById('periodoNome').value.trim(),
      numero: parseInt(document.getElementById('periodoNum').value) || 1,
      ano: parseInt(document.getElementById('periodoAno').value) || new Date().getFullYear(),
      data_inicio: document.getElementById('periodoInicio').value || null,
      data_fim: document.getElementById('periodoFim').value || null
    };
    if (!data.nome) return showToast('Nome obrigatório', 'error');
    const d = id
      ? await apiAcademico({ action:'notas_periodos_update', id, ...data })
      : await apiAcademico({ action:'notas_periodos_create', ...data });
    if (d.error) return showToast(d.error, 'error');
    showToast(id ? 'Período atualizado!' : 'Período criado!');
    cancelarPeriodo();
    loadNotasPeriodos();
  }

  async function deletarPeriodo(id) {
    if (!await _lumiedConfirm('Excluir este período?')) return;
    const d = await apiAcademico({ action:'notas_periodos_delete', id });
    if (d.error) return showToast(d.error, 'error');
    showToast('Período excluído');
    loadNotasPeriodos();
  }

  // ── Disciplinas ──
  async function loadNotasDisciplinas() {
    const [dRes, sRes, pRes] = await Promise.all([
      apiAcademico({ action:'notas_disciplinas_list' }),
      api({ action:'series_list' }),
      api({ action:'professoras_list' })
    ]);
    const discs = Array.isArray(dRes) ? dRes : [];
    const series = Array.isArray(sRes) ? sRes : (sRes.data || []);
    const profs = Array.isArray(pRes) ? pRes : (pRes.data || []);
    document.getElementById('discCount').textContent = discs.length;

    // Populate selects
    document.getElementById('discSerie').innerHTML = '<option value="">—</option>' + series.map(s => `<option value="${s.id}">${esc(s.nome)}</option>`).join('');
    document.getElementById('discProf').innerHTML = '<option value="">—</option>' + profs.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');

    const tbody = document.getElementById('discBody');
    if (!discs.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhuma disciplina</td></tr>'; return; }
    tbody.innerHTML = discs.map(d => `<tr>
      <td><strong>${esc(d.nome)}</strong></td>
      <td>${d.series?.nome || '—'}</td>
      <td>${d.professoras?.nome || '—'}</td>
      <td>${d.carga_horaria || 0}h</td>
      <td><button class="action-btn" onclick="editarDisc('${d.id}')">✏️</button>
      <button class="action-btn del" onclick="deletarDisc('${d.id}')">🗑️</button></td>
    </tr>`).join('');
  }

  var _discs = [];
  function showDiscForm() {
    document.getElementById('discId').value = '';
    document.getElementById('discNome').value = '';
    document.getElementById('discSerie').value = '';
    document.getElementById('discProf').value = '';
    document.getElementById('discCarga').value = 4;
    document.getElementById('discFormWrap').style.display = 'block';
  }
  function cancelarDisc() { document.getElementById('discFormWrap').style.display = 'none'; }

  async function editarDisc(id) {
    const d = await apiAcademico({ action:'notas_disciplinas_list' });
    const disc = (Array.isArray(d) ? d : []).find(x => x.id === id);
    if (!disc) return;
    document.getElementById('discId').value = disc.id;
    document.getElementById('discNome').value = disc.nome;
    document.getElementById('discSerie').value = disc.serie_id || '';
    document.getElementById('discProf').value = disc.professor_id || '';
    document.getElementById('discCarga').value = disc.carga_horaria || 0;
    document.getElementById('discFormWrap').style.display = 'block';
  }

  async function salvarDisc() {
    const id = document.getElementById('discId').value;
    const data = {
      nome: document.getElementById('discNome').value.trim(),
      serie_id: document.getElementById('discSerie').value || null,
      professor_id: document.getElementById('discProf').value || null,
      carga_horaria: parseInt(document.getElementById('discCarga').value) || 0
    };
    if (!data.nome) return showToast('Nome obrigatório', 'error');
    const d = id
      ? await apiAcademico({ action:'notas_disciplinas_update', id, ...data })
      : await apiAcademico({ action:'notas_disciplinas_create', ...data });
    if (d.error) return showToast(d.error, 'error');
    showToast(id ? 'Disciplina atualizada!' : 'Disciplina criada!');
    cancelarDisc();
    loadNotasDisciplinas();
  }

  async function deletarDisc(id) {
    if (!await _lumiedConfirm('Desativar esta disciplina?')) return;
    const d = await apiAcademico({ action:'notas_disciplinas_delete', id });
    if (d.error) return showToast(d.error, 'error');
    showToast('Disciplina desativada');
    loadNotasDisciplinas();
  }

  // ── Visão Geral de Notas ──
  async function initNotasVisao() {
    const [sRes, pRes, dRes] = await Promise.all([
      api({ action:'series_list' }),
      apiAcademico({ action:'notas_periodos_list', ano: new Date().getFullYear() }),
      apiAcademico({ action:'notas_disciplinas_list' })
    ]);
    const series = Array.isArray(sRes) ? sRes : (sRes.data || []);
    const periodos = Array.isArray(pRes) ? pRes : [];
    const discs = Array.isArray(dRes) ? dRes : [];

    document.getElementById('nvSerie').innerHTML = '<option value="">Série...</option>' + series.map(s => `<option value="${s.id}">${esc(s.nome)}</option>`).join('');
    document.getElementById('nvPeriodo').innerHTML = '<option value="">Período...</option>' + periodos.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
    document.getElementById('nvDisc').innerHTML = '<option value="">Disciplina...</option>' + discs.map(d => `<option value="${d.id}">${esc(d.nome)}</option>`).join('');
  }

  async function loadNotasVisao() {
    const serieId = document.getElementById('nvSerie').value;
    const periodoId = document.getElementById('nvPeriodo').value;
    const discId = document.getElementById('nvDisc').value;
    if (!serieId || !periodoId || !discId) return;

    const content = document.getElementById('notasVisaoContent');
    content.innerHTML = '<div class="spinner-sm"></div> Carregando...';

    // Buscar avaliações desta disciplina/período
    const [avRes, alRes] = await Promise.all([
      apiAcademico({ action:'notas_avaliacoes_list', disciplina_id: discId, periodo_id: periodoId }),
      apiAcademico({ action:'notas_alunos_serie', serie_id: serieId })
    ]);
    const avaliacoes = Array.isArray(avRes) ? avRes : [];
    const alunos = Array.isArray(alRes) ? alRes : [];

    if (!avaliacoes.length) { content.innerHTML = '<div class="empty-state">Nenhuma avaliação cadastrada para esta disciplina/período.</div>'; return; }
    if (!alunos.length) { content.innerHTML = '<div class="empty-state">Nenhum aluno encontrado nesta série.</div>'; return; }

    // Buscar notas de todas as avaliações
    const notasMap = {};
    for (const av of avaliacoes) {
      const nRes = await apiAcademico({ action:'notas_lancamentos_list', avaliacao_id: av.id });
      for (const n of (Array.isArray(nRes) ? nRes : [])) {
        if (!notasMap[n.aluno_email]) notasMap[n.aluno_email] = {};
        notasMap[n.aluno_email][av.id] = n;
      }
    }

    // Renderizar tabela
    let html = '<div class="table-wrap"><table><thead><tr><th>Aluno</th>';
    for (const av of avaliacoes) html += `<th title="${esc(av.nome)}">${esc(av.nome)} (${av.peso}x)</th>`;
    html += '<th>Média</th></tr></thead><tbody>';

    for (const al of alunos) {
      html += `<tr><td><strong>${esc(al.nome_aluno)}</strong></td>`;
      let soma = 0, count = 0;
      for (const av of avaliacoes) {
        const nota = notasMap[al.email]?.[av.id];
        const val = nota?.valor ?? nota?.conceito ?? '—';
        html += `<td>${val}</td>`;
        if (nota?.valor !== null && nota?.valor !== undefined && av.tipo !== 'recuperacao') { soma += nota.valor; count++; }
      }
      const media = count > 0 ? (soma / count).toFixed(1) : '—';
      const mediaClass = count > 0 && parseFloat(media) >= 7 ? 'color:var(--green);font-weight:700;' : count > 0 ? 'color:var(--red);font-weight:700;' : '';
      html += `<td style="${mediaClass}">${media}</td></tr>`;
    }
    html += '</tbody></table></div>';
    content.innerHTML = html;
  }

