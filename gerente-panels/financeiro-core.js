// Auto-extraído do gerente.html (Onda 4 — quinta passada).
// DRE + Balanço Patrimonial + Conciliação Bancária + Boletos Inter.
// Cluster de financeiro core (NBC TG 1000). Funções chamadas via
// onclick + panel switchers finDre/finBalanco/conciliacaoBancaria/
// boletosInter.
  // ── DRE ────────────────────────────────────────────
  async function loadFinDre() {
    const ano = document.getElementById('dreAno').value;
    const d = await api({ action:'fin_dre', ano });
    if (d.error) { document.getElementById('dreContent').innerHTML = '<div class="empty-state">Erro.</div>'; return; }
    const fmtR = v => 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2});
    const MS = MESES_CURTOS;
    const sumArr = arr => (arr||[]).reduce((s,v)=>s+v,0);
    const thStyle = 'text-align:right;padding:8px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);border-bottom:2px solid var(--border);';
    const renderAccounts = (items, color) => {
      if (!items || !items.length) return '';
      return items.map(c => {
        const meses = c.meses || new Array(12).fill(0);
        const total = meses.reduce((s,v)=>s+v,0);
        if (total === 0 && !meses.some(v=>v!==0)) return '';
        return `<tr>
          <td style="padding:6px 12px;font-size:12px;border-bottom:1px solid #f5f0ea;padding-left:24px;">${esc(c.codigo||'')} ${esc(c.nome)}</td>
          ${meses.map(v => `<td style="padding:6px 8px;text-align:right;font-size:11px;border-bottom:1px solid #f5f0ea;color:${v!==0?color:'var(--muted)'};">${v!==0?fmtR(v):'—'}</td>`).join('')}
          <td style="padding:6px 8px;text-align:right;font-size:12px;font-weight:700;border-bottom:1px solid #f5f0ea;color:${color};">${fmtR(total)}</td>
        </tr>`;
      }).join('');
    };
    const sectionHeader = (title, color, bg) => `<tr style="background:${bg||'#f5f0ea'};"><td colspan="14" style="padding:8px 12px;font-weight:700;font-size:13px;color:${color};">${title}</td></tr>`;
    const subtotalRow = (label, mesArr, color, bg) => {
      const arr = mesArr || new Array(12).fill(0);
      return `<tr style="background:${bg||'#fafaf8'};"><td style="padding:6px 12px;font-weight:700;font-size:12px;color:${color};">${label}</td>
        ${arr.map(v => `<td style="padding:6px 8px;text-align:right;font-weight:700;font-size:11px;color:${color};">${fmtR(v)}</td>`).join('')}
        <td style="padding:6px 8px;text-align:right;font-weight:700;font-size:13px;color:${color};">${fmtR(sumArr(arr))}</td>
      </tr>`;
    };
    const resultRow = (label, mesArr, fontSize, bg) => {
      const arr = mesArr || new Array(12).fill(0);
      return `<tr style="background:${bg||'#f0f7ff'};border-top:2px solid var(--border);"><td style="padding:10px 12px;font-weight:700;font-size:${fontSize||'14'}px;">${label}</td>
        ${arr.map(v => `<td style="padding:6px 8px;text-align:right;font-weight:700;font-size:${Math.max(11,parseInt(fontSize||14)-1)}px;color:${v>=0?'#2d7a3a':'#e53e3e'};">${fmtR(v)}</td>`).join('')}
        <td style="padding:6px 8px;text-align:right;font-weight:700;font-size:${parseInt(fontSize||14)+2}px;color:${sumArr(arr)>=0?'#2d7a3a':'#e53e3e'};">${fmtR(sumArr(arr))}</td>
      </tr>`;
    };
    document.getElementById('dreContent').innerHTML = `
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th style="text-align:left;padding:8px 12px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);border-bottom:2px solid var(--border);min-width:220px;">Conta</th>
          ${MS.map(m => `<th style="${thStyle}">${m}</th>`).join('')}
          <th style="${thStyle}">TOTAL</th>
        </tr></thead>
        <tbody>
          ${sectionHeader('RECEITA OPERACIONAL','#2d7a3a','#edf7f0')}
          ${renderAccounts(d.receita_operacional,'#2d7a3a')}
          ${subtotalRow('Subtotal Receita Operacional', d.total_receita_operacional_mes,'#2d7a3a','#edf7f0')}

          ${sectionHeader('(-) CUSTO DOS SERVIÇOS PRESTADOS','#e53e3e','#fdf0f2')}
          ${renderAccounts(d.csp,'#e53e3e')}
          ${subtotalRow('Subtotal CSP', d.total_csp_mes,'#e53e3e','#fdf0f2')}

          ${resultRow('= LUCRO BRUTO', d.lucro_bruto_mes,'14','#f0f7ff')}

          ${sectionHeader('(-) DESPESAS ADMINISTRATIVAS','#e53e3e','#f5f0ea')}
          ${renderAccounts(d.despesas_administrativas,'#e53e3e')}
          ${subtotalRow('Subtotal Desp. Administrativas', d.total_desp_adm_mes,'#e53e3e','#fafaf8')}

          ${sectionHeader('(-) DESPESAS COMERCIAIS','#e53e3e','#f5f0ea')}
          ${renderAccounts(d.despesas_comerciais,'#e53e3e')}
          ${subtotalRow('Subtotal Desp. Comerciais', d.total_desp_com_mes,'#e53e3e','#fafaf8')}

          ${resultRow('= RESULTADO OPERACIONAL', d.resultado_operacional_mes,'14','#f0f7ff')}

          ${sectionHeader('(+) RECEITAS FINANCEIRAS','#2d7a3a','#edf7f0')}
          ${renderAccounts(d.receita_financeira,'#2d7a3a')}
          ${subtotalRow('Subtotal Rec. Financeiras', d.total_rec_fin_mes,'#2d7a3a','#edf7f0')}

          ${sectionHeader('(-) DESPESAS FINANCEIRAS','#e53e3e','#fdf0f2')}
          ${renderAccounts(d.despesas_financeiras,'#e53e3e')}
          ${subtotalRow('Subtotal Desp. Financeiras', d.total_desp_fin_mes,'#e53e3e','#fdf0f2')}

          ${sectionHeader('(-) IMPOSTOS SOBRE RECEITA','#e53e3e','#f5f0ea')}
          ${renderAccounts(d.impostos,'#e53e3e')}
          ${subtotalRow('Subtotal Impostos', d.total_impostos_mes,'#e53e3e','#fafaf8')}

          ${resultRow('= RESULTADO DO EXERCÍCIO', d.resultado_mes,'16','#f0f7ff')}
        </tbody>
      </table></div>`;
  }

  // ── BALANCO PATRIMONIAL ────────────────────────────
  async function loadFinBalanco() {
    const mes = document.getElementById('balancoMes').value || new Date().toISOString().slice(0,7);
    if (!document.getElementById('balancoMes').value) monthNavSet('balancoMes', mes);
    const d = await api({ action:'fin_balanco', mes });
    if (d.error) { document.getElementById('balancoContent').innerHTML = '<div class="empty-state">Erro.</div>'; return; }
    const fmtR = v => 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2});
    const renderGroup = (title, items, color) => `
      <div style="margin-bottom:20px;">
        <div style="font-size:14px;font-weight:700;color:${color};padding:8px 0;border-bottom:2px solid ${color};">${title}</div>
        ${(items||[]).map(c => `<div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #f5f0ea;">
          <span style="font-size:13px;">${esc(c.codigo||'')} ${esc(c.nome)}</span>
          <span style="font-size:13px;font-weight:600;color:${parseFloat(c.saldo||0)<0?'#e53e3e':'inherit'};">${fmtR(c.saldo)}</span>
        </div>`).join('')}
      </div>`;
    const renderSubtotal = (label, value, color) => `
      <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#fafaf8;border-bottom:2px solid ${color};margin-bottom:12px;">
        <span style="font-size:13px;font-weight:700;color:${color};">${label}</span>
        <span style="font-size:13px;font-weight:700;color:${color};">${fmtR(value)}</span>
      </div>`;
    document.getElementById('balancoContent').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div>
          ${renderGroup('ATIVO CIRCULANTE', d.ativo_circulante, '#1a6bb5')}
          ${renderSubtotal('Subtotal Ativo Circulante', d.total_ativo_circulante, '#1a6bb5')}
          ${renderGroup('ATIVO NAO CIRCULANTE', d.ativo_nao_circulante, '#1a6bb5')}
          ${renderSubtotal('Subtotal Ativo Nao Circulante', d.total_ativo_nao_circulante, '#1a6bb5')}
          <div style="display:flex;justify-content:space-between;padding:14px;background:#f0f7ff;border-radius:8px;font-weight:700;font-size:17px;color:#1a6bb5;margin-top:8px;">
            <span>TOTAL ATIVO</span><span>${fmtR(d.total_ativo)}</span>
          </div>
        </div>
        <div>
          ${renderGroup('PASSIVO CIRCULANTE', d.passivo_circulante, '#e53e3e')}
          ${renderSubtotal('Subtotal Passivo Circulante', d.total_passivo_circulante, '#e53e3e')}
          ${renderGroup('PASSIVO NAO CIRCULANTE', d.passivo_nao_circulante, '#e53e3e')}
          ${renderSubtotal('Subtotal Passivo Nao Circulante', d.total_passivo_nao_circulante, '#e53e3e')}
          ${renderGroup('PATRIMONIO LIQUIDO', d.patrimonio, '#6b3fa0')}
          <div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #f5f0ea;">
            <span style="font-size:13px;font-style:italic;">Resultado do Periodo</span>
            <span style="font-size:13px;font-weight:600;color:${parseFloat(d.lucro_periodo||0)>=0?'#2d7a3a':'#e53e3e'};">${fmtR(d.lucro_periodo)}</span>
          </div>
          ${renderSubtotal('Subtotal PL', d.total_pl, '#6b3fa0')}
          <div style="display:flex;justify-content:space-between;padding:14px;background:#fdf0f2;border-radius:8px;font-weight:700;font-size:17px;color:#e53e3e;margin-top:8px;">
            <span>TOTAL PASSIVO + PL</span><span>${fmtR(parseFloat(d.total_passivo_circulante||0) + parseFloat(d.total_passivo_nao_circulante||0) + parseFloat(d.total_pl||0))}</span>
          </div>
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:12px;">Para editar saldos patrimoniais, use o Plano de Contas.</p>`;
  }

  // ── CONCILIACAO BANCARIA ──────────────────────────
  async function loadFinConciliacao() {
    const mes = document.getElementById('concMes').value || new Date().toISOString().slice(0,7);
    if (!document.getElementById('concMes').value) monthNavSet('concMes', mes);
    const d = await api({ action:'fin_extrato_list', mes });
    const items = Array.isArray(d) ? d : [];
    const el = document.getElementById('concContent');
    if (!items.length) { el.innerHTML = '<div class="empty-state">Nenhum extrato importado para este mes. Importe um arquivo Excel ou OFX.</div>'; return; }
    const fmtR = v => 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2});
    const conciliados = items.filter(i => i.conciliado).length;
    el.innerHTML = `
      <div style="margin-bottom:12px;font-size:13px;color:var(--muted);">${conciliados}/${items.length} conciliados</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th style="text-align:left;padding:8px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Data</th>
          <th style="text-align:left;padding:8px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Descricao</th>
          <th style="text-align:right;padding:8px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Valor</th>
          <th style="padding:8px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Status</th>
          <th style="padding:8px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Lancamento</th>
        </tr></thead>
        <tbody>${items.map(it => `<tr style="${it.conciliado?'background:#f0fdf4;':''}">
          <td style="padding:8px;font-size:12px;border-bottom:1px solid #f5f0ea;">${new Date(it.data_transacao+'T12:00:00').toLocaleDateString('pt-BR')}</td>
          <td style="padding:8px;font-size:12px;border-bottom:1px solid #f5f0ea;">${esc(it.descricao)}</td>
          <td style="padding:8px;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #f5f0ea;color:${it.tipo==='credito'?'#2d7a3a':'#e53e3e'};">${it.tipo==='credito'?'+':'−'} ${fmtR(it.valor)}</td>
          <td style="padding:8px;border-bottom:1px solid #f5f0ea;"><span style="font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;${it.conciliado?'background:#edf7f0;color:#2d7a3a;':'background:#fff8e1;color:#b07d00;'}">${it.conciliado?'Conciliado':'Pendente'}</span></td>
          <td style="padding:8px;font-size:11px;border-bottom:1px solid #f5f0ea;color:var(--muted);">${it.fin_lancamentos?.descricao||'—'}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  }

  async function importarExtrato(input) {
    const file = input.files[0]; if (!file) return; input.value = '';
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type:'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, defval:'' });
      const itens = rows.slice(1).filter(r => r[0] && r[2]).map(r => ({
        data: typeof r[0]==='number' ? new Date((r[0]-25569)*86400*1000).toISOString().slice(0,10) : String(r[0]).trim(),
        descricao: String(r[1]||'').trim(), valor: parseFloat(String(r[2]).replace(',','.')) || 0, saldo: r[3] ? parseFloat(String(r[3]).replace(',','.')) : null,
      }));
      if (!itens.length) { showToast('Nenhum item no extrato.','warning'); return; }
      const d = await api({ action:'fin_extrato_importar', itens });
      showToast(d.importados + ' transacoes importadas!','success');
      loadFinConciliacao();
    } catch(e) { showToast('Erro ao ler extrato.','error'); }
  }

  async function autoConciliar() {
    const mes = document.getElementById('concMes').value || new Date().toISOString().slice(0,7);
    const d = await api({ action:'fin_extrato_auto_conciliar', mes });
    showToast(d.conciliados + ' transacoes conciliadas automaticamente!','success');
    loadFinConciliacao();
  }

  // ── BOLETOS INTER ──────────────────────────────────
  function toggleEmitirBoleto() { const el=document.getElementById('emitirBoletoForm'); el.style.display=el.style.display==='none'?'block':'none'; }

  async function emitirBoleto() {
    const cpf = document.getElementById('bolCpf').value.trim();
    const nome = document.getElementById('bolNome').value.trim();
    const valor = document.getElementById('bolValor').value;
    const venc = document.getElementById('bolVenc').value;
    const desc = document.getElementById('bolDesc').value.trim();
    const errEl = document.getElementById('bolErr');
    errEl.classList.remove('show');
    if (!cpf || !valor || !venc) { errEl.textContent='CPF, valor e vencimento obrigatorios.'; errEl.classList.add('show'); return; }
    const btn = document.getElementById('bolBtn');
    btn.disabled=true; btn.textContent='Emitindo...';
    const d = await api({ action:'fin_emitir_boleto', cpf_pagador:cpf, nome_pagador:nome, valor, vencimento:venc, descricao:desc||'Mensalidade ' + SCHOOL_NAME });
    btn.disabled=false; btn.textContent='Emitir Boleto no Inter';
    if (d.error) { errEl.textContent=d.error; errEl.classList.add('show'); return; }
    showToast('Boleto emitido! N° ' + (d.nosso_numero||'—'),'success',5000);
    toggleEmitirBoleto();
    loadFinBoletos();
  }

  function initBoletosFiltroMes() {
    const el = document.getElementById('bolFiltroMes');
    if (el && !el.value) el.value = new Date().toISOString().slice(0,7);
  }
  function limparFiltrosBoletos() {
    document.getElementById('bolFiltroMes').value = new Date().toISOString().slice(0,7);
    document.getElementById('bolFiltroEmissaoIni').value = '';
    document.getElementById('bolFiltroEmissaoFim').value = '';
    document.getElementById('bolFiltroVencIni').value = '';
    document.getElementById('bolFiltroVencFim').value = '';
    document.getElementById('bolFiltroPessoa').value = '';
    loadFinBoletos();
  }
  async function loadFinBoletos() {
    initBoletosFiltroMes();
    const mes = document.getElementById('bolFiltroMes').value;
    const emissao_inicio = document.getElementById('bolFiltroEmissaoIni').value;
    const emissao_fim = document.getElementById('bolFiltroEmissaoFim').value;
    const vencimento_inicio = document.getElementById('bolFiltroVencIni').value;
    const vencimento_fim = document.getElementById('bolFiltroVencFim').value;
    const pessoa = document.getElementById('bolFiltroPessoa').value.trim();
    const params = { action:'fin_boletos_emitidos_list' };
    if (vencimento_inicio && vencimento_fim) { params.vencimento_inicio = vencimento_inicio; params.vencimento_fim = vencimento_fim; }
    else if (mes) { params.mes = mes; }
    if (emissao_inicio) params.emissao_inicio = emissao_inicio;
    if (emissao_fim) params.emissao_fim = emissao_fim;
    if (pessoa) params.pessoa = pessoa;
    const d = await api(params);
    const items = Array.isArray(d) ? d : [];
    const el = document.getElementById('finBoletosContent');
    const fmtR = v => 'R$ '+parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2});
    if (!items.length) { el.innerHTML='<div class="empty-state">Nenhum boleto emitido.</div>'; return; }
    items.forEach(b => _cacheBoleto(b));
    el.innerHTML = items.map(b => {
      const isManual = b.baixa_manual === true;
      const isVencido = b.status === 'emitido' && b.vencimento < new Date().toISOString().slice(0,10);
      const badgeStyle = b.status==='pago' && isManual ? 'background:#e8eaf6;color:#5c6bc0;border:1px solid #c5cae9;' : b.status==='pago' ? 'background:#edf7f0;color:#2d7a3a;' : b.status==='cancelado' ? 'background:#f5f0ea;color:var(--muted);' : isVencido ? 'background:#fde8e8;color:#EF4444;' : 'background:#fff8e1;color:#b07d00;';
      const statusLabel = b.status==='pago' && isManual ? 'Pago (manual)' : b.status==='pago' ? 'Pago' : b.status==='cancelado' ? 'Cancelado' : isVencido ? 'Vencido' : 'Pendente';
      let manualInfo = '';
      if (isManual) {
        manualInfo = `<div style="font-size:10px;color:#5c6bc0;margin-top:2px;">Por: ${esc(b.baixa_manual_por||'—')}${b.baixa_manual_em?' · '+new Date(b.baixa_manual_em).toLocaleString('pt-BR'):''}${b.baixa_manual_obs?'<br>Obs: '+esc(b.baixa_manual_obs):''}</div>`;
      }
      let acoes = '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">';
      if (b.status === 'emitido') {
        acoes += `<button onclick="alunoFinBaixaManual('${b.id}')" style="padding:3px 8px;font-size:10px;background:#5c6bc0;color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit;font-weight:600;">Marcar pago</button>`;
        acoes += `<button onclick="alunoFinCancelar('${b.id}')" style="padding:3px 8px;font-size:10px;background:#EF4444;color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit;">Cancelar</button>`;
      }
      if (b.status !== 'cancelado') {
        acoes += `<button onclick="alunoFinBaixarPdf('${b.id}')" style="padding:3px 8px;font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:5px;cursor:pointer;font-family:inherit;">📄 PDF</button>`;
        acoes += `<button onclick="alunoFinEnviarEmail('${b.id}','${esc(b.familia_email||'')}')" style="padding:3px 8px;font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:5px;cursor:pointer;font-family:inherit;">📧 Email</button>`;
        acoes += `<button onclick="alunoFinEnviarWhatsApp('${b.id}')" style="padding:3px 8px;font-size:10px;background:#25D366;color:#fff;border:none;border-radius:5px;cursor:pointer;font-family:inherit;">💬 WhatsApp</button>`;
      }
      if (b.pix_copia_cola) acoes += `<button onclick="navigator.clipboard.writeText('${esc(b.pix_copia_cola)}');showToast('PIX copiado!','success')" style="padding:3px 8px;font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:5px;cursor:pointer;font-family:inherit;">📋 PIX</button>`;
      acoes += '</div>';
      return `<div style="padding:12px;background:${isManual?'#f5f5ff':'#fff'};border:1px solid var(--border);border-radius:10px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="font-weight:600;font-size:13px;">${esc(b.crianca_nome||b.familia_nome||b.cpf_pagador)}</div>
            <div style="font-size:11px;color:var(--muted);">${esc(b.descricao||'—')} · Venc: ${new Date(b.vencimento+'T12:00:00').toLocaleDateString('pt-BR')}</div>
            ${b.linha_digitavel?`<div style="font-size:10px;color:var(--muted);margin-top:2px;font-family:monospace;">${esc(b.linha_digitavel)}</div>`:''}
          </div>
          <div style="font-size:16px;font-weight:700;">${fmtR(b.valor)}</div>
          <div><span style="font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;${badgeStyle}">${statusLabel}</span>${manualInfo}</div>
        </div>
        ${acoes}
      </div>`;
    }).join('');
  }

