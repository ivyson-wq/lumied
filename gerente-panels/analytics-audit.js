// Auto-extraído do gerente.html (Onda 4 — batch final).
// Analytics ocupação + Audit log + Saúde do cadastro
  // ── Analytics: ocupação + sugestão de capacidade ─────────────
  async function loadRecursosAnalytics() {
    const wrap = document.getElementById('recursosAnalytics');
    if (!wrap) return;
    wrap.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px;">⏳ Calculando ocupação…</div>';
    const d = await api({ action: 'recursos_analytics' });
    if (d.error) { wrap.innerHTML = ''; return; }
    if (!d.total_recursos) { wrap.innerHTML = ''; return; }

    const corTaxa = (pct) => pct >= 80 ? '#b91c1c' : pct >= 60 ? '#d97706' : '#15803d';
    const tipoLbl = { tablet:'📱 Tablet', projetor:'📽️ Projetor', sala:'🚪 Sala', impressora:'🖨️ Impressora', outro:'📦 Outro' };

    const sugestoes = (d.por_tipo || []).filter(t => t.sugestao_extras > 0);
    const heroSug = sugestoes.length
      ? `<div style="background:linear-gradient(135deg,#fef3c7,#fef9e7);border:1px solid #fcd34d;border-radius:10px;padding:12px 16px;margin-bottom:12px;">
          <strong style="color:#92400e;">📊 Recomendação de capacidade</strong>
          <div style="font-size:12px;color:#78350f;margin-top:4px;">
            ${sugestoes.map(s => `Adicionar <strong>${s.sugestao_extras} ${tipoLbl[s.tipo] || s.tipo}</strong> a mais (uso atual: ${s.taxa_pct}% — saturado).`).join(' · ')}
          </div>
        </div>`
      : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#166534;">
          ✅ Capacidade adequada — nenhum tipo de recurso saturado nas próximas 2 semanas.
        </div>`;

    const tabelaRecursos = (d.por_recurso || []).slice(0, 12).map(r => {
      const pct = r.taxa_ocupacao_pct;
      const cor = corTaxa(pct);
      return `<tr style="border-bottom:1px solid #f0ece6;">
        <td style="padding:6px 10px;font-size:12px;">${tipoLbl[r.tipo] || r.tipo}</td>
        <td style="padding:6px 10px;font-size:12px;font-weight:600;">${esc(r.identificacao)}</td>
        <td style="padding:6px 10px;font-size:11px;color:var(--muted);text-align:right;">${r.horasReservadas.toFixed(1)}h / ${r.horas_capacidade}h</td>
        <td style="padding:6px 10px;font-size:11px;text-align:right;">
          <div style="display:inline-block;width:90px;background:#f0ece6;border-radius:4px;height:6px;overflow:hidden;vertical-align:middle;margin-right:6px;">
            <div style="height:100%;width:${Math.min(100,pct)}%;background:${cor};"></div>
          </div>
          <span style="color:${cor};font-weight:600;">${pct}%</span>
        </td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `
      ${heroSug}
      <details style="background:#fff;border:1px solid var(--border);border-radius:10px;">
        <summary style="cursor:pointer;padding:10px 14px;font-weight:600;font-size:13px;list-style:none;display:flex;justify-content:space-between;align-items:center;">
          <span>📈 Ocupação por recurso (próx. 14 dias)</span>
          <span style="font-size:11px;color:var(--muted);font-weight:400;">${d.total_recursos} recurso(s) · ${d.total_reservas_periodo} reserva(s) ▾</span>
        </summary>
        <div style="padding:0 14px 12px;">
          <table style="width:100%;border-collapse:collapse;margin-top:8px;">
            <thead><tr style="background:#f9f7f4;">
              <th style="padding:6px 10px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted);">Tipo</th>
              <th style="padding:6px 10px;text-align:left;font-size:10px;text-transform:uppercase;color:var(--muted);">Recurso</th>
              <th style="padding:6px 10px;text-align:right;font-size:10px;text-transform:uppercase;color:var(--muted);">Horas</th>
              <th style="padding:6px 10px;text-align:right;font-size:10px;text-transform:uppercase;color:var(--muted);">Ocupação</th>
            </tr></thead>
            <tbody>${tabelaRecursos || '<tr><td colspan="4" style="padding:12px;text-align:center;color:var(--muted);font-size:12px;">Nenhuma reserva no período.</td></tr>'}</tbody>
          </table>
        </div>
      </details>
    `;
  }

  // ── Audit log ──────────────────────────────────────────
  async function loadAuditLog() {
    const wrap = document.getElementById('auditLogContent');
    wrap.innerHTML = '⏳ Carregando…';
    const ent = document.getElementById('auditEntidade').value;
    const d = await api({ action: 'audit_log_list', entidade: ent || null, limit: 100 });
    if (d.error) { wrap.innerHTML = `<div class="f-alert error show">${esc(d.error)}</div>`; return; }
    const list = d.data || [];
    if (!list.length) { wrap.innerHTML = '<div style="padding:14px;text-align:center;">Nenhuma mudança registrada.</div>'; return; }
    const acaoIcon = { insert:'➕', update:'✏️', delete:'🗑️' };
    const entLbl = { series:'Turma', atividades:'Atividade' };
    wrap.innerHTML = '<div style="max-height:320px;overflow-y:auto;">' + list.map(r => {
      const data = new Date(r.criado_em).toLocaleString('pt-BR');
      const nome = r.depois?.nome || r.antes?.nome || r.entidade_id;
      let detalhes = '';
      if (r.acao === 'update' && r.antes && r.depois) {
        const diffs = [];
        for (const k of new Set([...Object.keys(r.antes), ...Object.keys(r.depois)])) {
          if (k === 'atualizado_em' || k === 'criado_em') continue;
          if (JSON.stringify(r.antes[k]) !== JSON.stringify(r.depois[k])) {
            diffs.push(`${k}: ${esc(JSON.stringify(r.antes[k]))} → ${esc(JSON.stringify(r.depois[k]))}`);
          }
        }
        if (diffs.length) detalhes = '<div style="font-size:10px;color:var(--muted);margin-top:2px;">' + diffs.slice(0,3).join('; ') + '</div>';
      }
      return `<div style="padding:8px 10px;border-bottom:1px solid #f0ece6;">
        <div style="display:flex;justify-content:space-between;gap:8px;">
          <span><strong>${acaoIcon[r.acao] || ''} ${entLbl[r.entidade] || r.entidade}</strong> · ${esc(nome)}</span>
          <span style="color:var(--muted);font-size:10px;">${data}</span>
        </div>
        ${detalhes}
      </div>`;
    }).join('') + '</div>';
  }

  // ── Saúde do cadastro ──────────────────────────────────
  async function loadCadastroSaude() {
    const wrap = document.getElementById('cadastroSaudeContent');
    wrap.innerHTML = '⏳ Verificando…';
    const d = await api({ action: 'cadastro_saude' });
    if (d.error) { wrap.innerHTML = `<div class="f-alert error show">${esc(d.error)}</div>`; return; }
    const r = d.resumo || {};
    const cardKpi = (label, val, alert) => `<div style="background:${alert?'#fff7ed':'#f0fdf4'};border:1px solid ${alert?'#fed7aa':'#bbf7d0'};border-radius:10px;padding:12px 14px;flex:1;min-width:140px;">
      <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">${label}</div>
      <div style="font-size:22px;font-weight:700;color:${alert?'#c2410c':'#15803d'};margin-top:4px;">${val}</div>
    </div>`;
    const issueList = (titulo, items, render) => !items?.length ? '' : `
      <div style="margin-top:16px;background:#fff;border:1px solid #fed7aa;border-radius:12px;padding:14px 16px;">
        <div style="font-weight:600;font-size:13px;color:#9a3412;margin-bottom:8px;">⚠️ ${titulo} (${items.length})</div>
        <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">${items.map(render).join('')}</div>
      </div>`;
    wrap.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
        ${cardKpi('Turmas', r.total_series ?? 0, false)}
        ${cardKpi('Alunos ativos', r.total_alunos_ativos ?? 0, false)}
        ${cardKpi('Professoras', r.total_professoras ?? 0, false)}
        ${cardKpi('Alunos sem turma', r.alunos_sem_turma ?? 0, (r.alunos_sem_turma ?? 0) > 0)}
        ${cardKpi('Turmas sem aluno', r.turmas_sem_aluno ?? 0, (r.turmas_sem_aluno ?? 0) > 0)}
        ${cardKpi('Turmas sem professora', r.turmas_sem_professor ?? 0, (r.turmas_sem_professor ?? 0) > 0)}
        ${cardKpi('Nomes duplicados', r.nomes_duplicados ?? 0, (r.nomes_duplicados ?? 0) > 0)}
        ${cardKpi('Sem e-mail família', r.alunos_sem_familia_email ?? 0, (r.alunos_sem_familia_email ?? 0) > 0)}
      </div>
      ${issueList('Alunos sem turma', d.alunos_sem_turma, a => `<div>• ${esc(a.nome)} <button onclick="showPanel('alunos')" style="background:none;border:none;color:var(--blue);cursor:pointer;font-size:11px;font-family:inherit;">→ corrigir</button></div>`)}
      ${issueList('Turmas sem aluno', d.turmas_sem_aluno, t => `<div>• ${esc(t.nome)}</div>`)}
      ${issueList('Turmas sem professora', d.turmas_sem_professor, t => `<div>• ${esc(t.nome)}</div>`)}
      ${issueList('Nomes de turma duplicados', d.nomes_duplicados, n => `<div>• "${esc(n.nome)}" aparece ${n.count}× — revisar e mesclar</div>`)}
      ${issueList('Alunos sem e-mail da família', d.alunos_sem_familia_email, a => `<div>• ${esc(a.nome)}</div>`)}
      ${(r.alunos_sem_turma + r.turmas_sem_aluno + r.turmas_sem_professor + r.nomes_duplicados + r.alunos_sem_familia_email) === 0
        ? '<div style="margin-top:12px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;color:#15803d;font-weight:600;">✅ Cadastro saudável — nenhuma inconsistência detectada.</div>' : ''}
    `;
  }
