// Auto-extraído do gerente.html (Onda 4 — batch).
// Acesso Face/Bridge/LPR — enviar link, webcam, import massa, setup, bridge, LPR câmeras/ROI
  // ── ENVIAR LINK DE CADASTRO FACIAL ─────────────────────
  let _linkResultData = null; // {link, pessoa_tipo, pessoa_id, pessoa_nome, email}

  function openLinkModal(prefill) {
    document.getElementById('linkPickModal').classList.add('show');
    document.getElementById('linkPickResultados').innerHTML = '';
    document.getElementById('linkPickBusca').value = '';
    document.getElementById('linkPickPessoaId').value = '';
    document.getElementById('linkPickPessoaNome').value = '';
    document.getElementById('linkPickGerar').disabled = true;
    if (prefill) {
      document.getElementById('linkPickTipo').value = prefill.pessoa_tipo;
      document.getElementById('linkPickBusca').value = prefill.pessoa_nome || '';
      document.getElementById('linkPickPessoaId').value = prefill.pessoa_id;
      document.getElementById('linkPickPessoaNome').value = prefill.pessoa_nome;
      _linkPickEmail = prefill.email || null;
      document.getElementById('linkPickGerar').disabled = false;
    }
  }
  function closeLinkModal() { document.getElementById('linkPickModal').classList.remove('show'); }

  let _linkPickEmail = null;

  async function searchLinkPessoa() {
    const tipo = document.getElementById('linkPickTipo').value;
    const busca = document.getElementById('linkPickBusca').value.trim();
    document.getElementById('linkPickGerar').disabled = true;
    document.getElementById('linkPickPessoaId').value = '';
    if (busca.length < 2) { document.getElementById('linkPickResultados').innerHTML = ''; return; }
    const d = await callAcesso({ action: 'acesso_buscar_pessoa', tipo, busca });
    const list = d.data || d || [];
    if (!list.length) { document.getElementById('linkPickResultados').innerHTML = '<div class="empty-state" style="padding:8px;font-size:12px;">Nenhum resultado.</div>'; return; }
    document.getElementById('linkPickResultados').innerHTML = list.map(p => `
      <div onclick="selectLinkPessoa('${p.id}','${escAttr(p.nome)}','${escAttr(p.email||'')}')" style="padding:10px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;" onmouseover="this.style.background='#fdfbf8'" onmouseout="this.style.background=''">
        <strong>${escHtml(p.nome)}</strong>
        ${p.email ? `<div style="color:var(--muted);font-size:11px;">${escHtml(p.email)}</div>` : '<div style="color:#c0392b;font-size:11px;">⚠️ sem email cadastrado</div>'}
      </div>
    `).join('');
  }

  function selectLinkPessoa(id, nome, email) {
    document.getElementById('linkPickPessoaId').value = id;
    document.getElementById('linkPickPessoaNome').value = nome;
    _linkPickEmail = email || null;
    document.getElementById('linkPickGerar').disabled = false;
    // Visual feedback
    [...document.getElementById('linkPickResultados').children].forEach(c => c.style.background = '');
    event.currentTarget.style.background = '#edf7ef';
  }

  async function gerarLinkSelecionado() {
    const pessoa_tipo = document.getElementById('linkPickTipo').value;
    const pessoa_id = document.getElementById('linkPickPessoaId').value;
    const pessoa_nome = document.getElementById('linkPickPessoaNome').value;
    if (!pessoa_id) return;
    const btn = document.getElementById('linkPickGerar');
    btn.disabled = true; btn.textContent = 'Gerando…';
    const d = await callAcesso({ action: 'acesso_gerar_link_cadastro', pessoa_tipo, pessoa_id, pessoa_nome, email: _linkPickEmail });
    btn.disabled = false; btn.textContent = 'Gerar Link';
    const link = d?.data?.link || d?.link;
    if (!link) { showToast('Erro: ' + (d?.error || 'falha desconhecida'), 'error'); return; }
    _linkResultData = { link, pessoa_tipo, pessoa_id, pessoa_nome, email: _linkPickEmail };
    closeLinkModal();
    document.getElementById('linkResultNome').textContent = pessoa_nome;
    document.getElementById('linkResultUrl').textContent = link;
    document.getElementById('linkResultStatus').textContent = '';
    document.getElementById('linkResultEmailBtn').disabled = !_linkPickEmail;
    document.getElementById('linkResultEmailBtn').style.opacity = _linkPickEmail ? 1 : .4;
    document.getElementById('linkResultEmailBtn').title = _linkPickEmail ? '' : 'Cadastro sem email';
    document.getElementById('linkResultModal').classList.add('show');
  }

  function closeLinkResultModal() { document.getElementById('linkResultModal').classList.remove('show'); _linkResultData = null; }

  async function linkResultCopy() {
    if (!_linkResultData) return;
    try { await navigator.clipboard.writeText(_linkResultData.link); document.getElementById('linkResultStatus').textContent = '✅ Link copiado!'; }
    catch { document.getElementById('linkResultStatus').textContent = '⚠️ Não foi possível copiar — selecione manualmente acima.'; }
  }

  async function linkResultWhatsApp() {
    if (!_linkResultData) return;
    document.getElementById('linkResultStatus').textContent = 'Buscando WhatsApp do responsável…';
    const r = await callAcesso({ action: 'acesso_link_whatsapp_info', ..._linkResultData });
    const d = r?.data || r;
    if (d?.wa_url) {
      const phoneNote = d.whatsapp ? `Abrindo WhatsApp p/ ${d.whatsapp}…` : 'Abrindo WhatsApp (escolha o contato no app)…';
      document.getElementById('linkResultStatus').textContent = phoneNote;
      window.open(d.wa_url, '_blank');
    } else {
      document.getElementById('linkResultStatus').textContent = '❌ Erro: ' + (d?.error || 'falha');
    }
  }

  async function linkResultEmail() {
    if (!_linkResultData?.email) {
      document.getElementById('linkResultStatus').textContent = '⚠️ Esse cadastro não tem email — copie o link e envie por outro meio.';
      return;
    }
    document.getElementById('linkResultStatus').textContent = 'Enviando email…';
    const r = await callAcesso({ action: 'acesso_enviar_link_email', ..._linkResultData });
    const d = r?.data || r;
    if (d?.sent) {
      document.getElementById('linkResultStatus').textContent = `✅ Email enviado para ${_linkResultData.email}`;
    } else if (d?.reason) {
      document.getElementById('linkResultStatus').textContent = `❌ Falha: ${d.reason}`;
    } else {
      document.getElementById('linkResultStatus').textContent = `❌ Erro: ${r?.error || 'desconhecido'}`;
    }
  }

  function escAttr(s) { return String(s||'').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

  async function searchFacePessoa() {
    const tipo = document.getElementById('faceTipo').value;
    const busca = document.getElementById('faceBusca').value.trim();
    if (busca.length < 2) { document.getElementById('faceResultados').innerHTML = ''; return; }
    const d = await callAcesso({ action: 'acesso_buscar_pessoa', tipo, busca });
    const list = d.data || d || [];
    document.getElementById('faceResultados').innerHTML = list.map(p => `
      <div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;" onclick="document.getElementById('facePessoaId').value='${p.id}';document.getElementById('faceBusca').value='${escHtml(p.nome)}';document.getElementById('faceResultados').innerHTML='';" onmouseover="this.style.background='#f5f0ea'" onmouseout="this.style.background=''">
        ${escHtml(p.nome)}
      </div>`).join('');
  }

  // ── Webcam ───────────────────────────────────────────
  let _faceMode = 'upload';
  let _faceWebcamStream = null;
  let _faceWebcamBase64 = null;

  function setFaceMode(m) {
    _faceMode = m;
    document.getElementById('faceModeUpload').style.background = m === 'upload' ? '#1a1a1a' : '#fff';
    document.getElementById('faceModeUpload').style.color = m === 'upload' ? '#fff' : '#1a1a1a';
    document.getElementById('faceModeWebcam').style.background = m === 'webcam' ? '#1a1a1a' : '#fff';
    document.getElementById('faceModeWebcam').style.color = m === 'webcam' ? '#fff' : '#1a1a1a';
    document.getElementById('faceUploadWrap').style.display = m === 'upload' ? 'block' : 'none';
    document.getElementById('faceWebcamWrap').style.display = m === 'webcam' ? 'block' : 'none';
    if (m !== 'webcam') faceWebcamStop();
  }

  async function faceWebcamStart() {
    try {
      _faceWebcamStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width:{ideal:1280}, height:{ideal:960} } });
      const v = document.getElementById('faceWebcamVideo');
      v.srcObject = _faceWebcamStream;
      v.style.display = 'block';
      document.getElementById('faceWebcamPlaceholder').style.display = 'none';
      document.getElementById('faceWebcamPreview').style.display = 'none';
      document.getElementById('faceWebcamStart').style.display = 'none';
      document.getElementById('faceWebcamCapture').style.display = 'block';
      document.getElementById('faceWebcamRetry').style.display = 'none';
      _faceWebcamBase64 = null;
    } catch (e) {
      showToast('Não foi possível acessar a câmera: ' + e.message, 'error');
    }
  }

  function faceWebcamCapture() {
    const v = document.getElementById('faceWebcamVideo');
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    _faceWebcamBase64 = c.toDataURL('image/jpeg', 0.85);

    const img = document.getElementById('faceWebcamPreview');
    img.src = _faceWebcamBase64;
    img.style.display = 'block';
    v.style.display = 'none';
    if (_faceWebcamStream) { _faceWebcamStream.getTracks().forEach(t => t.stop()); _faceWebcamStream = null; }
    document.getElementById('faceWebcamCapture').style.display = 'none';
    document.getElementById('faceWebcamRetry').style.display = 'block';
  }

  function faceWebcamRetry() {
    _faceWebcamBase64 = null;
    document.getElementById('faceWebcamPreview').style.display = 'none';
    document.getElementById('faceWebcamRetry').style.display = 'none';
    faceWebcamStart();
  }

  function faceWebcamStop() {
    if (_faceWebcamStream) { _faceWebcamStream.getTracks().forEach(t => t.stop()); _faceWebcamStream = null; }
    const v = document.getElementById('faceWebcamVideo'); if (v) v.style.display = 'none';
  }

  async function salvarFace() {
    const pessoaId = document.getElementById('facePessoaId').value;
    const tipo = document.getElementById('faceTipo').value;
    if (!pessoaId) { showToast('Selecione uma pessoa.', 'error'); return; }

    let foto_base64 = null;
    if (_faceMode === 'webcam') {
      if (!_faceWebcamBase64) { showToast('Tire uma foto antes.', 'error'); return; }
      foto_base64 = _faceWebcamBase64;
    } else {
      const fileInput = document.getElementById('faceFoto');
      if (!fileInput.files.length) { showToast('Selecione uma foto.', 'error'); return; }
      foto_base64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(fileInput.files[0]); });
    }

    const d = await callAcesso({ action: 'acesso_face_create', pessoa_id: pessoaId, pessoa_tipo: tipo, foto_base64 });
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Face cadastrada!', 'success');
    closeFaceModal();
    faceWebcamStop();
    if (typeof loadAcessoFaces === 'function') loadAcessoFaces();
  }

  async function removerFace(id) {
    if (!await _lumiedConfirm('Remover esta face?')) return;
    await callAcesso({ action: 'acesso_face_delete', id });
    loadAcessoFaces();
  }

  async function syncAllFaces() {
    showToast('Sincronizando todas as faces...', 'info');
    const d = await callAcesso({ action: 'acesso_face_sync_all' });
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Sincronizacao iniciada!', 'success');
    loadAcessoFaces();
  }

  async function loadAcessoRfid() {
    const d = await callAcesso({ action: 'acesso_rfid_list' });
    const list = d.data || d || [];
    document.getElementById('acessoRfidCount').textContent = list.length;
    const tb = document.getElementById('acessoRfidTable');
    if (!list.length) { tb.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhum cartao RFID cadastrado.</td></tr>'; return; }
    tb.innerHTML = list.map(r => `<tr>
      <td style="font-family:monospace;font-weight:600;">${escHtml(r.card_uid||'—')}</td>
      <td>${escHtml(r.pessoa_nome||'—')}</td>
      <td>${escHtml(r.pessoa_tipo||'—')}</td>
      <td><span class="turno-pill ${r.ativo?'integral':'tarde'}">${r.ativo?'Ativo':'Inativo'}</span></td>
      <td>
        <button class="action-btn" onclick="toggleRfid('${r.id}',${!r.ativo})">${r.ativo?'Desativar':'Ativar'}</button>
        <button class="action-btn del" onclick="removerRfid('${r.id}')">Remover</button>
      </td>
    </tr>`).join('');
  }

  async function searchRfidPessoa() {
    const tipo = document.getElementById('rfidTipo').value;
    const busca = document.getElementById('rfidBusca').value.trim();
    const wrap = document.getElementById('rfidResultados');
    if (busca.length < 2) { wrap.style.display = 'none'; return; }
    const d = await callAcesso({ action: 'acesso_buscar_pessoa', tipo, busca });
    const list = d.data || d || [];
    wrap.style.display = list.length ? 'block' : 'none';
    wrap.innerHTML = list.map(p => `
      <div style="padding:8px 12px;cursor:pointer;font-size:13px;" onclick="document.getElementById('rfidPessoaId').value='${p.id}';document.getElementById('rfidBusca').value='${escHtml(p.nome)}';document.getElementById('rfidResultados').style.display='none';" onmouseover="this.style.background='#f5f0ea'" onmouseout="this.style.background=''">
        ${escHtml(p.nome)}
      </div>`).join('');
  }

  async function salvarRfid() {
    const uid = document.getElementById('rfidUid').value.trim();
    const pessoaId = document.getElementById('rfidPessoaId').value;
    const tipo = document.getElementById('rfidTipo').value;
    if (!uid) { showToast('Informe o UID do cartao.', 'error'); return; }
    if (!pessoaId) { showToast('Selecione uma pessoa.', 'error'); return; }
    const d = await callAcesso({ action: 'acesso_rfid_cadastrar', card_uid: uid, pessoa_id: pessoaId, pessoa_tipo: tipo });
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Cartao adicionado!', 'success');
    document.getElementById('rfidUid').value = '';
    document.getElementById('rfidBusca').value = '';
    document.getElementById('rfidPessoaId').value = '';
    loadAcessoRfid();
  }

  async function toggleRfid(id, ativo) {
    await callAcesso({ action: 'acesso_rfid_cadastrar', id, ativo });
    loadAcessoRfid();
  }

  async function removerRfid(id) {
    if (!await _lumiedConfirm('Remover este cartao?')) return;
    await callAcesso({ action: 'acesso_rfid_delete', id });
    loadAcessoRfid();
  }

  async function loadAcessoPermissoes() {
    const busca = (document.getElementById('permBuscaAluno')?.value || '').trim();
    const r = await callAcesso({ action: 'acesso_alunos_responsaveis_status', busca });
    const d = r?.data || r || {};
    const list = d.alunos || [];
    const wrap = document.getElementById('acessoPermissoesWrap');

    // Resumo
    const resumoEl = document.getElementById('permResumo');
    if (resumoEl) {
      const total = d.total || 0;
      const ok = d.com_min_obrigatorio || 0;
      if (total === 0) resumoEl.textContent = '';
      else {
        const pct = Math.round((ok / total) * 100);
        const cor = pct === 100 ? '#2d7a3a' : (pct >= 50 ? '#b07d10' : '#c0392b');
        resumoEl.innerHTML = `<span style="color:${cor};font-weight:600;">${ok}/${total}</span> alunos com responsável obrigatório`;
      }
    }

    if (!list.length) { wrap.innerHTML = '<div class="empty-state">Nenhum aluno encontrado.</div>'; return; }

    wrap.innerHTML = list.map(aluno => {
      const slots = renderResponsavelSlots(aluno);
      const total = aluno.faces_ok || 0;
      const min = d.min_responsaveis || 1;
      const recom = d.recomendado || 3;
      let badgeBg = '#fdf0f2', badgeColor = '#c0392b', badgeIcon = '⚠️';
      let badgeText = 'Sem responsável';
      if (aluno.atende_recomendado) { badgeBg = '#edf7ef'; badgeColor = '#2d7a3a'; badgeIcon = '✅'; badgeText = 'Completo'; }
      else if (aluno.atende_minimo) { badgeBg = '#fff8e1'; badgeColor = '#b07d10'; badgeIcon = '🟡'; badgeText = `${total}/${recom} cadastrados`; }
      else { badgeText = `${total}/${recom} — falta o obrigatório`; }

      const btnConvidar = aluno.familia_email
        ? `<button onclick="convidarFamilia('${aluno.id}','${escAttr(aluno.nome)}','${escAttr(aluno.familia_email)}')" style="padding:6px 12px;background:#1a6bb5;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;" title="Cria responsável obrigatório e envia email pra família tirar a foto">📧 Convidar família</button>`
        : `<button disabled style="padding:6px 12px;background:#eee;color:#999;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:not-allowed;white-space:nowrap;" title="Sem email família — cadastre antes">📧 Sem email</button>`;

      return `<div style="background:var(--white);border-radius:14px;border:1px solid var(--border);padding:16px 20px;margin-bottom:14px;box-shadow:0 2px 8px rgba(0,0,0,.04);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-weight:600;font-size:15px;">${escHtml(aluno.nome||'—')}</div>
            ${aluno.familia_email ? `<div style="font-size:11px;color:var(--muted);">${escHtml(aluno.familia_email)}</div>` : '<div style="font-size:11px;color:#c0392b;">⚠️ sem email família</div>'}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="background:${badgeBg};color:${badgeColor};padding:4px 12px;border-radius:8px;font-size:12px;font-weight:600;">${badgeIcon} ${escHtml(badgeText)}</span>
            ${btnConvidar}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">
          ${slots}
        </div>
      </div>`;
    }).join('');
  }

  // ── Import em massa de fotos ──────────────────────────
  let _importFotosData = []; // [{file, base64, filename, normalized, matchAlunoId, matchAlunoNome, status}]
  let _importAlunos = [];

  function abrirImportFotosModal() {
    document.getElementById('importFotosModal').classList.add('show');
    document.getElementById('importFotosInput').value = '';
    document.getElementById('importFotosTable').innerHTML = '';
    document.getElementById('importFotosTable').style.display = 'none';
    document.getElementById('importFotosStatus').textContent = '';
    document.getElementById('importFotosSubmit').style.display = 'none';
    _importFotosData = [];
  }
  function closeImportFotosModal() {
    document.getElementById('importFotosModal').classList.remove('show');
  }

  function _normNome(s) {
    return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  }

  async function importFotosLoaded(ev) {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    document.getElementById('importFotosStatus').textContent = `Carregando ${files.length} foto(s)…`;

    // Buscar alunos da escola se ainda não temos
    if (!_importAlunos.length) {
      const r = await callAcesso({ action: 'acesso_alunos_responsaveis_status' });
      _importAlunos = (r?.data?.alunos || r?.alunos || []).map(a => ({ id: a.id, nome: a.nome, norm: _normNome(a.nome) }));
    }

    _importFotosData = [];
    for (const f of files) {
      const filename = f.name;
      const base = filename.replace(/\.[^.]+$/, '');
      const norm = _normNome(base);
      // Match: best fit por palavras em comum
      let best = null, bestScore = 0;
      for (const a of _importAlunos) {
        const score = _matchScore(norm, a.norm);
        if (score > bestScore) { bestScore = score; best = a; }
      }
      const base64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      _importFotosData.push({
        filename, base64,
        matchAlunoId: bestScore >= 0.5 ? best?.id : null,
        matchAlunoNome: bestScore >= 0.5 ? best?.nome : null,
        score: bestScore,
        status: 'pending',
      });
    }

    document.getElementById('importFotosStatus').textContent = `${_importFotosData.length} foto(s) prontas. Revise e ajuste antes de subir.`;
    renderImportFotosTable();
    document.getElementById('importFotosTable').style.display = 'block';
    document.getElementById('importFotosSubmit').style.display = 'inline-block';
  }

  function _matchScore(a, b) {
    if (!a || !b) return 0;
    const wa = new Set(a.split(' ').filter(w => w.length >= 3));
    const wb = new Set(b.split(' ').filter(w => w.length >= 3));
    if (!wa.size || !wb.size) return 0;
    let common = 0;
    wa.forEach(w => { if (wb.has(w)) common++; });
    return common / Math.max(wa.size, wb.size);
  }

  function renderImportFotosTable() {
    const opts = _importAlunos.map(a => `<option value="${a.id}">${escHtml(a.nome)}</option>`).join('');
    const rows = _importFotosData.map((row, idx) => {
      const previewSrc = row.base64;
      const statusBadge = {
        pending: '<span style="color:#888;">aguardando</span>',
        uploading: '<span style="color:#1976d2;">enviando…</span>',
        ok: '<span style="color:#2d7a3a;font-weight:600;">✓ OK</span>',
        skip: '<span style="color:#888;">pulado</span>',
        error: '<span style="color:#c0392b;font-weight:600;">✗ erro</span>',
      }[row.status] || '';
      const conf = row.score > 0.7 ? '🟢' : (row.score >= 0.5 ? '🟡' : '🔴');
      return `<tr>
        <td style="padding:6px;"><img src="${previewSrc}" style="width:48px;height:48px;border-radius:6px;object-fit:cover;"></td>
        <td style="padding:6px;font-size:12px;font-family:monospace;color:#5a5249;">${escHtml(row.filename)}</td>
        <td style="padding:6px;">
          <select onchange="_importSetMatch(${idx}, this.value)" style="padding:6px;border:1px solid var(--border);border-radius:6px;font-size:12px;width:100%;font-family:'DM Sans',sans-serif;">
            <option value="">— pular —</option>
            ${_importAlunos.map(a => `<option value="${a.id}" ${a.id === row.matchAlunoId ? 'selected' : ''}>${escHtml(a.nome)}</option>`).join('')}
          </select>
        </td>
        <td style="padding:6px;font-size:14px;text-align:center;" title="confiança match">${conf}</td>
        <td style="padding:6px;font-size:12px;">${statusBadge}</td>
      </tr>`;
    }).join('');
    document.getElementById('importFotosTable').innerHTML = `<table style="width:100%;border-collapse:collapse;">
      <thead style="background:#f8f5f0;position:sticky;top:0;"><tr><th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;">Foto</th><th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;">Arquivo</th><th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;">Aluno</th><th style="padding:8px;font-size:11px;">Match</th><th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;">Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function _importSetMatch(idx, alunoId) {
    if (!_importFotosData[idx]) return;
    _importFotosData[idx].matchAlunoId = alunoId || null;
    const a = _importAlunos.find(x => x.id === alunoId);
    _importFotosData[idx].matchAlunoNome = a?.nome || null;
  }

  async function submitImportFotos() {
    const toUpload = _importFotosData.filter(r => r.matchAlunoId);
    if (!toUpload.length) { showToast('Nenhuma foto vinculada a aluno.', 'error'); return; }
    if (!await _lumiedConfirm(`Subir ${toUpload.length} foto(s)? As que estão sem aluno (${_importFotosData.length - toUpload.length}) serão puladas.`)) return;
    document.getElementById('importFotosSubmit').disabled = true;
    let ok = 0, fail = 0;
    for (let i = 0; i < _importFotosData.length; i++) {
      const row = _importFotosData[i];
      if (!row.matchAlunoId) { row.status = 'skip'; renderImportFotosTable(); continue; }
      row.status = 'uploading'; renderImportFotosTable();
      try {
        const r = await callAcesso({
          action: 'acesso_face_create',
          pessoa_tipo: 'aluno', pessoa_id: row.matchAlunoId,
          foto_base64: row.base64,
        });
        if (r?.error) { row.status = 'error'; fail++; }
        else { row.status = 'ok'; ok++; }
      } catch (e) { row.status = 'error'; fail++; }
      renderImportFotosTable();
    }
    document.getElementById('importFotosSubmit').disabled = false;
    document.getElementById('importFotosStatus').textContent = `✅ ${ok} sucesso, ✗ ${fail} falha(s)`;
    showToast(`Concluído: ${ok} OK, ${fail} erro(s)`, ok > 0 ? 'success' : 'error');
    if (typeof loadAcessoPermissoes === 'function') loadAcessoPermissoes();
  }

  // Bulk: convidar todas famílias com email cadastrado e sem responsável principal
  async function convidarTodasFamilias() {
    showToast('Carregando alunos pendentes…', 'info');
    const r = await callAcesso({ action: 'acesso_alunos_responsaveis_status' });
    const d = r?.data || r || {};
    const list = (d.alunos || []).filter(a => !a.atende_minimo && a.familia_email);
    if (!list.length) {
      showToast('Nenhum aluno pendente com email — nada a fazer.', 'info');
      return;
    }
    const semEmail = (d.alunos || []).filter(a => !a.atende_minimo && !a.familia_email).length;
    const msg = `${list.length} email(s) serão enviados${semEmail ? ` (${semEmail} sem email — pulados)` : ''}.\n\nIsso vai criar um "Responsável principal" pra cada um e enviar o link. Continuar?`;
    if (!await _lumiedConfirm(msg)) return;

    let ok = 0, fail = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      showToast(`Enviando ${i+1}/${list.length}: ${a.nome}…`, 'info');
      try {
        const cr = await callAcesso({
          action: 'acesso_responsavel_create',
          aluno_id: a.id, responsavel_nome: 'Responsável principal',
          parentesco: 'responsavel', responsavel_email: a.familia_email, gerar_link: true,
        });
        const cd = cr?.data || cr;
        if (cr?.error || !cd?.responsavel_id) { fail++; continue; }
        const er = await callAcesso({
          action: 'acesso_enviar_link_email',
          pessoa_tipo: 'responsavel', pessoa_id: cd.responsavel_id,
          pessoa_nome: 'Responsável principal', email: a.familia_email,
        });
        const ed = er?.data || er;
        if (ed?.sent) ok++; else fail++;
      } catch (e) { fail++; }
    }
    showToast(`✅ ${ok} enviado(s), ${fail} falha(s) de ${list.length} total.`, ok > 0 ? 'success' : 'error');
    loadAcessoPermissoes();
  }

  // Convidar família individual: cria responsável "Responsável principal" + envia email automático
  async function convidarFamilia(alunoId, alunoNome, email) {
    if (!await _lumiedConfirm(`Convidar a família de ${alunoNome} por email?\n\nVai criar um responsável "Responsável principal" e enviar pra ${email} um link pra tirar a foto. A família pode renomear depois ou completar com outros responsáveis (até 3).`)) return;
    showToast('Criando responsável e enviando email…', 'info');
    const r = await callAcesso({
      action: 'acesso_responsavel_create',
      aluno_id: alunoId,
      responsavel_nome: 'Responsável principal',
      parentesco: 'responsavel',
      responsavel_email: email,
      gerar_link: true,
    });
    const d = r?.data || r;
    if (r?.error) { showToast('Erro: ' + r.error, 'error'); return; }
    const link = d?.link?.link;
    if (!link) { showToast('Falha ao gerar link.', 'error'); return; }

    // Envia email
    const er = await callAcesso({
      action: 'acesso_enviar_link_email',
      pessoa_tipo: 'responsavel',
      pessoa_id: d.responsavel_id,
      pessoa_nome: 'Responsável principal',
      email,
    });
    const ed = er?.data || er;
    if (ed?.sent) showToast(`✅ Email enviado para ${email}`, 'success');
    else showToast('Responsável criado, mas email falhou: ' + (ed?.reason || 'erro'), 'error');

    loadAcessoPermissoes();
  }

  function renderResponsavelSlots(aluno) {
    const recom = 3;
    const cards = [];
    const respCount = (aluno.responsaveis || []).length;
    // Slots preenchidos
    for (const r of aluno.responsaveis || []) {
      const isObrigatorio = cards.length === 0;
      cards.push(renderRespCard(aluno, r, isObrigatorio, false));
    }
    // Slots vazios até atingir o recomendado
    while (cards.length < recom) {
      const isObrigatorio = cards.length === 0 && respCount === 0;
      cards.push(renderRespCard(aluno, null, isObrigatorio, true));
    }
    return cards.join('');
  }

  function renderRespCard(aluno, resp, isObrigatorio, vazio) {
    if (vazio) {
      const labelObr = isObrigatorio ? '<span style="background:#c0392b;color:#fff;font-size:9px;padding:2px 6px;border-radius:4px;margin-left:4px;text-transform:uppercase;font-weight:600;">Obrigatório</span>' : '<span style="color:var(--muted);font-size:11px;">opcional</span>';
      return `<div style="border:2px dashed #d0c8bd;border-radius:10px;padding:14px;text-align:center;background:#fafafa;cursor:pointer;transition:all .2s;" onclick="openPermModal('${aluno.id}','${escAttr(aluno.nome)}','${escAttr(aluno.familia_email||'')}')" onmouseover="this.style.borderColor='#1a6bb5';this.style.background='#f0f7ff'" onmouseout="this.style.borderColor='#d0c8bd';this.style.background='#fafafa'">
        <div style="font-size:32px;color:#c8c0b3;margin-bottom:6px;">＋</div>
        <div style="font-size:12px;color:#5a5249;font-weight:600;">Adicionar responsável ${labelObr}</div>
      </div>`;
    }
    // Slot preenchido
    let badgeBg, badgeColor, badgeIcon, badgeText, btnText, btnAction;
    switch (resp.face_status) {
      case 'cadastrada':
        badgeBg = '#edf7ef'; badgeColor = '#2d7a3a'; badgeIcon = '✅'; badgeText = 'Face OK'; break;
      case 'aguardando_aprovacao':
        badgeBg = '#fff8e1'; badgeColor = '#b07d10'; badgeIcon = '⏳'; badgeText = 'Aguarda aprovação'; break;
      case 'erro':
        badgeBg = '#fdf0f2'; badgeColor = '#c0392b'; badgeIcon = '✗'; badgeText = 'Erro sync'; break;
      case 'link_enviado':
        badgeBg = '#e3f2fd'; badgeColor = '#1976d2'; badgeIcon = '📨'; badgeText = 'Link enviado'; break;
      default:
        badgeBg = '#f8f5f0'; badgeColor = '#888'; badgeIcon = '○'; badgeText = 'Sem foto';
    }
    if (resp.face_status === 'sem_face' || resp.face_status === 'erro') {
      btnText = '📤 Enviar link'; btnAction = 'enviarLinkResp';
    } else if (resp.face_status === 'link_enviado') {
      btnText = '↻ Reenviar'; btnAction = 'enviarLinkResp';
    } else {
      btnText = ''; btnAction = '';
    }
    const foto = resp.foto_url
      ? `<img src="${resp.foto_url}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid ${badgeColor};">`
      : `<div style="width:48px;height:48px;border-radius:50%;background:${badgeBg};color:${badgeColor};display:flex;align-items:center;justify-content:center;font-size:24px;">👤</div>`;
    const obr = isObrigatorio ? '<span style="background:#c0392b;color:#fff;font-size:9px;padding:2px 6px;border-radius:4px;margin-left:4px;text-transform:uppercase;font-weight:600;">Obrig.</span>' : '';

    return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;background:#fff;display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;align-items:center;gap:10px;">
        ${foto}
        <div style="flex:1;min-width:0;overflow:hidden;">
          <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(resp.nome||'—')}${obr}</div>
          <div style="font-size:11px;color:var(--muted);">${escHtml(resp.parentesco||'sem parentesco')}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
        <span style="background:${badgeBg};color:${badgeColor};padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;">${badgeIcon} ${badgeText}</span>
        ${btnText ? `<button onclick="${btnAction}('${resp.responsavel_id}','${escAttr(resp.nome)}','${escAttr(resp.email||'')}')" style="padding:5px 10px;background:#1a6bb5;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">${btnText}</button>` : ''}
      </div>
      <div style="display:flex;justify-content:flex-end;">
        <button onclick="removerPermissao('${resp.id}')" style="padding:3px 8px;background:none;color:#c0392b;border:none;font-size:11px;cursor:pointer;">remover</button>
      </div>
    </div>`;
  }

  function enviarLinkResp(responsavel_id, responsavel_nome, email) {
    openLinkModal({ pessoa_tipo: 'responsavel', pessoa_id: responsavel_id, pessoa_nome: responsavel_nome, email });
  }

  function openPermModal(alunoId, alunoNome, familiaEmail) {
    document.getElementById('permAlunoId').value = alunoId;
    document.getElementById('permAlunoNome').textContent = alunoNome;
    document.getElementById('permNome').value = '';
    document.getElementById('permEmail').value = familiaEmail || '';
    document.getElementById('permFoto').value = '';
    document.getElementById('permValidade').value = '';
    document.getElementById('permModal').classList.add('show');
  }
  function closePermModal() { document.getElementById('permModal').classList.remove('show'); }

  async function salvarPermissao(comLink) {
    const alunoId = document.getElementById('permAlunoId').value;
    const nome = document.getElementById('permNome').value.trim();
    const parentesco = document.getElementById('permParentesco').value;
    const email = document.getElementById('permEmail').value.trim();
    const validade = document.getElementById('permValidade').value || null;
    if (!nome) { showToast('Informe o nome.', 'error'); return; }
    const fileInput = document.getElementById('permFoto');

    // Caminho 1: tem foto local → fluxo legado (foto direta sem link)
    if (fileInput.files.length) {
      const foto_base64 = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(fileInput.files[0]); });
      const d = await callAcesso({ action: 'acesso_permissao_create', aluno_id: alunoId, responsavel_nome: nome, parentesco, responsavel_email: email || null, foto_base64, validade });
      if (d.error) { showToast(d.error, 'error'); return; }
      showToast('Cadastrado com foto local!', 'success');
      closePermModal(); loadAcessoPermissoes(); return;
    }

    // Caminho 2: cria responsável (sem foto) + opcionalmente já gera link
    const r = await callAcesso({
      action: 'acesso_responsavel_create',
      aluno_id: alunoId,
      responsavel_nome: nome,
      parentesco,
      responsavel_email: email || null,
      validade,
      gerar_link: !!comLink,
    });
    const d = r?.data || r;
    if (r?.error) { showToast(r.error, 'error'); return; }
    showToast(comLink ? 'Cadastrado! Link gerado.' : 'Cadastrado.', 'success');
    closePermModal();

    if (comLink && d?.link?.link) {
      _linkResultData = {
        link: d.link.link,
        pessoa_tipo: 'responsavel',
        pessoa_id: d.responsavel_id,
        pessoa_nome: nome,
        email: email || null,
      };
      document.getElementById('linkResultNome').textContent = nome;
      document.getElementById('linkResultUrl').textContent = d.link.link;
      document.getElementById('linkResultStatus').textContent = '';
      document.getElementById('linkResultEmailBtn').disabled = !email;
      document.getElementById('linkResultEmailBtn').style.opacity = email ? 1 : .4;
      document.getElementById('linkResultModal').classList.add('show');
    }
    loadAcessoPermissoes();
  }

  async function removerPermissao(id) {
    if (!await _lumiedConfirm('Remover esta autorizacao?')) return;
    await callAcesso({ action: 'acesso_permissao_delete', id });
    loadAcessoPermissoes();
  }

  async function loadAcessoEventos() {
    const data = document.getElementById('acessoEvtData')?.value || '';
    const tipo = document.getElementById('acessoEvtTipo')?.value || '';
    const pessoa_tipo = document.getElementById('acessoEvtPessoaTipo')?.value || '';
    const d = await callAcesso({ action: 'acesso_eventos_list', data, tipo, pessoa_tipo });
    const list = d.data || d || [];
    const tb = document.getElementById('acessoEventosTable');
    if (!list.length) { tb.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum evento encontrado.</td></tr>'; return; }
    tb.innerHTML = list.map(e => {
      const foto = e.foto_captura_url ? `<img src="${e.foto_captura_url}" style="width:36px;height:36px;border-radius:4px;object-fit:cover;cursor:pointer;" onclick="window.open('${e.foto_captura_url}','_blank')">` : '—';
      return `<tr>
        <td style="font-size:12px;">${e.criado_em ? new Date(e.criado_em).toLocaleTimeString('pt-BR') : '—'}</td>
        <td style="font-weight:500;">${escHtml(e.pessoa_nome||'—')}</td>
        <td>${escHtml(e.pessoa_tipo||'—')}</td>
        <td><span class="turno-pill ${e.metodo==='face'?'integral':'semi'}">${e.metodo==='face'?'Face':'RFID'}</span></td>
        <td><span style="color:${e.direcao==='entrada'?'var(--green)':'var(--red)'};">${e.direcao==='entrada'?'🟢 Entrada':'🔴 Saida'}</span></td>
        <td style="font-size:12px;">${escHtml(e.dispositivo_nome||'—')}</td>
        <td>${foto}</td>
      </tr>`;
    }).join('');
  }

  // ── SETUP FACE ID (CHECKLIST) ─────────────────────────
  async function loadAcessoSetup() {
    const r = await callAcesso({ action: 'acesso_setup_checklist' });
    const d = r?.data || r || {};

    // Header
    const score = Number(d.score || 0);
    document.getElementById('setupScore').textContent = score + '%';
    if (d.pode_operar) {
      document.getElementById('setupStatus').textContent = '🟢 Pronto pra operar';
      document.getElementById('setupBlockers').textContent = score === 100 ? 'Tudo configurado.' : `${100 - score}% do checklist ainda em aberto, mas nada bloqueia o uso.`;
    } else {
      document.getElementById('setupStatus').textContent = '🔴 Bloqueado';
      document.getElementById('setupBlockers').textContent = `${d.blockers} item(ns) bloqueante(s) — resolva antes de usar.`;
    }

    // Items
    const cont = document.getElementById('setupItems');
    const items = d.items || [];
    const COR = { ok: '#2d7a3a', warn: '#b07d10', error: '#c0392b', muted: '#888' };
    const ICO = { ok: '✅', warn: '⚠️', error: '❌', muted: '○' };
    cont.innerHTML = items.map(it => {
      const c = COR[it.severity] || '#666';
      const ic = ICO[it.severity] || '○';
      const blk = it.blocking && !it.ok ? '<span style="background:#c0392b;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:8px;text-transform:uppercase;font-weight:600;">Bloqueante</span>' : '';
      const action = it.action ? `<button onclick="setupGoto('${it.action.panel}')" style="margin-left:auto;padding:6px 14px;background:#1a1a1a;color:#fff;border:none;border-radius:8px;font-size:12px;cursor:pointer;white-space:nowrap;">${escHtml(it.action.label)} →</button>` : '';
      return `<div style="display:flex;align-items:center;gap:14px;background:#fff;border:1px solid ${c}33;border-left:4px solid ${c};border-radius:10px;padding:14px 18px;">
        <div style="font-size:22px;">${ic}</div>
        <div style="flex:1;">
          <div style="font-weight:600;color:${c};font-size:14px;">${escHtml(it.label)}${blk}</div>
          <div style="color:var(--muted);font-size:12px;margin-top:2px;">${escHtml(it.detail||'')}</div>
        </div>
        ${action}
      </div>`;
    }).join('');

    // Devices table
    const devs = d.devices || [];
    const tb = document.getElementById('setupDevicesTable');
    if (!devs.length) {
      tb.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhum dispositivo cadastrado. Vá em "Dispositivos" para adicionar.</td></tr>';
    } else {
      tb.innerHTML = devs.map(dv => {
        const modo = dv.via_bridge ? '<span style="color:#1976d2;font-weight:600;">🌐 via Bridge</span>' : '<span style="color:#888;">HTTP direto</span>';
        const senha = dv.tem_senha ? '<span style="color:#2d7a3a;">✓ OK</span>' : '<span style="color:#c0392b;font-weight:600;">⚠️ não configurada</span>';
        const hb = dv.ultimo_heartbeat ? new Date(dv.ultimo_heartbeat).toLocaleString('pt-BR') : '—';
        return `<tr>
          <td style="font-weight:500;">${escHtml(dv.nome||'—')}</td>
          <td style="font-family:'DM Mono',monospace;font-size:12px;">${escHtml(dv.ip||'—')}:${dv.porta||443}</td>
          <td>${modo}</td>
          <td>${senha}</td>
          <td style="font-size:12px;">${hb}</td>
        </tr>`;
      }).join('');
    }
  }

  function setupGoto(panel) {
    const navItems = document.querySelectorAll('.nav-item');
    let target = null;
    navItems.forEach(n => { if (n.getAttribute('onclick')?.includes(`'${panel}'`)) target = n; });
    if (target) target.click();
    else showPanel(panel);
  }

  // ── Pendências de face ───────────────────────────────
  let _setupPendentesData = [];

  async function setupTogglePendentes() {
    const wrap = document.getElementById('setupPendentesWrap');
    const btn = document.getElementById('setupPendentesToggle');
    if (wrap.style.display === 'none') {
      wrap.style.display = 'block';
      btn.textContent = 'Ocultar lista';
      await loadSetupPendentes();
    } else {
      wrap.style.display = 'none';
      btn.textContent = 'Mostrar lista';
    }
  }

  async function loadSetupPendentes() {
    const r = await callAcesso({ action: 'acesso_pendencias_face' });
    const d = r?.data || r || {};
    _setupPendentesData = d.pendentes || [];
    document.getElementById('setupPendentesCount').textContent = _setupPendentesData.length;
    const tb = document.getElementById('setupPendentesTable');
    if (!_setupPendentesData.length) {
      tb.innerHTML = '<tr><td colspan="5" class="empty-state">🎉 Todos os alunos têm face cadastrada!</td></tr>';
      return;
    }
    tb.innerHTML = _setupPendentesData.map(p => {
      const linkBadge = p.tem_link_ativo
        ? `<span style="background:#fff8e1;color:#b07d10;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;">Link enviado</span>`
        : `<span style="color:#888;font-size:12px;">—</span>`;
      const emailCell = p.email
        ? `<span style="font-size:12px;">${escHtml(p.email)}</span>`
        : `<span style="color:#c0392b;font-size:11px;">⚠️ sem email</span>`;
      const whatsCell = p.whatsapp
        ? `<span style="font-family:'DM Mono',monospace;font-size:12px;">${escHtml(p.whatsapp)}</span>`
        : `<span style="color:#888;font-size:12px;">—</span>`;
      return `<tr>
        <td style="font-weight:500;">${escHtml(p.nome||'—')}</td>
        <td>${emailCell}</td>
        <td>${whatsCell}</td>
        <td>${linkBadge}</td>
        <td><button onclick="setupEnviarLinkPendente('${p.id}','${escAttr(p.nome)}','${escAttr(p.email||'')}')" style="padding:6px 12px;background:#1a6bb5;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">📤 Gerar link</button></td>
      </tr>`;
    }).join('');
  }

  function setupEnviarLinkPendente(id, nome, email) {
    openLinkModal({ pessoa_tipo: 'aluno', pessoa_id: id, pessoa_nome: nome, email });
  }

  // Auto-refresh enquanto painel aberto
  setInterval(() => {
    const p = document.getElementById('panelAcessoSetup');
    if (p && p.classList.contains('active')) loadAcessoSetup();
  }, 30_000);

  // ── LUMIED BRIDGE ─────────────────────────────────────
  let _bridgeToken = null;
  let _bridgeRevealed = false;

  function _bridgeFmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('pt-BR'); } catch { return iso; }
  }
  function _bridgeAgo(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return `há ${Math.round(ms/1000)}s`;
    if (ms < 3600_000) return `há ${Math.round(ms/60_000)}min`;
    return `há ${Math.round(ms/3600_000)}h`;
  }

  async function loadAcessoBridge() {
    const r = await callAcesso({ action: 'acesso_bridge_status' });
    const s = r?.data || r || {};
    const gw = s.gateway || {};

    const conn = !!gw.connected;
    document.getElementById('bridgeConn').textContent = conn ? '🟢 Online' : '🔴 Offline';
    document.getElementById('bridgeConn').style.color = conn ? '#2d7a3a' : '#c0392b';
    document.getElementById('bridgeConnSub').textContent = conn ? 'WS conectado ao gateway' : (gw.error || 'sem conexão');

    const hb = s.ultimo_heartbeat_db || (gw.last_heartbeat ? new Date(gw.last_heartbeat).toISOString() : null);
    document.getElementById('bridgeHb').textContent = hb ? _bridgeFmtDate(hb) : 'nunca';
    document.getElementById('bridgeHbAgo').textContent = hb ? _bridgeAgo(hb) : '—';

    document.getElementById('bridgePending').textContent = String(gw.pending ?? (s.comandos_em_voo?.length || 0));

    document.getElementById('bridgeTokenSt').textContent = s.token_configurado ? '✅ Sim' : '⚠️ Não';
    document.getElementById('bridgeTokenSt').style.color = s.token_configurado ? '#2d7a3a' : '#b07d10';

    const cmds = s.comandos_em_voo || [];
    const tb = document.getElementById('bridgeCmdsTable');
    if (!cmds.length) {
      tb.innerHTML = '<tr><td colspan="3" class="empty-state">Nenhum comando em voo.</td></tr>';
    } else {
      tb.innerHTML = cmds.map(c => {
        const cor = c.status === 'pendente' ? '#b07d10' : '#1976d2';
        return `<tr>
          <td style="font-family:'DM Mono',monospace;font-size:12px;">${escHtml(c.tipo||'')}</td>
          <td><span style="color:${cor};text-transform:uppercase;font-weight:600;font-size:11px;">${escHtml(c.status||'')}</span></td>
          <td style="font-size:12px;">${_bridgeFmtDate(c.criado_em)}</td>
        </tr>`;
      }).join('');
    }

    if (_bridgeRevealed && _bridgeToken) {
      document.getElementById('bridgeTokenBox').textContent = _bridgeToken;
    }
  }

  async function bridgeTokenReveal() {
    if (_bridgeRevealed) {
      _bridgeRevealed = false;
      document.getElementById('bridgeTokenBox').textContent = '••••••••••••••••••••••••••••••••';
      document.getElementById('bridgeTokenReveal').textContent = 'Mostrar';
      return;
    }
    const r = await callAcesso({ action: 'acesso_bridge_token_get' });
    const tok = r?.data?.bridge_token || r?.bridge_token;
    if (!tok) {
      alert('Nenhum token configurado. Clique em "Rotacionar" para gerar um agora.');
      return;
    }
    _bridgeToken = tok;
    _bridgeRevealed = true;
    document.getElementById('bridgeTokenBox').textContent = tok;
    document.getElementById('bridgeTokenReveal').textContent = 'Ocultar';
  }

  async function bridgeTokenCopy() {
    if (!_bridgeToken) {
      const r = await callAcesso({ action: 'acesso_bridge_token_get' });
      _bridgeToken = r?.data?.bridge_token || r?.bridge_token || null;
    }
    if (!_bridgeToken) {
      alert('Nenhum token para copiar — gere um clicando em "Rotacionar".');
      return;
    }
    try {
      await navigator.clipboard.writeText(_bridgeToken);
      alert('Token copiado para a área de transferência.');
    } catch (_) {
      alert('Não foi possível copiar. Selecione manualmente o token revelado.');
    }
  }

  async function bridgeTokenRotate() {
    if (!confirm('Gerar novo token vai invalidar o atual e forçar reconexão de qualquer daemon conectado. Continuar?')) return;
    const r = await callAcesso({ action: 'acesso_bridge_token_rotate' });
    const tok = r?.data?.bridge_token || r?.bridge_token;
    if (!tok) {
      alert('Erro ao rotacionar: ' + (r?.error || 'desconhecido'));
      return;
    }
    _bridgeToken = tok;
    _bridgeRevealed = true;
    document.getElementById('bridgeTokenBox').textContent = tok;
    document.getElementById('bridgeTokenReveal').textContent = 'Ocultar';
    document.getElementById('bridgeTokenSt').textContent = '✅ Sim';
    document.getElementById('bridgeTokenSt').style.color = '#2d7a3a';
    alert('Novo token gerado. Atualize o .env do daemon e reinicie.');
  }

  function _fmtUptime(s) {
    if (!s || !Number.isFinite(s)) return '—';
    const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60);
    if (d) return `${d}d ${h}h ${m}min`;
    if (h) return `${h}h ${m}min`;
    return `${m}min`;
  }

  async function bridgeLoadHardware() {
    const btn = document.getElementById('bridgeHwBtn');
    const box = document.getElementById('bridgeHwBox');
    btn.disabled = true; btn.textContent = 'Consultando…';
    box.textContent = 'Aguardando resposta do daemon (até 8s)…';
    try {
      const r = await callAcesso({ action: 'acesso_bridge_hardware' });
      const d = r?.data || r || {};
      if (!d.ok) {
        box.innerHTML = `<span style="color:#c0392b;">⚠️ ${escHtml(d.error || 'Falha ao consultar')}</span>`;
        return;
      }
      const h = d.hardware || {};
      const tempStr = (h.temp_c != null) ? `${h.temp_c.toFixed(1)} °C` : '—';
      const tempColor = (h.temp_c != null && h.temp_c >= 75) ? '#c0392b' : (h.temp_c != null && h.temp_c >= 65 ? '#b07d10' : '#2d7a3a');
      const load = Array.isArray(h.load_avg) ? h.load_avg.map(n => n.toFixed(2)).join(' / ') : '—';
      const memUsedPct = h.memory ? Math.round((h.memory.used_mb / Math.max(1, h.memory.total_mb)) * 100) : null;
      box.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;font-size:13px;color:#1a1a1a;">
          <div><div style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Modelo</div><div style="font-weight:600;">${escHtml(h.pi_model || h.platform || '—')}</div></div>
          <div><div style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Hostname</div><div style="font-family:'DM Mono',monospace;font-size:12px;">${escHtml(h.hostname || '—')}</div></div>
          <div><div style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;">CPU</div><div>${escHtml((h.cpu?.model || '—'))} <span style="color:var(--muted);">×${h.cpu?.count ?? '—'}</span></div></div>
          <div><div style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;">RAM</div><div>${h.memory?.used_mb ?? '—'} / ${h.memory?.total_mb ?? '—'} MB ${memUsedPct != null ? `<span style="color:var(--muted);">(${memUsedPct}%)</span>` : ''}</div></div>
          <div><div style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Temperatura</div><div style="color:${tempColor};font-weight:600;">${tempStr}</div></div>
          <div><div style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Load avg (1/5/15)</div><div style="font-family:'DM Mono',monospace;font-size:12px;">${load}</div></div>
          <div><div style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Uptime do SO</div><div>${_fmtUptime(h.uptime_s)}</div></div>
          <div><div style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Daemon (Node)</div><div>${escHtml(h.node_version || '—')} <span style="color:var(--muted);">(rodando ${_fmtUptime(h.daemon_uptime_s)})</span></div></div>
        </div>`;
    } catch (e) {
      box.innerHTML = `<span style="color:#c0392b;">⚠️ ${escHtml(String(e?.message || e))}</span>`;
    } finally {
      btn.disabled = false; btn.textContent = 'Consultar';
    }
  }

  setInterval(() => {
    const panel = document.getElementById('panelAcessoBridge');
    if (panel && panel.classList.contains('active')) loadAcessoBridge();
  }, 15_000);

  // ── LPR (Acesso Veicular) ─────────────────────────────
  let _lprPlacas = [];

  function lprTab(which, btnEl) {
    document.querySelectorAll('#panelAcessoLpr .filter-bar .fb').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
    document.getElementById('lprTabPlacas').style.display = which === 'placas' ? '' : 'none';
    document.getElementById('lprTabEventos').style.display = which === 'eventos' ? '' : 'none';
    document.getElementById('lprTabSolicitacoes').style.display = which === 'solicitacoes' ? '' : 'none';
    document.getElementById('lprTabCameras').style.display = which === 'cameras' ? '' : 'none';
    document.getElementById('lprTabRelatorio').style.display = which === 'relatorio' ? '' : 'none';
    document.getElementById('lprTabSetup').style.display = which === 'setup' ? '' : 'none';
    if (which === 'eventos') loadAcessoLpr();
    if (which === 'solicitacoes') loadLprSolicitacoes();
    if (which === 'cameras') loadLprCameras();
    if (which === 'relatorio') loadLprRelatorio();
    if (which === 'setup') lprUpdateSetupProgress();
  }

  // ── Setup guide (checklist persistente) ───────────────
  function lprMarkStep(n, ev) {
    const set = new Set(JSON.parse(localStorage.getItem('lpr_setup_done') || '[]'));
    if (ev.target.checked) set.add(n); else set.delete(n);
    localStorage.setItem('lpr_setup_done', JSON.stringify([...set]));
    lprUpdateSetupProgress();
  }
  function lprUpdateSetupProgress() {
    const set = new Set(JSON.parse(localStorage.getItem('lpr_setup_done') || '[]'));
    // 9 steps: 0 (pré-req) + 1..8
    document.getElementById('lprSetupProgress').textContent = `${set.size}/9`;
    document.querySelectorAll('input[data-lpr-step]').forEach(cb => {
      cb.checked = set.has(Number(cb.dataset.lprStep));
    });
  }
  function lprCopySnippet(btn) {
    const pre = btn.parentElement.querySelector('pre');
    const text = pre.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = '✓ Copiado';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }).catch(() => { btn.textContent = '✗ Erro'; });
  }

  function lprOpenLightbox(url) {
    document.getElementById('lprLightboxImg').src = url;
    document.getElementById('lprLightbox').style.display = 'flex';
  }

  async function lprFetchEventoFoto(eventoId, imgEl) {
    if (imgEl.dataset.loading === '1') return;
    imgEl.dataset.loading = '1';
    const r = await callAcesso({ action: 'acesso_lpr_evento_foto_url', evento_id: eventoId });
    const url = r?.data?.url || r?.url;
    if (url) { imgEl.src = url; imgEl.dataset.url = url; imgEl.style.cursor = 'zoom-in'; imgEl.onclick = () => lprOpenLightbox(url); }
  }

  async function loadAcessoLpr() {
    // Carrega placas (sempre) e eventos (se aba ativa)
    const [pr, er] = await Promise.all([
      callAcesso({ action: 'acesso_lpr_placas_list' }),
      callAcesso({ action: 'acesso_lpr_eventos_list', limit: 50, apenas_nao_autorizadas: !!document.getElementById('lprFiltroNaoAutorizadas')?.checked }),
    ]);
    _lprPlacas = pr?.data || pr || [];
    const eventos = er?.data || er || [];

    document.getElementById('lprPlacasCount').textContent = _lprPlacas.length;
    document.getElementById('lprPlacasAtivas').textContent = _lprPlacas.filter(p => p.ativo).length;

    const tb = document.getElementById('lprPlacasTable');
    if (!_lprPlacas.length) {
      tb.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhuma placa cadastrada. Clique em + Nova placa.</td></tr>';
    } else {
      tb.innerHTML = _lprPlacas.map(p => {
        const validade = (p.validade_inicio || p.validade_fim) ? `${p.validade_inicio || '—'} → ${p.validade_fim || '∞'}` : '—';
        const statusCor = p.ativo ? '#2d7a3a' : '#999';
        const statusTxt = p.ativo ? '✅ Ativa' : '⏸️ Inativa';
        const tipoLabel = ({familia:'Família',funcionario:'Funcionário',aluno:'Aluno',visitante:'Visitante',outro:'Outro'})[p.owner_tipo] || p.owner_tipo;
        return `<tr>
          <td style="font-family:'DM Mono',monospace;font-weight:600;letter-spacing:1px;">${escHtml(p.placa)}</td>
          <td style="font-size:13px;">${escHtml(p.apelido || '—')}</td>
          <td style="font-size:12px;color:var(--muted);">${escHtml(tipoLabel)}</td>
          <td style="font-size:12px;">${escHtml(validade)}</td>
          <td style="font-size:12px;color:${statusCor};font-weight:600;">${statusTxt}</td>
          <td style="text-align:right;">
            <button onclick="lprPlacaEdit('${p.id}')" style="background:none;border:none;color:#1976d2;cursor:pointer;font-size:12px;">Editar</button>
            <button onclick="lprPlacaDelete('${p.id}','${escHtml(p.placa)}')" style="background:none;border:none;color:#c0392b;cursor:pointer;font-size:12px;margin-left:8px;">Excluir</button>
          </td>
        </tr>`;
      }).join('');
    }

    const tb2 = document.getElementById('lprEventosTable');
    if (!eventos.length) {
      tb2.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhum evento ainda. Eventos aparecem quando a câmera lê uma placa.</td></tr>';
    } else {
      tb2.innerHTML = eventos.map(e => {
        const conf = e.confidence != null ? `${(e.confidence * 100).toFixed(1)}%` : '—';
        const motivoLabel = ({autorizado:'✅ Autorizado',nao_cadastrada:'⚠️ Não cadastrada',fora_validade:'⛔ Fora da validade',fora_horario:'🕐 Fora do horário',inativa:'⏸️ Placa inativa',baixa_confianca:'❓ Baixa confiança'})[e.motivo] || e.motivo;
        const cor = e.autorizado ? '#2d7a3a' : '#c0392b';
        const vinculo = e.placa_info ? `${escHtml(e.placa_info.apelido || '—')} <span style="color:var(--muted);font-size:11px;">(${escHtml(({familia:'Família',funcionario:'Funcionário',aluno:'Aluno',visitante:'Visitante',outro:'Outro'})[e.placa_info.owner_tipo] || '')})</span>` : '<span style="color:var(--muted);">—</span>';
        const fotoCell = e.foto_path
          ? `<img data-evento-id="${e.id}" src="" alt="thumb" style="width:64px;height:48px;object-fit:cover;border-radius:4px;background:#f0f0f0;border:1px solid var(--border);">`
          : '<span style="color:var(--muted);font-size:11px;">—</span>';
        return `<tr>
          <td>${fotoCell}</td>
          <td style="font-size:12px;white-space:nowrap;">${_bridgeFmtDate(e.ts)}</td>
          <td style="font-family:'DM Mono',monospace;font-weight:600;letter-spacing:1px;">${escHtml(e.placa_lida)}</td>
          <td style="font-size:12px;">${conf}</td>
          <td style="font-size:12px;color:${cor};font-weight:600;">${motivoLabel}</td>
          <td style="font-size:13px;">${vinculo}</td>
        </tr>`;
      }).join('');
      // Lazy-load thumbnails (signed URLs) — uma chamada por evento, async
      tb2.querySelectorAll('img[data-evento-id]').forEach(img => {
        lprFetchEventoFoto(img.dataset.eventoId, img);
      });
    }

    // Atualiza badge de pendentes (sem bloquear)
    callAcesso({ action: 'acesso_lpr_solicitacoes_list', status_filter: 'pendente' }).then(r => {
      const n = (r?.data || r || []).length;
      const badge = document.getElementById('lprSolBadge');
      if (n > 0) { badge.textContent = n; badge.style.display = ''; }
      else badge.style.display = 'none';
    }).catch(() => {});
  }

  async function loadLprSolicitacoes() {
    const status = document.getElementById('lprSolFiltroStatus').value;
    const r = await callAcesso({ action: 'acesso_lpr_solicitacoes_list', status_filter: status || undefined });
    const sols = r?.data || r || [];
    const list = document.getElementById('lprSolList');
    if (!sols.length) {
      list.innerHTML = '<div class="empty-state">Nenhuma solicitação ' + (status ? `com status "${status}"` : '') + '.</div>';
      return;
    }
    list.innerHTML = sols.map(s => {
      const stCor = s.status === 'pendente' ? '#b07d10' : (s.status === 'aprovada' ? '#2d7a3a' : '#c0392b');
      const stLabel = s.status === 'pendente' ? '⏳ Pendente' : (s.status === 'aprovada' ? '✅ Aprovada' : '❌ Rejeitada');
      const fam = s.familia || {};
      const fotoBtn = s.foto_path
        ? `<img data-sol-id="${s.id}" src="" alt="" style="width:120px;height:90px;object-fit:cover;border-radius:6px;background:#f0f0f0;border:1px solid var(--border);cursor:zoom-in;">`
        : '<div style="width:120px;height:90px;background:#f5f5f5;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px;">sem foto</div>';
      const acoes = s.status === 'pendente' ? `
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button onclick="lprSolAprovar('${s.id}','${escHtml(s.placa)}')" style="background:#2d7a3a;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;cursor:pointer;font-weight:600;">✅ Aprovar</button>
          <button onclick="lprSolRejeitar('${s.id}','${escHtml(s.placa)}')" style="background:#fff;color:#c0392b;border:1px solid #c0392b;border-radius:8px;padding:8px 14px;font-size:12px;cursor:pointer;">❌ Rejeitar</button>
        </div>` : (s.motivo_rejeicao ? `<div style="margin-top:8px;font-size:12px;color:var(--muted);"><strong>Motivo da rejeição:</strong> ${escHtml(s.motivo_rejeicao)}</div>` : '');
      return `<div style="background:var(--white);border-radius:12px;border:1px solid var(--border);padding:16px;display:grid;grid-template-columns:120px 1fr auto;gap:16px;align-items:start;">
        <div>${fotoBtn}</div>
        <div>
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;">
            <div style="font-family:'DM Mono',monospace;font-weight:700;font-size:18px;letter-spacing:1.5px;">${escHtml(s.placa)}</div>
            <div style="color:var(--muted);font-size:13px;">${escHtml(s.apelido || '')}</div>
          </div>
          <div style="font-size:13px;margin-bottom:6px;"><strong>${escHtml(fam.responsavel_nome || 'Família')}</strong> <span style="color:var(--muted);font-size:12px;">${escHtml(fam.email || '')}</span></div>
          ${s.observacao ? `<div style="font-size:13px;color:var(--muted);margin-bottom:6px;font-style:italic;">"${escHtml(s.observacao)}"</div>` : ''}
          <div style="font-size:11px;color:var(--muted);">Enviada ${_bridgeFmtDate(s.criado_em)} ${_bridgeAgo(s.criado_em)}</div>
          ${acoes}
        </div>
        <div style="color:${stCor};font-weight:600;font-size:12px;">${stLabel}</div>
      </div>`;
    }).join('');
    // Lazy-load das fotos
    list.querySelectorAll('img[data-sol-id]').forEach(async img => {
      const r2 = await callAcesso({ action: 'acesso_lpr_solicitacao_foto_url', solicitacao_id: img.dataset.solId });
      const url = r2?.data?.url || r2?.url;
      if (url) { img.src = url; img.onclick = () => lprOpenLightbox(url); }
    });
  }

  async function lprSolAprovar(id, placa) {
    if (!confirm(`Aprovar a placa ${placa}? Ela será adicionada às placas autorizadas e sincronizada com o daemon.`)) return;
    const r = await callAcesso({ action: 'acesso_lpr_solicitacao_aprovar', solicitacao_id: id });
    if (r?.error) { alert('Erro: ' + r.error); return; }
    loadLprSolicitacoes();
    loadAcessoLpr();
  }

  async function lprSolRejeitar(id, placa) {
    const motivo = prompt(`Rejeitar a placa ${placa} — motivo (mostrado pra família):`);
    if (motivo === null) return;
    const r = await callAcesso({ action: 'acesso_lpr_solicitacao_rejeitar', solicitacao_id: id, motivo: motivo.trim() || 'Não informado' });
    if (r?.error) { alert('Erro: ' + r.error); return; }
    loadLprSolicitacoes();
  }

  // ── Câmeras (Fase 3) ──────────────────────────────────
  let _lprCameras = [];

  async function loadLprCameras() {
    const r = await callAcesso({ action: 'acesso_lpr_cameras_list' });
    _lprCameras = r?.data || r || [];
    const el = document.getElementById('lprCamerasList');
    if (!_lprCameras.length) {
      el.innerHTML = '<div class="empty-state">Nenhuma câmera cadastrada. Enquanto não houver, o daemon usa <code>LPR_RTSP_URL</code> do .env como fallback.</div>';
      return;
    }
    el.innerHTML = _lprCameras.map(c => {
      const safeRtsp = String(c.rtsp_url || '').replace(/:\/\/[^@]+@/, '://***@');
      const stCor = c.ativa ? '#2d7a3a' : '#999';
      const stTxt = c.ativa ? '✅ Ativa' : '⏸️ Inativa';
      const acionamento = c.gpio_pin != null ? `🔌 GPIO ${c.gpio_pin} (${c.gpio_pulse_ms}ms)` : (c.gate_webhook_url ? '🌐 Webhook' : '— sem acionamento');
      const roi = (c.roi_polygon && Array.isArray(c.roi_polygon) && c.roi_polygon.length >= 3) ? `🎯 ROI ${c.roi_polygon.length} pts` : 'sem ROI (frame inteiro)';
      return `<div style="background:var(--white);border-radius:12px;border:1px solid var(--border);padding:16px;display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start;">
        <div>
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">
            <div style="font-weight:700;font-size:15px;">${escHtml(c.nome)}</div>
            <div style="color:${stCor};font-size:12px;font-weight:600;">${stTxt}</div>
          </div>
          <div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);margin-bottom:6px;word-break:break-all;">${escHtml(safeRtsp)}</div>
          <div style="font-size:12px;color:var(--muted);">
            ${c.scan_interval_ms}ms · conf≥${c.confidence_min} · ${escHtml(roi)} · ${escHtml(acionamento)}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button onclick="lprCameraEdit('${c.id}')" style="background:#fff;color:#1976d2;border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;cursor:pointer;">Editar</button>
          <button onclick="lprCameraEdit('${c.id}',true)" style="background:#fff;color:#1a1a1a;border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;cursor:pointer;">🎯 ROI</button>
          <button onclick="lprCameraDelete('${c.id}','${escHtml(c.nome)}')" style="background:#fff;color:#c0392b;border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;cursor:pointer;">Excluir</button>
        </div>
      </div>`;
    }).join('');
  }

  function lprCameraNova() {
    _lprCamAutosaveOn = false; _lprCamCancelAutosave(); _lprCamSetStatus('', '');
    document.getElementById('lprCamModalTitle').textContent = 'Nova câmera';
    document.getElementById('lprCamId').value = '';
    document.getElementById('lprCamNome').value = '';
    document.getElementById('lprCamRtsp').value = '';
    document.getElementById('lprCamAlpr').value = 'http://localhost:32168/v1/vision/alpr';
    document.getElementById('lprCamScan').value = 2000;
    document.getElementById('lprCamConf').value = 0.85;
    document.getElementById('lprCamGateUrl').value = '';
    document.getElementById('lprCamGateTok').value = '';
    document.getElementById('lprCamGpioPin').value = '';
    document.getElementById('lprCamGpioPulse').value = 500;
    document.getElementById('lprCamAtiva').checked = true;
    document.getElementById('lprCamRoiBtn').style.display = 'none';
    document.getElementById('lprCameraModal').style.display = 'flex';
  }

  function lprCameraEdit(id, openRoi) {
    const c = _lprCameras.find(x => x.id === id);
    if (!c) return;
    _lprCamAutosaveOn = false; _lprCamCancelAutosave();  // off enquanto preenche
    document.getElementById('lprCamModalTitle').textContent = 'Editar câmera';
    document.getElementById('lprCamId').value = c.id;
    document.getElementById('lprCamNome').value = c.nome;
    document.getElementById('lprCamRtsp').value = c.rtsp_url;
    document.getElementById('lprCamAlpr').value = c.alpr_url;
    document.getElementById('lprCamScan').value = c.scan_interval_ms;
    document.getElementById('lprCamConf').value = c.confidence_min;
    document.getElementById('lprCamGateUrl').value = c.gate_webhook_url || '';
    document.getElementById('lprCamGateTok').value = c.gate_webhook_token || '';
    document.getElementById('lprCamGpioPin').value = c.gpio_pin != null ? c.gpio_pin : '';
    document.getElementById('lprCamGpioPulse').value = c.gpio_pulse_ms || 500;
    document.getElementById('lprCamAtiva').checked = !!c.ativa;
    document.getElementById('lprCamRoiBtn').style.display = '';
    _lprCamWireAutosave();
    _lprCamSetStatus('💾 auto-save ativo (2s após a última edição)', '#1976d2');
    setTimeout(() => { _lprCamAutosaveOn = true; }, 200);  // evita disparar com os inputs do edit()
    if (openRoi) {
      document.getElementById('lprCameraModal').style.display = 'none';
      lprOpenRoiEditor();
    } else {
      document.getElementById('lprCameraModal').style.display = 'flex';
    }
  }

  function _lprCamReadForm() {
    return {
      action: 'acesso_lpr_camera_save',
      id: document.getElementById('lprCamId').value || undefined,
      nome: document.getElementById('lprCamNome').value.trim(),
      rtsp_url: document.getElementById('lprCamRtsp').value.trim(),
      alpr_url: document.getElementById('lprCamAlpr').value.trim() || undefined,
      scan_interval_ms: Number(document.getElementById('lprCamScan').value),
      confidence_min: Number(document.getElementById('lprCamConf').value),
      gate_webhook_url: document.getElementById('lprCamGateUrl').value.trim() || null,
      gate_webhook_token: document.getElementById('lprCamGateTok').value.trim() || null,
      gpio_pin: document.getElementById('lprCamGpioPin').value.trim() === '' ? null : Number(document.getElementById('lprCamGpioPin').value),
      gpio_pulse_ms: Number(document.getElementById('lprCamGpioPulse').value),
      ativa: document.getElementById('lprCamAtiva').checked,
    };
  }

  async function lprCameraSave() {
    _lprCamCancelAutosave();
    const body = _lprCamReadForm();
    if (!body.nome || !body.rtsp_url) { alert('Nome e RTSP URL são obrigatórios.'); return; }
    const r = await callAcesso(body);
    if (r?.error) { alert('Erro: ' + r.error); return; }
    document.getElementById('lprCameraModal').style.display = 'none';
    loadLprCameras();
  }

  // ── Auto-save modal câmera (debounced 1.5s, só pra edição) ───
  let _lprCamAutosaveTimer = null;
  let _lprCamAutosaveOn = false;

  function _lprCamSetStatus(text, color) {
    const el = document.getElementById('lprCamSaveStatus');
    el.textContent = text;
    el.style.color = color || '#888';
    el.style.display = text ? '' : 'none';
  }
  function _lprCamCancelAutosave() {
    if (_lprCamAutosaveTimer) { clearTimeout(_lprCamAutosaveTimer); _lprCamAutosaveTimer = null; }
  }
  function _lprCamArmAutosave() {
    if (!_lprCamAutosaveOn) return;
    _lprCamCancelAutosave();
    _lprCamSetStatus('digitando…', '#888');
    _lprCamAutosaveTimer = setTimeout(async () => {
      const body = _lprCamReadForm();
      if (!body.id || !body.nome || !body.rtsp_url) {
        _lprCamSetStatus('⚠️ nome/RTSP obrigatórios', '#c0392b');
        return;
      }
      _lprCamSetStatus('💾 salvando…', '#1976d2');
      const r = await callAcesso(body);
      if (r?.error) {
        _lprCamSetStatus('⚠️ erro: ' + r.error, '#c0392b');
        return;
      }
      const t = new Date();
      const hh = String(t.getHours()).padStart(2,'0'), mm = String(t.getMinutes()).padStart(2,'0');
      _lprCamSetStatus(`✓ salvo às ${hh}:${mm}`, '#2d7a3a');
      // Atualiza a lista de fundo (sem fechar modal)
      loadLprCameras();
    }, 1500);
  }
  function _lprCamWireAutosave() {
    ['lprCamNome','lprCamRtsp','lprCamAlpr','lprCamScan','lprCamConf','lprCamGateUrl','lprCamGateTok','lprCamGpioPin','lprCamGpioPulse','lprCamAtiva'].forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.dataset.autosaveWired === '1') return;
      el.dataset.autosaveWired = '1';
      el.addEventListener('input', _lprCamArmAutosave);
      el.addEventListener('change', _lprCamArmAutosave);
    });
  }

  async function lprCameraDelete(id, nome) {
    if (!confirm(`Excluir câmera "${nome}"? Esta ação não pode ser desfeita.`)) return;
    const r = await callAcesso({ action: 'acesso_lpr_camera_delete', id });
    if (r?.error) { alert('Erro: ' + r.error); return; }
    loadLprCameras();
  }

  // ── ROI editor (canvas) ───────────────────────────────
  let _lprRoiCamId = null;
  let _lprRoiPoints = []; // {x:0..1, y:0..1}
  let _lprRoiImgW = 1280;
  let _lprRoiImgH = 720;

  async function lprOpenRoiEditor() {
    const id = document.getElementById('lprCamId').value;
    if (!id) { alert('Salve a câmera primeiro.'); return; }
    const c = _lprCameras.find(x => x.id === id);
    if (!c) { alert('Câmera não encontrada.'); return; }
    _lprRoiCamId = id;
    _lprRoiPoints = (c.roi_polygon && Array.isArray(c.roi_polygon)) ? c.roi_polygon.slice() : [];
    document.getElementById('lprRoiCamNome').textContent = c.nome;
    document.getElementById('lprCameraModal').style.display = 'none';
    document.getElementById('lprRoiModal').style.display = 'flex';
    await lprRoiSnapshot();
    lprRoiRedraw();
  }

  async function lprRoiSnapshot() {
    const img = document.getElementById('lprRoiSnap');
    img.removeAttribute('src');
    const r = await callAcesso({ action: 'acesso_lpr_camera_snapshot', camera_id: _lprRoiCamId });
    const d = r?.data || r || {};
    if (!d.ok || !d.jpeg_b64) {
      alert('Não consegui pegar snapshot da câmera. Erro: ' + (d.error || 'bridge offline?') + '\nVocê ainda pode definir o ROI sem visualizar a imagem.');
      img.src = '';
      _lprRoiImgW = 1280; _lprRoiImgH = 720;
      lprRoiRedraw();
      return;
    }
    _lprRoiImgW = d.width || 1280;
    _lprRoiImgH = d.height || 720;
    img.src = 'data:image/jpeg;base64,' + d.jpeg_b64;
    img.onload = () => lprRoiRedraw();
  }

  function lprRoiRedraw() {
    const img = document.getElementById('lprRoiSnap');
    const canvas = document.getElementById('lprRoiCanvas');
    const w = img.clientWidth || 800, h = img.clientHeight || 450;
    canvas.width = w; canvas.height = h;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (!_lprRoiPoints.length) {
      document.getElementById('lprRoiPtCount').textContent = '0';
      return;
    }
    ctx.strokeStyle = '#39ff14'; ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(57,255,20,.2)';
    ctx.beginPath();
    _lprRoiPoints.forEach((p, i) => {
      const x = p.x * w, y = p.y * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (_lprRoiPoints.length >= 3) { ctx.closePath(); ctx.fill(); }
    ctx.stroke();
    // Pontos
    ctx.fillStyle = '#39ff14';
    _lprRoiPoints.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2); ctx.fill();
    });
    document.getElementById('lprRoiPtCount').textContent = _lprRoiPoints.length;
  }

  function lprRoiClear() { _lprRoiPoints = []; lprRoiRedraw(); }

  document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('lprRoiCanvas');
    if (canvas) {
      canvas.addEventListener('click', (ev) => {
        const rect = canvas.getBoundingClientRect();
        const x = (ev.clientX - rect.left) / rect.width;
        const y = (ev.clientY - rect.top) / rect.height;
        _lprRoiPoints.push({ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
        lprRoiRedraw();
      });
    }
    window.addEventListener('resize', () => {
      if (document.getElementById('lprRoiModal').style.display === 'flex') lprRoiRedraw();
    });
  });

  async function lprRoiSave() {
    if (_lprRoiPoints.length > 0 && _lprRoiPoints.length < 3) { alert('Polígono precisa de pelo menos 3 pontos (ou 0 pra remover ROI).'); return; }
    const r = await callAcesso({ action: 'acesso_lpr_camera_roi_save', id: _lprRoiCamId, roi_polygon: _lprRoiPoints.length === 0 ? null : _lprRoiPoints });
    if (r?.error) { alert('Erro: ' + r.error); return; }
    document.getElementById('lprRoiModal').style.display = 'none';
    loadLprCameras();
  }

  // ── Relatório ─────────────────────────────────────────
  async function loadLprRelatorio() {
    const dias = Number(document.getElementById('lprRelDias').value);
    const r = await callAcesso({ action: 'acesso_lpr_relatorio', dias });
    const dados = r?.data || r || [];
    const el = document.getElementById('lprRelContent');
    if (!dados.length) {
      el.innerHTML = '<div class="empty-state">Sem eventos no período. Eventos aparecem após câmera começar a ler placas.</div>';
      return;
    }
    const totais = dados.reduce((acc, d) => {
      acc.total += +d.total; acc.aut += +d.autorizadas; acc.nao += +d.nao_cadastradas;
      acc.fh += +d.fora_horario; acc.fv += +d.fora_validade; acc.in += +d.inativas; acc.bc += +d.baixa_conf;
      return acc;
    }, { total: 0, aut: 0, nao: 0, fh: 0, fv: 0, in: 0, bc: 0 });
    const max = Math.max(...dados.map(d => +d.total), 1);

    const stats = `<div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px;">
      <div class="stat-card"><div class="stat-label">Total leituras</div><div class="stat-value">${totais.total}</div></div>
      <div class="stat-card"><div class="stat-label">Autorizadas</div><div class="stat-value" style="color:#2d7a3a;">${totais.aut}</div><div class="stat-sub">${(totais.aut/Math.max(totais.total,1)*100).toFixed(1)}%</div></div>
      <div class="stat-card"><div class="stat-label">Não cadastradas</div><div class="stat-value" style="color:#c0392b;">${totais.nao}</div><div class="stat-sub">${(totais.nao/Math.max(totais.total,1)*100).toFixed(1)}%</div></div>
      <div class="stat-card"><div class="stat-label">Outros (fora horário/validade/inativa/baixa conf)</div><div class="stat-value" style="color:#b07d10;">${totais.fh + totais.fv + totais.in + totais.bc}</div></div>
    </div>`;

    const rows = dados.map(d => {
      const pct = +d.total / max * 100;
      const partsW = (n) => `${(+n / +d.total * 100).toFixed(0)}%`;
      const segs = [
        { n: +d.autorizadas, c: '#2d7a3a' },
        { n: +d.nao_cadastradas, c: '#c0392b' },
        { n: +d.fora_horario + +d.fora_validade + +d.inativas, c: '#b07d10' },
        { n: +d.baixa_conf, c: '#999' },
      ].filter(s => s.n > 0);
      const stack = segs.map(s => `<div style="background:${s.c};width:${partsW(s.n)};" title="${s.n}"></div>`).join('');
      return `<tr>
        <td style="font-size:12px;white-space:nowrap;">${escHtml(d.dia)}</td>
        <td style="font-weight:600;font-size:13px;text-align:right;width:60px;">${d.total}</td>
        <td>
          <div style="display:flex;height:18px;border-radius:4px;overflow:hidden;background:#f0f0f0;width:${pct}%;min-width:20px;">${stack}</div>
        </td>
        <td style="font-size:11px;color:#2d7a3a;text-align:right;width:60px;">${d.autorizadas}</td>
        <td style="font-size:11px;color:#c0392b;text-align:right;width:60px;">${d.nao_cadastradas}</td>
      </tr>`;
    }).join('');

    el.innerHTML = stats + `
      <div style="font-size:13px;margin-bottom:8px;color:var(--muted);">Legenda: <span style="color:#2d7a3a;">●</span> autorizadas <span style="color:#c0392b;">●</span> não cadastradas <span style="color:#b07d10;">●</span> fora horário/validade/inativas <span style="color:#999;">●</span> baixa confiança</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Dia</th><th style="text-align:right;">Total</th><th>Distribuição</th><th style="text-align:right;color:#2d7a3a;">✅</th><th style="text-align:right;color:#c0392b;">⚠️</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function lprPlacaNova() {
    _lprPlacaAutosaveOn = false; _lprPlacaCancelAutosave(); _lprPlacaSetStatus('', '');
    document.getElementById('lprModalTitle').textContent = 'Nova placa';
    document.getElementById('lprPlacaId').value = '';
    document.getElementById('lprPlacaInput').value = '';
    document.getElementById('lprApelidoInput').value = '';
    document.getElementById('lprOwnerTipo').value = 'familia';
    document.getElementById('lprValIni').value = '';
    document.getElementById('lprValFim').value = '';
    document.getElementById('lprObsInput').value = '';
    document.getElementById('lprAtivoInput').checked = true;
    document.getElementById('lprPlacaModal').style.display = 'flex';
  }

  function lprPlacaEdit(id) {
    const p = _lprPlacas.find(x => x.id === id);
    if (!p) return;
    _lprPlacaAutosaveOn = false; _lprPlacaCancelAutosave();
    document.getElementById('lprModalTitle').textContent = 'Editar placa';
    document.getElementById('lprPlacaId').value = p.id;
    document.getElementById('lprPlacaInput').value = p.placa;
    document.getElementById('lprApelidoInput').value = p.apelido || '';
    document.getElementById('lprOwnerTipo').value = p.owner_tipo;
    document.getElementById('lprValIni').value = p.validade_inicio || '';
    document.getElementById('lprValFim').value = p.validade_fim || '';
    document.getElementById('lprObsInput').value = p.observacao || '';
    document.getElementById('lprAtivoInput').checked = !!p.ativo;
    _lprPlacaWireAutosave();
    _lprPlacaSetStatus('💾 auto-save ativo (2s após a última edição)', '#1976d2');
    setTimeout(() => { _lprPlacaAutosaveOn = true; }, 200);
    document.getElementById('lprPlacaModal').style.display = 'flex';
  }

  function _lprPlacaReadForm() {
    const placa = document.getElementById('lprPlacaInput').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return {
      action: 'acesso_lpr_placa_save',
      id: document.getElementById('lprPlacaId').value || undefined,
      placa,
      apelido: document.getElementById('lprApelidoInput').value.trim() || null,
      owner_tipo: document.getElementById('lprOwnerTipo').value,
      validade_inicio: document.getElementById('lprValIni').value || null,
      validade_fim: document.getElementById('lprValFim').value || null,
      observacao: document.getElementById('lprObsInput').value.trim() || null,
      ativo: document.getElementById('lprAtivoInput').checked,
    };
  }

  async function lprPlacaSave() {
    _lprPlacaCancelAutosave();
    const body = _lprPlacaReadForm();
    if (body.placa.length < 4) { alert('Placa inválida.'); return; }
    const r = await callAcesso(body);
    if (r?.error) { alert('Erro: ' + r.error); return; }
    document.getElementById('lprPlacaModal').style.display = 'none';
    loadAcessoLpr();
  }

  // ── Auto-save modal placa ────────────────────────────
  let _lprPlacaAutosaveTimer = null;
  let _lprPlacaAutosaveOn = false;

  function _lprPlacaSetStatus(text, color) {
    const el = document.getElementById('lprPlacaSaveStatus');
    el.textContent = text;
    el.style.color = color || '#888';
    el.style.display = text ? '' : 'none';
  }
  function _lprPlacaCancelAutosave() {
    if (_lprPlacaAutosaveTimer) { clearTimeout(_lprPlacaAutosaveTimer); _lprPlacaAutosaveTimer = null; }
  }
  function _lprPlacaArmAutosave() {
    if (!_lprPlacaAutosaveOn) return;
    _lprPlacaCancelAutosave();
    _lprPlacaSetStatus('digitando…', '#888');
    _lprPlacaAutosaveTimer = setTimeout(async () => {
      const body = _lprPlacaReadForm();
      if (!body.id || body.placa.length < 4) {
        _lprPlacaSetStatus('⚠️ placa inválida', '#c0392b');
        return;
      }
      _lprPlacaSetStatus('💾 salvando…', '#1976d2');
      const r = await callAcesso(body);
      if (r?.error) {
        _lprPlacaSetStatus('⚠️ erro: ' + r.error, '#c0392b');
        return;
      }
      const t = new Date();
      const hh = String(t.getHours()).padStart(2,'0'), mm = String(t.getMinutes()).padStart(2,'0');
      _lprPlacaSetStatus(`✓ salvo às ${hh}:${mm}`, '#2d7a3a');
      loadAcessoLpr();
    }, 1500);
  }
  function _lprPlacaWireAutosave() {
    ['lprPlacaInput','lprApelidoInput','lprOwnerTipo','lprValIni','lprValFim','lprObsInput','lprAtivoInput'].forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.dataset.autosaveWired === '1') return;
      el.dataset.autosaveWired = '1';
      el.addEventListener('input', _lprPlacaArmAutosave);
      el.addEventListener('change', _lprPlacaArmAutosave);
    });
  }

  async function lprPlacaDelete(id, placa) {
    if (!confirm(`Excluir placa ${placa}? Eventos antigos com essa placa permanecem no log.`)) return;
    const r = await callAcesso({ action: 'acesso_lpr_placa_delete', id });
    if (r?.error) { alert('Erro: ' + r.error); return; }
    loadAcessoLpr();
  }

  async function lprSyncNow() {
    const r = await callAcesso({ action: 'acesso_lpr_sync_now' });
    const d = r?.data || r || {};
    if (d.ok) {
      alert(`Sync OK — ${d.count} placa(s) enviadas pro daemon.`);
    } else {
      alert(`Sync falhou: ${d.error || 'bridge offline?'}`);
    }
  }

  setInterval(() => {
    const panel = document.getElementById('panelAcessoLpr');
    if (panel && panel.classList.contains('active')) loadAcessoLpr();
  }, 30_000);
