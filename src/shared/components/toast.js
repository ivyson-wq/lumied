/**
 * Toast Notification Component
 * Usage:
 *   showToast('Mensagem!', 'success', 4000);
 *   showToast('Item excluído.', 'warning', 5000, { undo: () => restoreItem() });
 */

let container = null;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:380px;';
    document.body.appendChild(container);
  }
  return container;
}

const ICONS = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const COLORS = {
  success: { bg: '#f0fdf4', border: '#86efac', text: '#166534', icon: '#22c55e' },
  error: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', icon: '#ef4444' },
  warning: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', icon: '#f59e0b' },
  info: { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af', icon: '#3b82f6' },
};

/**
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration - ms (0 = persistent)
 * @param {Object} [opts] - { undo: Function } for undo button
 */
export function showToast(message, type = 'info', duration = 4000, opts = {}) {
  const c = getContainer();
  const colors = COLORS[type] || COLORS.info;

  const toast = document.createElement('div');
  toast.style.cssText = `
    display:flex;align-items:center;gap:10px;padding:12px 16px;
    background:${colors.bg};border:1px solid ${colors.border};border-radius:10px;
    box-shadow:0 4px 16px rgba(0,0,0,.1);
    font-family:'DM Sans',system-ui,sans-serif;font-size:13px;color:${colors.text};
    animation:toastIn .3s ease;max-width:380px;
  `;

  const icon = document.createElement('span');
  icon.style.cssText = `font-size:16px;font-weight:700;color:${colors.icon};flex-shrink:0;width:20px;text-align:center;`;
  icon.textContent = ICONS[type] || ICONS.info;

  const text = document.createElement('span');
  text.style.cssText = 'flex:1;line-height:1.4;';
  text.textContent = message;

  toast.appendChild(icon);
  toast.appendChild(text);

  // Undo button
  if (opts.undo && typeof opts.undo === 'function') {
    const undoBtn = document.createElement('button');
    undoBtn.style.cssText = `background:${colors.icon};color:#fff;border:none;padding:4px 12px;border-radius:6px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;flex-shrink:0;transition:opacity .2s;`;
    undoBtn.textContent = 'Desfazer';
    undoBtn.onclick = () => { opts.undo(); remove(); };
    toast.appendChild(undoBtn);

    // Progress bar
    const bar = document.createElement('div');
    bar.style.cssText = `position:absolute;bottom:0;left:0;right:0;height:3px;background:${colors.icon};opacity:.3;border-radius:0 0 10px 10px;transform-origin:left;animation:shrink ${duration}ms linear;`;
    toast.style.position = 'relative';
    toast.style.overflow = 'hidden';
    toast.appendChild(bar);
  }

  const close = document.createElement('button');
  close.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;color:inherit;opacity:.5;padding:0 2px;flex-shrink:0;';
  close.textContent = '✕';
  close.onclick = () => remove();
  toast.appendChild(close);

  c.appendChild(toast);

  function remove() {
    toast.style.animation = 'toastOut .2s ease';
    toast.addEventListener('animationend', () => toast.remove());
  }

  if (duration > 0) setTimeout(remove, duration);

  // Add animation styles if not present
  if (!document.getElementById('toast-styles')) {
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
      @keyframes toastIn { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }
      @keyframes toastOut { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(40px); } }
      @keyframes shrink { from { transform:scaleX(1); } to { transform:scaleX(0); } }
    `;
    document.head.appendChild(style);
  }

  return { remove };
}
