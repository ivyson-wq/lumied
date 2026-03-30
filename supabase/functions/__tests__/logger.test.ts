import { assertEquals, assertStringIncludes } from "@std/testing/asserts";
import { createLogger } from "../_shared/logger.ts";

Deno.test("logger - creates with function name", () => {
  const logger = createLogger("api");
  // Should not throw
  logger.info("test message");
  logger.warn("warning");
  logger.error("error");
  logger.debug("debug");
});

Deno.test("logger - request logs timing", () => {
  const logger = createLogger("test-fn");
  const start = Date.now() - 150;
  // Capture console output
  const originalLog = console.log;
  let output = "";
  console.log = (msg: string) => { output = msg; };
  logger.request("notas_list", start, { user_id: "user-123" });
  console.log = originalLog;

  const parsed = JSON.parse(output);
  assertEquals(parsed.level, "info");
  assertEquals(parsed.function_name, "test-fn");
  assertEquals(parsed.action, "notas_list");
  assertEquals(parsed.user_id, "user-123");
  assertEquals(typeof parsed.duration_ms, "number");
  assertEquals(parsed.duration_ms >= 150, true);
});

Deno.test("logger - apiError includes stack", () => {
  const logger = createLogger("test");
  const originalError = console.error;
  let output = "";
  console.error = (msg: string) => { output = msg; };
  logger.apiError("login", new Error("test error"), { user_id: "u1" });
  console.error = originalError;

  const parsed = JSON.parse(output);
  assertEquals(parsed.level, "error");
  assertStringIncludes(parsed.message, "test error");
  assertStringIncludes(parsed.error, "Error: test error");
});
