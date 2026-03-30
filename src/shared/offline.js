/**
 * Lumied Offline Manager — IndexedDB queue + sync
 * Permite chamada, notas, agenda funcionarem sem internet
 */

const DB_NAME = 'lumied-offline';
const DB_VERSION = 1;
const STORE_NAME = 'sync_queue';

let db = null;

/**
 * Initialize IndexedDB
 */
export function initOfflineDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('action', 'action', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Queue an offline action
 */
export async function queueOfflineAction(endpoint, body) {
  await initOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const item = {
      endpoint,
      body,
      action: body.action,
      status: 'pending',
      retries: 0,
      createdAt: new Date().toISOString(),
      createdOffline: true,
    };
    const request = store.add(item);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all pending items
 */
export async function getPendingItems() {
  await initOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('status');
    const request = index.getAll('pending');
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });
}

/**
 * Mark item as synced
 */
export async function markSynced(id) {
  await initOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (item) {
        item.status = 'synced';
        item.syncedAt = new Date().toISOString();
        store.put(item);
      }
      resolve();
    };
  });
}

/**
 * Mark item as failed
 */
export async function markFailed(id) {
  await initOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (item) {
        item.retries = (item.retries || 0) + 1;
        item.status = item.retries >= 3 ? 'failed' : 'pending';
        store.put(item);
      }
      resolve();
    };
  });
}

/**
 * Sync all pending items with server
 */
export async function syncAll(apiClient) {
  const items = await getPendingItems();
  if (items.length === 0) return { synced: 0, failed: 0 };

  let synced = 0, failed = 0;
  for (const item of items) {
    try {
      const res = await apiClient.request(item.endpoint, item.body, { retry: false });
      if (res.error) throw new Error(res.error);
      await markSynced(item.id);
      synced++;
    } catch (e) {
      await markFailed(item.id);
      failed++;
    }
  }
  return { synced, failed, total: items.length };
}

/**
 * Clear old synced items (cleanup)
 */
export async function cleanup(daysOld = 7) {
  await initOfflineDB();
  const cutoff = new Date(Date.now() - daysOld * 86400000).toISOString();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    let deleted = 0;
    request.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.status === 'synced' && cursor.value.createdAt < cutoff) {
          store.delete(cursor.key);
          deleted++;
        }
        cursor.continue();
      } else {
        resolve(deleted);
      }
    };
  });
}

/**
 * Get queue stats for UI
 */
export async function getQueueStats() {
  const items = await getPendingItems();
  return {
    pending: items.length,
    oldestItem: items.length > 0 ? items[0].createdAt : null,
    actions: items.reduce((acc, i) => { acc[i.action] = (acc[i.action] || 0) + 1; return acc; }, {}),
  };
}

/**
 * Offline-aware API wrapper
 * Falls back to IndexedDB queue when offline
 */
export function createOfflineApi(apiClient, offlineActions = []) {
  const OFFLINE_ACTIONS = new Set(offlineActions.length > 0 ? offlineActions : [
    'frequencia_chamada_create', 'frequencia_registros_upsert',
    'notas_lancamentos_upsert',
    'agenda_registros_create', 'agenda_itens_add',
    'diario_registros_create',
    'chat_mensagem_send',
  ]);

  return {
    async request(endpoint, body, options = {}) {
      // If online, use normal API
      if (navigator.onLine) {
        const res = await apiClient.request(endpoint, body, options);
        // After successful online request, try to sync pending items
        if (!res.error) {
          const stats = await getQueueStats();
          if (stats.pending > 0) syncAll(apiClient);
        }
        return res;
      }

      // If offline and action is queueable
      if (OFFLINE_ACTIONS.has(body.action)) {
        const id = await queueOfflineAction(endpoint, body);
        return {
          success: true,
          offline: true,
          queueId: id,
          message: 'Ação salva offline. Será sincronizada quando a conexão voltar.',
        };
      }

      // If offline and action is NOT queueable
      return {
        error: 'Sem conexão. Esta ação requer internet.',
        code: 'OFFLINE',
        offline: true,
      };
    },
  };
}

// Auto-sync when coming online
if (typeof window !== 'undefined') {
  window.addEventListener('online', async () => {
    console.log('[Offline] Conexão restaurada. Sincronizando...');
    // Will sync on next API call
  });

  // Initialize DB on load
  initOfflineDB().catch(() => {});
}
