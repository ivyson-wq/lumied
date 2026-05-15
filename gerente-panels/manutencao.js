// Auto-extraído do gerente.html (Onda 4 do refator, segunda passada).
// Manutenção: painel + CONFIG EQUIPES + RELATÓRIO. Chamado de panel switcher
// (loadManutPanel) e onclick handlers no HTML. Funções globais.
  // ── MANUTENÇÃO ──────────────────────────────────────────
  var manutData = [], manutFilter = 'todos';
  var URGENCIA_LABEL = { baixa:'🟢 Baixa', media:'🟡 Média', alta:'🟠 Alta', critica:'🔴 Crítica' };
  // ═══ MANUTENÇÃO ═══
  var MANUT_STATUS = { pendente:'⏳ Pendente', aprovada:'✅ Aprovada', em_execucao:'🔧 Em Execução', concluida:'✅ Concluída', rejeitada:'❌ Rejeitada' };
  var EQUIPES = [];
  var relatorioEquipesSel = new Set();

  async function loadManutEquipes() {
    const d = await api({ action:'manut_equipes_list' });
    EQUIPES = Array.isArray(d) ? d.map(e => e.nome) : [];
  }

  async function loadManutPanel() {
    if (!EQUIPES.length) await loadManutEquipes();
    const d = await api({ action:'manutencao_list' });
    manutData = Array.isArray(d) ? d : (d.data || []);
    updateManutStats();
    renderManutTable();
  }
  function updateManutStats() {
    document.getElementById('manutPend').textContent = manutData.filter(m => m.status === 'pendente').length;
    document.getElementById('manutExec').textContent = manutData.filter(m => m.status === 'em_execucao').length;
    const now = new Date(), y = now.getFullYear(), mo = now.getMonth();
    document.getElementById('manutDone').textContent = manutData.filter(m => m.status === 'concluida' && m.data_conclusao && new Date(m.data_conclusao).getMonth() === mo && new Date(m.data_conclusao).getFullYear() === y).length;
    document.getElementById('manutCrit').textContent = manutData.filter(m => m.urgencia === 'critica' && m.status !== 'concluida' && m.status !== 'rejeitada').length;
  }
  function setManutFilter(f, btn) {
    manutFilter = f;
    document.querySelectorAll('#panelManutencao .filter-bar .fb').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderManutTable();
  }
  function renderManutTable() {
    let list = manutData;
    if (manutFilter === 'critica') list = list.filter(m => m.urgencia === 'critica' && m.status !== 'concluida');
    else if (manutFilter !== 'todos') list = list.filter(m => m.status === manutFilter);
    document.getElementById('manutCount').textContent = list.length;
    const tb = document.getElementById('manutBody');
    if (!list.length) { tb.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum chamado encontrado.</td></tr>'; return; }
    tb.innerHTML = list.map(m => {
      const user = m.usuarios || {};
      const data = new Date(m.criado_em).toLocaleDateString('pt-BR');
      const cr = m.compras_resumo;
      const matBadge = cr ? (() => {
        const pend = cr.pendente || 0, comp = cr.comprado || 0, ent = cr.entregue || 0;
        if (pend + comp + ent === 0) return '';
        if (ent && !pend && !comp) return '<span title="Todos materiais entregues" style="font-size:10px;background:#dcfce7;color:#166534;padding:2px 7px;border-radius:10px;font-weight:600;margin-left:6px;">📦 ✓</span>';
        const txt = [pend && (pend + ' a comprar'), comp && (comp + ' comprado'), ent && (ent + ' entregue')].filter(Boolean).join(' · ');
        return `<span title="${txt}" style="font-size:10px;background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:10px;font-weight:600;margin-left:6px;">📦 ${pend + comp + ent}</span>`;
      })() : '';
      return `<tr>
        <td><span style="font-size:12px;font-weight:600;">${URGENCIA_LABEL[m.urgencia]||m.urgencia}</span></td>
        <td style="max-width:200px;"><strong style="font-size:12px;">${esc(m.descricao?.substring(0,80))}</strong>${m.foto_url ? ' <a href="'+esc(m.foto_url)+'" target="_blank" style="font-size:11px;color:var(--blue);">📎 foto</a>' : ''}${matBadge}</td>
        <td style="font-size:12px;">${esc(m.localizacao)}</td>
        <td style="font-size:12px;">${esc(user.nome||'—')}<br><small style="color:var(--muted);">${esc(user.email||'')}</small></td>
        <td style="font-size:12px;">${esc(m.equipe_responsavel||'—')}</td>
        <td><span class="status-pill ${m.status}">${MANUT_STATUS[m.status]||m.status}</span></td>
        <td style="font-size:12px;color:var(--muted);">${data}</td>
        <td style="white-space:nowrap;">
          <button class="action-btn" onclick="openManutModal('${m.id}')">✎</button>
          <button class="action-btn del" onclick="deleteManut('${m.id}')">🗑</button>
        </td>
      </tr>`;
    }).join('');
  }
  function openManutModal(id) {
    const m = manutData.find(x => x.id === id);
    if (!m) return;
    document.getElementById('manutModalTitle').textContent = 'Chamado #' + id.substring(0,8);
    const equipesOpts = EQUIPES.map(e => `<option value="${e}" ${m.equipe_responsavel===e?'selected':''}>${e}</option>`).join('');
    document.getElementById('manutModalContent').innerHTML = `
      <div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Descrição</div>
        <div style="font-size:13px;background:#f5f0ea;padding:10px 12px;border-radius:8px;">${esc(m.descricao)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div>
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Local</div>
          <div style="font-size:13px;">${esc(m.localizacao)}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Urgência</div>
          <div style="font-size:13px;">${URGENCIA_LABEL[m.urgencia]}</div>
        </div>
      </div>
      ${m.foto_url ? `<div style="margin-bottom:12px;"><a href="${esc(m.foto_url)}" target="_blank"><img src="${esc(m.foto_url)}" style="max-width:100%;max-height:200px;border-radius:8px;border:1px solid var(--border);"></a></div>` : ''}
      <div class="ff"><label>Encaminhar para equipe</label>
        <select id="manutEquipe" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:'DM Sans',sans-serif;">
          <option value="">— selecione —</option>${equipesOpts}
        </select>
      </div>
      <div class="ff"><label>Observação</label>
        <textarea id="manutObs" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:'DM Sans',sans-serif;min-height:60px;resize:vertical;">${esc(m.observacao_gerente||'')}</textarea>
      </div>
      ${m.pergunta_coordenacao ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;">
        <div style="font-weight:600;color:#9a3412;margin-bottom:4px;">❓ Pergunta enviada${m.pergunta_em ? ' em ' + new Date(m.pergunta_em).toLocaleString('pt-BR') : ''}${m.pergunta_por ? ' por ' + esc(m.pergunta_por) : ''}</div>
        <div style="color:#7c2d12;">${esc(m.pergunta_coordenacao)}</div>
        ${m.pergunta_resposta ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #fed7aa;"><span style="font-weight:600;color:#166534;">Resposta:</span> ${esc(m.pergunta_resposta)}</div>` : '<div style="margin-top:6px;font-size:11px;color:#9a3412;font-style:italic;">Aguardando resposta do solicitante.</div>'}
      </div>` : ''}
      <div id="manutMaterialBox" style="margin:14px 0;padding:10px 12px;background:#fafaf8;border:1px solid #e5e1da;border-radius:8px;">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);margin-bottom:6px;">📦 Material vinculado</div>
        <div id="manutMaterialList" style="font-size:12px;color:var(--muted);">Carregando...</div>
        <button class="btn-aprovar" style="background:#0ea5e9;margin-top:8px;font-size:12px;padding:6px 12px;" onclick="abrirManutMaterial('${id}')">📦 Solicitar material</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-aprovar" onclick="updateManutStatus('${id}','em_execucao')">🔧 Iniciar Execução</button>
        <button class="btn-aprovar" style="background:var(--green);" onclick="updateManutStatus('${id}','concluida')">✅ Concluir</button>
        <button class="btn-aprovar" style="background:#d97706;" onclick="abrirManutDuvida('${id}')">❓ Tirar dúvida</button>
        <button class="btn-rejeitar" onclick="updateManutStatus('${id}','rejeitada')">✕ Rejeitar</button>
      </div>
    `;
    document.getElementById('manutModalOverlay').classList.add('show');
    loadManutMaterialBox(id);
  }
  async function loadManutMaterialBox(id) {
    const el = document.getElementById('manutMaterialList');
    if (!el) return;
    const d = await api({ action: 'manutencao_compras_list', id });
    const items = (d && d.data) || [];
    if (!items.length) { el.innerHTML = '<em>Nenhum material solicitado para este chamado.</em>'; return; }
    const statusLabel = { pendente:'⏳ A comprar', comprado:'🛒 Comprado', entregue:'📦 Entregue', cancelado:'✕ Cancelado' };
    el.innerHTML = items.map(c => {
      const preco = c.preco_total != null ? ('R$ ' + Number(c.preco_total).toFixed(2)) : '—';
      const aprov = c.aprovado_financeiro === null ? ' <span style="font-size:10px;color:#92400e;background:#fef3c7;padding:1px 6px;border-radius:8px;">⏳ aprov. financeira</span>' : c.aprovado_financeiro === false ? ' <span style="font-size:10px;color:#991b1b;background:#fee2e2;padding:1px 6px;border-radius:8px;">✕ rejeitado fin.</span>' : '';
      return `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #f0ece6;">
        <span><strong>${esc(c.insumo_nome)}</strong> × ${c.qty}${c.url_produto ? ' <a href="'+esc(c.url_produto)+'" target="_blank" style="color:var(--blue);font-size:11px;">link</a>' : ''}${aprov}</span>
        <span style="color:var(--muted);font-size:11px;white-space:nowrap;">${statusLabel[c.status]||c.status} · ${preco}</span>
      </div>`;
    }).join('');
  }
  // ── Modal SOLICITAR MATERIAL ──────────────────────────────
  var manutMaterialChamadoId = null;
  var manutMaterialItens = [];
  function abrirManutMaterial(id) {
    manutMaterialChamadoId = id;
    manutMaterialItens = [];
    const overlay = document.getElementById('manutMaterialOverlay') || criarManutMaterialOverlay();
    overlay.classList.add('show');
    renderManutMaterialItens();
  }
  function fecharManutMaterial() {
    const el = document.getElementById('manutMaterialOverlay');
    if (el) el.classList.remove('show');
  }
  function criarManutMaterialOverlay() {
    const div = document.createElement('div');
    div.id = 'manutMaterialOverlay';
    div.className = 'modal-overlay';
    div.innerHTML = `<div class="modal-content" style="max-width:640px;">
      <div class="modal-header">
        <h3>📦 Solicitar material — manutenção</h3>
        <button class="modal-close" onclick="fecharManutMaterial()">×</button>
      </div>
      <div class="modal-body">
        <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Cada item vira uma linha em <strong>Almoxarifado → Compras</strong>. Itens com preço total ≥ teto exigem aprovação do financeiro antes da compra.</div>
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;align-items:end;margin-bottom:8px;">
          <div><label style="font-size:11px;color:var(--muted);">Item</label><input id="mmItemNome" type="text" placeholder="Ex: Torneira monocomando" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;"></div>
          <div><label style="font-size:11px;color:var(--muted);">Qtd</label><input id="mmItemQty" type="number" value="1" min="1" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;"></div>
          <div><label style="font-size:11px;color:var(--muted);">Preço unit. (R$)</label><input id="mmItemPreco" type="number" step="0.01" placeholder="opcional" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;"></div>
          <div><button class="btn-aprovar" style="width:100%;font-size:12px;padding:8px;" onclick="adicionarManutMaterialItem()">+ Adicionar</button></div>
        </div>
        <div style="display:grid;grid-template-columns:2fr 2fr 1fr;gap:8px;margin-bottom:14px;">
          <div><label style="font-size:11px;color:var(--muted);">Fornecedor/Plataforma</label><input id="mmItemPlat" type="text" placeholder="Ex: Mercado Livre, loja local" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;"></div>
          <div><label style="font-size:11px;color:var(--muted);">Link/URL (opcional)</label><input id="mmItemUrl" type="url" placeholder="https://..." style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;"></div>
          <div><label style="font-size:11px;color:var(--muted);">Nota</label><input id="mmItemNota" type="text" placeholder="opcional" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;"></div>
        </div>
        <div id="mmListaItens" style="border-top:1px solid var(--border);padding-top:10px;min-height:60px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
          <button class="btn-rejeitar" onclick="fecharManutMaterial()">Cancelar</button>
          <button class="btn-aprovar" onclick="enviarManutMaterial()">✓ Enviar para compras</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(div);
    return div;
  }
  function adicionarManutMaterialItem() {
    const nome = document.getElementById('mmItemNome').value.trim();
    if (!nome) { showToast('Informe o nome do item.', 'error'); return; }
    const qty = Number(document.getElementById('mmItemQty').value) || 1;
    const precoStr = document.getElementById('mmItemPreco').value.trim();
    const preco = precoStr ? Number(precoStr) : null;
    manutMaterialItens.push({
      insumo_nome: nome, qty,
      preco_unit: (preco != null && !isNaN(preco)) ? preco : null,
      plataforma: document.getElementById('mmItemPlat').value.trim() || '—',
      url_produto: document.getElementById('mmItemUrl').value.trim() || null,
      nota: document.getElementById('mmItemNota').value.trim() || null,
    });
    document.getElementById('mmItemNome').value = '';
    document.getElementById('mmItemQty').value = '1';
    document.getElementById('mmItemPreco').value = '';
    document.getElementById('mmItemNota').value = '';
    renderManutMaterialItens();
    document.getElementById('mmItemNome').focus();
  }
  function removerManutMaterialItem(i) { manutMaterialItens.splice(i, 1); renderManutMaterialItens(); }
  function renderManutMaterialItens() {
    const el = document.getElementById('mmListaItens');
    if (!manutMaterialItens.length) { el.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:14px;">Nenhum item adicionado ainda.</div>'; return; }
    const total = manutMaterialItens.reduce((s, it) => s + (it.preco_unit != null ? it.preco_unit * it.qty : 0), 0);
    el.innerHTML = manutMaterialItens.map((it, i) => {
      const sub = it.preco_unit != null ? ('R$ ' + (it.preco_unit * it.qty).toFixed(2)) : '<em style="color:var(--muted);">sem preço</em>';
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0ece6;font-size:13px;">
        <span><strong>${esc(it.insumo_nome)}</strong> × ${it.qty} <small style="color:var(--muted);">${esc(it.plataforma||'')}</small></span>
        <span style="display:flex;gap:8px;align-items:center;">${sub}<button onclick="removerManutMaterialItem(${i})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;">🗑</button></span>
      </div>`;
    }).join('') + `<div style="text-align:right;font-weight:600;padding:8px 0;font-size:13px;">Total estimado: R$ ${total.toFixed(2)}</div>`;
  }
  async function enviarManutMaterial() {
    if (!manutMaterialItens.length) { showToast('Adicione ao menos um item.', 'error'); return; }
    const d = await api({ action: 'manutencao_solicitar_material', id: manutMaterialChamadoId, itens: manutMaterialItens });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    const aviso = d.criados > 0 ? `${d.criados} item(ns) enviado(s) ao almoxarifado.` : 'Solicitação enviada.';
    showToast(aviso, 'success');
    fecharManutMaterial();
    if (manutMaterialChamadoId) loadManutMaterialBox(manutMaterialChamadoId);
    loadManutPanel();
  }
  function closeManutModal() { document.getElementById('manutModalOverlay').classList.remove('show'); }
  async function updateManutStatus(id, status) {
    const equipe = document.getElementById('manutEquipe')?.value || undefined;
    const obs = document.getElementById('manutObs')?.value?.trim() || undefined;
    const d = await api({ action:'manutencao_update_status', id, status, equipe_responsavel: equipe, observacao_gerente: obs });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast('Status atualizado!', 'success');
    closeManutModal();
    loadManutPanel();
  }
  async function deleteManut(id) {
    if (!await _lumiedConfirm('Remover este chamado?')) return;
    const d = await api({ action:'manutencao_delete', id });
    if (d.error) { showToast(d.error, 'error'); return; }
    loadManutPanel();
  }
  async function abrirManutDuvida(id) {
    const pergunta = window.prompt('Qual a dúvida sobre este chamado?\n(O solicitante recebe uma notificação com sua pergunta.)');
    if (!pergunta || !pergunta.trim()) return;
    const d = await api({ action: 'manutencao_tirar_duvida', id, pergunta: pergunta.trim() });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast('Pergunta enviada ao solicitante.', 'success');
    closeManutModal();
    loadManutPanel();
  }

  // ── CONFIG EQUIPES MANUTENÇÃO ────────────────────────
  function toggleManutEquipesConfig() {
    const el = document.getElementById('manutEquipesConfig');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
    if (el.style.display === 'block') renderManutEquipesConfig();
  }
  async function renderManutEquipesConfig() {
    const d = await api({ action: 'manut_equipes_list_all' });
    const equipes = Array.isArray(d) ? d : [];
    const el = document.getElementById('manutEquipesList');
    el.innerHTML = equipes.map(e => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f5f0ea;">
      <span style="flex:1;font-size:13px;${e.ativo?'':'opacity:.5;text-decoration:line-through;'}">${esc(e.nome)}</span>
      <button onclick="toggleManutEquipe('${e.id}',${!e.ativo})" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">${e.ativo?'Desativar':'Ativar'}</button>
    </div>`).join('');
  }
  async function toggleManutEquipe(id, ativo) {
    await api({ action: 'manut_equipe_toggle', id, ativo });
    await loadManutEquipes();
    renderManutEquipesConfig();
  }
  async function addManutEquipe() {
    const nome = document.getElementById('manutNovaEquipe').value.trim();
    if (!nome) return;
    const d = await api({ action: 'manut_equipe_save', nome });
    if (d.error) { showToast(d.error, 'error'); return; }
    document.getElementById('manutNovaEquipe').value = '';
    await loadManutEquipes();
    renderManutEquipesConfig();
  }

  // ── RELATÓRIO MANUTENÇÃO ───────────────────────────
  function openManutRelatorio() {
    relatorioEquipesSel = new Set([...EQUIPES, 'Sem equipe']);
    renderRelatorioFiltros();
    renderRelatorioConteudo();
    document.getElementById('manutRelatorioOverlay').classList.add('show');
  }
  function closeManutRelatorio() { document.getElementById('manutRelatorioOverlay').classList.remove('show'); }

  function renderRelatorioFiltros() {
    const todas = [...EQUIPES, 'Sem equipe'];
    document.getElementById('relatorioEquipesFiltro').innerHTML = todas.map(e => {
      const sel = relatorioEquipesSel.has(e);
      return `<button onclick="toggleRelatorioEquipe('${esc(e)}')" style="padding:5px 12px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;border:1.5px solid ${sel?'var(--red)':'var(--border)'};background:${sel?'rgba(200,16,46,.08)':'#fff'};color:${sel?'var(--red)':'var(--muted)'};">${esc(e)}</button>`;
    }).join('');
  }
  function toggleRelatorioEquipe(e) {
    if (relatorioEquipesSel.has(e)) relatorioEquipesSel.delete(e);
    else relatorioEquipesSel.add(e);
    renderRelatorioFiltros();
    renderRelatorioConteudo();
  }

  function renderRelatorioConteudo() {
    const pendentes = manutData.filter(m => m.status !== 'concluida' && m.status !== 'rejeitada');
    const agrupado = {};
    for (const m of pendentes) {
      const eq = m.equipe_responsavel || 'Sem equipe';
      if (!relatorioEquipesSel.has(eq)) continue;
      if (!agrupado[eq]) agrupado[eq] = [];
      agrupado[eq].push(m);
    }
    const el = document.getElementById('relatorioConteudo');
    if (!Object.keys(agrupado).length) {
      el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px;">Nenhum chamado pendente para as equipes selecionadas.</div>';
      return;
    }
    el.innerHTML = Object.entries(agrupado).map(([eq, items]) => `
      <div style="margin-bottom:20px;">
        <div style="font-size:14px;font-weight:700;padding:8px 12px;background:#f5f0ea;border-radius:8px;margin-bottom:8px;">${esc(eq)} <span style="font-weight:400;color:var(--muted);font-size:12px;">(${items.length} pendência${items.length>1?'s':''})</span></div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="border-bottom:1.5px solid var(--border);">
            <th style="text-align:left;padding:6px 8px;color:var(--muted);font-size:10px;text-transform:uppercase;">Urg.</th>
            <th style="text-align:left;padding:6px 8px;color:var(--muted);font-size:10px;text-transform:uppercase;">Descrição</th>
            <th style="text-align:left;padding:6px 8px;color:var(--muted);font-size:10px;text-transform:uppercase;">Local</th>
            <th style="text-align:left;padding:6px 8px;color:var(--muted);font-size:10px;text-transform:uppercase;">Status</th>
            <th style="text-align:left;padding:6px 8px;color:var(--muted);font-size:10px;text-transform:uppercase;">Data</th>
          </tr></thead>
          <tbody>${items.map(m => `<tr style="border-bottom:1px solid #f5f0ea;">
            <td style="padding:6px 8px;">${URGENCIA_LABEL[m.urgencia]||m.urgencia}</td>
            <td style="padding:6px 8px;">${esc(m.descricao?.substring(0,80))}</td>
            <td style="padding:6px 8px;">${esc(m.localizacao)}</td>
            <td style="padding:6px 8px;">${MANUT_STATUS[m.status]||m.status}</td>
            <td style="padding:6px 8px;color:var(--muted);">${new Date(m.criado_em).toLocaleDateString('pt-BR')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    `).join('');
  }

  function printManutRelatorio() {
    const conteudo = document.getElementById('relatorioConteudo').innerHTML;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>Relatório Manutenção — ${SCHOOL_NAME}</title>
      <style>body{font-family:'DM Sans',Helvetica,sans-serif;padding:32px;color:#1a1a1a;}
      h1{font-size:18px;margin-bottom:4px;} .sub{font-size:12px;color:#999;margin-bottom:24px;}
      table{width:100%;border-collapse:collapse;} th,td{text-align:left;padding:6px 8px;font-size:12px;}
      th{border-bottom:2px solid #ccc;text-transform:uppercase;font-size:10px;color:#888;}
      tr{border-bottom:1px solid #eee;} @media print{body{padding:16px;}}</style>
</head>
      <body><h1>Relatório de Pendências — Manutenção</h1>
      <div class="sub">${SCHOOL_NAME} · ${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})}</div>
      ${conteudo}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 300);
  }

  function shareManutWhatsApp() {
    const equipes = [...relatorioEquipesSel];
    const pendentes = manutData.filter(m => m.status !== 'concluida' && m.status !== 'rejeitada');
    let texto = '*RELATÓRIO DE MANUTENÇÃO — ' + SCHOOL_NAME + '*\n' + new Date().toLocaleDateString('pt-BR') + '\n\n';
    for (const eq of equipes) {
      const items = pendentes.filter(m => (m.equipe_responsavel || 'Sem equipe') === eq);
      if (!items.length) continue;
      texto += '*' + eq + '* (' + items.length + ')\n';
      items.forEach(m => {
        const urg = {baixa:'🟢',media:'🟡',alta:'🟠',critica:'🔴'}[m.urgencia]||'';
        texto += urg + ' ' + (m.descricao||'').substring(0,60) + ' — _' + (m.localizacao||'') + '_\n';
      });
      texto += '\n';
    }
    window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
  }
