// ═══════════════════════════════════════════════════════════════
//  Shared: Standardized Error Handling
// ═══════════════════════════════════════════════════════════════

import { AsyncLocalStorage } from "node:async_hooks";
import { getCorsHeaders } from "./cors.ts";
import { captureException } from "./sentry.ts";

// Per-request CORS headers via AsyncLocalStorage — each request runs in its
// own async context, so concurrent requests in the same isolate don't race.
const corsStorage = new AsyncLocalStorage<Record<string, string>>();
const DEFAULT_CORS = getCorsHeaders();

function currentCorsHeaders(): Record<string, string> {
  return corsStorage.getStore() ?? DEFAULT_CORS;
}

/**
 * Run `fn` within a CORS context derived from the request. All calls to
 * errorResponse/successResponse/corsResponse inside this context (and any
 * awaited children) will use the correct per-request headers.
 */
export function runWithCors<T>(req: Request, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(corsStorage.run(getCorsHeaders(req), fn));
}

/**
 * @deprecated Legacy no-op kept for backwards compatibility. The CORS headers
 * are now managed per-request via runWithCors(). Call sites inside a request
 * handler wrapped by withErrorHandler() or router.handle() don't need to do
 * anything — the context is already set up.
 */
export function setRequestForCors(_req: Request): void {
  // no-op: headers are now managed by AsyncLocalStorage
}

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'FEATURE_DISABLED'
  | 'INTERNAL_ERROR'
  | 'BAD_REQUEST'
  | 'PAYLOAD_TOO_LARGE';

const STATUS_MAP: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  BAD_REQUEST: 400,
  AUTH_REQUIRED: 401,
  AUTH_INVALID: 401,
  AUTH_EXPIRED: 401,
  FORBIDDEN: 403,
  FEATURE_DISABLED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  code: ErrorCode;
  statusCode: number;
  details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.statusCode = STATUS_MAP[code] || 500;
    this.details = details;
  }
}

/**
 * Create a standardized error Response
 */
export function errorResponse(code: ErrorCode, message: string, details?: unknown): Response {
  const status = STATUS_MAP[code] || 500;
  return new Response(
    JSON.stringify({
      error: message,
      code,
      ...(details ? { details } : {}),
      timestamp: new Date().toISOString(),
    }),
    { status, headers: currentCorsHeaders() }
  );
}

/**
 * Create a standardized success Response
 */
export function successResponse(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(data),
    { status, headers: currentCorsHeaders() }
  );
}

/**
 * CORS preflight Response
 */
export function corsResponse(): Response {
  return new Response("ok", { headers: currentCorsHeaders() });
}

/**
 * Global error handler — wraps a handler function with try/catch
 */
export function withErrorHandler(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return (req: Request) => runWithCors(req, async () => {
    try {
      if (req.method === "OPTIONS") return corsResponse();
      return await handler(req);
    } catch (error) {
      if (error instanceof AppError) {
        return errorResponse(error.code, error.message, error.details);
      }
      console.error("[UNHANDLED]", error);
      // Report unhandled errors to Sentry (fire-and-forget)
      captureException(
        error instanceof Error ? error : new Error(String(error)),
        { handler: req.url, method: req.method },
      ).catch(() => {});
      return errorResponse("INTERNAL_ERROR", "Erro interno do servidor.");
    }
  });
}
