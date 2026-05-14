// Auto-extraído do gerente.html (Onda 4 — terceira passada).
// Inventário Físico (sessão persistida). Funções almInv* chamadas via
// onclick handlers no HTML + panel switcher 'almInventario'.
  // ═══ INVENTÁRIO FÍSICO (sessão persistida) ═══════════════════════
  let _almInvSessao = null;
  let _almInvItens  = [];
  let _almInvCatalogoCache = null;

  async function almInvCarregarLista() {
    const d = await callDiplomas({ action: 'alm_inventario_list' });
    const sessoes = d.data || [];
    const box = document.getElementById('almInvLista');
    if (!sessoes.length) {
      box.innerHTML = '<div class="empty-state">Nenhuma sessão de inventário ainda. Clique em "Nova Contagem" para começar.</div>';
      return;
    }
    box.innerHTML = sessoes.map(s => {
      const statusBadge = s.status === 'rascunho'
        ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">📝 Em andamento</span>'
        : s.status === 'finalizado'
          ? '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">✅ Finalizado</span>'
          : '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">❌ Cancelado</span>';
      const data = new Date(s.criado_em).toLocaleString('pt-BR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const filtros = [];
      if (s.filtro_localizacao) filtros.push('📍 ' + s.filtro_localizacao);
      if (s.filtro_categoria) filtros.push('🏷️ ' + s.filtro_categoria);
      const acao = s.status === 'rascunho'
        ? `<button onclick="almInvAbrirSessao('${s.id}')" class="btn-create" style="padding:6px 14px;background:#1a6bb5;">▶️ Continuar</button>`
        : `<button onclick="almInvAbrirSessao('${s.id}')" style="background:none;border:1.5px solid var(--border);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">🔎 Ver relatório</button>`;
      return `
        <div style="background:#fff;border:1.5px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              ${esc(s.nome)} ${statusBadge}
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px;">
              ${data} · ${s.total_contados}/${s.total_itens} contados${s.total_divergencias>0?` · <b style="color:#d97706;">${s.total_divergencias} divergências</b>`:''}
              ${filtros.length?' · '+filtros.join(' '):''}
            </div>
          </div>
          ${acao}
        </div>`;
    }).join('');
  }

  async function almInvAbrirNovo() {
    if (!_almInvCatalogoCache) {
      const d = await callDiplomas({ action: 'alm_insumos_list' });
      _almInvCatalogoCache = d.data || [];
    }
    const cats = [...new Set(_almInvCatalogoCache.map(i=>i.categoria).filter(Boolean))].sort();
    const locs = [...new Set(_almInvCatalogoCache.map(i=>i.localizacao).filter(Boolean))].sort();
    const html = `
      <div style="background:#fff;border-radius:14px;padding:24px;max-width:520px;width:100%;">
        <h3 style="font-family:'Lora',serif;font-size:17px;margin-bottom:14px;">📋 Nova Sessão de Inventário</h3>
        <div class="ff" style="margin-bottom:12px;">
          <label>Nome da contagem *</label>
          <input id="almInvNovoNome" type="text" placeholder="Ex: Inventário inicial Maio/2026" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;">
        </div>
        <div class="ff" style="margin-bottom:12px;">
          <label>Descrição (opcional)</label>
          <input id="almInvNovoDesc" type="text" placeholder="Ex: Conferência completa pós-recesso" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;">
        </div>
        <div style="display:flex;gap:10px;margin-bottom:14px;">
          <div class="ff" style="flex:1;">
            <label>Filtrar por localização</label>
            <select id="almInvNovoLoc" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;">
              <option value="">Todas</option>
              ${locs.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('')}
            </select>
          </div>
          <div class="ff" style="flex:1;">
            <label>Filtrar por categoria</label>
            <select id="almInvNovoCat" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;">
              <option value="">Todas</option>
              ${cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
          </div>
        </div>
        <p style="font-size:11px;color:var(--muted);margin-bottom:16px;">💡 Dica: deixe sem filtros para um inventário completo. Filtre por localização (sala/armário) para contar por setor.</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button onclick="document.getElementById('almInvNovoModal').remove()" style="background:none;border:1.5px solid var(--border);border-radius:8px;padding:8px 16px;font-size:13px;cursor:pointer;font-family:inherit;">Cancelar</button>
          <button onclick="almInvCriarSessao()" class="btn-create" style="padding:8px 18px;background:#1a6bb5;">📋 Criar e começar</button>
        </div>
      </div>`;
    let modal = document.getElementById('almInvNovoModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'almInvNovoModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1100;display:flex;align-items:center;justify-content:center;padding:20px;';
      document.body.appendChild(modal);
    }
    modal.innerHTML = html;
  }

  async function almInvCriarSessao() {
    const nome = document.getElementById('almInvNovoNome').value.trim();
    if (!nome) { showToast('Nome obrigatório.', 'error'); return; }
    const descricao = document.getElementById('almInvNovoDesc').value.trim();
    const filtro_localizacao = document.getElementById('almInvNovoLoc').value || null;
    const filtro_categoria = document.getElementById('almInvNovoCat').value || null;
    const d = await callDiplomas({ action: 'alm_inventario_criar', nome, descricao, filtro_categoria, filtro_localizacao });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    document.getElementById('almInvNovoModal').remove();
    showToast(`✅ Sessão criada com ${d.total} itens`, 'success');
    almInvAbrirSessao(d.id);
  }

  async function almInvAbrirSessao(id) {
    const d = await callDiplomas({ action: 'alm_inventario_get', id });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    _almInvSessao = d.inventario;
    _almInvItens  = d.itens || [];
    document.getElementById('almInvListView').style.display = 'none';
    document.getElementById('almInvCountView').style.display = 'block';
    document.getElementById('almInvNomeHeader').textContent = _almInvSessao.nome + (_almInvSessao.status !== 'rascunho' ? ' · ' + _almInvSessao.status : '');
    const locs = [...new Set(_almInvItens.map(i=>i.localizacao_snapshot).filter(Boolean))].sort();
    const cats = [...new Set(_almInvItens.map(i=>i.categoria_snapshot).filter(Boolean))].sort();
    document.getElementById('almInvFiltroLoc').innerHTML = '<option value="">Toda localização</option>' + locs.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('');
    document.getElementById('almInvFiltroCat').innerHTML = '<option value="">Toda categoria</option>' + cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (_almInvSessao.status !== 'rascunho') {
      document.getElementById('almInvFiltroStatus').value = 'todos';
    }
    almInvRender();
  }

  function almInvVoltar() {
    _almInvSessao = null;
    _almInvItens = [];
    document.getElementById('almInvCountView').style.display = 'none';
    document.getElementById('almInvListView').style.display = 'block';
    almInvCarregarLista();
  }

  function almInvRender() {
    if (!_almInvSessao) return;
    const search = (document.getElementById('almInvSearch').value || '').toLowerCase().trim();
    const fLoc = document.getElementById('almInvFiltroLoc').value;
    const fCat = document.getElementById('almInvFiltroCat').value;
    const fStatus = document.getElementById('almInvFiltroStatus').value;

    const lista = _almInvItens.filter(it => {
      if (search && !(it.nome_snapshot||'').toLowerCase().includes(search)) return false;
      if (fLoc && it.localizacao_snapshot !== fLoc) return false;
      if (fCat && it.categoria_snapshot !== fCat) return false;
      if (fStatus === 'pendente' && it.contado) return false;
      if (fStatus === 'contado' && !it.contado) return false;
      if (fStatus === 'divergente') {
        if (!it.contado) return false;
        if (Number(it.saldo_contado) === Number(it.saldo_sistema)) return false;
      }
      return true;
    });

    const total = _almInvItens.length;
    const contados = _almInvItens.filter(i=>i.contado).length;
    const divs = _almInvItens.filter(i=>i.contado && Number(i.saldo_contado)!==Number(i.saldo_sistema)).length;
    document.getElementById('almInvProgLabel').textContent = `${contados} / ${total}`;
    document.getElementById('almInvDivLabel').textContent = divs;
    document.getElementById('almInvProgBar').style.width = total ? Math.round(contados/total*100) + '%' : '0%';

    const box = document.getElementById('almInvItens');
    if (!lista.length) {
      box.innerHTML = '<div class="empty-state">Nenhum item neste filtro.</div>';
      return;
    }

    const grupos = {};
    lista.forEach(it => {
      const k = it.localizacao_snapshot || '— Sem localização —';
      if (!grupos[k]) grupos[k] = [];
      grupos[k].push(it);
    });

    const readonly = _almInvSessao.status !== 'rascunho';

    box.innerHTML = Object.keys(grupos).sort().map(loc => {
      const itens = grupos[loc];
      return `
        <div style="margin-bottom:18px;">
          <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;border-bottom:1.5px solid var(--border);padding-bottom:6px;">📍 ${esc(loc)} <span style="font-weight:500;color:#999;">(${itens.length})</span></div>
          ${itens.map(it => {
            const diff = it.contado && Number(it.saldo_contado) !== Number(it.saldo_sistema);
            const corBorda = !it.contado ? 'var(--border)' : (diff ? '#d97706' : '#16a34a');
            const corFundo = !it.contado ? '#fff' : (diff ? '#fffbeb' : '#f0fdf4');
            const diffVal = it.contado ? (Number(it.saldo_contado) - Number(it.saldo_sistema)) : 0;
            return `
              <div style="background:${corFundo};border:1.5px solid ${corBorda};border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <div style="flex:1;min-width:180px;">
                  <div style="font-weight:600;font-size:14px;">${esc(it.nome_snapshot)}</div>
                  <div style="font-size:11px;color:var(--muted);margin-top:2px;">
                    ${esc(it.categoria_snapshot||'Geral')} · Sistema: <b>${it.saldo_sistema}</b> ${esc(it.unidade_snapshot||'')}
                    ${it.contado ? ` · Contado: <b style="color:${diff?'#d97706':'#16a34a'};">${it.saldo_contado}</b>` : ''}
                    ${diff ? ` · Diff: <b style="color:#d97706;">${diffVal>0?'+':''}${diffVal}</b>` : ''}
                  </div>
                  ${it.observacao ? `<div style="font-size:11px;color:#92400e;margin-top:2px;">📝 ${esc(it.observacao)}</div>` : ''}
                </div>
                ${readonly ? '' : `
                  <input type="number" inputmode="decimal" step="any" min="0" placeholder="Contar..."
                    value="${it.contado ? it.saldo_contado : ''}"
                    data-item-id="${it.id}"
                    onchange="almInvSalvarContagem('${it.id}', this.value, this)"
                    style="width:110px;padding:9px 10px;border:1.5px solid ${corBorda};border-radius:8px;font-family:inherit;font-size:14px;text-align:right;font-weight:600;">
                  <button onclick="almInvAddObs('${it.id}')" title="Adicionar observação" style="background:none;border:1.5px solid var(--border);border-radius:8px;padding:8px 10px;font-size:14px;cursor:pointer;">📝</button>
                  ${it.contado ? `<button onclick="almInvLimparContagem('${it.id}')" title="Limpar contagem" style="background:none;border:1.5px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;cursor:pointer;color:var(--muted);">↺</button>` : ''}
                `}
              </div>`;
          }).join('')}
        </div>`;
    }).join('');
  }

  async function almInvSalvarContagem(itemId, valor, inputEl) {
    if (valor === '' || valor === null || valor === undefined) return;
    const d = await callDiplomas({ action: 'alm_inventario_contar', item_id: itemId, saldo_contado: valor });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    const it = _almInvItens.find(x => x.id === itemId);
    if (it) {
      it.saldo_contado = parseFloat(String(valor).replace(',','.'));
      it.contado = true;
      it.contado_em = new Date().toISOString();
    }
    almInvRender();
    if (inputEl) inputEl.blur();
    window.lumiedShowAutoSaved?.();
  }

  async function almInvLimparContagem(itemId) {
    const d = await callDiplomas({ action: 'alm_inventario_contar', item_id: itemId, saldo_contado: null });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    const it = _almInvItens.find(x => x.id === itemId);
    if (it) { it.saldo_contado = null; it.contado = false; it.observacao = null; }
    almInvRender();
    window.lumiedShowAutoSaved?.();
  }

  async function almInvAddObs(itemId) {
    const it = _almInvItens.find(x => x.id === itemId);
    if (!it) return;
    const obs = window.prompt('Observação (motivo da divergência, validade, lote, etc):', it.observacao || '');
    if (obs === null) return;
    const d = await callDiplomas({
      action: 'alm_inventario_contar', item_id: itemId,
      saldo_contado: it.contado ? it.saldo_contado : null,
      observacao: obs.trim() || null,
    });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    it.observacao = obs.trim() || null;
    almInvRender();
    window.lumiedShowAutoSaved?.();
  }

  async function almInvCancelarSessao() {
    if (!_almInvSessao || _almInvSessao.status !== 'rascunho') return;
    if (!window.confirm(`Cancelar a sessão "${_almInvSessao.nome}"? Os ajustes NÃO serão aplicados.`)) return;
    const d = await callDiplomas({ action: 'alm_inventario_cancelar', id: _almInvSessao.id });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast('Sessão cancelada.', 'info');
    almInvVoltar();
  }

  async function almInvFinalizarSessao() {
    if (!_almInvSessao || _almInvSessao.status !== 'rascunho') return;
    const total = _almInvItens.length;
    const contados = _almInvItens.filter(i=>i.contado).length;
    const naoContados = total - contados;
    const divs = _almInvItens.filter(i=>i.contado && Number(i.saldo_contado)!==Number(i.saldo_sistema)).length;

    let aplicar_nao_contados = false;
    let msg = `Finalizar inventário?\n\n• ${contados}/${total} itens contados\n• ${divs} divergências serão aplicadas como ajuste de estoque`;
    if (naoContados > 0) {
      msg += `\n\n⚠️ ${naoContados} itens NÃO foram contados. Eles permanecerão com o saldo atual (sem ajuste).`;
      if (!window.confirm(msg + '\n\nFinalizar mesmo assim?')) return;
      aplicar_nao_contados = true;
    } else {
      if (!window.confirm(msg)) return;
    }
    const d = await callDiplomas({ action: 'alm_inventario_finalizar', id: _almInvSessao.id, aplicar_nao_contados });
    if (d.error) { showToast('Erro: ' + d.error, 'error'); return; }
    showToast(`✅ Inventário finalizado · ${d.aplicados} ajustes aplicados`, 'success');
    almInvVoltar();
  }

  async function almEditarInsumoById(id) {
    const d = await callDiplomas({ action: 'alm_insumos_list' });
    const it = (d.data || []).find(i => i.id === id);
    if (it) almEditarInsumo(it);
  }

  function almEditarInsumo(it) {
    document.getElementById('almInsumoId').value       = it.id;
    document.getElementById('almInsumoNome').value     = it.nome;
    document.getElementById('almInsumoDesc').value     = it.descricao||'';
    document.getElementById('almInsumoUnidade').value  = it.unidade;
    document.getElementById('almInsumoEstoque').value  = it.estoque_qty;
    document.getElementById('almInsumoPreco').value    = it.preco;
    document.getElementById('almInsumoCategoria').value= it.categoria||'';
    document.getElementById('almInsumoUnidadeCompra').value = it.unidade_compra||'';
    document.getElementById('almInsumoQtdEmb').value   = it.qtd_por_embalagem||1;
    document.getElementById('almInsumoLocalizacao').value = it.localizacao||'';
    almAtualizarPrecoUnit();
    document.getElementById('almInsumoFormTitle').textContent = '✏️ Editar Insumo';
    document.getElementById('almInsumoFormCard').scrollIntoView({ behavior:'smooth' });
  }

  function almLimparInsumoForm() {
    ['almInsumoId','almInsumoNome','almInsumoDesc','almInsumoEstoque','almInsumoPreco','almInsumoCategoria','almInsumoUnidadeCompra','almInsumoLocalizacao'].forEach(id => document.getElementById(id).value='');
    document.getElementById('almInsumoUnidade').value = 'unidade';
    document.getElementById('almInsumoQtdEmb').value = '1';
    document.getElementById('almPrecoUnitInfo').textContent = '';
    document.getElementById('almInsumoFormTitle').textContent = '➕ Novo Insumo';
  }

  function almAtualizarPrecoUnit() {
    const preco = parseFloat(document.getElementById('almInsumoPreco').value) || 0;
    const qtd = parseFloat(document.getElementById('almInsumoQtdEmb').value) || 1;
    const el = document.getElementById('almPrecoUnitInfo');
    if (qtd > 1 && preco > 0) {
      el.textContent = 'Preco por ' + document.getElementById('almInsumoUnidade').value + ': ' + almFmtBRL(preco / qtd);
      el.style.color = '#2d7a3a';
      el.style.fontWeight = '600';
    } else {
      el.textContent = '';
    }
  }

  async function almSalvarInsumo() {
    const errEl = document.getElementById('almInsumoErr');
    const okEl  = document.getElementById('almInsumoOk');
    errEl.classList.remove('show'); okEl.classList.remove('show');
    const d = await callDiplomas({
      action: 'alm_insumo_save',
      id:               document.getElementById('almInsumoId').value || undefined,
      nome:             document.getElementById('almInsumoNome').value.trim(),
      descricao:        document.getElementById('almInsumoDesc').value.trim(),
      unidade:          document.getElementById('almInsumoUnidade').value.trim() || 'unidade',
      estoque_qty:      parseFloat(document.getElementById('almInsumoEstoque').value) || 0,
      preco:            parseFloat(document.getElementById('almInsumoPreco').value) || 0,
      categoria:        document.getElementById('almInsumoCategoria').value.trim(),
      unidade_compra:   document.getElementById('almInsumoUnidadeCompra').value.trim() || null,
      qtd_por_embalagem: parseFloat(document.getElementById('almInsumoQtdEmb').value) || 1,
      localizacao:      document.getElementById('almInsumoLocalizacao').value.trim() || null,
    });
    if (d.error) { errEl.textContent = d.error; errEl.classList.add('show'); return; }
    okEl.textContent = '✅ Insumo salvo!'; okEl.classList.add('show');
    almLimparInsumoForm();
    almLoadInsumos();
  }

  async function almDesativarInsumo(id) {
    if (!await _lumiedConfirm('Desativar este insumo?')) return;
    const d = await callDiplomas({ action: 'alm_insumo_del', id });
    if (!d.error) almLoadInsumos();
  }

  async function almExcluirInsumo(id, nome) {
    if (!await _lumiedConfirm(`Excluir permanentemente "${nome}"?\n\nEssa ação não pode ser desfeita. Se o item tiver compras ou movimentações vinculadas, use "Desativar" em vez disso.`)) return;
    const d = await callDiplomas({ action: 'alm_insumo_excluir', id });
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('🗑️ Insumo excluído permanentemente.', 'success');
    almLoadInsumos();
  }

  async function almLoadTurmas() {
    const d = await callDiplomas({ action: 'alm_series_list' });
    const turmas = d.data || [];
    document.getElementById('almTurmasCount').textContent = turmas.length;
    // Load all professors for assignment
    const profsRaw = await api({ action: 'professoras_list' }).catch(() => []);
    const allProfs = Array.isArray(profsRaw) ? profsRaw : [];
    document.getElementById('almTurmasList').innerHTML = turmas.map(t => {
      const profs = allProfs.filter(p => p.serie_id === t.id || p.alm_turma_id === t.id || (Array.isArray(p.series_monitoras) && p.series_monitoras.includes(t.id)));
      return `<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <div style="width:18px;height:18px;border-radius:50%;background:${t.cor||'#3B82F6'};flex-shrink:0;"></div>
          <div style="flex:1;font-weight:600;font-size:14px;">${t.nome}</div>
          <button onclick="almEditarTurma(${JSON.stringify(t).replace(/"/g,'&quot;')})" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Editar</button>
          <button onclick="almDelTurma('${t.id}')" style="background:none;border:1px solid #e53e3e;color:#e53e3e;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Remover</button>
        </div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);letter-spacing:.5px;margin-bottom:6px;">Professoras (${profs.length})</div>
        ${profs.length ? profs.map(p => `<span style="display:inline-block;background:#f0ece6;border-radius:6px;padding:3px 10px;font-size:12px;margin:2px;">${p.nome}</span>`).join('') : '<span style="font-size:12px;color:var(--muted);font-style:italic;">Nenhuma professora associada</span>'}
      </div>`;
    }).join('') || '<div class="empty-state">Nenhuma turma cadastrada.</div>';
    // Professor-turma assignment list (select per professor)
    document.getElementById('almProfTurmaList').innerHTML = allProfs.length
      ? allProfs.map((p) => {
          const profTurmas = new Set([p.serie_id, p.alm_turma_id, ...(p.series_monitoras||[])].filter(Boolean));
          return `<div class="alm-insumo-row" style="flex-wrap:wrap;">
            <div style="flex:1;font-size:13px;min-width:180px;"><strong>${p.nome}</strong> <span style="color:var(--muted);">${p.email}</span></div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${turmas.map((t) => `<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:${profTurmas.has(t.id)?'rgba(200,16,46,.06)':'#fff'};">
                <input type="checkbox" data-prof="${p.id}" data-turma="${t.id}" ${profTurmas.has(t.id)?'checked':''} onchange="almToggleProfTurma('${p.id}')" style="accent-color:var(--red);">
                ${esc(t.nome)}
              </label>`).join('')}
            </div>
          </div>`;
        }).join('')
      : '<div class="empty-state">Nenhuma professora cadastrada.</div>';
  }

  function almEditarTurma(t) {
    document.getElementById('almTurmaId').value   = t.id;
    document.getElementById('almTurmaNome').value = t.nome;
    document.getElementById('almTurmaCor').value  = t.cor || '#3B82F6';
    document.getElementById('almTurmaFormTitle').textContent = '✏️ Editar Turma';
  }

  async function almSalvarTurma() {
    const errEl = document.getElementById('almTurmaErr');
    const okEl  = document.getElementById('almTurmaOk');
    errEl.classList.remove('show'); okEl.classList.remove('show');
    const d = await callDiplomas({
      action: 'alm_turma_save',
      id:   document.getElementById('almTurmaId').value || undefined,
      nome: document.getElementById('almTurmaNome').value.trim(),
      cor:  document.getElementById('almTurmaCor').value,
    });
    if (d.error) { errEl.textContent = d.error; errEl.classList.add('show'); return; }
    okEl.textContent = '✅ Turma salva!'; okEl.classList.add('show');
    document.getElementById('almTurmaId').value = '';
    document.getElementById('almTurmaNome').value = '';
    document.getElementById('almTurmaFormTitle').textContent = '➕ Nova Turma';
    almLoadTurmas();
  }

  async function almDelTurma(id) {
    if (!await _lumiedConfirm('Remover esta turma?')) return;
    await callDiplomas({ action: 'alm_turma_del', id });
    almLoadTurmas();
  }

  async function almSetProfTurma(professora_id, turma_id) {
    await callDiplomas({ action: 'alm_prof_set_turma', professora_id, turma_id: turma_id || null });
  }
  async function almToggleProfTurma(profId) {
    const checks = document.querySelectorAll(`input[data-prof="${profId}"]`);
    const turmaIds = [...checks].filter(c => c.checked).map(c => c.dataset.turma);
    await callDiplomas({ action: 'alm_prof_set_turma', professora_id: profId, turma_ids: turmaIds });
    showToast('Turmas atualizadas!', 'success');
  }

  async function almLoadOrcamentos() {
    const mes = document.getElementById('almOrcMes').value || new Date().toISOString().slice(0,7);
    const d = await callDiplomas({ action: 'alm_orcamentos_list', mes });
    const turmas = d.data || [];
    if (!turmas.length) { document.getElementById('almOrcList').innerHTML = '<div class="empty-state">Cadastre turmas primeiro.</div>'; return; }
    document.getElementById('almOrcList').innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Turma</th>
          <th style="text-align:right;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Orçamento (R$)</th>
          <th style="padding:10px 14px;border-bottom:1.5px solid var(--border);"></th>
        </tr></thead>
        <tbody>${turmas.map(t => `
          <tr>
            <td style="padding:12px 14px;font-size:13px;border-bottom:1px solid #f5f0ea;">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${t.cor||'#3B82F6'};margin-right:8px;"></span>
              ${t.nome}
            </td>
            <td style="padding:12px 14px;text-align:right;border-bottom:1px solid #f5f0ea;">
              <input type="number" id="orc-${t.id}" value="${t.valor||0}" min="0" step="50"
                style="width:120px;padding:6px 10px;border:1.5px solid var(--border);border-radius:6px;text-align:right;font-family:'DM Sans',sans-serif;font-size:13px;">
            </td>
            <td style="padding:12px 14px;border-bottom:1px solid #f5f0ea;">
              <button onclick="almSalvarOrcamento('${t.id}','${mes}')" class="btn-create" style="padding:5px 12px;font-size:12px;">Salvar</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  async function almSalvarOrcamento(turma_id, mes) {
    const valor = parseFloat(document.getElementById('orc-' + turma_id).value) || 0;
    const d = await callDiplomas({ action: 'alm_orcamento_set', turma_id, mes, valor });
    const okEl = document.getElementById('almOrcOk');
    if (!d.error) { okEl.textContent = '✅ Orçamento salvo!'; okEl.classList.add('show'); setTimeout(() => okEl.classList.remove('show'), 2500); }
  }

  async function almAplicarOrcPadrao() {
    const valor = parseFloat(document.getElementById('almOrcPadrao').value) || 0;
    const mes = document.getElementById('almOrcMes').value || new Date().toISOString().slice(0,7);
    if (!await _lumiedConfirm('Aplicar R$ ' + valor.toFixed(2).replace('.',',') + ' para TODAS as turmas em ' + mes + '?')) return;
    const d = await callDiplomas({ action: 'alm_orcamentos_list', mes });
    const turmas = d.data || [];
    for (const t of turmas) {
      await callDiplomas({ action: 'alm_orcamento_set', turma_id: t.id, mes, valor });
    }
    showToast('Orçamento padrão aplicado a ' + turmas.length + ' turmas!', 'success');
    almLoadOrcamentos();
  }

  async function almAplicarOrcAnual() {
    const valor = parseFloat(document.getElementById('almOrcPadrao').value) || 0;
    const ano = document.getElementById('almOrcAno').value || new Date().getFullYear();
    if (!await _lumiedConfirm('Aplicar R$ ' + valor.toFixed(2).replace('.',',') + ' para TODAS as turmas em TODOS os 12 meses de ' + ano + '?')) return;
    // Busca turmas usando qualquer mês (só precisa da lista)
    const d = await callDiplomas({ action: 'alm_orcamentos_list', mes: ano + '-01' });
    const turmas = d.data || [];
    if (!turmas.length) { showToast('Nenhuma turma cadastrada.', 'warning'); return; }
    let total = 0;
    for (let m = 1; m <= 12; m++) {
      const mes = ano + '-' + String(m).padStart(2, '0');
      for (const t of turmas) {
        await callDiplomas({ action: 'alm_orcamento_set', turma_id: t.id, mes, valor });
        total++;
      }
    }
    showToast('Orçamento aplicado: ' + turmas.length + ' turmas × 12 meses (' + total + ' registros)!', 'success');
    almLoadOrcamentos();
  }
