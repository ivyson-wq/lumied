// Auto-extraído do gerente.html (Onda 4 do refator).
// Funções globais — chamadas de panel switchers + onclick handlers no HTML.
// Carregado via <script defer> após o inline script principal.
  // ── CRM ────────────────────────────────────────────
  var crmEstagios = [], crmLeads = [];
  function toggleCrmLeadForm() { const el=document.getElementById('crmLeadForm'); el.style.display=el.style.display==='none'?'block':'none'; }


  function baixarExtensaoCrm() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div style="background:#fff;border-radius:16px;max-width:520px;width:100%;padding:28px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
      + '<h3 style="font-family:\'Lora\',serif;font-size:18px;">Extensao Lumied CRM — WhatsApp</h3>'
      + '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);">x</button></div>'
      + '<p style="font-size:13px;color:#555;line-height:1.6;margin-bottom:16px;">Capture leads, envie templates e acompanhe interacoes direto no <strong>WhatsApp Web</strong>. A extensao identifica automaticamente os contatos ja cadastrados no CRM.</p>'
      + '<div style="background:#f8f5f0;border-radius:10px;padding:16px;margin-bottom:16px;">'
      + '<div style="font-size:12px;font-weight:700;margin-bottom:10px;">Como instalar:</div>'
      + '<ol style="font-size:12px;color:#555;line-height:1.8;padding-left:18px;margin:0;">'
      + '<li>Clique em <strong>"Baixar extensao"</strong> abaixo</li>'
      + '<li>Extraia o arquivo <strong>.zip</strong> em uma pasta</li>'
      + '<li>Abra <code style="background:#e5e0d8;padding:1px 6px;border-radius:4px;">chrome://extensions/</code> no Chrome</li>'
      + '<li>Ative o <strong>Modo do desenvolvedor</strong> (canto superior direito)</li>'
      + '<li>Clique em <strong>"Carregar sem compactacao"</strong> e selecione a pasta extraida</li>'
      + '<li>Abra o WhatsApp Web e clique no icone Lumied para fazer login</li>'
      + '</ol></div>'
      + '<div style="display:flex;gap:8px;">'
      + '<a href="/chrome-extension/lumied-crm-whatsapp.zip" download="lumied-crm-whatsapp.zip" style="display:inline-flex;align-items:center;gap:6px;padding:10px 20px;background:linear-gradient(135deg,#C8102E,#9B0D23);color:#fff;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none;font-family:\'DM Sans\',sans-serif;">Baixar extensao (.zip)</a>'
      + '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="padding:10px 16px;background:none;border:1.5px solid var(--border);border-radius:10px;font-size:13px;cursor:pointer;font-family:\'DM Sans\',sans-serif;">Fechar</button>'
      + '</div></div>';
    document.body.appendChild(overlay);
  }
  function gPipeSetView(view, btn) {
    btn.parentElement.querySelectorAll('.gpipe-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('gPipeViewKanban').style.display = view === 'kanban' ? '' : 'none';
    document.getElementById('gPipeViewLista').style.display = view === 'lista' ? '' : 'none';
    if (view === 'lista') loadCrmLeads();
  }
  function toggleCrmTemplateForm() { const el=document.getElementById('crmTemplateForm'); el.style.display=el.style.display==='none'?'block':'none'; }

  async function loadCrmKanban() {
    const [estData, leadData] = await Promise.all([api({action:'crm_estagios_list'}), api({action:'crm_leads_list'})]);
    crmEstagios = Array.isArray(estData) ? estData : [];
    crmLeads = Array.isArray(leadData) ? leadData : [];
    renderKanban();
  }

  function renderKanban() {
    const board = document.getElementById('crmKanbanBoard');
    if (!crmEstagios.length) { board.innerHTML = '<div class="empty-state">Nenhum estagio.</div>'; return; }
    board.innerHTML = crmEstagios.map(est => {
      const leads = crmLeads.filter(l => l.estagio_id === est.id);
      return `<div class="kanban-col">
        <div class="kanban-col-header" style="background:${est.cor}20;color:${est.cor};">
          ${esc(est.nome)} <span style="background:${est.cor};color:#fff;border-radius:10px;padding:1px 8px;font-size:11px;">${leads.length}</span>
        </div>
        <div class="kanban-col-body" ondragover="event.preventDefault()" ondrop="dropLead(event,'${est.id}')">
          ${leads.length ? leads.map(l => `<div class="kanban-card" draggable="true" ondragstart="event.dataTransfer.setData('text','${l.id}')" onclick="if(!event.dataTransfer||!event.dataTransfer.getData('text'))abrirLeadDetalheV2('${l.id}')" style="cursor:pointer;">
            <div class="kc-name">${esc(l.nome_responsavel)}</div>
            <div class="kc-info">
              ${l.nome_crianca ? '👶 ' + esc(l.nome_crianca) + (l.data_nascimento ? ' (' + crmIdadeTexto(l.data_nascimento) + ')' : '') : ''}
              ${l.serie_interesse ? '<br>🎒 ' + esc(l.serie_interesse) : ''}
              ${l.telefone ? '<br>📱 ' + esc(l.telefone) : ''}
              ${l.email ? '<br>📧 ' + esc(l.email) : ''}
              ${l.origem ? '<br>📍 ' + esc(l.origem) : ''}
              ${l.responsavel_interno ? '<br>👤 ' + esc(l.responsavel_interno) : ''}
              ${l.data_proximo_contato ? '<br>📅 Prox: ' + new Date(l.data_proximo_contato+'T12:00:00').toLocaleDateString('pt-BR') : ''}
            </div>
            <div class="kc-actions">
              ${l.telefone ? `<button class="kc-btn" style="color:#2d7a3a;" onclick="event.stopPropagation();abrirWhatsApp('${esc(l.telefone)}','${esc(l.nome_responsavel)}')">WhatsApp</button>` : ''}
            </div>
          </div>`).join('') : '<div style="text-align:center;padding:20px;color:var(--muted);font-size:11px;">Arraste leads aqui</div>'}
        </div>
      </div>`;
    }).join('');
  }

  async function dropLead(e, estagioId) {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text');
    if (!leadId) return;
    await api({ action:'crm_lead_mover', id: leadId, estagio_id: estagioId });
    const lead = crmLeads.find(l => l.id === leadId);
    if (lead) lead.estagio_id = estagioId;
    renderKanban();
  }

  async function salvarCrmLead() {
    const estagios = crmEstagios.length ? crmEstagios : await api({action:'crm_estagios_list'});
    const primeiroEstagio = (Array.isArray(estagios)?estagios:crmEstagios)[0]?.id;
    const d = await api({ action:'crm_lead_save',
      nome_responsavel: document.getElementById('crmNome').value.trim(),
      telefone: document.getElementById('crmTel').value.trim(),
      email: document.getElementById('crmEmail').value.trim(),
      nome_crianca: document.getElementById('crmCrianca').value.trim(),
      data_nascimento: document.getElementById('crmNasc').value || null,
      serie_interesse: document.getElementById('crmSerie').value.trim(),
      origem: document.getElementById('crmOrigem').value,
      valor_mensalidade: document.getElementById('crmValorMens').value || null,
      responsavel_interno: document.getElementById('crmRespInterno').value.trim(),
      data_proximo_contato: document.getElementById('crmProxContato').value || null,
      data_visita: document.getElementById('crmDataVisita').value || null,
      observacoes: document.getElementById('crmObs').value.trim(),
      estagio_id: primeiroEstagio,
    });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Lead salvo!','success'); toggleCrmLeadForm();
    ['crmNome','crmTel','crmEmail','crmCrianca','crmNasc','crmSerie','crmObs','crmValorMens','crmRespInterno','crmProxContato','crmDataVisita'].forEach(id=>{var el=document.getElementById(id);if(el)el.value='';});
    document.getElementById('crmOrigem').value = '';
    document.getElementById('crmSerieAuto').textContent = '';
    loadCrmKanban();
  }

  function abrirWhatsApp(tel, nome) {
    const num = tel.replace(/\D/g,'');
    const fullNum = num.length <= 11 ? '55' + num : num;
    window.open('https://wa.me/' + fullNum, '_blank');
  }

  async function abrirLeadDetalheV2(id) {
    let lead = crmLeads.find(l => l.id === id);
    if (!lead) {
      const all = await api({ action:'crm_leads_list' });
      crmLeads = Array.isArray(all) ? all : [];
      lead = crmLeads.find(l => l.id === id);
    }
    if (!lead) return;
    const intData = await api({ action:'crm_interacoes_list', lead_id: id });
    const interacoes = Array.isArray(intData) ? intData : [];
    const tipoIcons = { ligacao:'📞', email:'📧', whatsapp:'💬', visita:'🏫', reuniao:'📅', nota:'📝', outro:'📌' };

    // Calcula idade
    let idadeStr = '';
    if (lead.data_nascimento) {
      const dn = new Date(lead.data_nascimento + 'T12:00:00');
      const diffMs = Date.now() - dn.getTime();
      const anos = Math.floor(diffMs / (365.25*24*60*60*1000));
      const meses = Math.floor(diffMs / (30.44*24*60*60*1000));
      idadeStr = anos >= 1 ? anos + ' ano' + (anos>1?'s':'') : meses + ' mes' + (meses>1?'es':'');
    }
    const nascFmt = lead.data_nascimento ? new Date(lead.data_nascimento+'T12:00:00').toLocaleDateString('pt-BR') : '';
    const proxFmt = lead.data_proximo_contato ? new Date(lead.data_proximo_contato+'T12:00:00').toLocaleDateString('pt-BR') : '';
    const visitaFmt = lead.data_visita ? new Date(lead.data_visita+'T12:00:00').toLocaleDateString('pt-BR') : '';
    const estNome = lead.crm_estagios?.nome || 'Sem estagio';
    const estCor = lead.crm_estagios?.cor || '#6b7280';
    const v = (val) => val ? esc(String(val)) : '<span style="color:#ccc;">—</span>';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;';
    overlay.onclick = e => { if(e.target===overlay) overlay.remove(); };
    overlay.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:750px;width:100%;padding:28px;max-height:85vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <h3 style="font-family:'Lora',serif;font-size:18px;margin:0;">${esc(lead.nome_responsavel)}</h3>
        <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);">x</button>
      </div>
      <div style="margin-bottom:16px;"><span style="font-size:11px;padding:2px 10px;border-radius:10px;font-weight:600;background:${estCor}20;color:${estCor};border:1px solid ${estCor}40;">${esc(estNome)}</span></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;font-size:13px;margin-bottom:16px;border:1px solid var(--border);border-radius:10px;overflow:hidden;">
        <div style="padding:10px 12px;border-bottom:1px solid var(--border);background:#faf8f5;"><span style="font-size:11px;color:var(--muted);display:block;">Telefone</span><strong>${v(lead.telefone)}</strong></div>
        <div style="padding:10px 12px;border-bottom:1px solid var(--border);border-left:1px solid var(--border);background:#faf8f5;"><span style="font-size:11px;color:var(--muted);display:block;">Email</span><strong>${v(lead.email)}</strong></div>
        <div style="padding:10px 12px;border-bottom:1px solid var(--border);"><span style="font-size:11px;color:var(--muted);display:block;">Crianca</span><strong>${v(lead.nome_crianca)}</strong></div>
        <div style="padding:10px 12px;border-bottom:1px solid var(--border);border-left:1px solid var(--border);"><span style="font-size:11px;color:var(--muted);display:block;">Nascimento / Idade</span><strong>${nascFmt ? nascFmt + ' (' + idadeStr + ')' : v(null)}</strong></div>
        <div style="padding:10px 12px;border-bottom:1px solid var(--border);background:#faf8f5;"><span style="font-size:11px;color:var(--muted);display:block;">Serie de Interesse</span><strong>${v(lead.serie_interesse)}</strong></div>
        <div style="padding:10px 12px;border-bottom:1px solid var(--border);border-left:1px solid var(--border);background:#faf8f5;"><span style="font-size:11px;color:var(--muted);display:block;">Origem</span><strong>${v(lead.origem)}</strong></div>
        <div style="padding:10px 12px;border-bottom:1px solid var(--border);"><span style="font-size:11px;color:var(--muted);display:block;">Valor Mensalidade</span><strong>${lead.valor_mensalidade ? 'R$ '+parseFloat(lead.valor_mensalidade).toLocaleString('pt-BR',{minimumFractionDigits:2}) : v(null)}</strong></div>
        <div style="padding:10px 12px;border-bottom:1px solid var(--border);border-left:1px solid var(--border);"><span style="font-size:11px;color:var(--muted);display:block;">Responsavel Interno</span><strong>${v(lead.responsavel_interno)}</strong></div>
        <div style="padding:10px 12px;"><span style="font-size:11px;color:var(--muted);display:block;">Proximo Contato</span><strong>${proxFmt || v(null)}</strong></div>
        <div style="padding:10px 12px;border-left:1px solid var(--border);"><span style="font-size:11px;color:var(--muted);display:block;">Data Visita</span><strong>${visitaFmt || v(null)}</strong></div>
      </div>
      ${lead.observacoes?`<div style="font-size:12px;color:#555;margin-bottom:12px;padding:10px;background:#f5f0ea;border-radius:8px;line-height:1.5;">${esc(lead.observacoes)}</div>`:''}
      <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;">
        <button onclick="document.getElementById('ldEditForm').style.display=document.getElementById('ldEditForm').style.display==='none'?'block':'none'" style="padding:6px 12px;background:var(--bg);border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">✏️ Editar</button>
        ${lead.telefone?`<button onclick="abrirWhatsApp('${esc(lead.telefone)}','${esc(lead.nome_responsavel)}')" style="padding:6px 12px;background:#25D366;color:#0a3d12;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">💬 WhatsApp</button>`:''}
        <button onclick="this.closest('div[style*=fixed]').remove();agendarReuniaoCrm('${id}','${esc(lead.nome_responsavel)}')" style="padding:6px 12px;background:#1a6bb5;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">📅 Agendar Reuniao</button>
        <button onclick="criarMatriculaDoLead('${id}')" style="padding:6px 12px;background:#2d7a3a;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">📝 Registrar Reserva/Matricula</button>
      </div>
      <div id="ldEditForm" style="display:none;margin-bottom:16px;padding:16px;background:#faf8f5;border:1px solid var(--border);border-radius:10px;">
        <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px;">EDITAR LEAD</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px;">
          <div><label style="display:block;font-size:10px;color:var(--muted);margin-bottom:2px;">Nome Responsavel *</label><input type="text" id="ldEdNome" value="${esc(lead.nome_responsavel||'')}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;"></div>
          <div><label style="display:block;font-size:10px;color:var(--muted);margin-bottom:2px;">Telefone</label><input type="text" id="ldEdTel" value="${esc(lead.telefone||'')}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;"></div>
          <div><label style="display:block;font-size:10px;color:var(--muted);margin-bottom:2px;">Email</label><input type="email" id="ldEdEmail" value="${esc(lead.email||'')}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;"></div>
          <div><label style="display:block;font-size:10px;color:var(--muted);margin-bottom:2px;">Nome Crianca</label><input type="text" id="ldEdCrianca" value="${esc(lead.nome_crianca||'')}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;"></div>
          <div><label style="display:block;font-size:10px;color:var(--muted);margin-bottom:2px;">Data Nascimento</label><input type="date" id="ldEdNasc" value="${lead.data_nascimento||''}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;"></div>
          <div><label style="display:block;font-size:10px;color:var(--muted);margin-bottom:2px;">Serie Interesse</label><input type="text" id="ldEdSerie" value="${esc(lead.serie_interesse||'')}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;"></div>
          <div><label style="display:block;font-size:10px;color:var(--muted);margin-bottom:2px;">Origem</label><select id="ldEdOrigem" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;"><option value="">—</option><option value="indicacao"${lead.origem==='indicacao'?' selected':''}>Indicacao</option><option value="site"${lead.origem==='site'?' selected':''}>Site</option><option value="instagram"${lead.origem==='instagram'?' selected':''}>Instagram</option><option value="facebook"${lead.origem==='facebook'?' selected':''}>Facebook</option><option value="whatsapp"${lead.origem==='whatsapp'?' selected':''}>WhatsApp</option><option value="evento"${lead.origem==='evento'?' selected':''}>Evento</option><option value="outro"${lead.origem==='outro'?' selected':''}>Outro</option></select></div>
          <div><label style="display:block;font-size:10px;color:var(--muted);margin-bottom:2px;">Valor Mensalidade</label><input type="number" id="ldEdValor" step="0.01" value="${lead.valor_mensalidade||''}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;"></div>
          <div><label style="display:block;font-size:10px;color:var(--muted);margin-bottom:2px;">Responsavel Interno</label><input type="text" id="ldEdResp" value="${esc(lead.responsavel_interno||'')}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;"></div>
          <div><label style="display:block;font-size:10px;color:var(--muted);margin-bottom:2px;">Proximo Contato</label><input type="date" id="ldEdProx" value="${lead.data_proximo_contato||''}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;"></div>
          <div><label style="display:block;font-size:10px;color:var(--muted);margin-bottom:2px;">Data Visita</label><input type="date" id="ldEdVisita" value="${lead.data_visita||''}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;"></div>
          <div><label style="display:block;font-size:10px;color:var(--muted);margin-bottom:2px;">Observacoes</label><input type="text" id="ldEdObs" value="${esc(lead.observacoes||'')}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;"></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button onclick="salvarLeadEdicao('${id}')" style="padding:6px 16px;background:var(--red);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Salvar</button>
          <button onclick="document.getElementById('ldEditForm').style.display='none'" style="padding:6px 12px;background:none;border:1px solid var(--border);border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit;">Cancelar</button>
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;margin-bottom:6px;">Nova interacao:</div>
        <div style="display:flex;gap:6px;">
          <select id="crmIntTipo" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:'DM Sans',sans-serif;">
            <option value="nota">Nota</option><option value="ligacao">Ligacao</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="visita">Visita</option>
          </select>
          <input type="text" id="crmIntDesc" placeholder="Descreva..." style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:'DM Sans',sans-serif;">
          <button onclick="salvarCrmInteracao('${id}')" style="padding:6px 12px;background:var(--red);color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">Salvar</button>
        </div>
      </div>
      <div style="font-size:12px;font-weight:700;margin-bottom:6px;">Historico (${interacoes.length})</div>
      ${(function() {
        if (!interacoes.length) return '<div style="color:var(--muted);font-size:12px;">Nenhuma interacao.</div>';
        var days = {};
        interacoes.forEach(function(i) {
          var d = new Date(i.criado_em).toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
          if (!days[d]) days[d] = [];
          days[d].push(i);
        });
        return Object.keys(days).map(function(day) {
          return '<div style="margin-bottom:14px;"><div style="font-size:11px;font-weight:700;color:var(--red);text-transform:capitalize;padding:4px 0;border-bottom:2px solid var(--red);margin-bottom:6px;">' + day + '</div>'
            + days[day].map(function(i) {
              return '<div style="padding:6px 0 6px 12px;border-left:2px solid #e5e0d8;margin-left:4px;font-size:12px;">'
                + '<span>' + (tipoIcons[i.tipo]||'📌') + '</span> '
                + '<span style="white-space:pre-wrap;">' + esc(i.descricao) + '</span>'
                + '<div style="font-size:10px;color:var(--muted);margin-top:2px;">' + new Date(i.criado_em).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) + (i.criado_por ? ' · ' + esc(i.criado_por) : '') + '</div>'
                + '</div>';
            }).join('') + '</div>';
        }).join('');
      })()}
    </div>`;
    document.body.appendChild(overlay);
  }

  async function salvarLeadEdicao(leadId) {
    var nome = document.getElementById('ldEdNome').value.trim();
    if (!nome) { showToast('Nome obrigatorio','error'); return; }
    var d = await api({ action:'crm_lead_save', id: leadId,
      nome_responsavel: nome,
      telefone: document.getElementById('ldEdTel').value.trim(),
      email: document.getElementById('ldEdEmail').value.trim(),
      nome_crianca: document.getElementById('ldEdCrianca').value.trim(),
      data_nascimento: document.getElementById('ldEdNasc').value || null,
      serie_interesse: document.getElementById('ldEdSerie').value.trim(),
      origem: document.getElementById('ldEdOrigem').value,
      valor_mensalidade: document.getElementById('ldEdValor').value || null,
      responsavel_interno: document.getElementById('ldEdResp').value.trim(),
      data_proximo_contato: document.getElementById('ldEdProx').value || null,
      data_visita: document.getElementById('ldEdVisita').value || null,
      observacoes: document.getElementById('ldEdObs').value.trim(),
    });
    if (d && d.error) { showToast('Erro: '+d.error,'error'); return; }
    showToast('Lead atualizado!','success');
    document.querySelector('div[style*=fixed]')?.remove();
    loadCrmKanban();
    abrirLeadDetalheV2(leadId);
  }

  async function salvarCrmInteracao(leadId) {
    const tipo = document.getElementById('crmIntTipo').value;
    const desc = document.getElementById('crmIntDesc').value.trim();
    if (!desc) return;
    await api({ action:'crm_interacao_save', lead_id: leadId, tipo, descricao: desc });
    document.querySelector('div[style*=fixed]')?.remove();
    abrirLeadDetalheV2(leadId);
  }

  function agendarReuniaoCrm(leadId, nome) {
    const titulo = prompt('Titulo da reuniao:', 'Visita ' + nome);
    if (!titulo) return;
    const data = prompt('Data e hora (AAAA-MM-DD HH:MM):', new Date().toISOString().slice(0,16).replace('T',' '));
    if (!data) return;
    api({ action:'crm_reuniao_save', lead_id: leadId, titulo, data_hora: data.replace(' ','T') + ':00', local: SCHOOL_NAME }).then(d => {
      if (d.error) showToast(d.error,'error');
      else {
        showToast('Reuniao agendada!','success');
        // Abrir Google Calendar
        const dtStart = data.replace(/[-: ]/g,'').slice(0,15) + '00';
        const dtEnd = new Date(new Date(data.replace(' ','T')).getTime()+30*60000).toISOString().replace(/[-:]/g,'').slice(0,15) + '00';
        window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(titulo)}&dates=${dtStart}/${dtEnd}&location=${encodeURIComponent(SCHOOL_NAME)}&details=${encodeURIComponent('Lead: '+nome)}`, '_blank');
      }
    });
  }

  function crmIdadeTexto(dataNasc) {
    if (!dataNasc) return '';
    const nasc = new Date(dataNasc + 'T12:00:00');
    const hoje = new Date();
    let anos = hoje.getFullYear() - nasc.getFullYear();
    let meses = hoje.getMonth() - nasc.getMonth();
    if (meses < 0) { anos--; meses += 12; }
    if (hoje.getDate() < nasc.getDate()) meses--;
    if (meses < 0) { anos--; meses += 12; }
    if (anos < 1) return meses + ' meses';
    if (anos === 1 && meses > 0) return '1 ano e ' + meses + 'm';
    if (anos === 1) return '1 ano';
    return anos + ' anos' + (meses > 0 ? ' e ' + meses + 'm' : '');
  }

  async function crmAutoSerie() {
    const nasc = document.getElementById('crmNasc').value;
    if (!nasc) return;
    const d = await api({ action: 'crm_calcular_serie', data_nascimento: nasc });
    const el = document.getElementById('crmSerieAuto');
    if (d.serie) {
      document.getElementById('crmSerie').value = d.serie;
      el.textContent = '(auto: ' + d.serie + ')';
    } else {
      el.textContent = '(idade: ' + Math.floor(d.idade_meses / 12) + ' anos)';
    }
  }

  // ── CRM METAS COMERCIAIS ─────────────────
  let gMetasAno = new Date().getFullYear();
  function gMetasAnoNav(delta) { gMetasAno += delta; loadCrmMetas(); }

  async function loadCrmMetas() {
    const ano = gMetasAno;
    document.getElementById('gMetasAnoDisplay').textContent = ano;
    const mesesNomes = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    // Fetch metas + realized data
    const [metasResp, leadsResp, matsResp] = await Promise.all([
      api({ action:'crm_metas_list', ano }),
      api({ action:'crm_leads_list' }),
      api({ action:'crm_matriculas_list', ano })
    ]);
    const metas = Array.isArray(metasResp) ? metasResp : [];
    const leads = Array.isArray(leadsResp) ? leadsResp : [];
    const mats = Array.isArray(matsResp) ? matsResp : [];
    // Count realized per month
    const leadsPorMes = {};
    leads.forEach(l => { if(l.criado_em) { const d=new Date(l.criado_em); if(d.getFullYear()===ano) { const m=d.getMonth()+1; leadsPorMes[m]=(leadsPorMes[m]||0)+1; } } });
    const matsPorMes = {};
    mats.forEach(m => { if(m.criado_em) { const d=new Date(m.criado_em); const mo=d.getMonth()+1; matsPorMes[mo]=(matsPorMes[mo]||0)+1; } });
    // Build editable rows for all 12 months
    const metaMap = {};
    metas.forEach(m => { metaMap[m.mes] = m; });
    const mesAtual = new Date().getMonth()+1;
    let tML=0,tRL=0,tMM=0,tRM=0,tMV=0;
    let rows = '';
    for (let m=1; m<=12; m++) {
      const meta = metaMap[m] || {};
      const rL = leadsPorMes[m] || 0;
      const rM = matsPorMes[m] || 0;
      const mL = meta.meta_leads || '';
      const mM = meta.meta_matriculas || '';
      const mV = meta.meta_valor || '';
      tML += parseInt(mL)||0; tRL += rL; tMM += parseInt(mM)||0; tRM += rM; tMV += parseFloat(mV)||0;
      const isCurrent = m === mesAtual && ano === new Date().getFullYear();
      rows += `<tr style="${isCurrent?'background:rgba(26,107,181,.06);':''}" data-mes="${m}">
        <td style="padding:8px 12px;font-weight:${isCurrent?'700':'500'};border-bottom:1px solid #f5f0ea;">${mesesNomes[m]}${isCurrent?' *':''}</td>
        <td style="text-align:center;border-bottom:1px solid #f5f0ea;"><input type="number" min="0" class="gm-input gm-ml" value="${mL}" style="width:70px;padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:12px;text-align:center;font-family:'DM Sans',sans-serif;"></td>
        <td style="text-align:center;border-bottom:1px solid #f5f0ea;font-weight:600;color:var(--accent,#1a6bb5);">${rL}</td>
        <td style="text-align:center;border-bottom:1px solid #f5f0ea;"><input type="number" min="0" class="gm-input gm-mm" value="${mM}" style="width:70px;padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:12px;text-align:center;font-family:'DM Sans',sans-serif;"></td>
        <td style="text-align:center;border-bottom:1px solid #f5f0ea;font-weight:600;color:#2d7a3a;">${rM}</td>
        <td style="text-align:center;border-bottom:1px solid #f5f0ea;"><input type="number" min="0" step="100" class="gm-input gm-mv" value="${mV}" style="width:100px;padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:12px;text-align:center;font-family:'DM Sans',sans-serif;"></td>
        <td style="border-bottom:1px solid #f5f0ea;"></td>
      </tr>`;
    }
    document.getElementById('gMetasBody').innerHTML = rows;
    // Stats
    const pL = tML>0 ? Math.round((tRL/tML)*100) : 0;
    const pM = tMM>0 ? Math.round((tRM/tMM)*100) : 0;
    document.getElementById('gMetasStats').innerHTML = `
      <div class="stat-card"><div class="stat-label">Meta Leads (Ano)</div><div class="stat-value" style="color:var(--accent,#1a6bb5);">${tRL}<span style="font-size:14px;color:var(--muted);font-weight:400;">/${tML||'—'}</span></div>
        <div style="background:#f0ece6;border-radius:3px;height:5px;margin-top:4px;"><div style="height:100%;border-radius:3px;width:${Math.min(100,pL)}%;background:${pL>=80?'#2d7a3a':'#f6a623'};"></div></div></div>
      <div class="stat-card"><div class="stat-label">Meta Matrículas (Ano)</div><div class="stat-value" style="color:#2d7a3a;">${tRM}<span style="font-size:14px;color:var(--muted);font-weight:400;">/${tMM||'—'}</span></div>
        <div style="background:#f0ece6;border-radius:3px;height:5px;margin-top:4px;"><div style="height:100%;border-radius:3px;width:${Math.min(100,pM)}%;background:${pM>=80?'#2d7a3a':'#f6a623'};"></div></div></div>
      <div class="stat-card"><div class="stat-label">Meta Valor (Ano)</div><div class="stat-value" style="font-size:18px;">R$ ${tMV.toLocaleString('pt-BR',{minimumFractionDigits:0})}</div></div>
    `;
  }

  async function salvarTodasMetas() {
    const rows = document.querySelectorAll('#gMetasBody tr[data-mes]');
    const promises = [];
    rows.forEach(row => {
      const mes = parseInt(row.dataset.mes);
      const ml = parseInt(row.querySelector('.gm-ml').value) || 0;
      const mm = parseInt(row.querySelector('.gm-mm').value) || 0;
      const mv = parseFloat(row.querySelector('.gm-mv').value) || 0;
      if (ml || mm || mv) {
        promises.push(api({ action:'crm_metas_save', mes, ano: gMetasAno, meta_leads: ml, meta_matriculas: mm, meta_valor: mv }));
      }
    });
    if (!promises.length) { showToast('Preencha ao menos uma meta.','error'); return; }
    await Promise.all(promises);
    showToast('Metas salvas!','success');
    loadCrmMetas();
  }

  async function loadCrmConfigSeries() {
    const anoFiltro = document.getElementById('csAnoFiltro')?.value || new Date().getFullYear();
    const d = await api({ action: 'config_series_idade_list', ano: parseInt(anoFiltro) });
    const items = Array.isArray(d) ? d : [];
    document.getElementById('crmConfigSeriesContent').innerHTML = items.length ? `
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th style="text-align:left;padding:8px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Serie</th>
          <th style="text-align:center;padding:8px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Idade Min (meses)</th>
          <th style="text-align:center;padding:8px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Idade Max (meses)</th>
          <th style="text-align:center;padding:8px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Data Corte</th>
          <th style="text-align:center;padding:8px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Faixa Etaria</th>
          <th style="padding:8px;border-bottom:1.5px solid var(--border);"></th>
        </tr></thead>
        <tbody>${items.map(c => {
          const minAnos = Math.floor(c.idade_min_meses / 12);
          const maxAnos = Math.floor(c.idade_max_meses / 12);
          return `<tr>
            <td style="padding:8px;font-size:13px;font-weight:600;border-bottom:1px solid #f5f0ea;">${esc(c.serie)}</td>
            <td style="padding:8px;text-align:center;font-size:13px;border-bottom:1px solid #f5f0ea;">${c.idade_min_meses}</td>
            <td style="padding:8px;text-align:center;font-size:13px;border-bottom:1px solid #f5f0ea;">${c.idade_max_meses}</td>
            <td style="padding:8px;text-align:center;font-size:12px;border-bottom:1px solid #f5f0ea;">${c.data_corte_ref}/${c.ano_ref}</td>
            <td style="padding:8px;text-align:center;font-size:12px;color:var(--muted);border-bottom:1px solid #f5f0ea;">${minAnos} a ${maxAnos} anos</td>
            <td style="padding:8px;border-bottom:1px solid #f5f0ea;"><button onclick="deleteCrmConfigSerie('${c.id}')" style="background:none;border:1px solid #e53e3e;color:#e53e3e;border-radius:6px;padding:2px 8px;font-size:10px;cursor:pointer;">X</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>` : '<div class="empty-state">Nenhuma configuracao.</div>';
  }

  async function salvarCrmConfigSerie() {
    const d = await api({ action: 'config_series_idade_save',
      serie: document.getElementById('csNome').value.trim(),
      idade_min_meses: document.getElementById('csMin').value,
      idade_max_meses: document.getElementById('csMax').value,
      data_corte_ref: document.getElementById('csCorte').value || '03-31',
      ano_ref: document.getElementById('csAno').value || document.getElementById('csAnoFiltro').value || new Date().getFullYear(),
    });
    if (d.error) { showToast(d.error, 'error'); return; }
    showToast('Salvo!', 'success');
    document.getElementById('csNome').value = '';
    loadCrmConfigSeries();
  }

  async function deleteCrmConfigSerie(id) {
    if (!await _lumiedConfirm('Excluir?')) return;
    await api({ action: 'config_series_idade_delete', id });
    loadCrmConfigSeries();
  }

  async function replicarSeriesAno() {
    const anoOrigem = document.getElementById('csAnoFiltro').value;
    const anoDestino = document.getElementById('csAnoDestino').value;
    if (anoOrigem === anoDestino) { showToast('Ano de origem e destino iguais','error'); return; }
    if (!await _lumiedConfirm('Replicar todas as series de ' + anoOrigem + ' para ' + anoDestino + '?\n\nSeries ja existentes no ano destino serao mantidas.')) return;
    const d = await api({ action: 'config_series_idade_atualizar_ano', ano_origem: parseInt(anoOrigem), ano_destino: parseInt(anoDestino) });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast(d.total + ' series replicadas para ' + anoDestino + '!', 'success');
    document.getElementById('csAnoFiltro').value = anoDestino;
    loadCrmConfigSeries();
  }

  async function loadCrmLeads() {
    const d = await api({ action:'crm_leads_list' });
    const items = Array.isArray(d) ? d : [];
    document.getElementById('crmLeadsList').innerHTML = items.length ? items.map(l => `<div onclick="abrirLeadDetalheV2('${l.id}')" style="display:flex;align-items:center;gap:12px;padding:12px;background:#fff;border:1px solid var(--border);border-left:4px solid ${l.crm_estagios?.cor||'#999'};border-radius:8px;margin-bottom:6px;cursor:pointer;transition:background .15s;" onmouseenter="this.style.background='#faf8f5'" onmouseleave="this.style.background='#fff'">
      <div style="flex:1;"><div style="font-weight:600;font-size:13px;">${esc(l.nome_responsavel)}</div>
        <div style="font-size:11px;color:var(--muted);">${esc(l.nome_crianca||'')} · ${esc(l.telefone||'')} · ${esc(l.crm_estagios?.nome||'?')} · ${esc(l.origem||'')}</div></div>
      <span style="color:var(--muted);font-size:14px;">→</span>
    </div>`).join('') : (window.lumiedEmpty ? window.lumiedEmpty({
      icon: '🎯',
      title: 'Nenhum lead ainda',
      text: 'CRM da Lumied centraliza leads de matrícula vindos do site, Instagram, WhatsApp e indicações. Você acompanha o funil até a matrícula fechar.',
      cta: { label: '+ Cadastrar lead', onclick: "abrirNovoLeadV2 && abrirNovoLeadV2()" },
      secondary: { label: '📥 Importar de CSV', onclick: "abrirImportLeadsV2 && abrirImportLeadsV2()" },
    }) : '<div class="empty-state">Nenhum lead.</div>');
  }

  async function loadCrmTemplates() {
    const d = await api({ action:'crm_templates_list' });
    const items = Array.isArray(d) ? d : [];
    const catLabels = { boas_vindas:'Boas-vindas', follow_up:'Follow-up', visita:'Visita', pos_visita:'Pos-Visita', proposta:'Proposta', matricula:'Matricula', geral:'Geral' };
    document.getElementById('crmTemplatesList').innerHTML = items.length ? items.map(t => `<div style="padding:14px;background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <strong style="font-size:13px;">${esc(t.nome)}</strong>
        <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#f5f0ea;color:var(--muted);">${catLabels[t.categoria]||t.categoria}</span>
        <button onclick="copiarTemplate('${t.id}')" style="margin-left:auto;padding:3px 10px;background:#25D366;color:#0a3d12;border:none;border-radius:6px;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;">📋 Copiar</button>
      </div>
      <div style="font-size:12px;color:#555;line-height:1.5;white-space:pre-wrap;">${esc(t.conteudo)}</div>
    </div>`).join('') : '<div class="empty-state">Nenhum template.</div>';
  }

  function copiarTemplate(id) {
    const tpl = document.querySelector(`#crmTemplatesList div`);
    // Buscar do API de novo para ter o conteudo
    api({ action:'crm_templates_list' }).then(d => {
      const items = Array.isArray(d) ? d : [];
      const t = items.find(x => x.id === id);
      if (t) { navigator.clipboard.writeText(t.conteudo); showToast('Template copiado!','success'); }
    });
  }

  async function salvarCrmTemplate() {
    const d = await api({ action:'crm_template_save', nome: document.getElementById('tplNome').value.trim(), categoria: document.getElementById('tplCat').value, conteudo: document.getElementById('tplConteudo').value.trim() });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Template salvo!','success'); toggleCrmTemplateForm();
    document.getElementById('tplNome').value=''; document.getElementById('tplConteudo').value='';
    loadCrmTemplates();
  }

  // ── CRM MATRICULAS & VAGAS (unified) ─────
  let gMatAno = new Date().getFullYear();
  let gMatVagas = [];
  let gMatData = [];

  function gMatAnoNav(delta) { gMatAno += delta; loadCrmMatriculas(); }
  function gMatSetView(view, btn) {
    document.querySelectorAll('#gMatTabs .gmat-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('gMatViewResumo').style.display = view === 'resumo' ? '' : 'none';
    document.getElementById('gMatViewAlunos').style.display = view === 'alunos' ? '' : 'none';
    document.getElementById('gMatViewConfig').style.display = view === 'config' ? '' : 'none';
    document.getElementById('gMatViewExclusoes').style.display = view === 'exclusoes' ? '' : 'none';
    if (view === 'config') loadCrmVagas();
    if (view === 'exclusoes') loadExclusoesPendentes();
  }

  // ── CRM VAGAS (config tab) ─────────────
  async function loadCrmVagas() {
    const ano = gMatAno;
    document.getElementById('vagAno').value = ano;
    const d = await api({ action:'crm_vagas_list', ano });
    const items = Array.isArray(d) ? d : [];
    const el = document.getElementById('crmVagasContent');
    if (!items.length) { el.innerHTML = '<div class="empty-state">Nenhuma serie configurada para ' + ano + '.</div>'; return; }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Serie</th>
        <th style="text-align:center;padding:10px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Turmas</th>
        <th style="text-align:center;padding:10px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Vagas/T</th>
        <th style="text-align:center;padding:10px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Total</th>
        <th style="text-align:center;padding:10px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Reservas</th>
        <th style="text-align:center;padding:10px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Matriculados</th>
        <th style="text-align:center;padding:10px;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--border);">Disponiveis</th>
        <th style="padding:10px;font-size:11px;border-bottom:1.5px solid var(--border);min-width:120px;"></th>
      </tr></thead>
      <tbody>${items.map(v => {
        const ocupadas = (v.reservas||0) + (v.matriculados||0);
        const disp = v.vagas_total - ocupadas;
        const pct = v.vagas_total > 0 ? Math.min(100, (ocupadas / v.vagas_total) * 100) : 0;
        const cor = pct >= 90 ? '#e53e3e' : pct >= 70 ? '#f6a623' : '#48bb78';
        return `<tr>
          <td style="padding:10px 14px;font-size:13px;font-weight:600;border-bottom:1px solid #f5f0ea;">${esc(v.serie)}</td>
          <td style="padding:10px;text-align:center;border-bottom:1px solid #f5f0ea;font-size:13px;">${v.qtd_turmas}</td>
          <td style="padding:10px;text-align:center;border-bottom:1px solid #f5f0ea;font-size:13px;">${v.vagas_por_turma}</td>
          <td style="padding:10px;text-align:center;border-bottom:1px solid #f5f0ea;font-size:13px;font-weight:700;">${v.vagas_total}</td>
          <td style="padding:10px;text-align:center;border-bottom:1px solid #f5f0ea;font-size:13px;color:#b07d00;font-weight:600;">${v.reservas||0}</td>
          <td style="padding:10px;text-align:center;border-bottom:1px solid #f5f0ea;font-size:13px;color:#2d7a3a;font-weight:600;">${v.matriculados||0}</td>
          <td style="padding:10px;text-align:center;border-bottom:1px solid #f5f0ea;font-size:13px;font-weight:700;color:${disp<=2?'#e53e3e':disp<=5?'#b07d00':'#2d7a3a'};">${disp}</td>
          <td style="padding:10px;border-bottom:1px solid #f5f0ea;">
            <div style="background:#f0ece6;border-radius:4px;height:8px;width:100%;">
              <div style="height:100%;border-radius:4px;width:${pct}%;background:${cor};transition:width .3s;"></div>
            </div>
            <div style="font-size:9px;color:var(--muted);text-align:center;margin-top:2px;">${Math.round(pct)}% ocupado</div>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  async function salvarCrmVaga() {
    const serie = document.getElementById('vagSerie').value.trim();
    const qtd_turmas = parseInt(document.getElementById('vagQtd').value) || 1;
    const vagas_por_turma = parseInt(document.getElementById('vagCap').value) || 18;
    const ano = parseInt(document.getElementById('vagAno').value) || 2026;
    if (!serie) { showToast('Informe a serie','error'); return; }
    const d = await api({ action:'crm_vagas_save', serie, ano, qtd_turmas, vagas_por_turma });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Vaga salva!','success');
    document.getElementById('vagSerie').value = '';
    loadCrmVagas();
    loadCrmMatriculas();
  }

  // ── CRM MATRICULAS (unified) ────────────────
  async function loadCrmMatriculas() {
    const ano = gMatAno;
    document.getElementById('gMatAnoDisplay').textContent = ano;
    const [matrResp, vagasResp] = await Promise.all([
      api({ action:'crm_matriculas_list', ano }),
      api({ action:'crm_vagas_list', ano }),
    ]);
    // Load exclusion badge count in background
    loadExclusoesPendentes();
    gMatData = Array.isArray(matrResp) ? matrResp : [];
    gMatVagas = Array.isArray(vagasResp) ? vagasResp : [];

    // Stats
    const res = gMatData.filter(m => m.status === 'reserva').length;
    const mat = gMatData.filter(m => m.status === 'matriculado').length;
    const can = gMatData.filter(m => m.status === 'cancelado').length;
    const total = res + mat;
    const totalVagas = gMatVagas.reduce((s, v) => s + (v.vagas_total || 0), 0);
    const pctOcup = totalVagas > 0 ? Math.round((total / totalVagas) * 100) : 0;
    const seriesLotadas = gMatVagas.filter(v => (v.ocupados || 0) >= (v.vagas_total || 0)).length;
    const dispTotal = totalVagas - total;
    document.getElementById('gMatStats').innerHTML = `
      <div class="stat-card" data-c="aprov"><div class="stat-label">Matriculados</div><div class="stat-value">${mat}</div></div>
      <div class="stat-card" data-c="crm"><div class="stat-label">Reservas</div><div class="stat-value">${res}</div></div>
      <div class="stat-card"><div class="stat-label">Vagas Totais</div><div class="stat-value">${totalVagas}</div><div style="font-size:11px;color:${dispTotal<=5?'var(--red)':'var(--green)'};margin-top:2px;font-weight:600;">${dispTotal} disponíveis</div></div>
      <div class="stat-card"><div class="stat-label">Ocupação</div><div class="stat-value">${pctOcup}%</div>
        <div style="background:#f0ece6;border-radius:4px;height:6px;margin-top:6px;"><div style="height:100%;border-radius:4px;width:${pctOcup}%;background:${pctOcup>=90?'#e53e3e':pctOcup>=70?'#f6a623':'#48bb78'};"></div></div>
      </div>
      <div class="stat-card"><div class="stat-label">Séries</div><div class="stat-value">${gMatVagas.length}</div><div style="font-size:11px;color:var(--muted);margin-top:2px;">${seriesLotadas} lotada${seriesLotadas!==1?'s':''}</div></div>
      <div class="stat-card" data-c="rejeit"><div class="stat-label">Cancelados</div><div class="stat-value">${can}</div></div>
    `;

    // Resumo table
    const rEl = document.getElementById('gMatViewResumo');
    if (!gMatVagas.length) { rEl.innerHTML = '<div class="empty-state">Nenhuma série configurada para ' + ano + '.</div>'; } else {
      let html = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th style="text-align:left;padding:10px 14px;">Série</th><th style="text-align:center;">Turmas</th><th style="text-align:center;">Vagas/T</th><th style="text-align:center;">Total</th><th style="text-align:center;">Matriculados</th><th style="text-align:center;">Reservas</th><th style="text-align:center;background:rgba(26,107,181,.12);color:var(--accent,#1a6bb5);">Disponíveis</th><th style="min-width:130px;">Ocupação</th></tr></thead><tbody>';
      let tV=0,tM=0,tR=0;
      for (const v of gMatVagas) {
        const pct = v.vagas_total > 0 ? Math.round((v.ocupados/v.vagas_total)*100) : 0;
        const cor = pct>=90?'#e53e3e':pct>=70?'#f6a623':'#48bb78';
        const disp = v.disponiveis ?? (v.vagas_total-(v.ocupados||0));
        tV+=v.vagas_total||0; tM+=v.matriculados||0; tR+=v.reservas||0;
        html += `<tr><td style="padding:10px 14px;font-weight:600;border-bottom:1px solid #f5f0ea;">${esc(v.serie)}</td><td style="text-align:center;border-bottom:1px solid #f5f0ea;">${v.qtd_turmas}</td><td style="text-align:center;border-bottom:1px solid #f5f0ea;">${v.vagas_por_turma}</td><td style="text-align:center;border-bottom:1px solid #f5f0ea;">${v.vagas_total}</td><td style="text-align:center;border-bottom:1px solid #f5f0ea;font-weight:600;color:#2d7a3a;">${v.matriculados||0}</td><td style="text-align:center;border-bottom:1px solid #f5f0ea;color:#b07d00;">${v.reservas||0}</td><td style="text-align:center;border-bottom:1px solid #f5f0ea;font-weight:700;font-size:15px;color:${disp>0?'#2d7a3a':'#fff'};background:${disp>0?'rgba(45,122,58,.08)':'#e53e3e'};">${disp>0?disp:'LOTADO'}</td><td style="border-bottom:1px solid #f5f0ea;"><div style="display:flex;align-items:center;gap:6px;"><div style="background:var(--border);border-radius:4px;height:8px;flex:1;"><div style="height:100%;width:${pct}%;background:${cor};border-radius:4px;"></div></div><span style="font-size:11px;font-weight:600;color:${cor};">${pct}%</span></div></td></tr>`;
      }
      const tD=tV-tM-tR,tP=tV>0?Math.round(((tM+tR)/tV)*100):0;
      html += `<tr style="background:#f8f5f0;font-weight:700;"><td style="padding:10px 14px;">TOTAL</td><td></td><td></td><td style="text-align:center;">${tV}</td><td style="text-align:center;color:#2d7a3a;">${tM}</td><td style="text-align:center;color:#b07d00;">${tR}</td><td style="text-align:center;font-size:15px;color:${tD>0?'#2d7a3a':'#e53e3e'};background:rgba(26,107,181,.08);">${tD}</td><td><span style="font-weight:700;">${tP}%</span></td></tr>`;
      html += '</tbody></table></div>';
      rEl.innerHTML = html;
    }

    // Alunos cards
    renderGMatAlunos(ano);
  }

  function renderGMatAlunos(ano) {
    const statusLabels = { reserva:'🟡 Reserva', matriculado:'🟢 Matriculado', cancelado:'🔴 Cancelado' };
    const statusDot = { reserva:'#f6a623', matriculado:'#2d7a3a', cancelado:'#e53e3e' };
    const letras = 'ABCDEFGHIJ';
    const porSerie = {};
    for (const v of gMatVagas) { if (!porSerie[v.serie]) porSerie[v.serie] = { vagas: v, items: [] }; }
    for (const m of gMatData) { if (!porSerie[m.serie]) porSerie[m.serie] = { vagas: null, items: [] }; porSerie[m.serie].items.push(m); }
    const series = Object.keys(porSerie).sort((a,b) => (porSerie[a].vagas?.ordem??99) - (porSerie[b].vagas?.ordem??99));
    const el = document.getElementById('gMatViewAlunos');
    if (!series.length) { el.innerHTML = '<div class="empty-state">Nenhuma série para ' + ano + '.</div>'; return; }
    let html = '';
    for (const serie of series) {
      const g = porSerie[serie]; const v = g.vagas; const qtd = v ? v.qtd_turmas : 1; const vpT = v ? v.vagas_por_turma : '?';
      if (qtd <= 1) { html += renderTurmaCard(serie, serie, g.items, v?v.vagas_total:null, qtd, statusLabels, statusDot, letras, ano); }
      else { for (let t=0;t<qtd;t++) { const l=letras[t]||String(t+1); html += renderTurmaCard(serie, serie+' '+l, g.items.filter(m=>(m.turma||'A')===l), vpT, 1, statusLabels, statusDot, letras, ano); } }
    }
    el.innerHTML = html;
  }

  function renderTurmaCard(serieBase, nomeTurma, items, vagasTotal, qtdTurmas, statusLabels, statusDot, letras, ano) {
    const ativos = items.filter(m => m.status !== 'cancelado');
    const inativos = items.filter(m => m.status === 'cancelado');
    const reservas = items.filter(m => m.status === 'reserva').length;
    const matriculados = items.filter(m => m.status === 'matriculado').length;
    const cancelados = inativos.length;
    const ocupados = reservas + matriculados;
    const disp = vagasTotal != null ? vagasTotal - ocupados : '?';
    const pct = vagasTotal && vagasTotal > 0 ? Math.min(100, (ocupados / vagasTotal) * 100) : 0;
    const cor = pct >= 90 ? '#e53e3e' : pct >= 70 ? '#f6a623' : '#48bb78';

    return `<div style="background:#fff;border:1.5px solid var(--border);border-radius:12px;margin-bottom:16px;overflow:hidden;">
      <div style="padding:14px 18px;background:linear-gradient(135deg,${cor}15,${cor}05);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="font-size:15px;font-weight:700;font-family:'Lora',serif;">${esc(nomeTurma)}</div>
        <div style="display:flex;gap:12px;font-size:12px;color:var(--muted);">
          <span style="color:#2d7a3a;font-weight:600;">${matriculados} matriculado${matriculados!==1?'s':''}</span>
          <span>·</span>
          <span style="color:#b07d00;font-weight:600;">${reservas} reserva${reservas!==1?'s':''}</span>
          ${cancelados?`<span>·</span><span style="color:#e53e3e;">${cancelados} cancelado${cancelados!==1?'s':''}</span>`:''}
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
          ${vagasTotal!=null?`<span style="font-size:12px;font-weight:600;color:${typeof disp==='number'&&disp<=2?'#e53e3e':typeof disp==='number'&&disp<=5?'#b07d00':'#2d7a3a'};">${disp}/${vagasTotal} vagas</span>
          <div style="background:#f0ece6;border-radius:4px;height:8px;width:80px;"><div style="height:100%;border-radius:4px;width:${pct}%;background:${cor};"></div></div>`:''}
        </div>
      </div>
      <div style="padding:12px 18px;">
        ${ativos.length ? ativos.map(m => {
          const nascStr = m.data_nascimento ? new Date(m.data_nascimento+'T12:00:00').toLocaleDateString('pt-BR') : '';
          const dataStr = m.data_matricula || m.data_reserva || '';
          return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f5f0ea;">
            <div style="width:8px;height:8px;border-radius:50%;background:${statusDot[m.status]||'#999'};flex-shrink:0;"></div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;">${esc(m.nome_crianca)}</div>
              <div style="font-size:11px;color:var(--muted);">Resp: ${esc(m.nome_responsavel)}${nascStr?' · Nasc: '+nascStr:''}${m.telefone?' · '+esc(m.telefone):''}${m.email?' · '+esc(m.email):''}</div>
            </div>
            <div style="font-size:11px;color:var(--muted);white-space:nowrap;">${statusLabels[m.status]||m.status}</div>
            <div style="font-size:10px;color:var(--muted);white-space:nowrap;">${dataStr?new Date(dataStr+'T12:00:00').toLocaleDateString('pt-BR'):''}</div>
            <select onchange="mudarTurmaMatricula('${m.id}',this.value)" style="padding:2px 6px;border:1px solid var(--border);border-radius:4px;font-size:10px;font-family:'DM Sans',sans-serif;background:#fff;cursor:pointer;" title="Mudar turma">
              ${Array.from({length:10},(_, i)=>letras[i]).filter(l=>l).map(l=>`<option value="${l}" ${(m.turma||'A')===l?'selected':''}>${l}</option>`).join('')}
            </select>
            <div style="display:flex;gap:4px;flex-shrink:0;">
              ${m.status==='reserva'?`<button onclick="atualizarMatricula('${m.id}','matriculado')" style="padding:3px 8px;background:#2d7a3a;color:#fff;border:none;border-radius:6px;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;">Matricular</button>`:''}
              <button onclick="atualizarMatricula('${m.id}','cancelado')" style="padding:3px 8px;background:none;border:1px solid #e53e3e;color:#e53e3e;border-radius:6px;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;">Cancelar</button>
              <button onclick="removerMatricula('${m.id}','${esc(m.nome_crianca)}')" style="padding:3px 8px;background:#e53e3e;color:#fff;border:none;border-radius:6px;font-size:10px;cursor:pointer;font-family:'DM Sans',sans-serif;" title="Remover da turma">Remover</button>
            </div>
          </div>`;
        }).join('') : '<div style="font-size:12px;color:var(--muted);padding:8px 0;">Nenhuma crianca nesta turma.</div>'}
        ${inativos.length ? `<details style="margin-top:6px;"><summary style="font-size:11px;color:var(--muted);cursor:pointer;">Cancelados (${inativos.length})</summary>
          ${inativos.map(m => `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;opacity:.5;">
            <div style="width:8px;height:8px;border-radius:50%;background:#e53e3e;flex-shrink:0;"></div>
            <div style="font-size:12px;text-decoration:line-through;">${esc(m.nome_crianca)}</div>
            <div style="font-size:11px;color:var(--muted);">${esc(m.nome_responsavel)}</div>
          </div>`).join('')}
        </details>` : ''}
      </div>
    </div>`;
  }

  async function mudarTurmaMatricula(id, novaTurma) {
    const d = await api({ action:'crm_matricula_atualizar_turma', id, turma: novaTurma });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Turma alterada para ' + novaTurma,'success');
    loadCrmMatriculas();
  }

  async function atualizarMatricula(id, novoStatus) {
    const labels = { matriculado:'matricular', cancelado:'cancelar' };
    if (!await _lumiedConfirm('Deseja ' + (labels[novoStatus]||novoStatus) + ' este registro?')) return;
    const d = await api({ action:'crm_matricula_atualizar_status', id, status: novoStatus });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast('Status atualizado!','success');
    loadCrmMatriculas();
    // Refresh vagas if that panel was loaded
    if (document.getElementById('panelCrmVagas').style.display !== 'none') loadCrmVagas();
  }

  async function removerMatricula(id, nome) {
    const motivo = prompt('Remover ' + nome + ' da turma?\n\nMotivo (opcional):');
    if (motivo === null) return; // cancelou
    if (!await _lumiedConfirm('Confirmar exclusao de ' + nome + '?\n\nEsta acao nao pode ser desfeita.')) return;
    const d = await api({ action:'crm_matricula_remover', id, motivo });
    if (d.error) { showToast(d.error,'error'); return; }
    showToast(d.message || 'Removido com sucesso!','success');
    loadCrmMatriculas();
  }

