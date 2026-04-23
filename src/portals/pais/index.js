/**
 * Portal dos Pais — Main Entry Point
 */
import { initPortal, loadModulos } from '../../shared/portal-init.js';
import { initRealtime, subscribePickup } from '../../shared/realtime.js';
import { showToast } from '../../shared/components/toast.js';

const { api } = initPortal({ tokenKey: 'mb_pais_token' });

window.__loadModulosHabilitadosPais = () => loadModulos(api, 'api');

// --- Realtime: pickup notifications ---
const anonKey = window.__SUPABASE_ANON
  || document.querySelector('meta[name="sb-anon"]')?.content
  || '';

if (anonKey) {
  initRealtime(anonKey);

  const escolaId = window.__store.get('escola_id');
  if (escolaId) {
    subscribePickup(escolaId, (notif) => {
      showToast(notif.mensagem || 'Notificacao de retirada recebida', 'info', 5000);
    });
  } else {
    const unsub = window.__store.subscribe('escola_id', (id) => {
      if (!id) return;
      unsub();
      subscribePickup(id, (notif) => {
        showToast(notif.mensagem || 'Notificacao de retirada recebida', 'info', 5000);
      });
    });
  }
}

console.log('[Lumied] Pais module loaded.');
