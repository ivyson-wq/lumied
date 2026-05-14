// Auto-extraído do gerente.html (Onda 4 — mega batch).
// Professoras + Reuniões + Controle Acesso + Inventário Simpax + Mapa Terminais
  // ── PROFESSORAS ───────────────────────────────────────
  async function loadProfessoras() {
    const [profs, almocoConf] = await Promise.all([
      api({ action:'professoras_list' }),
      api({ action:'config_get', chave:'almoco_preco' })
    ]);
    const list = Array.isArray(profs) ? profs : [];
    document.getElementById('profsCount').textContent = list.length;
    const el = document.getElementById('profsList');
    if (!list.length) {
      el.innerHTML = '<div class="list-row"><span style="color:var(--muted);font-size:13px;">Nenhuma professora cadastrada.</span></div>';
    } else {
      el.innerHTML = list.map(p => `
        <div class="list-row">
          <div class="lr-main">
            <strong>${esc(p.nome)}</strong>
            <span>${esc(p.email)}</span>
          </div>
          <button class="action-btn" onclick="openSenhaModal('${p.id}','${esc(p.nome)}')" title="Definir senha do portal">🔑 Senha</button>
          <button class="action-btn del" onclick="deleteProfessora('${p.id}','${esc(p.nome)}')">🗑</button>
        </div>`).join('');
    }
    // Preenche preço do almoço
    document.getElementById('almocoPreco').value = almocoConf?.valor || '50.00';
  }

  async function createProfessora() {
    const nome  = document.getElementById('newProfNome').value.trim();
    const email = document.getElementById('newProfEmail').value.trim();
    if (!nome || !email) return showAlert('prof','error','Nome e e-mail são obrigatórios.');
    const d = await api({ action:'professoras_create', nome, email });
    if (d.error) return showAlert('prof','error', d.error);
    showAlert('prof','success','✅ Professora adicionada!');
    document.getElementById('newProfNome').value = '';
    document.getElementById('newProfEmail').value = '';
    loadProfessoras();
  }

  async function deleteProfessora(id, nome) {
    if (!await _lumiedConfirm('Remover professora "'+nome+'"?')) return;
    await api({ action:'professoras_delete', id });
    loadProfessoras();
  }

  async function saveAlmocoPreco() {
    const preco = parseFloat(document.getElementById('almocoPreco').value);
    if (isNaN(preco) || preco < 0) return showAlert('almoco','error','Informe um valor válido.');
    const d = await api({ action:'config_set', chave:'almoco_preco', valor: preco.toFixed(2) });
    if (d.error) return showAlert('almoco','error', d.error);
    showAlert('almoco','success','✅ Preço salvo!');
  }


  // ── REUNIÕES ──────────────────────────────────────────
  var CALENDAR_URL = SUPABASE_URL + '/functions/v1/calendar';

  async function callCalendar(body) {
    const r = await fetch(CALENDAR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON },
      body: JSON.stringify(body)
    });
    return r.json();
  }

  var DIAS_SEMANA = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];

  async function loadReunioesPanel() {
    await Promise.all([loadReunioesList(), loadGestorasGerente()]);
  }

  async function loadReunioesList() {
    const data = await callCalendar({ action: 'reunioes_list' });
    const list = Array.isArray(data) ? data : [];
    document.getElementById('reunioesCount').textContent = list.length;
    const tb = document.getElementById('reunioesListBody');
    if (!list.length) { tb.innerHTML = '<tr><td colspan="6" class="empty-state">📭 Nenhuma reunião agendada.</td></tr>'; return; }
    tb.innerHTML = list.map(r => {
      const dataFmt = new Date(r.data_reuniao + 'T12:00:00').toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit' });
      return `<tr>
        <td>${dataFmt}</td>
        <td>${r.hora_inicio.substring(0,5)} – ${r.hora_fim.substring(0,5)}</td>
        <td>${esc(r.nome_resp)}<br><small style="color:var(--muted)">${esc(r.email_resp)}</small></td>
        <td>${esc(r.gestoras?.nome||'')}</td>
        <td>${esc(r.assunto||'—')}</td>
        <td><button class="action-btn del" onclick="cancelarReuniaoGerente('${r.id}')">🗑</button></td>
      </tr>`;
    }).join('');
  }

  async function loadGestorasGerente() {
    const data = await callCalendar({ action: 'gestoras_list' });
    const list = Array.isArray(data) ? data : [];
    const cargos = { diretora: 'Diretora Pedagógica', coordenadora: 'Coordenadora Pedagógica' };

    document.getElementById('gestorasGerente').innerHTML = list.map(g => `
      <div class="form-card" style="margin-bottom:12px;">
        <h3>${cargos[g.cargo]||g.cargo}</h3>
        <div class="ff"><label>Nome</label><input type="text" id="gnome_${g.id}" value="${esc(g.nome)}"></div>
        <div class="ff"><label>E-mail</label><input type="email" id="gemail_${g.id}" value="${esc(g.email)}"></div>
        <div class="ff"><label>Google Calendar ID</label><input type="text" id="gcal_${g.id}" value="${esc(g.calendar_id||'')}"><div class="hint">Geralmente o próprio e-mail da gestora.</div></div>
        <button class="btn-create" onclick="saveGestora('${g.id}')">Salvar</button>
      </div>`).join('');

    // Popula select de gestoras para horários
    const sel = document.getElementById('gestoraSlotSelect');
    sel.innerHTML = '<option value="">Selecione a gestora…</option>' +
      list.map(g => `<option value="${g.id}">${g.nome} (${cargos[g.cargo]||g.cargo})</option>`).join('');
  }

  async function saveGestora(id) {
    const nome       = document.getElementById('gnome_' + id).value.trim();
    const email      = document.getElementById('gemail_' + id).value.trim();
    const calendar_id = document.getElementById('gcal_' + id).value.trim();
    const d = await callCalendar({ action: 'gestoras_update', id, nome, email, calendar_id });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast('Salvo com sucesso!', 'success');
  }

  async function loadHorariosList() {
    const gestora_id = document.getElementById('gestoraSlotSelect').value;
    const el = document.getElementById('horariosList');
    if (!gestora_id) { el.innerHTML = ''; return; }
    const data = await callCalendar({ action: 'horarios_list', gestora_id });
    const list = Array.isArray(data) ? data : [];
    if (!list.length) { el.innerHTML = '<div class="list-row"><span style="color:var(--muted);font-size:13px;">Nenhum horário cadastrado.</span></div>'; return; }
    el.innerHTML = list.map(h => `
      <div class="list-row">
        <div class="lr-main">
          <strong>${DIAS_SEMANA[h.dia_semana]}</strong>
          <span>${h.hora_inicio.substring(0,5)} – ${h.hora_fim.substring(0,5)}</span>
        </div>
        <button class="action-btn del" onclick="deleteHorario('${h.id}')">🗑</button>
      </div>`).join('');
  }

  async function createHorario() {
    const gestora_id  = document.getElementById('gestoraSlotSelect').value;
    const dia_semana  = parseInt(document.getElementById('newSlotDia').value);
    const hora_inicio = document.getElementById('newSlotInicio').value;
    const hora_fim    = document.getElementById('newSlotFim').value;
    if (!gestora_id) return showAlert('horario', 'error', 'Selecione a gestora.');
    if (!hora_inicio || !hora_fim) return showAlert('horario', 'error', 'Informe início e fim.');
    if (hora_inicio >= hora_fim) return showAlert('horario', 'error', 'O horário de início deve ser antes do fim.');
    const d = await callCalendar({ action: 'horarios_create', gestora_id, dia_semana, hora_inicio, hora_fim });
    if (d.error) return showAlert('horario', 'error', d.error);
    showAlert('horario', 'success', '✅ Horário adicionado!');
    loadHorariosList();
  }

  async function deleteHorario(id) {
    if (!await _lumiedConfirm('Remover este horário?')) return;
    await callCalendar({ action: 'horarios_delete', id });
    loadHorariosList();
  }

  async function cancelarReuniaoGerente(id) {
    if (!await _lumiedConfirm('Cancelar esta reunião?')) return;
    await callCalendar({ action: 'cancelar_reuniao', id });
    loadReunioesList();
  }

  // ── CONTROLE DE ACESSO ────────────────────────────────
  var ACESSO_FACE = SUPABASE_URL + '/functions/v1/acesso';

  async function callAcesso(body) {
    // Solicitações/autorizados usam /api, Face Control ID usa /acesso
    const isFaceAction = typeof body.action === 'string' && body.action.startsWith('acesso_');
    const url = isFaceAction ? ACESSO_FACE : API;
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', 'apikey': ANON };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    try {
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...body, _token: token }) });
      const d = await r.json();
      if (!r.ok && !d.error) d.error = d.message || `Erro ${r.status}`;
      if (d.error === 'Sessão inválida ou expirada. Faça login novamente.' && body.action !== 'solicitacoes_list') { doLogout(); }
      return d;
    } catch (e) {
      return { error: 'Falha de conexão com o servidor.' };
    }
  }

  async function loadAcesso() {
    carregarSolicitacoes();
    carregarAutorizados();
  }

  async function carregarSolicitacoes() {
    document.getElementById('solicitacoesWrap').innerHTML =
      '<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px;"><span class="spinner-sm"></span> Carregando…</div>';
    const d = await callAcesso({ action: 'solicitacoes_list' });
    if (d.error) {
      document.getElementById('solicitacoesWrap').innerHTML =
        `<p style="text-align:center;padding:16px;color:var(--red);font-size:13px;">Erro ao carregar solicitações: ${escHtml(d.error)}</p>`;
      return;
    }
    const lista = d.data || [];
    document.getElementById('acessoBadge').textContent = lista.length;

    if (lista.length === 0) {
      document.getElementById('solicitacoesWrap').innerHTML =
        '<p style="text-align:center;padding:16px;color:var(--muted);font-size:13px;">Nenhuma solicitação pendente.</p>';
      return;
    }

    const rows = lista.map(s => `
      <tr style="border-top:1px solid var(--border);">
        <td style="padding:11px 10px;font-weight:500;font-size:13px;">${escHtml(s.nome)}</td>
        <td style="padding:11px 10px;color:var(--muted);font-size:12px;">${escHtml(s.cpf)}</td>
        <td style="padding:11px 10px;font-size:13px;">${escHtml(s.email)}</td>
        <td style="padding:11px 10px;color:var(--muted);font-size:12px;">${escHtml(s.telefone)}</td>
        <td style="padding:11px 10px;color:var(--muted);font-size:12px;">${escHtml(s.nome_crianca)}</td>
        <td style="padding:11px 10px;font-size:12px;color:var(--muted);">${fmtDate(s.criado_em)}</td>
        <td style="padding:11px 10px;white-space:nowrap;">
          <button onclick="acAprovar(${s.id})" style="padding:5px 11px;background:var(--green);color:#fff;border:none;border-radius:6px;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;cursor:pointer;margin-right:5px;">✓ Aprovar</button>
          <button onclick="acRejeitar(${s.id},'${escHtml(s.nome)}')" style="padding:5px 11px;background:transparent;border:1px solid rgba(200,16,46,.35);color:var(--red);border-radius:6px;font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;">✕ Rejeitar</button>
        </td>
      </tr>`).join('');

    document.getElementById('solicitacoesWrap').innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr>
            <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);">Nome</th>
            <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);">CPF</th>
            <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);">E-mail</th>
            <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);">Telefone</th>
            <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);">Criança</th>
            <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);">Data</th>
            <th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  async function acAprovar(id) {
    const d = await callAcesso({ action: 'aprovar', id });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    carregarSolicitacoes();
    carregarAutorizados();
  }

  async function acRejeitar(id, nome) {
    if (!await _lumiedConfirm('Rejeitar solicitação de ' + nome + '?')) return;
    const d = await callAcesso({ action: 'rejeitar', id });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    carregarSolicitacoes();
  }

  async function carregarAutorizados() {
    document.getElementById('autorizadosWrap').innerHTML =
      '<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px;"><span class="spinner-sm"></span> Carregando…</div>';
    const d = await callAcesso({ action: 'list' });
    const lista = d.data || [];

    if (lista.length === 0) {
      document.getElementById('autorizadosWrap').innerHTML =
        '<p style="text-align:center;padding:16px;color:var(--muted);font-size:13px;">Nenhum e-mail autorizado cadastrado.</p>';
      return;
    }

    const rows = lista.map(u => `
      <tr style="border-top:1px solid var(--border);">
        <td style="padding:10px;font-weight:500;font-size:13px;">${escHtml(u.email)}</td>
        <td style="padding:10px;color:var(--muted);font-size:13px;">${escHtml(u.nome || '—')}</td>
        <td style="padding:10px;color:var(--muted);font-size:12px;">${escHtml(u.criado_por || '—')}</td>
        <td style="padding:10px;color:var(--muted);font-size:12px;">${fmtDate(u.criado_em)}</td>
        <td style="padding:10px;"><button onclick="acRemover(${u.id},'${escHtml(u.email)}')" style="padding:4px 10px;background:transparent;border:1px solid rgba(200,16,46,.3);border-radius:6px;color:var(--red);font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;">Remover</button></td>
      </tr>`).join('');

    document.getElementById('autorizadosWrap').innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr>
          <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);">E-mail</th>
          <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);">Nome</th>
          <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);">Adicionado por</th>
          <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);">Data</th>
          <th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  async function acAddUser() {
    const email = document.getElementById('acEmail').value.trim();
    const nome  = document.getElementById('acNome').value.trim();
    const errEl = document.getElementById('acErr');
    const okEl  = document.getElementById('acOk');
    errEl.style.display = 'none'; okEl.style.display = 'none';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEl.textContent = 'Informe um e-mail válido.'; errEl.style.display = 'block'; return;
    }
    const d = await callAcesso({ action: 'add', email, nome });
    if (d.error) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }
    document.getElementById('acEmail').value = '';
    document.getElementById('acNome').value = '';
    okEl.textContent = email + ' adicionado.'; okEl.style.display = 'block';
    setTimeout(() => { okEl.style.display = 'none'; }, 3000);
    carregarAutorizados();
  }

  async function acRemover(id, email) {
    if (!await _lumiedConfirm('Remover acesso de ' + email + '?')) return;
    const d = await callAcesso({ action: 'remove', id });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    carregarAutorizados();
  }

  // Onda 1: aliases pros utils consolidados.
  const escHtml = (s) => window.__utils.esc(s);
  const fmtDate = (d) => window.__utils.fmtDate(d);

  // ── CONTROLE DE ACESSO (NOVO) ─────────────────────────
  var _acessoDashInterval = null;

  async function loadAcessoDash() {
    if (_acessoDashInterval) clearInterval(_acessoDashInterval);
    await _renderAcessoDash();
    _acessoDashInterval = setInterval(_renderAcessoDash, 15000);
  }

  async function _renderAcessoDash() {
    try {
      const [dash, eventos, alertas] = await Promise.all([
        callAcesso({ action: 'acesso_dashboard' }),
        callAcesso({ action: 'acesso_eventos_list', limit: 20 }),
        callAcesso({ action: 'acesso_alertas_list', lido: false })
      ]);
      const ds = dash.data || dash || {};
      document.getElementById('acessoDashStats').innerHTML = `
        <div class="stat-card" style="--ac:var(--green);"><div class="stat-label">Alunos Presentes</div><div class="stat-value">${ds.alunos_presentes ?? 0}</div></div>
        <div class="stat-card" style="--ac:var(--red);"><div class="stat-label">Alunos Ausentes</div><div class="stat-value">${ds.alunos_ausentes ?? 0}</div></div>
        <div class="stat-card" style="--ac:var(--blue);"><div class="stat-label">Responsaveis na Escola</div><div class="stat-value">${ds.responsaveis_presentes ?? 0}</div></div>
        <div class="stat-card" style="--ac:#d4830a;"><div class="stat-label">Alertas Nao Lidos</div><div class="stat-value">${ds.alertas_nao_lidos ?? 0}</div></div>
      `;
      const evts = (eventos.data || eventos || []);
      document.getElementById('acessoDashEvents').innerHTML = evts.length ? evts.map(e => `
        <div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:13px;display:flex;align-items:center;gap:10px;">
          <span style="font-size:18px;">${e.direcao === 'entrada' ? '🟢' : '🔴'}</span>
          <div style="flex:1;"><strong>${escHtml(e.pessoa_nome||'—')}</strong> <span style="color:var(--muted);font-size:11px;">${e.pessoa_tipo||''}</span>
          <div style="font-size:11px;color:var(--muted);">${e.metodo||''} · ${e.dispositivo_nome||''}</div></div>
          <div style="font-size:11px;color:var(--muted);">${e.criado_em ? new Date(e.criado_em).toLocaleTimeString('pt-BR') : ''}</div>
        </div>`).join('') : '<div class="empty-state">Nenhum evento recente.</div>';
      const alts = (alertas.data || alertas || []);
      document.getElementById('acessoAlertCount').textContent = alts.length;
      document.getElementById('acessoDashAlerts').innerHTML = alts.length ? alts.map(a => `
        <div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:13px;display:flex;align-items:center;gap:10px;">
          <span style="font-size:18px;">⚠️</span>
          <div style="flex:1;"><strong>${escHtml(a.titulo||a.tipo||'Alerta')}</strong>
          <div style="font-size:11px;color:var(--muted);">${escHtml(a.mensagem||'')}</div>
          <div style="font-size:11px;color:var(--muted);">${a.criado_em ? new Date(a.criado_em).toLocaleString('pt-BR') : ''}</div></div>
          <button class="action-btn" onclick="marcarAlertaLido('${a.id}')">Marcar como lido</button>
        </div>`).join('') : '<div class="empty-state">Nenhum alerta pendente.</div>';
    } catch(e) { console.error('Erro ao carregar dashboard de acesso:', e); }
  }

  async function marcarAlertaLido(id) {
    await callAcesso({ action: 'acesso_alerta_marcar_lido', id });
    _renderAcessoDash();
  }

  async function loadAcessoDispositivos() {
    const d = await callAcesso({ action: 'acesso_dispositivos_list' });
    const list = d.data || d || [];
    const tb = document.getElementById('acessoDispTable');
    if (!list.length) { tb.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum dispositivo cadastrado.</td></tr>'; return; }
    tb.innerHTML = list.map(dev => {
      const isOnline = dev.ultimo_heartbeat && (Date.now() - new Date(dev.ultimo_heartbeat).getTime() < 300000);
      return `<tr>
        <td style="font-weight:600;">${escHtml(dev.nome||'—')}</td>
        <td>${escHtml(dev.ip||'—')}</td>
        <td><span class="turno-pill ${dev.tipo==='catraca'?'integral':'semi'}">${dev.tipo||'—'}</span></td>
        <td>${escHtml(dev.localizacao||'—')}</td>
        <td><span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:${isOnline?'var(--green)':'var(--red)'};">${isOnline?'🟢 Online':'🔴 Offline'}</span></td>
        <td style="font-size:12px;color:var(--muted);">${dev.ultimo_heartbeat ? new Date(dev.ultimo_heartbeat).toLocaleString('pt-BR') : '—'}</td>
        <td>
          <button class="action-btn" onclick="testarDispositivo('${dev.id}')">Testar Conexao</button>
          <button class="action-btn" onclick="syncFacesDispositivo('${dev.id}')">Sincronizar Faces</button>
          <button class="action-btn del" onclick="removerDispositivo('${dev.id}')">Remover</button>
        </td>
      </tr>`;
    }).join('');
  }

  // ═══ Inventário Simpax (mig 304) ═══
  let _simpaxCsvText = null;

  async function onSimpaxFile(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    // CSV do Simpax vem em latin1 (ISO-8859-1) — decoder correto preserva acentos
    _simpaxCsvText = new TextDecoder('iso-8859-1').decode(buf);
    document.getElementById('simpaxImportBtn').disabled = false;
    document.getElementById('simpaxImportBtn').style.opacity = '1';
    document.getElementById('simpaxDryBtn').disabled = false;
    document.getElementById('simpaxDryBtn').style.opacity = '1';
    document.getElementById('simpaxStatus').innerHTML =
      `<div style="padding:10px 12px;background:#fdfbf8;border:1px solid var(--border);border-radius:8px;font-size:13px;">📄 Arquivo carregado: <strong>${escHtml(file.name)}</strong> (${(file.size/1024).toFixed(1)} KB) — clique em "Pré-visualizar" pra ver o que vai mudar antes de importar.</div>`;
  }

  async function importarSimpax(dryRun) {
    if (!_simpaxCsvText) return;
    const status = document.getElementById('simpaxStatus');
    status.innerHTML = '<div style="padding:10px 12px;background:#fdfbf8;border:1px solid var(--border);border-radius:8px;font-size:13px;"><span class="spinner-sm"></span> ' + (dryRun ? 'Analisando…' : 'Importando…') + '</div>';
    try {
      const r = await callAcesso({ action: 'acesso_simpax_import', csv_text: _simpaxCsvText, dry_run: !!dryRun });
      if (!r || r.error) {
        status.innerHTML = `<div style="padding:10px 12px;background:#fee;border:1px solid #fcc;border-radius:8px;font-size:13px;color:#a00;">❌ Erro: ${escHtml(r?.error || 'desconhecido')}</div>`;
        return;
      }
      const verbo = dryRun ? 'Seriam ' : '';
      status.innerHTML =
        `<div style="padding:12px 14px;background:${dryRun?'#fff8e1':'#e8f5e9'};border:1px solid ${dryRun?'#fde68a':'#a5d6a7'};border-radius:8px;font-size:13px;">
          ${dryRun?'👁️ Pré-visualização':'✅ Importação concluída'} —
          <strong>${verbo}${r.novos} criado(s)</strong>,
          <strong>${verbo}${r.atualizados} atualizado(s)</strong>,
          ${r.ignorados} ignorado(s) de ${r.total} linhas.
          ${r.detalhe?.ignorados?.length ? '<details style="margin-top:6px;"><summary style="cursor:pointer;color:#a00;">Ver ignorados</summary><pre style="margin-top:6px;font-size:11px;white-space:pre-wrap;">' + escHtml(JSON.stringify(r.detalhe.ignorados,null,2)) + '</pre></details>' : ''}
         </div>`;
      if (!dryRun) loadAcessoInventario();
    } catch (e) {
      status.innerHTML = `<div style="padding:10px 12px;background:#fee;border:1px solid #fcc;border-radius:8px;font-size:13px;color:#a00;">❌ ${escHtml(String(e))}</div>`;
    }
  }

  async function loadAcessoInventario() {
    const tb = document.getElementById('simpaxInventarioTable');
    tb.innerHTML = '<tr><td colspan="7" class="empty-state"><span class="spinner-sm"></span> Carregando…</td></tr>';
    const r = await callAcesso({ action: 'acesso_dispositivos_mapa' });
    const list = r?.devices || [];
    if (!list.length) {
      tb.innerHTML = '<tr><td colspan="7" class="empty-state">Sem dispositivos catalogados. Importe o CSV do Simpax acima.</td></tr>';
      return;
    }
    const statusPill = (s) => {
      const map = {
        ok: { bg:'#e8f5e9', fg:'#2e7d32', txt:'OK' },
        lento: { bg:'#fff8e1', fg:'#a06200', txt:'Lento (2-7d)' },
        mudo: { bg:'#fce4e4', fg:'#a02020', txt:'Mudo (>7d)' },
        sem_dados: { bg:'#eee', fg:'#666', txt:'Sem dados' },
        inativo: { bg:'#eee', fg:'#666', txt:'Inativo' },
      };
      const m = map[s] || map.sem_dados;
      return `<span style="padding:3px 8px;background:${m.bg};color:${m.fg};border-radius:10px;font-size:11px;font-weight:600;">${m.txt}</span>`;
    };
    tb.innerHTML = list.map(d => `<tr>
      <td style="font-family:ui-monospace,monospace;font-size:12px;">${escHtml(d.serial_externo||'—')}</td>
      <td>${escHtml(d.nome||'—')}</td>
      <td style="font-size:12px;color:var(--muted);">${escHtml(d.modelo_detalhe||d.modelo||'—')}</td>
      <td>${d.lado ? (d.lado==='esquerdo'?'⬅ Esq':'➡ Dir') : '—'}</td>
      <td style="font-size:12px;">${d.ultimo_registro ? new Date(d.ultimo_registro).toLocaleString('pt-BR') : '<span style="color:var(--muted);">—</span>'}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${d.total_registros||0}</td>
      <td>${statusPill(d.status_mapa)}</td>
    </tr>`).join('');
  }

  // ═══ Mapa de Terminais (grade CSS) ═══
  const _mapaGrupoLabels = {
    entrada_resp: '🚪 Entrada Responsáveis',
    saida_infantil: '🧒 Saída Infantil',
    catraca_entrada: '⏩ Catracas — Entrada Pais & Fundamental',
    catraca_saida: '⏪ Catracas — Saída Pais & Fundamental',
    entrada_fundamental: '🎒 Entrada Fundamental',
    app_mobile: '📱 Apps Mobile (Simpax)',
    outros: '❓ Outros',
  };

  async function loadAcessoMapa() {
    const grid = document.getElementById('mapaGrid');
    const resumo = document.getElementById('mapaResumo');
    grid.innerHTML = '<div class="empty-state"><span class="spinner-sm"></span> Carregando mapa…</div>';
    resumo.innerHTML = '';
    const r = await callAcesso({ action: 'acesso_dispositivos_mapa' });
    if (!r || !r.devices?.length) {
      grid.innerHTML = '<div class="empty-state">Sem dispositivos catalogados — importe o CSV do Simpax na aba Inventário.</div>';
      return;
    }
    const res = r.resumo || {};
    const pill = (label, n, bg, fg) => `<div style="padding:8px 14px;background:${bg};color:${fg};border-radius:10px;font-size:13px;font-weight:600;">${label}: ${n}</div>`;
    resumo.innerHTML =
      pill('🟢 OK', res.ok||0, '#e8f5e9', '#2e7d32') +
      pill('🟡 Lento', res.lento||0, '#fff8e1', '#a06200') +
      pill('🔴 Mudo', res.mudo||0, '#fce4e4', '#a02020') +
      pill('⚫ Inativo/Sem dados', (res.inativo||0)+(res.sem_dados||0), '#eee', '#444') +
      `<div style="padding:8px 14px;background:#1a6bb5;color:#fff;border-radius:10px;font-size:13px;font-weight:600;">Total: ${res.total||0}</div>`;

    const grupos = r.grupos || {};
    const ordem = ['entrada_resp','entrada_fundamental','catraca_entrada','saida_infantil','catraca_saida','app_mobile','outros'];
    const cardCor = (s) => ({
      ok: { borda:'#a5d6a7', bg:'#f1f8e9', dot:'#2e7d32' },
      lento: { borda:'#fde68a', bg:'#fffbeb', dot:'#a06200' },
      mudo: { borda:'#fcc', bg:'#fef2f2', dot:'#a02020' },
      sem_dados: { borda:'#ddd', bg:'#fafafa', dot:'#999' },
      inativo: { borda:'#ddd', bg:'#fafafa', dot:'#999' },
    }[s] || { borda:'#ddd', bg:'#fafafa', dot:'#999' });
    const blocos = ordem.filter(g => grupos[g]?.length).map(g => {
      const devs = grupos[g];
      const cards = devs.map(d => {
        const c = cardCor(d.status_mapa);
        const hint = d.ultimo_registro
          ? `Últ. registro: ${new Date(d.ultimo_registro).toLocaleString('pt-BR')}\nTotal: ${d.total_registros||0}`
          : 'Sem registro recente';
        return `<div title="${escHtml(hint)}" style="padding:14px;background:${c.bg};border:1.5px solid ${c.borda};border-radius:10px;min-width:220px;flex:1 1 220px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="width:10px;height:10px;border-radius:50%;background:${c.dot};display:inline-block;"></span>
            <strong style="font-size:13px;">${escHtml(d.nome||d.serial_externo||'—')}</strong>
          </div>
          <div style="font-family:ui-monospace,monospace;font-size:11px;color:var(--muted);margin-bottom:6px;">${escHtml(d.serial_externo||'')}</div>
          <div style="font-size:11px;color:var(--muted);">${d.lado ? (d.lado==='esquerdo'?'⬅ Esquerdo':'➡ Direito')+' · ' : ''}${d.total_registros||0} reg</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px;">${d.ultimo_registro ? new Date(d.ultimo_registro).toLocaleDateString('pt-BR') : '<em>sem dados</em>'}</div>
        </div>`;
      }).join('');
      return `<div>
        <div style="font-weight:700;font-size:14px;margin-bottom:8px;color:var(--ink);">${_mapaGrupoLabels[g]||g} <span style="color:var(--muted);font-weight:500;font-size:12px;">(${devs.length})</span></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">${cards}</div>
      </div>`;
    }).join('');
    grid.innerHTML = blocos || '<div class="empty-state">Devices catalogados mas sem grupo de mapa atribuído.</div>';
  }

  async function salvarDispositivo() {
    const body = {
      action: 'acesso_dispositivo_save',
      nome: document.getElementById('adNome').value,
      ip: document.getElementById('adIp').value,
      porta: document.getElementById('adPorta').value,
      tipo: document.getElementById('adTipo').value,
      localizacao: document.getElementById('adLocal').value,
      via_bridge: !!document.getElementById('adViaBridge').checked,
      api_login: document.getElementById('adApiLogin').value || 'admin',
      api_password: document.getElementById('adApiPassword').value || null,
    };
    const d = await api(body);
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Dispositivo adicionado!', 'success');
    document.getElementById('acessoDispForm').style.display = 'none';
    ['adNome','adIp','adLocal','adApiPassword'].forEach(id => document.getElementById(id).value = '');
    loadAcessoDispositivos();
  }

  async function testarDispositivo(id) {
    showToast('Testando conexao...', 'info');
    const d = await callAcesso({ action: 'acesso_dispositivo_ping', id });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast(d.online ? 'Dispositivo online!' : 'Dispositivo offline.', d.online ? 'success' : 'error');
  }

  async function syncFacesDispositivo(id) {
    showToast('Sincronizando faces...', 'info');
    const d = await callAcesso({ action: 'acesso_dispositivo_sync', id });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast('Faces sincronizadas!', 'success');
  }

  async function removerDispositivo(id) {
    if (!await _lumiedConfirm('Remover este dispositivo?')) return;
    const d = await callAcesso({ action: 'acesso_dispositivo_delete', id });
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Dispositivo removido.', 'success');
    loadAcessoDispositivos();
  }

  let _acessoFacesFiltro = '';
  let _acessoFacesCache = [];

  async function loadAcessoFaces() {
    const d = await callAcesso({ action: 'acesso_faces_list' });
    _acessoFacesCache = d.data || d || [];
    renderAcessoFaces();
  }

  function filtrarFaces(filtro) {
    _acessoFacesFiltro = filtro || '';
    document.querySelectorAll('.face-filter-btn').forEach(b => {
      b.classList.toggle('active', (b.dataset.filter || '') === _acessoFacesFiltro);
    });
    renderAcessoFaces();
  }

  function renderAcessoFaces() {
    const todas = _acessoFacesCache || [];
    const pendAprov = todas.filter(f => f.sync_status === 'aguardando_aprovacao').length;
    const pendCountEl = document.getElementById('acessoFacesPendCount');
    if (pendCountEl) pendCountEl.textContent = pendAprov;

    const list = _acessoFacesFiltro ? todas.filter(f => f.sync_status === _acessoFacesFiltro) : todas;
    document.getElementById('acessoFacesCount').textContent = list.length;
    const tb = document.getElementById('acessoFacesTable');
    if (!list.length) {
      const msg = _acessoFacesFiltro === 'aguardando_aprovacao' ? 'Nenhuma face aguardando aprovação.' : 'Nenhuma face encontrada.';
      tb.innerHTML = `<tr><td colspan="5" class="empty-state">${msg}</td></tr>`;
      return;
    }
    tb.innerHTML = list.map(f => {
      let syncBadge;
      if (f.sync_status === 'sincronizado') syncBadge = '<span class="turno-pill integral">Sincronizado</span>';
      else if (f.sync_status === 'aguardando_aprovacao') syncBadge = '<span class="turno-pill semi" style="background:#fff8e1;color:#b07d00;">⏳ Aguardando Aprovação</span>';
      else if (f.sync_status === 'pendente') syncBadge = '<span class="turno-pill semi">Pendente</span>';
      else if (f.sync_status === 'erro') syncBadge = `<span class="turno-pill tarde" title="${escHtml(f.sync_erro||'')}">✗ Erro</span>`;
      else syncBadge = `<span class="turno-pill tarde">${escHtml(f.sync_status||'—')}</span>`;

      const foto = f.foto_url ? `<img src="${f.foto_url}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:1px solid var(--border);cursor:pointer;" onclick="window.open('${f.foto_url}','_blank')">` : '<div class="list-avatar">👤</div>';

      const acoes = [];
      if (f.sync_status === 'aguardando_aprovacao') {
        acoes.push(`<button class="action-btn" style="background:#2d7a3a;color:#fff;border-color:#2d7a3a;" onclick="aprovarFace('${f.id}')">✓ Aprovar</button>`);
      }
      if (f.sync_status === 'erro') {
        acoes.push(`<button class="action-btn" onclick="ressincronizarFace('${f.id}')">↻ Tentar de novo</button>`);
      }
      acoes.push(`<button class="action-btn del" onclick="removerFace('${f.id}')">Remover</button>`);

      return `<tr>
        <td>${foto}</td>
        <td style="font-weight:500;">${escHtml(f.pessoa_nome||'—')}</td>
        <td>${escHtml(f.pessoa_tipo||'—')}</td>
        <td>${syncBadge}</td>
        <td>${acoes.join(' ')}</td>
      </tr>`;
    }).join('');
  }

  async function aprovarFace(id) {
    if (!await _lumiedConfirm('Aprovar esta face e sincronizar com todos os dispositivos?')) return;
    showToast('Aprovando e sincronizando...', 'info');
    const d = await callAcesso({ action: 'acesso_face_aprovar', id });
    if (d.error) { showToast(d.error, 'error'); return; }
    const sync = (d.data && d.data.sync) || d.sync || [];
    const okCount = sync.filter(s => s.ok).length;
    showToast(`Face aprovada. Sincronizada em ${okCount}/${sync.length} dispositivo(s).`, 'success');
    loadAcessoFaces();
  }

  async function ressincronizarFace(id) {
    showToast('Tentando sincronizar novamente...', 'info');
    const d = await callAcesso({ action: 'acesso_face_aprovar', id });
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Tentativa de sincronização concluída.', 'success');
    loadAcessoFaces();
  }

  function openFaceModal() {
    document.getElementById('faceModal').classList.add('show');
    if (typeof setFaceMode === 'function') setFaceMode('upload');
  }
  function closeFaceModal() {
    document.getElementById('faceModal').classList.remove('show');
    document.getElementById('faceBusca').value = '';
    document.getElementById('faceResultados').innerHTML = '';
    document.getElementById('facePessoaId').value = '';
    if (typeof faceWebcamStop === 'function') faceWebcamStop();
  }




