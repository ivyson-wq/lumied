// Auto-extraído do gerente.html (Onda 4 — mega batch).
// Importação alunos + Equipe unificada + Importação massa + Permissions modal
  // ── IMPORTAÇÃO DE ALUNOS (XLSX) ──────────────────────
  var alunosImportData = [];
  function alunosGerarModelo() {
    if (typeof XLSX === 'undefined') { showToast('Aguarde o carregamento do XLSX','error'); return; }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['nome', 'email', 'serie', 'data_nascimento', 'responsavel'],
      ['Pedro Silva', 'pedro@escola.com', 'Year 1', '15/03/2019', 'Maria Silva'],
      ['Julia Costa', 'julia@escola.com', 'Toddler', '22/08/2020', 'Ana Costa'],
      ['Lucas Souza', 'lucas@escola.com', 'Year 2', '10/01/2018', 'Carlos Souza'],
    ]);
    ws['!cols'] = [{ wch: 25 }, { wch: 28 }, { wch: 15 }, { wch: 18 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Alunos');
    const wsInst = XLSX.utils.aoa_to_sheet([
      ['Instrucoes para importacao de alunos'],
      [''],
      ['Colunas:'],
      ['  nome — Nome completo do aluno (obrigatório)'],
      ['  email — E-mail de contato (opcional)'],
      ['  serie — Série/turma do aluno (opcional)'],
      ['  data_nascimento — Data no formato DD/MM/AAAA (opcional)'],
      ['  responsavel — Nome do responsável (opcional)'],
      [''],
      ['Se o e-mail já existir no sistema, o aluno será ignorado (sem duplicação).'],
    ]);
    wsInst['!cols'] = [{ wch: 72 }];
    XLSX.utils.book_append_sheet(wb, wsInst, 'Instrucoes');
    XLSX.writeFile(wb, 'modelo_importacao_alunos.xlsx');
  }

  function alunosImportarXlsx(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    if (typeof XLSX === 'undefined') { showToast('Aguarde o carregamento do XLSX','error'); return; }
    const reader = new FileReader();
    reader.onload = function(e) {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const sheetName = wb.SheetNames.find(n => !n.toLowerCase().includes('instru')) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
      if (!rows.length) { showToast('Planilha vazia','error'); return; }
      alunosImportData = rows.map(r => {
        const nome = (r.nome || r.Nome || r.NOME || '').toString().trim();
        const email = (r.email || r.Email || r['e-mail'] || r['E-mail'] || '').toString().trim();
        const serie = (r.serie || r.Serie || r.turma || r.Turma || '').toString().trim();
        const nascRaw = (r.data_nascimento || r['Data Nascimento'] || r.nascimento || '').toString().trim();
        const resp = (r.responsavel || r.Responsavel || r['responsável'] || '').toString().trim();
        return { nome, email, serie, data_nascimento: nascRaw, responsavel: resp };
      }).filter(r => r.nome);
      if (!alunosImportData.length) { showToast('Nenhum registro válido (nome obrigatório)','error'); return; }
      document.getElementById('alunosImportList').innerHTML =
        '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr><th style="text-align:left;padding:4px 8px;">Nome</th><th style="text-align:left;padding:4px 8px;">Email</th><th style="text-align:left;padding:4px 8px;">Série</th><th style="text-align:left;padding:4px 8px;">Nascimento</th><th style="text-align:left;padding:4px 8px;">Responsável</th></tr></thead><tbody>' +
        alunosImportData.map(r =>
          `<tr><td style="padding:4px 8px;">${esc(r.nome)}</td><td style="padding:4px 8px;">${esc(r.email||'—')}</td><td style="padding:4px 8px;">${esc(r.serie||'—')}</td><td style="padding:4px 8px;">${esc(r.data_nascimento||'—')}</td><td style="padding:4px 8px;">${esc(r.responsavel||'—')}</td></tr>`
        ).join('') + '</tbody></table>';
      document.getElementById('alunosImportErr').style.display = 'none';
      document.getElementById('alunosImportOk').style.display = 'none';
      document.getElementById('alunosImportPreview').style.display = 'block';
    };
    reader.readAsArrayBuffer(file);
  }

  async function alunosConfirmarImport() {
    const errEl = document.getElementById('alunosImportErr');
    const okEl = document.getElementById('alunosImportOk');
    errEl.style.display = 'none'; okEl.style.display = 'none';
    if (!alunosImportData.length) { errEl.textContent = 'Nenhum dado para importar.'; errEl.style.display = 'block'; return; }
    const btn = document.querySelector('#alunosImportPreview .btn-create');
    if (btn) { btn.disabled = true; btn.textContent = 'Importando...'; }
    let okCount = 0, erros = [];
    for (const r of alunosImportData) {
      let dataFmt = null;
      if (r.data_nascimento) {
        if (r.data_nascimento.includes('/')) {
          const [d,m,y] = r.data_nascimento.split('/');
          if (d&&m&&y) dataFmt = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        } else dataFmt = r.data_nascimento;
      }
      const d = await api({ action:'aluno_criar', nome:r.nome, email:r.email||null, serie:r.serie||null, data_nascimento:dataFmt, responsavel_nome:r.responsavel||null });
      if (d.error) erros.push(r.nome + ': ' + d.error); else okCount++;
    }
    if (okCount) { okEl.textContent = okCount + ' aluno(s) importado(s) com sucesso!'; okEl.style.display = 'block'; }
    if (erros.length) { errEl.textContent = erros.join(' | '); errEl.style.display = 'block'; }
    alunosImportData = [];
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar Importação'; }
    document.getElementById('alunosImportPreview').style.display = 'none';
    loadAlunos();
  }

  function alunoUploadDoc() { showToast('Em desenvolvimento — upload de documentos', 'info'); }

  // Load on panel show
  var _origShowPanel = window.showPanel || function(){};
  // Will be handled by existing showPanel — load data when panel opens

  // ── EQUIPE UNIFICADA ──────────────────────────────────
  // PAPEIS e PAPEL_COLORS foram movidos para o topo do script para evitar erros de ordem de execução
  var equipeData = [], equipeFilter = 'todos', equipeSeriesOpts = '';

  async function loadEquipe() {
    if (!equipeSeriesOpts) {
      const s = await api({ action: 'series_list' });
      const arr = Array.isArray(s) ? s : [];
      equipeSeriesOpts = arr.map(x => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('');
      document.getElementById('eqTurma').innerHTML = '<option value="">— sem turma —</option>' + equipeSeriesOpts;
    }
    const data = await api({ action:'usuarios_list' });
    equipeData = Array.isArray(data) ? data : [];
    renderEquipe();
  }
  function toggleEqTurma() {
    const checked = [...document.querySelectorAll('input[name="eqPapel"]:checked')].map(c => c.value);
    document.getElementById('eqTurmaWrap').style.display = (checked.includes('professora') || checked.includes('professora_assistente')) ? 'block' : 'none';
  }
  function setEquipeFilter(f, btn) {
    equipeFilter = f;
    document.querySelectorAll('#panelEquipe .filter-bar .fb').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderEquipe();
  }
  function renderEquipe() {
    const busca = (document.getElementById('eqBusca')?.value || '').trim().toLowerCase();
    let list = equipeFilter === 'todos' ? equipeData : equipeData.filter(u => {
      const roles = u.papeis?.length ? u.papeis : [u.papel];
      return roles.includes(equipeFilter);
    });
    if (busca) list = list.filter(u => (u.nome||'').toLowerCase().includes(busca) || (u.email||'').toLowerCase().includes(busca));
    document.getElementById('equipeCount').textContent = list.length;
    const el = document.getElementById('equipeList');
    if (!list.length) { el.innerHTML = '<div class="list-row"><span style="color:var(--muted);font-size:13px;">Nenhum membro encontrado.</span></div>'; return; }
    el.innerHTML = list.map(u => {
      const isMe = u.email === currentGerente?.email;
      const roles = u.papeis?.length ? u.papeis : [u.papel];
      const cor = (window.PAPEL_COLORS||{})[roles[0]] || '#666';
      const isProf = roles.includes('professora') || roles.includes('professora_assistente');
      const turmaSelect = isProf ? `<select onchange="setEquipeSerie('${esc(u.email)}',this.value)" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:'DM Sans',sans-serif;background:#fdfbf8;max-width:130px;">
        <option value="">Sem turma</option>${equipeSeriesOpts}
      </select>` : '';
      const badges = roles.map(r => {
        const c = (window.PAPEL_COLORS||{})[r] || '#666';
        return `<span class="role-badge" style="background:${c}15;color:${c};border-color:${c}30;">${(window.PAPEIS||{})[r]||r}</span>`;
      }).join(' ');
      return `<div class="list-row" style="flex-wrap:wrap;row-gap:8px;">
        <div class="list-avatar" style="background:${cor}20;color:${cor};">${(u.nome||'?')[0].toUpperCase()}</div>
        <div class="lr-main" style="min-width:180px;"><strong>${esc(u.nome||'—')}</strong><span>${esc(u.email)} · ${new Date(u.criado_em).toLocaleDateString('pt-BR')}${u.serie_nome ? ' · ' + esc(u.serie_nome) : ''}</span>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">${badges}</div>
        </div>
        ${turmaSelect}
        <div style="display:flex;gap:4px;align-items:center;margin-left:auto;">
          <button class="action-btn" onclick="openPermissoes('${u.id}','${esc(u.nome||u.email)}','${u.papeis?u.papeis[0]:u.papel}')" title="Permissões" style="font-size:14px;">🔐</button>
          <button class="action-btn" onclick="openEditPapeis('${u.id}')" title="Editar papéis" style="font-size:14px;">✏️</button>
          <button class="action-btn" onclick="reenviarCredenciais('${u.id}','${esc(u.nome||u.email)}')" title="Reenviar email com senha" style="font-size:14px;">📧</button>
          ${isMe ? '<span class="you-badge">Você</span>' : `<button class="action-btn del" onclick="deleteEquipeMember('${u.id}','${esc(u.nome||u.email)}')">🗑</button>`}
        </div>
      </div>`;
    }).join('');
    // Seta valores dos selects de turma
    list.forEach(u => {
      if (u.serie_id) {
        const sel = el.querySelector(`select[onchange*="${u.email}"]`);
        if (sel) sel.value = u.serie_id;
      }
    });
  }
  async function createEquipeMember() {
    const nome = document.getElementById('eqNome').value.trim();
    const email = document.getElementById('eqEmail').value.trim();
    const senha = document.getElementById('eqSenha').value;
    const papeis = [...document.querySelectorAll('input[name="eqPapel"]:checked')].map(c => c.value);
    const turma = document.getElementById('eqTurma').value;
    if (!nome || !email || !senha || !papeis.length) return showToast('Preencha todos os campos e selecione pelo menos um papel.', 'error');
    if (senha.length < 6) return showToast('Senha mínima de 6 caracteres.', 'error');
    const btn = document.querySelector('#panelEquipe .btn-create[onclick*="createEquipeMember"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Cadastrando...'; }
    const d = await api({ action:'usuarios_create', nome, email, senha, papeis });
    if (btn) { btn.disabled = false; btn.textContent = 'Cadastrar'; }
    if (d.error) { showToast(d.error, 'error'); return; }
    // Atribui turma se for professora
    if (turma && (papeis.includes('professora') || papeis.includes('professora_assistente'))) {
      await api({ action:'usuarios_set_serie', email, serie_id: turma });
    }
    showToast('Membro "'+nome+'" cadastrado com sucesso!', 'success');
    document.getElementById('eqNome').value = '';
    document.getElementById('eqEmail').value = '';
    document.getElementById('eqSenha').value = '';
    document.querySelectorAll('input[name="eqPapel"]').forEach(c => c.checked = false);
    document.getElementById('eqTurma').value = '';
    document.getElementById('eqTurmaWrap').style.display = 'none';
    await loadEquipe();
  }
  async function setEquipeSerie(email, serie_id) {
    const d = await api({ action:'usuarios_set_serie', email, serie_id: serie_id || null });
    if (d.error) showToast('Erro: ' + d.error, 'error');
    else showToast('Turma atualizada!', 'success');
  }
  async function deleteEquipeMember(id, nome) {
    if (!await _lumiedConfirm('Remover "'+nome+'" da equipe?')) return;
    const d = await api({ action:'usuarios_delete', id });
    if (d.error) { showToast(d.error, 'error'); return; }
    loadEquipe();
  }
  async function reenviarCredenciais(id, nome) {
    if (!await _lumiedConfirm('Gerar nova senha e enviar por email para "'+nome+'"?\n\nA senha atual será substituída.')) return;
    showToast('Enviando email...', 'info');
    const d = await api({ action:'usuarios_reenviar_credenciais', id });
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Email com credenciais enviado para '+d.email+'!', 'success');
  }
  // ── IMPORTAÇÃO EM MASSA ────────────────────────────────
  var eqImportData = [];
  function eqGerarModelo() {
    if (typeof XLSX === 'undefined') { showToast('Aguarde o carregamento do XLSX','error'); return; }
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['nome', 'email', 'senha', 'papeis', 'turma'],
      ['Maria Silva', 'maria@escola.com', '123456', 'professora', 'Year 1'],
      ['João Souza', 'joao@escola.com', '123456', 'professora,professora_assistente', 'Year 2'],
      ['Ana Costa', 'ana@escola.com', '123456', 'secretaria,comercial', ''],
      ['Carlos Lima', 'carlos@escola.com', '123456', 'manutencao', ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 25 }, { wch: 30 }, { wch: 15 }, { wch: 40 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Equipe');
    const wsInst = XLSX.utils.aoa_to_sheet([
      ['Instruções para importação de equipe'],
      [''],
      ['Colunas obrigatórias:'],
      ['  nome — Nome completo do membro'],
      ['  email — E-mail (será o login)'],
      ['  senha — Senha inicial (mínimo 6 caracteres)'],
      [''],
      ['Colunas opcionais:'],
      ['  papeis — Um ou mais papéis separados por vírgula:'],
      ['    gerente, diretor, financeiro, professora, professora_assistente, secretaria, comercial, manutencao'],
      ['  turma — Nome da série/turma (só para professora/assistente)'],
      [''],
      ['Se "papeis" estiver vazio, será criado como "professora" por padrão.'],
      ['Se o e-mail já existir, o membro será ignorado (sem duplicação).'],
    ]);
    wsInst['!cols'] = [{ wch: 80 }];
    XLSX.utils.book_append_sheet(wb, wsInst, 'Instruções');
    XLSX.writeFile(wb, 'modelo_importacao_equipe.xlsx');
  }
  function eqImportarXlsx(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    if (typeof XLSX === 'undefined') { showToast('Aguarde o carregamento do XLSX','error'); return; }
    const reader = new FileReader();
    reader.onload = function(e) {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { showToast('Planilha vazia','error'); return; }
      eqImportData = rows.map(r => ({
        nome: (r.nome || r.Nome || '').toString().trim(),
        email: (r.email || r.Email || r['e-mail'] || r['E-mail'] || '').toString().trim().toLowerCase(),
        senha: (r.senha || r.Senha || r.password || '').toString().trim(),
        papeis: (r.papeis || r.Papeis || r.papel || r.Papel || 'professora').toString().trim().split(/[,;|]/).map(p => p.trim().toLowerCase()).filter(Boolean),
        turma: (r.turma || r.Turma || r.serie || r.Serie || '').toString().trim(),
      })).filter(r => r.nome && r.email);
      if (!eqImportData.length) { showToast('Nenhum registro válido encontrado','error'); return; }
      document.getElementById('eqImportList').innerHTML =
        '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr><th style="text-align:left;padding:4px 8px;">Nome</th><th style="text-align:left;padding:4px 8px;">Email</th><th style="text-align:left;padding:4px 8px;">Papéis</th><th style="text-align:left;padding:4px 8px;">Turma</th></tr></thead><tbody>' +
        eqImportData.map(r => `<tr><td style="padding:4px 8px;">${esc(r.nome)}</td><td style="padding:4px 8px;">${esc(r.email)}</td><td style="padding:4px 8px;">${r.papeis.join(', ')}</td><td style="padding:4px 8px;">${esc(r.turma||'—')}</td></tr>`).join('') +
        '</tbody></table>';
      document.getElementById('eqImportPreview').style.display = 'block';
      document.getElementById('eqImportErr').classList.remove('show');
      document.getElementById('eqImportOk').classList.remove('show');
    };
    reader.readAsArrayBuffer(file);
  }
  async function eqConfirmarImport() {
    const errEl = document.getElementById('eqImportErr');
    const okEl = document.getElementById('eqImportOk');
    const btn = document.querySelector('#eqImportPreview .btn-create');
    errEl.classList.remove('show'); okEl.classList.remove('show');
    if (!eqImportData.length) { errEl.textContent = 'Nenhum dado para importar.'; errEl.classList.add('show'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Importando...'; }
    let okCount = 0, erros = [];
    for (const r of eqImportData) {
      if (!r.senha || r.senha.length < 6) { erros.push(r.email + ': senha < 6 chars'); continue; }
      try {
        const d = await api({ action: 'usuarios_create', nome: r.nome, email: r.email, senha: r.senha, papeis: r.papeis });
        if (d.error) { erros.push(r.email + ': ' + d.error); continue; }
        if (r.turma && (r.papeis.includes('professora') || r.papeis.includes('professora_assistente'))) {
          await api({ action: 'usuarios_set_serie', email: r.email, serie_nome: r.turma });
        }
        okCount++;
      } catch (e) { erros.push(r.email + ': erro de rede'); }
    }
    if (okCount) { okEl.textContent = okCount + ' membro(s) importado(s) com sucesso!'; okEl.classList.add('show'); }
    if (erros.length) { errEl.textContent = erros.join(' | '); errEl.classList.add('show'); }
    if (!okCount && !erros.length) { errEl.textContent = 'Nenhum registro processado.'; errEl.classList.add('show'); }
    eqImportData = [];
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar Importação'; }
    document.getElementById('eqImportPreview').style.display = 'none';
    loadEquipe();
  }

  // ── PERMISSIONS MODAL ──────────────────────────────────
  var MODULOS_DISPONIVEIS = [
    { slug: 'dashboard', nome: 'Dashboard' },
    { slug: 'alunos', nome: 'Alunos' },
    { slug: 'turmas', nome: 'Turmas' },
    { slug: 'turnos', nome: 'Turnos' },
    { slug: 'atividades', nome: 'Atividades' },
    { slug: 'notas', nome: 'Notas & Boletim' },
    { slug: 'frequencia', nome: 'Frequência' },
    { slug: 'comunicacao', nome: 'Comunicação' },
    { slug: 'crm', nome: 'CRM Matrículas' },
    { slug: 'financeiro', nome: 'Financeiro' },
    { slug: 'diplomas', nome: 'Diplomas' },
    { slug: 'atestados', nome: 'Atestados' },
    { slug: 'almoxarifado', nome: 'Almoxarifado' },
    { slug: 'compliance', nome: 'Compliance' },
    { slug: 'biblioteca', nome: 'Biblioteca' },
    { slug: 'cantina', nome: 'Cantina' },
    { slug: 'transporte', nome: 'Transporte' },
    { slug: 'rh', nome: 'RH & Folha' },
    { slug: 'whatsapp', nome: 'WhatsApp' },
    { slug: 'loja', nome: 'Loja' },
    { slug: 'analytics', nome: 'Analytics' },
    { slug: 'equipe', nome: 'Equipe' },
    { slug: 'familias', nome: 'Famílias' },
    { slug: 'config', nome: 'Configurações' },
    { slug: 'historico_aluno', nome: 'Histórico Aluno' },
  ];

  var permUserId = null;

  async function openPermissoes(userId, nome, papel) {
    permUserId = userId;
    const d = await api({ action: 'permissoes_get', usuario_id: userId });
    if (d.error) return showToast(d.error, 'error');

    const perms = Array.isArray(d) ? d : [];
    const permsMap = {};
    for (const p of perms) permsMap[p.modulo] = p;

    let html = '<div style="max-height:60vh;overflow-y:auto;padding-right:8px;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="border-bottom:2px solid var(--border);"><th style="text-align:left;padding:8px;">Módulo</th><th style="padding:8px;width:60px;">Ver</th><th style="padding:8px;width:60px;">Editar</th></tr></thead>';
    html += '<tbody>';

    for (const m of MODULOS_DISPONIVEIS) {
      const p = permsMap[m.slug] || { pode_ver: false, pode_editar: false };
      html += '<tr style="border-bottom:1px solid #f0f0f0;">';
      html += '<td style="padding:8px;font-weight:500;">' + esc(m.nome) + '</td>';
      html += '<td style="text-align:center;padding:8px;"><input type="checkbox" data-mod="' + m.slug + '" data-type="ver" ' + (p.pode_ver ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;"></td>';
      html += '<td style="text-align:center;padding:8px;"><input type="checkbox" data-mod="' + m.slug + '" data-type="editar" ' + (p.pode_editar ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:var(--green);cursor:pointer;"></td>';
      html += '</tr>';
    }

    html += '</tbody></table></div>';
    html += '<div style="display:flex;gap:8px;margin-top:16px;justify-content:space-between;">';
    html += '<button onclick="resetPermissoes()" style="padding:8px 16px;background:#f5f5f5;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:13px;">Restaurar Padrão</button>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button onclick="closePermModal()" style="padding:8px 16px;background:#f5f5f5;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:13px;">Cancelar</button>';
    html += '<button onclick="salvarPermissoes()" style="padding:8px 20px;background:var(--primary);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;">Salvar</button>';
    html += '</div></div>';

    let overlay = document.getElementById('permModal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'permModal';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:24px;max-width:520px;width:100%;max-height:90vh;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.2);">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
      + '<div><h3 style="font-size:16px;font-weight:700;color:var(--text-heading);margin:0;">Permissões — ' + esc(nome) + '</h3><span style="font-size:12px;color:var(--muted);">Papel: ' + esc(papel) + '</span></div>'
      + '<button onclick="closePermModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--muted);">&times;</button>'
      + '</div>'
      + html
      + '</div>';
    overlay.style.display = 'flex';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closePermModal(); });
  }

  function closePermModal() {
    const m = document.getElementById('permModal');
    if (m) m.style.display = 'none';
  }

  async function salvarPermissoes() {
    if (!permUserId) return;
    const rows = document.querySelectorAll('#permModal input[data-mod]');
    const permsMap = {};
    rows.forEach(function(inp) {
      const mod = inp.dataset.mod;
      const type = inp.dataset.type;
      if (!permsMap[mod]) permsMap[mod] = { modulo: mod, pode_ver: false, pode_editar: false };
      if (type === 'ver') permsMap[mod].pode_ver = inp.checked;
      if (type === 'editar') permsMap[mod].pode_editar = inp.checked;
    });

    const permissoes = Object.values(permsMap);
    const d = await api({ action: 'permissoes_update', usuario_id: permUserId, permissoes: permissoes });
    if (d.error) return showToast(d.error, 'error');
    showToast('Permissões salvas!', 'success');
    closePermModal();
  }

  async function resetPermissoes() {
    if (!permUserId) return;
    if (!await _lumiedConfirm('Restaurar permissões para o padrão do papel?')) return;
    const d = await api({ action: 'permissoes_reset', usuario_id: permUserId });
    if (d.error) return showToast(d.error, 'error');
    showToast('Permissões restauradas ao padrão.', 'success');
    closePermModal();
  }

  // ── Editar papéis de membro ──
  // ALL_PAPEIS, ALL_FEATURES, FEATURE_LABELS foram movidos para o topo do script

  function openEditPapeis(id) {
    const u = equipeData.find(x => x.id === id);
    if (!u) return;
    const roles = u.papeis?.length ? u.papeis : (u.papel ? [u.papel] : []);
    document.getElementById('editPapeisId').value = id;
    document.getElementById('editPapeisTitle').textContent = 'Editar — ' + (u.nome || u.email);
    document.getElementById('editPapeisEmail').textContent = u.email;
    document.getElementById('editPapeisSenha').value = '';
    document.getElementById('editPapeisErr').style.display = 'none';

    // Render checkboxes de papéis
    document.getElementById('editPapeisChecks').innerHTML = (window.ALL_PAPEIS||[]).map(p => {
      const c = (window.PAPEL_COLORS||{})[p] || '#666';
      const checked = roles.includes(p) ? 'checked' : '';
      return `<label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;padding:6px 10px;border:1.5px solid ${roles.includes(p)?c+'50':'var(--border)'};border-radius:8px;background:${roles.includes(p)?c+'10':'#fdfbf8'};transition:all .15s;">
        <input type="checkbox" name="editPapel" value="${p}" ${checked} onchange="toggleEditPapelStyle(this);toggleEditFeatures()"> ${(window.PAPEIS||{})[p]||p}
      </label>`;
    }).join('');

    // Render checkboxes de features
    document.getElementById('editFeaturesChecks').innerHTML = (window.ALL_FEATURES||[]).map(f =>
      `<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;padding:5px 10px;border:1.5px solid var(--border);border-radius:8px;background:#fdfbf8;">
        <input type="checkbox" name="editFeature" value="${f}"> ${(window.FEATURE_LABELS||{})[f]||f}
      </label>`
    ).join('');

    toggleEditFeatures();
    document.getElementById('editPapeisModal').classList.add('show');
  }

  function toggleEditPapelStyle(cb) {
    const label = cb.parentElement;
    const p = cb.value;
    const c = (window.PAPEL_COLORS||{})[p] || '#666';
    if (cb.checked) { label.style.borderColor = c+'50'; label.style.background = c+'10'; }
    else { label.style.borderColor = 'var(--border)'; label.style.background = '#fdfbf8'; }
  }

  function toggleEditFeatures() {
    const checked = [...document.querySelectorAll('input[name="editPapel"]:checked')].map(c => c.value);
    const show = checked.includes('secretaria') || checked.includes('comercial') || checked.includes('impressao');
    document.getElementById('editPapeisFeatures').style.display = show ? 'block' : 'none';
    if (show) {
      // Auto-check features based on roles
      const featureCbs = document.querySelectorAll('input[name="editFeature"]');
      featureCbs.forEach(cb => {
        if (checked.includes('secretaria') && cb.value === 'atestados') cb.checked = true;
        if (checked.includes('comercial') && ['crm','templates','metas'].includes(cb.value)) cb.checked = true;
        if (checked.includes('impressao') && cb.value === 'impressao') cb.checked = true;
      });
    }
  }

  function closeEditPapeis() { document.getElementById('editPapeisModal').classList.remove('show'); }

  async function saveEditPapeis() {
    const id = document.getElementById('editPapeisId').value;
    const papeis = [...document.querySelectorAll('input[name="editPapel"]:checked')].map(c => c.value);
    const features = [...document.querySelectorAll('input[name="editFeature"]:checked')].map(c => c.value);
    const senha = document.getElementById('editPapeisSenha').value;
    const errEl = document.getElementById('editPapeisErr');
    errEl.style.display = 'none';

    if (!papeis.length) { errEl.textContent = 'Selecione pelo menos um papel.'; errEl.style.display = 'block'; return; }
    if (senha && senha.length < 6) { errEl.textContent = 'Senha mínima de 6 caracteres.'; errEl.style.display = 'block'; return; }

    const payload = { action: 'usuarios_update', id, papeis };
    if (features.length) payload.features = features;
    const d = await api(payload);
    if (d.error) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }

    // Reset senha se informada
    if (senha) {
      const r = await api({ action: 'usuarios_reset_senha', id, nova_senha: senha });
      if (r.error) { errEl.textContent = r.error; errEl.style.display = 'block'; return; }
    }

    closeEditPapeis();
    showToast('Papéis atualizados!', 'success');
    loadEquipe();
  }

  // Legacy aliases
  function loadUsers() { loadEquipe(); }
  async function changePassword() {
    const senhaAtual=document.getElementById('senhaAtual').value, novaSenha=document.getElementById('novaSenha').value, conf=document.getElementById('novaSenhaConf').value;
    if(!senhaAtual||!novaSenha) return showAlert('pass','error','Preencha todos os campos.');
    if(novaSenha!==conf) return showAlert('pass','error','As senhas não coincidem.');
    if(novaSenha.length<6) return showAlert('pass','error','Senha mínima de 6 caracteres.');
    const d=await api({ action:'gerentes_change_password', senhaAtual, novaSenha });
    if(d.error) return showAlert('pass','error',d.error);
    showAlert('pass','success','✅ Senha alterada com sucesso!');
    document.getElementById('senhaAtual').value=document.getElementById('novaSenha').value=document.getElementById('novaSenhaConf').value='';
  }

