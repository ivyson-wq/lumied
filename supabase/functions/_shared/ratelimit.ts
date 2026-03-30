// ═══════════════════════════════════════════════════════════════
//  Shared: Rate Limiting (in-memory with cleanup)
// ═══════════════════════════════════════════════════════════════

type RateLimitEntry = { count: number; windowStart: number };

// In-memory store (per edge function instance)
const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.windowStart > 300000) store.delete(key);
  }
}, 300000);

export type RateLimitConfig = {
  windowMs: number;  // Time window in ms
  maxRequests: number;  // Max requests per window
};

const DEFAULTS: Record<string, RateLimitConfig> = {
  login:    { windowMs: 60000, maxRequests: 5 },    // 5 per minute
  api:      { windowMs: 60000, maxRequests: 120 },   // 120 per minute
  upload:   { windowMs: 60000, maxRequests: 10 },    // 10 per minute
  search:   { windowMs: 60000, maxRequests: 30 },    // 30 per minute
};

/**
 * Check rate limit. Returns null if OK, or remaining seconds if limited.
 */
export function checkRateLimit(
  identifier: string,
  action: string,
  config?: RateLimitConfig
): { allowed: boolean; remaining: number; retryAfterSeconds?: number } {
  const cfg = config || DEFAULTS[action] || DEFAULTS.api;
  const key = `${identifier}:${action}`;
  const now = Date.now();

  let entry = store.get(key);
  if (!entry || now - entry.windowStart > cfg.windowMs) {
    entry = { count: 0, windowStart: now };
    store.set(key, entry);
  }

  entry.count++;

  if (entry.count > cfg.maxRequests) {
    const retryAfter = Math.ceil((entry.windowStart + cfg.windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds: retryAfter };
  }

  return { allowed: true, remaining: cfg.maxRequests - entry.count };
}

/**
 * Get client IP from request
 */
export function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || req.headers.get('cf-connecting-ip')
    || 'unknown';
}
