import { assertEquals } from "@std/testing/asserts";
import { getCorsHeaders } from "../_shared/cors.ts";

Deno.test("getCorsHeaders returns default origin without request", () => {
  const h = getCorsHeaders();
  assertEquals(h["Access-Control-Allow-Origin"], "https://app.maplebearcaxiasdosul.com.br");
  assertEquals(h["Access-Control-Allow-Methods"], "POST, OPTIONS");
  assertEquals(h["Content-Type"], "application/json");
});

Deno.test("getCorsHeaders allows listed origins", () => {
  const origins = [
    "https://lumied.com.br",
    "http://localhost:3000",
    "https://maple-bear-rs.vercel.app",
  ];
  for (const origin of origins) {
    const req = new Request("http://localhost", { headers: { origin } });
    const h = getCorsHeaders(req);
    assertEquals(h["Access-Control-Allow-Origin"], origin, `Should allow ${origin}`);
  }
});

Deno.test("getCorsHeaders allows *.lumied.com.br subdomains", () => {
  const subs = ["maplebearcaxias.lumied.com.br", "demo.lumied.com.br", "escolax.lumied.com.br"];
  for (const sub of subs) {
    const req = new Request("http://localhost", { headers: { origin: `https://${sub}` } });
    const h = getCorsHeaders(req);
    assertEquals(h["Access-Control-Allow-Origin"], `https://${sub}`, `Should allow ${sub}`);
  }
});

Deno.test("getCorsHeaders rejects unknown origins", () => {
  const bad = ["https://evil.com", "https://notlumied.com.br", "https://lumied.com.br.evil.com"];
  for (const origin of bad) {
    const req = new Request("http://localhost", { headers: { origin } });
    const h = getCorsHeaders(req);
    assertEquals(h["Access-Control-Allow-Origin"] !== origin, true, `Should NOT allow ${origin}`);
  }
});

Deno.test("getCorsHeaders allows Vercel preview deploys for this project", () => {
  const req = new Request("http://localhost", { headers: { origin: "https://maple-bear-rs-abc123.vercel.app" } });
  const h = getCorsHeaders(req);
  assertEquals(h["Access-Control-Allow-Origin"], "https://maple-bear-rs-abc123.vercel.app");
});

Deno.test("getCorsHeaders blocks Vercel deploys from other projects", () => {
  const req = new Request("http://localhost", { headers: { origin: "https://evil-project.vercel.app" } });
  const h = getCorsHeaders(req);
  assertEquals(h["Access-Control-Allow-Origin"] !== "https://evil-project.vercel.app", true);
});
