import { assertEquals, assertNotEquals } from "@std/testing/asserts";
import { hashSenha, verificarSenhaAuto, hashSenhaV1, gerarToken } from "../_shared/auth.ts";

Deno.test("hashSenha produces salt:hash hex format", async () => {
  const hash = await hashSenha("test123");
  const parts = hash.split(":");
  assertEquals(parts.length, 2, "Should have salt:hash format");
  assertEquals(parts[0].length, 32, "Salt should be 32 hex chars (16 bytes)");
  assertEquals(parts[1].length, 64, "Hash should be 64 hex chars (32 bytes)");
});

Deno.test("hashSenha produces different hashes for same password (random salt)", async () => {
  const h1 = await hashSenha("test123");
  const h2 = await hashSenha("test123");
  assertNotEquals(h1, h2, "Hashes should differ due to random salt");
});

Deno.test("verificarSenhaAuto verifies hex format correctly", async () => {
  const hash = await hashSenha("minhasenha");
  const valid = await verificarSenhaAuto("minhasenha", hash);
  assertEquals(valid, true, "Should verify correct password");
  const invalid = await verificarSenhaAuto("senhaerrada", hash);
  assertEquals(invalid, false, "Should reject wrong password");
});

Deno.test("verificarSenhaAuto verifies v1 base64 format", async () => {
  const hash = await hashSenhaV1("senhalegada");
  assertEquals(hash.startsWith("v1:"), true, "V1 hash should start with v1:");
  const valid = await verificarSenhaAuto("senhalegada", hash);
  assertEquals(valid, true, "Should verify v1 password");
  const invalid = await verificarSenhaAuto("outra", hash);
  assertEquals(invalid, false, "Should reject wrong v1 password");
});

Deno.test("verificarSenhaAuto returns false for garbage input", async () => {
  assertEquals(await verificarSenhaAuto("test", ""), false);
  assertEquals(await verificarSenhaAuto("test", "notahash"), false);
  assertEquals(await verificarSenhaAuto("test", "abc:def"), false);
});

Deno.test("gerarToken produces 64 hex chars", () => {
  const token = gerarToken();
  assertEquals(token.length, 64, "Token should be 64 hex chars");
  assertEquals(/^[0-9a-f]+$/.test(token), true, "Token should be lowercase hex");
});

Deno.test("gerarToken produces unique tokens", () => {
  const t1 = gerarToken();
  const t2 = gerarToken();
  assertNotEquals(t1, t2, "Tokens should be unique");
});
