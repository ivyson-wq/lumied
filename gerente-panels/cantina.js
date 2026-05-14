// Auto-extraído do gerente.html (Onda 4 — batch).
// Cantina + Cozinha — cardápio, receitas, alimentos/estoque, compras, sanitário, desperdício, config
  // ── CANTINA ───────────────────────────────────────────
  async function loadCardapio() {
    const data = document.getElementById('cantData').value;
    if (!data) return;
    const d = await opApi({ action:'cantina_cardapio_list', data_inicio:data, data_fim:data });
    const items = Array.isArray(d) ? d : (d.data || []);
    const almoco = items.find(i => i.refeicao === 'almoco');
    const lanche = items.find(i => i.refeicao === 'lanche');
    document.getElementById('cantAlmoco').value = almoco?.itens ? (Array.isArray(almoco.itens) ? almoco.itens.join('\n') : almoco.itens) : '';
    document.getElementById('cantLanche').value = lanche?.itens ? (Array.isArray(lanche.itens) ? lanche.itens.join('\n') : lanche.itens) : '';
    document.getElementById('cantObsInput').value = almoco?.observacoes || lanche?.observacoes || '';
  }
  async function salvarCardapio() {
    const data = document.getElementById('cantData').value;
    if (!data) return showToast('Selecione uma data','error');
    const almoco = document.getElementById('cantAlmoco').value.split('\n').filter(Boolean);
    const lanche = document.getElementById('cantLanche').value.split('\n').filter(Boolean);
    const obs = document.getElementById('cantObsInput').value.trim();
    await opApi({ action:'cantina_cardapio_upsert', data:data, refeicao:'almoco', itens:almoco, observacoes:obs });
    await opApi({ action:'cantina_cardapio_upsert', data:data, refeicao:'lanche', itens:lanche, observacoes:obs });
    showToast('Cardápio salvo!','success');
  }

  var cantCreditos = [];
  async function loadCantCreditos() {
    const d = await opApi({ action:'cantina_creditos' });
    cantCreditos = Array.isArray(d) ? d : (d.data || []);
    renderCantCreditos(cantCreditos);
  }
  function filtrarCreditos() {
    const q = (document.getElementById('cantCreditoBusca')?.value || '').toLowerCase();
    renderCantCreditos(q ? cantCreditos.filter(c => (c.aluno_nome||c.aluno_email||'').toLowerCase().includes(q)) : cantCreditos);
  }
  function renderCantCreditos(lista) {
    const body = document.getElementById('cantCreditosBody');
    if (!lista.length) { body.innerHTML = '<tr><td colspan="4" style="padding:40px;text-align:center;color:var(--muted);">Nenhum crédito registrado.</td></tr>'; return; }
    body.innerHTML = lista.map(c => `<tr style="border-bottom:1px solid #f0ece6;">
      <td style="padding:10px;"><strong>${esc(c.aluno_nome || c.aluno_email)}</strong></td>
      <td style="padding:10px;text-align:right;font-weight:700;color:${(c.saldo||0)>0?'var(--green)':'var(--red)'};">R$ ${(c.saldo||0).toFixed(2)}</td>
      <td style="padding:10px;font-size:12px;">${c.atualizado_em ? new Date(c.atualizado_em).toLocaleDateString('pt-BR') : '—'}</td>
      <td style="padding:10px;"><button class="action-btn" onclick="addCredito('${esc(c.aluno_email)}')" title="Adicionar crédito">💰</button></td>
    </tr>`).join('');
  }
  async function novoCredito() {
    const email = prompt('Email do aluno:'); if (!email) return;
    const valor = parseFloat(prompt('Valor do crédito (R$):') || '0');
    if (!valor || valor <= 0) return showToast('Valor inválido','error');
    const d = await opApi({ action:'cantina_credito_add', aluno_email:email, valor });
    if (d.error) return showToast(d.error,'error');
    showToast('Crédito adicionado!','success');
    loadCantCreditos();
  }
  async function addCredito(email) {
    const valor = parseFloat(prompt('Valor do crédito (R$):') || '0');
    if (!valor || valor <= 0) return;
    await opApi({ action:'cantina_credito_add', aluno_email:email, valor });
    showToast('Crédito adicionado!','success');
    loadCantCreditos();
  }

  // ══════════════════════════════════════════════════════════════
  // COZINHA (Merenda Escolar)
  // ══════════════════════════════════════════════════════════════
  var COZ_URL = SUPABASE_URL + '/functions/v1/cozinha';
  async function cozApi(body) {
    const r = await fetch(COZ_URL, { method:'POST', headers:{'Content-Type':'application/json','apikey':ANON,'Authorization':'Bearer '+ANON}, body:JSON.stringify({...body,_token:getToken()}) });
    return r.json();
  }
  var cozAlimentos = [], cozReceitas = [], cozCompras = [];

  async function loadCozDashboard() {
    const d = await cozApi({ action:'dashboard' });
    const k = d.data || d;
    const cards = [
      { label:'Estoque abaixo mín.', val: k.estoque_abaixo_minimo || 0, color:'#f59e0b' },
      { label:'Lotes vencendo 7d', val: k.lotes_vencendo_7d || 0, color:'#ef4444' },
      { label:'Cardápios aprovados 7d', val: k.cardapios_aprovados_7d || 0, color:'#10b981' },
      { label:'Cardápios pendentes 7d', val: k.cardapios_pendentes_7d || 0, color:'#8b5cf6' },
      { label:'Amostras ativas', val: k.amostras_ativas || 0, color:'#06b6d4' },
      { label:'Temp. não conforme hoje', val: k.temperaturas_nao_conformes_hoje || 0, color:'#ef4444' },
      { label:'Desperdício per capita 30d', val: (k.desperdicio_per_capita_g_30d || 0).toFixed(1) + ' g', color:'#84cc16' },
    ];
    document.getElementById('cozDashCards').innerHTML = cards.map(c =>
      `<div style="background:var(--white);border-left:4px solid ${c.color};border-radius:10px;padding:14px;">
        <div style="font-size:11px;text-transform:uppercase;color:var(--muted);font-weight:600;">${c.label}</div>
        <div style="font-size:22px;font-weight:700;margin-top:4px;">${c.val}</div>
      </div>`).join('');
    const venc = await cozApi({ action:'lotes_vencendo', dias:7 });
    const vl = venc.data || [];
    document.getElementById('cozVencendoList').innerHTML = vl.length ? vl.slice(0,10).map(l =>
      `<div style="padding:6px 0;border-bottom:1px solid var(--border);"><strong>${esc(l.cozinha_alimentos?.nome||'?')}</strong> — ${l.quantidade} • vence ${new Date(l.validade).toLocaleDateString('pt-BR')}</div>`).join('') : '<div style="color:var(--muted);">Nenhum lote próximo do vencimento ✓</div>';
    const confl = await cozApi({ action:'alergias_conflito_dia' });
    const cl = confl.data || [];
    document.getElementById('cozAlergiasList').innerHTML = cl.length ? cl.slice(0,10).map(c =>
      `<div style="padding:6px 0;border-bottom:1px solid var(--border);"><strong>${esc(c.aluno_nome||c.aluno_email)}</strong> — ${esc(c.alergeno)} em ${esc(c.receita)} (${esc(c.refeicao)})</div>`).join('') : '<div style="color:var(--muted);">Sem conflitos hoje ✓</div>';
  }

  // ── CARDÁPIO ─────────────────────────────────────────────
  async function loadCozCardapio() {
    const ini = document.getElementById('cozCardIni').value || new Date().toISOString().split('T')[0];
    const fim = document.getElementById('cozCardFim').value || new Date(Date.now()+7*86400000).toISOString().split('T')[0];
    document.getElementById('cozCardIni').value = ini;
    document.getElementById('cozCardFim').value = fim;
    const d = await cozApi({ action:'cardapio_list', data_inicio:ini, data_fim:fim });
    const items = d.data || [];
    const byDate = {};
    items.forEach(i => { (byDate[i.data] = byDate[i.data] || []).push(i); });
    const dates = Object.keys(byDate).sort();
    if (!dates.length) {
      document.getElementById('cozCardapioGrid').innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);">Nenhum item cadastrado. Clique em "+ Item" para adicionar.</div>';
      return;
    }
    document.getElementById('cozCardapioGrid').innerHTML = dates.map(d => {
      const its = byDate[d].sort((a,b)=> (a.refeicao||'').localeCompare(b.refeicao||''));
      return `<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px;">
        <h4 style="font-size:13px;font-weight:700;margin-bottom:8px;">${new Date(d).toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'short'})}</h4>
        ${its.map(i => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <span><strong>${esc(i.refeicao)}</strong> — ${esc(i.cozinha_receitas?.nome || i.descricao_livre || '—')} ${i.aprovado_em?'<span style="color:var(--green);">✓ aprov.</span>':'<span style="color:#f59e0b;">pendente</span>'} ${i.publicado?'<span style="color:var(--blue);">📣</span>':''}</span>
          <span><button class="action-btn" onclick="delCardapio('${i.id}')">🗑</button></span>
        </div>`).join('')}
      </div>`;
    }).join('');
  }

  async function novoCardapioItem() {
    if (!cozReceitas.length) await loadCozReceitasData();
    const data = prompt('Data (YYYY-MM-DD):', new Date().toISOString().split('T')[0]); if (!data) return;
    const refeicao = prompt('Refeição (cafe/lanche_manha/almoco/lanche_tarde/jantar):', 'almoco'); if (!refeicao) return;
    const nomesReceita = cozReceitas.map((r,i) => `${i+1}) ${r.nome}`).join('\n');
    const idx = parseInt(prompt('Receita:\n' + nomesReceita + '\n\nNúmero (0 para texto livre):') || '0');
    let receita_id = null, descricao_livre = null;
    if (idx > 0 && idx <= cozReceitas.length) receita_id = cozReceitas[idx-1].id;
    else descricao_livre = prompt('Descrição livre:');
    const d = await cozApi({ action:'cardapio_upsert', data, refeicao, receita_id, descricao_livre });
    if (d.error) return showToast(d.error,'error');
    showToast('Item adicionado','success'); loadCozCardapio();
  }

  async function delCardapio(id) {
    if (!confirm('Remover?')) return;
    await cozApi({ action:'cardapio_delete', id });
    loadCozCardapio();
  }

  async function aprovarCardapios() {
    const nome = prompt('Nome da nutricionista:'); if (!nome) return;
    const crn = prompt('CRN:'); if (!crn) return;
    const ini = document.getElementById('cozCardIni').value, fim = document.getElementById('cozCardFim').value;
    const { data: items } = await cozApi({ action:'cardapio_list', data_inicio:ini, data_fim:fim });
    const ids = (items||[]).filter(i=>!i.aprovado_em).map(i=>i.id);
    if (!ids.length) return showToast('Nada para aprovar','error');
    await cozApi({ action:'cardapio_aprovar', ids, nutricionista_nome:nome, nutricionista_crn:crn });
    showToast('Aprovado!','success'); loadCozCardapio();
  }

  async function publicarCardapios() {
    if (!confirm('Publicar cardápios aprovados? Famílias verão no portal.')) return;
    const ini = document.getElementById('cozCardIni').value, fim = document.getElementById('cozCardFim').value;
    const d = await cozApi({ action:'cardapio_publicar', data_inicio:ini, data_fim:fim });
    if (d.error) return showToast(d.error,'error');
    showToast('Publicado!','success'); loadCozCardapio();
  }

  // ── RECEITAS ─────────────────────────────────────────────
  async function loadCozReceitasData() {
    const d = await cozApi({ action:'receitas_list' });
    cozReceitas = d.data || [];
  }

  async function loadCozReceitas() {
    await loadCozReceitasData();
    renderCozReceitas(cozReceitas);
  }

  function filtrarCozReceitas() {
    const q = (document.getElementById('cozRecBusca').value || '').toLowerCase();
    renderCozReceitas(cozReceitas.filter(r => r.nome.toLowerCase().includes(q)));
  }

  function renderCozReceitas(list) {
    const c = document.getElementById('cozReceitasList');
    if (!list.length) { c.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);">Nenhuma receita cadastrada.</div>'; return; }
    c.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">' + list.map(r =>
      `<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px;">
        <div style="font-weight:700;margin-bottom:4px;">${esc(r.nome)}</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px;">${esc(r.categoria||'—')} • ${r.rendimento_porcoes||1} porções</div>
        <button class="action-btn" onclick="editarReceita('${r.id}')">✏️ Editar</button>
        <button class="action-btn" onclick="verReceita('${r.id}')">👁 Ficha</button>
      </div>`).join('') + '</div>';
  }

  async function novaReceita() { editarReceita(null); }
  async function editarReceita(id) {
    if (!cozAlimentos.length) { const a = await cozApi({ action:'alimentos_list' }); cozAlimentos = a.data || []; }
    let rec = { nome:'', categoria:'prato_principal', rendimento_porcoes:100, tempo_preparo_min:30, modo_preparo:'', ingredientes:[] };
    if (id) { const d = await cozApi({ action:'receita_get', id }); rec = d.data || rec; rec.ingredientes = rec.ingredientes || []; }
    const nome = prompt('Nome da receita:', rec.nome); if (!nome) return;
    const categoria = prompt('Categoria (prato_principal/acompanhamento/salada/sopa/lanche/bebida/sobremesa):', rec.categoria) || 'prato_principal';
    const rend = parseInt(prompt('Porções que rende:', rec.rendimento_porcoes) || '1');
    const modo = prompt('Modo de preparo:', rec.modo_preparo || '') || '';
    // Ingredientes: editor simples
    const ings = [];
    if (confirm('Editar ingredientes? OK=sim, Cancelar=manter atuais')) {
      while (true) {
        const nomes = cozAlimentos.map((a,i)=>`${i+1}) ${a.nome}`).join('\n');
        const idx = parseInt(prompt('Ingrediente:\n' + nomes + '\n\nNúmero (0 para parar):') || '0');
        if (!idx) break;
        const a = cozAlimentos[idx-1]; if (!a) continue;
        const q = parseFloat(prompt(`Quantidade por porção (${a.unidade_uso}):`,'10') || '0');
        if (q > 0) ings.push({ alimento_id: a.alimento_id, quantidade: q });
      }
    }
    const body = { action:'receita_upsert', id, nome, categoria, rendimento_porcoes:rend, modo_preparo:modo };
    if (ings.length) body.ingredientes = ings;
    const d = await cozApi(body);
    if (d.error) return showToast(d.error,'error');
    showToast('Receita salva!','success'); loadCozReceitas();
  }

  async function verReceita(id) {
    const d = await cozApi({ action:'receita_get', id });
    const r = d.data || d; const n = r.nutricao || {};
    alert(`📖 ${r.nome}\n\nCategoria: ${r.categoria}\nRende: ${r.rendimento_porcoes} porções\n\nPor porção:\n• Custo: R$ ${(n.custo_porcao||0).toFixed(2)}\n• ${(n.kcal||0).toFixed(0)} kcal\n• Proteína: ${(n.proteina_g||0).toFixed(1)} g\n• Carbo: ${(n.carbo_g||0).toFixed(1)} g\n• Gordura: ${(n.gordura_g||0).toFixed(1)} g\n\nAlergênicos: ${(r.alergenos||[]).join(', ') || '—'}\n\nModo de preparo:\n${r.modo_preparo||'—'}`);
  }

  // ── ALIMENTOS & ESTOQUE ──────────────────────────────────
  async function loadCozAlimentos() {
    const d = await cozApi({ action:'alimentos_list' });
    cozAlimentos = d.data || [];
    renderCozAlim(cozAlimentos);
  }
  function filtrarCozAlim() {
    const q = (document.getElementById('cozAlimBusca').value || '').toLowerCase();
    renderCozAlim(cozAlimentos.filter(a => a.nome.toLowerCase().includes(q)));
  }
  function renderCozAlim(list) {
    const b = document.getElementById('cozAlimentosBody');
    if (!list.length) { b.innerHTML = '<tr><td colspan="7" style="padding:40px;text-align:center;color:var(--muted);">Nenhum alimento. Clique em "+ Novo".</td></tr>'; return; }
    b.innerHTML = list.map(a => {
      const baixo = Number(a.estoque_valido) < Number(a.estoque_minimo || 0);
      const pv = a.proxima_validade ? new Date(a.proxima_validade).toLocaleDateString('pt-BR') : '—';
      return `<tr style="border-bottom:1px solid var(--border);${baixo?'background:#fef3c7;':''}">
        <td style="padding:8px;"><strong>${esc(a.nome)}</strong></td>
        <td>${esc(a.categoria||'—')}</td><td>${esc(a.temperatura||'—')}</td>
        <td style="text-align:right;font-weight:600;">${Number(a.estoque_valido).toFixed(1)} ${esc(a.unidade_uso||'')}</td>
        <td style="text-align:right;">${Number(a.estoque_minimo||0).toFixed(1)}</td>
        <td>${pv}</td>
        <td><button class="action-btn" onclick="editarAlimento('${a.alimento_id}')">✏️</button>
            <button class="action-btn" onclick="entradaLote('${a.alimento_id}')">📦</button></td>
      </tr>`;
    }).join('');
  }

  async function novoAlimento() { editarAlimento(null); }
  async function editarAlimento(id) {
    let a = { nome:'', categoria:'proteinas', unidade_compra:'kg', unidade_uso:'g', fator_conversao:1000, temperatura:'seco', estoque_minimo:0, preco_medio:0 };
    if (id) { const exs = cozAlimentos.find(x=>x.alimento_id===id); if (exs) a = { ...a, ...exs, id }; }
    a.nome = prompt('Nome:', a.nome) || a.nome; if (!a.nome) return;
    a.categoria = prompt('Categoria (cereais/proteinas/hortalicas/frutas/laticinios/tempero/bebidas):', a.categoria) || a.categoria;
    a.unidade_compra = prompt('Unidade compra (kg/pct/un/L/caixa):', a.unidade_compra) || 'kg';
    a.unidade_uso = prompt('Unidade uso (g/ml/un):', a.unidade_uso) || 'g';
    a.fator_conversao = parseFloat(prompt('Fator conversão (1 '+a.unidade_compra+' = ? '+a.unidade_uso+'):', a.fator_conversao) || '1');
    a.temperatura = prompt('Armazenamento (seco/refrigerado/congelado):', a.temperatura) || 'seco';
    a.estoque_minimo = parseFloat(prompt('Estoque mínimo ('+a.unidade_uso+'):', a.estoque_minimo) || '0');
    a.preco_medio = parseFloat(prompt('Preço médio por '+a.unidade_uso+' (R$):', a.preco_medio) || '0');
    const aler = prompt('Alergênicos (vírgula: gluten,lactose,ovo,soja,amendoim):', (a.alergenos||[]).join(','));
    a.alergenos = aler ? aler.split(',').map(x=>x.trim()).filter(Boolean) : [];
    const d = await cozApi({ action:'alimento_upsert', ...a });
    if (d.error) return showToast(d.error,'error');
    showToast('Alimento salvo!','success'); loadCozAlimentos();
  }

  async function entradaLote(alimento_id) {
    if (!cozAlimentos.length) await loadCozAlimentos();
    let alim;
    if (alimento_id && typeof alimento_id === 'string') alim = cozAlimentos.find(a=>a.alimento_id===alimento_id);
    if (!alim) {
      const nomes = cozAlimentos.map((a,i)=>`${i+1}) ${a.nome}`).join('\n');
      const idx = parseInt(prompt('Alimento:\n' + nomes) || '0');
      alim = cozAlimentos[idx-1]; if (!alim) return;
    }
    const qtd = parseFloat(prompt(`Quantidade recebida (${alim.unidade_uso}):`) || '0'); if (!qtd) return;
    const validade = prompt('Validade (YYYY-MM-DD):');
    const lote = prompt('Nº do lote:') || '';
    const fornecedor = prompt('Fornecedor:') || '';
    const nf = prompt('Nº nota fiscal:') || '';
    const preco = parseFloat(prompt(`Preço unit. por ${alim.unidade_uso} (R$):`) || '0');
    const d = await cozApi({ action:'lote_add', alimento_id:alim.alimento_id, quantidade:qtd, validade, lote, fornecedor, nota_fiscal:nf, preco_unitario:preco });
    if (d.error) return showToast(d.error,'error');
    showToast('Lote registrado!','success'); loadCozAlimentos();
  }

  // ── COMPRAS ──────────────────────────────────────────────
  async function projetarCompras() {
    const porcoes = parseInt(prompt('Porções previstas por refeição:','100') || '100');
    const d = await cozApi({ action:'compras_projetar', dias:7, porcoes });
    const items = d.data || [];
    const box = document.getElementById('cozProjecaoBox');
    if (!items.length) { box.style.display='block'; box.innerHTML = '<strong>✓ Nada a comprar</strong> — estoque suficiente para a próxima semana.'; return; }
    const total = items.reduce((s,i)=>s+Number(i.preco_estimado||0),0);
    box.style.display = 'block';
    box.innerHTML = `<strong>🔮 Projeção 7 dias (${porcoes} porções/refeição)</strong> — Total estimado: <strong>R$ ${total.toFixed(2)}</strong>
      <table style="width:100%;margin-top:8px;font-size:12px;"><tr><th>Item</th><th>A comprar</th><th>Preço est.</th></tr>` +
      items.map(i=>`<tr><td>${esc(i.nome)}</td><td>${Number(i.a_comprar).toFixed(1)} ${esc(i.unidade)}</td><td>R$ ${Number(i.preco_estimado||0).toFixed(2)}</td></tr>`).join('') +
      `</table><button onclick="gerarCompraDaProjecao()" style="margin-top:8px;padding:6px 14px;background:var(--green);color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">Criar Ordem de Compra</button>`;
    window._cozProjecao = items;
  }

  async function gerarCompraDaProjecao() {
    const itens = window._cozProjecao || [];
    if (!itens.length) return;
    const fornecedor = prompt('Fornecedor:') || '';
    const compraItens = itens.map(i => ({ alimento_id:i.alimento_id, quantidade:Number(i.a_comprar), preco_unitario:Number(i.preco_estimado)/Math.max(Number(i.a_comprar),1) }));
    const d = await cozApi({ action:'compra_upsert', status:'cotacao', fornecedor, data_pedido:new Date().toISOString().split('T')[0], itens:compraItens });
    if (d.error) return showToast(d.error,'error');
    showToast('Ordem de compra criada','success'); loadCozCompras();
  }

  async function loadCozCompras() {
    const status = document.getElementById('cozCompFiltroStatus').value;
    const d = await cozApi({ action:'compras_list', status: status||undefined });
    cozCompras = d.data || [];
    const c = document.getElementById('cozComprasList');
    if (!cozCompras.length) { c.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);">Nenhuma compra.</div>'; return; }
    c.innerHTML = '<div class="table-wrap"><table style="width:100%;font-size:13px;"><thead><tr style="border-bottom:2px solid var(--border);background:var(--bg);"><th style="padding:10px;text-align:left;">#</th><th>Status</th><th>Fornecedor</th><th>Data</th><th style="text-align:right;">Total</th><th>Ações</th></tr></thead><tbody>' +
      cozCompras.map(c => `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px;">#${c.numero||'—'}</td>
        <td><span style="padding:2px 8px;border-radius:6px;background:${c.status==='recebida'?'#dcfce7':c.status==='aprovada'?'#e0f2fe':'#fef3c7'};font-size:11px;">${esc(c.status)}</span></td>
        <td>${esc(c.fornecedor||'—')}</td>
        <td>${c.data_pedido? new Date(c.data_pedido).toLocaleDateString('pt-BR'):'—'}</td>
        <td style="text-align:right;font-weight:600;">R$ ${Number(c.total||0).toFixed(2)}</td>
        <td>${c.status==='cotacao'||c.status==='rascunho'?`<button class="action-btn" onclick="aprovarCompra('${c.id}')">✓</button>`:''}
            ${c.status==='aprovada'||c.status==='enviada'?`<button class="action-btn" onclick="receberCompra('${c.id}')">📦</button>`:''}</td>
      </tr>`).join('') + '</tbody></table></div>';
  }

  async function novaCompra() {
    const fornecedor = prompt('Fornecedor:') || '';
    const d = await cozApi({ action:'compra_upsert', status:'rascunho', fornecedor, data_pedido:new Date().toISOString().split('T')[0] });
    if (d.error) return showToast(d.error,'error');
    showToast('Compra criada (rascunho). Use "Projetar" ou adicione itens.','success'); loadCozCompras();
  }

  async function aprovarCompra(id) {
    if (!confirm('Aprovar compra?')) return;
    await cozApi({ action:'compra_aprovar', id });
    showToast('Aprovado!','success'); loadCozCompras();
  }

  async function receberCompra(id) {
    const d = await cozApi({ action:'compra_get', id });
    const compra = d.data || d;
    const itens = (compra.itens || []).map(it => ({
      compra_item_id: it.id,
      recebido_qtd: it.quantidade,
      lote: prompt(`Lote de ${it.cozinha_alimentos?.nome}:`) || '',
      validade: prompt(`Validade de ${it.cozinha_alimentos?.nome} (YYYY-MM-DD):`) || null,
      preco_unitario: it.preco_unitario,
    }));
    const nf = prompt('Nº nota fiscal:') || '';
    const r = await cozApi({ action:'compra_receber', id, itens, nota_fiscal:nf });
    if (r.error) return showToast(r.error,'error');
    showToast('Recebimento confirmado — estoque atualizado','success'); loadCozCompras();
  }

  // ── SANITÁRIO ────────────────────────────────────────────
  async function registrarTemperatura() {
    const equipamento = document.getElementById('cozTempEquip').value;
    const tipo = document.getElementById('cozTempTipo').value;
    const temperatura = parseFloat(document.getElementById('cozTempValor').value);
    const periodo = document.getElementById('cozTempPeriodo').value;
    if (!equipamento || isNaN(temperatura)) return showToast('Preencha os campos','error');
    const d = await cozApi({ action:'temperatura_registrar', equipamento, tipo, temperatura, periodo });
    if (d.error) return showToast(d.error,'error');
    const rec = d.data || d;
    showToast(rec.conforme?'✓ Conforme':'⚠️ NÃO CONFORME — registre ação corretiva', rec.conforme?'success':'error');
    document.getElementById('cozTempValor').value='';
    loadTempHist();
  }

  async function loadTempHist() {
    const d = await cozApi({ action:'temperatura_list', dias:7 });
    const items = d.data || [];
    document.getElementById('cozTempHist').innerHTML = items.slice(0,30).map(t =>
      `<div style="padding:4px 0;border-bottom:1px solid var(--border);${!t.conforme?'background:#fee2e2;':''}"><strong>${esc(t.equipamento)}</strong> ${t.temperatura}°C • ${new Date(t.registrado_em).toLocaleString('pt-BR')} ${t.conforme?'✓':'⚠️'}</div>`
    ).join('') || '<div style="color:var(--muted);">Sem registros.</div>';
  }

  async function loadHigList() {
    const d = await cozApi({ action:'higienizacao_status' });
    const items = d.data || [];
    document.getElementById('cozHigList').innerHTML = items.length? items.map(h =>
      `<div style="padding:6px 0;border-bottom:1px solid var(--border);${h.vencida?'background:#fee2e2;':''}">
        <strong>${esc(h.nome)}</strong> <span style="font-size:11px;color:var(--muted);">(${esc(h.periodicidade)})</span>
        <div style="font-size:11px;color:var(--muted);">${h.ultima_execucao? 'Últ: '+new Date(h.ultima_execucao).toLocaleDateString('pt-BR'):'Nunca executada'} ${h.vencida?`<span style="color:#ef4444;">• ${h.atraso_dias}d atraso</span>`:''}</div>
        <button class="action-btn" style="font-size:11px;" onclick="executarHig('${h.id}')">✓ Executar</button>
      </div>`).join('') : '<div style="color:var(--muted);">Nenhuma tarefa. Adicione acima.</div>';
  }

  async function novaHigiene() {
    const nome = document.getElementById('cozHigNome').value;
    const periodicidade = document.getElementById('cozHigPeriod').value;
    if (!nome) return;
    await cozApi({ action:'higienizacao_tarefa_upsert', nome, periodicidade });
    document.getElementById('cozHigNome').value=''; loadHigList();
  }

  async function executarHig(tarefa_id) {
    await cozApi({ action:'higienizacao_executar', tarefa_id });
    showToast('Execução registrada','success'); loadHigList();
  }

  async function coletarAmostra() {
    const data = new Date().toISOString().split('T')[0];
    const refeicao = prompt('Refeição (cafe/lanche_manha/almoco/lanche_tarde/jantar):','almoco'); if (!refeicao) return;
    const desc = prompt('Descrição da amostra:');
    const d = await cozApi({ action:'amostra_coletar', data, refeicao, descricao:desc });
    if (d.error) return showToast(d.error,'error');
    showToast('Amostra coletada — guarda 72h','success'); loadAmostras();
  }

  async function loadAmostras() {
    const d = await cozApi({ action:'amostras_list', dias:7 });
    const items = d.data || [];
    document.getElementById('cozAmostrasList').innerHTML = items.length? items.map(a => {
      const ativa = !a.descartado_em;
      return `<div style="padding:6px 0;border-bottom:1px solid var(--border);">
        <strong>${esc(a.refeicao)}</strong> • ${new Date(a.coletado_em).toLocaleString('pt-BR')} • ${esc(a.descricao||'—')}
        ${ativa?`<span style="color:var(--green);">ATIVA até ${new Date(a.armazenado_ate).toLocaleString('pt-BR')}</span> <button class="action-btn" onclick="descartarAmostra('${a.id}')">🗑 Descartar</button>`:'<span style="color:var(--muted);">descartada</span>'}
      </div>`;
    }).join('') : '<div style="color:var(--muted);">Nenhuma amostra.</div>';
  }

  async function descartarAmostra(id) {
    await cozApi({ action:'amostra_descartar', id });
    loadAmostras();
  }

  // ── DESPERDÍCIO ──────────────────────────────────────────
  async function registrarDesperdicio() {
    const data = prompt('Data (YYYY-MM-DD):', new Date().toISOString().split('T')[0]); if (!data) return;
    const refeicao = prompt('Refeição:','almoco'); if (!refeicao) return;
    const porcoes_preparadas = parseInt(prompt('Porções preparadas:') || '0');
    const porcoes_servidas = parseInt(prompt('Porções servidas:') || '0');
    const sobra_limpa_kg = parseFloat(prompt('Sobra limpa (kg — não servida):','0') || '0');
    const sobra_suja_kg = parseFloat(prompt('Sobra suja (kg — do prato do aluno):','0') || '0');
    const d = await cozApi({ action:'desperdicio_registrar', data, refeicao, porcoes_preparadas, porcoes_servidas, sobra_limpa_kg, sobra_suja_kg });
    if (d.error) return showToast(d.error,'error');
    showToast('Registrado','success'); loadDesperd();
  }

  async function loadDesperd() {
    const d = await cozApi({ action:'desperdicio_list', dias:30 });
    const items = d.data || [];
    const c = document.getElementById('cozDespList');
    if (!items.length) { c.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);">Sem registros.</div>'; return; }
    c.innerHTML = '<table style="width:100%;font-size:13px;"><thead><tr style="border-bottom:2px solid var(--border);background:var(--bg);"><th style="padding:8px;text-align:left;">Data</th><th>Refeição</th><th style="text-align:right;">Servidas</th><th style="text-align:right;">Sobra suja (kg)</th><th style="text-align:right;">Per capita (g)</th></tr></thead><tbody>' +
      items.map(i => `<tr style="border-bottom:1px solid var(--border);"><td style="padding:6px;">${new Date(i.data).toLocaleDateString('pt-BR')}</td><td>${esc(i.refeicao)}</td><td style="text-align:right;">${i.porcoes_servidas||0}</td><td style="text-align:right;">${Number(i.sobra_suja_kg||0).toFixed(2)}</td><td style="text-align:right;">${Number(i.per_capita_g||0).toFixed(1)}</td></tr>`).join('') + '</tbody></table>';
  }

  // ── CONFIG ───────────────────────────────────────────────
  async function loadCozConfig() {
    const d = await cozApi({ action:'config_get' });
    const c = d.data || d;
    document.getElementById('cozCfgNutr').value = c.nutricionista_nome || '';
    document.getElementById('cozCfgCrn').value = c.nutricionista_crn || '';
    document.getElementById('cozCfgEmail').value = c.nutricionista_email || '';
    document.getElementById('cozCfgCusto').value = c.custo_refeicao_meta || '';
    document.getElementById('cozCfgTempGel').value = c.tolerancia_temp_geladeira ?? 7;
    document.getElementById('cozCfgTempFrz').value = c.tolerancia_temp_freezer ?? -12;
    document.getElementById('cozCfgAmostra').value = c.amostra_horas ?? 72;
  }

  async function salvarCozConfig() {
    const body = {
      action:'config_upsert',
      nutricionista_nome: document.getElementById('cozCfgNutr').value,
      nutricionista_crn: document.getElementById('cozCfgCrn').value,
      nutricionista_email: document.getElementById('cozCfgEmail').value,
      custo_refeicao_meta: parseFloat(document.getElementById('cozCfgCusto').value) || null,
      tolerancia_temp_geladeira: parseFloat(document.getElementById('cozCfgTempGel').value) || 7,
      tolerancia_temp_freezer: parseFloat(document.getElementById('cozCfgTempFrz').value) || -12,
      amostra_horas: parseInt(document.getElementById('cozCfgAmostra').value) || 72,
    };
    const d = await cozApi(body);
    if (d.error) return showToast(d.error,'error');
    showToast('Configurações salvas!','success');
  }
