// ═══════════════════════════════════════════════════════════════
//  Shared: Router with Middleware Chain
//  Replaces the giant if/else action dispatch pattern
// ═══════════════════════════════════════════════════════════════

import { SupabaseClient } from "@supabase/supabase-js";
import { errorResponse, corsResponse, setRequestForCors, AppError } from "./errors.ts";
import { checkRateLimit, getClientIP, RateLimitConfig } from "./ratelimit.ts";
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
  async handle(req: Request, sb: SupabaseClient): Promise<Response> {
    setRequestForCors(req);
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

/** Rate limiting middleware */
export function rateLimit(config?: RateLimitConfig): Middleware {
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

/** Auth middleware — validates session token */
export function auth(sessionTable: string, userTable: string, userFields: string, tokenField = '_token'): Middleware {
  return async (ctx, next) => {
    const token = (ctx.body[tokenField] as string) || null;
    if (!token) throw new AppError("AUTH_REQUIRED", "Token de sessão obrigatório.");

    const { data } = await ctx.sb
      .from(sessionTable)
      .select(`*, ${userTable}(${userFields})`)
      .eq("token", token)
      .single();

    if (!data) throw new AppError("AUTH_INVALID", "Sessão inválida.");
    if (new Date(data.expira_em) < new Date()) throw new AppError("AUTH_EXPIRED", "Sessão expirada.");

    // deno-lint-ignore no-explicit-any
    const user = (data as any)[userTable];
    ctx.user = { ...user, tipo: sessionTable.replace('_sessoes', '') };
    return next();
  };
}

/** Gerente auth shortcut */
export const authGerente: Middleware = auth("gerente_sessoes", "gerentes", "id, nome, email");

/** Professora auth shortcut */
export const authProfessora: Middleware = auth("professora_sessoes", "professoras", "id, nome, email, serie_id", "_prof_token");


/** Feature module check middleware */
export function requireFeature(slug: string): Middleware {
  return async (ctx, next) => {
    if (!ctx.modulos) {
      const escolaId = await getEscolaPadrao(ctx.sb);
      ctx.escola_id = escolaId || undefined;
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
