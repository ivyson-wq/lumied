/**
 * Portal das Professoras — Main Entry Point
 */
import { initPortal, loadModulos } from '../../shared/portal-init.js';
import { initRealtime, subscribeAccess } from '../../shared/realtime.js';
import { showToast } from '../../shared/components/toast.js';

const { api } = initPortal({ tokenKey: 'prof_token' });

window.__loadModulosHabilitadosProf = () => loadModulos(api, 'diplomas');

// --- Realtime: replace 10s polling with WebSocket ---
const anonKey = window.__SUPABASE_ANON
  || document.querySelector('meta[name="sb-anon"]')?.content
  || '';

if (anonKey) {
  initRealtime(anonKey);

  // Subscribe to access events once escola_id is available
  const escolaId = window.__store.get('escola_id');
  if (escolaId) {
    subscribeAccess(escolaId, (evt) => {
      const tipo = evt.tipo === 'entrada' ? 'chegou' : 'saiu';
      showToast(`${evt.aluno_nome} ${tipo} (${evt.hora || ''})`, 'info', 5000);
    });
  } else {
    // Wait for escola_id to be set
    const unsub = window.__store.subscribe('escola_id', (id) => {
      if (!id) return;
      unsub();
      subscribeAccess(id, (evt) => {
        const tipo = evt.tipo === 'entrada' ? 'chegou' : 'saiu';
        showToast(`${evt.aluno_nome} ${tipo} (${evt.hora || ''})`, 'info', 5000);
      });
    });
  }
}

console.log('[Lumied] Professora module loaded.');
