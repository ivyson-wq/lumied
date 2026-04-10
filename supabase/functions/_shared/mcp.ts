// ═══════════════════════════════════════════════════════════════
//  Shared: MCP (Model Context Protocol) — Server implementation
//
//  Minimal JSON-RPC 2.0 over HTTP (MCP Streamable HTTP transport).
//  Exposes Lumied edge-function actions as discoverable tools so
//  Claude and any other MCP client can call them via tool use.
//
//  Spec: https://modelcontextprotocol.io/specification/2025-06-18
// ═══════════════════════════════════════════════════════════════

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCorsHeaders } from "./cors.ts";

// ─── JSON-RPC 2.0 types ───
export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: JsonRpcError };

// Standard JSON-RPC / MCP error codes
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;
export const RPC_UNAUTHORIZED = -32001;
export const RPC_FORBIDDEN = -32003;
export const RPC_TOOL_ERROR = -32010;

export class McpError extends Error {
  constructor(public code: number, message: string, public data?: unknown) {
    super(message);
  }
}

// ─── Tool definitions ───
export type McpScope =
  | "public"
  | "professora"
  | "gerente"
  | "secretaria"
  | "staff"
  | "dev";

// Scope hierarchy — staff gets access to everything except dev (dev is separate)
const SCOPE_ACCESS: Record<McpScope, McpScope[]> = {
  public: ["public"],
  professora: ["public", "professora"],
  gerente: ["public", "professora", "gerente", "secretaria"],
  secretaria: ["public", "secretaria"],
  staff: ["public", "professora", "gerente", "secretaria", "staff"],
  dev: ["public", "professora", "gerente", "secretaria", "staff", "dev"],
};

export interface McpContext {
  sb: SupabaseClient;
  user: { id: string; nome: string; email: string; tipo: string } | null;
  scope: McpScope;
  req: Request;
}

// deno-lint-ignore no-explicit-any
export type JsonSchema = Record<string, any>;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  scope: McpScope;
  // deno-lint-ignore no-explicit-any
  handler: (args: Record<string, any>, ctx: McpContext) => Promise<unknown>;
}

// ─── Server ───
export class McpServer {
  private tools = new Map<string, McpTool>();
  public readonly name: string;
  public readonly version: string;

  constructor(name = "lumied-mcp", version = "1.0.0") {
    this.name = name;
    this.version = version;
  }

  register(tool: McpTool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: McpTool[]): this {
    tools.forEach((t) => this.register(t));
    return this;
  }

  /** List tools visible to the given scope */
  listTools(scope: McpScope): McpTool[] {
    const allowed = new Set(SCOPE_ACCESS[scope] || []);
    return [...this.tools.values()].filter((t) => allowed.has(t.scope));
  }

  getTool(name: string): McpTool | undefined {
    return this.tools.get(name);
  }

  canCall(toolName: string, scope: McpScope): boolean {
    const tool = this.tools.get(toolName);
    if (!tool) return false;
    const allowed = new Set(SCOPE_ACCESS[scope] || []);
    return allowed.has(tool.scope);
  }

  /** Handle a single JSON-RPC request */
  async handleRpc(
    request: JsonRpcRequest,
    ctx: McpContext,
  ): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;

    // Notifications (no id) → no response
    const isNotification = request.id === undefined;

