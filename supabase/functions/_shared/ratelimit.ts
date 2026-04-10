// ═══════════════════════════════════════════════════════════════
//  Shared: Rate Limiting
//  - checkRateLimit (legacy, sync, in-memory per-instance)
//  - checkRateLimitDb (new, async, DB-backed via rate_limit_check RPC,
//    accurate across edge function instances and cold starts).
//  Migration 218 creates the backing table + RPC.
// ═══════════════════════════════════════════════════════════════

import { SupabaseClient } from "@supabase/supabase-js";

type RateLimitEntry = { count: number; windowStart: number };

// In-memory store (per edge function instance) — fast path / fallback.
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

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
};

/**
 * Legacy in-memory rate limit. State is per edge function instance,
 * so it resets on every cold start and doesn't share across instances.
 * Prefer checkRateLimitDb for anything security-sensitive.
 */
export function checkRateLimit(
  identifier: string,
  action: string,
  config?: RateLimitConfig
): RateLimitResult {
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
 * DB-backed rate limit (accurate across instances).
 * Calls the `rate_limit_check` plpgsql RPC which does an atomic
 * INSERT ... ON CONFLICT DO UPDATE on the rate_limits table.
 *
 * If the RPC fails (migration 218 not applied yet, network glitch, etc.)
 * we fail OPEN (allow the request) and fall back to the in-memory
 * limiter so the edge function keeps working.
 */
export async function checkRateLimitDb(
  sb: SupabaseClient,
  identifier: string,
  action: string,
  config?: RateLimitConfig
): Promise<RateLimitResult> {
  const cfg = config || DEFAULTS[action] || DEFAULTS.api;
  const key = `${identifier}:${action}`;
  const windowSeconds = Math.max(1, Math.round(cfg.windowMs / 1000));

  try {
    const { data, error } = await sb.rpc("rate_limit_check", {
      p_key: key,
      p_window_seconds: windowSeconds,
      p_max_requests: cfg.maxRequests,
    });

    if (error) {
      // RPC failed (e.g. migration not applied). Fall back to in-memory.
      return checkRateLimit(identifier, action, config);
    }

    // RPC returns a TABLE, Supabase client returns it as array.
    // deno-lint-ignore no-explicit-any
    const row = Array.isArray(data) ? (data[0] as any) : (data as any);
    if (!row) return checkRateLimit(identifier, action, config);

    const allowed = row.allowed === true;
    const currentCount = Number(row.current_count ?? 0);
    const retryAfter = Number(row.retry_after ?? 0);

    if (!allowed) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: retryAfter || windowSeconds,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, cfg.maxRequests - currentCount),
    };
  } catch {
    // Any unexpected error → fall back to in-memory
    return checkRateLimit(identifier, action, config);
  }
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
