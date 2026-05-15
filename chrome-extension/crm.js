// ═══════════════════════════════════════════════════════════════
//  Lumied CRM — Página de gerenciamento (Broadcast, Import, etc)
// ═══════════════════════════════════════════════════════════════

const API_URL = window.LUMIED_CONFIG.API_URL;
const API_KEY = window.LUMIED_CONFIG.ANON_KEY;

const $ = id => document.getElementById(id);

async function apiCall(action, params) {
  const stored = await chrome.storage.local.get(['token']);
  if (!stored.token) {
    toast('Faça login na extensão (popup) primeiro.', 'error');
    throw new Error('sem token');
  }
  const res = await fetch(API_URL + '/functions/v1/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': API_KEY, 'Authorization': 'Bearer ' + API_KEY },
    body: JSON.stringify({ action, _token: stored.token, ...(params || {}) }),
  });
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'error' ? ' error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function modal(opts) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal">
      <h3>${escapeHtml(opts.title)}</h3>
      <div>${opts.body || ''}</div>
      <div class="modal-actions">
        <button class="btn btn-sec" id="m-cancel">${opts.cancelLabel || 'Cancelar'}</button>
        <button class="btn" id="m-ok">${opts.confirmLabel || 'Confirmar'}</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    $('m-cancel').onclick = () => { overlay.remove(); resolve(null); };
    $('m-ok').onclick = () => {
      const inputs = overlay.querySelectorAll('input,select,textarea');
      const r = {};
      inputs.forEach(i => { if (i.name) r[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
      overlay.remove();
      resolve(r);
    };
    overlay.onclick = e => { if (e.target === overlay) { overlay.remove(); resolve(null); } };
  });
}

// ── Tab navigation ──
document.querySelectorAll('nav button').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.section').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $('tab-' + b.dataset.tab).classList.add('active');
    loadTab(b.dataset.tab);
  };
});

function loadTab(tab) {
  if (tab === 'broadcast') loadBroadcastTab();
  if (tab === 'import') loadImportTab();
  if (tab === 'templates') loadTemplatesTab();
  if (tab === 'tags') loadTagsTab();
  if (tab === 'cadencias') loadCadenciasTab();
  if (tab === 'analytics') loadAnalyticsTab();
}

