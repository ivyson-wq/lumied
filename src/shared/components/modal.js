/**
 * Modal Component
 * Usage:
 *   const m = createModal({ title: 'Confirmar', body: '<p>Tem certeza?</p>', onConfirm: () => {} });
 *   m.open();
 */

export function createModal({ title, body, onConfirm, onCancel, confirmText = 'Confirmar', cancelText = 'Cancelar', size = 'medium', danger = false }) {
  const sizes = { small: '400px', medium: '600px', large: '800px', full: '95vw' };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center;backdrop-filter:blur(3px);';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = `background:var(--white,#fff);border-radius:16px;padding:28px;width:100%;max-width:${sizes[size] || sizes.medium};box-shadow:0 24px 60px rgba(0,0,0,.25);animation:popIn .25s ease;max-height:90vh;overflow-y:auto;`;

  const confirmBg = danger ? '#dc2626' : 'var(--red,#C8102E)';
  let html = '';
  if (title) html += `<h3 style="font-family:'Lora',serif;font-size:17px;margin-bottom:16px;">${title}</h3>`;
  if (typeof body === 'string') html += body;
  html += '<div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end;">';
  if (onCancel !== false) html += `<button class="modal-cancel" style="padding:10px 20px;background:var(--white,#fff);color:var(--text,#333);border:1.5px solid var(--border,#ddd);border-radius:8px;font-family:inherit;font-size:13px;cursor:pointer;">${cancelText}</button>`;
  if (onConfirm) html += `<button class="modal-confirm" style="padding:10px 20px;background:${confirmBg};color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;">${confirmText}</button>`;
  html += '</div>';

  modal.innerHTML = html;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // If body is an element, insert it
  if (body instanceof HTMLElement) {
    const titleEl = modal.querySelector('h3');
    if (titleEl) titleEl.after(body);
    else modal.prepend(body);
  }

  const api = {
    open() {
      overlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      // Focus first input or confirm button
      setTimeout(() => {
        const firstInput = modal.querySelector('input, select, textarea');
        if (firstInput) firstInput.focus();
        else modal.querySelector('.modal-confirm')?.focus();
      }, 50);
    },
    close() {
      overlay.style.display = 'none';
      document.body.style.overflow = '';
    },
    destroy() {
      overlay.remove();
      document.body.style.overflow = '';
    },
    setBody(newBody) {
      const container = modal.querySelector('h3');
      const buttons = modal.querySelector('div:last-child');
      if (typeof newBody === 'string') {
        const temp = document.createElement('div');
        temp.innerHTML = newBody;
        while (container.nextSibling !== buttons) container.nextSibling.remove();
        container.after(temp);
      }
    },
    setLoading(loading) {
      const btn = modal.querySelector('.modal-confirm');
      if (!btn) return;
      if (loading) {
        btn._origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.style.opacity = '.7';
        btn.innerHTML = '<span class="spinner-sm" style="width:12px;height:12px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;display:inline-block;animation:spin .7s linear infinite;vertical-align:middle;"></span> Salvando...';
      } else {
        btn.disabled = false;
        btn.style.opacity = '';
        if (btn._origHtml) btn.innerHTML = btn._origHtml;
      }
    },
    overlay,
    modal,
  };

  // Event listeners
  overlay.addEventListener('click', (e) => { if (e.target === overlay) api.close(); });
  modal.querySelector('.modal-cancel')?.addEventListener('click', () => { if (onCancel) onCancel(); api.close(); });
  modal.querySelector('.modal-confirm')?.addEventListener('click', () => { if (onConfirm) onConfirm(api); });

  // Keyboard: Escape to close, Enter to confirm (if not in textarea)
  function handleKey(e) {
    if (overlay.style.display !== 'flex') return;
    if (e.key === 'Escape') { api.close(); return; }
  }
  document.addEventListener('keydown', handleKey);

  return api;
}
