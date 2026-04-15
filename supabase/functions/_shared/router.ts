// ═══════════════════════════════════════════════════════════════
//  Shared: Router with Middleware Chain
//  Replaces the giant if/else action dispatch pattern
// ═══════════════════════════════════════════════════════════════

import { SupabaseClient } from "@supabase/supabase-js";
import { errorResponse, corsResponse, runWithCors, AppError } from "./errors.ts";
import { checkRateLimit, checkRateLimitDb, getClientIP, RateLimitConfig } from "./ratelimit.ts";
import { validate, sanitizeBody, Schema } from "./validation.ts";
import { createLogger } from "./logger.ts";
import { getModulosHabilitados, getEscolaPadrao } from "./modulos.ts";

export type Context = {
  req: Request;
  body: Record<string, unknown>;
  action: string;
  sb: SupabaseClient;
  ip: string;
  user?: { id: string; nome: string; email: string; tipo: string };
  escola_id?: string;
  modulos?: Set<string>;
  startTime: number;
};

export type Handler = (ctx: Context) => Promise<Response>;
export type Middleware = (ctx: Context, next: () => Promise<Response>) => Promise<Response>;

type RouteConfig = {
  handler: Handler;
  middlewares: Middleware[];
};

export class Router {
  private routes = new Map<string, RouteConfig>();
  private globalMiddlewares: Middleware[] = [];
  private logger;

  constructor(private functionName: string) {
    this.logger = createLogger(functionName);
  }

  /** Add global middleware (runs on all routes) */
  useGlobal(mw: Middleware) {
    this.globalMiddlewares.push(mw);
    return this;
  }

  /** Register a route with optional middlewares */
  on(action: string, ...args: (Middleware | Handler)[]) {
    const handler = args.pop() as Handler;
    const middlewares = args as Middleware[];
    this.routes.set(action, { handler, middlewares });
    return this;
  }

  /** Handle incoming request */
  handle(req: Request, sb: SupabaseClient): Promise<Response> {
    return runWithCors(req, () => this._handle(req, sb));
  }

  private async _handle(req: Request, sb: SupabaseClient): Promise<Response> {
    if (req.method === "OPTIONS") return corsResponse();

    const startTime = Date.now();
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return errorResponse("BAD_REQUEST", "Body inválido."); }

    const action = body.action as string;
    if (!action) return errorResponse("BAD_REQUEST", "Action não especificada.");

    const route = this.routes.get(action);
    if (!route) return errorResponse("NOT_FOUND", `Ação desconhecida: ${action}`);

    const ctx: Context = {
      req, body: sanitizeBody(body), action, sb,
      ip: getClientIP(req), startTime,
    };

    // Build middleware chain: global + route-specific + handler
    const allMiddlewares = [...this.globalMiddlewares, ...route.middlewares];
    let index = 0;

    // deno-lint-ignore require-await
    const next = async (): Promise<Response> => {
      if (index < allMiddlewares.length) {
        return allMiddlewares[index++](ctx, next);
      }
      return route.handler(ctx);
    };

