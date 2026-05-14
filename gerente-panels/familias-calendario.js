// Auto-extraído do gerente.html (Onda 4 — mega batch).
// Importar insumos + ML + Atualizar preços + Categorias + Famílias + Importação famílias/atividades + Cadastrar família + Notif + Calendário + Analytics dash
  // ── IMPORTAR INSUMOS VIA EXCEL ──────────────────────
  var almInsumoXlsxParsed = [];

  function almGerarModeloInsumos() {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nome *', 'Descrição', 'Unidade', 'Preço Unitário (R$)', 'Categoria', 'Estoque Inicial'],
      ['Papel Sulfite A4 75g', 'Resma 500 folhas', 'resma', 12.90, 'Papelaria', 100],
      ['Caneta Esferográfica Azul', 'Ponta fina', 'unidade', 2.50, 'Canetas', 200],
      ['TNT Vermelho', 'Rolo 50m', 'rolo', 35.00, 'Decoração', 10],
      ['Cola Bastão 40g', '', 'unidade', 4.50, 'Papelaria', 50],
      ['','','','','',''],['','','','','',''],['','','','','',''],
      ['','','','','',''],['','','','','',''],
    ]);
    ws['!cols'] = [{ wch: 36 }, { wch: 24 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Insumos');
    const wsInst = XLSX.utils.aoa_to_sheet([
      ['INSTRUÇÕES — Modelo de Cadastro de Insumos · ' + SCHOOL_NAME],
      [''],
      ['1. Preencha a aba "Insumos" a partir da linha 2 (linha 1 é o cabeçalho).'],
      ['2. Apenas o Nome é obrigatório. Os demais campos são opcionais.'],
      ['3. Categorias sugeridas: Papelaria, Canetas, Decoração, Limpeza, Higiene, Descartáveis, Didático, Escritório'],
      ['4. Salve o arquivo e faça o upload no portal.'],
    ]);
    wsInst['!cols'] = [{ wch: 72 }];
    XLSX.utils.book_append_sheet(wb, wsInst, 'Instruções');
    XLSX.writeFile(wb, 'modelo_insumos_lumied.xlsx');
  }

  async function almImportarInsumosXlsx(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type:'array' });
      const sheetName = wb.SheetNames.find(n => !n.toLowerCase().includes('instru')) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, defval:'' });
      almInsumoXlsxParsed = rows.slice(1)
        .filter(r => String(r[0]||'').trim())
        .map(r => ({
          nome: String(r[0]||'').trim(),
          descricao: String(r[1]||'').trim(),
          unidade: String(r[2]||'').trim() || 'unidade',
          preco: parseFloat(String(r[3]).replace(',','.'))||0,
          categoria: String(r[4]||'').trim(),
          estoque_qty: parseFloat(String(r[5]).replace(',','.'))||0,
        }));
      if (!almInsumoXlsxParsed.length) { showToast('Nenhum insumo encontrado na planilha.','warning'); return; }
      document.getElementById('almInsumoXlsxSummary').textContent = almInsumoXlsxParsed.length + ' insumo(s) encontrado(s)';
      document.getElementById('almInsumoXlsxRows').innerHTML = almInsumoXlsxParsed.map((it,i) =>
        `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;margin-bottom:4px;background:#f0fdf4;border:1px solid #bbf7d0;font-size:12px;">
          <strong style="flex:1;">${esc(it.nome)}</strong>
          <span style="color:var(--muted);">${esc(it.categoria||'—')} · ${esc(it.unidade)} · R$ ${it.preco.toFixed(2).replace('.',',')} · Est: ${it.estoque_qty}</span>
        </div>`
      ).join('');
      document.getElementById('almInsumoXlsxResult').style.display = 'block';
    } catch(e) { showToast('Erro ao ler arquivo: ' + e.message, 'error'); }
  }

  async function almConfirmarImportInsumos() {
    let ok = 0, erros = 0;
    for (const it of almInsumoXlsxParsed) {
      const d = await callDiplomas({ action:'alm_insumo_save', ...it });
      if (d.error) erros++; else ok++;
    }
    showToast(ok + ' insumo(s) cadastrado(s)' + (erros ? ', ' + erros + ' erro(s)' : ''), erros ? 'warning' : 'success');
    document.getElementById('almInsumoXlsxResult').style.display = 'none';
    almInsumoXlsxParsed = [];
    almLoadInsumos();
  }

  // ── MERCADO LIVRE ────────────────────────────────────
  async function checkMLStatus() {
    const d = await callDiplomas({ action: 'ml_status' });
    const el = document.getElementById('mlStatus');
    const btn = document.getElementById('almBtnML');
    if (d.connected) {
      el.innerHTML = '<span style="color:#2d7a3a;">✅ Mercado Livre conectado</span>';
      btn.textContent = '🛒 ML Conectado';
      btn.style.background = '#2d7a3a';
      btn.style.color = '#fff';
    } else {
      el.innerHTML = '<span style="color:#b07d00;">⚠️ Mercado Livre não conectado — preços limitados</span>';
    }
  }
  async function conectarML() {
    const d = await callDiplomas({ action: 'ml_auth_url' });
    if (d.url) window.open(d.url, '_blank');
  }

  // ── ATUALIZAR PREÇOS ─────────────────────────────────
  async function almAtualizarPrecos() {
    const btn = document.getElementById('almBtnAtualizarPrecos');
    btn.disabled = true;

    const insData = await callDiplomas({ action: 'alm_insumos_list' });
    const insumos = (insData.data || []).filter(i => i.ativo);
    if (!insumos.length) { showToast('Nenhum insumo ativo.', 'warning'); btn.disabled = false; btn.textContent = '🔄 Atualizar Precos'; return; }

    let atualizados = 0;
    const total = insumos.length;
    const fontesResumo = {};

    for (let i = 0; i < total; i++) {
      const ins = insumos[i];
      btn.textContent = `⏳ ${i+1}/${total} — ${ins.nome.substring(0,25)}...`;
      try {
        const d = await callDiplomas({ action: 'alm_buscar_precos', nome: ins.nome, unidade: ins.unidade, descricao: ins.descricao || '' });
        const resultados = d.data || [];
        // Acumula status das fontes
        if (d.fontes) {
          for (const [f, info] of Object.entries(d.fontes)) {
            if (!fontesResumo[f]) fontesResumo[f] = { ok: 0, erro: 0, status: info.status };
            if (info.produtos > 0) fontesResumo[f].ok++;
            else fontesResumo[f].erro++;
            fontesResumo[f].status = info.status;
            if (info.erro) fontesResumo[f].ultimoErro = info.erro;
          }
        }
        const produtos = resultados.filter(r => r.tipo === 'produto' && r.preco != null && r.match >= 70);
        if (produtos.length) {
          produtos.sort((a, b) => a.preco - b.preco);
          const melhor = produtos[0];
          // Inclui todas as fontes consultadas no historico
          const fontesConsultadas = Object.entries(d.fontes || {}).map(([f,info]) =>
            `${f}: ${info.status}${info.produtos > 0 ? ' ('+info.produtos+' resultados)' : ''}${info.erro ? ' — '+info.erro : ''}`
          ).join(' | ');
          await callDiplomas({
            action: 'alm_insumo_atualizar_auto',
            id: ins.id,
            preco: melhor.preco,
            produto_nome: melhor.nome + ' [Fontes: ' + fontesConsultadas + ']',
            fonte: melhor.plataforma,
            url: melhor.url_produto,
            match_pct: melhor.match,
          });
          atualizados++;
        }
      } catch(_) {}
    }

    btn.disabled = false;
    btn.textContent = '🔄 Atualizar Precos';
    // Mostra resumo das fontes
    const fontesInfo = Object.entries(fontesResumo).map(([f, info]) => {
      const icon = info.ok > 0 ? '✅' : info.status === 'apenas link' ? '🔗' : '❌';
      return `${icon} ${f}: ${info.ok}/${total}`;
    }).join(' · ');
    showToast(`${atualizados}/${total} atualizados · ${fontesInfo}`, atualizados > 0 ? 'success' : 'warning', 8000);
    almLoadInsumos();
  }

  async function almVerHistorico(id, nome) {
    const d = await callDiplomas({ action: 'alm_insumo_historico', id });
    const hist = d.data || [];
    if (!hist.length) { showToast('Nenhum historico de preco para este item.', 'info'); return; }
    const html = hist.map(h => {
      const dt = new Date(h.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const mudouEmb = h.qtd_emb_nova !== h.qtd_emb_anterior;
      return `<div style="padding:10px 0;border-bottom:1px solid #f0ece6;font-size:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:var(--muted);">${dt} · ${esc(h.fonte||'?')}</span>
          <span><span style="text-decoration:line-through;color:var(--muted);">${almFmtBRL(h.preco_anterior)}</span> → <strong style="color:#2d7a3a;">${almFmtBRL(h.preco_novo)}</strong></span>
        </div>
        <div style="margin-top:3px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(h.produto_encontrado||'')}">${esc(h.produto_encontrado||'—')}</div>
        ${mudouEmb ? `<div style="margin-top:2px;color:#1a6bb5;font-size:11px;">Embalagem: ${h.unidade_compra_nova||'?'} c/ ${h.qtd_emb_nova} un</div>` : ''}
        ${h.url ? `<a href="${esc(h.url)}" target="_blank" style="color:#1a6bb5;font-size:10px;">Ver produto</a>` : ''}
      </div>`;
    }).join('');

    // Usar modal simples
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:650px;width:100%;padding:24px;max-height:80vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="font-family:'Lora',serif;font-size:16px;">Historico de Precos — ${esc(nome)}</h3>
        <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--muted);">×</button>
      </div>
      ${html}
    </div>`;
    document.body.appendChild(overlay);
  }

  // ── CATEGORIAS DE INSUMOS ────────────────────────────
  var almCategorias = [];
  async function almLoadCategorias() {
    const d = await api({ action: 'alm_categorias_list' });
    almCategorias = Array.isArray(d) ? d : [];
    // Atualiza chips
    document.getElementById('almCatChips').innerHTML = almCategorias.map(c =>
      `<span style="padding:4px 12px;background:var(--red-light);color:var(--red);border-radius:20px;font-size:11px;font-weight:600;">${esc(c.nome)}</span>`
    ).join('');
    // Atualiza select no form de insumo
    const sel = document.getElementById('almInsumoCategoria');
    if (sel && sel.tagName === 'SELECT') {
      const val = sel.value;
      sel.innerHTML = '<option value="">— sem categoria —</option>' + almCategorias.map(c => `<option value="${esc(c.nome)}">${esc(c.nome)}</option>`).join('');
      sel.value = val;
    }
  }
  function toggleAlmCatConfig() {
    const el = document.getElementById('almCatConfig');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
    if (el.style.display === 'block') renderAlmCatConfig();
  }
  async function renderAlmCatConfig() {
    const d = await api({ action: 'alm_categorias_list_all' });
    const cats = Array.isArray(d) ? d : [];
    document.getElementById('almCatList').innerHTML = cats.map(c =>
      `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f5f0ea;">
        <span style="flex:1;font-size:12px;${c.ativo?'':'opacity:.5;text-decoration:line-through;'}">${esc(c.nome)}</span>
        <button onclick="toggleAlmCat('${c.id}',${!c.ativo})" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;">${c.ativo?'Desativar':'Ativar'}</button>
      </div>`
    ).join('');
  }
  async function toggleAlmCat(id, ativo) {
    await api({ action: 'alm_categoria_toggle', id, ativo });
    await almLoadCategorias();
    renderAlmCatConfig();
  }
  async function addAlmCategoria() {
    const nome = document.getElementById('almNovaCat').value.trim();
    if (!nome) return;
    const d = await api({ action: 'alm_categoria_save', nome });
    if (d.error) { showToast(d.error, 'error'); return; }
    document.getElementById('almNovaCat').value = '';
    await almLoadCategorias();
    renderAlmCatConfig();
  }

  async function almLoadRelatorio() {
    const mes = document.getElementById('almRelMes').value || new Date().toISOString().slice(0,7);
    const d = await callDiplomas({ action: 'alm_relatorio', mes });
    const grupos = d.data || [];
    if (!grupos.length) { document.getElementById('almRelatorio').innerHTML = '<div class="empty-state">Nenhuma requisição no período.</div>'; return; }
    document.getElementById('almRelatorio').innerHTML = grupos.map(g => {
      const pct = g.orcamento > 0 ? Math.min(100,(g.gasto/g.orcamento)*100).toFixed(1) : 0;
      const barColor = pct>=90?'#e53e3e':pct>=70?'#f6a623':'#48bb78';
      return `<div style="background:#fff;border:1.5px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <div style="width:14px;height:14px;border-radius:50%;background:${g.turma?.cor||'#3B82F6'};"></div>
          <strong style="font-size:15px;">${g.turma.nome}</strong>
          <span style="font-size:12px;color:var(--muted);margin-left:auto;">Orçamento: ${almFmtBRL(g.orcamento)}</span>
        </div>
        <div style="display:flex;gap:20px;margin-bottom:10px;font-size:13px;">
          <span>✅ Aprovado: <strong style="color:#2d7a2d;">${almFmtBRL(g.gasto)}</strong></span>
          <span>⏳ Pendente: <strong style="color:#b07d00;">${almFmtBRL(g.pendente)}</strong></span>
          <span>❌ Rejeitado: <strong style="color:#c0392b;">${almFmtBRL(g.rejeitado)}</strong></span>
        </div>
        <div style="background:#f0ece6;border-radius:6px;height:8px;overflow:hidden;margin-bottom:4px;">
          <div style="width:${pct}%;height:100%;background:${barColor};border-radius:6px;"></div>
        </div>
        <div style="font-size:11px;color:var(--muted);">${pct}% do orçamento utilizado</div>
      </div>`;
    }).join('');
  }

  // ── FAMÍLIAS (tabela familias) ────────────────────────
  var famDados = [];
  var famSeriesOpts = '';

  // ── IMPORTACAO DE FAMILIAS E ATIVIDADES ──────────────
  function gerarModeloFamilias() {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Nome do Responsavel *', 'E-mail *', 'Nome da Crianca *', 'CPF', 'Serie', 'Turno'],
      ['Maria Silva', 'maria@email.com', 'Pedro Silva', '000.000.000-00', 'Toddler', 'integral_5x'],
      ['Maria Silva', 'maria@email.com', 'Ana Silva', '', 'Nursery', 'semi_4x'],
      ['Ana Costa', 'ana@email.com', 'Julia Costa', '', 'Year 1', 'tarde'],
      ['Carlos Souza', 'carlos@email.com', 'Lucas Souza', '', 'Year 2', 'integral_3x'],
      ['','','','','',''],['','','','','',''],['','','','','',''],
    ]);
    ws['!cols'] = [{ wch: 28 }, { wch: 28 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Familias');
    // Aba de turnos para referencia
    const wsTurnos = XLSX.utils.aoa_to_sheet([
      ['Codigo do Turno', 'Descricao', 'Valor Mensal'],
      ['integral_5x', 'Integral · 5x na semana (todos os dias)', 'R$ 4.395,00'],
      ['integral_4x', 'Integral · 4x na semana', 'R$ 4.303,57'],
      ['integral_3x', 'Integral · 3x na semana', 'R$ 4.072,13'],
      ['integral_2x', 'Integral · 2x na semana', 'R$ 3.760,70'],
      ['integral_1x', 'Integral · 1x na semana', 'R$ 3.300,00'],
      ['semi_5x', 'Semi-Integral · 5x na semana', 'R$ 4.030,00'],
      ['semi_4x', 'Semi-Integral · 4x na semana', 'R$ 3.991,57'],
      ['semi_3x', 'Semi-Integral · 3x na semana', 'R$ 3.773,13'],
      ['semi_2x', 'Semi-Integral · 2x na semana', 'R$ 3.534,70'],
      ['semi_1x', 'Semi-Integral · 1x na semana', 'R$ 3.196,27'],
      ['tarde', 'Apenas a Tarde (inicio 13:30h)', '—'],
      ['diaria', 'Diaria avulsa', 'R$ 150,00'],
    ]);
    wsTurnos['!cols'] = [{ wch: 16 }, { wch: 40 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsTurnos, 'Turnos Referencia');
    const wsInst = XLSX.utils.aoa_to_sheet([
      ['INSTRUCOES — Importacao de Familias e Turnos'],
      [''],
      ['Colunas obrigatorias: Nome do Responsavel, E-mail, Nome da Crianca'],
      ['CPF e Serie sao opcionais. Turno e IMPORTANTE para controle.'],
      [''],
      ['TURNO: use o codigo exato da aba "Turnos Referencia"'],
      ['  Ex: integral_5x, semi_3x, tarde, diaria'],
      [''],
      ['Cada linha = uma crianca. Se um responsavel tem 2 filhos, use 2 linhas com o mesmo email.'],
      ['O email sera usado para liberar o acesso ao portal dos pais.'],
    ]);
    wsInst['!cols'] = [{ wch: 72 }];
    XLSX.utils.book_append_sheet(wb, wsInst, 'Instrucoes');
    XLSX.writeFile(wb, 'modelo_familias_lumied.xlsx');
  }

  function gerarModeloAtividades() {
    if (typeof XLSX === 'undefined') { showToast('Aguarde o carregamento do XLSX','error'); return; }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['nome', 'atividade', 'turma'],
      ['Pedro Silva', 'Natacao', 'Turma A — 14h'],
      ['Pedro Silva', 'Futebol', 'Turma B — 15h'],
      ['Julia Costa', 'Bale', 'Turma A — 14h'],
    ]);
    ws['!cols'] = [{ wch: 30 }, { wch: 25 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Atividades');
    const wsInst = XLSX.utils.aoa_to_sheet([
      ['Instrucoes para importacao de atividades extras'],
      [''],
      ['Colunas:'],
      ['  nome — Nome do aluno (deve corresponder exatamente ao cadastro)'],
      ['  atividade — Nome da atividade (deve existir em Gerenciar Atividades)'],
      ['  turma — Nome da turma/horario da atividade'],
      [''],
      ['Se uma crianca faz 2 atividades, use 2 linhas com o mesmo nome.'],
      [''],
      ['IMPORTANTE:'],
      ['  - Somente alunos cujo nome apareca na planilha serao atualizados.'],
      ['  - Alunos que nao estejam na planilha NAO serao modificados.'],
      ['  - O nome deve ser identico ao cadastrado no sistema.'],
    ]);
    wsInst['!cols'] = [{ wch: 72 }];
    XLSX.utils.book_append_sheet(wb, wsInst, 'Instrucoes');
    XLSX.writeFile(wb, 'modelo_atividades_lumied.xlsx');
  }

  var famImportData = [];
  var famImportMode = ''; // 'familias' ou 'atividades'

  async function importarFamiliasXlsx(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    famImportMode = 'familias';
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type:'array' });
      const sheetName = wb.SheetNames.find(n => !n.toLowerCase().includes('instru')) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, defval:'' });
      famImportData = rows.slice(1).filter(r => String(r[0]||'').trim() && String(r[1]||'').trim()).map(r => ({
        nome_responsavel: String(r[0]||'').trim(),
        email: String(r[1]||'').trim(),
        nome_aluno: String(r[2]||'').trim(),
        cpf: String(r[3]||'').trim(),
        serie: String(r[4]||'').trim(),
        turno: String(r[5]||'').trim(),
      }));
      if (!famImportData.length) { showToast('Nenhum registro encontrado.','warning'); return; }
      document.getElementById('famImportSummary').textContent = famImportData.length + ' familia(s) encontrada(s)';
      document.getElementById('famImportRows').innerHTML = famImportData.map(f =>
        `<div style="padding:5px 8px;border-bottom:1px solid #f0ece6;">${esc(f.nome_responsavel)} · ${esc(f.email)} · ${esc(f.nome_aluno)} · ${esc(f.serie||'—')} · ${esc(f.turno||'—')}</div>`
      ).join('');
      document.getElementById('famImportBtn').textContent = 'Importar ' + famImportData.length + ' familias';
      document.getElementById('famImportBtn').onclick = confirmarImportFamilias;
      document.getElementById('famImportResult').style.display = 'block';
    } catch(e) { showToast('Erro ao ler arquivo.','error'); }
  }

  async function importarAtividadesXlsx(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    if (typeof XLSX === 'undefined') { showToast('Aguarde o carregamento do XLSX','error'); return; }
    famImportMode = 'atividades';
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type:'array' });
      const sheetName = wb.SheetNames.find(n => !n.toLowerCase().includes('instru')) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval:'' });
      famImportData = rows.filter(r => {
        const nome = (r.nome || r.Nome || r.NOME || '').toString().trim();
        const ativ = (r.atividade || r.Atividade || r.ATIVIDADE || '').toString().trim();
        return nome && ativ;
      }).map(r => ({
        nome: (r.nome || r.Nome || r.NOME || '').toString().trim(),
        atividade: (r.atividade || r.Atividade || r.ATIVIDADE || '').toString().trim(),
        turma: (r.turma || r.Turma || r.TURMA || '').toString().trim(),
      }));
      if (!famImportData.length) { showToast('Nenhum registro válido (nome + atividade obrigatórios)','warning'); return; }
      document.getElementById('ativImportSummary').textContent = famImportData.length + ' inscricao(oes) encontrada(s)';
      document.getElementById('ativImportRows').innerHTML =
        '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr><th style="text-align:left;padding:4px 8px;">Nome</th><th style="text-align:left;padding:4px 8px;">Atividade</th><th style="text-align:left;padding:4px 8px;">Turma</th></tr></thead><tbody>' +
        famImportData.map(f =>
          `<tr><td style="padding:4px 8px;">${esc(f.nome)}</td><td style="padding:4px 8px;">${esc(f.atividade)}</td><td style="padding:4px 8px;">${esc(f.turma||'—')}</td></tr>`
        ).join('') + '</tbody></table>';
      document.getElementById('ativImportBtn').textContent = 'Importar ' + famImportData.length + ' inscricoes';
      document.getElementById('ativImportResult').style.display = 'block';
    } catch(e) { showToast('Erro ao ler arquivo.','error'); }
  }

  async function confirmarImportFamilias() {
    const btn = document.getElementById('famImportBtn');
    btn.disabled = true; btn.textContent = 'Importando...';
    let ok = 0, erros = 0;
    for (const f of famImportData) {
      try {
        // Insere em familias (acesso ao portal)
        await fetch(SUPABASE_URL + '/rest/v1/familias', {
          method: 'POST', headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ nome_responsavel: f.nome_responsavel, nome_aluno: f.nome_aluno, email: f.email, cpf: f.cpf || null }),
        });
        // Se tem turno, insere tambem em solicitacoes
        if (f.turno) {
          await api({ action: 'public_submit', email: f.email, nome_resp: f.nome_responsavel, nome_crianca: f.nome_aluno, serie: f.serie || null, turno: f.turno });
        }
        ok++;
      } catch(_) { erros++; }
    }
    showToast(ok + ' familia(s) importada(s)' + (erros ? ', ' + erros + ' erro(s)' : ''), erros ? 'warning' : 'success');
    document.getElementById('famImportResult').style.display = 'none';
    famImportData = [];
    btn.disabled = false;
    loadFamiliasPanel();
  }

  async function confirmarImportAtividades() {
    const btn = document.getElementById('ativImportBtn');
    btn.disabled = true; btn.textContent = 'Importando...';
    const d = await api({ action: 'alunos_import_atividades', registros: famImportData });
    if (d.error) {
      showToast(d.error, 'error');
    } else {
      const msgs = [];
      if (d.sucesso) msgs.push(d.sucesso + ' atualizado(s)');
      if (d.erros && d.erros.length) msgs.push(d.erros.length + ' erro(s)');
      showToast(msgs.join(', ') || 'Concluído', d.erros?.length ? 'warning' : 'success');
      if (d.erros && d.erros.length) console.log('Erros importação atividades:', d.erros);
    }
    document.getElementById('ativImportResult').style.display = 'none';
    famImportData = [];
    btn.disabled = false;
    btn.textContent = 'Confirmar';
    loadAtivDashboard();
  }

  function toggleCadastroForm() {
    const el = document.getElementById('cadFormWrap');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  // ═══════════════════════════════════════════════════════════════
  //  ENGAJAMENTO DE FAMÍLIAS
  // ═══════════════════════════════════════════════════════════════

  var _engTrendFilter = '';

  async function loadEngajamentoPanel() {
    const [dash, lista] = await Promise.all([
      api({ action: 'engagement_dashboard' }),
      api({ action: 'engagement_list' }),
    ]);
    renderEngDashboard(dash);
    renderEngLista(Array.isArray(lista) ? lista : []);
  }

  function renderEngDashboard(d) {
    if (!d) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('engAvgScore', d.avg_score ?? '—');
    set('engAlto', d.alto ?? 0);
    set('engMedio', d.medio ?? 0);
    set('engBaixo', d.baixo ?? 0);
    set('engSubindo', d.subindo ?? 0);
    set('engEstavel', d.estavel ?? 0);
    set('engDescendo', d.descendo ?? 0);
  }

  function renderEngLista(rows) {
    const el = document.getElementById('engLista');
    if (!el) return;
    if (!rows.length) { el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-size:13px;">Nenhuma família encontrada. Clique em "Recalcular" para calcular os scores.</div>'; return; }
    const filtered = _engTrendFilter ? rows.filter(r => r.trend === _engTrendFilter) : rows;
    if (!filtered.length) { el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-size:13px;">Sem famílias com esse filtro.</div>'; return; }
    const trendIcon = t => t === 'subindo' ? '<span style="color:#2d7a3a;font-weight:700;">▲</span>' : t === 'descendo' ? '<span style="color:#c0392b;font-weight:700;">▼</span>' : '<span style="color:#888;">●</span>';
    const scoreColor = s => s > 70 ? '#2d7a3a' : s >= 40 ? '#b07d10' : '#c0392b';
    const rows_html = filtered.map(r => {
      const pct = r.score ?? 0;
      const cor = scoreColor(pct);
      return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${esc(r.familia_nome || r.familia_email)}</div>
          <div style="font-size:11px;color:var(--muted);">${esc(r.familia_email)}</div>
        </div>
        <div style="width:120px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
            <span style="color:${cor};font-weight:700;">${pct}</span><span style="color:var(--muted);">/ 100</span>
          </div>
          <div style="height:6px;background:var(--border);border-radius:4px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:${cor};border-radius:4px;transition:width .4s;"></div>
          </div>
        </div>
        <div style="width:32px;text-align:center;">${trendIcon(r.trend)}</div>
        <button onclick="engEnviarMensagem('${esc(r.familia_email)}','${esc(r.familia_nome || '')}',this)" style="padding:5px 10px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:none;cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap;">✉ Mensagem</button>
      </div>`;
    }).join('');
    el.innerHTML = `<div style="font-size:11px;color:var(--muted);padding:8px 16px;border-bottom:1px solid var(--border);">${filtered.length} família${filtered.length !== 1 ? 's' : ''} — ordenado por menor engajamento primeiro</div>${rows_html}`;
  }

  async function filtrarEngajamento(trend, btn) {
    _engTrendFilter = trend;
    document.querySelectorAll('#panelEngajamento .filter-bar .fb').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const lista = await api({ action: 'engagement_list', trend });
    renderEngLista(Array.isArray(lista) ? lista : []);
  }

  async function calcularEngajamento() {
    const btn = document.querySelector('#panelEngajamento button[onclick="calcularEngajamento()"]');
    if (btn) { btn.disabled = true; btn.textContent = '⟳ Calculando...'; }
    const r = await api({ action: 'calcular_engagement' });
    if (btn) { btn.disabled = false; btn.textContent = '⟳ Recalcular'; }
    if (r?.calculadas !== undefined) {
      showToast?.(`Score calculado para ${r.calculadas} família(s).`, 'success');
      loadEngajamentoPanel();
    }
  }

  function engEnviarMensagem(email, nome, btn) {
    // Redireciona para o chat com a família pré-selecionada
    showPanel('chatConversas', null);
    setTimeout(() => {
      const searchEl = document.getElementById('chatBusca');
      if (searchEl) { searchEl.value = nome || email; searchEl.dispatchEvent(new Event('input')); }
    }, 400);
  }

  async function loadFamiliasPanel() {
    loadCadastroPanel();
    if (!famSeriesOpts) {
      const s = await api({ action: 'series_list' });
      const arr = Array.isArray(s) ? s : [];
      famSeriesOpts = arr.map(x => `<option value="${esc(x.nome)}">${esc(x.nome)}</option>`).join('');
    }
    const d = await api({ action: 'familias_list' });
    famDados = Array.isArray(d) ? d : [];
    renderFamiliasLista();
  }

  function renderFamiliasLista() {
    const q = (document.getElementById('famSearch')?.value || '').toLowerCase();
    const lista = famDados.filter(r =>
      !q || [r.nome_aluno, r.nome_responsavel, r.email, r.cpf, r.serie].some(v => v?.toLowerCase().includes(q))
    );
    document.getElementById('famCount').textContent = lista.length;
    if (!lista.length) {
      document.getElementById('famLista').innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px;">Nenhuma família encontrada.</div>';
      return;
    }
    document.getElementById('famLista').innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Aluno</th>
          <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Responsável</th>
          <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">CPF</th>
          <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Série</th>
          <th style="padding:10px 14px;border-bottom:1.5px solid var(--border);"></th>
        </tr></thead>
        <tbody>${lista.map(r => `
          <tr data-cpf="${esc(r.cpf)}">
            <td style="padding:11px 14px;font-size:13px;border-bottom:1px solid #f5f0ea;"><strong>${esc(r.nome_aluno)}</strong><br><small style="color:var(--muted)">${esc(r.email||'')}</small></td>
            <td style="padding:11px 14px;font-size:13px;border-bottom:1px solid #f5f0ea;">${esc(r.nome_responsavel||'—')}</td>
            <td style="padding:11px 14px;font-size:13px;border-bottom:1px solid #f5f0ea;">${esc(r.cpf||'—')}</td>
            <td style="padding:11px 14px;font-size:13px;border-bottom:1px solid #f5f0ea;">
              <select id="famSel_${esc(r.cpf)}" onchange="updateFamSerie('${esc(r.cpf)}',this.value)" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:'DM Sans',sans-serif;background:var(--bg);">
                <option value="">— sem série —</option>
                ${famSeriesOpts}
              </select>
            </td>
            <td style="padding:11px 14px;border-bottom:1px solid #f5f0ea;text-align:right;white-space:nowrap;">
              <button class="action-btn" onclick="abrirEditFamilia('${esc(r.cpf)}')" style="margin-right:4px;" title="Editar">✏️</button>
              <button class="action-btn del" onclick="deleteFamilia('${esc(r.cpf||'')}','${esc(r.nome_aluno)}','${esc(r.email||'')}')">🗑</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    // Seta valores dos selects de série
    lista.forEach(r => {
      const sel = document.getElementById('famSel_' + r.cpf);
      if (sel && r.serie) sel.value = r.serie;
    });
  }

  async function updateFamSerie(cpf, serie) {
    const d = await api({ action: 'familias_update', cpf, serie: serie || null });
    if (d.error) alert('Erro ao atualizar série: ' + d.error);
  }

  function abrirEditFamilia(cpf) {
    const r = famDados.find(f => f.cpf === cpf);
    if (!r) return;
    document.getElementById('famEditNomeAluno').value = r.nome_aluno || '';
    document.getElementById('famEditNomeResp').value = r.nome_responsavel || '';
    document.getElementById('famEditEmail').value = r.email || '';
    document.getElementById('famEditCpf').value = r.cpf || '';
    // Popular series no select
    const selSerie = document.getElementById('famEditSerie');
    selSerie.innerHTML = '<option value="">— sem serie —</option>' + famSeriesOpts;
    if (r.serie) selSerie.value = r.serie;
    if (r.turno) document.getElementById('famEditTurno').value = r.turno;
    document.getElementById('famEditNovaSenha').value = '';
    document.getElementById('famSenhaErr').classList.remove('show');
    document.getElementById('famSenhaOk').classList.remove('show');
    const modal = document.getElementById('famEditModal');
    modal.style.display = 'flex';
  }
  function fecharEditFamilia() {
    document.getElementById('famEditModal').style.display = 'none';
    document.getElementById('famEditNovaSenha').value = '';
    document.getElementById('famSenhaErr').classList.remove('show');
    document.getElementById('famSenhaOk').classList.remove('show');
  }
  async function famResetSenha() {
    const errEl = document.getElementById('famSenhaErr');
    const okEl = document.getElementById('famSenhaOk');
    errEl.classList.remove('show'); okEl.classList.remove('show');
    const email = document.getElementById('famEditEmail').value.trim();
    const novaSenha = document.getElementById('famEditNovaSenha').value;
    if (!novaSenha) { errEl.textContent = 'Digite a nova senha.'; errEl.classList.add('show'); return; }
    if (novaSenha.length < 6) { errEl.textContent = 'Senha deve ter no minimo 6 caracteres.'; errEl.classList.add('show'); return; }
    if (!email) { errEl.textContent = 'E-mail da familia nao definido.'; errEl.classList.add('show'); return; }
    const d = await api({ action: 'familias_reset_senha', email, nova_senha: novaSenha });
    if (d.error) { errEl.textContent = d.error; errEl.classList.add('show'); return; }
    okEl.textContent = 'Senha alterada com sucesso!'; okEl.classList.add('show');
    document.getElementById('famEditNovaSenha').value = '';
  }
  async function salvarEditFamilia() {
    const cpf = document.getElementById('famEditCpf').value;
    const d = await api({
      action: 'familias_update',
      cpf,
      nome_aluno: document.getElementById('famEditNomeAluno').value.trim(),
      nome_responsavel: document.getElementById('famEditNomeResp').value.trim(),
      email: document.getElementById('famEditEmail').value.trim(),
      serie: document.getElementById('famEditSerie').value || null,
      turno: document.getElementById('famEditTurno').value || null
    });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast('Familia atualizada!', 'success');
    fecharEditFamilia();
    await loadFamiliasPanel();
  }

  async function deleteFamilia(cpf, nome, email) {
    if (!await _lumiedConfirm('Remover ' + nome + ' da lista de famílias?')) return;
    const payload = { action: 'familias_delete' };
    if (cpf) payload.cpf = cpf; else payload.email = email;
    await api(payload);
    await loadFamiliasPanel();
  }

  function exportarFamiliasCSV() {
    if (!famDados.length) { showToast('Nenhuma familia para exportar','error'); return; }
    const headers = ['nome_aluno','nome_responsavel','cpf','email','serie','turno'];
    const csvRows = [headers.join(';')];
    for (const r of famDados) {
      csvRows.push(headers.map(h => {
        let val = (r[h] || '').toString().replace(/"/g, '""');
        if (val.includes(';') || val.includes('"') || val.includes('\n')) val = '"' + val + '"';
        return val;
      }).join(';'));
    }
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'familias_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exportado!','success');
  }

  // ── CADASTRAR FAMÍLIA ─────────────────────────────────
  var cadDados = [];

  async function loadCadastroPanel() {
    // Carrega séries no select
    const sel = document.getElementById('cadSerie');
    if (sel.options.length <= 1) {
      const d = await api({ action: 'series_list' });
      (Array.isArray(d) ? d : []).forEach(s => {
        const o = document.createElement('option');
        o.value = s.nome; o.textContent = s.nome;
        sel.appendChild(o);
      });
    }
    // Carrega lista de solicitações
    const d = await api({ action: 'solicitacoes_list' });
    cadDados = Array.isArray(d) ? d : (allData || []);
    renderCadastroLista();
  }

  function renderCadastroLista() {
    const q = (document.getElementById('cadSearch')?.value || '').toLowerCase();
    const lista = cadDados.filter(r =>
      !q || [r.nome_crianca, r.nome_resp, r.email, r.serie].some(v => v?.toLowerCase().includes(q))
    );
    document.getElementById('cadCount').textContent = lista.length;
    if (!lista.length) {
      document.getElementById('cadLista').innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px;">Nenhuma solicitação encontrada.</div>';
      return;
    }
    document.getElementById('cadLista').innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Criança</th>
          <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Responsável</th>
          <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">E-mail</th>
          <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Turno</th>
          <th style="padding:10px 14px;border-bottom:1.5px solid var(--border);"></th>
        </tr></thead>
        <tbody>${lista.map(r => `
          <tr>
            <td style="padding:11px 14px;font-size:13px;border-bottom:1px solid #f5f0ea;"><strong>${esc(r.nome_crianca)}</strong>${r.serie ? `<br><span style="font-size:11px;color:var(--muted);">${esc(r.serie)}</span>` : ''}</td>
            <td style="padding:11px 14px;font-size:13px;border-bottom:1px solid #f5f0ea;">${esc(r.nome_resp||'—')}</td>
            <td style="padding:11px 14px;font-size:13px;border-bottom:1px solid #f5f0ea;">${esc(r.email||'—')}</td>
            <td style="padding:11px 14px;font-size:13px;border-bottom:1px solid #f5f0ea;">${esc((r.turno||'').replace(/_/g,' ').replace(/(\d)x/,'$1×'))}</td>
            <td style="padding:11px 14px;border-bottom:1px solid #f5f0ea;text-align:right;white-space:nowrap;">
              <button onclick="aprovarSolicitacao('${r.id}')" style="padding:4px 10px;background:#2d7a3a;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;margin-right:4px;">✅ Aprovar</button>
              <button class="action-btn del" onclick="deleteCadastro('${r.id}','${esc(r.nome_crianca)}')">🗑</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  async function submitCadastro() {
    const nomeResp    = document.getElementById('cadNomeResp').value.trim();
    const email       = document.getElementById('cadEmail').value.trim();
    const nomeCrianca = document.getElementById('cadNomeCrianca').value.trim();
    const serie       = document.getElementById('cadSerie').value;
    const turno       = document.getElementById('cadTurno').value;
    const errEl = document.getElementById('cadErr');
    const okEl  = document.getElementById('cadOk');
    errEl.style.display = 'none'; okEl.style.display = 'none';

    if (!nomeResp || !email || !nomeCrianca || !turno) {
      errEl.textContent = 'Preencha nome do responsável, e-mail, nome da criança e turno.';
      errEl.style.display = 'block'; return;
    }

    const btn = document.getElementById('cadBtn');
    btn.disabled = true; btn.textContent = 'Salvando…';

    const d = await api({ action: 'public_submit', email, nome_resp: nomeResp, nome_crianca: nomeCrianca, serie: serie||null, turno }).catch(() => ({ error: 'Erro de conexão.' }));

    btn.disabled = false; btn.textContent = 'Cadastrar';
    if (d.error) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }

    okEl.textContent = `${nomeCrianca} cadastrada com sucesso!`;
    okEl.style.display = 'block';
    document.getElementById('cadNomeResp').value = '';
    document.getElementById('cadEmail').value = '';
    document.getElementById('cadNomeCrianca').value = '';
    document.getElementById('cadSerie').value = '';
    document.getElementById('cadTurno').value = '';
    await loadCadastroPanel();
  }

  async function aprovarSolicitacao(id) {
    const sol = cadDados.find(r => r.id === id);
    if (!sol) return;
    if (!await _lumiedConfirm('Aprovar acesso de ' + (sol.nome_resp||sol.email) + ' (' + (sol.nome_crianca||'') + ')?')) return;
    // Insere na tabela familias para liberar acesso
    try {
      await fetch(SUPABASE_URL + '/rest/v1/familias', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ nome_responsavel: sol.nome_resp, nome_aluno: sol.nome_crianca, email: sol.email, cpf: sol.cpf || null }),
      });
      showToast('Acesso aprovado para ' + (sol.nome_resp||sol.email) + '!', 'success');
      await loadFamiliasPanel();
    } catch(e) { showToast('Erro ao aprovar.', 'error'); }
  }

  async function deleteCadastro(id, nome) {
    if (!await _lumiedConfirm(`Remover cadastro de ${nome}?`)) return;
    await api({ action: 'solicitacoes_delete', id });
    await loadCadastroPanel();
  }

  // ── NOTIFICAÇÕES ─────────────────────────────────────
  var notifData = [];
  async function loadNotificacoes() {
    if (!currentGerente) return;
    const d = await api({ action: 'notif_list', portal: 'gerente', email: currentGerente.email });
    notifData = Array.isArray(d?.data) ? d.data : [];
    renderNotif();
  }
  function renderNotif() {
    const el = document.getElementById('notifList');
    const dot = document.getElementById('notifDot');
    const dotFloat = document.getElementById('notifDotFloat');
    const unread = notifData.filter(n => !n.lida);
    const dotDisplay = unread.length > 0 ? 'block' : 'none';
    dot.style.display = dotDisplay;
    if (dotFloat) dotFloat.style.display = dotDisplay;
    if (!notifData.length) { el.innerHTML = '<div style="padding:24px;text-align:center;color:#7a7169;font-size:13px;">Nenhuma notificação.</div>'; return; }
    el.innerHTML = notifData.slice(0, 20).map(n => {
      const dt = new Date(n.criado_em);
      const tempo = dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' }) + ' ' + dt.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
      return `<div style="padding:12px 16px;border-bottom:1px solid #f5f0ea;font-size:13px;line-height:1.5;${n.lida?'':'background:#fdf8f0;'}">
        <strong>${esc(n.titulo)}</strong><br>${esc(n.mensagem)}
        <div style="font-size:10px;color:#7a7169;margin-top:4px;">${tempo}</div>
      </div>`;
    }).join('');
  }
  function toggleNotifPanel() {
    const p = document.getElementById('notifPanel');
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
  }
  async function marcarTodasLidas() {
    await api({ action: 'notif_marcar_todas', portal: 'gerente', email: currentGerente.email });
    notifData.forEach(n => n.lida = true);
    renderNotif();
  }

  // ── CALENDARIO ESCOLAR ──────────────────────────────
  var calEventos = [];
  var calAno = new Date().getFullYear();
  var CAL_TIPOS = { feriado:'Feriado', reuniao:'Reuniao', evento:'Evento', data_comemorativa:'Data Comemorativa', recesso:'Recesso', avaliacao:'Avaliacao' };
  var CAL_MESES = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  var CAL_DIAS = ['D','S','T','Q','Q','S','S'];

  function calMudarAno(delta) { calAno += delta; loadCalendario(); }
  function calToggleForm() {
    const el = document.getElementById('calFormWrap');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
    if (el.style.display === 'none') limparCalForm();
  }

  async function loadCalendario() {
    document.getElementById('calAnoLabel').textContent = calAno;
    const d = await api({ action: 'calendario_list', ano: String(calAno) });
    calEventos = Array.isArray(d) ? d : [];
    renderCalAnual();
  }

  function renderCalAnual() {
    const today = new Date();
    let html = '';
    for (let m = 0; m < 12; m++) {
      const firstDay = new Date(calAno, m, 1).getDay();
      const daysInMonth = new Date(calAno, m+1, 0).getDate();
      const isCurrentMonth = today.getFullYear() === calAno && today.getMonth() === m;
      // Count school days (weekdays without feriado/recesso)
      let diasLetivos = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(calAno, m, d).getDay();
        if (dow === 0 || dow === 6) continue;
        const ds = `${calAno}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isFeriado = calEventos.some(e => (e.tipo==='feriado'||e.tipo==='recesso') && e.data_inicio<=ds && (e.data_fim||e.data_inicio)>=ds);
        if (!isFeriado) diasLetivos++;
      }

      html += `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;">`;
      html += `<div style="background:#f5f0ea;padding:8px;text-align:center;font-weight:700;font-size:12px;letter-spacing:1px;">${CAL_MESES[m]}</div>`;
      html += `<div style="display:grid;grid-template-columns:repeat(7,1fr);text-align:center;padding:4px;">`;
      html += CAL_DIAS.map(d => `<div style="font-size:9px;font-weight:700;color:#999;padding:2px;">${d}</div>`).join('');
      for (let i = 0; i < firstDay; i++) html += '<div></div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${calAno}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const evts = calEventos.filter(e => e.data_inicio <= ds && (e.data_fim || e.data_inicio) >= ds);
        const isToday = isCurrentMonth && today.getDate() === d;
        const dow = new Date(calAno, m, d).getDay();
        const isSunday = dow === 0;
        let bg = 'transparent';
        if (evts.length) bg = evts[0].cor || '#FFD54F';
        const clickEvt = evts.length ? `onclick="calDiaClick('${ds}')"` : '';
        html += `<div ${clickEvt} style="width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:${isToday?'800':'500'};border-radius:4px;background:${bg};color:${bg!=='transparent'?'#333':isSunday?'#e53e3e':'#333'};${isToday?'outline:2px solid var(--red);':''}${evts.length?'cursor:pointer;':''}" title="${evts.map(e=>e.titulo).join(', ')}">${d}</div>`;
      }
      html += '</div>';
      // Events list for this month
      const monthEvents = calEventos.filter(e => {
        const em = parseInt(e.data_inicio.split('-')[1]);
        return em === m+1;
      });
      if (monthEvents.length) {
        html += `<div style="padding:6px 8px;border-top:1px solid var(--border);font-size:9px;color:#555;max-height:100px;overflow-y:auto;">`;
        html += `<div style="font-weight:700;margin-bottom:3px;">DIAS LETIVOS: ${diasLetivos}</div>`;
        monthEvents.forEach(e => {
          const day = parseInt(e.data_inicio.split('-')[2]);
          html += `<div style="display:flex;gap:4px;margin-bottom:1px;cursor:pointer;" onclick="editarEvento(${JSON.stringify(e).replace(/"/g,'&quot;')})">
            <span style="font-weight:700;color:${e.cor||'#333'};">${String(day).padStart(2,'0')}</span>
            <span>- ${esc(e.titulo)}</span>
          </div>`;
        });
        html += '</div>';
      } else {
        html += `<div style="padding:6px 8px;border-top:1px solid var(--border);font-size:9px;font-weight:700;color:#555;">DIAS LETIVOS: ${diasLetivos}</div>`;
      }
      html += '</div>';
    }
    document.getElementById('calAnualGrid').innerHTML = html;
  }

  function calDiaClick(ds) {
    const evts = calEventos.filter(e => e.data_inicio <= ds && (e.data_fim || e.data_inicio) >= ds);
    if (!evts.length) return;
    const dt = new Date(ds + 'T12:00:00');
    const diaFmt = dt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:480px;width:100%;padding:28px;max-height:80vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div>
          <div style="font-family:'Lora',serif;font-size:18px;font-weight:700;">${ds.split('-')[2]}</div>
          <div style="font-size:12px;color:var(--muted);text-transform:capitalize;">${diaFmt}</div>
        </div>
        <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);">x</button>
      </div>
      ${evts.map(e => {
        const tipoLabel = CAL_TIPOS[e.tipo] || e.tipo;
        return `<div style="border-left:4px solid ${e.cor||'#C8102E'};padding:12px 16px;margin-bottom:10px;background:#fdfbf8;border-radius:0 10px 10px 0;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${esc(e.titulo)}</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px;">${tipoLabel}</div>
          ${e.descricao ? `<div style="font-size:13px;color:#555;line-height:1.5;margin-bottom:8px;">${esc(e.descricao)}</div>` : ''}
          <div style="font-size:11px;color:var(--muted);">
            ${e.data_inicio === e.data_fim || !e.data_fim ? new Date(e.data_inicio+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'long'}) : new Date(e.data_inicio+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}) + ' a ' + new Date(e.data_fim+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'})}
            ${e.visivel_pais ? ' · Pais' : ''}${e.visivel_professoras ? ' · Professoras' : ''}
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button onclick="this.closest('div[style*=fixed]').remove();editarEvento(${JSON.stringify(e).replace(/"/g,'&quot;')})" style="padding:4px 12px;background:none;border:1px solid var(--border);border-radius:6px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Editar</button>
            <button onclick="this.closest('div[style*=fixed]').remove();excluirEvento('${e.id}')" style="padding:4px 12px;background:none;border:1px solid #e53e3e;color:#e53e3e;border-radius:6px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Excluir</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
    document.body.appendChild(overlay);
  }

  function editarEvento(e) {
    document.getElementById('calEventoId').value = e.id;
    document.getElementById('calTitulo').value = e.titulo;
    document.getElementById('calDescricao').value = e.descricao || '';
    document.getElementById('calDataInicio').value = e.data_inicio;
    document.getElementById('calDataFim').value = e.data_fim || '';
    document.getElementById('calTipo').value = e.tipo;
    document.getElementById('calCor').value = e.cor || '#C8102E';
    document.getElementById('calVisPais').checked = e.visivel_pais;
    document.getElementById('calVisProf').checked = e.visivel_professoras;
    document.getElementById('calFormTitle').textContent = 'Editar Evento';
  }

  function limparCalForm() {
    ['calEventoId','calTitulo','calDescricao','calDataInicio','calDataFim'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('calTipo').value = 'evento';
    document.getElementById('calCor').value = '#C8102E';
    document.getElementById('calVisPais').checked = true;
    document.getElementById('calVisProf').checked = true;
    document.getElementById('calFormTitle').textContent = 'Novo Evento';
  }

  async function salvarEvento() {
    const titulo = document.getElementById('calTitulo').value.trim();
    const dataInicio = document.getElementById('calDataInicio').value;
    if (!titulo || !dataInicio) { document.getElementById('calErr').textContent = 'Titulo e data obrigatorios.'; document.getElementById('calErr').classList.add('show'); return; }
    document.getElementById('calErr').classList.remove('show');
    await api({
      action: 'calendario_save',
      id: document.getElementById('calEventoId').value || undefined,
      titulo, descricao: document.getElementById('calDescricao').value.trim(),
      data_inicio: dataInicio, data_fim: document.getElementById('calDataFim').value || dataInicio,
      tipo: document.getElementById('calTipo').value, cor: document.getElementById('calCor').value,
      visivel_pais: document.getElementById('calVisPais').checked,
      visivel_professoras: document.getElementById('calVisProf').checked,
    });
    limparCalForm();
    showToast('Evento salvo!', 'success');
    loadCalendario();
  }

  async function excluirEvento(id) {
    if (!await _lumiedConfirm('Excluir este evento?')) return;
    await api({ action: 'calendario_delete', id });
    loadCalendario();
  }

  // ── ANALYTICS DASHBOARD ────────────────────────────

  async function loadAnalytics() {
    var _MC = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    var _Z12 = [0,0,0,0,0,0,0,0,0,0,0,0];
    var _fmtBRL = function(v) { return 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); };
    var _MS = { pendente:'⏳ Pendente', aprovada:'✅ Aprovada', em_execucao:'🔧 Em Execução', concluida:'✅ Concluída', rejeitada:'❌ Rejeitada' };
    const ano = document.getElementById('analyticsAno').value;
    const el = document.getElementById('analyticsContent');
    el.innerHTML = '<div class="empty-state">Carregando...</div>';
    var d;
    try { d = await api({ action: 'analytics_dashboard', ano }); } catch(_) { d = {}; }
    if (!d || d.error || !d.solicitacoes_por_mes) { el.innerHTML = '<div class="empty-state">Nenhum dado disponível para ' + ano + '.</div>'; return; }

    if (!Array.isArray(d.solicitacoes_por_mes)) d.solicitacoes_por_mes = _Z12;
    if (!Array.isArray(d.gastos_almox_por_mes)) d.gastos_almox_por_mes = _Z12;
    if (!Array.isArray(d.manutencao_por_mes)) d.manutencao_por_mes = _Z12;
    const maxSol = Math.max(...d.solicitacoes_por_mes, 1);
    const maxGasto = Math.max(...d.gastos_almox_por_mes, 1);
    const maxManut = Math.max(...d.manutencao_por_mes, 1);

    var sumGastos = d.gastos_almox_por_mes.reduce((s,v)=>s+v,0);
    var miniChart = function(values, max, color, fmt) {
      return '<div style="display:flex;align-items:flex-end;gap:2px;height:48px;">' +
        values.map(function(v,i) {
          var h = Math.max(2, v/max*44);
          return '<div style="flex:1;background:' + (v>0?color:'#f0ece6') + ';border-radius:2px 2px 0 0;height:' + h + 'px;" title="' + _MC[i] + ': ' + (fmt?fmt(v):v) + '"></div>';
        }).join('') +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:8px;color:var(--muted);margin-top:4px;letter-spacing:.3px;"><span>' + _MC[0] + '</span><span>' + _MC[5] + '</span><span>' + _MC[11] + '</span></div>';
    };
    try { el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
        <!-- Solicitacoes -->
        <div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Solicitações de turno</div>
            <div style="font-family:'Lora',serif;font-size:18px;font-weight:700;color:var(--red);">${d.solicitacoes_por_mes.reduce((s,v)=>s+v,0)}</div>
          </div>
          ${miniChart(d.solicitacoes_por_mes, maxSol, 'var(--red)')}
        </div>

        <!-- Gastos almox -->
        <div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Gastos almoxarifado</div>
            <div style="font-family:'Lora',serif;font-size:16px;font-weight:700;color:#1a6bb5;">${sumGastos>=1000?'R$ '+(sumGastos/1000).toFixed(1).replace('.',',')+'k':_fmtBRL(sumGastos)}</div>
          </div>
          ${miniChart(d.gastos_almox_por_mes, maxGasto, '#1a6bb5', _fmtBRL)}
        </div>

        <!-- Manutencao -->
        <div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;">
            <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Manutenção</div>
            <div style="font-family:'Lora',serif;font-size:18px;font-weight:700;color:#d4830a;">${d.manutencao_por_mes.reduce((s,v)=>s+v,0)}</div>
          </div>
          ${miniChart(d.manutencao_por_mes, maxManut, '#d4830a')}
        </div>

        <!-- Atividades -->
        <div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:8px;">Atividades extracurriculares</div>
          ${(d.atividades||[]).length ? d.atividades.slice(0,4).map(a => `<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0;">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.nome)}</span>
            <span style="font-weight:700;color:var(--blue);">${a.inscritos}</span>
          </div>`).join('') : '<div style="color:var(--muted);font-size:12px;font-style:italic;">Nenhuma atividade.</div>'}
        </div>
      </div>

      <div id="riskScoreWidget" style="margin-top:10px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Alunos em risco</div>
          <button onclick="showPanel('alunos')" style="font-size:11px;color:var(--blue);background:none;border:none;cursor:pointer;font-family:inherit;font-weight:600;">Ver todos →</button>
        </div>
        <div id="riskScoreWidgetContent" style="font-size:12px;">Carregando...</div>
      </div>
    `;
    api({ action: 'risk_scores_list', filtro: 'alto' }).then(function(rs) {
      const el = document.getElementById('riskScoreWidgetContent');
      if (!el) return;
      const list = Array.isArray(rs) ? rs.slice(0, 5) : [];
      if (!list.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0;">Nenhum aluno em alto risco. ✅</div>'; return; }
      el.innerHTML = '<div style="font-size:12px;color:var(--muted);margin-bottom:10px;">' + list.length + (rs.length > list.length ? '+' : '') + ' aluno(s) em alto risco hoje</div>' +
        list.map(function(r) {
          const barW = Math.round(r.score);
          return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f5f5f5;" onclick="showPanel(\'alunos\')" style="cursor:pointer;">' +
            '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(r.aluno_nome || r.aluno_email) + '</div>' +
            '<div style="height:4px;background:#fef2f2;border-radius:2px;margin-top:4px;"><div style="height:4px;width:' + barW + '%;background:#ef4444;border-radius:2px;"></div></div>' +
            '</div>' +
            '<span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:#fef2f2;color:#b91c1c;white-space:nowrap;">' + r.score + '/100</span>' +
            '</div>';
        }).join('');
    }).catch(function() {
      const el = document.getElementById('riskScoreWidgetContent');
      if (el) el.innerHTML = '<div style="color:var(--muted);font-size:13px;">Dados de risco não disponíveis.</div>';
    });
    } catch(e) { el.innerHTML = '<div class="empty-state">Erro ao renderizar analytics: ' + e.message + '</div>'; }
  }

