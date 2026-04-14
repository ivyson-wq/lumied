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
  | 'AUTH_BAD_CREDENTIALS'   // email/senha incorretos (distinto de AUTH_INVALID genérico)
  | 'AUTH_USER_DISABLED'     // usuário existe mas ativo=false
  | 'AUTH_ROLE_MISMATCH'     // papel esperado no login não está nos papeis do usuário
  | 'AUTH_EXPIRED'
  | 'AUTH_SESSION_FAILED'    // INSERT em *_sessoes falhou — bug estrutural, NÃO credencial
  | 'AUTH_OUT_OF_HOURS'      // fora do horário de acesso permitido
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'FEATURE_DISABLED'
  | 'ESCOLA_REQUIRED'
  | 'INTERNAL_ERROR'
  | 'BAD_REQUEST'
  | 'PAYLOAD_TOO_LARGE';

const STATUS_MAP: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  BAD_REQUEST: 400,
  AUTH_REQUIRED: 401,
  AUTH_INVALID: 401,
  AUTH_BAD_CREDENTIALS: 401,
  AUTH_USER_DISABLED: 403,
  AUTH_ROLE_MISMATCH: 401,
  AUTH_EXPIRED: 401,
  AUTH_SESSION_FAILED: 500,
  AUTH_OUT_OF_HOURS: 403,
  FORBIDDEN: 403,
  FEATURE_DISABLED: 403,
  ESCOLA_REQUIRED: 400,
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
 * Sanitize PostgREST / PostgreSQL errors into user-friendly Portuguese
 * messages. Prevents leaking column names, constraint names, and other
 * internals. The original error should still be logged server-side for
 * debugging.
 */
export function sanitizePgError(
  error: { message?: string; code?: string; details?: string } | null | undefined,
): string {
  if (!error) return 'Erro desconhecido.';
  const msg = error.message || '';
  if (msg.includes('duplicate key') || error.code === '23505') return 'Registro duplicado.';
  if (msg.includes('violates foreign key') || error.code === '23503') return 'Referência inválida.';
  if (msg.includes('violates not-null') || error.code === '23502') return 'Campo obrigatório faltando.';
  if (msg.includes('violates check') || error.code === '23514') return 'Valor inválido.';
  if (error.code === '42501') return 'Sem permissão.';
  if (error.code === '42P01') return 'Recurso não encontrado.';
  // Default: generic message (real error logged server-side)
  return 'Erro ao processar a solicitação.';
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