    try {
      if (request.jsonrpc !== "2.0") {
        throw new McpError(RPC_INVALID_REQUEST, "jsonrpc must be '2.0'");
      }

      let result: unknown;
      switch (request.method) {
        case "initialize":
          result = {
            protocolVersion: "2025-06-18",
            capabilities: {
              tools: { listChanged: false },
              logging: {},
            },
            serverInfo: { name: this.name, version: this.version },
          };
          break;

        case "notifications/initialized":
        case "notifications/cancelled":
          // Acknowledged notifications — no response
          return null;

        case "ping":
          result = {};
          break;

        case "tools/list": {
          const tools = this.listTools(ctx.scope).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }));
          result = { tools };
          break;
        }

        case "tools/call": {
          const params = (request.params || {}) as {
            name?: string;
            arguments?: Record<string, unknown>;
          };
          if (!params.name) {
            throw new McpError(RPC_INVALID_PARAMS, "Missing tool name");
          }
          const tool = this.tools.get(params.name);
          if (!tool) {
            throw new McpError(
              RPC_METHOD_NOT_FOUND,
              `Tool not found: ${params.name}`,
            );
          }
          if (!this.canCall(params.name, ctx.scope)) {
            throw new McpError(
              RPC_FORBIDDEN,
              `Tool '${params.name}' requires scope '${tool.scope}', current scope is '${ctx.scope}'`,
            );
          }
          try {
            // deno-lint-ignore no-explicit-any
            const output = await tool.handler((params.arguments || {}) as any, ctx);
            result = {
              content: [
                {
                  type: "text",
                  text: typeof output === "string"
                    ? output
                    : JSON.stringify(output, null, 2),
                },
              ],
              isError: false,
            };
          } catch (err) {
            // Tool execution errors are returned as isError: true (not JSON-RPC errors)
            // so the LLM can see the error and potentially recover
            const msg = err instanceof Error ? err.message : String(err);
            result = {
              content: [{ type: "text", text: `Error: ${msg}` }],
              isError: true,
            };
          }
          break;
        }

        case "resources/list":
          result = { resources: [] };
          break;

        case "prompts/list":
          result = { prompts: [] };
          break;

        default:
          throw new McpError(
            RPC_METHOD_NOT_FOUND,
            `Method not found: ${request.method}`,
          );
      }

      if (isNotification) return null;
      return { jsonrpc: "2.0", id, result };
    } catch (err) {
      if (isNotification) return null;
      if (err instanceof McpError) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: err.code, message: err.message, data: err.data },
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: "2.0",
        id,
        error: { code: RPC_INTERNAL_ERROR, message: msg },
      };
    }
  }

  /** Handle an HTTP request (Streamable HTTP transport) */
  async handleHttp(
    req: Request,
    sb: SupabaseClient,
    authenticate: (req: Request, sb: SupabaseClient) => Promise<McpContext>,
  ): Promise<Response> {
    const corsHeaders = getCorsHeaders(req);
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: corsHeaders },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: RPC_PARSE_ERROR, message: "Parse error" },
        }),
        { status: 400, headers: corsHeaders },
      );
    }

    // Authenticate (skip for public-only initialize)
    let ctx: McpContext;
    try {
      ctx = await authenticate(req, sb);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unauthorized";
      // Allow unauthenticated initialize/ping for discovery
      const request = body as JsonRpcRequest;
      const unauthMethods = ["initialize", "ping", "notifications/initialized"];
      if (!Array.isArray(body) && unauthMethods.includes(request.method)) {
        ctx = { sb, user: null, scope: "public", req };
      } else {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: (body as JsonRpcRequest).id ?? null,
            error: { code: RPC_UNAUTHORIZED, message: msg },
          }),
          { status: 401, headers: corsHeaders },
        );
      }
    }

    // Batch or single
    if (Array.isArray(body)) {
      const responses = await Promise.all(
        body.map((r) => this.handleRpc(r, ctx)),
      );
      const filtered = responses.filter((r): r is JsonRpcResponse => r !== null);
      return new Response(JSON.stringify(filtered), {
        status: 200,
        headers: corsHeaders,
      });
    } else {
      const response = await this.handleRpc(body as JsonRpcRequest, ctx);
      if (response === null) {
        return new Response(null, { status: 202, headers: corsHeaders });
      }
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: corsHeaders,
      });
    }
  }

  /** Convert registered tools into Anthropic tool-use format */
  asClaudeTools(scope: McpScope): Array<{
    name: string;
    description: string;
    // deno-lint-ignore no-explicit-any
    input_schema: any;
  }> {
    return this.listTools(scope).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }
}

// ═══════════════════════════════════════════════════════════════
//  Authentication helpers
// ═══════════════════════════════════════════════════════════════

