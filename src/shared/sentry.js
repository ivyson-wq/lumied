/**
 * Sentry context helper — sets portal, escola_id, and user info
 * Must be called after Sentry Loader Script is loaded (via CDN in HTML)
 */

/**
 * Detect current portal from the page URL
 */
function detectPortal() {
  const path = location.pathname;
  if (path.includes('gerente')) return 'gerente';
  if (path.includes('professora')) return 'professora';
  if (path.includes('secretaria')) return 'secretaria';
  if (path.includes('admin')) return 'admin';
  if (path.includes('aluno')) return 'aluno';
  if (path.includes('area-restrita')) return 'hub';
  return 'pais';
}

/**
 * Initialize Sentry context with portal tag
 */
export function initSentry() {
  if (typeof window.Sentry === 'undefined') return;

  const portal = detectPortal();

  Sentry.setTag('portal', portal);
  Sentry.setTag('app', 'lumied');
}

/**
 * Set user context on Sentry (call after login)
 */
export function setSentryUser(user, escolaId) {
  if (typeof window.Sentry === 'undefined') return;

  if (user) {
    Sentry.setUser({
      id: user.id || user.email,
      email: user.email,
      username: user.nome,
    });
  } else {
    Sentry.setUser(null);
  }

  if (escolaId) {
    Sentry.setTag('escola_id', escolaId);
  }
}

/**
 * Capture an exception with extra context
 */
export function captureError(error, context = {}) {
  if (typeof window.Sentry === 'undefined') {
    console.error('[Sentry offline]', error, context);
    return;
  }

  Sentry.captureException(error, {
    extra: context,
  });
}
