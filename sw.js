// Lumied — Service Worker v3 (Offline-First + Push Notifications)
const CACHE_NAME = 'lumied-v3';
const OFFLINE_ASSETS = [
  '/',
  '/index.html',
  '/gerente.html',
  '/professora.html',
  '/secretaria.html',
  '/aluno.html',
  '/admin.html',
  '/area-restrita.html',
  '/themes.css',
  '/webauthn-client.js',
  '/dist/gerente/index.js',
  '/dist/pais/index.js',
  '/dist/professora/index.js',
];

// API responses to cache (read-only actions)
const CACHEABLE_ACTIONS = ['series_list', 'atividades_list', 'modulos_habilitados', 'notas_periodos_list'];

// Install: cache essential assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(OFFLINE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for API, cache-first for assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls: network-first with cache fallback
  if (url.pathname.includes('/functions/v1/')) {
    e.respondWith(
      fetch(e.request.clone())
        .then(res => {
          // Cache successful GET-like API responses
          if (res.ok && e.request.method === 'POST') {
            const cloned = res.clone();
            cloned.json().then(body => {
              // Only cache read-only action responses
              // Check if body was from a cacheable action
            }).catch(() => {});
          }
          return res;
        })
        .catch(() => {
          // Offline: return cached response if available
          return caches.match(e.request).then(cached => {
            if (cached) return cached;
            return new Response(JSON.stringify({
              error: 'Sem conexão. Dados offline não disponíveis.',
              code: 'OFFLINE',
              offline: true,
            }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            });
          });
        })
    );
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Cache new static assets
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline fallback for navigation
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Push Notifications
self.addEventListener('push', e => {
  if (!e.data) return;
  try {
    const data = e.data.json();
    const options = {
      body: data.body || '',
      icon: '/icon-apple.png',
      badge: '/icon-apple.png',
      tag: data.tag || 'lumied',
      data: data.url ? { url: data.url } : {},
      actions: data.actions || [],
      vibrate: [200, 100, 200],
      requireInteraction: data.urgent || false,
    };
    e.waitUntil(self.registration.showNotification(data.title || 'Lumied', options));
  } catch (err) {
    const text = e.data.text();
    e.waitUntil(self.registration.showNotification('Lumied', { body: text }));
  }
});

// Notification click
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing window or open new
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});

// Background sync (for offline-queued actions)
self.addEventListener('sync', e => {
  if (e.tag === 'sync-offline-queue') {
    e.waitUntil(syncOfflineQueue());
  }
});

async function syncOfflineQueue() {
  // Read queue from IndexedDB and replay
  // This is a placeholder — actual implementation needs IndexedDB integration
  console.log('[SW] Background sync triggered');
}
