import { assertEquals } from "@std/testing/asserts";
import { Router, type Context } from "../_shared/router.ts";
import { AppError } from "../_shared/errors.ts";

// Mock SupabaseClient (minimal)
// deno-lint-ignore no-explicit-any
const mockSb = { from: () => ({ select: () => ({ eq: () => ({ single: () => ({ data: null }), maybeSingle: () => ({ data: null }) }) }) }) } as any;

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("Router dispatches to registered action", async () => {
  const router = new Router("test");
  let called = false;
  // deno-lint-ignore require-await
  router.on("test_action", async (_ctx: Context) => {
    called = true;
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  });

  const req = makeRequest({ action: "test_action" });
  const res = await router.handle(req, mockSb);
  assertEquals(called, true, "Handler should be called");
  assertEquals(res.status, 200);
});

Deno.test("Router returns NOT_FOUND for unknown action", async () => {
  const router = new Router("test");
  // deno-lint-ignore require-await
  router.on("known", async () => new Response("ok"));

  const req = makeRequest({ action: "unknown_action" });
  const res = await router.handle(req, mockSb);
  const body = await res.json();
  assertEquals(body.code, "NOT_FOUND");
});

Deno.test("Router returns BAD_REQUEST for missing action", async () => {
  const router = new Router("test");
  const req = makeRequest({});
  const res = await router.handle(req, mockSb);
  const body = await res.json();
  assertEquals(body.code, "BAD_REQUEST");
});

Deno.test("Router runs global middleware before handler", async () => {
  const order: string[] = [];
  const router = new Router("test");
  // deno-lint-ignore require-await
  router.useGlobal(async (_ctx, next) => { order.push("global"); return next(); });
  // deno-lint-ignore require-await
  router.on("test", async () => { order.push("handler"); return new Response("ok"); });

  await router.handle(makeRequest({ action: "test" }), mockSb);
  assertEquals(order, ["global", "handler"]);
});

Deno.test("Router runs route middleware in order", async () => {
  const order: string[] = [];
  const router = new Router("test");
  // deno-lint-ignore require-await
  const mw1 = async (_ctx: Context, next: () => Promise<Response>) => { order.push("mw1"); return next(); };
  // deno-lint-ignore require-await
  const mw2 = async (_ctx: Context, next: () => Promise<Response>) => { order.push("mw2"); return next(); };
  // deno-lint-ignore require-await
  router.on("test", mw1, mw2, async () => { order.push("handler"); return new Response("ok"); });

  await router.handle(makeRequest({ action: "test" }), mockSb);
  assertEquals(order, ["mw1", "mw2", "handler"]);
});

Deno.test("Router catches AppError and returns proper response", async () => {
  const router = new Router("test");
  // deno-lint-ignore require-await
  router.on("fail", async () => { throw new AppError("VALIDATION_FAILED", "Nome obrigatório"); });

  const res = await router.handle(makeRequest({ action: "fail" }), mockSb);
  const body = await res.json();
  assertEquals(res.status, 400);
  assertEquals(body.code, "VALIDATION_FAILED");
  assertEquals(body.error, "Nome obrigatório");
});

Deno.test({ name: "Router catches unknown errors and returns 500", sanitizeOps: false, sanitizeResources: false }, async () => {
  const router = new Router("test");
  // deno-lint-ignore require-await
  router.on("crash", async () => { throw new Error("unexpected"); });

  const res = await router.handle(makeRequest({ action: "crash" }), mockSb);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.code, "INTERNAL_ERROR");
});

Deno.test("Router handles OPTIONS preflight", async () => {
  const router = new Router("test");
  const req = new Request("http://localhost/test", { method: "OPTIONS" });
  const res = await router.handle(req, mockSb);
  assertEquals(res.status, 200);
});

Deno.test("Router sanitizes body (XSS prevention)", async () => {
  const router = new Router("test");
  let receivedBody: Record<string, unknown> = {};
  // deno-lint-ignore require-await
  router.on("xss", async (ctx: Context) => {
    receivedBody = ctx.body;
    return new Response("ok");
  });

  await router.handle(makeRequest({ action: "xss", nome: "<script>alert(1)</script>" }), mockSb);
  assertEquals(typeof receivedBody.nome, "string");
  assertEquals((receivedBody.nome as string).includes("<script>"), false, "Script tags should be sanitized");
});

Deno.test("Router populates context correctly", async () => {
  const router = new Router("test");
  let ctx: Context | null = null;
  // deno-lint-ignore require-await
  router.on("check", async (c: Context) => { ctx = c; return new Response("ok"); });

  const req = makeRequest({ action: "check", foo: "bar" });
  await router.handle(req, mockSb);
  assertEquals(ctx!.action, "check");
  assertEquals(ctx!.body.foo, "bar");
  assertEquals(typeof ctx!.startTime, "number");
  assertEquals(typeof ctx!.ip, "string");
});
