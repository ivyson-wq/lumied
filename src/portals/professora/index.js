/**
 * Portal das Professoras — Main Entry Point
 */
import { initPortal, loadModulos } from '../../shared/portal-init.js';

const { api } = initPortal({ tokenKey: 'prof_token' });

window.__loadModulosHabilitadosProf = () => loadModulos(api, 'diplomas');

console.log('[Lumied] Professora module loaded.');
