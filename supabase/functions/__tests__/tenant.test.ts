import { assertEquals } from "@std/testing/asserts";

// Test the slug extraction logic from tenant.ts
// We can't test the full resolveEscolaId without a DB, but we CAN test the parsing logic

// Replicate the extractSlug function from tenant.ts
function extractSlug(host: string): string | null {
  const h = host.toLowerCase();
  if (h === "lumied.com.br" || h === "www.lumied.com.br") return null;
  if (h === "admin.lumied.com.br") return null;
  if (h.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+/.test(h)) return null;
  const m = h.match(/^([a-z0-9-]+)\.lumied\.com\.br$/);
  if (m) return m[1];
  return null;
}

Deno.test("extractSlug: escola subdomain", () => {
  assertEquals(extractSlug("maplebearcaxias.lumied.com.br"), "maplebearcaxias");
  assertEquals(extractSlug("demo.lumied.com.br"), "demo");
  assertEquals(extractSlug("escola-teste.lumied.com.br"), "escola-teste");
});

Deno.test("extractSlug: landing page returns null", () => {
  assertEquals(extractSlug("lumied.com.br"), null);
  assertEquals(extractSlug("www.lumied.com.br"), null);
});

Deno.test("extractSlug: admin returns null", () => {
  assertEquals(extractSlug("admin.lumied.com.br"), null);
});

Deno.test("extractSlug: localhost returns null", () => {
  assertEquals(extractSlug("localhost"), null);
  assertEquals(extractSlug("localhost:3000"), null);
  assertEquals(extractSlug("127.0.0.1"), null);
  assertEquals(extractSlug("192.168.1.1"), null);
});

Deno.test("extractSlug: non-lumied domains return null", () => {
  assertEquals(extractSlug("evil.com"), null);
  assertEquals(extractSlug("lumied.evil.com"), null);
  assertEquals(extractSlug("not.lumied.com.br.evil.com"), null);
});

Deno.test("extractSlug: case insensitive", () => {
  assertEquals(extractSlug("MapleBearCaxias.Lumied.com.br"), "maplebearcaxias");
});
