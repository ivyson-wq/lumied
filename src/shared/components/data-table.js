/**
 * Data Table Component — reusable sortable/filterable table with pagination
 * Usage:
 *   renderTable(container, {
 *     columns: [{ key: 'nome', label: 'Nome', sortable: true }, ...],
 *     data: [...],
 *     onRowClick: (row) => {},
 *     emptyMessage: 'Nenhum dado',
 *     pageSize: 25,        // items per page (0 = no pagination)
 *     emptyIcon: '📭',     // emoji for empty state
 *     emptyCta: { label: 'Cadastrar', onClick: () => {} },
 *   });
 */

export function renderTable(container, { columns, data, onRowClick, emptyMessage = 'Nenhum dado encontrado.', emptyIcon = '📭', emptyCta, actions, pageSize = 0 }) {
  if (!data || data.length === 0) {
    let html = `<div class="empty-state" style="text-align:center;padding:48px 24px;">
      <div style="font-size:48px;margin-bottom:12px;opacity:.8;">${emptyIcon}</div>
      <div style="color:var(--muted,#888);font-size:14px;line-height:1.6;">${emptyMessage}</div>`;
    if (emptyCta) {
      html += `<button class="empty-cta" style="margin-top:16px;padding:10px 22px;background:var(--red,#C8102E);color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">${emptyCta.label}</button>`;
    }
    html += '</div>';
    container.innerHTML = html;
    if (emptyCta) {
      container.querySelector('.empty-cta')?.addEventListener('click', emptyCta.onClick);
    }
    return;
  }

  let sortKey = null;
  let sortAsc = true;
  let currentData = [...data];
  let currentPage = 0;
  const perPage = pageSize > 0 ? pageSize : data.length;

  function getPageData() {
    const start = currentPage * perPage;
    return currentData.slice(start, start + perPage);
  }

  function render() {
    const pageData = getPageData();
    let html = '<div class="table-wrap"><table><thead><tr>';
    for (const col of columns) {
      const sortIcon = sortKey === col.key ? (sortAsc ? ' ↑' : ' ↓') : '';
      const cursor = col.sortable ? 'cursor:pointer;' : '';
      html += `<th style="${cursor}" data-sort="${col.key}">${col.label || col.key}${sortIcon}</th>`;
    }
    if (actions) html += '<th>Ações</th>';
    html += '</tr></thead><tbody>';

    for (const row of pageData) {
      const clickAttr = onRowClick ? 'style="cursor:pointer;"' : '';
      html += `<tr ${clickAttr}>`;
      for (const col of columns) {
        let value = row[col.key];
        if (col.render) value = col.render(value, row);
        else if (value === null || value === undefined) value = '—';
        html += `<td>${value}</td>`;
      }
      if (actions) {
        html += '<td>' + actions.map(a =>
          `<button class="action-btn${a.danger ? ' del' : ''}" data-action="${a.key}" title="${a.label || ''}">${a.icon || a.label}</button>`
        ).join(' ') + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';

    // Pagination
    if (pageSize > 0 && currentData.length > perPage) {
      const totalPages = Math.ceil(currentData.length / perPage);
      const start = currentPage * perPage + 1;
      const end = Math.min((currentPage + 1) * perPage, currentData.length);
      html += `<div class="lm-pagination">
        <span>${start}–${end} de ${currentData.length}</span>
        <div style="display:flex;gap:6px;">
          <button class="pg-prev" ${currentPage === 0 ? 'disabled' : ''}>← Anterior</button>
          <span style="padding:6px 10px;font-size:12px;">${currentPage + 1} / ${totalPages}</span>
          <button class="pg-next" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Próximo →</button>
        </div>
      </div>`;
    }

    container.innerHTML = html;

    // Sort click handlers
    container.querySelectorAll('th[data-sort]').forEach(th => {
      const col = columns.find(c => c.key === th.dataset.sort);
      if (col?.sortable) {
        th.addEventListener('click', () => {
          if (sortKey === col.key) sortAsc = !sortAsc;
          else { sortKey = col.key; sortAsc = true; }
          currentData.sort((a, b) => {
            const va = a[col.key] ?? '';
            const vb = b[col.key] ?? '';
            const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
            return sortAsc ? cmp : -cmp;
          });
          currentPage = 0;
          render();
        });
      }
    });

    // Row click handlers
    if (onRowClick) {
      container.querySelectorAll('tbody tr').forEach((tr, i) => {
        tr.addEventListener('click', (e) => {
          if (e.target.closest('.action-btn')) return;
          const dataIdx = currentPage * perPage + i;
          onRowClick(currentData[dataIdx], dataIdx);
        });
      });
    }

    // Action button handlers
    if (actions) {
      container.querySelectorAll('.action-btn[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tr = btn.closest('tr');
          const trIdx = Array.from(tr.parentNode.children).indexOf(tr);
          const dataIdx = currentPage * perPage + trIdx;
          const action = actions.find(a => a.key === btn.dataset.action);
          if (action?.onClick) action.onClick(currentData[dataIdx], dataIdx);
        });
      });
    }

    // Pagination handlers
    container.querySelector('.pg-prev')?.addEventListener('click', () => { currentPage--; render(); });
    container.querySelector('.pg-next')?.addEventListener('click', () => { currentPage++; render(); });
  }

  render();

  return {
    update(newData) { currentData = [...newData]; currentPage = 0; render(); },
    sort(key, asc = true) { sortKey = key; sortAsc = asc; currentData.sort((a,b) => { const cmp = String(a[key]||'').localeCompare(String(b[key]||'')); return asc ? cmp : -cmp; }); currentPage = 0; render(); },
    goToPage(page) { currentPage = Math.max(0, Math.min(page, Math.ceil(currentData.length / perPage) - 1)); render(); },
  };
}

/**
 * Show skeleton loader in a table container
 */
export function showSkeleton(container, rows = 5, cols = 4) {
  if (typeof container === 'string') container = document.getElementById(container);
  if (!container) return;
  if (typeof window._showSkeleton === 'function') {
    window._showSkeleton(container, rows, cols);
  } else {
    container.innerHTML = '<div class="empty-state" style="text-align:center;padding:24px;"><div class="spinner-sm"></div> Carregando...</div>';
  }
}

/**
 * Format helpers for table cells
 */
export const fmt = {
  date: (v) => v ? new Date(v + 'T12:00:00').toLocaleDateString('pt-BR') : '—',
  datetime: (v) => v ? new Date(v).toLocaleString('pt-BR') : '—',
  currency: (v) => v != null ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—',
  percent: (v) => v != null ? Number(v).toFixed(1) + '%' : '—',
  pill: (v, color) => `<span class="status-pill" style="background:rgba(${color},.1);color:rgb(${color});">${v}</span>`,
  pillGreen: (v) => fmt.pill(v, '45,122,58'),
  pillRed: (v) => fmt.pill(v, '200,16,46'),
  pillYellow: (v) => fmt.pill(v, '212,131,10'),
  pillBlue: (v) => fmt.pill(v, '26,107,181'),
};
