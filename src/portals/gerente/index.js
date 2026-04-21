/**
 * Gerente Portal — Main Entry Point
 */
import { initPortal, loadModulos, applyModuleGating } from '../../shared/portal-init.js';
import { renderTable, fmt } from '../../shared/components/data-table.js';
import { createModal } from '../../shared/components/modal.js';
import { showToast } from '../../shared/components/toast.js';

const { api } = initPortal({
  tokenKey: 'mb_token',
  onAuthError: () => {
    showToast('Sessão expirada. Faça login novamente.', 'error');
    window.__store.set('user', null);
    localStorage.removeItem('mb_token');
    setTimeout(() => location.reload(), 1500);
  },
});

// Portal-specific bindings
window.__table = renderTable;
window.__fmt = fmt;
window.__modal = createModal;
window.__loadModulosHabilitados = () => loadModulos(api, 'api');
window.__applyModuleGating = applyModuleGating;

console.log('[Lumied] Gerente module loaded.');
