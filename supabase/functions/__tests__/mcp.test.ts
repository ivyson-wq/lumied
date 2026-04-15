// deno test supabase/functions/__tests__/mcp.test.ts
import { assertEquals, assertExists } from "@std/testing/asserts";
import {
  McpError,
  McpServer,
  RPC_FORBIDDEN,
  RPC_METHOD_NOT_FOUND,
  type McpContext,
  type McpTool,
} from "../_shared/mcp.ts";

// ─── Helpers ─────────────────────────────────────────────────
function fakeCtx(scope: McpContext["scope"] = "staff"): McpContext {
  return {
    // deno-lint-ignore no-explicit-any
    sb: {} as any,
    user: { id: "test", nome: "Test", email: "test@lumied.com.br", tipo: scope },
    scope,
    req: new Request("http://localhost"),
  };
}

function buildTestServer(): McpServer {
  const server = new McpServer("test", "0.0.1");
  const publicTool: McpTool = {
    name: "public_echo",
    description: "Public echo tool",
    inputSchema: { type: "object", properties: { msg: { type: "string" } } },
    scope: "public",
    handler: (args) => Promise.resolve({ echoed: args.msg }),
  };
  const gerenteTool: McpTool = {
    name: "gerente_kpis",
    description: "Gerente KPIs",
    inputSchema: { type: "object" },
    scope: "gerente",
    handler: () => Promise.resolve({ alunos: 100 }),
  };
  const staffTool: McpTool = {
    name: "staff_admin",
    description: "Staff-only admin",
    inputSchema: { type: "object" },
    scope: "staff",
    handler: () => Promise.resolve({ ok: true }),
  };
  const errorTool: McpTool = {
    name: "throws",
    description: "Tool that throws",
    inputSchema: { type: "object" },
    scope: "public",
    handler: () => { throw new Error("boom"); },
  };
  return server.register(publicTool).register(gerenteTool).register(staffTool).register(errorTool);
}

// ─── Registration ────────────────────────────────────────────
Deno.test("McpServer: register + listTools filters by scope", () => {
  const server = buildTestServer();
  const publicTools = server.listTools("public");
  assertEquals(publicTools.length, 2); // public_echo + throws
  const gerenteTools = server.listTools("gerente");
  assertEquals(gerenteTools.length, 3); // public + gerente
  const staffTools = server.listTools("staff");
  assertEquals(staffTools.length, 4); // everything except dev
});

Deno.test("McpServer: duplicate registration throws", () => {
  const server = new McpServer();
  const tool: McpTool = {
    name: "dup",
    description: "",
    inputSchema: { type: "object" },
    scope: "public",
    handler: () => Promise.resolve({}),
  };
  server.register(tool);
  let threw = false;
  try {
    server.register(tool);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("McpServer: canCall respects scope hierarchy", () => {
  const server = buildTestServer();
  assertEquals(server.canCall("staff_admin", "staff"), true);
  assertEquals(server.canCall("staff_admin", "gerente"), false);
  assertEquals(server.canCall("gerente_kpis", "gerente"), true);
  assertEquals(server.canCall("gerente_kpis", "professora"), false);
  assertEquals(server.canCall("public_echo", "public"), true);
});

// ─── JSON-RPC: initialize ────────────────────────────────────
Deno.test("JSON-RPC: initialize returns server info", async () => {
  const server = buildTestServer();
  const res = await server.handleRpc(
    { jsonrpc: "2.0", id: 1, method: "initialize" },
    fakeCtx("staff"),
  );
  assertExists(res);
  // deno-lint-ignore no-explicit-any
  const result = (res as any).result;
  assertEquals(result.protocolVersion, "2025-06-18");
  assertEquals(result.serverInfo.name, "test");
});

// ─── JSON-RPC: tools/list ────────────────────────────────────
Deno.test("JSON-RPC: tools/list filters by scope", async () => {
  const server = buildTestServer();
  const res = await server.handleRpc(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    fakeCtx("gerente"),
  );
  // deno-lint-ignore no-explicit-any
  const tools = (res as any).result.tools;
  assertEquals(tools.length, 3);
  assertEquals(
    tools.some((t: { name: string }) => t.name === "staff_admin"),
    false,
  );
});

// ─── JSON-RPC: tools/call happy path ─────────────────────────
Deno.test("JSON-RPC: tools/call executes and returns content", async () => {
  const server = buildTestServer();
  const res = await server.handleRpc(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "public_echo", arguments: { msg: "hi" } },
    },
    fakeCtx("public"),
  );
  assertExists(res);
  // deno-lint-ignore no-explicit-any
  const result = (res as any).result;
  assertEquals(result.isError, false);
  assertExists(result.content);
  assertEquals(result.content[0].type, "text");
  const parsed = JSON.parse(result.content[0].text);
  assertEquals(parsed.echoed, "hi");
});

// ─── JSON-RPC: tools/call scope violation ────────────────────
Deno.test("JSON-RPC: tools/call rejects out-of-scope", async () => {
  const server = buildTestServer();
  const res = await server.handleRpc(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "staff_admin", arguments: {} },
    },
    fakeCtx("gerente"),
  );
  assertExists(res);
  // deno-lint-ignore no-explicit-any
  const error = (res as any).error;
  assertExists(error);
  assertEquals(error.code, RPC_FORBIDDEN);
});

