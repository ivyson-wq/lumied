// deno test supabase/functions/__tests__/tenant.test.ts
//
// Tenant isolation é crítico — o incidente de 16/04/2026 (vazamento
// visual demo→Maple) veio de fallback cego pra "primeira escola ativa".
// Esses testes cobrem:
//   - extractSlug (puro) — todos os edge cases de subdomínio
//   - extractHost (puro) — fallback Origin → Referer → Host
//   - resolveEscolaId (com mock Supabase) — chain de resolução
import { assertEquals } from "@std/testing/asserts";
import { extractSlug, extractHost, resolveEscolaId } from "../_shared/tenant.ts";

// ── extractSlug ───────────────────────────────────────────────
Deno.test("extractSlug: subdomínio de escola é capturado", () => {
  assertEquals(extractSlug("maplebearcaxias.lumied.com.br"), "maplebearcaxias");
  assertEquals(extractSlug("demo.lumied.com.br"), "demo");
  assertEquals(extractSlug("escola-teste.lumied.com.br"), "escola-teste");
});

Deno.test("extractSlug: landing retorna null", () => {
  assertEquals(extractSlug("lumied.com.br"), null);
  assertEquals(extractSlug("www.lumied.com.br"), null);
});

Deno.test("extractSlug: admin central retorna null", () => {
  assertEquals(extractSlug("admin.lumied.com.br"), null);
});

Deno.test("extractSlug: localhost e IPs retornam null", () => {
  assertEquals(extractSlug("localhost"), null);
  assertEquals(extractSlug("localhost:3000"), null);
  assertEquals(extractSlug("127.0.0.1"), null);
  assertEquals(extractSlug("192.168.1.1"), null);
});

Deno.test("extractSlug: domínios externos retornam null (segurança)", () => {
  assertEquals(extractSlug("evil.com"), null);
  assertEquals(extractSlug("lumied.evil.com"), null);
  // Homograph attack: alguém tenta `not.lumied.com.br.evil.com`
  assertEquals(extractSlug("not.lumied.com.br.evil.com"), null);
});

Deno.test("extractSlug: case insensitive", () => {
  assertEquals(extractSlug("MapleBearCaxias.Lumied.com.br"), "maplebearcaxias");
});

// ── extractHost ───────────────────────────────────────────────
function reqWith(headers: Record<string, string>): Request {
  return new Request("https://x.lumied.com.br/functions/v1/api", {
    method: "POST", headers,
  });
}

Deno.test("extractHost: Origin tem prioridade", () => {
  const r = reqWith({
    origin: "https://demo.lumied.com.br",
    referer: "https://other.lumied.com.br/page",
    host: "third.lumied.com.br",
  });
  assertEquals(extractHost(r), "demo.lumied.com.br");
});

Deno.test("extractHost: Referer como fallback sem Origin", () => {
  const r = reqWith({
    referer: "https://maple.lumied.com.br/pais/",
    host: "wrong.lumied.com.br",
  });
  assertEquals(extractHost(r), "maple.lumied.com.br");
});

Deno.test("extractHost: Host como último fallback", () => {
  const r = reqWith({ host: "demo.lumied.com.br:443" });
  assertEquals(extractHost(r), "demo.lumied.com.br");
});

Deno.test("extractHost: x-forwarded-host quando Host ausente", () => {
  const r = reqWith({ "x-forwarded-host": "proxied.lumied.com.br" });
  assertEquals(extractHost(r), "proxied.lumied.com.br");
});

Deno.test("extractHost: sem headers retorna null", () => {
  const r = reqWith({});
  assertEquals(extractHost(r), null);
});

// ── resolveEscolaId (mock supabase) ───────────────────────────
//
// SupabaseClient é tipado mas só usamos um subset. Mock minimal cobre
// .from(table).select(...).eq(...).maybeSingle() chain.

interface FakeRow { id?: string; escola_id?: string; expira_em?: string; gerentes?: { escola_id: string }; }

