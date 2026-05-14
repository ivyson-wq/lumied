/**
 * Portal das Professoras — Main Entry Point
 *
 * NOTA: realtime via subscribeAccess foi removido (2026-05-14) — portal
 * professora usa sessao propria (nao Supabase Auth), entao RLS bloqueava
 * 100% do payload do Realtime. Polling 10s em outros pontos do portal ja
 * entrega os alertas de chegada/saida.
 */
import { initPortal, loadModulos } from '../../shared/portal-init.js';
import { initVoice } from '../../shared/voice.js';

const { api } = initPortal({ tokenKey: 'prof_token' });

window.__loadModulosHabilitadosProf = () => loadModulos(api, 'diplomas');

// Voice commands — optional, degrades gracefully on unsupported browsers
initVoice();

console.log('[Lumied] Professora module loaded.');
