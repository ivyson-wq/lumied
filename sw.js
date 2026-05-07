// Lumied — Service Worker v9 (SWR em JS/CSS, Network-First HTML, Push)
const CACHE_NAME = 'lumied-v9';
const OFFLINE_ASSETS = [
  '/themes.css',
  '/webauthn-client.js',
  '/lumied-ux.js',
  '/lumi-assistant.js',
  '/sentry-init.js',
];

// Install: cache only essential static assets (not HTML)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(OFFLINE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean ALL old caches immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls: network-first (offline fallback)
  if (url.pathname.includes('/functions/v1/')) {
    e.respondWith(
      fetch(e.request.clone()).catch(() =>
        caches.match(e.request).then(cached =>
          cached || new Response(JSON.stringify({
            error: 'Sem conexão. Dados offline não disponíveis.',
            code: 'OFFLINE', offline: true,
          }), { status: 503, headers: { 'Content-Type': 'application/json' } })
        )
      )
    );
    return;
  }

  // HTML pages: ALWAYS network-first (cache only as offline fallback)
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request).then(cached => cached || caches.match('/familia.html')))
    );
    return;
  }

  // JS e CSS: stale-while-revalidate — entrega cache imediato, atualiza
  // em background. Mudança de CSS estilo "ontem cinza, hoje vermelho"
  // chega no próximo refresh sem precisar Ctrl+Shift+R.
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const networkPromise = fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return res;
        }).catch(() => cached || new Response('Offline', { status: 503 }));
        return cached || networkPromise;
      })
    );
    return;
  }

  // Imagens, fonts e outros estáticos: cache-first (mudam raramente)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => new Response('Offline', { status: 503 }));
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
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});

// Background sync
self.addEventListener('sync', e => {
  if (e.tag === 'sync-offline-queue') {
    e.waitUntil(syncOfflineQueue());
  }
});

async function syncOfflineQueue() {
  console.log('[SW] Background sync triggered');
}
