// deno test supabase/functions/__tests__/webauthn.test.ts
//
// WebAuthn cobre Face ID / Touch ID dos portais. Esses testes garantem
// que as primitives (b64url, challenge, parsers) funcionam — verificação
// criptográfica end-to-end fica pra integration teste com fixtures reais.
import { assertEquals, assertNotEquals, assertThrows } from "@std/testing/asserts";
import {
  b64urlEncode, b64urlDecode,
  generateChallenge,
  parseClientDataJSON,
  parseAuthData,
} from "../_shared/webauthn.ts";

// ── b64url roundtrip ──────────────────────────────────────────
Deno.test("b64url - encode/decode roundtrip ASCII", () => {
  const original = new TextEncoder().encode("hello world");
  const encoded = b64urlEncode(original);
  const decoded = b64urlDecode(encoded);
  assertEquals(new TextDecoder().decode(decoded), "hello world");
});

Deno.test("b64url - encode usa - e _ em vez de + e /", () => {
  // bytes que produzem + e / em base64 padrão: 0xfb, 0xff (→ "+/8" típico)
  const bytes = new Uint8Array([0xfb, 0xff, 0xbe]);
  const encoded = b64urlEncode(bytes);
  assertEquals(encoded.includes("+"), false);
  assertEquals(encoded.includes("/"), false);
  assertEquals(encoded.includes("="), false); // padding removido
});

Deno.test("b64url - decode aceita string sem padding", () => {
  const bytes = b64urlDecode("aGVsbG8"); // "hello" sem padding
  assertEquals(new TextDecoder().decode(bytes), "hello");
});

Deno.test("b64url - decode aceita string com - e _", () => {
  const bytes = new Uint8Array([0xfb, 0xff, 0xbe]);
  const url = b64urlEncode(bytes);
  const back = b64urlDecode(url);
  assertEquals(Array.from(back), Array.from(bytes));
});

// ── Challenge ──────────────────────────────────────────────────
Deno.test("generateChallenge - retorna 32 bytes codificados em b64url", () => {
  const c = generateChallenge();
  assertEquals(typeof c, "string");
  // 32 bytes em base64url sem padding = 43 caracteres
  assertEquals(c.length, 43);
  // Não contém caracteres padding/standard
  assertEquals(c.includes("="), false);
  assertEquals(c.includes("+"), false);
  assertEquals(c.includes("/"), false);
});

Deno.test("generateChallenge - produz valores únicos (entropia)", () => {
  const a = generateChallenge();
  const b = generateChallenge();
  const c = generateChallenge();
  assertNotEquals(a, b);
  assertNotEquals(b, c);
  assertNotEquals(a, c);
});

// ── parseClientDataJSON ───────────────────────────────────────
Deno.test("parseClientDataJSON - decodifica payload válido", () => {
  const payload = { type: "webauthn.create", challenge: "abc123", origin: "https://lumied.com.br" };
  const json = JSON.stringify(payload);
  const b64 = b64urlEncode(new TextEncoder().encode(json));
  const parsed = parseClientDataJSON(b64);
  assertEquals(parsed.type, "webauthn.create");
  assertEquals(parsed.challenge, "abc123");
  assertEquals(parsed.origin, "https://lumied.com.br");
});

Deno.test("parseClientDataJSON - lança em JSON inválido", () => {
  const b64 = b64urlEncode(new TextEncoder().encode("not json {"));
  assertThrows(() => parseClientDataJSON(b64));
});

// ── parseAuthData ─────────────────────────────────────────────
Deno.test("parseAuthData - extrai rpIdHash, flags, signCount", () => {
  // Constrói authData mínimo:
  //   32 bytes rpIdHash (zeros) + 1 byte flags + 4 bytes signCount BE
  const buf = new Uint8Array(37);
  for (let i = 0; i < 32; i++) buf[i] = 0;            // rpIdHash zerado
  buf[32] = 0x05;                                      // flags: UP=1, UV=1
  buf[33] = 0x00; buf[34] = 0x00; buf[35] = 0x01; buf[36] = 0x2a; // signCount = 298

  const a = parseAuthData(buf);
  assertEquals(a.rpIdHash.length, 32);
  assertEquals(a.flags, 0x05);
  assertEquals(a.userPresent, true);
  assertEquals(a.userVerified, true);
  assertEquals(a.signCount, 298);
  assertEquals(a.attestedCredData, undefined); // flag AT (0x40) não setada
});

Deno.test("parseAuthData - userPresent=false quando UP=0", () => {
  const buf = new Uint8Array(37);
  buf[32] = 0x04; // só UV=1, UP=0
  const a = parseAuthData(buf);
  assertEquals(a.userPresent, false);
  assertEquals(a.userVerified, true);
});

Deno.test("parseAuthData - userVerified=false quando UV=0", () => {
  const buf = new Uint8Array(37);
  buf[32] = 0x01; // só UP=1
  const a = parseAuthData(buf);
  assertEquals(a.userPresent, true);
  assertEquals(a.userVerified, false);
});

Deno.test("parseAuthData - lê attestedCredData quando AT flag setada", () => {
  // 32 rpIdHash + 1 flags(0x41=UP+AT) + 4 signCount + 16 AAGUID + 2 credIdLen + credId + pubKey
  const credId = new Uint8Array([1, 2, 3, 4]);
  const pubKey = new Uint8Array([0xa5, 0x01, 0x02]); // CBOR map start (fake)
  const buf = new Uint8Array(32 + 1 + 4 + 16 + 2 + credId.length + pubKey.length);
  buf[32] = 0x41; // UP + AT
  buf[33] = 0x00; buf[34] = 0x00; buf[35] = 0x00; buf[36] = 0x05; // signCount=5
  // AAGUID 37..52
  // credIdLen at 53,54
  buf[53] = 0x00; buf[54] = credId.length;
  // credId at 55+
  buf.set(credId, 55);
  buf.set(pubKey, 55 + credId.length);

  const a = parseAuthData(buf);
  assertEquals(a.flags, 0x41);
  assertEquals(a.signCount, 5);
  assertEquals(a.attestedCredData?.credentialId.length, 4);
  assertEquals(Array.from(a.attestedCredData!.credentialId), [1, 2, 3, 4]);
});
