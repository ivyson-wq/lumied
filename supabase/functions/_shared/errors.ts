// ═══════════════════════════════════════════════════════════════
//  Shared: Standardized Error Handling
// ═══════════════════════════════════════════════════════════════

import { getCorsHeaders, corsResponse as corsPreflight } from "./cors.ts";

// Default headers (for responses without request context)
const CORS_HEADERS = getCorsHeaders();

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
    { status, headers: CORS_HEADERS }
  );
}

/**
 * Create a standardized success Response
 */
export function successResponse(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(data),
    { status, headers: CORS_HEADERS }
  );
}

/**
 * CORS preflight Response
 */
export function corsResponse(): Response {
  return new Response("ok", { headers: CORS_HEADERS });
}

/**
 * Global error handler — wraps a handler function with try/catch
 */
export function withErrorHandler(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      if (req.method === "OPTIONS") return corsResponse();
      return await handler(req);
    } catch (error) {
      if (error instanceof AppError) {
        return errorResponse(error.code, error.message, error.details);
      }
      console.error("[UNHANDLED]", error);
      return errorResponse("INTERNAL_ERROR", "Erro interno do servidor.");
    }
  };
}
