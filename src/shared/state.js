/**
 * Lumied State Manager — lightweight reactive store
 * Usage:
 *   const store = new Store({ user: null, theme: 'corporativo' });
 *   store.subscribe('user', (user) => renderHeader(user));
 *   store.set('user', { nome: 'Ana', email: 'ana@escola.com' });
 */

export class Store {
  constructor(initialState = {}) {
    this._state = { ...initialState };
    this._listeners = new Map(); // key -> Set<callback>
    this._globalListeners = new Set();
  }

  /**
   * Get a value from the store
   */
  get(key) {
    return this._state[key];
  }

  /**
   * Get entire state (read-only copy)
   */
  getAll() {
    return { ...this._state };
  }

  /**
   * Set a value and notify subscribers
   */
  set(key, value) {
    const oldValue = this._state[key];
    if (oldValue === value) return; // No change
    this._state[key] = value;

    // Notify key-specific listeners
    const listeners = this._listeners.get(key);
    if (listeners) {
      for (const cb of listeners) {
        try { cb(value, oldValue, key); } catch (e) { console.error('[Store] Listener error:', e); }
      }
    }

    // Notify global listeners
    for (const cb of this._globalListeners) {
      try { cb(key, value, oldValue); } catch (e) { console.error('[Store] Global listener error:', e); }
    }
  }

  /**
   * Update multiple values at once
   */
  setMultiple(updates) {
    for (const [key, value] of Object.entries(updates)) {
      this.set(key, value);
    }
  }

  /**
   * Subscribe to changes on a specific key
   * Returns unsubscribe function
   */
  subscribe(key, callback) {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    this._listeners.get(key).add(callback);

    // Return unsubscribe function
    return () => {
      this._listeners.get(key)?.delete(callback);
    };
  }

  /**
   * Subscribe to ALL changes
   */
  subscribeAll(callback) {
    this._globalListeners.add(callback);
    return () => this._globalListeners.delete(callback);
  }

  /**
   * Persist state to localStorage
   */
  persist(key, storageKey) {
    const stored = localStorage.getItem(storageKey || `lumied_${key}`);
    if (stored) {
      try { this._state[key] = JSON.parse(stored); } catch {}
    }
    this.subscribe(key, (value) => {
      if (value === null || value === undefined) {
        localStorage.removeItem(storageKey || `lumied_${key}`);
      } else {
        localStorage.setItem(storageKey || `lumied_${key}`, JSON.stringify(value));
      }
    });
  }

  /**
   * Reset state to initial values
   */
  reset(initialState) {
    for (const key of Object.keys(this._state)) {
      this.set(key, initialState[key] ?? null);
    }
  }
}

/**
 * Global app store singleton
 */
export const appStore = new Store({
  user: null,
  escola_id: null,
  tema: 'corporativo',
  modulos: [],
  notifications: [],
  online: navigator.onLine,
});

// Auto-track online/offline
window.addEventListener('online', () => appStore.set('online', true));
window.addEventListener('offline', () => appStore.set('online', false));

// Persist theme
appStore.persist('tema', 'mb_tema');
