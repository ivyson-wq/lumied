import { assertEquals } from "@std/testing/asserts";
import { AppError, errorResponse, successResponse, withErrorHandler } from "../_shared/errors.ts";

Deno.test("AppError - creates with correct status", () => {
  const err = new AppError("AUTH_INVALID", "Sessão inválida");
  assertEquals(err.code, "AUTH_INVALID");
  assertEquals(err.statusCode, 401);
  assertEquals(err.message, "Sessão inválida");
});

Deno.test("AppError - RATE_LIMITED = 429", () => {
  assertEquals(new AppError("RATE_LIMITED", "").statusCode, 429);
});

Deno.test("AppError - NOT_FOUND = 404", () => {
  assertEquals(new AppError("NOT_FOUND", "").statusCode, 404);
});

Deno.test("AppError - VALIDATION_FAILED = 400", () => {
  assertEquals(new AppError("VALIDATION_FAILED", "").statusCode, 400);
});

Deno.test("errorResponse - returns correct status and body", async () => {
  const res = errorResponse("AUTH_REQUIRED", "Token obrigatório");
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Token obrigatório");
  assertEquals(body.code, "AUTH_REQUIRED");
  assertEquals(typeof body.timestamp, "string");
});

Deno.test("errorResponse - includes details", async () => {
  const res = errorResponse("VALIDATION_FAILED", "Campo inválido", { errors: [{ field: "email" }] });
  const body = await res.json();
  assertEquals(body.details.errors[0].field, "email");
});

Deno.test("successResponse - returns 200 with data", async () => {
  const res = successResponse({ nome: "Ana", id: "123" });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.nome, "Ana");
});

// deno-lint-ignore require-await
Deno.test("successResponse - custom status", async () => {
  const res = successResponse({ created: true }, 201);
  assertEquals(res.status, 201);
});

Deno.test("withErrorHandler - catches AppError", async () => {
  // deno-lint-ignore require-await
  const handler = withErrorHandler(async () => {
    throw new AppError("NOT_FOUND", "Não encontrado");
  });
  const res = await handler(new Request("http://localhost"));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.code, "NOT_FOUND");
});

Deno.test({ name: "withErrorHandler - catches unknown error", sanitizeOps: false, sanitizeResources: false, fn: async () => {
  // deno-lint-ignore require-await
  const handler = withErrorHandler(async () => {
    throw new Error("unexpected");
  });
  const res = await handler(new Request("http://localhost"));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.code, "INTERNAL_ERROR");
}});

Deno.test("withErrorHandler - handles OPTIONS", async () => {
  // deno-lint-ignore require-await
  const handler = withErrorHandler(async () => successResponse({}));
  const res = await handler(new Request("http://localhost", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
});