// ════ BROADCAST ════
async function loadBroadcastTab() {
  try {
    const [templates, estagios, tags] = await Promise.all([
      apiCall('crm_templates_list'),
      apiCall('crm_estagios_list'),
      apiCall('crm_tags_list'),
    ]);
    $('bcTemplate').innerHTML = '<option value="">— Selecione —</option>' +
      (templates || []).map(t => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('');
    $('bcEstagio').innerHTML = '<option value="">— Qualquer —</option>' +
      (estagios || []).map(e => `<option value="${e.id}">${escapeHtml(e.nome)}</option>`).join('');
    $('bcTag').innerHTML = '<option value="">— Qualquer —</option>' +
      (tags || []).map(t => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('');
    await loadBroadcastsList();
  } catch (e) { toast(e.message, 'error'); }
}

function getBroadcastFilter() {
  const f = {};
  if ($('bcEstagio').value) f.estagio_id = $('bcEstagio').value;
  if ($('bcTag').value) f.tag_id = $('bcTag').value;
  if ($('bcSentiment').value) f.sentiment = $('bcSentiment').value;
  if ($('bcParado').value) f.parado_dias = Number($('bcParado').value);
  return f;
}

$('bcPreview').onclick = async () => {
  try {
    const r = await apiCall('crm_broadcast_preview', { filtro: getBroadcastFilter() });
    $('bcPreviewResult').textContent = `→ ${r.total} leads matcham este filtro.`;
  } catch (e) { toast(e.message, 'error'); }
};

$('bcCreate').onclick = async () => {
  const nome = $('bcNome').value.trim();
  const template_id = $('bcTemplate').value;
  if (!nome || !template_id) { toast('Preencha nome e template.', 'error'); return; }
  try {
    const created = await apiCall('crm_broadcast_create', { nome, template_id, filtro: getBroadcastFilter() });
    const mat = await apiCall('crm_broadcast_materialize', { broadcast_id: created.id });
    toast(`Broadcast criado: ${mat.total} envios pendentes.`);
    $('bcNome').value = '';
    await loadBroadcastsList();
  } catch (e) { toast(e.message, 'error'); }
};

async function loadBroadcastsList() {
  try {
    const list = await apiCall('crm_broadcasts_list');
    const el = $('bcList');
    if (!list || !list.length) { el.innerHTML = '<div class="empty">Nenhum broadcast criado ainda.</div>'; return; }
    el.innerHTML = list.map(b => {
      const total = b.total_leads || 0;
      const enviados = b.enviados || 0;
      const pct = total > 0 ? Math.round((enviados / total) * 100) : 0;
      const tpl = b.crm_templates || {};
      return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px">${escapeHtml(b.nome)}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px">${escapeHtml(tpl.nome || '')} · ${new Date(b.criado_em).toLocaleString('pt-BR')}</div>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
            <div style="font-size:11px;color:#6b7280;margin-top:4px">${enviados} de ${total} enviados · ${b.erros || 0} erros</div>
          </div>
          <div>
            <span class="chip">${escapeHtml(b.status)}</span>
            ${b.status === 'em_andamento' ? `<button class="btn btn-sec" style="margin-top:6px;font-size:11px;padding:6px 10px" onclick="window.bcOpen('${b.id}')">Disparar →</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (e) { toast(e.message, 'error'); }
}

// Modal: lista de envios pendentes pra disparar manualmente
window.bcOpen = async function(broadcastId) {
  try {
    const pending = await apiCall('crm_broadcast_envios_pendentes', { broadcast_id: broadcastId, limit: 20 });
    const items = pending || [];
    const body = items.length
      ? items.map(e => {
          const lead = e.crm_leads || {};
          const tel = lead.telefone || '';
          const link = tel ? `https://wa.me/${tel}` : '#';
          return `<div class="card" style="margin-bottom:6px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <div style="flex:1">
                <strong>${escapeHtml(lead.nome_responsavel || 'Sem nome')}</strong>
                ${lead.nome_crianca ? `<span style="color:#6b7280"> — ${escapeHtml(lead.nome_crianca)}</span>` : ''}
                <div style="font-size:11px;color:#6b7280">${escapeHtml(tel)}</div>
              </div>
              <div style="display:flex;gap:4px">
                <a class="btn btn-sec" style="font-size:11px;padding:6px 10px" href="${link}" target="_blank">Abrir WA</a>
                <button class="btn" style="font-size:11px;padding:6px 10px;background:#065f46" data-envio="${e.id}" data-action="enviado">✓ Enviado</button>
                <button class="btn btn-sec" style="font-size:11px;padding:6px 10px" data-envio="${e.id}" data-action="ignorado">Pular</button>
              </div>
            </div>
          </div>`;
        }).join('')
      : '<div class="empty">Sem envios pendentes neste lote.</div>';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal"><h3>Próximos 20 envios</h3>${body}<div class="modal-actions"><button class="btn btn-sec" id="m-close">Fechar</button></div></div>`;
    document.body.appendChild(overlay);
    $('m-close').onclick = () => { overlay.remove(); loadBroadcastsList(); };
    overlay.querySelectorAll('[data-envio]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.envio;
        const status = btn.dataset.action;
        try {
          await apiCall('crm_broadcast_envio_marcar', { id, status });
          btn.closest('.card').remove();
        } catch (err) { toast(err.message, 'error'); }
      };
    });
  } catch (e) { toast(e.message, 'error'); }
};

// ════ IMPORT CSV ════
function loadImportTab() {
  loadImportsList();
}

$('impFile').onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => { $('impText').value = reader.result; };
  reader.readAsText(f);
  if (!$('impNome').value) $('impNome').value = f.name;
};

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = ['nome_responsavel', 'telefone', 'nome_crianca', 'email', 'data_nascimento', 'serie_interesse'];
  // Detecta cabeçalho
  const firstLower = lines[0].toLowerCase();
  const hasHeader = headers.some(h => firstLower.includes(h));
  const start = hasHeader ? 1 : 0;
  return lines.slice(start).map(l => {
    const cols = l.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const r = {};
    headers.forEach((h, i) => { if (cols[i]) r[h] = cols[i]; });
    return r;
  });
}

