/**
 * Lumied API Client — centralized fetch wrapper
 * Features: auto-auth, retry, caching, error handling, timing
 */

const CACHE = new Map();
const CACHE_TTL = 30000; // 30s default

export class ApiClient {
  constructor(baseUrl, anonKey, options = {}) {
    this.baseUrl = baseUrl;
    this.anonKey = anonKey;
    this.tokenKey = options.tokenKey || 'mb_token';
    this.onAuthError = options.onAuthError || null;
    this.onError = options.onError || null;
    this.maxRetries = options.maxRetries || 2;
    this.cacheTTL = options.cacheTTL || CACHE_TTL;
  }

  getToken() {
    return localStorage.getItem(this.tokenKey);
  }

  setToken(token) {
    if (token) localStorage.setItem(this.tokenKey, token);
    else localStorage.removeItem(this.tokenKey);
  }

  /**
   * Make an API request
   * @param {string} endpoint - Edge function path (e.g., '/functions/v1/api')
   * @param {object} body - Request body (must include `action`)
   * @param {object} options - { cache, cacheTTL, retry, tokenField }
   */
  async request(endpoint, body, options = {}) {
    const url = this.baseUrl + endpoint;
    const token = this.getToken();
    const tokenField = options.tokenField || '_token';
    const startTime = performance.now();

    // Cache check (for read-only actions)
    if (options.cache) {
      const cacheKey = url + ':' + JSON.stringify(body);
      const cached = CACHE.get(cacheKey);
      if (cached && Date.now() - cached.time < (options.cacheTTL || this.cacheTTL)) {
        return cached.data;
      }
    }

    const payload = { ...body };
    if (token) payload[tokenField] = token;

    let lastError = null;
    const maxRetries = options.retry === false ? 0 : this.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': this.anonKey,
            'Authorization': 'Bearer ' + this.anonKey,
          },
          body: JSON.stringify(payload),
        });

        const duration = Math.round(performance.now() - startTime);

        // Rate limited — wait and retry
        if (res.status === 429 && attempt < maxRetries) {
          const retryAfter = parseInt(res.headers.get('Retry-After') || '5');
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          continue;
        }

        // Auth error — callback and stop
        if (res.status === 401) {
          const data = await res.json();
          if (this.onAuthError) this.onAuthError(data);
          return data;
        }

        // Server error — retry
        if (res.status >= 500 && attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }

        const data = await res.json();

        // Cache successful read responses
        if (options.cache && res.ok) {
          const cacheKey = url + ':' + JSON.stringify(body);
          CACHE.set(cacheKey, { data, time: Date.now() });
        }

        // Log slow requests
        if (duration > 3000) {
          console.warn(`[API] Slow request: ${body.action} took ${duration}ms`);
        }

        return data;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    // All retries failed
    const errorData = { error: 'Erro de conexão. Verifique sua internet.', code: 'NETWORK_ERROR' };
    if (this.onError) this.onError(errorData, lastError);
    return errorData;
  }

  /**
   * Invalidate cache for a specific action or all
   */
  clearCache(action) {
    if (action) {
      for (const key of CACHE.keys()) {
        if (key.includes(`"action":"${action}"`)) CACHE.delete(key);
      }
    } else {
      CACHE.clear();
    }
  }

  /**
   * Shorthand for common endpoints
   */
  api(body, options) { return this.request('/functions/v1/api', body, options); }
  diplomas(body, options) { return this.request('/functions/v1/diplomas', body, options); }
  academico(body, options) { return this.request('/functions/v1/academico', body, options); }
  comunicacao(body, options) { return this.request('/functions/v1/comunicacao', body, options); }
  admin(body, options) { return this.request('/functions/v1/admin', body, options); }
  operacional(body, options) { return this.request('/functions/v1/operacional', body, options); }
  loja(body, options) { return this.request('/functions/v1/loja', body, options); }
  rh(body, options) { return this.request('/functions/v1/rh', body, options); }
}

/**
 * Create a pre-configured client for a portal
 */
export function createClient(anonKey, options = {}) {
  const url = 'https://brgorknbrjlfwvrrlwxj.supabase.co';
  return new ApiClient(url, anonKey, options);
}
