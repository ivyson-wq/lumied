import { assertEquals } from "@std/testing/asserts";
import { checkRateLimit } from "../_shared/ratelimit.ts";

Deno.test("rateLimit - allows requests under limit", () => {
  const result = checkRateLimit("test-ip-1", "test-action-1", { windowMs: 60000, maxRequests: 5 });
  assertEquals(result.allowed, true);
  assertEquals(result.remaining, 4);
});

Deno.test("rateLimit - blocks after exceeding limit", () => {
  const config = { windowMs: 60000, maxRequests: 3 };
  checkRateLimit("test-ip-2", "test-action-2", config); // 1
  checkRateLimit("test-ip-2", "test-action-2", config); // 2
  checkRateLimit("test-ip-2", "test-action-2", config); // 3
  const result = checkRateLimit("test-ip-2", "test-action-2", config); // 4 - blocked
  assertEquals(result.allowed, false);
  assertEquals(result.remaining, 0);
  assertEquals(typeof result.retryAfterSeconds, "number");
});

Deno.test("rateLimit - different IPs are independent", () => {
  const config = { windowMs: 60000, maxRequests: 2 };
  checkRateLimit("ip-a", "test-action-3", config);
  checkRateLimit("ip-a", "test-action-3", config);
  const blockedA = checkRateLimit("ip-a", "test-action-3", config);
  assertEquals(blockedA.allowed, false);

  const allowedB = checkRateLimit("ip-b", "test-action-3", config);
  assertEquals(allowedB.allowed, true);
});

Deno.test("rateLimit - different actions are independent", () => {
  const config = { windowMs: 60000, maxRequests: 1 };
  checkRateLimit("ip-c", "action-x", config);
  const blocked = checkRateLimit("ip-c", "action-x", config);
  assertEquals(blocked.allowed, false);

  const allowed = checkRateLimit("ip-c", "action-y", config);
  assertEquals(allowed.allowed, true);
});

Deno.test("rateLimit - remaining count decreases", () => {
  const config = { windowMs: 60000, maxRequests: 5 };
  const r1 = checkRateLimit("ip-d", "test-action-4", config);
  assertEquals(r1.remaining, 4);
  const r2 = checkRateLimit("ip-d", "test-action-4", config);
  assertEquals(r2.remaining, 3);
  const r3 = checkRateLimit("ip-d", "test-action-4", config);
  assertEquals(r3.remaining, 2);
});
