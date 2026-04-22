import { initPortal, loadModulos } from '../../shared/portal-init.js';

const { api } = initPortal({ tokenKey: 'sec_token' });

window.__loadModulosHabilitadosSec = () => loadModulos(api, 'diplomas');

console.log('[Lumied] Secretaria module loaded.');