// ─── JSON-RPC: tools/call unknown tool ───────────────────────
Deno.test("JSON-RPC: unknown tool returns METHOD_NOT_FOUND", async () => {
  const server = buildTestServer();
  const res = await server.handleRpc(
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "nonexistent", arguments: {} },
    },
    fakeCtx("staff"),
  );
  // deno-lint-ignore no-explicit-any
  assertEquals((res as any).error.code, RPC_METHOD_NOT_FOUND);
});

// ─── JSON-RPC: tool handler errors become isError:true ───────
Deno.test("JSON-RPC: tool errors return isError=true (not JSON-RPC error)", async () => {
  const server = buildTestServer();
  const res = await server.handleRpc(
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "throws", arguments: {} },
    },
    fakeCtx("public"),
  );
  // deno-lint-ignore no-explicit-any
  const result = (res as any).result;
  assertEquals(result.isError, true);
  assertEquals(result.content[0].text.includes("boom"), true);
});

// ─── Notifications return null (no response) ────────────────
Deno.test("JSON-RPC: notifications/initialized returns null", async () => {
  const server = buildTestServer();
  const res = await server.handleRpc(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    fakeCtx("staff"),
  );
  assertEquals(res, null);
});

// ─── Unknown method returns error ────────────────────────────
Deno.test("JSON-RPC: unknown method returns METHOD_NOT_FOUND", async () => {
  const server = buildTestServer();
  const res = await server.handleRpc(
    { jsonrpc: "2.0", id: 6, method: "tools/unknown_method" },
    fakeCtx("staff"),
  );
  // deno-lint-ignore no-explicit-any
  assertEquals((res as any).error.code, RPC_METHOD_NOT_FOUND);
});

// ─── Claude tools export format ──────────────────────────────
Deno.test("asClaudeTools: converts to Anthropic tool-use format", () => {
  const server = buildTestServer();
  const tools = server.asClaudeTools("staff");
  assertEquals(tools.length, 4);
  for (const t of tools) {
    assertExists(t.name);
    assertExists(t.description);
    assertExists(t.input_schema);
  }
});

// ─── McpError class ──────────────────────────────────────────
Deno.test("McpError carries code and data", () => {
  const err = new McpError(-32001, "Unauthorized", { scope: "public" });
  assertEquals(err.code, -32001);
  assertEquals(err.message, "Unauthorized");
  assertEquals((err.data as { scope: string }).scope, "public");
});
