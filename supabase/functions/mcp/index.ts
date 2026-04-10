// ═══════════════════════════════════════════════════════════════
//  Edge Function: mcp — Model Context Protocol server
//
//  Exposes Lumied tools (staff, gerente, compliance, dev) via
//  JSON-RPC 2.0 / MCP Streamable HTTP transport.
//
//  Any MCP client (Claude Desktop, Claude Code, Cursor, custom)
//  can connect to this endpoint and discover/call tools based on
//  the scope of the authenticated token.
//
//  Endpoint: POST https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/mcp
//  Auth:     Authorization: Bearer <token>
//    - Staff session token → staff scope (all tenant tools)
//    - Gerente session token → gerente scope
//    - Professora token → professora scope
//    - MCP_DEV_KEY env → dev scope (full access)
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateAuto, McpServer } from "../_shared/mcp.ts";
import { staffTools } from "./tools_staff.ts";
import { gerenteTools } from "./tools_gerente.ts";
import { complianceTools } from "./tools_compliance.ts";
import { devTools } from "./tools_dev.ts";

// ─── Build server ────────────────────────────────────────────
const server = new McpServer("lumied-mcp", "1.0.0");
server.registerAll(staffTools);
server.registerAll(gerenteTools);
server.registerAll(complianceTools);
server.registerAll(devTools);

// Expose for use by other edge functions (ticket-resolver, lumied-ai)
export function getServer(): McpServer {
  return server;
}

// ─── HTTP handler ────────────────────────────────────────────
serve(async (req: Request) => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return await server.handleHttp(req, sb, authenticateAuto);
});
