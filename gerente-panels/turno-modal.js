// Auto-extraído do gerente.html (Onda 4 — batch final).
// Turno modal + Importação turnos XLSX
  // ── TURNO MODAL ───────────────────────────────────────
  function openModal(id, turnoAtual, nome) {
    editingId=id;
    document.getElementById('modalDesc').textContent='Alterando turno de: '+nome;
    document.getElementById('modalTurnos').innerHTML = Object.entries(TURNO_INFO).map(([v,t])=>
      `<div class="mt-opt"><input type="radio" name="mt" id="mt_${v}" value="${v}" ${v===turnoAtual?'checked':''}><label for="mt_${v}"><span class="mtn">${t.label}</span>${t.price?'<span class="mtp">'+t.price+'</span>':''}</label></div>`
    ).join('');
    document.getElementById('modalOverlay').classList.add('show');
  }
  function closeModal(){ document.getElementById('modalOverlay').classList.remove('show'); editingId=null; }
  async function saveTurno() {
    const v = document.querySelector('input[name="mt"]:checked')?.value;
    if(!v||!editingId) return;
    document.getElementById('btnSave').disabled=true;
    const d = await api({ action:'aluno_update_turno', id:editingId, turno:v });
    if (d.error) showToast(d.error, 'error');
    closeModal(); document.getElementById('btnSave').disabled=false; loadData();
  }

  // ── IMPORTAÇÃO DE TURNOS (XLSX) ────────────────────────
  var turnoImportData = [];
  function turnoGerarModelo() {
    if (typeof XLSX === 'undefined') { showToast('Aguarde o carregamento do XLSX','error'); return; }
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['nome', 'turno', 'dias_semana'],
      ['Maria Silva', 'integral_5x', 'Segunda,Terça,Quarta,Quinta,Sexta'],
      ['João Souza', 'semi_2x', 'Segunda,Quarta'],
      ['Ana Costa', 'tarde', ''],
      ['Carlos Lima', 'diaria', 'Terça'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 45 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Turnos');
    const turnosRef = [
      ['Instruções para importação de turnos'],
      [''],
      ['Colunas:'],
      ['  nome — Nome do aluno (deve corresponder exatamente ao cadastro)'],
      ['  turno — Código do turno (ver lista abaixo)'],
      ['  dias_semana — Dias separados por vírgula (opcional)'],
      [''],
      ['Códigos de turno disponíveis:'],
      ...Object.entries(TURNO_INFO).map(([k,v]) => ['  ' + k + ' — ' + v.label + (v.price ? ' (' + v.price + ')' : '')]),
      [''],
      ['Dias válidos: Segunda, Terça, Quarta, Quinta, Sexta'],
      [''],
      ['IMPORTANTE:'],
      ['  - Somente alunos cujo nome apareça na planilha serão atualizados.'],
      ['  - Alunos que não estejam na planilha NÃO serão modificados.'],
      ['  - O nome deve ser idêntico ao cadastrado no sistema.'],
    ];
    const wsInst = XLSX.utils.aoa_to_sheet(turnosRef);
    wsInst['!cols'] = [{ wch: 80 }];
    XLSX.utils.book_append_sheet(wb, wsInst, 'Instruções');
    XLSX.writeFile(wb, 'modelo_importacao_turnos.xlsx');
  }

  function turnoImportarXlsx(input) {
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
      turnoImportData = rows.map(r => {
        const nome = (r.nome || r.Nome || r.NOME || '').toString().trim();
        const turno = (r.turno || r.Turno || r.TURNO || '').toString().trim().toLowerCase();
        const diasRaw = (r.dias_semana || r.Dias || r.dias || '').toString().trim();
        const dias_semana = diasRaw ? diasRaw.split(/[,;|]/).map(d => d.trim()).filter(Boolean) : [];
        return { nome, turno, dias_semana };
      }).filter(r => r.nome && r.turno);
      if (!turnoImportData.length) { showToast('Nenhum registro válido (nome + turno obrigatórios)','error'); return; }
      // Validate turno codes
      const invalidos = turnoImportData.filter(r => !TURNO_INFO[r.turno]);
      document.getElementById('turnoImportList').innerHTML =
        '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr><th style="text-align:left;padding:4px 8px;">Nome</th><th style="text-align:left;padding:4px 8px;">Turno</th><th style="text-align:left;padding:4px 8px;">Dias</th><th style="text-align:left;padding:4px 8px;">Status</th></tr></thead><tbody>' +
        turnoImportData.map(r => {
          const valid = TURNO_INFO[r.turno];
          return `<tr style="${valid?'':'background:#fef2f2;'}"><td style="padding:4px 8px;">${esc(r.nome)}</td><td style="padding:4px 8px;">${valid ? esc(valid.label) : '<span style="color:#991b1b;">'+esc(r.turno)+' (inválido)</span>'}</td><td style="padding:4px 8px;">${r.dias_semana.length ? esc(r.dias_semana.join(', ')) : '—'}</td><td style="padding:4px 8px;">${valid ? '✅' : '❌'}</td></tr>`;
        }).join('') +
        '</tbody></table>';
      const errEl = document.getElementById('turnoImportErr');
      const okEl = document.getElementById('turnoImportOk');
      errEl.style.display = 'none'; okEl.style.display = 'none';
      if (invalidos.length) {
        errEl.textContent = invalidos.length + ' registro(s) com turno inválido — serão ignorados.';
        errEl.style.display = 'block';
      }
      document.getElementById('turnoImportPreview').style.display = 'block';
    };
    reader.readAsArrayBuffer(file);
  }

  async function turnoConfirmarImport() {
    const errEl = document.getElementById('turnoImportErr');
    const okEl = document.getElementById('turnoImportOk');
    errEl.style.display = 'none'; okEl.style.display = 'none';
    const validos = turnoImportData.filter(r => TURNO_INFO[r.turno]);
    if (!validos.length) { errEl.textContent = 'Nenhum registro válido para importar.'; errEl.style.display = 'block'; return; }
    const btn = document.querySelector('#turnoImportPreview .btn-create');
    if (btn) { btn.disabled = true; btn.textContent = 'Importando...'; }
    const d = await api({ action: 'alunos_import_turnos', registros: validos });
    if (d.error) {
      errEl.textContent = d.error; errEl.style.display = 'block';
    } else {
      const msgs = [];
      if (d.sucesso) msgs.push(d.sucesso + ' atualizado(s)');
      if (d.erros && d.erros.length) msgs.push(d.erros.length + ' erro(s)');
      okEl.textContent = msgs.join(', ') || 'Concluído';
      okEl.style.display = 'block';
      if (d.erros && d.erros.length) {
        errEl.textContent = d.erros.join(' | ');
        errEl.style.display = 'block';
      }
    }
    turnoImportData = [];
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar Importação'; }
    loadData();
  }
