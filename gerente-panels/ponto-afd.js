// Auto-extraído do gerente.html (Onda 4 do refator).
// Funções globais — chamadas de panel switchers + onclick handlers no HTML.
// Carregado via <script defer> após o inline script principal.
  // ─────────────────────────────────────────────────────────────
  // PONTO AFD (Portaria MTP 671/2021) — 5 painéis
  // ─────────────────────────────────────────────────────────────
  var PONTO_API = SUPABASE_URL + '/functions/v1/ponto';
  var pontoState = { emps: [], filtroJustif: 'pendente' };
  var pontoAfdContent = null;

  async function pontoApi(body) {
    const token = getToken();
    const headers = { 'Content-Type':'application/json', 'apikey':ANON, 'Authorization':'Bearer '+ANON };
    const r = await fetch(PONTO_API, { method:'POST', headers, body: JSON.stringify({ ...body, _token: token }) });
    const j = await r.json();
    // Normalize: edge function returns raw arrays; callers expect {data: [...]}
    return Array.isArray(j) ? { data: j } : j;
  }

  function pontoEsc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  function pontoFmtPis(p) {
    if (!p) return '—';
    const s = String(p).padStart(12, '0');
    return s.slice(0,3) + '.' + s.slice(3,8) + '.' + s.slice(8,10) + '-' + s.slice(10,12);
  }

  function pontoFillMesAno(mesId, anoId) {
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const now = new Date();
    const elMes = document.getElementById(mesId);
    const elAno = document.getElementById(anoId);
    if (elMes && !elMes.dataset.filled) {
      elMes.innerHTML = meses.map((m, i) => `<option value="${i+1}" ${i+1 === now.getMonth()+1 ? 'selected' : ''}>${m}</option>`).join('');
      elMes.dataset.filled = '1';
    }
    if (elAno && !elAno.dataset.filled) {
      let html = '';
      for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 1; y++) {
        html += `<option value="${y}" ${y === now.getFullYear() ? 'selected' : ''}>${y}</option>`;
      }
      elAno.innerHTML = html;
      elAno.dataset.filled = '1';
    }
  }

  function pontoFillEmpSelects() {
    ['pontoMirrorEmp', 'pontoJustifEmp'].forEach(sid => {
      const sel = document.getElementById(sid);
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '<option value="">Selecione…</option>' + pontoState.emps.map(e =>
        `<option value="${e.id}">${pontoEsc(e.nome)} — ${pontoFmtPis(e.pis)}</option>`
      ).join('');
      sel.value = cur || '';
    });
  }

  // ── Dashboard ──────────────────────────────────
  async function loadPontoDash() {
    pontoFillMesAno('pontoDashMes', 'pontoDashAno');
    const mes = parseInt(document.getElementById('pontoDashMes').value);
    const ano = parseInt(document.getElementById('pontoDashAno').value);
    const ids = ['pontoStEmps','pontoStImps','pontoStPres','pontoStAus','pontoStImp','pontoStExt','pontoStDeb'];
    ids.forEach(i => { const el = document.getElementById(i); if (el) el.textContent = '…'; });
    const d = await pontoApi({ action: 'ponto_dashboard', mes, ano });
    if (d.error) {
      ids.forEach(i => { const el = document.getElementById(i); if (el) el.textContent = '—'; });
      return showToast(d.error, 'error');
    }
    const r = d.data || d;
    document.getElementById('pontoStEmps').textContent = r.total_funcionarios ?? 0;
    document.getElementById('pontoStImps').textContent = r.total_importacoes ?? 0;
    document.getElementById('pontoStPres').textContent = r.presentes ?? 0;
    document.getElementById('pontoStAus').textContent = r.ausentes ?? 0;
    document.getElementById('pontoStImp').textContent = r.impares ?? 0;
    document.getElementById('pontoStExt').textContent = r.extras ?? 0;
    document.getElementById('pontoStDeb').textContent = r.debitos ?? 0;
  }

  // ── Funcionários ──────────────────────────────────
  function pontoToggleEmpForm() {
    const el = document.getElementById('pontoEmpForm');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
    if (el.style.display === 'block') {
      ['pontoEmpNome','pontoEmpPis','pontoEmpCargo','pontoEmpDept','pontoEmpSched'].forEach(i => {
        const e = document.getElementById(i); if (e) e.value = '';
      });
      document.getElementById('pontoEmpHoras').value = '8';
    }
  }

  async function loadPontoEmployees() {
    const tb = document.getElementById('pontoEmpsTable');
    tb.innerHTML = '<tr><td colspan="7" class="empty-state"><span class="spinner-sm"></span> Carregando...</td></tr>';
    const d = await pontoApi({ action: 'ponto_employees_list' });
    if (d.error) {
      tb.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:#C8102E;">${pontoEsc(d.error)}</td></tr>`;
      return;
    }
    const list = d.data || [];
    pontoState.emps = list;
    document.getElementById('pontoEmpsCount').textContent = list.length;
    if (!list.length) {
      tb.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum funcionário cadastrado. Clique em <strong>+ Novo Funcionário</strong> e use exatamente o PIS que aparece no AFD do REP.</td></tr>';
    } else {
      tb.innerHTML = list.map(e => `<tr>
        <td><strong>${pontoEsc(e.nome)}</strong></td>
        <td><code style="font-size:11px;">${pontoFmtPis(e.pis)}</code></td>
        <td>${pontoEsc(e.cargo || '—')}</td>
        <td>${pontoEsc(e.departamento || '—')}</td>
        <td style="font-size:11px;color:var(--muted);">${pontoEsc(e.work_schedule || '—')}</td>
        <td>${e.daily_hours ?? '—'}</td>
        <td><button onclick="pontoEmpEditar('${e.id}')" style="padding:4px 10px;background:#fff;color:#1a1a1a;border:1px solid var(--border);border-radius:6px;font-size:11px;cursor:pointer;">Editar</button></td>
      </tr>`).join('');
    }
    pontoFillEmpSelects();
  }

  async function pontoEmpSalvar() {
    const nome = document.getElementById('pontoEmpNome').value.trim();
    const pisRaw = document.getElementById('pontoEmpPis').value.replace(/\D/g, '');
    const cargo = document.getElementById('pontoEmpCargo').value.trim();
    const departamento = document.getElementById('pontoEmpDept').value.trim();
    const work_schedule = document.getElementById('pontoEmpSched').value.trim();
    const daily_hours = parseFloat(document.getElementById('pontoEmpHoras').value) || 8;
    if (!nome || !pisRaw) return showToast('Nome e PIS são obrigatórios.', 'error');
    if (pisRaw.length < 11 || pisRaw.length > 12) return showToast('PIS deve ter 11 ou 12 dígitos.', 'error');
    const d = await pontoApi({ action:'ponto_employee_create', nome, pis: pisRaw, cargo, departamento, work_schedule, daily_hours });
    if (d.error) return showToast(d.error, 'error');
    showToast('Funcionário cadastrado.', 'success');
    pontoToggleEmpForm();
    loadPontoEmployees();
  }

  async function pontoEmpEditar(id) {
    const emp = (pontoState.emps || []).find(e => e.id === id);
    if (!emp) return;
    const nome = prompt('Nome', emp.nome); if (nome === null) return;
    const cargo = prompt('Cargo', emp.cargo || ''); if (cargo === null) return;
    const work_schedule = prompt('Jornada (ex: 08:00-12:00,13:00-17:00)', emp.work_schedule || ''); if (work_schedule === null) return;
    const horasStr = prompt('Horas/dia', String(emp.daily_hours || 8)); if (horasStr === null) return;
    const daily_hours = parseFloat(horasStr) || 8;
    const d = await pontoApi({ action:'ponto_employee_update', id, nome, cargo, work_schedule, daily_hours });
    if (d.error) return showToast(d.error, 'error');
    showToast('Funcionário atualizado.', 'success');
    loadPontoEmployees();
  }

  // ── Importar AFD ──────────────────────────────────
  function pontoAfdLimpar() {
    pontoAfdContent = null;
    document.getElementById('pontoAfdFile').value = '';
    document.getElementById('pontoAfdInfo').style.display = 'none';
    document.getElementById('pontoAfdActions').style.display = 'none';
    document.getElementById('pontoAfdStatus').style.display = 'none';
  }

  function pontoAfdPreview() {
    const fi = document.getElementById('pontoAfdFile');
    if (!fi.files.length) return;
    const file = fi.files[0];
    const reader = new FileReader();
    reader.onload = e => {
      const txt = e.target.result;
      pontoAfdContent = txt;
      const lines = txt.split(/\r?\n/).filter(l => l.trim());
      const header = lines.find(l => l[0] === '1');
      const trailer = lines.find(l => l[0] === '9');
      const events = lines.filter(l => l[0] === '3').length;
      const employees = lines.filter(l => l[0] === '5').length;
      let cnpj = '—', empresa = '—', periodo = '—';
      if (header && header.length >= 191) {
        const cnpjRaw = header.substring(27, 41).trim();
        cnpj = cnpjRaw.length === 14
          ? cnpjRaw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
          : cnpjRaw;
        empresa = header.substring(41, 191).trim();
        const ini = header.substring(10, 18);
        const fim = header.substring(18, 26);
        periodo = ini.substring(0,2) + '/' + ini.substring(2,4) + '/' + ini.substring(4,8)
                + ' a ' + fim.substring(0,2) + '/' + fim.substring(2,4) + '/' + fim.substring(4,8);
      }
      const ok = !!header && !!trailer;
      document.getElementById('pontoAfdInfo').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><strong>Arquivo:</strong> ${pontoEsc(file.name)} (${(file.size/1024).toFixed(1)} KB)</div>
          <div><strong>Linhas:</strong> ${lines.length}</div>
          <div><strong>Empresa:</strong> ${pontoEsc(empresa)}</div>
          <div><strong>CNPJ:</strong> ${pontoEsc(cnpj)}</div>
          <div><strong>Período:</strong> ${pontoEsc(periodo)}</div>
          <div><strong>Funcionários (tipo 5):</strong> ${employees}</div>
          <div><strong>Batidas (tipo 3):</strong> ${events}</div>
          <div><strong>Header/Trailer:</strong> ${ok ? '<span style="color:#2d7a3a;">✓ válido</span>' : '<span style="color:#C8102E;">✗ inválido</span>'}</div>
        </div>`;
      document.getElementById('pontoAfdInfo').style.display = 'block';
      document.getElementById('pontoAfdActions').style.display = 'flex';
    };
    reader.readAsText(file);
  }

  async function pontoAfdEnviar() {
    if (!pontoAfdContent) return;
    const fi = document.getElementById('pontoAfdFile');
    const nome_arquivo = fi.files[0]?.name || 'afd.txt';
    const btn = document.getElementById('pontoAfdEnviarBtn');
    const status = document.getElementById('pontoAfdStatus');
    btn.disabled = true; btn.textContent = 'Importando…';
    status.style.display = 'block';
    status.style.background = '#eef4ff'; status.style.color = '#1a6bb5';
    status.textContent = 'Enviando arquivo para o Lumied…';
    const d = await pontoApi({ action:'ponto_afd_upload', conteudo_afd: pontoAfdContent, nome_arquivo });
    if (d.error) {
      status.style.background = '#fdf0f2'; status.style.color = '#C8102E';
      status.textContent = 'Erro: ' + d.error;
      btn.disabled = false; btn.textContent = 'Importar para o Lumied';
      return;
    }
    const r = d.data || d;
    if (r.status === 'erro') {
      status.style.background = '#fdf0f2'; status.style.color = '#C8102E';
      status.innerHTML = '<strong>AFD inválido.</strong><br>' + (r.errors || []).map(e => `• ${pontoEsc(e)}`).join('<br>');
    } else {
      status.style.background = '#edf7ef'; status.style.color = '#2d7a3a';
      status.innerHTML = `<strong>Importação concluída.</strong> ${r.total_eventos} batidas processadas — ${r.resumos_gerados} resumos gerados — ${r.pis_nao_encontrados || 0} PIS sem funcionário cadastrado.`
        + (r.pis_nao_encontrados ? ' <span style="color:#a06400;">⚠ Cadastre os PIS faltantes em <em>Funcionários</em> e re-importe.</span>' : '');
    }
    btn.disabled = false; btn.textContent = 'Importar para o Lumied';
    loadPontoImports();
  }

  async function loadPontoImports() {
    const tb = document.getElementById('pontoImportsTable');
    if (!tb) return;
    tb.innerHTML = '<tr><td colspan="8" class="empty-state"><span class="spinner-sm"></span> Carregando...</td></tr>';
    const d = await pontoApi({ action: 'ponto_imports_list' });
    if (d.error) {
      tb.innerHTML = `<tr><td colspan="8" class="empty-state" style="color:#C8102E;">${pontoEsc(d.error)}</td></tr>`;
      return;
    }
    const list = d.data || [];
    if (!list.length) {
      tb.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhuma importação ainda.</td></tr>';
      return;
    }
    tb.innerHTML = list.map(i => {
      const cnpj = i.cnpj_empregador ? pontoEsc(i.cnpj_empregador) : '—';
      const periodo = i.periodo_inicio && i.periodo_fim
        ? `${new Date(i.periodo_inicio).toLocaleDateString('pt-BR')} → ${new Date(i.periodo_fim).toLocaleDateString('pt-BR')}`
        : '—';
      const dt = i.criado_em
        ? new Date(i.criado_em).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '—';
      const badge = i.status === 'concluido' ? 'badge-green' : i.status === 'erro' ? 'badge-red' : 'badge-orange';
      const origem = i.origem === 'bridge_auto'
        ? '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;background:#eef4ff;color:#1a6bb5;">🤖 auto</span>'
        : '<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;background:#f5f1ec;color:#7a7169;">📤 manual</span>';
      return `<tr>
        <td style="font-size:12px;">${dt}</td>
        <td>${origem}</td>
        <td>${pontoEsc(i.nome_arquivo || '—')}</td>
        <td style="font-size:12px;">${periodo}</td>
        <td style="font-size:11px;">${cnpj}</td>
        <td>${i.total_eventos ?? 0}</td>
        <td style="${i.pis_nao_encontrados ? 'color:#a06400;font-weight:600;' : ''}">${i.pis_nao_encontrados ?? 0}</td>
        <td><span class="badge ${badge}">${pontoEsc(i.status || '—')}</span></td>
      </tr>`;
    }).join('');
  }

  // ── Espelho de Ponto ──────────────────────────────────
  async function loadPontoMirrorPanel() {
    pontoFillMesAno('pontoMirrorMes', 'pontoMirrorAno');
    if (!pontoState.emps.length) {
      const d = await pontoApi({ action: 'ponto_employees_list' });
      pontoState.emps = (d.data || []);
    }
    pontoFillEmpSelects();
  }

  async function loadPontoMirror() {
    const employee_id = document.getElementById('pontoMirrorEmp').value;
    const mes = parseInt(document.getElementById('pontoMirrorMes').value);
    const ano = parseInt(document.getElementById('pontoMirrorAno').value);
    const wrap = document.getElementById('pontoMirrorContent');
    if (!employee_id) { showToast('Selecione um funcionário.', 'error'); return; }
    wrap.innerHTML = '<div class="empty-state"><span class="spinner-sm"></span> Gerando espelho…</div>';
    const d = await pontoApi({ action:'ponto_mirror', employee_id, mes, ano });
    if (d.error) {
      wrap.innerHTML = `<div class="empty-state" style="color:#C8102E;">${pontoEsc(d.error)}</div>`;
      return;
    }
    const r = d.data || d;
    const f = r.funcionario;
    const t = r.totais;
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const statusBadge = s => {
      const map = {
        presente:['#edf7ef','#2d7a3a','Presente'],
        ausente:['#fdf0f2','#C8102E','Ausente'],
        impar:['#fff7e6','#a06400','Marcação ímpar'],
        justificado:['#eef4ff','#1a6bb5','Justificado'],
        fim_de_semana:['#f5f1ec','#7a7169','FDS']
      };
      const v = map[s] || ['#f5f1ec','#7a7169', s || '—'];
      return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;background:${v[0]};color:${v[1]};">${v[2]}</span>`;
    };
    const rows = (r.dias || []).map(dia => {
      const marc = (dia.marcacoes || []).map(m => String(m).substring(0,5)).join(' · ') || '—';
      const dataFmt = dia.data.split('-').reverse().join('/');
      const trStyle = dia.fim_de_semana ? 'background:#fafaf7;color:#7a7169;' : (dia.marcacao_impar ? 'background:#fffaf0;' : '');
      const saldoColor = dia.saldo_minutos > 0 ? 'color:#1a6bb5;' : (dia.saldo_minutos < 0 ? 'color:#C8102E;' : '');
      return `<tr style="${trStyle}">
        <td style="white-space:nowrap;">${dataFmt}</td>
        <td>${dia.dia_semana}</td>
        <td style="font-family:'DM Mono',monospace;font-size:12px;">${marc}</td>
        <td>${dia.minutos_trabalhados_fmt}</td>
        <td style="${saldoColor}">${dia.saldo_fmt}</td>
        <td>${statusBadge(dia.status)}</td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-family:'Lora',serif;font-size:18px;font-weight:600;">${pontoEsc(f.nome)}</div>
          <div style="color:var(--muted);font-size:12px;">${pontoEsc(f.cargo || 'Sem cargo')} · PIS ${pontoFmtPis(f.pis)} · ${f.carga_horaria || 8}h/dia</div>
          <div style="color:var(--muted);font-size:13px;margin-top:4px;">${meses[r.mes-1]} de ${r.ano}</div>
        </div>
        <div style="display:flex;gap:14px;">
          <div style="text-align:center;"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Trabalhado</div><div style="font-size:18px;font-weight:700;color:#2d7a3a;">${t.total_trabalhado_fmt}</div></div>
          <div style="text-align:center;"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Hora extra</div><div style="font-size:18px;font-weight:700;color:#1a6bb5;">${t.total_extra_fmt}</div></div>
          <div style="text-align:center;"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Faltas</div><div style="font-size:18px;font-weight:700;color:#C8102E;">${t.total_faltas}</div></div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Dia</th><th>Marcações</th><th>Trabalhado</th><th>Saldo</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:14px;padding:10px 14px;background:#fdfbf8;border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--muted);">
        Fechamento eletrônico conforme Portaria MTP 671/2021. Para justificar ausências/marcações ímpares, use o painel <strong>Justificativas</strong>.
      </div>`;
  }

  function pontoMirrorPrint() {
    const wrap = document.getElementById('pontoMirrorContent');
    if (!wrap || !wrap.querySelector('table')) {
      showToast('Gere o espelho antes de imprimir.', 'error'); return;
    }
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { showToast('Bloqueador de pop-up impediu a impressão.', 'error'); return; }
    w.document.write('<html><head><title>Espelho de Ponto — Lumied</title>'
      + '<style>body{font-family:Arial,sans-serif;padding:24px;color:#1a1a1a;}'
      + 'table{width:100%;border-collapse:collapse;margin-top:12px;}'
      + 'th,td{border:1px solid #ccc;padding:6px 10px;font-size:12px;text-align:left;}'
      + 'th{background:#f5f1ec;}</style></head><body>'
      + wrap.innerHTML + '</body></html>');
    w.document.close();
    setTimeout(() => w.print(), 300);
  }

  // ── Justificativas ──────────────────────────────────
  function pontoToggleJustifForm() {
    const el = document.getElementById('pontoJustifForm');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
    if (el.style.display === 'block') {
      document.getElementById('pontoJustifData').value = new Date().toISOString().split('T')[0];
      document.getElementById('pontoJustifDesc').value = '';
      pontoFillEmpSelects();
    }
  }

  async function loadPontoJustifPanel() {
    if (!pontoState.emps.length) {
      const d = await pontoApi({ action:'ponto_employees_list' });
      pontoState.emps = (d.data || []);
    }
    pontoFillEmpSelects();
    loadPontoJustifTable();
  }

  function pontoJustifFiltro(s, btn) {
    pontoState.filtroJustif = s;
    document.querySelectorAll('#panelPontoJustif .filter-bar .fb').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadPontoJustifTable();
  }

  async function loadPontoJustifTable() {
    const tb = document.getElementById('pontoJustifTable');
    tb.innerHTML = '<tr><td colspan="6" class="empty-state"><span class="spinner-sm"></span> Carregando...</td></tr>';
    const body = { action: 'ponto_justificativas_list' };
    if (pontoState.filtroJustif) body.status = pontoState.filtroJustif;
    const d = await pontoApi(body);
    if (d.error) {
      tb.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:#C8102E;">${pontoEsc(d.error)}</td></tr>`;
      return;
    }
    const list = d.data || [];
    document.getElementById('pontoJustifCount').textContent = list.length;
    let pendCount;
    if (pontoState.filtroJustif === 'pendente') {
      pendCount = list.length;
    } else {
      const dp = await pontoApi({ action:'ponto_justificativas_list', status:'pendente' });
      pendCount = (dp.data || []).length;
    }
    const b = document.getElementById('pontoJustifBadgePend');
    if (b) b.innerHTML = pendCount
      ? `<span style="background:#C8102E;color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;margin-left:4px;">${pendCount}</span>`
      : '';
    if (!list.length) {
      tb.innerHTML = '<tr><td colspan="6" class="empty-state">Nenhuma justificativa.</td></tr>';
      return;
    }
    const motivos = {
      atestado_medico:'Atestado médico', atestado_familiar:'Atestado familiar',
      ferias:'Férias', folga_compensatoria:'Folga compensatória',
      ponto_facultativo:'Ponto facultativo', esqueceu_bater:'Esqueceu de bater',
      problema_rep:'Problema no REP', outro:'Outro'
    };
    tb.innerHTML = list.map(j => {
      const dt = j.data_justificativa ? j.data_justificativa.split('-').reverse().join('/') : '—';
      const nome = j.ponto_employees?.nome || '—';
      const badge = j.status === 'aprovado' ? 'badge-green' : j.status === 'rejeitado' ? 'badge-red' : 'badge-orange';
      const acoes = j.status === 'pendente'
        ? `<button onclick="pontoJustifAprovar('${j.id}','aprovado')" style="padding:4px 10px;background:#2d7a3a;color:#fff;border:none;border-radius:6px;font-size:11px;cursor:pointer;margin-right:4px;">✓ Aprovar</button>
           <button onclick="pontoJustifAprovar('${j.id}','rejeitado')" style="padding:4px 10px;background:#fff;color:#C8102E;border:1.5px solid #C8102E;border-radius:6px;font-size:11px;cursor:pointer;">✕ Rejeitar</button>`
        : (j.aprovado_por ? `<span style="font-size:11px;color:var(--muted);">por ${pontoEsc(j.aprovado_por)}</span>` : '');
      return `<tr>
        <td style="white-space:nowrap;">${dt}</td>
        <td>${pontoEsc(nome)}</td>
        <td>${pontoEsc(motivos[j.motivo] || j.motivo || '—')}</td>
        <td style="font-size:12px;color:var(--muted);">${pontoEsc(j.descricao || '—')}</td>
        <td><span class="badge ${badge}">${pontoEsc(j.status || '—')}</span></td>
        <td>${acoes}</td>
      </tr>`;
    }).join('');
  }

  async function pontoJustifSalvar() {
    const employee_id = document.getElementById('pontoJustifEmp').value;
    const data_justificativa = document.getElementById('pontoJustifData').value;
    const motivo = document.getElementById('pontoJustifMotivo').value;
    const descricao = document.getElementById('pontoJustifDesc').value.trim();
    if (!employee_id || !data_justificativa || !motivo) {
      return showToast('Funcionário, data e motivo são obrigatórios.', 'error');
    }
    const d = await pontoApi({ action:'ponto_justificativa_criar', employee_id, data_justificativa, motivo, descricao });
    if (d.error) return showToast(d.error, 'error');
    showToast('Justificativa criada.', 'success');
    pontoToggleJustifForm();
    loadPontoJustifTable();
  }

  async function pontoJustifAprovar(id, status) {
    if (status === 'rejeitado' && !await _lumiedConfirm('Rejeitar esta justificativa?')) return;
    const d = await pontoApi({ action:'ponto_justificativa_aprovar', id, status });
    if (d.error) return showToast(d.error, 'error');
    showToast(status === 'aprovado' ? 'Justificativa aprovada.' : 'Justificativa rejeitada.', 'success');
    loadPontoJustifTable();
  }

  // ── Setup do Relógio (página de boas-vindas/wizard) ───────────
  async function loadPontoSetup() {
    const ids = ['pontoSetupStatus','pontoSetupBlockers','pontoSetupScore','pontoSetupBridgeStatus','pontoSetupRepsCount'];
    document.getElementById('pontoSetupStatus').textContent = 'Carregando…';
    document.getElementById('pontoSetupItems').innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted);font-size:13px;">Verificando configurações…</div>';
    const r = await pontoApi({ action: 'ponto_setup_checklist' });
    if (r.error) {
      document.getElementById('pontoSetupStatus').textContent = '⚠️ Erro';
      document.getElementById('pontoSetupBlockers').textContent = r.error;
      document.getElementById('pontoSetupItems').innerHTML = `<div style="background:#fdf0f2;color:#C8102E;padding:14px;border-radius:8px;font-size:13px;">${pontoEsc(r.error)}</div>`;
      return;
    }
    const d = r.data || r;
    const score = Number(d.score || 0);
    document.getElementById('pontoSetupScore').textContent = score + '%';
    if (d.pode_operar) {
      document.getElementById('pontoSetupStatus').textContent = score === 100 ? '🟢 Tudo configurado' : '🟢 Pronto pra operar';
      document.getElementById('pontoSetupBlockers').textContent = score === 100 ? 'Parabéns — relógio ponto 100% integrado.' : `${100 - score}% do checklist em aberto, mas nada bloqueia o uso.`;
    } else {
      document.getElementById('pontoSetupStatus').textContent = '🔴 Faltam itens essenciais';
      document.getElementById('pontoSetupBlockers').textContent = `${d.blockers} item(ns) bloqueante(s) — resolva antes de fechar a folha.`;
    }
    // Bridge / REPs status
    const bridge = d.bridge || {};
    const bSt = document.getElementById('pontoSetupBridgeStatus');
    if (bridge.online) bSt.innerHTML = `<span style="color:#2d7a3a;">🟢 online</span> <small style="color:var(--muted);font-weight:400;">(há ${bridge.min_atras} min)</small>`;
    else if (bridge.ultimo_heartbeat) bSt.innerHTML = `<span style="color:#C8102E;">🔴 offline</span> <small style="color:var(--muted);font-weight:400;">(há ${bridge.min_atras} min)</small>`;
    else bSt.innerHTML = `<span style="color:#7a7169;">○ não instalado</span>`;
    document.getElementById('pontoSetupRepsCount').textContent = (d.reps_count || 0) + ' REP(s)';

    // Itens do checklist
    const cont = document.getElementById('pontoSetupItems');
    const items = d.items || [];
    const COR = { ok: '#2d7a3a', warn: '#b07d10', error: '#c0392b', muted: '#888' };
    const ICO = { ok: '✅', warn: '⚠️', error: '❌', muted: '○' };
    cont.innerHTML = items.map((it, i) => {
      const c = COR[it.severity] || '#666';
      const ic = ICO[it.severity] || '○';
      const blk = it.blocking && !it.ok
        ? '<span style="background:#c0392b;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:8px;text-transform:uppercase;font-weight:600;">Bloqueante</span>'
        : '';
      const action = it.action
        ? `<button onclick="pontoSetupGoto('${it.action.panel}')" style="margin-left:auto;padding:8px 16px;background:${it.ok ? '#fff' : '#1a1a1a'};color:${it.ok ? '#1a1a1a' : '#fff'};border:1px solid ${it.ok ? 'var(--border)' : '#1a1a1a'};border-radius:8px;font-size:12px;cursor:pointer;white-space:nowrap;font-weight:600;">${pontoEsc(it.action.label)} →</button>`
        : '';
      return `<div style="display:flex;align-items:center;gap:14px;background:#fff;border:1px solid ${c}33;border-left:4px solid ${c};border-radius:10px;padding:16px 20px;">
        <div style="font-size:22px;color:#7a7169;font-weight:600;min-width:24px;">${i + 1}</div>
        <div style="font-size:22px;">${ic}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;color:${c};font-size:14px;">${pontoEsc(it.label)}${blk}</div>
          <div style="color:var(--muted);font-size:12px;margin-top:3px;line-height:1.4;">${pontoEsc(it.detail || '')}</div>
        </div>
        ${action}
      </div>`;
    }).join('');
  }

  function pontoSetupGoto(panel) {
    const navItems = document.querySelectorAll('.nav-item');
    let target = null;
    navItems.forEach(n => { if (n.getAttribute('onclick')?.includes(`'${panel}'`)) target = n; });
    if (target) target.click();
    else showPanel(panel);
  }

  // ── REPs (coleta automática via Lumied Bridge) ─────────────────
  function pontoTabSwitch(tab, btn) {
    document.querySelectorAll('#panelPontoImport .filter-bar .fb').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.getElementById('pontoTabContentManual').style.display = tab === 'manual' ? 'block' : 'none';
    document.getElementById('pontoTabContentAuto').style.display = tab === 'auto' ? 'block' : 'none';
    if (tab === 'auto') loadPontoReps();
  }

  function pontoToggleRepForm() {
    const el = document.getElementById('pontoRepForm');
    const open = el.style.display === 'none';
    el.style.display = open ? 'block' : 'none';
    if (open) {
      ['pontoRepNome','pontoRepModelo','pontoRepIp','pontoRepUsuario','pontoRepSenha','pontoRepUrlLogin'].forEach(i => {
        const e = document.getElementById(i); if (e) e.value = '';
      });
      document.getElementById('pontoRepMarca').value = 'controlid';
      pontoRepPreset('controlid');
      document.getElementById('pontoRepUsuario').value = 'admin';
      document.getElementById('pontoRepFormStatus').style.display = 'none';
    }
  }

  function pontoRepPreset(marca) {
    const presets = {
      controlid: { porta:443, proto:'https', auth:'controlid_session', urlLogin:'/login.fcgi',     urlAfd:'/get_afd.fcgi?initial_date={DATAINI}&final_date={DATAFIM}', modeloPh:'iDClass Bio Prox' },
      henry:     { porta:80,  proto:'http',  auth:'form_login',        urlLogin:'/cgi-bin/login.cgi', urlAfd:'/cgi-bin/afd.cgi?dataini={DATAINI}&datafim={DATAFIM}',     modeloPh:'Hexa / Prima / Vega' },
      topdata:   { porta:80,  proto:'http',  auth:'basic',             urlLogin:'',                  urlAfd:'/AFD?inicio={DATAINI}&fim={DATAFIM}',                       modeloPh:'Inner Rep / Plus' },
      madis:     { porta:80,  proto:'http',  auth:'form_login',        urlLogin:'/login',            urlAfd:'/relatorio/afd?ini={DATAINI}&fim={DATAFIM}',                modeloPh:'MD706 / MDX' },
      outro:     { porta:80,  proto:'http',  auth:'form_login',        urlLogin:'',                  urlAfd:'',                                                          modeloPh:'(seu modelo)' }
    };
    const p = presets[marca] || presets.outro;
    document.getElementById('pontoRepPorta').value = p.porta;
    document.getElementById('pontoRepProto').value = p.proto;
    document.getElementById('pontoRepAuthModo').value = p.auth;
    document.getElementById('pontoRepUrlLogin').value = p.urlLogin;
    document.getElementById('pontoRepUrlAfd').value = p.urlAfd;
    document.getElementById('pontoRepModelo').placeholder = p.modeloPh;
  }

  async function loadPontoReps() {
    const tb = document.getElementById('pontoRepsTable');
    tb.innerHTML = '<tr><td colspan="7" class="empty-state"><span class="spinner-sm"></span> Carregando...</td></tr>';
    const d = await pontoApi({ action: 'ponto_rep_devices_list' });
    if (d.error) {
      tb.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:#C8102E;">${pontoEsc(d.error)}</td></tr>`;
      return;
    }
    const list = d.data || [];
    document.getElementById('pontoRepsCount').textContent = list.length;
    if (!list.length) {
      tb.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum REP cadastrado. Clique em <strong>+ Cadastrar REP</strong>.</td></tr>';
      return;
    }
    tb.innerHTML = list.map(r => {
      const ult = r.ultimo_pull_em ? new Date(r.ultimo_pull_em).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
      const stMap = { ok:['#edf7ef','#2d7a3a','✓ ok'], erro_login:['#fdf0f2','#C8102E','login falhou'], erro_download:['#fdf0f2','#C8102E','download falhou'], erro_parse:['#fdf0f2','#C8102E','parse falhou'], sem_dados:['#fff7e6','#a06400','sem batidas'] };
      const st = stMap[r.ultimo_pull_status] || (r.ultimo_pull_status ? ['#f5f1ec','#7a7169', r.ultimo_pull_status] : ['#f5f1ec','#7a7169','aguardando']);
      const eventosLast = r.ultimo_pull_eventos != null ? ` <small style="color:var(--muted);">(${r.ultimo_pull_eventos} ev.)</small>` : '';
      const erroTooltip = r.ultimo_pull_erro ? ` title="${pontoEsc(r.ultimo_pull_erro)}"` : '';
      return `<tr>
        <td><strong>${pontoEsc(r.nome)}</strong></td>
        <td>${pontoEsc(r.marca)} ${pontoEsc(r.modelo || '')}</td>
        <td style="font-family:'DM Mono',monospace;font-size:12px;">${pontoEsc(r.protocolo)}://${pontoEsc(r.ip)}:${r.porta}</td>
        <td style="font-size:12px;">${ult}${eventosLast}</td>
        <td><span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;background:${st[0]};color:${st[1]};"${erroTooltip}>${st[2]}</span></td>
        <td>${r.ativo ? '<span style="color:#2d7a3a;font-weight:600;">●</span>' : '<span style="color:#888;">○</span>'}</td>
        <td>
          <button onclick="pontoRepPullNow('${r.id}')" style="padding:4px 10px;background:#1a6bb5;color:#fff;border:none;border-radius:6px;font-size:11px;cursor:pointer;margin-right:4px;">▶ Buscar agora</button>
          <button onclick="pontoRepEditar('${r.id}')" style="padding:4px 10px;background:#fff;color:#1a1a1a;border:1px solid var(--border);border-radius:6px;font-size:11px;cursor:pointer;margin-right:4px;">Editar</button>
          <button onclick="pontoRepDeletar('${r.id}','${pontoEsc(r.nome)}')" style="padding:4px 10px;background:#fff;color:#C8102E;border:1px solid #C8102E;border-radius:6px;font-size:11px;cursor:pointer;">Excluir</button>
        </td>
      </tr>`;
    }).join('');
  }

  function _pontoRepFormPayload() {
    return {
      nome: document.getElementById('pontoRepNome').value.trim(),
      marca: document.getElementById('pontoRepMarca').value,
      modelo: document.getElementById('pontoRepModelo').value.trim(),
      ip: document.getElementById('pontoRepIp').value.trim(),
      porta: parseInt(document.getElementById('pontoRepPorta').value) || 80,
      protocolo: document.getElementById('pontoRepProto').value,
      auth_modo: document.getElementById('pontoRepAuthModo').value,
      usuario: document.getElementById('pontoRepUsuario').value.trim(),
      senha: document.getElementById('pontoRepSenha').value,
      url_login: document.getElementById('pontoRepUrlLogin').value.trim(),
      url_afd_template: document.getElementById('pontoRepUrlAfd').value.trim()
    };
  }

  function _pontoRepValidate(p) {
    if (!p.nome) return 'Nome obrigatório';
    if (!p.ip) return 'IP obrigatório';
    if (!p.url_afd_template) return 'URL do AFD obrigatória';
    if (p.auth_modo === 'form_login' && !p.url_login) return 'URL de login obrigatória para Auth=form_login';
    if (p.auth_modo !== 'none' && (!p.usuario || !p.senha)) return 'Usuário e senha obrigatórios';
    return null;
  }

  async function pontoRepSalvar() {
    const p = _pontoRepFormPayload();
    const err = _pontoRepValidate(p);
    if (err) return showToast(err, 'error');
    const editing = document.getElementById('pontoRepForm').dataset.editingId;
    const action = editing ? 'ponto_rep_devices_update' : 'ponto_rep_devices_create';
    const body = editing ? { action, id: editing, ...p } : { action, ...p };
    const d = await pontoApi(body);
    if (d.error) return showToast(d.error, 'error');
    showToast(editing ? 'REP atualizado.' : 'REP cadastrado. Próxima coleta automática às 03:30 BRT.', 'success');
    delete document.getElementById('pontoRepForm').dataset.editingId;
    pontoToggleRepForm();
    loadPontoReps();
  }

  async function pontoRepTestar() {
    const p = _pontoRepFormPayload();
    const err = _pontoRepValidate(p);
    if (err) return showToast(err, 'error');
    const st = document.getElementById('pontoRepFormStatus');
    const btn = document.getElementById('pontoRepTestBtn');
    btn.disabled = true; btn.textContent = '🧪 Testando…';
    st.style.display = 'block';
    st.style.background = '#eef4ff'; st.style.color = '#1a6bb5';
    st.textContent = 'Pedindo ao Lumied Bridge para buscar o AFD de ontem… isso pode levar até 30s.';
    const d = await pontoApi({ action: 'ponto_rep_devices_test', ...p });
    btn.disabled = false; btn.textContent = '🧪 Testar agora (ontem)';
    if (d.error) {
      st.style.background = '#fdf0f2'; st.style.color = '#C8102E';
      st.innerHTML = '<strong>Falhou.</strong> ' + pontoEsc(d.error);
      return;
    }
    const r = d.data || d;
    if (r.status === 'ok') {
      st.style.background = '#edf7ef'; st.style.color = '#2d7a3a';
      st.innerHTML = `<strong>✓ Funcionou.</strong> ${r.eventos || 0} batidas baixadas. Pode salvar — coletas diárias automáticas a partir de amanhã às 03:30 BRT.`;
    } else {
      st.style.background = '#fdf0f2'; st.style.color = '#C8102E';
      st.innerHTML = `<strong>✗ ${pontoEsc(r.status)}.</strong> ${pontoEsc(r.erro || '')}`;
    }
  }

  async function pontoRepEditar(id) {
    const d = await pontoApi({ action: 'ponto_rep_devices_list' });
    const rep = (d.data || []).find(r => r.id === id);
    if (!rep) return showToast('REP não encontrado.', 'error');
    pontoToggleRepForm(); // abre o form
    document.getElementById('pontoRepForm').dataset.editingId = id;
    document.getElementById('pontoRepNome').value = rep.nome || '';
    document.getElementById('pontoRepMarca').value = rep.marca || 'controlid';
    document.getElementById('pontoRepModelo').value = rep.modelo || '';
    document.getElementById('pontoRepIp').value = rep.ip || '';
    document.getElementById('pontoRepPorta').value = rep.porta || 80;
    document.getElementById('pontoRepProto').value = rep.protocolo || 'http';
    document.getElementById('pontoRepAuthModo').value = rep.auth_modo || 'controlid_session';
    document.getElementById('pontoRepUsuario').value = rep.usuario || '';
    document.getElementById('pontoRepSenha').value = ''; // nunca pré-preenche senha
    document.getElementById('pontoRepUrlLogin').value = rep.url_login || '';
    document.getElementById('pontoRepUrlAfd').value = rep.url_afd_template || '';
    document.getElementById('pontoRepSenha').placeholder = 'deixe vazio para manter senha atual';
  }

  async function pontoRepDeletar(id, nome) {
    if (!await _lumiedConfirm(`Excluir REP "${nome}"? As importações já feitas continuam.`)) return;
    const d = await pontoApi({ action: 'ponto_rep_devices_delete', id });
    if (d.error) return showToast(d.error, 'error');
    showToast('REP excluído.', 'success');
    loadPontoReps();
  }

  async function pontoRepPullNow(id) {
    showToast('Pedindo coleta agora ao Bridge…', 'info');
    const d = await pontoApi({ action: 'ponto_rep_devices_pull_now', id });
    if (d.error) return showToast(d.error, 'error');
    const r = d.data || d;
    if (r.status === 'ok') {
      showToast(`✓ ${r.eventos || 0} batidas coletadas.`, 'success');
    } else {
      showToast(`✗ ${r.status}: ${r.erro || ''}`, 'error');
    }
    loadPontoReps();
    loadPontoImports();
  }
