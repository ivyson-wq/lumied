// Auto-extraído do gerente.html (Onda 4 — mega batch).
// Alunos — list/edição inline/ações boleto/ajustes ficha
  // ── ALUNOS ──────────────────────────────────────────────
  var alunosData = [], alunoAtual = null;
  var riskScoresMap = {}; // email -> score record

  async function loadAlunos() {
    const [d, rs] = await Promise.all([
      api({ action: 'alunos_list' }),
      api({ action: 'risk_scores_list' }).catch(() => []),
    ]);
    alunosData = Array.isArray(d) ? d : (d.data || []);
    const rsList = Array.isArray(rs) ? rs : [];
    riskScoresMap = {};
    for (const r of rsList) riskScoresMap[r.aluno_email] = r;
    // Populate turma filter
    const turmas = [...new Set(alunosData.map(a => a.serie || a.turma || '').filter(Boolean))].sort();
    const sel = document.getElementById('alunosFiltroTurma');
    if (sel) sel.innerHTML = '<option value="">Todas as turmas</option>' + turmas.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    renderAlunos();
  }

  function filtrarAlunos() {
    renderAlunos();
  }

  function renderAlunos() {
    const busca = (document.getElementById('alunosBusca')?.value || '').toLowerCase();
    const turmaFiltro = document.getElementById('alunosFiltroTurma')?.value || '';
    const filtered = alunosData.filter(a => {
      const nome = (a.nome || '').toLowerCase();
      const email = (a.email || '').toLowerCase();
      const turma = a.serie || a.turma || '';
      if (busca && !nome.includes(busca) && !email.includes(busca)) return false;
      if (turmaFiltro && turma !== turmaFiltro) return false;
      return true;
    });
    const body = document.getElementById('alunosBody');
    if (!body) return;
    if (filtered.length === 0) {
      body.innerHTML = '<tr><td colspan="7" style="padding:0;">' + (window.lumiedEmpty ? window.lumiedEmpty({
        icon: '🎓',
        title: 'Nenhum aluno cadastrado',
        text: 'Cadastre os alunos manualmente, importe uma planilha CSV ou migre direto do seu ERP anterior (Escolaweb, Sponte, WPensar, TOTVS).',
        cta: { label: '+ Cadastrar aluno', onclick: "abrirCadastroAluno && abrirCadastroAluno()" },
        secondary: { label: '📥 Importar do ERP', href: '/admin-central.html#migracao' },
      }) : '<div style="padding:40px;text-align:center;color:var(--muted);">Nenhum aluno encontrado.</div>') + '</td></tr>';
      return;
    }
    body.innerHTML = filtered.map(a => {
      const initials = (a.nome || '??').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      const freq = a.frequencia_pct != null ? a.frequencia_pct + '%' : '—';
      const media = a.media_geral != null ? Number(a.media_geral).toFixed(1) : '—';
      const freqColor = a.frequencia_pct >= 75 ? 'var(--green)' : a.frequencia_pct != null ? 'var(--red)' : 'var(--muted)';
      const mediaColor = a.media_geral >= 7 ? 'var(--green)' : a.media_geral != null ? 'var(--red)' : 'var(--muted)';
      const rs = riskScoresMap[a.email] || null;
      const riskBadge = rs
        ? rs.score >= 80
          ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;" title="Score de risco: ${rs.score}">⚠️ Alto risco</span>`
          : rs.score >= 60
            ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;" title="Score de risco: ${rs.score}">⚠ Atenção</span>`
            : ''
        : '';
      return `<tr style="border-bottom:1px solid #f0ece6;cursor:pointer;" onclick="abrirFichaAluno('${a.id || a.email}')">
        <td style="padding:10px 12px;"><div style="display:flex;align-items:center;gap:10px;">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--red-light);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--red);flex-shrink:0;">${initials}</div>
          <div><strong>${esc(a.nome)}</strong>${riskBadge}<br><span style="font-size:11px;color:var(--muted);">${esc(a.email || '')}</span></div>
        </div></td>
        <td style="padding:10px 12px;font-size:12px;">${esc(a.serie || a.turma || '—')}</td>
        <td style="padding:10px 12px;text-align:center;font-weight:600;color:${freqColor};">${freq}</td>
        <td style="padding:10px 12px;text-align:center;font-weight:600;color:${mediaColor};">${media}</td>
        <td style="padding:10px 12px;text-align:center;font-size:12px;">${a.docs_count || 0}</td>
        <td style="padding:10px 12px;text-align:center;font-size:12px;">${a.atas_count || 0}</td>
        <td style="padding:10px 12px;text-align:right;">
          <button class="action-btn" onclick="event.stopPropagation();abrirFichaAluno('${a.id || a.email}')" title="Ver ficha">📋</button>
        </td>
      </tr>`;
    }).join('');
  }

  async function abrirFichaAluno(idOrEmail) {
    const a = alunosData.find(x => x.id === idOrEmail || x.email === idOrEmail);
    if (!a) return showToast('Aluno não encontrado', 'error');
    alunoAtual = a;
    const initials = (a.nome || '??').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    document.getElementById('alunoDetAvatar').textContent = initials;
    document.getElementById('alunoDetNome').textContent = a.nome || '—';
    document.getElementById('alunoDetTurma').textContent = a.serie || a.turma || '—';
    document.getElementById('alunoDetEmail').textContent = a.email || '—';
    document.getElementById('alunoDetNasc').textContent = a.data_nascimento ? new Date(a.data_nascimento + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
    document.getElementById('alunoDetResp').textContent = a.responsavel_nome || a.resp_nome || '—';
    document.getElementById('alunoDetStatus').textContent = a.ativo !== false ? '✅ Ativo' : '❌ Inativo';
    showPanel('alunoDetalhe');
    switchAlunoTab('info', document.querySelector('.aluno-tab'));
    // Load notas
    loadAlunoNotas(a);
    loadAlunoFreq(a);
    loadAlunoDocs(a);
    loadAlunoFinanceiro(a);
    loadAlunoAtas(a);
    loadAlunoIaResumo(a.email);
  }

  function switchAlunoTab(tab, btn) {
    document.querySelectorAll('.aluno-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.aluno-tab-panel').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const panelMap = { info: 'alunoTabInfo', notas: 'alunoTabNotas', frequencia: 'alunoTabFrequencia', docs: 'alunoTabDocs', financeiro: 'alunoTabFinanceiro', atas: 'alunoTabAtas' };
    const panel = document.getElementById(panelMap[tab]);
    if (panel) panel.classList.add('active');
  }

  async function loadAlunoNotas(a) {
    const el = document.getElementById('alunoDetNotas');
    el.innerHTML = '<span style="color:var(--muted);">Carregando...</span>';
    try {
      const d = await fetch(SUPABASE_URL + '/functions/v1/academico', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON }, body: JSON.stringify({ action: 'boletim_get', aluno_email: a.email, ano: new Date().getFullYear(), _token: getToken() }) }).then(r => r.json());
      const discs = Array.isArray(d) ? d : (d.disciplinas || []);
      if (!discs.length) { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">Nenhuma nota registrada.</div>'; return; }
      el.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="border-bottom:2px solid var(--border);"><th style="padding:8px;text-align:left;">Disciplina</th><th style="padding:8px;text-align:center;">Média</th><th style="padding:8px;text-align:center;">Status</th></tr></thead><tbody>' +
        discs.map(disc => {
          const m = disc.media != null ? Number(disc.media).toFixed(1) : '—';
          const cor = disc.media >= 7 ? 'var(--green)' : disc.media != null ? 'var(--red)' : 'var(--muted)';
          const st = disc.media >= 7 ? 'Aprovado' : disc.media != null ? 'Recuperação' : '—';
          return `<tr style="border-bottom:1px solid #f0ece6;"><td style="padding:8px;">${esc(disc.nome)}</td><td style="padding:8px;text-align:center;font-weight:700;color:${cor};">${m}</td><td style="padding:8px;text-align:center;font-size:12px;">${st}</td></tr>`;
        }).join('') + '</tbody></table>';
    } catch { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">Erro ao carregar notas.</div>'; }
  }

  async function loadAlunoFreq(a) {
    const el = document.getElementById('alunoDetFreq');
    el.innerHTML = '<span style="color:var(--muted);">Carregando...</span>';
    try {
      const d = await fetch(SUPABASE_URL + '/functions/v1/academico', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON }, body: JSON.stringify({ action: 'frequencia_relatorio_aluno', aluno_email: a.email, _token: getToken() }) }).then(r => r.json());
      const pct = d.percent_presenca ?? d.pct ?? null;
      const total = d.total_aulas ?? 0;
      const faltas = d.total_faltas ?? 0;
      if (pct == null) { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">Sem dados de frequência.</div>'; return; }
      const cor = pct >= 75 ? 'var(--green)' : 'var(--red)';
      el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px;">
        <div style="padding:20px;background:var(--bg);border-radius:10px;text-align:center;"><div style="font-size:28px;font-weight:800;color:${cor};">${pct}%</div><div style="font-size:11px;color:var(--muted);">Presença</div></div>
        <div style="padding:20px;background:var(--bg);border-radius:10px;text-align:center;"><div style="font-size:28px;font-weight:800;">${total}</div><div style="font-size:11px;color:var(--muted);">Total de Aulas</div></div>
        <div style="padding:20px;background:var(--bg);border-radius:10px;text-align:center;"><div style="font-size:28px;font-weight:800;color:var(--red);">${faltas}</div><div style="font-size:11px;color:var(--muted);">Faltas</div></div>
      </div>`;
    } catch { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">Erro ao carregar frequência.</div>'; }
  }

  async function loadAlunoDocs(a) {
    const el = document.getElementById('alunoDetDocs');
    el.innerHTML = '<span style="color:var(--muted);">Carregando...</span>';
    try {
      const d = await api({ action: 'aluno_documentos_list', aluno_email: a.email });
      const docs = Array.isArray(d) ? d : (d.data || []);
      if (!docs.length) { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">Nenhum documento.</div>'; return; }
      el.innerHTML = docs.map(doc => `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">
        <div><strong style="font-size:13px;">${esc(doc.tipo || doc.nome_arquivo || 'Documento')}</strong><br><span style="font-size:11px;color:var(--muted);">${doc.criado_em ? new Date(doc.criado_em).toLocaleDateString('pt-BR') : ''} ${doc.validado ? '✅ Validado' : '⏳ Pendente'}</span></div>
        ${doc.arquivo_url ? `<a href="${esc(doc.arquivo_url)}" target="_blank" style="font-size:12px;color:var(--blue);text-decoration:none;">📎 Ver</a>` : ''}
      </div>`).join('');
    } catch { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">Erro ao carregar documentos.</div>'; }
  }

  var _alunoFinAtual = null;
  async function loadAlunoFinanceiro(a) {
    _alunoFinAtual = a;
    var resumoEl = document.getElementById('alunoFinResumo');
    var listaEl = document.getElementById('alunoFinLista');
    resumoEl.innerHTML = '';
    listaEl.innerHTML = '<span style="color:var(--muted);">Carregando...</span>';
    try {
      // Busca boletos emitidos + batch items pendentes do aluno
      var [boletos, batches] = await Promise.all([
        api({ action: 'fin_boletos_emitidos_list' }),
        apiFinExt({ action: 'boletos_batch_list' })
      ]);
      var bList = (Array.isArray(boletos) ? boletos : []).filter(function(b) {
        return b.crianca_nome === a.nome || b.aluno_id === a.id || b.familia_email === a.email;
      });
      // Batch items pendentes (aguardando/aprovado — editáveis)
      var batchItems = [];
      var batchList = Array.isArray(batches) ? batches : (batches?.data || []);
      batchList.forEach(function(batch) {
        var items = batch.fin_boleto_batch_items || batch.itens || [];
        items.forEach(function(it) {
          if ((it.crianca_nome === a.nome || it.aluno_id === a.id) && (it.status === 'aguardando' || it.status === 'aprovado')) {
            it._batch_mes = batch.mes_referencia;
            it._batch_status = batch.status;
            batchItems.push(it);
          }
        });
      });
      // KPIs (apenas boletos emitidos)
      var totalEmitido = bList.reduce(function(s,b){ return s + (b.status !== 'cancelado' ? parseFloat(b.valor||0) : 0); }, 0);
      var totalPago = bList.reduce(function(s,b){ return s + (b.status === 'pago' ? parseFloat(b.valor||0) : 0); }, 0);
      var totalAberto = bList.reduce(function(s,b){ return s + (b.status === 'emitido' ? parseFloat(b.valor||0) : 0); }, 0);
      var totalVencido = bList.filter(function(b){ return b.status === 'emitido' && b.vencimento < new Date().toISOString().slice(0,10); }).reduce(function(s,b){ return s + parseFloat(b.valor||0); }, 0);
      var totalPendente = batchItems.reduce(function(s,b){ return s + parseFloat(b.valor_total||0); }, 0);
      var fmtR = function(v){ return 'R$ ' + v.toLocaleString('pt-BR',{minimumFractionDigits:2}); };
      resumoEl.innerHTML =
        '<div class="card" style="padding:12px;border-left:4px solid #2d7a3a;"><div style="font-size:22px;font-weight:700;color:#2d7a3a;">'+fmtR(totalPago)+'</div><div style="font-size:11px;color:var(--muted);">Pago</div></div>' +
        '<div class="card" style="padding:12px;border-left:4px solid #1a6bb5;"><div style="font-size:22px;font-weight:700;color:#1a6bb5;">'+fmtR(totalAberto)+'</div><div style="font-size:11px;color:var(--muted);">Em aberto</div></div>' +
        '<div class="card" style="padding:12px;border-left:4px solid #EF4444;"><div style="font-size:22px;font-weight:700;color:#EF4444;">'+fmtR(totalVencido)+'</div><div style="font-size:11px;color:var(--muted);">Vencido</div></div>' +
        (totalPendente > 0 ? '<div class="card" style="padding:12px;border-left:4px solid #d4830a;"><div style="font-size:22px;font-weight:700;color:#d4830a;">'+fmtR(totalPendente)+'</div><div style="font-size:11px;color:var(--muted);">Aguardando aprovação</div></div>' : '') +
        '<div class="card" style="padding:12px;border-left:4px solid var(--border);"><div style="font-size:22px;font-weight:700;">'+fmtR(totalEmitido+totalPendente)+'</div><div style="font-size:11px;color:var(--muted);">Total geral</div></div>';

      var html = '';

      // ── Batch items pendentes (editáveis) ──
      if (batchItems.length) {
        html += '<div style="margin-bottom:24px;">';
        html += '<div style="font-size:14px;font-weight:700;margin-bottom:10px;color:#d4830a;">Aguardando Aprovação (editável)</div>';
        batchItems.forEach(function(bi) {
          var itensArr = Array.isArray(bi.itens) ? bi.itens : [];
          var venc = bi.vencimento ? new Date(bi.vencimento+'T12:00:00').toLocaleDateString('pt-BR') : '—';
          var canEdit = bi.status === 'aguardando';
          html += '<div class="card" style="padding:14px;margin-bottom:10px;border-left:4px solid #d4830a;">';
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
          html += '<div><strong>Lote '+esc(bi._batch_mes)+'</strong> · Venc: '+venc+'</div>';
          html += '<div style="font-size:18px;font-weight:700;" id="biTotal_'+bi.id+'">'+fmtR(parseFloat(bi.valor_total||0))+'</div>';
          html += '</div>';
          // Itens editáveis
          html += '<div id="biItens_'+bi.id+'">';
          itensArr.forEach(function(it, idx) {
            var catIcon = it.categoria === 'mensalidade' ? '📚' : it.categoria === 'alimentacao' ? '🍽️' : it.categoria === 'atividade_extra' ? '⚽' : '📋';
            html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">';
            html += '<span style="font-size:14px;">'+catIcon+'</span>';
            if (canEdit) {
              html += '<input type="text" value="'+esc(it.nome)+'" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;" onchange="alunoFinItemNomeChange(\''+bi.id+'\','+idx+',this.value)">';
              html += '<input type="number" value="'+(it.valor||0).toFixed(2)+'" step="0.01" min="0" style="width:110px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;text-align:right;" onchange="alunoFinItemValorChange(\''+bi.id+'\','+idx+',this.value)">';
              html += '<button onclick="alunoFinItemRemove(\''+bi.id+'\','+idx+')" style="background:none;border:none;cursor:pointer;font-size:14px;color:#EF4444;" title="Remover">✕</button>';
            } else {
              html += '<span style="flex:1;font-size:12px;">'+esc(it.nome)+'</span>';
              html += '<span style="font-weight:600;font-size:12px;">'+fmtR(it.valor||0)+'</span>';
            }
            html += '</div>';
          });
          html += '</div>';
          if (canEdit) {
            html += '<div style="display:flex;gap:8px;margin-top:8px;">';
            html += '<button onclick="alunoFinItemAdd(\''+bi.id+'\')" style="padding:4px 12px;font-size:11px;background:var(--bg);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-family:inherit;">+ Adicionar item</button>';
            html += '<button onclick="alunoFinSave(\''+bi.id+'\')" style="padding:4px 14px;font-size:11px;background:var(--blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:600;">Salvar alterações</button>';
            html += '</div>';
          }
          html += '</div>';
        });
        html += '</div>';
      }

      // ── Boletos emitidos ──
      if (bList.length) {
        bList.sort(function(x,y){ return (y.vencimento||'').localeCompare(x.vencimento||''); });
        html += '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="border-bottom:2px solid var(--border);"><th style="padding:8px;text-align:left;">Descrição</th><th style="padding:8px;text-align:center;">Vencimento</th><th style="padding:8px;text-align:right;">Valor</th><th style="padding:8px;text-align:center;">Status</th><th style="padding:8px;">Ações</th></tr></thead><tbody>';
        html += bList.map(function(b) {
          var venc = b.vencimento ? new Date(b.vencimento+'T12:00:00').toLocaleDateString('pt-BR') : '—';
          var isVencido = b.status === 'emitido' && b.vencimento < new Date().toISOString().slice(0,10);
          var isManual = b.baixa_manual === true;
          var badge, statusLabel;
          if (b.status === 'pago' && isManual) {
            badge = 'background:#e8eaf6;color:#5c6bc0;border:1px solid #c5cae9;';
            statusLabel = 'Pago (manual)';
          } else if (b.status === 'pago') {
            badge = 'background:#edf7f0;color:#2d7a3a;';
            statusLabel = 'Pago';
          } else if (b.status === 'cancelado') {
            badge = 'background:#f5f0ea;color:var(--muted);';
            statusLabel = 'Cancelado';
          } else if (isVencido) {
            badge = 'background:#fde8e8;color:#EF4444;';
            statusLabel = 'Vencido';
          } else {
            badge = 'background:#fff8e1;color:#b07d00;';
            statusLabel = 'Pendente';
          }
          // Info de baixa manual
          var manualInfo = '';
          if (isManual) {
            manualInfo = '<div style="font-size:10px;color:#5c6bc0;margin-top:2px;">Por: '+esc(b.baixa_manual_por||'—');
            if (b.baixa_manual_em) manualInfo += ' · '+new Date(b.baixa_manual_em).toLocaleString('pt-BR');
            if (b.baixa_manual_obs) manualInfo += '<br>Obs: '+esc(b.baixa_manual_obs);
            manualInfo += '</div>';
          }
          // Ações
          var acoesHtml = '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
          if (b.status === 'emitido') {
            acoesHtml += '<button onclick="alunoFinBaixaManual(\''+b.id+'\')" style="padding:3px 8px;font-size:10px;background:#5c6bc0;color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit;font-weight:600;">Marcar pago</button>';
            acoesHtml += '<button onclick="alunoFinCancelar(\''+b.id+'\')" style="padding:3px 8px;font-size:10px;background:#EF4444;color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit;">Cancelar</button>';
          }
          if (b.status !== 'cancelado') {
            acoesHtml += '<button onclick="alunoFinBaixarPdf(\''+b.id+'\')" style="padding:3px 8px;font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:5px;cursor:pointer;font-family:inherit;" title="Baixar PDF">📄 PDF</button>';
            acoesHtml += '<button onclick="alunoFinEnviarEmail(\''+b.id+'\',\''+esc(b.familia_email||'')+'\')" style="padding:3px 8px;font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:5px;cursor:pointer;font-family:inherit;" title="Enviar por email">📧</button>';
            acoesHtml += '<button onclick="alunoFinEnviarWhatsApp(\''+b.id+'\')" style="padding:3px 8px;font-size:10px;background:#25D366;color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit;" title="Enviar via WhatsApp">💬</button>';
          }
          if (b.pix_copia_cola) acoesHtml += '<button onclick="navigator.clipboard.writeText(\''+esc(b.pix_copia_cola)+'\');showToast(\'PIX copiado!\',\'success\')" style="padding:3px 8px;font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:5px;cursor:pointer;font-family:inherit;" title="Copiar PIX">📋 PIX</button>';
          acoesHtml += '</div>';
          return '<tr style="border-bottom:1px solid #f0ece6;'+(isManual?'background:#f5f5ff;':'')+'"><td style="padding:8px;">'+esc(b.descricao||b.crianca_nome||'—')+'</td><td style="padding:8px;text-align:center;">'+venc+'</td><td style="padding:8px;text-align:right;font-weight:700;">'+fmtR(parseFloat(b.valor||0))+'</td><td style="padding:8px;text-align:center;"><span style="font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;'+badge+'">'+statusLabel+'</span>'+manualInfo+'</td><td style="padding:8px;">'+acoesHtml+'</td></tr>';
        }).join('');
        html += '</tbody></table>';
      }

      if (!bList.length && !batchItems.length) {
        html = '<div style="padding:20px;text-align:center;color:var(--muted);">Nenhuma cobrança registrada para este aluno.</div>';
      }
      listaEl.innerHTML = html;

      // Guarda batch items para edição inline
      // Cache boletos para WhatsApp (dados sem escaping)
      bList.forEach(function(b) { _cacheBoleto(b); });
      window._alunoFinBatchItems = {};
      batchItems.forEach(function(bi) {
        window._alunoFinBatchItems[bi.id] = JSON.parse(JSON.stringify(bi.itens || []));
      });
      // Carrega ajustes recorrentes
      loadAlunoFinAjustes(a);
    } catch(e) { console.error('[fin]',e); listaEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">Erro ao carregar dados financeiros.</div>'; }
  }

  // ── Edição inline dos itens do batch ──
  function _alunoFinRecalcTotal(biId) {
    var itens = window._alunoFinBatchItems[biId] || [];
    var total = itens.reduce(function(s,it){ return s + (parseFloat(it.valor)||0); }, 0);
    var el = document.getElementById('biTotal_'+biId);
    if (el) el.textContent = 'R$ ' + total.toLocaleString('pt-BR',{minimumFractionDigits:2});
  }
  function alunoFinItemValorChange(biId, idx, val) {
    if (!window._alunoFinBatchItems[biId]) return;
    window._alunoFinBatchItems[biId][idx].valor = parseFloat(val) || 0;
    _alunoFinRecalcTotal(biId);
  }
  function alunoFinItemNomeChange(biId, idx, val) {
    if (!window._alunoFinBatchItems[biId]) return;
    window._alunoFinBatchItems[biId][idx].nome = val;
  }
  function alunoFinItemRemove(biId, idx) {
    if (!window._alunoFinBatchItems[biId]) return;
    window._alunoFinBatchItems[biId].splice(idx, 1);
    // Re-render items
    if (_alunoFinAtual) loadAlunoFinanceiro(_alunoFinAtual);
  }
  function alunoFinItemAdd(biId) {
    if (!window._alunoFinBatchItems[biId]) window._alunoFinBatchItems[biId] = [];
    window._alunoFinBatchItems[biId].push({ nome: 'Novo item', valor: 0, categoria: 'extra' });
    if (_alunoFinAtual) loadAlunoFinanceiro(_alunoFinAtual);
  }
  async function alunoFinSave(biId) {
    var itens = window._alunoFinBatchItems[biId] || [];
    var total = Math.round(itens.reduce(function(s,it){ return s + (parseFloat(it.valor)||0); }, 0) * 100) / 100;
    var desc = itens.map(function(it){ return it.nome + ': R$' + (it.valor||0).toFixed(2); }).join(' | ');
    var d = await apiFinExt({ action: 'boletos_batch_item_edit', id: biId, valor_total: total, itens: itens, descricao_detalhada: desc });
    if (d && d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast('Cobrança atualizada! Total: R$ ' + total.toLocaleString('pt-BR',{minimumFractionDigits:2}), 'success');
    if (_alunoFinAtual) loadAlunoFinanceiro(_alunoFinAtual);
  }

  // ── Ações de boleto ──
  async function alunoFinCancelar(boletoId) {
    if (!confirm('Cancelar este boleto? Isto também cancela no Banco Inter (se aplicável). Esta ação não pode ser desfeita.')) return;
    showToast('Cancelando...', 'info');
    var d = await api({ action: 'fin_boleto_cancelar', id: boletoId });
    if (d && d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast('Boleto cancelado.', 'success');
    if (_alunoFinAtual) loadAlunoFinanceiro(_alunoFinAtual);
    loadFinBoletos(); loadFinMensalidades(); if(_finMensCurrentTab==='boletos') loadFinMensBoletos();
  }

  async function alunoFinBaixarPdf(boletoId) {
    showToast('Baixando PDF do Inter...', 'info');
    var d = await api({ action: 'fin_boleto_pdf', id: boletoId });
    if (d && d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    if (!d.pdf_base64) { showToast('PDF não disponível.', 'error'); return; }
    // Download
    var byteChars = atob(d.pdf_base64);
    var byteNums = new Array(byteChars.length);
    for (var i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
    var blob = new Blob([new Uint8Array(byteNums)], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'boleto_' + (d.nosso_numero || 'lumied') + '.pdf';
    a.click();
    URL.revokeObjectURL(url);
    showToast('PDF baixado!', 'success');
  }

  async function alunoFinEnviarEmail(boletoId, emailPadrao) {
    var email = prompt('Enviar boleto por email para:', emailPadrao || '');
    if (!email) return;
    showToast('Enviando...', 'info');
    var d = await api({ action: 'fin_boleto_enviar_email', id: boletoId, email_destino: email });
    if (d && d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast('Email enviado para ' + (d.enviado_para || email), 'success');
  }

  // Cache de dados de boletos para WhatsApp (evita problemas de escaping no onclick)
  window._boletosCache = {};
  function _cacheBoleto(b) {
    window._boletosCache[b.id] = b;
  }
  async function alunoFinEnviarWhatsApp(boletoId) {
    var b = window._boletosCache[boletoId] || {};
    var criancaNome = b.crianca_nome || b.familia_nome || '';
    var valor = parseFloat(b.valor || 0);
    var vencimento = b.vencimento || '';
    var linhaDigitavel = b.linha_digitavel || '';
    var pixCopiaECola = b.pix_copia_cola || '';
    var venc = vencimento ? new Date(vencimento + 'T12:00:00').toLocaleDateString('pt-BR') : '';
    var fmtValor = 'R$ ' + valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    // Busca link do PDF
    showToast('Gerando link do PDF...', 'info');
    var pdfUrl = '';
    try {
      var d = await api({ action: 'fin_boleto_pdf_link', id: boletoId });
      if (d && d.pdf_url) pdfUrl = d.pdf_url;
    } catch(e) { /* segue sem PDF */ }
    var lines = [];
    lines.push('Ola! Segue o boleto referente a *' + criancaNome + '*:');
    lines.push('');
    lines.push('Valor: *' + fmtValor + '*');
    lines.push('Vencimento: *' + venc + '*');
    if (pdfUrl) { lines.push(''); lines.push('Boleto PDF: ' + pdfUrl); }
    if (linhaDigitavel) { lines.push(''); lines.push('Linha Digitavel:'); lines.push(linhaDigitavel); }
    if (pixCopiaECola) { lines.push(''); lines.push('PIX Copia e Cola:'); lines.push(pixCopiaECola); }
    lines.push('');
    lines.push('_Enviado via Lumied_');
    var msg = lines.join('\n');
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }

  async function alunoFinBaixaManual(boletoId) {
    var obs = prompt('Observação da baixa manual (opcional):\nEx: Pago via depósito, comprovante recebido');
    if (obs === null) return; // cancelou
    if (!confirm('Confirma a baixa manual deste boleto?\nIsto marcará como PAGO e ficará registrado quem fez a baixa.')) return;
    var d = await api({ action: 'fin_boleto_baixa_manual', id: boletoId, observacao: obs || '' });
    if (d && d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast('Baixa manual registrada por ' + (d.baixa_manual_por || 'você'), 'success');
    if (_alunoFinAtual) loadAlunoFinanceiro(_alunoFinAtual);
    loadFinBoletos(); loadFinMensalidades(); if(_finMensCurrentTab==='boletos') loadFinMensBoletos();
  }

  // ── Ajustes inline na ficha do aluno ──
  async function loadAlunoFinAjustes(a) {
    var el = document.getElementById('alunoFinAjustes');
    var d = await apiFinExt({ action:'fin_ajustes_list', aluno_id: a.id });
    var list = (Array.isArray(d) ? d : (d?.data || [])).filter(function(aj){ return aj.ativo; });
    if (!list.length) { el.innerHTML = ''; return; }
    var fmtR = function(v){ return 'R$ '+parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:2}); };
    el.innerHTML = '<div style="font-size:12px;font-weight:700;margin-bottom:6px;color:#d4830a;">Ajustes recorrentes ativos</div>' +
      list.map(function(aj) {
        var icon = aj.tipo.startsWith('desconto') ? '🔻' : '🔺';
        var valorStr = aj.tipo === 'desconto_percentual' ? aj.valor+'%' : fmtR(aj.valor);
        var vigencia = aj.data_fim ? ' · até '+new Date(aj.data_fim+'T12:00:00').toLocaleDateString('pt-BR') : '';
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#fef3cd;border-radius:6px;margin-bottom:4px;font-size:12px;">' +
          '<span>'+icon+'</span><span style="flex:1;">'+esc(aj.descricao)+' <span style="color:var(--muted);">('+esc(aj.categoria_aplicacao)+vigencia+')</span></span>' +
          '<strong>'+(aj.tipo.startsWith('desconto')?'-':'+')+valorStr+'</strong>' +
          '<button onclick="desativarAjuste(\''+aj.id+'\');setTimeout(function(){loadAlunoFinAjustes(alunoAtual)},500)" style="background:none;border:none;cursor:pointer;font-size:11px;color:#EF4444;" title="Pausar">⏸</button>' +
          '</div>';
      }).join('');
  }

  function alunoFinNovoAjuste() {
    if (!alunoAtual) return;
    document.getElementById('afAjNomeAluno').textContent = alunoAtual.nome;
    document.getElementById('afAjValor').value = '';
    document.getElementById('afAjDesc').value = '';
    document.getElementById('afAjFim').value = '';
    document.getElementById('alunoFinNovoAjusteForm').style.display = 'block';
  }

  async function alunoFinSalvarAjuste() {
    if (!alunoAtual) return;
    var tipo = document.getElementById('afAjTipo').value;
    var valor = document.getElementById('afAjValor').value;
    var desc = document.getElementById('afAjDesc').value.trim();
    var cat = document.getElementById('afAjCat').value;
    var dataFim = document.getElementById('afAjFim').value || null;
    if (!valor || !desc) { showToast('Preencha valor e descrição.','error'); return; }
    var d = await apiFinExt({ action:'fin_ajuste_create', aluno_id:alunoAtual.id, aluno_nome:alunoAtual.nome, tipo:tipo, valor:valor, descricao:desc, categoria_aplicacao:cat, data_fim:dataFim });
    if (d && d.error) { showToast('Erro: '+d.error,'error'); return; }
    showToast('Ajuste criado para '+alunoAtual.nome,'success');
    document.getElementById('alunoFinNovoAjusteForm').style.display = 'none';
    loadAlunoFinAjustes(alunoAtual);
  }

  async function loadAlunoAtas(a) {
    const el = document.getElementById('alunoDetAtas');
    el.innerHTML = '<span style="color:var(--muted);">Carregando...</span>';
    try {
      const d = await api({ action: 'aluno_historico_list', aluno_nome: a.nome, aluno_email: a.email });
      const atas = Array.isArray(d) ? d : (d.data || []);
      if (!atas.length) { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">Nenhuma ata registrada.</div>'; return; }
      const tipoIcons = { ata_ocorrencia: '⚠️', acompanhamento_pedagogico: '📝', reuniao_responsaveis: '🤝', encaminhamento: '🏥', observacao: '💬', documento_whatsapp: '📱' };
      const tipoLabels = { ata_ocorrencia: 'Ocorrência', acompanhamento_pedagogico: 'Acompanhamento', reuniao_responsaveis: 'Reunião c/ Responsáveis', encaminhamento: 'Encaminhamento', observacao: 'Observação', documento_whatsapp: 'Doc WhatsApp' };
      el.innerHTML = atas.map(at => `<div style="border-left:3px solid ${at.tipo === 'ata_ocorrencia' ? 'var(--red)' : at.tipo === 'reuniao_responsaveis' ? 'var(--blue)' : 'var(--green)'};padding:12px 16px;margin-bottom:12px;background:var(--bg);border-radius:0 8px 8px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:13px;font-weight:700;">${tipoIcons[at.tipo] || '📋'} ${esc(at.titulo)}</span>
          <span style="font-size:11px;color:var(--muted);">${at.criado_em ? new Date(at.criado_em).toLocaleDateString('pt-BR') : ''}</span>
        </div>
        <div style="font-size:12px;color:var(--text);line-height:1.6;">${esc(at.descricao || '')}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:6px;">Por: ${esc(at.registrado_por || '—')} ${at.arquivo_url ? `· <a href="${esc(at.arquivo_url)}" target="_blank" style="color:var(--blue);">📎 Anexo</a>` : ''}</div>
      </div>`).join('');
    } catch { el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">Erro ao carregar atas.</div>'; }
  }

  async function loadAlunoIaResumo(email) {
    const card = document.getElementById('alunoIaResumo');
    card.style.display = 'block';
    document.getElementById('iaResumoText').innerHTML = '<span class="spinner-sm"></span> Analisando...';
    document.getElementById('iaResumoTime').textContent = '';
    try {
      const d = await api({ action: 'aluno_resumo_ia', aluno_email: email });
      if (d.resumo) {
        document.getElementById('iaResumoText').textContent = d.resumo;
        document.getElementById('iaResumoTime').textContent = 'Gerado: ' + new Date(d.gerado_em).toLocaleString('pt-BR');
      } else {
        card.style.display = 'none';
      }
    } catch { card.style.display = 'none'; }
  }

  async function alunoNovaAta() {
    if (!alunoAtual) return;
    let overlay = document.getElementById('ataModal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'ataModal';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div style="background:#fff;border-radius:12px;padding:24px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2);">
      <h3 style="font-size:16px;font-weight:700;margin-bottom:16px;">Nova Ata — ${esc(alunoAtual.nome)}</h3>
      <div style="margin-bottom:12px;"><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:4px;">Tipo</label>
        <select id="ataTipo" style="width:100%;padding:9px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;">
          <option value="ata_ocorrencia">Ata de Ocorrência</option>
          <option value="acompanhamento_pedagogico">Acompanhamento Pedagógico</option>
          <option value="reuniao_responsaveis">Reunião com Responsáveis</option>
          <option value="encaminhamento">Encaminhamento</option>
          <option value="observacao">Observação</option>
        </select></div>
      <div style="margin-bottom:12px;"><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:4px;">Título</label>
        <input type="text" id="ataTitulo" placeholder="Resumo da ata..." style="width:100%;padding:9px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;"></div>
      <div style="margin-bottom:16px;"><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:4px;">Descrição</label>
        <textarea id="ataDesc" rows="4" placeholder="Detalhes..." style="width:100%;padding:9px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;resize:vertical;"></textarea></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="document.getElementById('ataModal').style.display='none'" style="padding:10px 20px;background:#f5f5f5;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;">Cancelar</button>
        <button onclick="salvarAta()" style="padding:10px 20px;background:var(--green);color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;">Salvar</button>
      </div>
    </div>`;
    overlay.style.display = 'flex';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
  }

  async function salvarAta() {
    if (!alunoAtual) return;
    const tipo = document.getElementById('ataTipo').value;
    const titulo = document.getElementById('ataTitulo').value.trim();
    const descricao = document.getElementById('ataDesc').value.trim();
    if (!titulo) return showToast('Título obrigatório', 'error');
    const d = await api({ action: 'aluno_historico_create', aluno_nome: alunoAtual.nome, aluno_email: alunoAtual.email, turma: alunoAtual.serie || alunoAtual.turma || '', tipo, titulo, descricao });
    if (d.error) return showToast(d.error, 'error');
    showToast('Ata registrada!', 'success');
    document.getElementById('ataModal').style.display = 'none';
    loadAlunoAtas(alunoAtual);
  }

  async function abrirCadastroAluno() {
    const nome = prompt('Nome completo do aluno:'); if (!nome) return;
    const email = prompt('Email do aluno (opcional):') || '';
    const serie = prompt('Série/Turma:') || '';
    const nascimento = prompt('Data de nascimento (DD/MM/AAAA):') || '';
    const responsavel = prompt('Nome do responsável:') || '';
    let dataFmt = null;
    if (nascimento) {
      const [d, m, y] = nascimento.split('/');
      if (d && m && y) dataFmt = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    const d = await api({ action:'aluno_criar', nome, email, serie, data_nascimento:dataFmt, responsavel_nome:responsavel });
    if (d.error) return showToast(d.error, 'error');
    showToast('Aluno cadastrado!', 'success');
    loadAlunos();
  }

