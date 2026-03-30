/**
 * Data Table Component — reusable sortable/filterable table
 * Usage:
 *   renderTable(container, {
 *     columns: [{ key: 'nome', label: 'Nome', sortable: true }, ...],
 *     data: [...],
 *     onRowClick: (row) => {},
 *     emptyMessage: 'Nenhum dado',
 *   });
 */

export function renderTable(container, { columns, data, onRowClick, emptyMessage = 'Nenhum dado encontrado.', actions }) {
  if (!data || data.length === 0) {
    container.innerHTML = `<div class="empty-state" style="text-align:center;padding:40px;color:var(--muted,#888);">${emptyMessage}</div>`;
    return;
  }

  let sortKey = null;
  let sortAsc = true;
  let currentData = [...data];

  function render() {
    let html = '<div class="table-wrap"><table><thead><tr>';
    for (const col of columns) {
      const sortIcon = sortKey === col.key ? (sortAsc ? ' ↑' : ' ↓') : '';
      const cursor = col.sortable ? 'cursor:pointer;' : '';
      html += `<th style="${cursor}" data-sort="${col.key}">${col.label || col.key}${sortIcon}</th>`;
    }
    if (actions) html += '<th>Ações</th>';
    html += '</tr></thead><tbody>';

    for (const row of currentData) {
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
          render();
        });
      }
    });

    // Row click handlers
    if (onRowClick) {
      container.querySelectorAll('tbody tr').forEach((tr, i) => {
        tr.addEventListener('click', (e) => {
          if (e.target.closest('.action-btn')) return;
          onRowClick(currentData[i], i);
        });
      });
    }

    // Action button handlers
    if (actions) {
      container.querySelectorAll('.action-btn[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tr = btn.closest('tr');
          const idx = Array.from(tr.parentNode.children).indexOf(tr);
          const action = actions.find(a => a.key === btn.dataset.action);
          if (action?.onClick) action.onClick(currentData[idx], idx);
        });
      });
    }
  }

  render();

  return {
    update(newData) { currentData = [...newData]; render(); },
    sort(key, asc = true) { sortKey = key; sortAsc = asc; currentData.sort((a,b) => { const cmp = String(a[key]||'').localeCompare(String(b[key]||'')); return asc ? cmp : -cmp; }); render(); },
  };
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