function mockSupabase(opts: {
  escolas?: Record<string, string>; // slug → id
  escolasAtivasIds?: string[];        // pra getEscolaPadrao (multi-tenant signal)
  gerenteSession?: { token: string; escola_id: string; expira_em: string };
}): unknown {
  // deno-lint-ignore no-explicit-any
  const sb: any = {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const q: any = { _table: table, _filters: {}, _limit: null };
      q.select = (..._cols: unknown[]) => q;
      q.eq = (col: string, val: unknown) => { q._filters[col] = val; return q; };
      q.limit = (n: number) => { q._limit = n; return q; };
      q.maybeSingle = async () => {
        if (table === "escolas") {
          const slug = q._filters["slug"];
          if (opts.escolas && slug && opts.escolas[slug as string]) {
            return { data: { id: opts.escolas[slug as string] }, error: null };
          }
          return { data: null, error: null };
        }
        if (table === "gerente_sessoes") {
          const token = q._filters["token"];
          if (opts.gerenteSession && token === opts.gerenteSession.token) {
            return {
              data: {
                expira_em: opts.gerenteSession.expira_em,
                gerentes: { escola_id: opts.gerenteSession.escola_id },
              } as FakeRow, error: null,
            };
          }
          return { data: null, error: null };
        }
        return { data: null, error: null };
      };
      // getEscolaPadrao chama .limit(2) e await direto na query (Thenable)
      q.then = (resolve: (r: { data: unknown; error: null }) => void) => {
        if (table === "escolas" && q._limit) {
          const ids = (opts.escolasAtivasIds ?? []).slice(0, q._limit).map((id) => ({ id }));
          resolve({ data: ids, error: null });
        } else {
          resolve({ data: [], error: null });
        }
      };
      return q;
    },
  };
  return sb;
}

Deno.test("resolveEscolaId: session.escola_id tem prioridade absoluta", async () => {
  const sb = mockSupabase({}) as Parameters<typeof resolveEscolaId>[1];
  const r = reqWith({ origin: "https://outra.lumied.com.br" });
  const id = await resolveEscolaId(r, sb, { escola_id: "from-session" });
  assertEquals(id, "from-session");
});

Deno.test("resolveEscolaId: token de gerente válido derruba origin", async () => {
  const sb = mockSupabase({
    gerenteSession: {
      token: "tok-gerente-123",
      escola_id: "escola-do-token",
      expira_em: new Date(Date.now() + 3600_000).toISOString(),
    },
    escolas: { outra: "escola-da-origin" },
  }) as Parameters<typeof resolveEscolaId>[1];
  const r = reqWith({ origin: "https://outra.lumied.com.br" });
  const id = await resolveEscolaId(r, sb, null, { _token: "tok-gerente-123" });
  assertEquals(id, "escola-do-token");
});

Deno.test("resolveEscolaId: sessão expirada ignora token, cai pra Origin", async () => {
  const sb = mockSupabase({
    gerenteSession: {
      token: "tok-velho",
      escola_id: "escola-velha",
      expira_em: new Date(Date.now() - 1000).toISOString(), // EXPIRADO
    },
    escolas: { demo: "id-demo" },
  }) as Parameters<typeof resolveEscolaId>[1];
  const r = reqWith({ origin: "https://demo.lumied.com.br" });
  const id = await resolveEscolaId(r, sb, null, { _token: "tok-velho" });
  assertEquals(id, "id-demo");
});

Deno.test("resolveEscolaId: sem sessão nem token, usa Origin → escola.slug", async () => {
  const sb = mockSupabase({
    escolas: { maplebearcaxias: "id-mbcaxias" },
  }) as Parameters<typeof resolveEscolaId>[1];
  const r = reqWith({ origin: "https://maplebearcaxias.lumied.com.br" });
  const id = await resolveEscolaId(r, sb);
  assertEquals(id, "id-mbcaxias");
});

Deno.test("resolveEscolaId: multi-tenant + escola desconhecida retorna null (regressão incidente 16/04)", async () => {
  // Cenário: token inválido, origin de escola que não existe, getEscolaPadrao
  // retorna null porque tem >1 escola ativa. Resultado: null (não vaza).
  const sb = mockSupabase({
    escolas: {},
    escolasAtivasIds: ["escola-a", "escola-b"], // multi-tenant
  }) as Parameters<typeof resolveEscolaId>[1];
  const r = reqWith({ origin: "https://escola-fantasma.lumied.com.br" });
  const id = await resolveEscolaId(r, sb);
  // Não cai em fallback cego — DEVE ser null porque há >1 escola ativa
  assertEquals(id, null);
});

Deno.test("resolveEscolaId: single-tenant legacy retorna a única escola ativa", async () => {
  // Cenário compatibilidade: 1 escola ativa, sem session/token/origin válido.
  const sb = mockSupabase({
    escolas: {},
    escolasAtivasIds: ["escola-unica"],
  }) as Parameters<typeof resolveEscolaId>[1];
  const r = reqWith({});
  const id = await resolveEscolaId(r, sb);
  assertEquals(id, "escola-unica");
});
