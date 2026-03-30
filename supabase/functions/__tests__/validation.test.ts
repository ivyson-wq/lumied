// deno test supabase/functions/__tests__/validation.test.ts
import { assertEquals } from "@std/testing/asserts";
import { validate, sanitize, sanitizeBody, loginSchema } from "../_shared/validation.ts";

Deno.test("validate - required field missing", () => {
  const errors = validate({}, { nome: { required: true } });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "REQUIRED");
  assertEquals(errors[0].field, "nome");
});

Deno.test("validate - required field present", () => {
  const errors = validate({ nome: "Ana" }, { nome: { required: true } });
  assertEquals(errors.length, 0);
});

Deno.test("validate - email format valid", () => {
  const errors = validate({ email: "ana@escola.com" }, { email: { type: "email" } });
  assertEquals(errors.length, 0);
});

Deno.test("validate - email format invalid", () => {
  const errors = validate({ email: "not-email" }, { email: { type: "email" } });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "INVALID_EMAIL");
});

Deno.test("validate - uuid valid", () => {
  const errors = validate({ id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }, { id: { type: "uuid" } });
  assertEquals(errors.length, 0);
});

Deno.test("validate - uuid invalid", () => {
  const errors = validate({ id: "not-a-uuid" }, { id: { type: "uuid" } });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "INVALID_UUID");
});

Deno.test("validate - string minLength", () => {
  const errors = validate({ senha: "abc" }, { senha: { type: "string", minLength: 6 } });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "TOO_SHORT");
});

Deno.test("validate - string maxLength", () => {
  const errors = validate({ nome: "a".repeat(300) }, { nome: { type: "string", maxLength: 255 } });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "TOO_LONG");
});

Deno.test("validate - number range valid", () => {
  const errors = validate({ nota: 8.5 }, { nota: { type: "number", min: 0, max: 10 } });
  assertEquals(errors.length, 0);
});

Deno.test("validate - number too low", () => {
  const errors = validate({ nota: -1 }, { nota: { type: "number", min: 0 } });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "TOO_LOW");
});

Deno.test("validate - number too high", () => {
  const errors = validate({ nota: 15 }, { nota: { type: "number", max: 10 } });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "TOO_HIGH");
});

Deno.test("validate - enum valid", () => {
  const errors = validate({ status: "aprovado" }, { status: { enum: ["aprovado", "reprovado", "recuperacao"] } });
  assertEquals(errors.length, 0);
});

Deno.test("validate - enum invalid", () => {
  const errors = validate({ status: "invalido" }, { status: { enum: ["aprovado", "reprovado"] } });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "INVALID_ENUM");
});

Deno.test("validate - date valid", () => {
  const errors = validate({ data: "2026-03-29" }, { data: { type: "date" } });
  assertEquals(errors.length, 0);
});

Deno.test("validate - date invalid", () => {
  const errors = validate({ data: "29/03/2026" }, { data: { type: "date" } });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].code, "INVALID_DATE");
});

Deno.test("validate - optional field skipped when empty", () => {
  const errors = validate({}, { nome: { type: "string", minLength: 3 } });
  assertEquals(errors.length, 0);
});

Deno.test("validate - loginSchema valid", () => {
  const errors = validate({ email: "ana@escola.com", senha: "123456" }, loginSchema);
  assertEquals(errors.length, 0);
});

Deno.test("validate - loginSchema missing fields", () => {
  const errors = validate({}, loginSchema);
  assertEquals(errors.length, 2);
});

Deno.test("validate - loginSchema short password", () => {
  const errors = validate({ email: "ana@escola.com", senha: "123" }, loginSchema);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "senha");
});

Deno.test("validate - array type", () => {
  const errors = validate({ itens: [1, 2, 3] }, { itens: { type: "array" } });
  assertEquals(errors.length, 0);
});

Deno.test("validate - array type invalid", () => {
  const errors = validate({ itens: "not array" }, { itens: { type: "array" } });
  assertEquals(errors.length, 1);
});

// ═══ Sanitize tests ═══

Deno.test("sanitize - escapes HTML", () => {
  assertEquals(sanitize('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
});

Deno.test("sanitize - trims whitespace", () => {
  assertEquals(sanitize("  hello  "), "hello");
});

Deno.test("sanitize - escapes quotes", () => {
  assertEquals(sanitize("it's \"here\""), "it&#39;s &quot;here&quot;");
});

Deno.test("sanitizeBody - sanitizes strings, skips system fields", () => {
  const result = sanitizeBody({
    action: "test",
    _token: "abc123",
    nome: "<b>Bold</b>",
    valor: 42,
  });
  assertEquals(result.action, "test");
  assertEquals(result._token, "abc123");
  assertEquals(result.nome, "&lt;b&gt;Bold&lt;/b&gt;");
  assertEquals(result.valor, 42);
});
