/**
 * Admin Central (staff Lumied) — Main Entry Point
 *
 * Portal interno do time Lumied: dashboard SaaS, escolas, staff, audit log,
 * tickets, onboarding, migração ERPs, billing, etc.
 *
 * Bootstrap roda em todos os portais; aqui só inicializa com o tokenKey
 * próprio do admin-central (lumied_staff_token).
 */
import { initPortal } from '../../shared/portal-init.js';

// Admin-central usa o token de sessão staff (`lumied_staff_token` no
// localStorage). Default tokenField `_token` funciona em todas as edges
// que admin-central consome (admin, saas-billing, backup-escolas, gtm,
// lumied-ai, migracao — todas aceitam `_token`).
initPortal({ tokenKey: 'lumied_staff_token' });

console.log('[Lumied] Admin Central module loaded.');