    try {
      const response = await next();
      this.logger.request(action, startTime, {
        user_id: ctx.user?.id,
        escola_id: ctx.escola_id,
      });
      return response;
    } catch (error) {
      this.logger.apiError(action, error, { user_id: ctx.user?.id });
      if (error instanceof AppError) {
        return errorResponse(error.code, error.message, error.details);
      }
      return errorResponse("INTERNAL_ERROR", "Erro interno do servidor.");
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  Built-in Middlewares
// ═══════════════════════════════════════════════════════════════

/**
 * Rate limiting middleware.
 *
 * Uses the DB-backed `rate_limit_check` RPC (migration 218) so counters
 * are shared across edge function instances and survive cold starts.
 * Falls back to the in-memory limiter if the RPC is unavailable
 * (see checkRateLimitDb implementation).
 */
export function rateLimit(config?: RateLimitConfig): Middleware {
  return async (ctx, next) => {
    const category = ctx.action.startsWith('login') ? 'login' : 'api';
    const result = await checkRateLimitDb(
      ctx.sb,
      ctx.ip,
      config ? ctx.action : category,
      config,
    );
    if (!result.allowed) {
      return errorResponse("RATE_LIMITED", `Muitas requisições. Tente novamente em ${result.retryAfterSeconds}s.`);
    }
    return next();
  };
}

/**
 * Legacy sync rate-limit middleware kept for actions/functions that
 * want to opt out of the DB round-trip (e.g. extremely hot paths).
 */
export function rateLimitInMemory(config?: RateLimitConfig): Middleware {
  // deno-lint-ignore require-await
  return async (ctx, next) => {
    const category = ctx.action.startsWith('login') ? 'login' : 'api';
    const result = checkRateLimit(ctx.ip, config ? ctx.action : category, config);
    if (!result.allowed) {
      return errorResponse("RATE_LIMITED", `Muitas requisições. Tente novamente em ${result.retryAfterSeconds}s.`);
    }
    return next();
  };
}

/** Auth middleware — validates session token and loads escola_id */
export function auth(sessionTable: string, userTable: string, userFields: string, tokenField = '_token'): Middleware {
  // Always include escola_id in the projection (legacy gerentes/professoras/secretarias all have it
  // via migration 074). We strip it from userFields if caller already included it to avoid duplicates.
  const fields = userFields.split(",").map(f => f.trim());
  if (!fields.includes("escola_id")) fields.push("escola_id");
  const projection = fields.join(", ");

  return async (ctx, next) => {
    const token = (ctx.body[tokenField] as string) || null;
    if (!token) throw new AppError("AUTH_REQUIRED", "Token de sessão obrigatório.");

    const { data: raw } = await ctx.sb
      .from(sessionTable)
      .select(`*, ${userTable}(${projection})`)
      .eq("token", token)
      .single();
    // deno-lint-ignore no-explicit-any
    const data = raw as any;

    if (!data) throw new AppError("AUTH_INVALID", "Sessão inválida.");
    if (new Date(data.expira_em) < new Date()) throw new AppError("AUTH_EXPIRED", "Sessão expirada.");

    const user = data[userTable];
    ctx.user = { ...user, tipo: sessionTable.replace('_sessoes', '') };
    if (user?.escola_id && !ctx.escola_id) {
      ctx.escola_id = user.escola_id as string;
    }
    return next();
  };
}

/** Gerente auth shortcut */
export const authGerente: Middleware = auth("gerente_sessoes", "gerentes", "id, nome, email");

/** Professora auth shortcut */
export const authProfessora: Middleware = auth("professora_sessoes", "professoras", "id, nome, email, serie_id", "_prof_token");


/**
 * Unified auth middleware that accepts BOTH gerente (legacy) and
 * secretaria/equipe (unified session) tokens. Used by operacional, rh,
 * compliance. Populates ctx.user + ctx.escola_id.
 *
 * Allowed papeis can be customised; defaults cover all staff roles that
 * should have access to operational/rh/compliance modules.
 */
export function authGerenteOrSecretaria(
  allowedPapeis: string[] = ["gerente", "diretor", "secretaria", "comercial", "financeiro"],
): Middleware {
  return async (ctx, next) => {
    const token = (ctx.body._token as string) || null;
    if (!token) throw new AppError("AUTH_REQUIRED", "Token de sessão obrigatório.");

    // 1. Try legacy gerente_sessoes (gerentes has escola_id via 074)
    const { data: gs } = await ctx.sb
      .from("gerente_sessoes")
      .select("*, gerentes(id, nome, email, escola_id)")
      .eq("token", token)
      .maybeSingle();
    if (gs && new Date(gs.expira_em) >= new Date()) {
      // deno-lint-ignore no-explicit-any
      const g = (gs as any).gerentes;
      ctx.user = { ...g, tipo: "gerente" };
      if (g?.escola_id) ctx.escola_id = g.escola_id as string;
      return next();
    }

    // 2. Try legacy secretaria_sessoes (secretarias has escola_id via 074)
    const { data: ss } = await ctx.sb
      .from("secretaria_sessoes")
      .select("*, secretarias(id, nome, email, escola_id)")
      .eq("token", token)
      .maybeSingle();
    if (ss && new Date(ss.expira_em) >= new Date()) {
      // deno-lint-ignore no-explicit-any
      const s = (ss as any).secretarias;
      ctx.user = { ...s, tipo: "secretaria" };
      if (s?.escola_id) ctx.escola_id = s.escola_id as string;
      return next();
    }

    // 3. Try unified sessoes → usuarios (110 added escola_id to usuarios)
    const { data: us } = await ctx.sb
      .from("sessoes")
      .select("*, usuarios(id, nome, email, papeis, papel, escola_id)")
      .eq("token", token)
      .maybeSingle();
    if (us && new Date(us.expira_em) >= new Date()) {
      // deno-lint-ignore no-explicit-any
      const usuario = (us as any).usuarios;
      const papeis: string[] = usuario?.papeis?.length
        ? usuario.papeis
        : (usuario?.papel ? [usuario.papel] : []);
      if (papeis.some((p: string) => allowedPapeis.includes(p))) {
        ctx.user = { ...usuario, tipo: papeis[0] };
        if (usuario?.escola_id) ctx.escola_id = usuario.escola_id as string;
        return next();
      }
    }

    throw new AppError("AUTH_INVALID", "Sessão inválida ou sem permissão.");
  };
}

/** Feature module check middleware */
export function requireFeature(slug: string): Middleware {
  return async (ctx, next) => {
    if (!ctx.modulos) {
      // Prefer escola_id already loaded by auth; fall back to padrão
      const escolaId = ctx.escola_id || (await getEscolaPadrao(ctx.sb)) || undefined;
      ctx.escola_id = escolaId;
      ctx.modulos = escolaId ? await getModulosHabilitados(ctx.sb, escolaId) : new Set();
    }
    if (!ctx.modulos.has(slug)) {
      return errorResponse("FEATURE_DISABLED", "Este recurso não está disponível no plano atual.", { modulo_required: slug });
    }
    return next();
  };
}

/** Input validation middleware */
export function validateInput(schema: Schema): Middleware {
  // deno-lint-ignore require-await
  return async (ctx, next) => {
    const errors = validate(ctx.body as Record<string, unknown>, schema);
    if (errors.length > 0) {
      return errorResponse("VALIDATION_FAILED", errors[0].message, { errors });
    }
    return next();
  };
}

/** Load escola_id into context */
export const loadEscola: Middleware = async (ctx, next) => {
  if (!ctx.escola_id) {
    const escolaId = await getEscolaPadrao(ctx.sb);
    ctx.escola_id = escolaId || undefined;
  }
  return next();
};

/**
 * Enforce that ctx.escola_id is set. Used on routes that mutate or read
 * tenant-scoped tables, to prevent accidental cross-tenant leaks if some
 * earlier middleware forgot to populate it. Throws 400 otherwise.
 */
export const requireEscola: Middleware = (ctx, next) => {
  if (!ctx.escola_id) {
    throw new AppError("ESCOLA_REQUIRED", "escola_id não resolvido para este usuário.");
  }
  return next();
};
