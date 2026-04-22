// ═══════════════════════════════════════════════════════════════
//  Lumied Pro — Drag-and-drop polish, Bulk ops, Context menu,
//  Progressive images, Guided wizard, Print CSS
//  Incluir em todos os portais: <script src="/lumied-pro.js" defer>
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════
  // 1. DRAG-AND-DROP POLISH — visual feedback for Kanban
  // ═══════════════════════════════════════════════════
  function enhanceDragDrop() {
    // Visual feedback during drag on kanban cards
    document.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.kanban-card');
      if (!card) return;
      card.style.opacity = '0.5';
      card.style.transform = 'rotate(2deg)';
      e.dataTransfer.effectAllowed = 'move';
    });
    document.addEventListener('dragend', (e) => {
      const card = e.target.closest('.kanban-card');
      if (!card) return;
      card.style.opacity = '';
      card.style.transform = '';
      // Remove all drop highlights
      document.querySelectorAll('.kanban-col-body.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    document.addEventListener('dragover', (e) => {
      const col = e.target.closest('.kanban-col-body');
      if (!col) return;
      e.preventDefault();
      col.classList.add('drag-over');
    });
    document.addEventListener('dragleave', (e) => {
      const col = e.target.closest('.kanban-col-body');
      if (col) col.classList.remove('drag-over');
    });
    document.addEventListener('drop', (e) => {
      document.querySelectorAll('.kanban-col-body.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    // Touch drag support for mobile kanban
    let dragCard = null;
    let dragClone = null;
    let touchStartX, touchStartY;
    document.addEventListener('touchstart', (e) => {
      const card = e.target.closest('.kanban-card');
      if (!card) return;
      dragCard = card;
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!dragCard) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartX);
      const dy = Math.abs(touch.clientY - touchStartY);
      // Only start drag if moved significantly
      if (dx < 10 && dy < 10) return;
      e.preventDefault();
      if (!dragClone) {
        dragClone = dragCard.cloneNode(true);
        dragClone.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;opacity:.85;transform:rotate(2deg);width:' + dragCard.offsetWidth + 'px;box-shadow:0 8px 24px rgba(0,0,0,.2);';
        document.body.appendChild(dragClone);
        dragCard.style.opacity = '0.3';
      }
      dragClone.style.left = (touch.clientX - dragCard.offsetWidth / 2) + 'px';
      dragClone.style.top = (touch.clientY - 20) + 'px';
    }, { passive: false });
    document.addEventListener('touchend', (e) => {
      if (!dragCard) return;
      if (dragClone) {
        dragClone.remove();
        dragClone = null;
        // Find which column body we're over
        const touch = e.changedTouches[0];
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const colBody = el?.closest('.kanban-col-body');
        if (colBody) {
          const ondrop = colBody.getAttribute('ondrop');
          const match = ondrop?.match(/dropLead\(event,'([^']+)'\)/);
          if (match && typeof window.dropLead === 'function') {
            const fakeEvent = { preventDefault() {}, dataTransfer: { getData() { return dragCard.getAttribute('ondragstart')?.match(/setData\('text','([^']+)'\)/)?.[1] || ''; } } };
            window.dropLead(fakeEvent, match[1]);
          }
        }
      }
      if (dragCard) dragCard.style.opacity = '';
      dragCard = null;
    });
  }

  // ═══════════════════════════════════════════════════
  // 2. BULK OPERATIONS — select multiple + action bar
  // ═══════════════════════════════════════════════════
  function setupBulkOps() {
    // Inject bulk action bar (hidden by default)
    const bar = document.createElement('div');
    bar.id = 'bulkBar';
    bar.style.cssText = 'display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;border-radius:12px;padding:10px 20px;z-index:10000;box-shadow:0 8px 32px rgba(0,0,0,.3);font-family:"DM Sans",system-ui,sans-serif;font-size:13px;display:none;align-items:center;gap:16px;animation:popIn .2s ease;';
    bar.innerHTML = `
      <span id="bulkCount" style="font-weight:700;">0 selecionados</span>
      <button class="bulk-btn" data-action="message" style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;">💬 Mensagem</button>
      <button class="bulk-btn" data-action="export" style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;">📄 Exportar</button>
      <button class="bulk-btn" data-action="delete" style="background:rgba(200,16,46,.5);border:none;color:#fff;padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;">🗑️ Excluir</button>
      <button id="bulkCancel" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:16px;cursor:pointer;padding:4px;">✕</button>
    `;
    document.body.appendChild(bar);

    // Track selected rows
    window._bulkSelected = new Set();

    // Listen for checkbox changes in tables
    document.addEventListener('change', (e) => {
      if (!e.target.matches('.bulk-check')) return;
      const rowId = e.target.dataset.id;
      if (e.target.checked) window._bulkSelected.add(rowId);
      else window._bulkSelected.delete(rowId);
      updateBulkBar();
    });

    // Select all checkbox
    document.addEventListener('change', (e) => {
      if (!e.target.matches('.bulk-check-all')) return;
      const table = e.target.closest('table') || e.target.closest('.table-wrap');
      if (!table) return;
      const checks = table.querySelectorAll('.bulk-check');
      checks.forEach(c => {
        c.checked = e.target.checked;
        const rowId = c.dataset.id;
        if (e.target.checked) window._bulkSelected.add(rowId);
        else window._bulkSelected.delete(rowId);
      });
      updateBulkBar();
    });

    // Cancel selection
    document.getElementById('bulkCancel')?.addEventListener('click', () => {
      window._bulkSelected.clear();
      document.querySelectorAll('.bulk-check, .bulk-check-all').forEach(c => c.checked = false);
      updateBulkBar();
    });

    // Bulk action handlers
    bar.querySelectorAll('.bulk-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const ids = Array.from(window._bulkSelected);
        if (ids.length === 0) return;
        // Dispatch custom event for the page to handle
        document.dispatchEvent(new CustomEvent('lumied:bulk', { detail: { action, ids } }));
        if (typeof window.__toast === 'function') {
          window.__toast(`${action}: ${ids.length} itens selecionados`, 'info', 2000);
        }
      });
    });
  }

  function updateBulkBar() {
    const bar = document.getElementById('bulkBar');
    if (!bar) return;
    const count = window._bulkSelected.size;
    bar.style.display = count > 0 ? 'flex' : 'none';
    const countEl = document.getElementById('bulkCount');
    if (countEl) countEl.textContent = count + ' selecionado' + (count > 1 ? 's' : '');
  }

  // Global helper to add bulk checkboxes to any table
  window._enableBulk = function (tableContainer, idField = 'id') {
    const table = tableContainer.querySelector('table');
    if (!table) return;
    // Add "select all" header
    const thead = table.querySelector('thead tr');
    if (thead && !thead.querySelector('.bulk-check-all')) {
      const th = document.createElement('th');
      th.style.width = '32px';
      th.innerHTML = '<input type="checkbox" class="bulk-check-all" style="cursor:pointer;">';
      thead.insertBefore(th, thead.firstChild);
    }
    // Add checkboxes to each row
    table.querySelectorAll('tbody tr').forEach((tr, i) => {
      if (tr.querySelector('.bulk-check')) return;
      const td = document.createElement('td');
      const rowData = tr.dataset?.id || i;
      td.innerHTML = `<input type="checkbox" class="bulk-check" data-id="${rowData}" style="cursor:pointer;">`;
      tr.insertBefore(td, tr.firstChild);
    });
  };

  // ═══════════════════════════════════════════════════
  // 3. CONTEXT MENU — right-click quick actions
  // ═══════════════════════════════════════════════════
  function setupContextMenu() {
    let menu = null;

    function createMenu() {
      if (menu) return menu;
      menu = document.createElement('div');
      menu.id = 'ctxMenu';
      menu.style.cssText = 'display:none;position:fixed;z-index:99999;background:var(--white,#fff);border:1px solid var(--border,#e2dbd1);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.18);padding:4px;min-width:180px;font-family:"DM Sans",system-ui,sans-serif;font-size:13px;animation:popIn .15s ease;';
      document.body.appendChild(menu);
      return menu;
    }

    document.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('tr[style*="cursor:pointer"], .kanban-card, [data-ctx]');
      if (!row) return;

      e.preventDefault();
      const m = createMenu();

      // Build menu items based on context
      const items = [];
      if (row.closest('.kanban-card')) {
        items.push({ icon: '👁️', label: 'Ver detalhes', action: 'detail' });
        items.push({ icon: '💬', label: 'WhatsApp', action: 'whatsapp' });
        items.push({ icon: '📋', label: 'Copiar telefone', action: 'copy' });
        items.push({ sep: true });
        items.push({ icon: '🗑️', label: 'Excluir lead', action: 'delete', danger: true });
      } else {
        items.push({ icon: '👁️', label: 'Ver detalhes', action: 'detail' });
        items.push({ icon: '✏️', label: 'Editar', action: 'edit' });
        items.push({ icon: '📋', label: 'Copiar dados', action: 'copy' });
        items.push({ sep: true });
        items.push({ icon: '💬', label: 'Enviar mensagem', action: 'message' });
        items.push({ icon: '📄', label: 'Exportar PDF', action: 'pdf' });
      }

      m.innerHTML = items.map(i => {
        if (i.sep) return '<div style="height:1px;background:var(--border,#e2dbd1);margin:4px 0;"></div>';
        const color = i.danger ? 'color:#C8102E;' : '';
        return `<div class="ctx-item" data-action="${i.action}" style="${color}display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:6px;cursor:pointer;transition:background .1s;"
          onmouseenter="this.style.background='var(--red-light,rgba(200,16,46,.08))'"
          onmouseleave="this.style.background=''">${i.icon} ${i.label}</div>`;
      }).join('');

      // Position
      m.style.display = 'block';
      const x = Math.min(e.clientX, window.innerWidth - 200);
      const y = Math.min(e.clientY, window.innerHeight - m.offsetHeight - 10);
      m.style.left = x + 'px';
      m.style.top = y + 'px';

      // Handle clicks
      m.querySelectorAll('.ctx-item').forEach(item => {
        item.addEventListener('click', () => {
          m.style.display = 'none';
          const action = item.dataset.action;
          document.dispatchEvent(new CustomEvent('lumied:ctx', { detail: { action, target: row } }));

          // Default handlers
          if (action === 'copy') {
            const text = row.textContent.trim().replace(/\s+/g, ' ');
            navigator.clipboard?.writeText(text).then(() => {
              if (typeof window.__toast === 'function') window.__toast('Copiado!', 'success', 1500);
            });
          }
          if (action === 'detail') {
            // Click the row or the first detail button
            const detailBtn = row.querySelector('[onclick*="detalhe"], [onclick*="Detail"], .action-btn');
            if (detailBtn) detailBtn.click();
            else row.click();
          }
        });
      });
    });

    // Close on click outside
    document.addEventListener('click', () => { if (menu) menu.style.display = 'none'; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu) menu.style.display = 'none'; });
  }

  // ═══════════════════════════════════════════════════
  // 4. PROGRESSIVE IMAGES — blur→sharp loading
  // ═══════════════════════════════════════════════════
  function setupProgressiveImages() {
    // Observe images and add blur-to-sharp transition
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        if (img.dataset.progLoaded) return;
        img.dataset.progLoaded = '1';

        // If image is already loaded, just ensure it's visible
        if (img.complete && img.naturalHeight > 0) {
          img.style.filter = '';
          img.style.transition = '';
          return;
        }

        // Apply blur while loading
        img.style.filter = 'blur(8px)';
        img.style.transition = 'filter .4s ease';
        img.addEventListener('load', () => {
          img.style.filter = 'blur(0)';
          setTimeout(() => { img.style.transition = ''; img.style.filter = ''; }, 500);
        }, { once: true });
        img.addEventListener('error', () => {
          img.style.filter = '';
        }, { once: true });
      });
    }, { rootMargin: '100px' });

    function observeImages() {
      document.querySelectorAll('img[src]:not([data-prog-loaded])').forEach(img => {
        // Only for content images (skip icons, logos, tiny images)
        if (img.width < 40 && img.height < 40) return;
        observer.observe(img);
      });
    }
    observeImages();
    new MutationObserver(() => setTimeout(observeImages, 300)).observe(document.body, { childList: true, subtree: true });
  }

  // ═══════════════════════════════════════════════════
  // 5. GUIDED WIZARD — multi-step forms
  // ═══════════════════════════════════════════════════
  window._createWizard = function ({ steps, onComplete, onCancel, title = 'Assistente' }) {
    const overlay = document.createElement('div');
    overlay.className = 'wizard-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:"DM Sans",system-ui,sans-serif;backdrop-filter:blur(4px);';

    let currentStep = 0;
    const data = {};

    function render() {
      const step = steps[currentStep];
      const isFirst = currentStep === 0;
      const isLast = currentStep === steps.length - 1;
      const progress = ((currentStep + 1) / steps.length * 100).toFixed(0);

      overlay.innerHTML = `
        <div style="background:var(--white,#fff);border-radius:16px;width:100%;max-width:560px;box-shadow:0 24px 80px rgba(0,0,0,.35);animation:popIn .2s ease;overflow:hidden;">
          <!-- Progress bar -->
          <div style="height:4px;background:var(--border,#e2dbd1);">
            <div style="height:100%;width:${progress}%;background:var(--red,#C8102E);transition:width .3s ease;border-radius:0 2px 2px 0;"></div>
          </div>
          <!-- Header -->
          <div style="padding:24px 28px 0;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:12px;color:var(--muted,#6b5f54);font-weight:600;">Passo ${currentStep + 1} de ${steps.length}</span>
              <button class="wiz-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--muted,#6b5f54);padding:0;">&times;</button>
            </div>
            <h3 style="font-family:'Lora',serif;font-size:18px;margin-bottom:6px;">${step.title}</h3>
            ${step.description ? `<p style="font-size:13px;color:var(--muted,#6b5f54);line-height:1.5;margin-bottom:0;">${step.description}</p>` : ''}
          </div>
          <!-- Step dots -->
          <div style="display:flex;gap:6px;justify-content:center;padding:16px 0 8px;">
            ${steps.map((_, i) => `<div style="width:${i === currentStep ? '24px' : '8px'};height:8px;border-radius:4px;background:${i <= currentStep ? 'var(--red,#C8102E)' : 'var(--border,#e2dbd1)'};transition:all .3s;"></div>`).join('')}
          </div>
          <!-- Content -->
          <div id="wizContent" style="padding:8px 28px 20px;"></div>
          <!-- Footer -->
          <div style="padding:16px 28px;border-top:1px solid var(--border,#e2dbd1);display:flex;justify-content:space-between;">
            <button class="wiz-back" style="padding:10px 20px;background:var(--white,#fff);border:1.5px solid var(--border,#ddd);border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;${isFirst ? 'visibility:hidden;' : ''}">← Anterior</button>
            <button class="wiz-next" style="padding:10px 24px;background:var(--red,#C8102E);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">${isLast ? '✓ Concluir' : 'Próximo →'}</button>
          </div>
        </div>
      `;

      // Render step content
      const content = overlay.querySelector('#wizContent');
      if (typeof step.render === 'function') {
        const el = step.render(data);
        if (typeof el === 'string') content.innerHTML = el;
        else if (el instanceof HTMLElement) content.appendChild(el);
      }

      // Event handlers
      overlay.querySelector('.wiz-close').onclick = () => { overlay.remove(); if (onCancel) onCancel(); };
      overlay.querySelector('.wiz-back').onclick = () => { if (step.onLeave) step.onLeave(data); currentStep--; render(); };
      overlay.querySelector('.wiz-next').onclick = () => {
        // Validate current step
        if (typeof step.validate === 'function') {
          const error = step.validate(data, content);
          if (error) {
            if (typeof window.__toast === 'function') window.__toast(error, 'error', 3000);
            if (typeof window._shake === 'function') window._shake(content);
            return;
          }
        }
        // Collect data from current step
        if (typeof step.collect === 'function') step.collect(data, content);

        if (isLast) {
          overlay.remove();
          if (onComplete) onComplete(data);
        } else {
          currentStep++;
          render();
        }
      };
    }

    render();
    document.body.appendChild(overlay);
    return { close: () => overlay.remove(), getData: () => data };
  };

  // ═══════════════════════════════════════════════════
  // 6. PRINT CSS — beautiful print layouts
  // ═══════════════════════════════════════════════════
  function injectPrintCSS() {
    const style = document.createElement('style');
    style.id = 'print-css';
    style.textContent = `
      @media print {
        /* Hide navigation and chrome */
        .sidebar, .topbar, .hamburger, .ger-bottom-bar,
        .sb-footer, .sb-brand, .sb-nav,
        .sidebar-overlay, #sidebarOverlay,
        .ger-bb-item, .fab, .fab-menu,
        #bulkBar, #ctxMenu, .cmd-overlay,
        #toastContainer, #lumiedToasts,
        .a11y-skip, .dark-toggle, .live-badge,
        #bioRegBanner, #notifPanel,
        .topbar-nav-pills, .hamburger,
        button:not(.print-keep),
        .action-btn, .kc-actions,
        [onclick], .search-input, .fb,
        .modal-overlay, .wizard-overlay { display: none !important; }

        /* Full width content */
        .main { margin-left: 0 !important; width: 100% !important; }
        .content { padding: 0 !important; max-width: 100% !important; }
        .panel { page-break-inside: avoid; }
        .panel.active { display: block !important; }

        /* Reset backgrounds for print */
        body { background: #fff !important; color: #000 !important; font-size: 11pt; }
        .stat-card, .stats-card { border: 1px solid #ccc !important; background: #fff !important; box-shadow: none !important; }
        .stats-grid { grid-template-columns: repeat(4, 1fr) !important; }

        /* Table print styles */
        table { width: 100% !important; border-collapse: collapse !important; font-size: 10pt; }
        th, td { border: 1px solid #ccc !important; padding: 6px 8px !important; text-align: left; }
        th { background: #f5f5f5 !important; font-weight: bold; }
        tbody tr:nth-child(even) { background: #fafafa !important; }

        /* Charts — show at full width */
        canvas { max-width: 100% !important; }

        /* Page header */
        .panel.active::before {
          content: 'Lumied — Relatório impresso em ' attr(data-print-date);
          display: block;
          font-size: 9pt;
          color: #999;
          margin-bottom: 12px;
          border-bottom: 1px solid #eee;
          padding-bottom: 8px;
        }

        /* Page breaks */
        h2, h3, .sec-title { page-break-after: avoid; }
        tr { page-break-inside: avoid; }

        /* Footer on each page */
        @page {
          margin: 1.5cm;
          @bottom-center { content: 'Lumied — lumied.com.br'; font-size: 8pt; color: #999; }
        }

        /* Pagination hidden */
        .lm-pagination { display: none !important; }
      }

      /* Print button helper */
      .btn-print {
        padding: 8px 16px;
        background: var(--white, #fff);
        border: 1.5px solid var(--border, #ddd);
        border-radius: 8px;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
        transition: all .2s;
      }
      .btn-print:hover { border-color: var(--red); color: var(--red); }
    `;
    document.head.appendChild(style);

    // Inject CSS for drag-drop and context menu
    const proStyle = document.createElement('style');
    proStyle.id = 'pro-css';
    proStyle.textContent = `
      .kanban-col-body.drag-over {
        background: rgba(200,16,46,.06) !important;
        outline: 2px dashed var(--red, #C8102E);
        outline-offset: -2px;
        border-radius: 8px;
      }
      .kanban-card[draggable="true"] { cursor: grab; }
      .kanban-card[draggable="true"]:active { cursor: grabbing; }
    `;
    document.head.appendChild(proStyle);
  }

  // Global print helper
  window._printPanel = function () {
    // Set print date on active panel
    const panel = document.querySelector('.panel.active');
    if (panel) panel.dataset.printDate = new Date().toLocaleDateString('pt-BR');
    window.print();
  };

  // ═══════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════
  function init() {
    injectPrintCSS();
    enhanceDragDrop();
    setupBulkOps();
    setupContextMenu();
    setupProgressiveImages();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
