// Auto-extraído do gerente.html (Onda 4 — batch final).
// Séries CRUD + Recursos & Reservas + Grade semanal
  // ── SÉRIES ────────────────────────────────────────────
  async function loadSeries() {
    const data = await api({ action:'series_list_all' });
    const el = document.getElementById('seriesList');
    const list = Array.isArray(data)?data:[];
    document.getElementById('seriesCount').textContent = list.length;
    if(!list.length){ el.innerHTML='<div class="list-row"><span style="color:var(--muted);font-size:13px;">Nenhuma série.</span></div>'; return; }
    el.innerHTML = list.map(s=>
      `<div class="list-row">
        <div class="list-avatar" style="border-radius:8px;width:32px;height:32px;font-size:12px;">${s.ordem}</div>
        <div class="lr-main"><strong>${esc(s.nome)}</strong><span>${s.ativo?'Ativa':'Inativa'}</span></div>
        <button class="action-btn" onclick="openSerieEdit('${s.id}','${esc(s.nome)}',${s.ordem},${s.aviso_requisicao_mensal !== false})">✎</button>
        <button class="action-btn del" onclick="deleteSerie('${s.id}','${esc(s.nome)}')">🗑</button>
      </div>`
    ).join('');
  }
  async function createSerie() {
    const nome=document.getElementById('newSerieNome').value.trim(), ordem=parseInt(document.getElementById('newSerieOrdem').value)||99;
    if(!nome) return showAlert('serie','error','Informe o nome.');
    const d = await api({ action:'series_create', nome, ordem });
    if(d.error) return showAlert('serie','error',d.error);
    document.getElementById('newSerieNome').value=''; document.getElementById('newSerieOrdem').value='';
    showAlert('serie','success','✅ Série "'+nome+'" criada!'); loadSeries();
  }
  function openSerieEdit(id,nome,ordem,avisoMensal){
    editingSerieId=id;
    document.getElementById('editSerieNome').value=nome;
    document.getElementById('editSerieOrdem').value=ordem;
    document.getElementById('editSerieAvisoMensal').checked = avisoMensal !== false;
    document.getElementById('serieModal').classList.add('show');
  }
  function closeSerieModal(){ document.getElementById('serieModal').classList.remove('show'); editingSerieId=null; }
  async function saveSerieEdit() {
    const nome=document.getElementById('editSerieNome').value.trim(), ordem=parseInt(document.getElementById('editSerieOrdem').value)||99;
    const avisoMensal = document.getElementById('editSerieAvisoMensal').checked;
    if(!nome||!editingSerieId) return;
    await api({ action:'series_update', id:editingSerieId, nome, ordem, ativo:true, aviso_requisicao_mensal: avisoMensal });
    closeSerieModal(); loadSeries();
  }
  async function deleteSerie(id,nome){
    if(!await _lumiedConfirm('Remover "'+nome+'"?')) return;
    let r = await api({ action:'series_delete', id });
    if (r?.error && /aluno\(s\) vinculado/i.test(r.error)) {
      if (!await _lumiedConfirm(r.error + '\n\nDeseja excluir mesmo assim?')) { loadSeries(); return; }
      r = await api({ action:'series_delete', id, force: true });
    }
    if (r?.error) showToast('Erro: ' + r.error, 'error');
    loadSeries();
  }

  // ── Recursos & Reservas ────────────────────────────────
  var _recursosCache = [];
  var _reservasCache = [];

  async function loadRecursos() {
    const dRec = await api({ action: 'recursos_list' });
    _recursosCache = dRec.data || [];
    const list = _recursosCache;
    loadRecursosAnalytics();
    const el = document.getElementById('recursosList');
    if (!list.length) { el.innerHTML = '<div class="empty-state">Nenhum recurso cadastrado.</div>'; }
    else {
      el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">' + list.map(r => `
        <div style="background:#fff;border:1px solid ${r.ativo ? 'var(--border)' : '#e5e7eb'};border-radius:10px;padding:12px;${!r.ativo ? 'opacity:.55;' : ''}">
          <div style="font-size:11px;text-transform:uppercase;color:var(--muted);font-weight:600;">${esc(r.tipo)}${r.fixo ? ' · fixo' : ''}</div>
          <div style="font-weight:600;font-size:14px;margin:4px 0;">${esc(r.identificacao)}</div>
          <div style="font-size:11px;color:var(--muted);">${esc(r.modelo || '—')} · ${esc(r.localizacao || '—')}</div>
          ${(r.tempo_carga_min || r.buffer_pos_uso_min) ? `<div style="font-size:10px;color:#6b7280;margin-top:4px;">⏱ ${r.tempo_carga_min ? r.tempo_carga_min + 'min carga · ' : ''}${r.buffer_pos_uso_min || 0}min margem</div>` : ''}
          ${r.permite_sobreposicao ? `<div style="font-size:10px;color:#059669;margin-top:2px;">🔓 Sobreposição permitida</div>` : ''}
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
            <button onclick="abrirModalEditarRecurso('${r.id}')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Editar</button>
            <button onclick="deletarRecurso('${r.id}','${esc(r.identificacao)}')" style="background:none;border:1px solid #fed7aa;color:#b5591a;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Remover</button>
          </div>
        </div>`).join('') + '</div>';
    }
    loadReservas();
    _renderReservaGrid();
  }

  async function loadReservas() {
    const desde = new Date().toISOString();
    const ate = new Date(Date.now() + 30 * 86400000).toISOString();
    const d = await api({ action: 'reservas_list', desde, ate });
    const list = (d.data || []).filter(r => r.status === 'ativa');
    _reservasCache = list;
    const el = document.getElementById('reservasList');
    if (!list.length) { el.innerHTML = '<div class="empty-state">Nenhuma reserva próxima.</div>'; return; }
    const _fmtHM = (d) => new Date(d).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
    el.innerHTML = list.map(r => {
      const ini = _fmtHM(r.inicio);
      const fim = _fmtHM(r.fim);
      const carga = r.recursos?.tempo_carga_min || 0;
      const buffer = r.recursos?.buffer_pos_uso_min || 0;
      const temMargem = carga > 0 || buffer > 0;
      let margemHtml = '';
      if (temMargem) {
        const iniEfetivo = new Date(new Date(r.inicio).getTime() - carga * 60000);
        const fimEfetivo = new Date(new Date(r.fim).getTime() + buffer * 60000);
        const partes = [];
        if (carga > 0) partes.push(`${carga}min preparo antes`);
        if (buffer > 0) partes.push(`${buffer}min margem após`);
        margemHtml = `<div style="font-size:10px;color:#92400e;background:#fef3c7;border-radius:4px;padding:2px 6px;margin-top:3px;display:inline-block;">🔒 Indisponível ${_fmtHM(iniEfetivo)} → ${_fmtHM(fimEfetivo)} (${partes.join(' + ')})</div>`;
      }
      const ehSerie = r.serie_id || ['semanal','diaria'].includes(r.recorrencia);
      const idCancelar = r.serie_id || r.id;
      const badge = ehSerie ? '<span style="background:#dbeafe;color:#1e40af;font-size:9px;padding:1px 6px;border-radius:8px;margin-left:6px;font-weight:600;">🔁 série</span>' : '';
      return `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-weight:600;font-size:13px;">${esc(r.recursos?.identificacao || '—')} <span style="font-size:11px;color:var(--muted);">· ${esc(r.recursos?.tipo || '')}</span>${badge}</div>
          <div style="font-size:11px;color:var(--muted);">📅 ${ini} → ${fim}${r.series ? ' · turma ' + esc(r.series.nome) : ''}${r.observacao ? ' · ' + esc(r.observacao) : ''}</div>
          ${margemHtml}
        </div>
        <div style="display:flex;gap:6px;">
          <button onclick="abrirModalEditarReserva('${r.id}')" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Editar</button>
          <button onclick="cancelarReserva('${r.id}', ${ehSerie})" style="background:none;border:1px solid #e53e3e;color:#e53e3e;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Cancelar</button>
        </div>
      </div>`;
    }).join('');
  }

  // ── Grade semanal de reservas ────────────────────────────
  var _reservaGridOffset = 0;
  function _reservaGridSemana(dir) {
    if (dir === 0) _reservaGridOffset = 0;
    else _reservaGridOffset += dir;
    _renderReservaGrid();
  }
  async function _renderReservaGrid() {
    const hoje = new Date();
    const dow = hoje.getDay() || 7;
    const seg = new Date(hoje);
    seg.setDate(seg.getDate() - (dow - 1) + _reservaGridOffset * 7);
    seg.setHours(0, 0, 0, 0);
    const dom = new Date(seg);
    dom.setDate(dom.getDate() + 6);
    dom.setHours(23, 59, 59, 999);
    const label = document.getElementById('reservaGridSemanaLabel');
    if (label) label.textContent = `${seg.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' })} — ${dom.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' })}`;

    const d = await api({ action: 'reservas_list', desde: seg.toISOString(), ate: dom.toISOString() });
    const list = (d.data || []).filter(r => r.status === 'ativa');

    const dias = [[], [], [], [], []];
    list.forEach(r => {
      const dIni = new Date(r.inicio);
      const dIdx = dIni.getDay() - 1;
      if (dIdx >= 0 && dIdx <= 4) dias[dIdx].push(r);
    });

    const fmtH = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    for (let i = 0; i < 5; i++) {
      const countEl = document.getElementById('rCount_' + i);
      const listEl = document.getElementById('rList_' + i);
      if (!countEl || !listEl) continue;
      const items = dias[i].sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
      countEl.textContent = items.length;
      if (!items.length) { listEl.innerHTML = '<div class="dia-vazio">Sem reservas</div>'; continue; }
      listEl.innerHTML = items.map(r => {
        const carga = r.recursos?.tempo_carga_min || 0;
        const buffer = r.recursos?.buffer_pos_uso_min || 0;
        const temMargem = carga > 0 || buffer > 0;
        let margemTag = '';
        if (temMargem) {
          const iniEf = fmtH(new Date(new Date(r.inicio).getTime() - carga * 60000).toISOString());
          const fimEf = fmtH(new Date(new Date(r.fim).getTime() + buffer * 60000).toISOString());
          margemTag = `<span style="font-size:9px;color:#92400e;background:#fef3c7;padding:0 4px;border-radius:3px;margin-left:4px;">🔒 ${iniEf}–${fimEf}</span>`;
        }
        const sobrep = r.recursos?.permite_sobreposicao ? '<span style="font-size:9px;color:#059669;margin-left:4px;" title="Sobreposição permitida">🔓</span>' : '';
        return `<div class="dia-crianca-item">
          <div class="dia-crianca-dot"></div>
          <div class="dia-crianca-info">
            <strong>${fmtH(r.inicio)}–${fmtH(r.fim)} · ${esc(r.recursos?.identificacao || '—')}${sobrep}</strong>
            <span>${esc(r.recursos?.tipo || '')}${r.series ? ' · ' + esc(r.series.nome) : ''}${r.observacao ? ' · ' + esc(r.observacao) : ''}${margemTag}</span>
          </div>
        </div>`;
      }).join('');
    }
    if (typeof _buildMobileTabs === 'function' && _isMobile) {
      const counts = dias.map(d => d.length);
      _buildMobileTabs('reservasSemanaGrid', ['Segunda','Terça','Quarta','Quinta','Sexta'], counts);
    }
  }

  // Defaults sugeridos por tipo (alinhados com mig 287)
  const _RECURSO_DEFAULTS = {
    tablet:     { carga: 30, buffer: 15 },
    projetor:   { carga: 5,  buffer: 10 },
    sala:       { carga: 10, buffer: 15 },
    impressora: { carga: 0,  buffer: 5  },
    outro:      { carga: 0,  buffer: 15 },
  };
  function _aplicaDefaultsRecurso() {
    const tipo = document.getElementById('recursoTipo').value;
    const cargaEl = document.getElementById('recursoCarga');
    const bufEl = document.getElementById('recursoBuffer');
    const def = _RECURSO_DEFAULTS[tipo] || _RECURSO_DEFAULTS.outro;
    if (!cargaEl.value) cargaEl.value = def.carga;
    if (!bufEl.value) bufEl.value = def.buffer;
  }

  function abrirModalNovoRecurso() {
    document.getElementById('recursoId').value = '';
    document.getElementById('recursoTipo').value = 'tablet';
    document.getElementById('recursoIdent').value = '';
    document.getElementById('recursoModelo').value = '';
    document.getElementById('recursoLocal').value = '';
    document.getElementById('recursoFixo').checked = false;
    document.getElementById('recursoSobreposicao').checked = false;
    document.getElementById('recursoCarga').value = '';
    document.getElementById('recursoBuffer').value = '';
    document.getElementById('recursoObs').value = '';
    document.getElementById('recursoModalTitle').textContent = 'Novo Recurso';
    document.getElementById('recursoModal').classList.add('show');
    _aplicaDefaultsRecurso();
    // Preenche defaults quando troca tipo (só se vazio — não sobrescreve user)
    document.getElementById('recursoTipo').onchange = _aplicaDefaultsRecurso;
  }
  function abrirModalEditarRecurso(id) {
    const r = _recursosCache.find(x => x.id === id);
    if (!r) return;
    document.getElementById('recursoId').value = r.id;
    document.getElementById('recursoTipo').value = r.tipo;
    document.getElementById('recursoIdent').value = r.identificacao;
    document.getElementById('recursoModelo').value = r.modelo || '';
    document.getElementById('recursoLocal').value = r.localizacao || '';
    document.getElementById('recursoFixo').checked = !!r.fixo;
    document.getElementById('recursoSobreposicao').checked = !!r.permite_sobreposicao;
    document.getElementById('recursoCarga').value = r.tempo_carga_min ?? '';
    document.getElementById('recursoBuffer').value = r.buffer_pos_uso_min ?? '';
    document.getElementById('recursoObs').value = r.observacao || '';
    document.getElementById('recursoModalTitle').textContent = 'Editar Recurso';
    document.getElementById('recursoModal').classList.add('show');
    document.getElementById('recursoTipo').onchange = _aplicaDefaultsRecurso;
  }
  function fecharRecursoModal() { document.getElementById('recursoModal').classList.remove('show'); }

  async function salvarRecurso() {
    const id = document.getElementById('recursoId').value || null;
    const carga = document.getElementById('recursoCarga').value;
    const buffer = document.getElementById('recursoBuffer').value;
    const payload = {
      action: 'recursos_save', id,
      tipo: document.getElementById('recursoTipo').value,
      identificacao: document.getElementById('recursoIdent').value.trim(),
      modelo: document.getElementById('recursoModelo').value.trim() || null,
      localizacao: document.getElementById('recursoLocal').value.trim() || null,
      fixo: document.getElementById('recursoFixo').checked,
      permite_sobreposicao: document.getElementById('recursoSobreposicao').checked,
      observacao: document.getElementById('recursoObs').value.trim() || null,
      tempo_carga_min: carga !== '' ? parseInt(carga) : undefined,
      buffer_pos_uso_min: buffer !== '' ? parseInt(buffer) : undefined,
    };
    if (!payload.identificacao) { showToast('Informe a identificação.', 'warning'); return; }
    const d = await api(payload);
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    fecharRecursoModal();
    loadRecursos();
  }

  async function deletarRecurso(id, ident) {
    if (!await _lumiedConfirm(`Remover recurso "${ident}"? Reservas ativas associadas serão apagadas em cascata.`)) return;
    const d = await api({ action: 'recursos_delete', id });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    loadRecursos();
  }

  function reservaAtualizarInfoRecurso() {
    const wrap = document.getElementById('reservaRecursosWrap');
    const checked = Array.from(wrap.querySelectorAll('input[type=checkbox]:checked'));
    const info = document.getElementById('reservaInfoRecurso');
    if (!checked.length) { info.innerHTML = ''; return; }
    const partes = [];
    checked.forEach(cb => {
      const r = _recursosCache.find(x => x.id === cb.value);
      if (!r) return;
      const p = [];
      if (r.tempo_carga_min > 0) p.push(`${r.tempo_carga_min}min carga`);
      if (r.buffer_pos_uso_min > 0) p.push(`${r.buffer_pos_uso_min}min buffer`);
      if (p.length) partes.push(`<strong>${esc(r.identificacao)}</strong>: ${p.join(' + ')}`);
    });
    info.innerHTML = partes.length
      ? `Margens de segurança: ${partes.join(' · ')}`
      : '';
  }

  function _renderRecursosCheckboxes(selectedIds) {
    const wrap = document.getElementById('reservaRecursosWrap');
    const ativos = _recursosCache.filter(r => r.ativo);
    const sel = new Set(Array.isArray(selectedIds) ? selectedIds : []);
    wrap.innerHTML = ativos.length
      ? ativos.map(r => `<label style="display:flex;align-items:center;gap:8px;padding:5px 2px;cursor:pointer;font-size:13px;border-bottom:1px solid #f0ece6;">
          <input type="checkbox" value="${r.id}" ${sel.has(r.id) ? 'checked' : ''} onchange="reservaAtualizarInfoRecurso()" style="width:16px;height:16px;cursor:pointer;flex-shrink:0;">
          <span>${esc(r.tipo)} · <strong>${esc(r.identificacao)}</strong>${r.localizacao ? ' <span style=color:var(--muted)>(' + esc(r.localizacao) + ')</span>' : ''}</span>
        </label>`).join('')
      : '<span style="font-size:12px;color:var(--muted);">Nenhum recurso ativo.</span>';
    reservaAtualizarInfoRecurso();
  }

  async function _ensureTurmaSelect() {
    const turmaSel = document.getElementById('reservaTurma');
    if (turmaSel.options.length <= 1) {
      const t = await api({ action: 'series_list_all' });
      (Array.isArray(t) ? t : []).forEach(s => turmaSel.add(new Option(s.nome, s.id)));
    }
  }

  async function abrirModalNovaReserva() {
    if (!_recursosCache.length) await loadRecursos();
    document.getElementById('reservaEditId').value = '';
    document.getElementById('reservaModalTitle').textContent = '📅 Nova reserva';
    document.getElementById('reservaBtnSalvar').textContent = 'Reservar';
    _renderRecursosCheckboxes([]);
    await _ensureTurmaSelect();
    document.getElementById('reservaTurma').value = '';
    document.getElementById('reservaInicio').value = '';
    document.getElementById('reservaFim').value = '';
    document.getElementById('reservaObs').value = '';
    document.getElementById('reservaRecorrenciaBloco').style.display = '';
    document.getElementById('reservaRecorrencia').checked = false;
    document.getElementById('reservaRecorrenciaWrap').style.display = 'none';
    document.getElementById('reservaErr').style.display = 'none';
    const okEl = document.getElementById('reservaResultadoOk');
    if (okEl) okEl.style.display = 'none';
    document.getElementById('reservaModal').classList.add('show');
  }

  async function abrirModalEditarReserva(id) {
    if (!_recursosCache.length) await loadRecursos();
    const r = _reservasCache.find(x => x.id === id);
    if (!r) { showToast('Reserva não encontrada.', 'error'); return; }
    document.getElementById('reservaEditId').value = id;
    document.getElementById('reservaModalTitle').textContent = '✏️ Editar reserva';
    document.getElementById('reservaBtnSalvar').textContent = 'Salvar alterações';
    _renderRecursosCheckboxes([r.recurso_id]);
    await _ensureTurmaSelect();
    document.getElementById('reservaTurma').value = r.turma_id || '';
    // Formatar datas para datetime-local (YYYY-MM-DDTHH:mm)
    const fmtDT = (iso) => iso ? iso.slice(0, 16) : '';
    document.getElementById('reservaInicio').value = fmtDT(r.inicio);
    document.getElementById('reservaFim').value = fmtDT(r.fim);
    document.getElementById('reservaObs').value = r.observacao || '';
    // Esconder recorrência no modo edição (edita só esta ocorrência)
    document.getElementById('reservaRecorrenciaBloco').style.display = 'none';
    document.getElementById('reservaRecorrencia').checked = false;
    document.getElementById('reservaRecorrenciaWrap').style.display = 'none';
    document.getElementById('reservaErr').style.display = 'none';
    const okEl = document.getElementById('reservaResultadoOk');
    if (okEl) okEl.style.display = 'none';
    document.getElementById('reservaModal').classList.add('show');
  }
  function fecharReservaModal() { document.getElementById('reservaModal').classList.remove('show'); }

  function _buildReservaPreview(recurso_ids, inicio, fim) {
    const iniDate = new Date(inicio);
    const fimDate = new Date(fim);
    const fmt = (d) => d.toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
    const recursos = recurso_ids.map(id => _recursosCache.find(x => x.id === id)).filter(Boolean);
    const linhas = recursos.map(r => {
      const carga = r.tempo_carga_min || 0;
      const buffer = r.buffer_pos_uso_min || 0;
      if (!carga && !buffer) return null;
      const iniEf = new Date(iniDate.getTime() - carga * 60000);
      const fimEf = new Date(fimDate.getTime() + buffer * 60000);
      const detalhes = [];
      if (carga > 0) detalhes.push(`${carga}min preparo antes`);
      if (buffer > 0) detalhes.push(`${buffer}min margem após`);
      return { nome: r.identificacao, tipo: r.tipo, iniEf, fimEf, detalhes, carga, buffer };
    }).filter(Boolean);
    return { linhas, fmt, iniDate, fimDate };
  }

  function _confirmarReservaComMargens(recurso_ids, inicio, fim) {
    return new Promise(resolve => {
      const { linhas, fmt, iniDate, fimDate } = _buildReservaPreview(recurso_ids, inicio, fim);
      if (!linhas.length) { resolve(true); return; }
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1200;display:flex;align-items:center;justify-content:center;padding:20px;';
      const rows = linhas.map(l => `
        <tr style="border-bottom:1px solid #f0ece6;">
          <td style="padding:6px 8px;font-size:12px;font-weight:600;">${esc(l.nome)}</td>
          <td style="padding:6px 8px;font-size:11px;color:var(--muted);">${esc(l.tipo)}</td>
          <td style="padding:6px 8px;font-size:12px;">📅 ${fmt(iniDate)} → ${fmt(fimDate)}</td>
          <td style="padding:6px 8px;font-size:12px;color:#92400e;font-weight:600;">🔒 ${fmt(l.iniEf)} → ${fmt(l.fimEf)}</td>
          <td style="padding:6px 8px;font-size:10px;color:var(--muted);">${l.detalhes.join(' + ')}</td>
        </tr>`).join('');
      overlay.innerHTML = `<div style="background:#fff;border-radius:14px;padding:22px;max-width:620px;width:100%;">
        <h3 style="font-family:'Lora',serif;font-size:16px;margin-bottom:6px;">⚠️ Atenção: margens de segurança</h3>
        <p style="font-size:12px;color:var(--muted);margin-bottom:12px;">O(s) recurso(s) abaixo possuem tempo de preparo e/ou margem pós-uso. O horário real de indisponibilidade será <strong>diferente</strong> do horário que você agendou:</p>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
            <thead><tr style="background:#f9f7f4;">
              <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted);">Recurso</th>
              <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted);">Tipo</th>
              <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted);">Horário agendado</th>
              <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted);">Indisponível de/até</th>
              <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted);">Motivo</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="_prevCancelar" style="padding:8px 18px;background:#fff;border:1.5px solid var(--border);border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;">Voltar</button>
          <button id="_prevConfirmar" style="padding:8px 18px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;">Confirmar reserva</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#_prevCancelar').onclick = () => { overlay.remove(); resolve(false); };
      overlay.querySelector('#_prevConfirmar').onclick = () => { overlay.remove(); resolve(true); };
      overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
    });
  }

  async function salvarReserva() {
    const errEl = document.getElementById('reservaErr');
    const okEl = document.getElementById('reservaResultadoOk');
    errEl.style.display = 'none';
    if (okEl) okEl.style.display = 'none';
    const editId = document.getElementById('reservaEditId').value;
    const recorrente = !editId && document.getElementById('reservaRecorrencia').checked;
    const wrap = document.getElementById('reservaRecursosWrap');
    const recurso_ids = Array.from(wrap.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
    const inicio = document.getElementById('reservaInicio').value;
    const fim = document.getElementById('reservaFim').value;
    const turma_id = document.getElementById('reservaTurma').value || null;
    const observacao = document.getElementById('reservaObs').value.trim() || null;
    if (!recurso_ids.length || !inicio || !fim) {
      errEl.textContent = 'Selecione ao menos um recurso e defina início e fim.';
      errEl.style.display = 'block';
      return;
    }
    // Popup de confirmação se algum recurso tem margens
    const confirmou = await _confirmarReservaComMargens(recurso_ids, inicio, fim);
    if (!confirmou) return;
    // Modo edição: atualiza uma reserva existente
    if (editId) {
      if (recurso_ids.length > 1) {
        errEl.textContent = 'Ao editar, selecione apenas um recurso.';
        errEl.style.display = 'block';
        return;
      }
      const d = await api({ action: 'reservas_editar', id: editId, recurso_id: recurso_ids[0], turma_id, inicio, fim, observacao });
      if (d.error) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }
      fecharReservaModal();
      showToast('Reserva atualizada.', 'success');
      loadReservas();
      loadRecursosAnalytics();
      return;
    }
    if (recorrente) {
      const recAte = document.getElementById('reservaRecorrenciaAte').value;
      if (!recAte) {
        errEl.textContent = 'Defina até quando a reserva se repete.';
        errEl.style.display = 'block';
        return;
      }
    }
    // Reservar cada recurso selecionado
    let totalCriadas = 0, totalPuladas = 0;
    const erros = [];
    for (const rid of recurso_ids) {
      const payload = { action: 'reservas_criar', recurso_id: rid, turma_id, inicio, fim, observacao };
      if (recorrente) {
        payload.recorrencia = document.getElementById('reservaRecorrenciaTipo').value;
        payload.recorrencia_ate = document.getElementById('reservaRecorrenciaAte').value;
      }
      const d = await api(payload);
      if (d.error) {
        const r = _recursosCache.find(x => x.id === rid);
        erros.push(r ? r.identificacao : rid);
      } else {
        totalCriadas += (d.criadas || 1);
        totalPuladas += (d.puladas || 0);
      }
    }
    if (erros.length === recurso_ids.length) {
      errEl.textContent = 'Conflito em todos os recursos selecionados.';
      errEl.style.display = 'block';
      return;
    }
    if (okEl) {
      const msgs = [`✅ ${totalCriadas} reserva(s) criada(s)`];
      if (totalPuladas) msgs.push(`${totalPuladas} pulada(s) por conflito`);
      if (erros.length) msgs.push(`⚠️ Conflito: ${erros.join(', ')}`);
      okEl.textContent = msgs.join(' · ');
      okEl.style.display = 'block';
      setTimeout(() => { fecharReservaModal(); loadReservas(); }, 2400);
    } else {
      fecharReservaModal();
      loadReservas();
    }
  }

  async function cancelarReserva(id, temSerie) {
    let modo = 'unica';
    if (temSerie) {
      const escolha = await new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1200;display:flex;align-items:center;justify-content:center;padding:20px;';
        overlay.innerHTML = `<div style="background:#fff;border-radius:14px;padding:22px;max-width:420px;width:100%;">
          <h3 style="font-family:'Lora',serif;font-size:16px;margin-bottom:12px;">Cancelar reserva recorrente</h3>
          <p style="font-size:13px;color:var(--muted);margin-bottom:14px;">Esta reserva faz parte de uma série. O que cancelar?</p>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button onclick="this.closest('div[style]').parentElement.dispatchEvent(new CustomEvent('escolha',{detail:'unica'}))" style="padding:10px 16px;background:#fff;border:1.5px solid var(--border);border-radius:8px;cursor:pointer;text-align:left;font-family:inherit;font-size:13px;">Apenas esta ocorrência</button>
            <button onclick="this.closest('div[style]').parentElement.dispatchEvent(new CustomEvent('escolha',{detail:'serie'}))" style="padding:10px 16px;background:#e53e3e;color:#fff;border:none;border-radius:8px;cursor:pointer;text-align:left;font-family:inherit;font-size:13px;font-weight:600;">Toda a série (todas ocorrências futuras)</button>
            <button onclick="this.closest('div[style]').parentElement.dispatchEvent(new CustomEvent('escolha',{detail:null}))" style="padding:8px 16px;background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;font-family:inherit;">Voltar</button>
          </div>
        </div>`;
        overlay.addEventListener('escolha', e => { overlay.remove(); resolve(e.detail); });
        document.body.appendChild(overlay);
      });
      if (!escolha) return;
      modo = escolha;
    } else {
      if (!await _lumiedConfirm('Cancelar esta reserva?')) return;
    }
    const d = await api({ action: 'reservas_cancelar', id, serie: modo === 'serie' });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast(modo === 'serie' ? 'Série cancelada.' : 'Reserva cancelada.', 'success');
    loadReservas();
    loadRecursosAnalytics();
  }