$('impSubmit').onclick = async () => {
  const text = $('impText').value.trim();
  if (!text) { toast('Cole ou suba um CSV.', 'error'); return; }
  const linhas = parseCsv(text);
  if (!linhas.length) { toast('Não foi possível extrair linhas.', 'error'); return; }
  $('impResult').innerHTML = '<div style="color:#6b7280">Importando ' + linhas.length + ' linhas...</div>';
  try {
    const r = await apiCall('crm_bulk_import_create', { arquivo_nome: $('impNome').value || 'import.csv', linhas });
    $('impResult').innerHTML = `<div class="card" style="background:#ecfdf5;border-color:#a7f3d0">
      <strong>Concluído!</strong>
      <div>Importados: ${r.imported} · Ignorados (telefone duplicado): ${r.ignored} · Erros: ${r.errors}</div>
    </div>`;
    $('impText').value = '';
    await loadImportsList();
  } catch (e) {
    $('impResult').innerHTML = '';
    toast(e.message, 'error');
  }
};

async function loadImportsList() {
  try {
    const list = await apiCall('crm_bulk_imports_list');
    const el = $('impList');
    if (!list || !list.length) { el.innerHTML = '<div class="empty">Nenhuma importação ainda.</div>'; return; }
    el.innerHTML = list.map(i => `<div class="card">
      <strong>${escapeHtml(i.arquivo_nome || 'import.csv')}</strong>
      <span class="chip" style="margin-left:8px">${escapeHtml(i.status)}</span>
      <div style="font-size:11px;color:#6b7280;margin-top:4px">${new Date(i.criado_em).toLocaleString('pt-BR')} · Total: ${i.total} · Importados: ${i.importados} · Ignorados: ${i.ignorados} · Erros: ${i.erros}</div>
    </div>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

// ════ TEMPLATES ════
async function loadTemplatesTab() {
  try {
    const list = await apiCall('crm_templates_list');
    const el = $('tplList');
    if (!list || !list.length) { el.innerHTML = '<div class="empty">Nenhum template cadastrado.</div>'; return; }
    const midiaIcons = { imagem: '🖼', doc: '📎', audio: '🎵', video: '🎬' };
    el.innerHTML = list.map(t => `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div style="flex:1">
          <div style="font-weight:700">${escapeHtml(t.nome)} ${t.midia_tipo ? '<span title="Tem mídia">' + (midiaIcons[t.midia_tipo] || '📎') + '</span>' : ''}</div>
          <div class="chip" style="margin-top:4px">${escapeHtml(t.categoria || 'geral')}</div>
          ${t.usos ? `<span class="chip" style="margin-left:6px">Usado ${t.usos}x</span>` : ''}
          <div style="margin-top:6px;font-size:12px;color:#6b7280;line-height:1.5">${escapeHtml((t.conteudo || '').substring(0, 200))}${t.conteudo && t.conteudo.length > 200 ? '...' : ''}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button class="btn btn-sec" style="font-size:11px;padding:6px 12px" onclick="window.tplEdit('${t.id}')">Editar</button>
          <button class="btn btn-danger" style="font-size:11px;padding:6px 12px" onclick="window.tplDel('${t.id}')">Excluir</button>
        </div>
      </div>
    </div>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

window.tplEdit = async function(id) {
  const list = await apiCall('crm_templates_list');
  const t = (list || []).find(x => x.id === id) || {};
  await openTemplateModal(t);
};
window.tplDel = async function(id) {
  if (!confirm('Excluir este template? Templates não podem ser desfeitos.')) return;
  try { await apiCall('crm_template_delete', { id }); toast('Template excluído.'); loadTemplatesTab(); }
  catch (e) { toast(e.message, 'error'); }
};
$('tplNew').onclick = () => openTemplateModal({});

async function openTemplateModal(t) {
  const cats = ['boas_vindas', 'follow_up', 'visita', 'pos_visita', 'proposta', 'matricula', 'geral'];
  const body = `
    <div class="field"><label>Nome</label><input name="nome" value="${escapeHtml(t.nome || '')}"></div>
    <div class="field"><label>Categoria</label><select name="categoria">${cats.map(c => `<option value="${c}" ${t.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="field"><label>Conteúdo (use {{nome}}, {{primeiro_nome}}, {{nome_crianca}}, {{escola}}, etc.)</label><textarea name="conteudo" style="min-height:120px">${escapeHtml(t.conteudo || '')}</textarea></div>
    <div class="row">
      <div class="field"><label>Tipo de mídia (opcional)</label><select name="midia_tipo"><option value="">— Nenhuma —</option>${['imagem','doc','audio','video'].map(m => `<option value="${m}" ${t.midia_tipo === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div class="field"><label>URL da mídia</label><input name="midia_url" value="${escapeHtml(t.midia_url || '')}" placeholder="https://..."></div>
    </div>
    <div class="field"><label>Nome do arquivo (opcional)</label><input name="midia_nome" value="${escapeHtml(t.midia_nome || '')}"></div>
  `;
  const r = await modal({ title: t.id ? 'Editar template' : 'Novo template', body, confirmLabel: 'Salvar' });
  if (!r) return;
  if (!r.nome || !r.conteudo) { toast('Preencha nome e conteúdo.', 'error'); return; }
  try {
    await apiCall('crm_template_save_v2', { id: t.id, ...r });
    toast('Template salvo.');
    loadTemplatesTab();
  } catch (e) { toast(e.message, 'error'); }
}

// ════ TAGS ════
async function loadTagsTab() {
  try {
    const list = await apiCall('crm_tags_list');
    const el = $('tagList');
    if (!list || !list.length) { el.innerHTML = '<div class="empty">Nenhuma tag cadastrada.</div>'; return; }
    el.innerHTML = list.map(t => `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <span class="tag-chip" style="background:${escapeHtml(t.cor || '#6b7280')}">${escapeHtml(t.nome)}</span>
          ${t.descricao ? `<span style="font-size:12px;color:#6b7280">${escapeHtml(t.descricao)}</span>` : ''}
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sec" style="font-size:11px;padding:6px 12px" onclick='window.tagEdit(${JSON.stringify(t).replace(/'/g, "&apos;")})'>Editar</button>
          <button class="btn btn-danger" style="font-size:11px;padding:6px 12px" onclick="window.tagDel('${t.id}')">Excluir</button>
        </div>
      </div>
    </div>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}
$('tagNew').onclick = () => openTagModal({});
window.tagEdit = t => openTagModal(t);
window.tagDel = async id => {
  if (!confirm('Excluir esta tag? Será removida de todos os leads.')) return;
  try { await apiCall('crm_tag_delete', { id }); loadTagsTab(); }
  catch (e) { toast(e.message, 'error'); }
};
async function openTagModal(t) {
  const body = `
    <div class="field"><label>Nome</label><input name="nome" value="${escapeHtml(t.nome || '')}"></div>
    <div class="field"><label>Cor</label><input name="cor" type="color" value="${escapeHtml(t.cor || '#6b7280')}"></div>
    <div class="field"><label>Descrição (opcional)</label><input name="descricao" value="${escapeHtml(t.descricao || '')}"></div>
  `;
  const r = await modal({ title: t.id ? 'Editar tag' : 'Nova tag', body, confirmLabel: 'Salvar' });
  if (!r) return;
  if (!r.nome) { toast('Nome obrigatório.', 'error'); return; }
  try { await apiCall('crm_tag_save', { id: t.id, ...r }); loadTagsTab(); }
  catch (e) { toast(e.message, 'error'); }
}

// ════ CADÊNCIAS ════
async function loadCadenciasTab() {
  try {
    const [list, templates] = await Promise.all([
      apiCall('crm_cadencias_list'),
      apiCall('crm_templates_list'),
    ]);
    window._tplCache = templates || [];
    const el = $('cadList');
    if (!list || !list.length) { el.innerHTML = '<div class="empty">Nenhuma cadência cadastrada.</div>'; return; }
    el.innerHTML = list.map(c => {
      const passos = Array.isArray(c.passos) ? c.passos : [];
      return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div style="flex:1">
            <div style="font-weight:700">${escapeHtml(c.nome)} ${c.ativo ? '' : '<span class="chip">Inativa</span>'}</div>
            ${c.descricao ? `<div style="font-size:12px;color:#6b7280">${escapeHtml(c.descricao)}</div>` : ''}
            <div style="font-size:11px;color:#6b7280;margin-top:4px">Parar quando: ${escapeHtml(c.parar_quando)}</div>
            <div class="cadencia-passos">${passos.map((p, i) => `<div class="cadencia-passo">Passo ${i+1}: depois de <strong>${escapeHtml(String(p.dias_apos || 1))} dia(s)</strong> · ${escapeHtml(p.descricao || 'follow-up')}</div>`).join('')}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <button class="btn btn-sec" style="font-size:11px;padding:6px 12px" onclick='window.cadEdit(${JSON.stringify(c).replace(/'/g, "&apos;")})'>Editar</button>
            <button class="btn btn-danger" style="font-size:11px;padding:6px 12px" onclick="window.cadDel('${c.id}')">Excluir</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (e) { toast(e.message, 'error'); }
}
$('cadNew').onclick = () => openCadenciaModal({});
window.cadEdit = c => openCadenciaModal(c);
window.cadDel = async id => {
  if (!confirm('Excluir cadência? Leads atribuídos vão parar de receber follow-up.')) return;
  try { await apiCall('crm_cadencia_delete', { id }); loadCadenciasTab(); }
  catch (e) { toast(e.message, 'error'); }
};
async function openCadenciaModal(c) {
  const passos = Array.isArray(c.passos) ? c.passos : [];
  const tpls = window._tplCache || [];
  const passosHtml = passos.map((p, i) => `<div class="cadencia-passo">
    <strong>Passo ${i+1}</strong> — dias: <input name="passo_${i}_dias" value="${escapeHtml(String(p.dias_apos || 1))}" style="width:60px;padding:4px;margin:0 4px">
    template: <select name="passo_${i}_template" style="padding:4px"><option value="">— —</option>${tpls.map(t => `<option value="${t.id}" ${p.template_id === t.id ? 'selected' : ''}>${escapeHtml(t.nome)}</option>`).join('')}</select>
    <input name="passo_${i}_desc" placeholder="descrição (ex: follow-up 1)" value="${escapeHtml(p.descricao || '')}" style="width:200px;padding:4px;margin-left:4px">
  </div>`).join('');
  const body = `
    <div class="field"><label>Nome</label><input name="nome" value="${escapeHtml(c.nome || '')}"></div>
    <div class="field"><label>Descrição</label><input name="descricao" value="${escapeHtml(c.descricao || '')}"></div>
    <div class="field"><label>Parar quando</label><select name="parar_quando">
      <option value="qualquer_resposta" ${c.parar_quando === 'qualquer_resposta' ? 'selected' : ''}>Lead responder</option>
      <option value="matricula" ${c.parar_quando === 'matricula' ? 'selected' : ''}>Matrícula fechada</option>
      <option value="perdido" ${c.parar_quando === 'perdido' ? 'selected' : ''}>Lead perdido</option>
      <option value="manual" ${c.parar_quando === 'manual' ? 'selected' : ''}>Só manual</option>
    </select></div>
    <div class="field"><label>Passos</label>${passosHtml}<button type="button" class="btn btn-sec" style="margin-top:8px;font-size:11px" onclick="window.cadAddPasso()">+ Adicionar passo</button></div>
    <input type="hidden" name="_passosCount" value="${passos.length}">
  `;
  window.cadAddPasso = () => {
    const overlay = document.querySelector('.modal-overlay .modal');
    if (!overlay) return;
    const cur = Number(overlay.querySelector('input[name="_passosCount"]').value) || 0;
    const tplOpts = tpls.map(t => `<option value="${t.id}">${escapeHtml(t.nome)}</option>`).join('');
    const el = document.createElement('div');
    el.className = 'cadencia-passo';
    el.innerHTML = `<strong>Passo ${cur + 1}</strong> — dias: <input name="passo_${cur}_dias" value="1" style="width:60px;padding:4px;margin:0 4px">
      template: <select name="passo_${cur}_template" style="padding:4px"><option value="">— —</option>${tplOpts}</select>
      <input name="passo_${cur}_desc" placeholder="descrição" style="width:200px;padding:4px;margin-left:4px">`;
    overlay.querySelector('.field:has(label:contains("Passos")) button')?.before(el);
    // Fallback simpler: insert before the + button
    const btn = overlay.querySelector('button[onclick="window.cadAddPasso()"]');
    if (btn) btn.parentElement.insertBefore(el, btn);
    overlay.querySelector('input[name="_passosCount"]').value = cur + 1;
  };
  const r = await modal({ title: c.id ? 'Editar cadência' : 'Nova cadência', body, confirmLabel: 'Salvar' });
  if (!r) return;
  if (!r.nome) { toast('Nome obrigatório.', 'error'); return; }
  const count = Number(r._passosCount) || 0;
  const novosPassos = [];
  for (let i = 0; i < count; i++) {
    const dias = Number(r[`passo_${i}_dias`]);
    if (!dias) continue;
    novosPassos.push({
      ordem: i,
      dias_apos: dias,
      template_id: r[`passo_${i}_template`] || null,
      descricao: r[`passo_${i}_desc`] || null,
    });
  }
  try {
    await apiCall('crm_cadencia_save', {
      id: c.id, nome: r.nome, descricao: r.descricao,
      passos: novosPassos, parar_quando: r.parar_quando,
    });
    loadCadenciasTab();
  } catch (e) { toast(e.message, 'error'); }
}

// ════ ANALYTICS ════
async function loadAnalyticsTab() {
  try {
    const list = await apiCall('crm_templates_analytics');
    const items = list || [];
    const totalUsos = items.reduce((s, t) => s + (t.usos || 0), 0);
    const totalResp = items.reduce((s, t) => s + (t.respostas || 0), 0);
    const totalConv = items.reduce((s, t) => s + (t.conversoes || 0), 0);
    $('anKpis').innerHTML = `
      <div class="kpi"><div class="label">Templates ativos</div><div class="value">${items.length}</div></div>
      <div class="kpi"><div class="label">Total usos</div><div class="value">${totalUsos}</div></div>
      <div class="kpi"><div class="label">Respostas</div><div class="value">${totalResp}</div></div>
      <div class="kpi"><div class="label">Conversões</div><div class="value">${totalConv}</div></div>
    `;
    if (!items.length) { $('anList').innerHTML = '<div class="empty">Sem dados ainda. Use templates pra ver analytics.</div>'; return; }
    $('anList').innerHTML = '<table><thead><tr><th>Template</th><th>Categoria</th><th>Usos</th><th>Respostas (%)</th><th>Conversões (%)</th><th>Último uso</th></tr></thead><tbody>'
      + items.map(t => `<tr>
        <td><strong>${escapeHtml(t.nome)}</strong></td>
        <td><span class="chip">${escapeHtml(t.categoria || '')}</span></td>
        <td>${t.usos || 0}</td>
        <td>${t.respostas || 0} (${t.taxa_resposta || 0}%)</td>
        <td>${t.conversoes || 0} (${t.taxa_conversao || 0}%)</td>
        <td style="color:#6b7280;font-size:11px">${t.ultimo_uso_em ? new Date(t.ultimo_uso_em).toLocaleString('pt-BR') : '—'}</td>
      </tr>`).join('') + '</tbody></table>';
  } catch (e) { toast(e.message, 'error'); }
}

// ── Init: fetch escola name + load default tab ──
(async () => {
  try {
    const cfg = await apiCall('config_publica');
    if (cfg && cfg.escola_nome) {
      $('escolaNome').textContent = cfg.escola_nome;
      $('brand').textContent = cfg.escola_nome + ' CRM';
    }
  } catch (e) { /* ignore */ }
  loadBroadcastTab();
})();
