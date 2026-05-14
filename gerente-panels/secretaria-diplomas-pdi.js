// Auto-extraído do gerente.html (Onda 4 — batch).
// Secretaria + Diplomas + PDI gestora
  // ── SECRETARIA ────────────────────────────────────────
  async function loadSecretarias() {
    const d = await callDiplomas({ action: 'secretarias_list' });
    const list = d.data || [];
    document.getElementById('secsCount').textContent = list.length;
    const el = document.getElementById('secsList');
    if (!list.length) {
      el.innerHTML = '<div class="list-row"><span style="color:var(--muted);font-size:13px;">Nenhuma secretária cadastrada.</span></div>';
      return;
    }
    el.innerHTML = list.map(s => `
      <div class="list-row">
        <div class="list-avatar">${(s.nome||'?')[0].toUpperCase()}</div>
        <div class="lr-main">
          <strong>${esc(s.nome)}</strong>
          <span>${esc(s.email)} · Desde ${new Date(s.criado_em).toLocaleDateString('pt-BR')}</span>
        </div>
        <span class="role-badge" style="background:rgba(26,107,181,.1);color:#1a6bb5;border-color:rgba(26,107,181,.2);">Secretaria</span>
        <button class="action-btn del" onclick="deleteSecretaria('${s.id}','${esc(s.nome)}')">🗑</button>
      </div>`).join('');
  }

  async function createSecretaria() {
    const nome  = document.getElementById('newSecNome').value.trim();
    const email = document.getElementById('newSecEmail').value.trim();
    const senha = document.getElementById('newSecSenha').value;
    if (!nome || !email || !senha) return showAlert('sec','error','Preencha todos os campos.');
    if (senha.length < 6) return showAlert('sec','error','Senha mínima de 6 caracteres.');
    const d = await callDiplomas({ action: 'secretaria_create', nome, email, senha });
    if (d.error) return showAlert('sec','error',d.error);
    showAlert('sec','success','✅ Secretária "'+nome+'" criada!');
    document.getElementById('newSecNome').value = '';
    document.getElementById('newSecEmail').value = '';
    document.getElementById('newSecSenha').value = '';
    loadSecretarias();
  }

  async function deleteSecretaria(id, nome) {
    if (!await _lumiedConfirm('Remover "'+nome+'" da secretaria?')) return;
    const d = await callDiplomas({ action: 'secretaria_delete', id });
    if (d.error) { showToast(d.error, 'error'); return; }
    loadSecretarias();
  }

  // ── DIPLOMAS ──────────────────────────────────────────
  async function callDiplomas(body) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON };
    const r = await fetch(DIPLOMAS_API, { method: 'POST', headers, body: JSON.stringify({ ...body, _token: token }) });
    const d = await r.json();
    if (d.error === 'Sessão inválida ou expirada. Faça login novamente.') { doLogout(); }
    return d;
  }

  async function loadDiplomasPanel() {
    await Promise.all([ loadDipRanking(), loadDipTable() ]);
  }

  async function loadDipRanking() {
    const d = await callDiplomas({ action: 'ranking' });
    const lista = d.data || [];
    const el = document.getElementById('dipRankingList');
    if (!lista.length) {
      el.innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">Nenhuma professora com pontos ainda.</div>';
      return;
    }
    el.innerHTML = lista.map((p, i) => {
      const pos = i + 1;
      const cls = pos === 1 ? 'g1' : pos === 2 ? 'g2' : pos === 3 ? 'g3' : 'gN';
      const lbl = pos <= 3 ? ['🥇','🥈','🥉'][pos-1] : pos + 'º';
      return `<div class="rank-row">
        <div class="rank-pos-badge ${cls}">${lbl}</div>
        <div class="rank-nome">${esc(p.nome)}</div>
        <div>
          <div class="rank-pts-val">${p.pontuacao}</div>
          <div class="rank-pts-lbl">pontos</div>
        </div>
      </div>`;
    }).join('');
  }

  async function loadDipTable() {
    const d = await callDiplomas({ action: 'diplomas_all', status: dipFilter });
    const lista = d.data || [];
    document.getElementById('dipCount').textContent = lista.length;

    // Stats from all diplomas (fetch fresh)
    const all = await callDiplomas({ action: 'diplomas_all', status: 'todos' });
    const allList = all.data || [];
    document.getElementById('dipPendentes').textContent  = allList.filter(x => x.status === 'pendente').length;
    document.getElementById('dipAprovados').textContent  = allList.filter(x => x.status === 'aprovado').length;
    document.getElementById('dipRejeitados').textContent = allList.filter(x => x.status === 'rejeitado').length;
    document.getElementById('dipTotalPts').textContent   = allList.filter(x => x.status === 'aprovado').reduce((s, x) => s + (x.pontuacao || 0), 0);

    const tb = document.getElementById('dipTableBody');
    if (!lista.length) { tb.innerHTML = '<tr><td colspan="7" class="empty-state">📭 Nenhum diploma encontrado.</td></tr>'; return; }
    tb.innerHTML = lista.map(d => {
      const STATUS_HTML = {
        pendente: '<span class="status-pill pendente">⏳ Pendente</span>',
        aprovado: '<span class="status-pill aprovado">✅ Aprovado</span>',
        rejeitado: '<span class="status-pill rejeitado">❌ Rejeitado</span>',
      };
      const date = new Date(d.criado_em).toLocaleDateString('pt-BR');
      const prof = d.professoras || {};
      const fileLink = d.arquivo_url
        ? `<a href="${d.arquivo_url}" target="_blank" style="font-size:11px;color:var(--blue);text-decoration:none;">📎 Ver</a>`
        : '—';
      const acoes = d.status === 'pendente'
        ? `<button class="btn-aprovar" onclick="openDipModal('aprovar','${d.id}','${esc(prof.nome||'')}','${esc(d.nome_curso)}')">✓ Aprovar</button>
           <button class="btn-rejeitar" style="margin-left:4px;" onclick="openDipModal('rejeitar','${d.id}','${esc(prof.nome||'')}','${esc(d.nome_curso)}')">✕ Rejeitar</button>`
        : `<span style="font-size:12px;color:var(--muted);">${d.status === 'aprovado' ? '+'+d.pontuacao+' pts' : '—'}</span>`;
      return `<tr>
        <td><strong>${esc(prof.nome||'—')}</strong><br><small style="color:var(--muted)">${esc(prof.email||'')}</small></td>
        <td>${esc(d.nome_curso)}${d.arquivo_url?'<br>'+fileLink:''}</td>
        <td style="font-family:'Lora',serif;font-size:16px;font-weight:700;">${d.carga_horaria}h</td>
        <td>${STATUS_HTML[d.status] || d.status}</td>
        <td class="date-cell">${date}</td>
        <td style="font-size:12px;color:var(--muted);">${esc(d.validado_por||'—')}</td>
        <td>${acoes}</td>
      </tr>`;
    }).join('');
  }

  function dipSetFilter(f, btn) {
    dipFilter = f;
    document.querySelectorAll('.dip-filter-bar .fb').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadDipTable();
  }

  // Observação modal
  function openDipModal(tipo, id, nomeProfessora, nomeCurso) {
    dipPendingAction = { tipo, id };
    const title = tipo === 'aprovar' ? '✅ Aprovar Diploma' : '❌ Rejeitar Diploma';
    const desc = tipo === 'aprovar'
      ? `Aprovar o diploma de "<strong>${esc(nomeCurso)}</strong>" de ${esc(nomeProfessora)}? Os pontos serão creditados automaticamente.`
      : `Rejeitar o diploma de "<strong>${esc(nomeCurso)}</strong>" de ${esc(nomeProfessora)}?`;
    document.getElementById('obsModalTitle').textContent = title;
    document.getElementById('obsModalDesc').innerHTML = desc;
    const btn = document.getElementById('obsModalBtn');
    btn.textContent = tipo === 'aprovar' ? 'Aprovar' : 'Rejeitar';
    btn.style.background = tipo === 'aprovar' ? 'var(--green)' : 'var(--red)';
    document.getElementById('obsModalText').value = '';
    document.getElementById('obsModalOverlay').classList.add('show');
  }
  function closeObsModal() { document.getElementById('obsModalOverlay').classList.remove('show'); dipPendingAction = null; }

  async function confirmDipAction() {
    if (!dipPendingAction) return;
    const { tipo, id } = dipPendingAction;
    const observacao = document.getElementById('obsModalText').value.trim();
    const btn = document.getElementById('obsModalBtn');
    btn.disabled = true; btn.textContent = 'Salvando…';
    const action = tipo === 'aprovar' ? 'diploma_aprovar' : 'diploma_rejeitar';
    const d = await callDiplomas({ action, id, observacao: observacao || undefined });
    btn.disabled = false;
    if (d.error) { showToast('Erro: ' + d.error, 'error'); btn.textContent = tipo === 'aprovar' ? 'Aprovar' : 'Rejeitar'; return; }
    closeObsModal();
    loadDiplomasPanel();
  }

  // Senha modal
  function openSenhaModal(id, nome) {
    editingSenhaId = id;
    document.getElementById('senhaModalDesc').textContent = 'Definindo senha de acesso ao portal para: ' + nome;
    document.getElementById('senhaModalInput').value = '';
    document.getElementById('senhaModalErr').classList.remove('show');
    document.getElementById('senhaModalOk').classList.remove('show');
    document.getElementById('senhaModalOverlay').classList.add('show');
  }
  function closeSenhaModal() { document.getElementById('senhaModalOverlay').classList.remove('show'); editingSenhaId = null; }

  async function saveProfSenha() {
    const senha = document.getElementById('senhaModalInput').value;
    const errEl = document.getElementById('senhaModalErr');
    const okEl  = document.getElementById('senhaModalOk');
    errEl.classList.remove('show'); okEl.classList.remove('show');
    if (!senha || senha.length < 6) { errEl.textContent = 'Senha mínima de 6 caracteres.'; errEl.classList.add('show'); return; }
    const btn = document.getElementById('senhaModalBtn');
    btn.disabled = true; btn.textContent = 'Salvando…';
    const d = await callDiplomas({ action: 'professora_set_senha', professora_id: editingSenhaId, senha });
    btn.disabled = false; btn.textContent = 'Salvar Senha';
    if (d.error) { errEl.textContent = d.error; errEl.classList.add('show'); return; }
    okEl.textContent = '✅ Senha definida com sucesso!'; okEl.classList.add('show');
    setTimeout(() => closeSenhaModal(), 1500);
  }

  // ── PDI (GESTORA) ─────────────────────────────────────────
  var GCOMP_LABELS = {
    linguagem:'🗣️ Proficiência no Idioma', metodologia:'📚 Metodologia e Didática',
    avaliacao:'📊 Avaliação da Aprendizagem', intercultural:'🌍 Competência Intercultural',
    colaboracao:'🤝 Colaboração e Comunidade', inovacao:'💡 Inovação e Tecnologia',
    desenvolvimento:'📈 Desenvolvimento Profissional',
  };
  var G_STATUS = {rascunho:'✏️ Rascunho',aguardando_aprovacao:'⏳ Aguardando',em_andamento:'✅ Em Andamento',encerrado:'🏁 Encerrado'};
  var G_NOTA = ['','Em Desenvolvimento','Atende','Supera','Referência'];
  var META_STATUS_G = {pendente:'⏳ Pendente',em_andamento:'🔄 Em andamento',concluido:'✅ Concluído',revisado:'🔁 Revisado'};

  var pdiReviewData = null;

  async function loadPdiPanel() {
    await Promise.all([ loadPdiCiclos(), loadPdiPainel() ]);
  }

  async function loadPdiCiclos() {
    const d = await callDiplomas({ action: 'pdi_ciclos_list' });
    const ciclos = d.data || [];
    const sel = document.getElementById('pdiCicloSelect');
    if (sel) {
      sel.innerHTML = '<option value="">— Ciclo ativo —</option>' +
        ciclos.map(c => `<option value="${c.id}"${c.ativo?' selected':''}>${esc(c.nome)}${c.ativo?' ✓':''}</option>`).join('');
    }
    const listEl = document.getElementById('pdiCiclosList');
    if (listEl) {
      listEl.innerHTML = ciclos.length
        ? ciclos.map(c => `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border);">
            <div><div style="font-size:13px;font-weight:600;">${esc(c.nome)}</div>
            <div style="font-size:11px;color:var(--muted);">${c.ano} · ${c.ativo?'🟢 Ativo':'⚫ Inativo'}</div></div>
          </div>`).join('')
        : '<div style="padding:16px;text-align:center;font-size:13px;color:var(--muted);">Nenhum ciclo criado.</div>';
    }
  }

  async function loadPdiPainel() {
    const cicloId = document.getElementById('pdiCicloSelect')?.value || '';
    const d = await callDiplomas({ action: 'pdi_painel', ciclo_id: cicloId || undefined });
    if (!d.ciclo) {
      document.getElementById('pdiSemTableBody').innerHTML = '<tr><td colspan="4" class="empty-state">Nenhum ciclo ativo. Crie um ciclo de PDI ao lado.</td></tr>';
      ['pdiStatTotal','pdiStatSem','pdiStatAguard','pdiStatAtivo','pdiStatEnc'].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = '—';
      });
      return;
    }
    const rows = d.professoras || [];
    document.getElementById('pdiStatTotal').textContent  = rows.length;
    document.getElementById('pdiStatSem').textContent    = rows.filter(r => !r.pdi).length;
    document.getElementById('pdiStatAguard').textContent = rows.filter(r => r.pdi?.status === 'aguardando_aprovacao').length;
    document.getElementById('pdiStatAtivo').textContent  = rows.filter(r => r.pdi?.status === 'em_andamento').length;
    document.getElementById('pdiStatEnc').textContent    = rows.filter(r => r.pdi?.status === 'encerrado').length;

    const tb = document.getElementById('pdiSemTableBody');
    tb.innerHTML = rows.map(r => {
      const { professora: p, pdi } = r;
      const status = pdi?.status;
      const dotClass = !pdi ? 'vermelho' : (status === 'em_andamento' || status === 'encerrado') ? 'verde' : 'amarelo';
      const chipClass = status || 'sem-pdi';
      const chipLabel = status ? G_STATUS[status] : '🔴 Sem PDI';
      const submittedAt = pdi?.submetido_em ? new Date(pdi.submetido_em).toLocaleDateString('pt-BR') : '—';
      const acoes = pdi ? `<button class="btn-revisar" onclick="openPdiReview('${pdi.id}')">Revisar PDI</button>` : '<span style="font-size:12px;color:var(--muted);">—</span>';
      return `<tr>
        <td><strong>${esc(p.nome)}</strong><br><small style="color:var(--muted);">${esc(p.email)}</small></td>
        <td><span class="pdi-chip ${chipClass}"><span class="sem-dot ${dotClass}"></span>${chipLabel}</span></td>
        <td class="date-cell">${submittedAt}</td>
        <td>${acoes}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="4" class="empty-state">Nenhuma professora cadastrada.</td></tr>';
  }

  async function criarCiclo() {
    const nome  = (document.getElementById('pdiCicloNome')?.value  || '').trim();
    const ano   = parseInt(document.getElementById('pdiCicloAno')?.value) || new Date().getFullYear();
    const inicio = document.getElementById('pdiCicloInicio')?.value || '';
    const fim    = document.getElementById('pdiCicloFim')?.value    || '';
    const errEl = document.getElementById('pdiCicloErr');
    const okEl  = document.getElementById('pdiCicloOk');
    errEl.classList.remove('show'); okEl.classList.remove('show');
    if (!nome || !inicio || !fim) { errEl.textContent = 'Preencha todos os campos.'; errEl.classList.add('show'); return; }
    const btn = document.querySelector('#panelPdi .btn-create');
    btn.disabled = true; btn.textContent = 'Criando…';
    const d = await callDiplomas({ action: 'pdi_ciclo_criar', nome, ano, data_inicio: inicio, data_fim: fim });
    btn.disabled = false; btn.textContent = 'Criar Ciclo';
    if (d.error) { errEl.textContent = d.error; errEl.classList.add('show'); }
    else {
      okEl.textContent = '✅ Ciclo criado!'; okEl.classList.add('show');
      document.getElementById('pdiCicloNome').value = '';
      document.getElementById('pdiCicloAno').value  = '';
      document.getElementById('pdiCicloInicio').value = '';
      document.getElementById('pdiCicloFim').value    = '';
      await loadPdiPanel();
    }
  }

  async function openPdiReview(pdiId) {
    const d = await callDiplomas({ action: 'pdi_prof_view', pdi_id: pdiId });
    if (d.error || !d.data) { showToast('Erro ao carregar PDI: ' + (d.error || 'não encontrado'), 'error'); return; }
    pdiReviewData = d.data;
    renderPdiReviewModal(d.data);
    document.getElementById('pdiReviewModal').classList.add('open');
  }

  function closePdiReview() {
    document.getElementById('pdiReviewModal').classList.remove('open');
    pdiReviewData = null;
  }

  function renderPdiReviewModal(pdi) {
    const prof  = pdi.professoras    || {};
    const ciclo = pdi.pdi_ciclos     || {};
    const comps = pdi.pdi_competencias || [];
    const metas = pdi.pdi_metas       || [];
    const checkins = pdi.pdi_acompanhamentos || [];
    const status = pdi.status;

    document.getElementById('pdiReviewTitle').textContent    = `PDI — ${esc(prof.nome || '')}`;
    document.getElementById('pdiReviewSubtitle').textContent = `${ciclo.nome || ''} · ${G_STATUS[status] || status}`;

    // Competências (grid with manager rating)
    document.getElementById('pdiReviewComps').innerHTML = `
      <div class="pdi-comp-grid-g">
        ${Object.entries(GCOMP_LABELS).map(([area, label]) => {
          const c = comps.find(x => x.area === area) || {};
          return `<div class="pdi-comp-cell">
            <div class="pdi-comp-cell-name">${label}</div>
            <div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Professora: <strong>${c.nota_auto||'—'}</strong> · Gestora:</div>
            <div class="pdi-note-row" id="gnsel_${area}" data-selected="${c.nota_gestora||''}">
              ${[1,2,3,4].map(n=>`<button class="pdi-note-btn${c.nota_gestora===n?' sel':''}" onclick="selectGNota('${area}',${n})" title="${G_NOTA[n]}">${n}</button>`).join('')}
            </div>
            <input type="text" id="gcmt_${area}" value="${esc(c.comentario||'')}" placeholder="Comentário…" style="width:100%;margin-top:5px;padding:4px 8px;border:1px solid var(--border);border-radius:5px;font-size:11px;font-family:'DM Sans',sans-serif;">
          </div>`;
        }).join('')}
      </div>
      <button style="margin-top:10px;padding:7px 16px;background:var(--green);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;" onclick="saveCompetenciasGerente('${pdi.id}')">Salvar Avaliação de Competências</button>
      <div class="f-alert error" id="gcompErr" style="margin-top:8px;"></div>
      <div class="f-alert success" id="gcompOk" style="margin-top:8px;"></div>
    `;

    // Metas
    document.getElementById('pdiReviewMetas').innerHTML = metas.length
      ? metas.map(m => `<div class="pdi-meta-item">
          <div style="font-size:13px;font-weight:600;">${esc(m.descricao)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">📏 ${esc(m.indicador)} · 📅 ${m.prazo} · ${m.progressao_pct||0}% concluído</div>
          <span class="status-pill ${m.status}" style="margin-top:5px;display:inline-flex;">${META_STATUS_G[m.status]||m.status}</span>
        </div>`).join('')
      : '<div style="padding:12px;font-size:13px;color:var(--muted);">Nenhuma meta definida.</div>';

    // Check-ins
    document.getElementById('pdiReviewCheckins').innerHTML = checkins.length
      ? checkins.map(a => `<div style="padding:10px 14px;border-bottom:1px solid var(--border);">
          <strong style="font-size:12px;">${a.tipo==='semestral'?'📅 Semestral':'🏁 Final'} · ${new Date(a.criado_em).toLocaleDateString('pt-BR')}</strong>
          <div style="font-size:12px;margin-top:3px;">${esc(a.relato_professora||'')}</div>
          ${a.feedback_gestora
            ? `<div style="font-size:11px;color:var(--green);margin-top:3px;"><strong>Feedback:</strong> ${esc(a.feedback_gestora)}</div>`
            : `<div style="margin-top:6px;display:flex;gap:6px;">
                <input type="text" id="chkFb_${a.id}" placeholder="Adicionar feedback…" style="flex:1;padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:11px;font-family:'DM Sans',sans-serif;">
                <button onclick="saveCheckinFb('${a.id}')" style="padding:5px 10px;background:var(--green);color:#fff;border:none;border-radius:5px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Salvar</button>
              </div>`
          }
        </div>`).join('')
      : '<div style="padding:12px;font-size:13px;color:var(--muted);">Nenhum check-in registrado.</div>';

    // Workflow actions
    let actionsHtml = '';
    if (status === 'aguardando_aprovacao') {
      actionsHtml = `
        <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:8px;">
          <div class="pdi-sec-lbl" style="margin-top:0;">Aprovação</div>
          <div class="ff"><label>Feedback (opcional para aprovar, obrigatório para devolver)</label>
            <textarea id="pdiAprovFeedback" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:'DM Sans',sans-serif;font-size:13px;min-height:70px;resize:vertical;background:#fdfbf8;" placeholder="Comentários ou orientações…"></textarea>
          </div>
          <div class="pdi-action-row">
            <button class="btn-pdi-aprovar" onclick="aprovaPdi('${pdi.id}')">✅ Aprovar PDI</button>
            <button class="btn-pdi-rejeitar" onclick="rejeitaPdi('${pdi.id}')">↩ Devolver para revisão</button>
          </div>
          <div class="f-alert error" id="pdiAprovErr" style="margin-top:8px;"></div>
        </div>`;
    } else if (status === 'em_andamento') {
      actionsHtml = `
        <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:8px;">
          <div class="pdi-sec-lbl" style="margin-top:0;">Encerrar PDI — Nota Final</div>
          <div class="pdi-nota-final-row" id="pdiNotaFinalSel">
            ${[1,2,3,4].map(n=>`<button class="pdi-nota-btn" id="pdiNFbtn_${n}" onclick="selectNotaFinal(${n})" title="${G_NOTA[n]}">${n}</button>`).join('')}
            <span style="font-size:12px;color:var(--muted);align-self:center;" id="pdiNFLabel">Selecione</span>
          </div>
          <div class="ff"><label>Feedback final (obrigatório)</label>
            <textarea id="pdiEncFeedback" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:'DM Sans',sans-serif;font-size:13px;min-height:70px;resize:vertical;background:#fdfbf8;" placeholder="Avaliação final do desenvolvimento da professora…"></textarea>
          </div>
          <div class="pdi-action-row">
            <button class="btn-pdi-encerrar" onclick="encerrarPdi('${pdi.id}')">🏁 Encerrar PDI</button>
          </div>
          <div class="f-alert error" id="pdiEncErr" style="margin-top:8px;"></div>
        </div>`;
    } else if (status === 'encerrado') {
      actionsHtml = `
        <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:8px;">
          <div class="pdi-sec-lbl" style="margin-top:0;">PDI Encerrado</div>
          <div style="display:flex;align-items:center;gap:14px;padding:16px;background:#f0ece6;border-radius:10px;">
            <div style="font-family:'Lora',serif;font-size:40px;font-weight:700;">${pdi.nota_final||'—'}</div>
            <div>
              <div style="font-size:14px;font-weight:600;">${G_NOTA[pdi.nota_final]||''}</div>
              <div style="font-size:12px;color:var(--muted);margin-top:3px;">${esc(pdi.feedback_gestora||'')}</div>
            </div>
          </div>
        </div>`;
    }
    document.getElementById('pdiReviewActions').innerHTML = actionsHtml;
  }

  function selectGNota(area, nota) {
    const rg = document.getElementById(`gnsel_${area}`);
    if (!rg) return;
    rg.querySelectorAll('.pdi-note-btn').forEach((btn, i) => btn.classList.toggle('sel', i + 1 === nota));
    rg.dataset.selected = nota;
  }

  function selectNotaFinal(n) {
    document.querySelectorAll('.pdi-nota-btn').forEach((btn, i) => btn.classList.toggle('sel', i + 1 === n));
    const lbl = document.getElementById('pdiNFLabel'); if (lbl) lbl.textContent = G_NOTA[n] || '';
    const sel = document.getElementById('pdiNotaFinalSel'); if (sel) sel.dataset.selected = n;
  }

  async function saveCompetenciasGerente(pdiId) {
    const errEl = document.getElementById('gcompErr');
    const okEl  = document.getElementById('gcompOk');
    if (errEl) errEl.classList.remove('show');
    if (okEl)  okEl.classList.remove('show');
    const competencias = Object.keys(GCOMP_LABELS).map(area => ({
      area,
      nota_gestora: parseInt(document.getElementById(`gnsel_${area}`)?.dataset.selected || '0'),
      comentario: (document.getElementById(`gcmt_${area}`)?.value || '').trim() || undefined,
    })).filter(c => c.nota_gestora > 0);
    if (!competencias.length) { if (errEl) { errEl.textContent = 'Avalie ao menos uma competência.'; errEl.classList.add('show'); } return; }
    const d = await callDiplomas({ action: 'pdi_competencias_gerente', pdi_id: pdiId, competencias });
    if (d.error) { if (errEl) { errEl.textContent = d.error; errEl.classList.add('show'); } }
    else { if (okEl) { okEl.textContent = '✅ Avaliação salva!'; okEl.classList.add('show'); } }
  }

  async function aprovaPdi(pdiId) {
    const feedback = (document.getElementById('pdiAprovFeedback')?.value || '').trim();
    const errEl = document.getElementById('pdiAprovErr');
    const d = await callDiplomas({ action: 'pdi_aprovar', pdi_id: pdiId, feedback: feedback || undefined });
    if (d.error) { if (errEl) { errEl.textContent = d.error; errEl.classList.add('show'); } return; }
    closePdiReview(); await loadPdiPainel();
  }

  async function rejeitaPdi(pdiId) {
    const feedback = (document.getElementById('pdiAprovFeedback')?.value || '').trim();
    const errEl = document.getElementById('pdiAprovErr');
    if (!feedback) { if (errEl) { errEl.textContent = 'Informe o motivo da devolução.'; errEl.classList.add('show'); } return; }
    const d = await callDiplomas({ action: 'pdi_rejeitar', pdi_id: pdiId, feedback });
    if (d.error) { if (errEl) { errEl.textContent = d.error; errEl.classList.add('show'); } return; }
    closePdiReview(); await loadPdiPainel();
  }

  async function encerrarPdi(pdiId) {
    const errEl = document.getElementById('pdiEncErr');
    if (errEl) errEl.classList.remove('show');
    const nota_final = parseInt(document.getElementById('pdiNotaFinalSel')?.dataset.selected || '0');
    const feedback   = (document.getElementById('pdiEncFeedback')?.value || '').trim();
    if (!nota_final) { if (errEl) { errEl.textContent = 'Selecione a nota final (1-4).'; errEl.classList.add('show'); } return; }
    if (!feedback)   { if (errEl) { errEl.textContent = 'Informe o feedback final.'; errEl.classList.add('show'); } return; }
    const d = await callDiplomas({ action: 'pdi_nota_final', pdi_id: pdiId, nota_final, feedback_gestora: feedback });
    if (d.error) { if (errEl) { errEl.textContent = d.error; errEl.classList.add('show'); } return; }
    closePdiReview(); await loadPdiPainel();
  }

  async function saveCheckinFb(acompId) {
    const val = (document.getElementById(`chkFb_${acompId}`)?.value || '').trim();
    if (!val) return;
    const d = await callDiplomas({ action: 'pdi_checkin_feedback', acompanhamento_id: acompId, feedback_gestora: val });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    if (pdiReviewData) await openPdiReview(pdiReviewData.id);
  }
