// deno test supabase/functions/__tests__/bank-webhook.test.ts
//
// Cobertura do resolveBancoConfigForWebhook — função crítica que substituiu
// o fallback "1ª config ativa" pós checkup 2026-05-15 (anti-padrão do
// incidente de tenant isolation 16/04/2026).

import { assertEquals } from "@std/testing/asserts";

import { resolveBancoConfigForWebhook } from "../_shared/banks/config.ts";
import type { BancoConfig } from "../_shared/banks/types.ts";

const ESCOLA_A = "11111111-1111-1111-1111-111111111111";
const ESCOLA_B = "22222222-2222-2222-2222-222222222222";

function makeConfig(escolaId: string, cnpj: string, banco = "inter"): BancoConfig {
  return {
    id: `cfg-${escolaId.slice(0, 8)}`,
    escola_id: escolaId,
    banco: banco as BancoConfig["banco"],
    agencia: "0001",
    conta: "12345",
    conta_digito: "9",
    convenio: "1234567",
    carteira: "09",
    beneficiario_cnpj: cnpj,
    beneficiario_nome: "Escola Teste LTDA",
    homologado: false,
  };
}

// Mock supabase client com `from(table).select(...).eq(col,val).maybeSingle()`
// para getBancoConfigByCnpj e `.select('*',{count:'exact'}).eq(...).eq(...)` (await direto).
function mockSb(configs: BancoConfig[]) {
  return {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const q: any = { _table: table, _filters: {} as Record<string, unknown>, _wantCount: false };
      q.select = (_cols: unknown, opts?: { count?: string }) => {
        if (opts && opts.count === "exact") q._wantCount = true;
        return q;
      };
      q.eq = (col: string, val: unknown) => { q._filters[col] = val; return q; };
      q.maybeSingle = () => {
        // getBancoConfigByCnpj: filtra por banco + cnpj + ativo
        if (table === "escola_banco_config") {
          const banco = q._filters["banco"];
          const cnpj = q._filters["beneficiario_cnpj"];
          const match = configs.find(c => c.banco === banco && c.beneficiario_cnpj === cnpj);
          return Promise.resolve({ data: match ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      // Await direto (sem maybeSingle): retorna lista filtrada + count
      q.then = (resolve: (r: { data: BancoConfig[]; count: number; error: null }) => void) => {
        const banco = q._filters["banco"];
        const filtered = configs.filter(c => c.banco === banco && (q._filters["ativo"] !== false));
        resolve({ data: filtered, count: filtered.length, error: null });
      };
      return q;
    },
  };
}

// ═══════════════════════════════════════════════════════════════
//  Happy path: CNPJ bate
// ═══════════════════════════════════════════════════════════════

Deno.test("resolve: CNPJ bate config → via='cnpj'", async () => {
  const sb = mockSb([makeConfig(ESCOLA_A, "12345678000190")]);
  const r = await resolveBancoConfigForWebhook(sb, "inter", "12345678000190");
  assertEquals(r.config?.escola_id, ESCOLA_A);
  if (r.config) assertEquals((r as { via: string }).via, "cnpj");
});

Deno.test("resolve: CNPJ bate em multi-tenant retorna escola certa", async () => {
  const sb = mockSb([
    makeConfig(ESCOLA_A, "12345678000190"),
    makeConfig(ESCOLA_B, "98765432000111"),
  ]);
  const r = await resolveBancoConfigForWebhook(sb, "inter", "98765432000111");
  assertEquals(r.config?.escola_id, ESCOLA_B);
});

// ═══════════════════════════════════════════════════════════════
//  Fallback single-tenant: aceito quando 1 config ativa
// ═══════════════════════════════════════════════════════════════

Deno.test("resolve: sem CNPJ + 1 config ativa → via='single_tenant_fallback'", async () => {
  const sb = mockSb([makeConfig(ESCOLA_A, "12345678000190")]);
  const r = await resolveBancoConfigForWebhook(sb, "inter", null);
  assertEquals(r.config?.escola_id, ESCOLA_A);
  if (r.config) assertEquals((r as { via: string }).via, "single_tenant_fallback");
});

Deno.test("resolve: CNPJ não bate + 1 config ativa → fallback single-tenant", async () => {
  const sb = mockSb([makeConfig(ESCOLA_A, "12345678000190")]);
  const r = await resolveBancoConfigForWebhook(sb, "inter", "00000000000000");
  assertEquals(r.config?.escola_id, ESCOLA_A);
  if (r.config) assertEquals((r as { via: string }).via, "single_tenant_fallback");
});

// ═══════════════════════════════════════════════════════════════
//  Multi-tenant: RECUSA quando CNPJ ausente ou não bate
//  Este é o cenário regressivo do incidente 16/04/2026
// ═══════════════════════════════════════════════════════════════

Deno.test("resolve: sem CNPJ + 2 configs ativas → recusa (multi_tenant_no_cnpj)", async () => {
  const sb = mockSb([
    makeConfig(ESCOLA_A, "12345678000190"),
    makeConfig(ESCOLA_B, "98765432000111"),
  ]);
  const r = await resolveBancoConfigForWebhook(sb, "inter", null);
  assertEquals(r.config, null);
  if (!r.config) assertEquals(r.reason, "multi_tenant_no_cnpj");
});

Deno.test("resolve: CNPJ não bate + 2 configs ativas → recusa, NÃO pega a primeira", async () => {
  const sb = mockSb([
    makeConfig(ESCOLA_A, "12345678000190"),
    makeConfig(ESCOLA_B, "98765432000111"),
  ]);
  const r = await resolveBancoConfigForWebhook(sb, "inter", "00000000000000");
  assertEquals(r.config, null);
  if (!r.config) assertEquals(r.reason, "multi_tenant_no_cnpj");
});

// ═══════════════════════════════════════════════════════════════
//  Zero configs: 404 (escola não configurada)
// ═══════════════════════════════════════════════════════════════

Deno.test("resolve: zero configs ativas → reason='no_config'", async () => {
  const sb = mockSb([]);
  const r = await resolveBancoConfigForWebhook(sb, "inter", "12345678000190");
  assertEquals(r.config, null);
  if (!r.config) assertEquals(r.reason, "no_config");
});

Deno.test("resolve: configs de OUTRO banco não afetam → reason='no_config'", async () => {
  const sb = mockSb([makeConfig(ESCOLA_A, "12345678000190", "sicredi")]);
  const r = await resolveBancoConfigForWebhook(sb, "inter", "12345678000190");
  assertEquals(r.config, null);
  if (!r.config) assertEquals(r.reason, "no_config");
});
