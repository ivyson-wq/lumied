/**
 * Gerente Portal — Main Entry Point
 */
import { initPortal, loadModulos, applyModuleGating } from '../../shared/portal-init.js';
import { renderTable, fmt } from '../../shared/components/data-table.js';
import { createModal } from '../../shared/components/modal.js';
import { showToast } from '../../shared/components/toast.js';
import { initRealtime, subscribeSolicitacoes, subscribeNotificacoes } from '../../shared/realtime.js';

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

// --- Realtime: live solicitacoes + notifications ---
const anonKey = window.__SUPABASE_ANON
  || document.querySelector('meta[name="sb-anon"]')?.content
  || '';

if (anonKey) {
  initRealtime(anonKey);

  const setupSubs = (escolaId) => {
    if (!escolaId) return;

    subscribeSolicitacoes(escolaId, (sol) => {
      const label = sol.status === 'nova' ? 'Nova solicitacao' : `Solicitacao atualizada (#${sol.id || ''})`;
      showToast(label + (sol.titulo ? `: ${sol.titulo}` : ''), 'info', 5000);
    });

    // Subscribe to personal notifications if user is known
    const user = window.__store.get('user');
    if (user?.id) {
      subscribeNotificacoes(user.id, (notif) => {
        showToast(notif.mensagem || notif.titulo || 'Nova notificacao', 'info', 5000);
      });
    } else {
      const unsub = window.__store.subscribe('user', (u) => {
        if (!u?.id) return;
        unsub();
        subscribeNotificacoes(u.id, (notif) => {
          showToast(notif.mensagem || notif.titulo || 'Nova notificacao', 'info', 5000);
        });
      });
    }
  };

  const escolaId = window.__store.get('escola_id');
  if (escolaId) {
    setupSubs(escolaId);
  } else {
    const unsub = window.__store.subscribe('escola_id', (id) => {
      if (!id) return;
      unsub();
      setupSubs(id);
    });
  }
}

console.log('[Lumied] Gerente module loaded.');
