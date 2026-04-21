/**
 * Portal dos Pais — Main Entry Point
 */
import { initPortal, loadModulos } from '../../shared/portal-init.js';

const { api } = initPortal({ tokenKey: 'mb_pais_token' });

window.__loadModulosHabilitadosPais = () => loadModulos(api, 'api');

console.log('[Lumied] Pais module loaded.');