/** Extract bearer token from Authorization header */
export function extractToken(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Auto-detect scope by trying token against session tables.
 * Order: dev key → staff → gerente → sessoes unificadas → professora → secretaria
 */
export async function authenticateAuto(
  req: Request,
  sb: SupabaseClient,
): Promise<McpContext> {
  const token = extractToken(req);
  if (!token) throw new McpError(RPC_UNAUTHORIZED, "Missing Authorization header");

  // 1. Dev key (env var for local dev + staff automation)
  const devKey = Deno.env.get("MCP_DEV_KEY");
  if (devKey && token === devKey) {
    return {
      sb,
      user: {
        id: "dev",
        nome: "Developer",
        email: "dev@lumied.com.br",
        tipo: "dev",
      },
      scope: "dev",
      req,
    };
  }

  // 2. Staff token
  const { data: staff } = await sb
    .from("lumied_staff_sessoes")
    .select("staff_id, expira_em, lumied_staff(id, nome, email, cargo, ativo)")
    .eq("token", token)
    .maybeSingle();
  if (
    staff &&
    new Date((staff as { expira_em: string }).expira_em) >= new Date()
  ) {
    // deno-lint-ignore no-explicit-any
    const s = (staff as any).lumied_staff;
    if (s?.ativo) {
      return {
        sb,
        user: { id: s.id, nome: s.nome, email: s.email, tipo: "staff" },
        scope: "staff",
        req,
      };
    }
  }

  // 3. Gerente token
  const { data: ger } = await sb
    .from("gerente_sessoes")
    .select("expira_em, gerentes(id, nome, email)")
    .eq("token", token)
    .maybeSingle();
  if (
    ger &&
    new Date((ger as { expira_em: string }).expira_em) >= new Date()
  ) {
    // deno-lint-ignore no-explicit-any
    const g = (ger as any).gerentes;
    if (g) {
      return {
        sb,
        user: { id: g.id, nome: g.nome, email: g.email, tipo: "gerente" },
        scope: "gerente",
        req,
      };
    }
  }

  // 4. Unified sessoes (detects papeis → scope)
  const { data: us } = await sb
    .from("sessoes")
    .select("usuario_id, expira_em")
    .eq("token", token)
    .maybeSingle();
  if (us && new Date((us as { expira_em: string }).expira_em) >= new Date()) {
    const { data: u } = await sb
      .from("usuarios")
      .select("id, nome, email, papel, papeis")
      .eq("id", (us as { usuario_id: string }).usuario_id)
      .maybeSingle();
    if (u) {
      // deno-lint-ignore no-explicit-any
      const user = u as any;
      const papeis: string[] = user.papeis || (user.papel ? [user.papel] : []);
      let scope: McpScope = "public";
      if (papeis.includes("gerente") || papeis.includes("diretor")) scope = "gerente";
      else if (papeis.includes("professora") || papeis.includes("professora_assistente")) scope = "professora";
      else if (papeis.includes("secretaria") || papeis.includes("comercial") || papeis.includes("financeiro")) scope = "secretaria";
      return {
        sb,
        user: { id: user.id, nome: user.nome, email: user.email, tipo: "unificado" },
        scope,
        req,
      };
    }
  }

  // 5. Professora legado
  const { data: prof } = await sb
    .from("professora_sessoes")
    .select("expira_em, professoras(id, nome, email, serie_id)")
    .eq("token", token)
    .maybeSingle();
  if (
    prof &&
    new Date((prof as { expira_em: string }).expira_em) >= new Date()
  ) {
    // deno-lint-ignore no-explicit-any
    const p = (prof as any).professoras;
    if (p) {
      return {
        sb,
        user: { id: p.id, nome: p.nome, email: p.email, tipo: "professora" },
        scope: "professora",
        req,
      };
    }
  }

  // 6. Secretaria legado
  const { data: sec } = await sb
    .from("secretaria_sessoes")
    .select("expira_em, secretarias(id, nome, email)")
    .eq("token", token)
    .maybeSingle();
  if (
    sec &&
    new Date((sec as { expira_em: string }).expira_em) >= new Date()
  ) {
    // deno-lint-ignore no-explicit-any
    const s = (sec as any).secretarias;
    if (s) {
      return {
        sb,
        user: { id: s.id, nome: s.nome, email: s.email, tipo: "secretaria" },
        scope: "secretaria",
        req,
      };
    }
  }

  throw new McpError(RPC_UNAUTHORIZED, "Invalid or expired token");
}
