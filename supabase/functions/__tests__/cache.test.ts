import { assertEquals } from "@std/testing/asserts";
import { cacheGet, cacheSet, cacheInvalidate, cacheClear, withCache } from "../_shared/cache.ts";

Deno.test("cacheSet + cacheGet stores and retrieves data", () => {
  cacheSet("test-key", { foo: "bar" }, 5000);
  const result = cacheGet("test-key");
  assertEquals(result, { foo: "bar" });
});

Deno.test("cacheGet returns null for missing key", () => {
  assertEquals(cacheGet("nonexistent-key-" + Date.now()), null);
});

Deno.test("cacheGet returns null for expired entry", async () => {
  cacheSet("expire-test", "data", 1); // 1ms TTL
  await new Promise(r => setTimeout(r, 10));
  assertEquals(cacheGet("expire-test"), null);
});

Deno.test("cacheInvalidate removes matching keys", () => {
  cacheSet("alunos:list", [1, 2], 5000);
  cacheSet("alunos:detail", { id: 1 }, 5000);
  cacheSet("profs:list", [3, 4], 5000);
  cacheInvalidate("alunos:");
  assertEquals(cacheGet("alunos:list"), null);
  assertEquals(cacheGet("alunos:detail"), null);
  assertEquals(cacheGet("profs:list"), [3, 4]); // not invalidated
});

Deno.test("cacheClear removes all entries", () => {
  cacheSet("a", 1, 5000);
  cacheSet("b", 2, 5000);
  cacheClear();
  assertEquals(cacheGet("a"), null);
  assertEquals(cacheGet("b"), null);
});

Deno.test("withCache returns cached value on second call", async () => {
  let callCount = 0;
  const fn = () => { callCount++; return Promise.resolve({ data: "expensive" }); };

  const _r1 = await withCache("wc-test-" + Date.now(), 5000, fn);
  const _r2 = await withCache("wc-test-" + Date.now(), 5000, fn);
  // Note: different timestamps means different keys, so callCount = 2 in reality
  // Use same key:
  const key = "wc-same-" + Date.now();
  callCount = 0;
  await withCache(key, 5000, fn);
  await withCache(key, 5000, fn);
  assertEquals(callCount, 1, "Function should only be called once (second call is cached)");
});
