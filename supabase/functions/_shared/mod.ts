// ═══════════════════════════════════════════════════════════════
//  Barrel Export — _shared/mod.ts
//  Import único para todas as edge functions:
//    import { Router, authGerente, successResponse, ... } from "../_shared/mod.ts";
// ═══════════════════════════════════════════════════════════════

// ── Router & Middlewares ──
export {
  Router,
  rateLimit,
  rateLimitInMemory,
  auth,
  authGerente,
  authProfessora,
  authGerenteOrSecretaria,
  authProfOrGerente,
  authAluno,
  requireFeature,
  validateInput,
  loadEscola,
  requireEscola,
} from "./router.ts";
export type { Context, Handler, Middleware } from "./router.ts";

// ── Errors & Responses ──
export {
  AppError,
  errorResponse,
  successResponse,
  corsResponse,
  sanitizePgError,
  withErrorHandler,
  runWithCors,
} from "./errors.ts";
export type { ErrorCode } from "./errors.ts";

// ── Auth ──
export {
  hashSenha,
  hashSenhaV1,
  verificarSenhaAuto,
  gerarToken,
  criarSessao,
  validarSessao,
  uploadArquivo,
  // Consolidated session resolvers
  resolveUsuario,
  resolveAnySession,
  resolveProfessora,
  resolveGerente,
  resolveSecretaria,
  resolveAlmoxarifado,
} from "./auth.ts";

// ── Validation ──
export {
  validate,
  sanitize,
  sanitizeBody,
  loginSchema,
  idSchema,
  paginationSchema,
} from "./validation.ts";
export type { Schema, ValidationRule, ValidationError } from "./validation.ts";

// ── CORS ──
export { getCorsHeaders } from "./cors.ts";
export { corsResponse as corsPreflight } from "./cors.ts";

// ── Tenant ──
export { resolveEscolaId } from "./tenant.ts";

// ── Modules & Feature Gating ──
export {
  getModulosHabilitados,
  getModulosResolvidos,
  getEscolaPadrao,
  requireModulo,
} from "./modulos.ts";

// ── Logging ──
export { createLogger } from "./logger.ts";
export type { LogLevel, LogEntry } from "./logger.ts";

// ── Audit ──
export { logAudit } from "./audit.ts";
export type { AuditEvent } from "./audit.ts";

// ── Sentry ──
export { captureException, captureMessage } from "./sentry.ts";

// ── Rate Limiting (direct access) ──
export { checkRateLimit, checkRateLimitDb, getClientIP } from "./ratelimit.ts";
export type { RateLimitConfig, RateLimitResult } from "./ratelimit.ts";

// ── Cache ──
export { cacheGet, cacheSet, cacheInvalidate, cacheClear, cacheStats, withCache } from "./cache.ts";

// ── Feature Flags ──
export { isFlagOn, invalidateFlagsCache } from "./flags.ts";

// ── PDF & XLSX ──
export { generatePdf, bytesToBase64, pdfResponse, generateXlsx, xlsxResponse } from "./pdf.ts";
export type { PdfSection, PdfTable, PdfReportInput } from "./pdf.ts";

// ── WebAuthn ──
export { generateChallenge, verifyRegistration, verifyAuthentication, b64urlEncode, b64urlDecode } from "./webauthn.ts";

// ── AI (lazy — only import when needed to avoid loading Anthropic SDK on every function) ──
// Use: import { askClaude } from "../_shared/ai.ts";
// Not re-exported here to keep cold starts fast for non-AI functions.
