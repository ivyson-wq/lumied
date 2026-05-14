// Auto-extraído do gerente.html (Onda 4 — batch).
// Atividades CRUD — inscrições, dashboard, contas a receber, exportar PDF
  // ── ATIVIDADES ────────────────────────────────────────
  async function loadAtividadesPanel() {
    await Promise.all([ loadAtividadesCRUD(), loadInscricoesAtividades(), loadAlmocoConfig(), loadContasAtiv() ]);
  }
  async function loadAlmocoConfig() {
    const d = await api({ action:'config_get', chave:'almoco_preco' });
    const el = document.getElementById('almocoPreco');
    if (el) el.value = d?.valor || '50.00';
  }

  async function loadAtividadesCRUD() {
    const data = await api({ action:'atividades_list_all' });
    const list = Array.isArray(data)?data:[];
    document.getElementById('atividadesCount').textContent = list.length;
    const el = document.getElementById('atividadesList');
    if (!list.length) { el.innerHTML='<div class="list-row"><span style="color:var(--muted);font-size:13px;">Nenhuma atividade cadastrada.</span></div>'; return; }
    el.innerHTML = list.map(a=>{
      const turmaInfo = (a.horarios||[]).map(t => {
        const inscritos = t.inscritos||0;
        const vagas = t.vagas ?? '∞';
        const disponiveis = t.vagas_disponiveis ?? '∞';
        const cor = disponiveis===0?'#a00d24':disponiveis<=3?'#d4830a':'#2d7a3a';
        return `<span style="font-size:10px;background:#f5f0ea;border-radius:100px;padding:2px 8px;color:${cor};font-weight:500;">${esc(t.turma)}: ${inscritos}/${vagas}</span>`;
      }).join(' ');
      return `
      <div class="list-row">
        <span class="ativ-color-dot" style="background:${a.cor||'#C8102E'}"></span>
        <div class="lr-main">
          <strong>${esc(a.nome)}</strong>
          <span>R$ ${Number(a.preco).toFixed(2).replace('.',',')} · ${a.ativo?'Ativa':'Inativa'} · ${a.cobranca_pela_escola!==false?'<span style="color:#2d7a3a;">Cobrado pela escola</span>':'<span style="color:#b07d00;">Cobrado pela empresa</span>'}${a.valor_repasse_aluno ? ` · Repasse: R$ ${Number(a.valor_repasse_aluno).toFixed(2).replace('.',',')}/aluno` : ''}</span>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${turmaInfo}</div>
        </div>
        <button class="action-btn" onclick="openAtivEdit('${a.id}')">✎ Editar</button>
        <button class="action-btn" onclick="toggleAtivStatus('${a.id}',${!a.ativo})">${a.ativo?'Desativar':'Ativar'}</button>
        <button class="action-btn del" onclick="deleteAtividade('${a.id}','${esc(a.nome)}')">🗑</button>
      </div>`;
    }).join('');
  }

  // ── Modal: Nova inscrição em atividade ──────────────
  var _iaAlunosCache = [];
  var _iaAtivCache = [];

  async function abrirInscricaoAtivModal() {
    document.getElementById('iaAlunoBusca').value = '';
    document.getElementById('iaNovoNome').value = '';
    document.getElementById('iaNovoResp').value = '';
    document.getElementById('iaNovoEmail').value = '';
    document.querySelector('input[name="iaAlunoModo"][value="existente"]').checked = true;
    iaAlunoModoChange();
    document.getElementById('iaErr').style.display = 'none';
    document.getElementById('iaOk').style.display = 'none';

    // Carrega alunos + atividades + séries em paralelo
    const [a, at, s] = await Promise.all([
      api({ action: 'alunos_list', somente_ativos: true }),
      api({ action: 'atividades_list_all' }),
      api({ action: 'series_list_all' }),
    ]);
    _iaAlunosCache = (Array.isArray(a) ? a : (a?.data || [])).filter(x => x.ativo !== false);
    _iaAtivCache = (Array.isArray(at) ? at : (at?.data || [])).filter(x => x.ativo !== false);
    iaFiltrarAlunos();
    // Séries no select de aluno novo
    const sSel = document.getElementById('iaNovoSerie');
    sSel.innerHTML = '<option value="">—</option>' + (Array.isArray(s) ? s : []).map(x => `<option value="${esc(x.nome)}">${esc(x.nome)}</option>`).join('');
    // Atividades como checkboxes
    const ativEl = document.getElementById('iaAtividadesList');
    if (!_iaAtivCache.length) {
      ativEl.innerHTML = '<div style="padding:10px;text-align:center;color:var(--muted);font-size:12px;">Nenhuma atividade cadastrada.</div>';
    } else {
      ativEl.innerHTML = _iaAtivCache.map(at => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;border-bottom:1px solid #f5f0ea;">
          <input type="checkbox" class="ia-ativ-chk" value="${at.id}" data-nome="${esc(at.nome)}" style="width:16px;height:16px;">
          <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${at.cor || '#C8102E'};"></span>
          <span style="flex:1;font-size:13px;">${esc(at.nome)}</span>
          <span style="font-size:11px;color:var(--muted);">${at.preco ? 'R$ ' + Number(at.preco).toFixed(2) : ''}</span>
        </label>
      `).join('');
    }
    document.getElementById('inscricaoAtivModal').style.display = 'block';
  }
  function fecharInscricaoAtivModal() { document.getElementById('inscricaoAtivModal').style.display = 'none'; }
  function iaAlunoModoChange() {
    const modo = document.querySelector('input[name="iaAlunoModo"]:checked').value;
    document.getElementById('iaBlocoExistente').style.display = modo === 'existente' ? '' : 'none';
    document.getElementById('iaBlocoNovo').style.display = modo === 'novo' ? '' : 'none';
  }
  function iaFiltrarAlunos() {
    const q = (document.getElementById('iaAlunoBusca').value || '').toLowerCase();
    const sel = document.getElementById('iaAlunoSelect');
    const lista = !q ? _iaAlunosCache : _iaAlunosCache.filter(a => (a.nome || '').toLowerCase().includes(q));
    sel.innerHTML = lista.slice(0, 100).map(a => `<option value="${a.id}">${esc(a.nome)}${a.serie || a.turma ? ' — ' + esc(a.serie || a.turma) : ''}${a.responsavel_nome || a.resp_nome ? ' (' + esc(a.responsavel_nome || a.resp_nome) + ')' : ''}</option>`).join('');
  }
  async function salvarInscricaoAtiv() {
    const errEl = document.getElementById('iaErr'); const okEl = document.getElementById('iaOk');
    errEl.style.display = 'none'; okEl.style.display = 'none';
    const modo = document.querySelector('input[name="iaAlunoModo"]:checked').value;
    const ativIds = Array.from(document.querySelectorAll('.ia-ativ-chk:checked')).map(c => c.value);
    if (!ativIds.length) { errEl.textContent = 'Selecione ao menos uma atividade.'; errEl.style.display = 'block'; return; }
    const payload = { action: 'inscricao_atividade_admin', atividades_ids: ativIds, turmas_selecionadas: [] };
    if (modo === 'existente') {
      const id = document.getElementById('iaAlunoSelect').value;
      if (!id) { errEl.textContent = 'Selecione um aluno.'; errEl.style.display = 'block'; return; }
      payload.aluno_id = id;
    } else {
      const nome = document.getElementById('iaNovoNome').value.trim();
      if (!nome) { errEl.textContent = 'Informe o nome do aluno.'; errEl.style.display = 'block'; return; }
      payload.novo_aluno = {
        nome,
        responsavel_nome: document.getElementById('iaNovoResp').value.trim() || undefined,
        email: document.getElementById('iaNovoEmail').value.trim() || undefined,
        serie: document.getElementById('iaNovoSerie').value || undefined,
      };
    }
    const d = await api(payload);
    if (d.error) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }
    okEl.textContent = '✅ Inscrição salva.';
    okEl.style.display = 'block';
    setTimeout(() => { fecharInscricaoAtivModal(); loadInscricoesAtividades(); }, 1500);
  }

  async function loadInscricoesAtividades() {
    const data = await api({ action:'inscricoes_atividades_list' });
    const list = Array.isArray(data)?data:[];
    document.getElementById('atInscricoesCount').textContent = list.length;

    // Contagem por dia
    const dc = {Segunda:0,'Terça':0,Quarta:0,Quinta:0,Sexta:0};
    list.forEach(ins => {
      (ins.atividades_detalhe||[]).forEach(a => {
        (a.horarios||[]).forEach(h => { if(dc[h.dia]!==undefined) dc[h.dia]++; });
      });
    });
    ['Segunda','Terça','Quarta','Quinta','Sexta'].forEach(dia => {
      const el = document.getElementById('aDia_'+dia);
      if (el) el.textContent = dc[dia];
    });

    const tb = document.getElementById('atInscricoesBody');
    if (!list.length) { tb.innerHTML='<tr><td colspan="6" class="empty-state">📭 Nenhuma inscrição.</td></tr>'; return; }
    tb.innerHTML = list.map(ins => {
      const pills = (ins.atividades_detalhe||[]).map(a=>
        `<span style="display:inline-block;background:rgba(200,16,46,.08);color:#C8102E;border-radius:100px;padding:2px 8px;font-size:10px;font-weight:600;margin:1px;">${esc(a.nome)}</span>`
      ).join(' ');
      const date = new Date(ins.criado_em).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
      return `<tr>
        <td><strong>${esc(ins.nome_crianca)}</strong></td>
        <td>${esc(ins.nome_resp)}<br><small style="color:var(--muted)">${esc(ins.email)}</small></td>
        <td>${esc(ins.serie||'—')}</td>
        <td>${pills||'—'}</td>
        <td class="date-cell">${date}</td>
        <td><button class="action-btn del" onclick="deleteInscricaoAtiv('${ins.id}','${esc(ins.nome_crianca)}')">🗑</button></td>
      </tr>`;
    }).join('');
  }

  function addTurmaRow() {
    const container = document.getElementById('turmasContainer');
    const idx = container.children.length + 1;
    const div = document.createElement('div');
    div.className = 'turma-row';
    div.style.cssText = 'border:1.5px solid var(--border);border-radius:9px;padding:12px;margin-bottom:10px;background:#fdfbf8;';
    div.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:12px;font-weight:600;color:var(--red);">Turma ${idx}</span>
        <button class="btn-rm-horario" onclick="this.closest('.turma-row').remove()">✕ Remover</button>
      </div>
      <div class="ff" style="margin-bottom:8px;">
        <label style="font-size:10px;">Nome da turma</label>
        <input type="text" class="turma-nome-input" placeholder="Ex: Turma A — 14h" style="padding:8px 10px;font-size:13px;">
      </div>
      <div class="turma-slots-container"></div>
      <button class="btn-add-horario" type="button" style="font-size:11px;padding:5px 10px;" onclick="addSlotRow(this)">+ Adicionar dia/horário</button>
      <div style="margin-top:12px;padding:10px 12px;background:#f5fcf5;border:1.5px solid rgba(45,122,58,.2);border-radius:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500;color:#1a5c2a;flex:1;">
          <input type="checkbox" class="turma-almoco-check" style="accent-color:#2d7a3a;width:15px;height:15px;">
          🍽️ Oferecer opção de almoço para esta turma
        </label>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;color:var(--muted);">R$</span>
          <input type="number" class="turma-almoco-preco" value="50" min="0" step="0.01" style="width:70px;padding:5px 8px;font-size:12px;border:1.5px solid rgba(45,122,58,.3);border-radius:6px;font-family:'DM Sans',sans-serif;">
          <span style="font-size:11px;color:var(--muted);">/dia</span>
        </div>
      </div>`;
    container.appendChild(div);
    addSlotRow(div.querySelector('.btn-add-horario'));
  }

  function addSlotRow(btn) {
    const container = btn.previousElementSibling;
    const div = document.createElement('div');
    div.className = 'ativ-horario-row';
    div.style.marginBottom = '6px';
    div.innerHTML = `
      <select style="padding:6px 8px;font-size:12px;">
        <option>Segunda</option><option>Terça</option><option>Quarta</option>
        <option>Quinta</option><option>Sexta</option>
      </select>
      <input type="time" value="14:00" style="width:85px;padding:6px 8px;font-size:12px;">
      <span style="font-size:11px;color:var(--muted);">até</span>
      <input type="time" value="15:00" style="width:85px;padding:6px 8px;font-size:12px;">
      <button class="btn-rm-horario" onclick="this.parentElement.remove()">✕</button>`;
    container.appendChild(div);
  }

  function getTurmas() {
    return Array.from(document.querySelectorAll('#turmasContainer .turma-row')).map(row => {
      const nome = row.querySelector('.turma-nome-input').value.trim();
      const almocoCheck = row.querySelector('.turma-almoco-check');
      const almocoPreco = row.querySelector('.turma-almoco-preco');
      const slots = Array.from(row.querySelectorAll('.ativ-horario-row')).map(slotRow => {
        const inputs = slotRow.querySelectorAll('select, input[type="time"]');
        return { dia: inputs[0].value, inicio: inputs[1].value, fim: inputs[2].value };
      });
      return {
        turma: nome, vagas: 15, slots,
        almoco_disponivel: almocoCheck ? almocoCheck.checked : false,
        almoco_preco: almocoPreco ? parseFloat(almocoPreco.value)||50 : 50
      };
    });
  }

  function selectCor(el) {
    document.querySelectorAll('.cor-opt').forEach(o => o.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('newAtivCor').value = el.dataset.cor;
  }

  async function createAtividade() {
    const nome    = document.getElementById('newAtivNome').value.trim();
    const preco   = parseFloat(document.getElementById('newAtivPreco').value)||0;
    const desc    = document.getElementById('newAtivDesc').value.trim();
    const cor     = document.getElementById('newAtivCor').value||'#C8102E';
    const horarios = getTurmas();
    if (!nome) return showAlert('ativ','error','Informe o nome da atividade.');
    if (!horarios.length) return showAlert('ativ','error','Adicione pelo menos uma turma com horários.');
    for (const t of horarios) {
      if (!t.turma) return showAlert('ativ','error','Informe o nome de todas as turmas.');
      if (!t.slots.length) return showAlert('ativ','error','Adicione horários para todas as turmas.');
    }
    const repasse = parseFloat(document.getElementById('newAtivRepasse').value)||0;
    const cobrancaEscola = document.getElementById('newAtivCobrancaEscola').checked;
    const d = await api({ action:'atividades_create', nome, preco, descricao:desc, cor, horarios, ordem:99, valor_repasse_aluno:repasse, cobranca_pela_escola:cobrancaEscola });
    if (d.error) return showAlert('ativ','error',d.error);
    showAlert('ativ','success','✅ Atividade "'+nome+'" criada!');
    document.getElementById('newAtivNome').value='';
    document.getElementById('newAtivPreco').value='';
    document.getElementById('newAtivRepasse').value='';
    document.getElementById('newAtivDesc').value='';
    document.getElementById('turmasContainer').innerHTML='';
    loadAtividadesCRUD();
  }

  async function toggleAtivStatus(id, ativo) {
    await api({ action:'atividades_update', id, ativo });
    loadAtividadesCRUD();
  }
  async function deleteAtividade(id, nome) {
    if (!await _lumiedConfirm('Remover atividade "'+nome+'"?')) return;
    await api({ action:'atividades_delete', id }); loadAtividadesCRUD();
  }
  async function deleteInscricaoAtiv(id, nome) {
    if (!await _lumiedConfirm('Remover inscrição de "'+nome+'"?')) return;
    await api({ action:'inscricoes_atividades_delete', id }); loadInscricoesAtividades();
  }

  // ── EDIÇÃO DE ATIVIDADE ───────────────────────────────
  var editingAtivId = null;

  async function openAtivEdit(id) {
    // Busca dados atuais
    const list = await api({ action:'atividades_list_all' });
    const a = Array.isArray(list) ? list.find(x => x.id === id) : null;
    if (!a) return;
    editingAtivId = id;

    document.getElementById('editAtivNome').value  = a.nome || '';
    document.getElementById('editAtivPreco').value = a.preco || 0;
    document.getElementById('editAtivRepasse').value = a.valor_repasse_aluno || 0;
    document.getElementById('editAtivCobrancaEscola').checked = a.cobranca_pela_escola !== false;
    document.getElementById('editAtivOrdem').value = a.ordem || 99;
    document.getElementById('editAtivDesc').value  = a.descricao || '';
    document.getElementById('editAtivCor').value   = a.cor || '#C8102E';
    document.getElementById('editAtivErr').classList.remove('show');

    // Cor picker
    document.querySelectorAll('#editCorPicker .cor-opt').forEach(el => {
      el.classList.toggle('active', el.dataset.cor === a.cor);
    });

    // Turmas
    const container = document.getElementById('editTurmasContainer');
    container.innerHTML = '';
    (a.horarios||[]).forEach((t, idx) => {
      addEditTurmaRow(t);
    });

    document.getElementById('ativModal').classList.add('show');
  }

  function closeAtivModal() {
    document.getElementById('ativModal').classList.remove('show');
    editingAtivId = null;
  }

  function addEditTurmaRow(turmaData) {
    const container = document.getElementById('editTurmasContainer');
    const idx = container.children.length + 1;
    const div = document.createElement('div');
    div.className = 'turma-row';
    div.style.cssText = 'border:1.5px solid var(--border);border-radius:9px;padding:12px;margin-bottom:10px;background:#fdfbf8;';

    const nomeVal   = turmaData?.turma || '';
    const vagasVal  = turmaData?.vagas ?? 15;
    const inscritos = turmaData?.inscritos ?? 0;

    div.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:12px;font-weight:600;color:var(--red);">Turma ${idx}</span>
        <button class="btn-rm-horario" onclick="this.closest('.turma-row').remove()">✕ Remover</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 120px;gap:10px;margin-bottom:10px;">
        <div class="ff" style="margin:0;"><label style="font-size:10px;">Nome da turma</label>
          <input type="text" class="turma-nome-input" value="${esc(nomeVal)}" placeholder="Ex: Turma A — 14h" style="padding:8px 10px;font-size:13px;"></div>
        <div class="ff" style="margin:0;"><label style="font-size:10px;">Vagas máx.</label>
          <input type="number" class="turma-vagas-input" value="${vagasVal}" min="${inscritos}" style="padding:8px 10px;font-size:13px;">
          ${inscritos>0?`<div style="font-size:10px;color:var(--muted);margin-top:3px;">${inscritos} inscrito(s)</div>`:''}
        </div>
      </div>
      <div class="turma-slots-container"></div>
      <button class="btn-add-horario" type="button" style="font-size:11px;padding:5px 10px;" onclick="addSlotRow(this)">+ Adicionar dia/horário</button>
      <div style="margin-top:12px;padding:10px 12px;background:#f5fcf5;border:1.5px solid rgba(45,122,58,.2);border-radius:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500;color:#1a5c2a;flex:1;">
          <input type="checkbox" class="turma-almoco-check" ${turmaData?.almoco_disponivel?'checked':''} style="accent-color:#2d7a3a;width:15px;height:15px;">
          🍽️ Oferecer opção de almoço para esta turma
        </label>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;color:var(--muted);">R$</span>
          <input type="number" class="turma-almoco-preco" value="${turmaData?.almoco_preco||50}" min="0" step="0.01" style="width:70px;padding:5px 8px;font-size:12px;border:1.5px solid rgba(45,122,58,.3);border-radius:6px;font-family:'DM Sans',sans-serif;">
          <span style="font-size:11px;color:var(--muted);">/dia</span>
        </div>
      </div>`;

    container.appendChild(div);

    // Adiciona slots existentes
    const slotsContainer = div.querySelector('.turma-slots-container');
    const slots = turmaData?.slots || [];
    if (slots.length) {
      slots.forEach(s => {
        const btn = div.querySelector('.btn-add-horario');
        addSlotRowWithData(btn, s.dia, s.inicio, s.fim);
      });
    } else {
      addSlotRow(div.querySelector('.btn-add-horario'));
    }
  }

  function addSlotRowWithData(btn, dia, inicio, fim) {
    const container = btn.previousElementSibling;
    const div = document.createElement('div');
    div.className = 'ativ-horario-row';
    div.style.marginBottom = '6px';
    const dias = ['Segunda','Terça','Quarta','Quinta','Sexta'];
    const opts = dias.map(d => `<option${d===dia?' selected':''}>${d}</option>`).join('');
    div.innerHTML = `
      <select style="padding:6px 8px;font-size:12px;">${opts}</select>
      <input type="time" value="${inicio}" style="width:85px;padding:6px 8px;font-size:12px;">
      <span style="font-size:11px;color:var(--muted);">até</span>
      <input type="time" value="${fim}" style="width:85px;padding:6px 8px;font-size:12px;">
      <button class="btn-rm-horario" onclick="this.parentElement.remove()">✕</button>`;
    container.appendChild(div);
  }

  function selectEditCor(el) {
    document.querySelectorAll('#editCorPicker .cor-opt').forEach(e=>e.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('editAtivCor').value = el.dataset.cor;
  }

  function getEditTurmas() {
    return Array.from(document.querySelectorAll('#editTurmasContainer .turma-row')).map(row => {
      const nome  = row.querySelector('.turma-nome-input').value.trim();
      const vagas = parseInt(row.querySelector('.turma-vagas-input').value) || 15;
      const almocoCheck = row.querySelector('.turma-almoco-check');
      const almocoPreco = row.querySelector('.turma-almoco-preco');
      const slots = Array.from(row.querySelectorAll('.ativ-horario-row')).map(slotRow => {
        const inputs = slotRow.querySelectorAll('select, input[type="time"]');
        return { dia: inputs[0].value, inicio: inputs[1].value, fim: inputs[2].value };
      });
      return {
        turma: nome, vagas, slots,
        almoco_disponivel: almocoCheck ? almocoCheck.checked : false,
        almoco_preco: almocoPreco ? parseFloat(almocoPreco.value) || 50 : 50
      };
    });
  }

  async function saveAtivEdit() {
    const nome    = document.getElementById('editAtivNome').value.trim();
    const preco   = parseFloat(document.getElementById('editAtivPreco').value)||0;
    const ordem   = parseInt(document.getElementById('editAtivOrdem').value)||99;
    const desc    = document.getElementById('editAtivDesc').value.trim();
    const cor     = document.getElementById('editAtivCor').value||'#C8102E';
    const horarios = getEditTurmas();
    const errEl   = document.getElementById('editAtivErr');

    if (!nome) { errEl.textContent='Informe o nome.'; errEl.classList.add('show'); return; }
    if (!horarios.length) { errEl.textContent='Adicione pelo menos uma turma.'; errEl.classList.add('show'); return; }
    for (const t of horarios) {
      if (!t.turma) { errEl.textContent='Informe o nome de todas as turmas.'; errEl.classList.add('show'); return; }
    }

    document.getElementById('btnSaveAtiv').disabled = true;
    const repasse = parseFloat(document.getElementById('editAtivRepasse').value)||0;
    const cobrancaEscola = document.getElementById('editAtivCobrancaEscola').checked;
    const d = await api({ action:'atividades_update_full', id:editingAtivId, nome, preco, descricao:desc, cor, horarios, ordem, valor_repasse_aluno:repasse, cobranca_pela_escola:cobrancaEscola });
    document.getElementById('btnSaveAtiv').disabled = false;

    if (d.error) { errEl.textContent=d.error; errEl.classList.add('show'); return; }
    closeAtivModal();
    loadAtividadesCRUD();
  }

  // ── CONTAS A RECEBER ATIVIDADES ──────────────────────
  (function() {
    const el = document.getElementById('ativContasMes');
    if (el) el.value = new Date().toISOString().slice(0, 7);
  })();

  async function loadContasAtiv() {
    const mes = document.getElementById('ativContasMes')?.value || new Date().toISOString().slice(0, 7);
    const data = await api({ action: 'atividades_contas_list', mes });
    const list = Array.isArray(data) ? data : [];
    const el = document.getElementById('ativContasContent');
    if (!list.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0;">Nenhuma conta para este mês. Clique "Apurar Mês" para gerar.</div>'; return; }
    const total = list.reduce((s, c) => s + (c.valor_total || 0), 0);
    const STATUS = { pendente: '⏳ Pendente', pago: '✅ Pago', cancelado: '❌ Cancelado', atrasado: '🔴 Atrasado' };
    el.innerHTML = `
      <div style="display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap;">
        <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 18px;"><div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Total a Receber</div><div style="font-size:22px;font-weight:700;color:#d4830a;">R$ ${total.toFixed(2).replace('.',',')}</div></div>
        <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 18px;"><div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Atividades</div><div style="font-size:22px;font-weight:700;">${list.length}</div></div>
        <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 18px;"><div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Vencimento</div><div style="font-size:16px;font-weight:700;">${list[0]?.data_vencimento ? new Date(list[0].data_vencimento+'T12:00:00').toLocaleDateString('pt-BR') : '—'}</div></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Atividade</th><th>Alunos</th><th>Valor/Aluno</th><th>Total</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>${list.map(c => `<tr>
          <td><strong>${esc(c.atividade_nome)}</strong></td>
          <td>${c.qtd_alunos}</td>
          <td>R$ ${Number(c.valor_por_aluno).toFixed(2).replace('.',',')}</td>
          <td><strong>R$ ${Number(c.valor_total).toFixed(2).replace('.',',')}</strong></td>
          <td><span style="font-size:11px;">${STATUS[c.status]||c.status}</span></td>
          <td>${c.status==='pendente'?`<button class="action-btn" onclick="marcarContaPaga('${c.id}')">✅ Pago</button><button class="action-btn del" onclick="cancelarConta('${c.id}')">✕</button>`:c.data_pagamento?new Date(c.data_pagamento+'T12:00:00').toLocaleDateString('pt-BR'):''}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  }

  async function apurarContasAtiv() {
    const mes = document.getElementById('ativContasMes')?.value || new Date().toISOString().slice(0, 7);
    const d = await api({ action: 'atividades_apurar_mes', mes });
    if (d.error) return showToast(d.error, 'error');
    showToast(`Apuração concluída: ${d.gerados} atividade(s), vencimento ${new Date(d.vencimento+'T12:00:00').toLocaleDateString('pt-BR')}.`, 'success', 5000);
    loadContasAtiv();
  }

  async function marcarContaPaga(id) {
    await api({ action: 'atividades_conta_pagar', id });
    showToast('Marcado como pago!', 'success');
    loadContasAtiv();
  }

  async function cancelarConta(id) {
    if (!await _lumiedConfirm('Cancelar esta conta a receber?')) return;
    await api({ action: 'atividades_conta_cancelar', id });
    loadContasAtiv();
  }

  // ── DASHBOARD ATIVIDADES ──────────────────────────────
  var allInscricoesAtiv = [];

  async function loadAtivDashboard() {
    console.log('[ATIV] loadAtivDashboard chamada');
    const [alunosRaw, atividades] = await Promise.all([
      api({ action:'alunos_list' }),
      api({ action:'atividades_list_all' })
    ]);
    console.log('[ATIV] alunosRaw type:', typeof alunosRaw, Array.isArray(alunosRaw), 'atividades type:', typeof atividades, Array.isArray(atividades));

    const todosAlunos = Array.isArray(alunosRaw) ? alunosRaw : (alunosRaw.data || []);
    console.log('[ATIV] todosAlunos:', todosAlunos.length, 'com ativ:', todosAlunos.filter(a => a.atividades_ids && a.atividades_ids.length).length);
    if (todosAlunos.length > 0) console.log('[ATIV] sample aluno:', JSON.stringify({nome: todosAlunos[0].nome, atividades_ids: todosAlunos[0].atividades_ids, turmas_sel: todosAlunos[0].turmas_selecionadas?.length}));
    // Filtra alunos com atividades e mapeia para formato esperado
    allInscricoesAtiv = todosAlunos.filter(a => a.atividades_ids && a.atividades_ids.length).map(a => ({
      id: a.id, nome_crianca: a.nome, email: a.email,
      nome_resp: a.responsavel_nome || a.resp_nome || '',
      serie: a.serie || a.turma || '',
      atividades_ids: a.atividades_ids,
      turmas_selecionadas: a.turmas_selecionadas,
      almoco_dias: a.almoco_dias, criado_em: a.criado_em,
    }));
    const todasAtiv   = Array.isArray(atividades)  ? atividades  : [];

    // ── Stats gerais ──
    const totalInscritos = allInscricoesAtiv.length;
    const ativasComVaga  = todasAtiv.filter(a => a.ativo && (a.horarios||[]).some(t => (t.vagas_disponiveis??999) > 0)).length;
    const turmasLotadas  = todasAtiv.reduce((acc, a) => acc + (a.horarios||[]).filter(t => t.vagas!=null && (t.vagas_disponiveis??999) === 0).length, 0);
    const vagasTotal     = todasAtiv.reduce((acc, a) => acc + (a.horarios||[]).reduce((s, t) => s + (t.vagas_disponiveis??0), 0), 0);

    document.getElementById('atTotal').textContent   = totalInscritos;
    document.getElementById('atAtivas').textContent  = ativasComVaga;
    document.getElementById('atLotadas').textContent = turmasLotadas;
    document.getElementById('atVagas').textContent   = vagasTotal;

    // ── Crianças por dia — subagrupadas por atividade e turma ──
    const DIAS = ['Segunda','Terça','Quarta','Quinta','Sexta'];
    // diasMap[dia][atividade_nome][turma_nome] = [criança, ...]
    const diasMap = {};
    DIAS.forEach(d => diasMap[d] = { manha: {}, tarde: {} });

    // Monta mapa de horários das atividades para resolver slots vazios
    // Usa chave normalizada (sem zero à esquerda) para matching flexível
    const ativHorariosMap = {};
    function normTurma(t) { return (t||'').replace(/\b0(\d)/g, '$1'); }
    todasAtiv.forEach(a => {
      (a.horarios||[]).forEach(h => {
        ativHorariosMap[a.id + '|' + normTurma(h.turma)] = h;
      });
    });

    // diasMap[dia][periodo][atividade_nome][turma_nome] = [criança, ...]
    // periodo = 'manha' ou 'tarde'
    allInscricoesAtiv.forEach(ins => {
      (ins.turmas_selecionadas||[]).forEach(ts => {
        const ativ = todasAtiv.find(a => a.id === ts.atividade_id);
        const ativNome = ativ?.nome || 'Atividade';
        const turmaNome = ts.turma || 'Turma';
        // Resolve slots: usa os da inscrição, ou busca nos horários da atividade (matching flexível)
        let slots = ts.slots && ts.slots.length ? ts.slots : null;
        if (!slots) {
          const horario = ativHorariosMap[ts.atividade_id + '|' + normTurma(turmaNome)];
          slots = horario?.slots || [];
        }
        slots.forEach(slot => {
          if (!diasMap[slot.dia]) return;
          // Determina período pela hora de início
          const hora = parseInt((slot.inicio||'12:00').split(':')[0]);
          const periodo = hora < 12 ? 'manha' : 'tarde';
          if (!diasMap[slot.dia][periodo]) diasMap[slot.dia][periodo] = {};
          if (!diasMap[slot.dia][periodo][ativNome]) diasMap[slot.dia][periodo][ativNome] = {};
          if (!diasMap[slot.dia][periodo][ativNome][turmaNome]) diasMap[slot.dia][periodo][ativNome][turmaNome] = [];
          diasMap[slot.dia][periodo][ativNome][turmaNome].push({ nome: ins.nome_crianca, serie: ins.serie });
        });
      });
    });

    const ativDiaCounts = [];
    DIAS.forEach(dia => {
      const criancasNoDia = new Set();
      ['manha','tarde'].forEach(p => {
        Object.values(diasMap[dia][p]||{}).forEach(turmas =>
          Object.values(turmas).forEach(lista => lista.forEach(c => criancasNoDia.add(c.nome)))
        );
      });
      const count = criancasNoDia.size;
      ativDiaCounts.push(count);
      document.getElementById('adCount_'+dia).textContent = count;
      const listEl = document.getElementById('adList_'+dia);
      if (!count) { listEl.innerHTML = '<div class="dia-vazio">Nenhuma criança</div>'; return; }

      let html = '';
      [['manha','☀️ Manhã','#e67e22'],['tarde','🌙 Tarde','#1a6bb5']].forEach(([periodo, label, cor]) => {
        const atividades = Object.entries(diasMap[dia][periodo]||{});
        if (!atividades.length) return;
        const totalPeriodo = atividades.reduce((s,[,turmas]) => s + Object.values(turmas).reduce((s2,l) => s2+l.length, 0), 0);
        html += `<div style="margin-bottom:12px;">
          <div style="font-size:11px;font-weight:700;color:${cor};margin-bottom:8px;padding:4px 8px;background:${cor}11;border-radius:6px;display:flex;align-items:center;gap:6px;">
            ${label} <span style="font-weight:500;font-size:10px;color:var(--muted);">(${totalPeriodo})</span>
          </div>`;
        html += atividades.map(([ativNome, turmas]) => {
          const turmasHTML = Object.entries(turmas).map(([turmaNome, criancas]) => {
            const criancasHTML = criancas.map(c =>
              `<div class="dia-crianca-item" style="padding:4px 0 4px 8px;">
                <div class="dia-crianca-dot" style="width:5px;height:5px;margin-top:6px;background:var(--muted);opacity:.5;"></div>
                <div class="dia-crianca-info">
                  <strong>${esc(c.nome)}</strong>
                  ${c.serie?`<span>${esc(c.serie)}</span>`:''}
                </div>
              </div>`
            ).join('');
            return `<div style="margin-bottom:6px;">
              <div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;padding:4px 0 2px;border-bottom:1px dashed #e8e3dc;margin-bottom:2px;">
                🕐 ${esc(turmaNome)} <span style="font-weight:400;color:#bbb;">(${criancas.length})</span>
              </div>
              ${criancasHTML}
            </div>`;
          }).join('');
          const tot = Object.values(turmas).reduce((s,l)=>s+l.length,0);
          return `<div style="margin-bottom:10px;border-bottom:1px solid #f0ece6;padding-bottom:8px;">
            <div style="font-size:11px;font-weight:700;color:var(--red);margin-bottom:6px;display:flex;align-items:center;gap:6px;">
              <span style="width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block;flex-shrink:0;"></span>
              ${esc(ativNome)} <span style="font-weight:500;color:var(--muted);font-size:10px;">(${tot})</span>
            </div>
            ${turmasHTML}
          </div>`;
        }).join('');
        html += '</div>';
      });
      listEl.innerHTML = html || '<div class="dia-vazio">Nenhuma criança</div>';
    });
    // Mobile: build/rebuild tabs with fresh counts
    if (_isMobile) _buildMobileTabs('diasSemanaAtivGrid', DIAS, ativDiaCounts);

    // ── Ocupação por atividade ──
    const grid = document.getElementById('atOcupacaoGrid');
    if (!todasAtiv.length) { grid.innerHTML = '<p style="color:var(--muted);font-size:13px;">Nenhuma atividade cadastrada.</p>'; }
    else {
      grid.innerHTML = todasAtiv.map(a => {
        const turmas = (a.horarios||[]).map(t => {
          const inscritos = t.inscritos||0;
          const vagas = t.vagas ?? null;
          const pct = vagas ? Math.round((inscritos/vagas)*100) : 0;
          const cor = pct >= 100 ? '#C8102E' : pct >= 75 ? '#d4830a' : '#2d7a3a';
          return `<div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-size:12px;font-weight:500;color:var(--text);">${esc(t.turma)}</span>
              <span style="font-size:11px;color:${cor};font-weight:600;">${inscritos}${vagas!=null?'/'+vagas:''} inscrito(s)</span>
            </div>
            ${vagas!=null?`<div style="height:6px;background:#f0ece6;border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${Math.min(100,pct)}%;background:${cor};border-radius:3px;transition:width .4s;"></div>
            </div>`:''}
          </div>`;
        }).join('');

        return `<div style="background:var(--white);border-radius:12px;border:1px solid var(--border);padding:18px 20px;box-shadow:0 2px 8px rgba(0,0,0,.04);">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
            <span style="width:12px;height:12px;border-radius:50%;background:${a.cor||'#C8102E'};flex-shrink:0;display:inline-block;"></span>
            <span style="font-family:'Lora',serif;font-size:14px;font-weight:700;color:var(--text);">${esc(a.nome)}</span>
            <span style="font-size:11px;color:var(--muted);margin-left:auto;">R$ ${Number(a.preco).toFixed(2).replace('.',',')}/mês</span>
          </div>
          ${turmas||'<span style="font-size:12px;color:var(--muted);">Sem turmas.</span>'}
        </div>`;
      }).join('');
    }

    // ── Alunos por atividade ──
    const ativGrid = document.getElementById('atAlunosPorAtivGrid');
    if (!todasAtiv.length) { ativGrid.innerHTML = ''; }
    else {
      // Agrupa inscritos por atividade → turma
      const porAtiv = {};
      allInscricoesAtiv.forEach(ins => {
        (ins.turmas_selecionadas||[]).forEach(ts => {
          const ativ = todasAtiv.find(a => a.id === ts.atividade_id);
          if (!ativ) return;
          if (!porAtiv[ativ.nome]) porAtiv[ativ.nome] = { cor: ativ.cor || '#C8102E', turmas: {} };
          const turmaNome = ts.turma || 'Sem turma';
          if (!porAtiv[ativ.nome].turmas[turmaNome]) porAtiv[ativ.nome].turmas[turmaNome] = [];
          porAtiv[ativ.nome].turmas[turmaNome].push(ins.nome_crianca);
        });
      });

      ativGrid.innerHTML = Object.entries(porAtiv).sort((a,b) => a[0].localeCompare(b[0])).map(([ativNome, info]) => {
        const totalAtiv = Object.values(info.turmas).reduce((s,l) => s+l.length, 0);
        const turmasHTML = Object.entries(info.turmas).sort((a,b) => a[0].localeCompare(b[0])).map(([turmaNome, alunos]) => {
          const alunosSorted = [...alunos].sort((a,b) => a.localeCompare(b));
          return `<div style="margin-bottom:10px;">
            <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;padding:4px 0 4px;border-bottom:1px dashed #e8e3dc;margin-bottom:4px;">
              🕐 ${esc(turmaNome)} <span style="font-weight:400;color:#bbb;">(${alunos.length})</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 16px;">
              ${alunosSorted.map(n => `<div style="font-size:12px;padding:3px 0;color:var(--text);">• ${esc(n)}</div>`).join('')}
            </div>
          </div>`;
        }).join('');
        return `<div style="background:var(--white);border-radius:12px;border:1px solid var(--border);padding:18px 20px;box-shadow:0 2px 8px rgba(0,0,0,.04);">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <span style="width:12px;height:12px;border-radius:50%;background:${info.cor};flex-shrink:0;display:inline-block;"></span>
            <span style="font-family:'Lora',serif;font-size:15px;font-weight:700;color:var(--text);">${esc(ativNome)}</span>
            <span style="font-size:12px;color:var(--muted);margin-left:auto;">${totalAtiv} aluno(s)</span>
          </div>
          ${turmasHTML}
        </div>`;
      }).join('');
    }

    // ── Tabela ──
    renderAtivDashTable();
  }

  function renderAtivDashTable() {
    const q = (document.getElementById('adSearchInput')?.value||'').toLowerCase();
    const rows = allInscricoesAtiv.filter(ins =>
      !q || [ins.nome_crianca, ins.nome_resp, ins.email, ins.serie].some(v => v?.toLowerCase().includes(q))
    );
    document.getElementById('adInscricoesCount').textContent = rows.length;
    const tb = document.getElementById('adInscricoesBody');
    if (!rows.length) { tb.innerHTML='<tr><td colspan="6" class="empty-state">📭 Nenhuma inscrição.</td></tr>'; return; }
    tb.innerHTML = rows.map(ins => {
      const atividades = (ins.turmas_selecionadas||[]).map(ts =>
        `<div style="margin-bottom:4px;">
          <span style="font-size:11px;font-weight:600;color:var(--text);">${esc(ts.turma||'')}</span>
          ${(ts.slots||[]).length?`<span style="font-size:10px;color:var(--muted);margin-left:4px;">${ts.slots.map(s=>s.dia+' '+s.inicio+'–'+s.fim).join(', ')}</span>`:''}
        </div>`
      ).join('') || '—';
      const date = new Date(ins.criado_em).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
      return `<tr>
        <td><strong>${esc(ins.nome_crianca)}</strong></td>
        <td>${esc(ins.nome_resp)}<br><small style="color:var(--muted)">${esc(ins.email)}</small></td>
        <td>${esc(ins.serie||'—')}</td>
        <td>${atividades}</td>
        <td class="date-cell">${date}</td>
        <td><button class="action-btn del" onclick="deleteInscricaoAtivDash('${ins.id}','${esc(ins.nome_crianca)}')">🗑</button></td>
      </tr>`;
    }).join('');
  }

  async function deleteInscricaoAtivDash(id, nome) {
    if (!await _lumiedConfirm('Remover inscrição de "'+nome+'"?')) return;
    await api({ action:'inscricoes_atividades_delete', id });
    loadAtivDashboard();
  }

  // ── EXPORTAR PDF ──────────────────────────────────────
  var ultimoRelatorioTexto = ''; // para compartilhar no WhatsApp

  function showExportButtons(show) {
    document.getElementById('btnExportPdf').style.display  = show ? 'flex' : 'none';
    document.getElementById('btnWhatsapp').style.display   = show ? 'flex' : 'none';
  }

  function buildRelatorioTurnosHTML() {
    const data = new Date().toLocaleDateString('pt-BR', {day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const total    = document.getElementById('sTotal')?.textContent    || '—';
    const integral = document.getElementById('sIntegral')?.textContent || '—';
    const semi     = document.getElementById('sSemi')?.textContent     || '—';
    const tarde    = document.getElementById('sTarde')?.textContent    || '—';
    const diaria   = document.getElementById('sDiaria')?.textContent   || '—';

    // Dias com crianças
    const DIAS = ['Segunda','Terça','Quarta','Quinta','Sexta'];
    const diasRows = DIAS.map(dia => {
      const count = document.getElementById('dCount_'+dia)?.textContent || '0';
      const items = document.getElementById('dList_'+dia);
      const criancas = items ? [...items.querySelectorAll('.dia-crianca-info strong')].map(el => el.textContent).join(', ') : '';
      return `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0ece6;font-weight:600;">${dia}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0ece6;text-align:center;">${count}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0ece6;font-size:12px;color:#555;">${criancas||'—'}</td></tr>`;
    }).join('');

    // Solicitações da tabela
    const rows = document.querySelectorAll('#tableBody tr');
    const solRows = [...rows].filter(r => !r.querySelector('.empty-state')).map(r => {
      const cells = r.querySelectorAll('td');
      if (cells.length < 5) return '';
      return `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid #f5f0ea;">${cells[0]?.textContent||''}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #f5f0ea;">${cells[1]?.querySelector('strong')?.textContent||cells[1]?.textContent||''}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #f5f0ea;">${cells[2]?.textContent||''}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #f5f0ea;">${cells[3]?.querySelector('button')?.textContent?.replace(' ✎','')||''}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #f5f0ea;">${cells[5]?.textContent||cells[4]?.textContent||''}</td>
      </tr>`;
    }).join('');

    ultimoRelatorioTexto = `📊 *${SCHOOL_NAME} — Dashboard de Turnos*\n📅 ${data}\n\n*Resumo:*\nTotal: ${total} | Integral: ${integral} | Semi-Int.: ${semi} | Tarde: ${tarde} | Diária: ${diaria}\n\nRelatório completo disponível em PDF.`;

    return `
    <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:0;">
      <div style="background:#C8102E;padding:28px 36px;border-radius:10px 10px 0 0;">
        <img src="/lumied-logo.png" style="max-height:52px;object-fit:contain;display:block;margin:0 auto 8px;" alt="${SCHOOL_NAME}" loading="lazy">
        <p style="color:rgba(255,255,255,.7);text-align:center;font-size:12px;margin:0;"></p>
        <h1 style="color:#fff;text-align:center;font-size:20px;margin:10px 0 4px;font-family:Georgia,serif;">Dashboard de Turnos 2026</h1>
        <p style="color:rgba(255,255,255,.7);text-align:center;font-size:12px;margin:0;">Gerado em ${data}</p>
      </div>
      <div style="background:#fff;padding:28px 36px;">
        <h2 style="font-family:Georgia,serif;font-size:15px;color:#C8102E;margin:0 0 16px;text-transform:uppercase;letter-spacing:.5px;">Resumo Geral</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:28px;">
          <tr>
            ${[['Total',total,'todas'],['Integral',integral,'todas freq.'],['Semi-Integral',semi,'todas freq.'],['Tarde',tarde,'13:30h'],['Diária',diaria,'R$ 150,00']].map(([l,v,s])=>`
            <td style="text-align:center;padding:16px 8px;background:#fdf6f0;border-radius:8px;margin:4px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;margin-bottom:4px;">${l}</div>
              <div style="font-family:Georgia,serif;font-size:32px;font-weight:700;color:#1a1a1a;line-height:1;">${v}</div>
              <div style="font-size:10px;color:#aaa;margin-top:4px;">${s}</div>
            </td>`).join('<td style="width:8px;"></td>')}
          </tr>
        </table>
        <h2 style="font-family:Georgia,serif;font-size:15px;color:#C8102E;margin:0 0 12px;text-transform:uppercase;letter-spacing:.5px;">Crianças por Dia da Semana</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:28px;border:1px solid #f0ece6;border-radius:8px;overflow:hidden;">
          <thead><tr style="background:#faf8f5;">
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Dia</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Total</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Crianças</th>
          </tr></thead>
          <tbody>${diasRows}</tbody>
        </table>
        <h2 style="font-family:Georgia,serif;font-size:15px;color:#C8102E;margin:0 0 12px;text-transform:uppercase;letter-spacing:.5px;">Solicitações Recebidas</h2>
        <table style="width:100%;border-collapse:collapse;border:1px solid #f0ece6;border-radius:8px;overflow:hidden;">
          <thead><tr style="background:#faf8f5;">
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Criança</th>
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Responsável</th>
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Série</th>
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Turno</th>
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Data</th>
          </tr></thead>
          <tbody>${solRows||'<tr><td colspan="5" style="padding:20px;text-align:center;color:#aaa;">Nenhuma solicitação</td></tr>'}</tbody>
        </table>
      </div>
      <div style="background:#f5f0ea;padding:14px 36px;border-radius:0 0 10px 10px;text-align:center;font-size:11px;color:#aaa;">
        ${SCHOOL_NAME} · Relatório gerado automaticamente
      </div>
    </div>`;
  }

  function buildRelatorioAtivHTML() {
    const data = new Date().toLocaleDateString('pt-BR', {day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const total   = document.getElementById('atTotal')?.textContent   || '—';
    const ativas  = document.getElementById('atAtivas')?.textContent  || '—';
    const lotadas = document.getElementById('atLotadas')?.textContent || '—';
    const vagas   = document.getElementById('atVagas')?.textContent   || '—';

    const DIAS = ['Segunda','Terça','Quarta','Quinta','Sexta'];
    const diasRows = DIAS.map(dia => {
      const count = document.getElementById('adCount_'+dia)?.textContent || '0';
      const items = document.getElementById('adList_'+dia);
      const criancas = items ? [...items.querySelectorAll('.dia-crianca-info strong')].map(el => el.textContent).join(', ') : '';
      return `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0ece6;font-weight:600;">${dia}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0ece6;text-align:center;">${count}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0ece6;font-size:12px;color:#555;">${criancas||'—'}</td></tr>`;
    }).join('');

    // Ocupação
    const ocupCards = document.querySelectorAll('#atOcupacaoGrid > div');
    const ocupRows = [...ocupCards].map(card => {
      const nome = card.querySelector('span[style*="Lora"]')?.textContent || '';
      const preco = card.querySelector('span[style*="margin-left:auto"]')?.textContent || '';
      const turmas = [...card.querySelectorAll('div[style*="margin-bottom:10px"]')].map(t => {
        const label = t.querySelector('span:first-child')?.textContent || '';
        const count = t.querySelector('span[style*="font-weight:600"]')?.textContent || '';
        return `${label}: ${count}`;
      }).join(' | ');
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #f5f0ea;font-weight:600;">${nome}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f5f0ea;color:#C8102E;font-weight:600;">${preco}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f5f0ea;font-size:12px;color:#555;">${turmas}</td>
      </tr>`;
    }).join('');

    // Inscrições
    const insRows = [...document.querySelectorAll('#adInscricoesBody tr')].filter(r=>!r.querySelector('.empty-state')).map(r => {
      const cells = r.querySelectorAll('td');
      const atividades = cells[3]?.textContent?.trim().replace(/\s+/g,' ') || '—';
      return `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid #f5f0ea;">${cells[0]?.textContent||''}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #f5f0ea;">${cells[1]?.querySelector('strong')?.textContent||''}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #f5f0ea;">${cells[2]?.textContent||''}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #f5f0ea;font-size:11px;">${atividades}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #f5f0ea;">${cells[4]?.textContent||''}</td>
      </tr>`;
    }).join('');

    ultimoRelatorioTexto = `📊 *${SCHOOL_NAME} — Dashboard de Atividades*\n📅 ${data}\n\n*Resumo:*\nInscrições: ${total} | Atividades ativas: ${ativas} | Turmas lotadas: ${lotadas} | Vagas disponíveis: ${vagas}\n\nRelatório completo disponível em PDF.`;

    return `
    <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:0;">
      <div style="background:#C8102E;padding:28px 36px;border-radius:10px 10px 0 0;">
        <img src="/lumied-logo.png" style="max-height:52px;object-fit:contain;display:block;margin:0 auto 8px;" alt="${SCHOOL_NAME}" loading="lazy">
        <p style="color:rgba(255,255,255,.7);text-align:center;font-size:12px;margin:0;"></p>
        <h1 style="color:#fff;text-align:center;font-size:20px;margin:10px 0 4px;font-family:Georgia,serif;">Dashboard de Atividades Extraclasse</h1>
        <p style="color:rgba(255,255,255,.7);text-align:center;font-size:12px;margin:0;">Gerado em ${data}</p>
      </div>
      <div style="background:#fff;padding:28px 36px;">
        <h2 style="font-family:Georgia,serif;font-size:15px;color:#C8102E;margin:0 0 16px;text-transform:uppercase;letter-spacing:.5px;">Resumo Geral</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:28px;">
          <tr>
            ${[['Inscrições',total,'em atividades'],['Atividades Ativas',ativas,'com vagas'],['Turmas Lotadas',lotadas,'sem vagas'],['Vagas Disponíveis',vagas,'em aberto']].map(([l,v,s])=>`
            <td style="text-align:center;padding:16px 8px;background:#fdf6f0;border-radius:8px;">
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;margin-bottom:4px;">${l}</div>
              <div style="font-family:Georgia,serif;font-size:32px;font-weight:700;color:#1a1a1a;line-height:1;">${v}</div>
              <div style="font-size:10px;color:#aaa;margin-top:4px;">${s}</div>
            </td>`).join('<td style="width:8px;"></td>')}
          </tr>
        </table>
        <h2 style="font-family:Georgia,serif;font-size:15px;color:#C8102E;margin:0 0 12px;text-transform:uppercase;letter-spacing:.5px;">Crianças por Dia da Semana</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:28px;border:1px solid #f0ece6;border-radius:8px;overflow:hidden;">
          <thead><tr style="background:#faf8f5;">
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Dia</th>
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Total</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Crianças</th>
          </tr></thead>
          <tbody>${diasRows}</tbody>
        </table>
        <h2 style="font-family:Georgia,serif;font-size:15px;color:#C8102E;margin:0 0 12px;text-transform:uppercase;letter-spacing:.5px;">Ocupação por Atividade</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:28px;border:1px solid #f0ece6;border-radius:8px;overflow:hidden;">
          <thead><tr style="background:#faf8f5;">
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Atividade</th>
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Preço</th>
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Turmas</th>
          </tr></thead>
          <tbody>${ocupRows||'<tr><td colspan="3" style="padding:16px;text-align:center;color:#aaa;">Sem dados</td></tr>'}</tbody>
        </table>
        <h2 style="font-family:Georgia,serif;font-size:15px;color:#C8102E;margin:0 0 12px;text-transform:uppercase;letter-spacing:.5px;">Inscrições Recebidas</h2>
        <table style="width:100%;border-collapse:collapse;border:1px solid #f0ece6;border-radius:8px;overflow:hidden;">
          <thead><tr style="background:#faf8f5;">
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Criança</th>
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Responsável</th>
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Série</th>
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Atividades</th>
            <th style="padding:9px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#999;">Data</th>
          </tr></thead>
          <tbody>${insRows||'<tr><td colspan="5" style="padding:20px;text-align:center;color:#aaa;">Nenhuma inscrição</td></tr>'}</tbody>
        </table>
      </div>
      <div style="background:#f5f0ea;padding:14px 36px;border-radius:0 0 10px 10px;text-align:center;font-size:11px;color:#aaa;">
        ${SCHOOL_NAME} · Relatório gerado automaticamente
      </div>
    </div>`;
  }

  async function exportarPDF() {
    const isDashAtiv = document.getElementById('panelDashAtiv').classList.contains('active');
    const titulo     = isDashAtiv ? 'dashboard-atividades' : 'dashboard-turnos';
    const htmlContent = isDashAtiv ? buildRelatorioAtivHTML() : buildRelatorioTurnosHTML();

    const btn = document.getElementById('btnExportPdf');
    btn.textContent = '⏳ Gerando…'; btn.disabled = true;

    // Cria iframe oculto para renderizar o HTML
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1000px;height:1px;border:none;';
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{box-sizing:border-box;margin:0;padding:0;}body{background:#f8f5f0;padding:20px;}</style></head><body>' + htmlContent + '</body></html>');
    iframe.contentDocument.close();

    await new Promise(r => setTimeout(r, 800)); // aguarda renderização

    const canvas = await html2canvas(iframe.contentDocument.body, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#f8f5f0',
      width: 1000,
      windowWidth: 1000
    });

    document.body.removeChild(iframe);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    const imgW = pdfW;
    const imgH = (canvas.height * pdfW) / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    let posY = 0;
    let pageH = pdfH;
    let totalH = imgH;

    // Divide em páginas se necessário
    while (posY < totalH) {
      if (posY > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, -posY, imgW, imgH);
      posY += pageH;
    }

    pdf.save(`${SCHOOL_NAME.toLowerCase().replace(/\s+/g,'-')}-${titulo}-${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.pdf`);
    btn.innerHTML = '📄 Exportar PDF'; btn.disabled = false;
  }

  async function compartilharWhatsApp() {
    const isDashAtiv  = document.getElementById('panelDashAtiv').classList.contains('active');
    const titulo      = isDashAtiv ? 'dashboard-atividades' : 'dashboard-turnos';
    const htmlContent = isDashAtiv ? buildRelatorioAtivHTML() : buildRelatorioTurnosHTML();

    const btn = document.getElementById('btnWhatsapp');
    btn.textContent = '⏳ Preparando…'; btn.disabled = true;

    try {
      // 1. Gera o PDF em memória (mesmo processo do exportarPDF)
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1000px;height:1px;border:none;';
      document.body.appendChild(iframe);
      iframe.contentDocument.open();
      iframe.contentDocument.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{box-sizing:border-box;margin:0;padding:0;}body{background:#f8f5f0;padding:20px;}</style></head><body>' + htmlContent + '</body></html>');
      iframe.contentDocument.close();
      await new Promise(r => setTimeout(r, 800));

      const canvas = await html2canvas(iframe.contentDocument.body, {
        scale: 2, useCORS: true, backgroundColor: '#f8f5f0', width: 1000, windowWidth: 1000
      });
      document.body.removeChild(iframe);

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      const imgW = pdfW;
      const imgH = (canvas.height * pdfW) / canvas.width;
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      let posY = 0;
      while (posY < imgH) {
        if (posY > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, -posY, imgW, imgH);
        posY += pdfH;
      }

      // 2. Converte para base64 e faz upload via API
      const pdfBase64 = pdf.output('datauristring').split(',')[1];
      const d = await api({ action: 'relatorio_upload', base64: pdfBase64, nome: titulo });

      if (d.error) throw new Error(d.error);

      // 3. Abre WhatsApp com o link
      const data = new Date().toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric'});
      const tipo  = isDashAtiv ? 'Atividades Extraclasse' : 'Turnos 2026';
      const msg = `📊 *${SCHOOL_NAME}*\n\n📊 *Relatório — Dashboard de ${tipo}*\n📅 ${data}\n\n📄 Clique para abrir o PDF:\n${d.url}`;
      window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');

    } catch(e) {
      showToast('Erro ao gerar link: ' + e.message, 'error');
    }

    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.522 5.847L.057 23.882l6.186-1.424A11.946 11.946 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.882a9.875 9.875 0 01-5.018-1.368l-.36-.214-3.732.859.896-3.614-.235-.373A9.844 9.844 0 012.118 12C2.118 6.56 6.56 2.118 12 2.118c5.44 0 9.882 4.442 9.882 9.882 0 5.44-4.442 9.882-9.882 9.882z"/></svg> Compartilhar PDF`;
    btn.disabled = false;
  }
