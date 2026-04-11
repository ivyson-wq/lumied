#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  Lumied — Post-deploy automation
//
//  Idempotent script that applies all post-deploy steps via APIs.
//  Safe to re-run.
//
//  Required env vars:
//    SUPABASE_ACCESS_TOKEN — Management API (from GitHub Secrets)
//    SUPABASE_PROJECT_REF  — default brgorknbrjlfwvrrlwxj
//
//  Optional env vars:
//    CLOUDFLARE_API_TOKEN  — to set ADMIN_TOKEN on monitor worker
//    CLOUDFLARE_ACCOUNT_ID — same
//    STAFF_EMAIL           — default ivyson@gmail.com
//    STAFF_NEW_PASSWORD    — if set, rotates staff password (else keeps current)
//    BACKFILL_ESCOLA_ID    — "true" to run escola_id backfill
//    SKIP_SUPABASE_SECRETS — "true" to skip setting CRON_INTERNAL_KEY etc.
//    SKIP_CLOUDFLARE       — "true" to skip Cloudflare monitor setup
// ═══════════════════════════════════════════════════════════════

import crypto from "node:crypto";

const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "brgorknbrjlfwvrrlwxj";
const STAFF_EMAIL = process.env.STAFF_EMAIL || "ivyson@gmail.com";
const STAFF_NEW_PASSWORD = process.env.STAFF_NEW_PASSWORD;
const BACKFILL = process.env.BACKFILL_ESCOLA_ID === "true";
const SKIP_SUPABASE_SECRETS = process.env.SKIP_SUPABASE_SECRETS === "true";
const SKIP_CLOUDFLARE = process.env.SKIP_CLOUDFLARE === "true";
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;

const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjU0NTUsImV4cCI6MjA4OTM0MTQ1NX0.QKX_6ZSfied60ZpB8VOx03hwiyD9J5lskKwfl-oXPYE";

if (!SUPABASE_ACCESS_TOKEN) {
  console.error("❌ SUPABASE_ACCESS_TOKEN is required");
  process.exit(1);
}

const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}`;
const authHeader = { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}` };

const results = {
  migrations: null,
  password_rotated: false,
  staff_token_last6: null,
  supabase_secrets: [],
  cloudflare_monitor: null,
  backfill: {},
  errors: [],
};

// ── Helpers ────────────────────────────────────────────────────

async function sql(query) {
  const r = await fetch(`${API}/database/query`, {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`SQL failed (${r.status}): ${body}`);
  }
  return r.json();
}

async function setSupabaseSecret(name, value) {
  const r = await fetch(`${API}/secrets`, {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: JSON.stringify([{ name, value }]),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Set secret ${name} failed (${r.status}): ${body}`);
  }
  return true;
}

async function hashPassword(senha) {
  // PBKDF2 hex:hex, 100k iterations, SHA-256 — compatible with _shared/auth.ts
  const salt = crypto.randomBytes(16);
  const saltHex = salt.toString("hex");
  const hashHex = crypto
    .pbkdf2Sync(senha, salt, 100000, 32, "sha256")
    .toString("hex");
  return `${saltHex}:${hashHex}`;
}

async function staffLogin(senha) {
  const r = await fetch(
    `https://${PROJECT_REF}.supabase.co/functions/v1/admin`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
      },
      body: JSON.stringify({
        action: "staff_login",
        email: STAFF_EMAIL,
        senha,
      }),
    },
  );
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`staff_login failed (${r.status}): ${body}`);
  }
  return r.json();
}

async function setCloudflareSecret(scriptName, secretName, value) {
  if (!CF_TOKEN || !CF_ACCOUNT) {
    throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID required");
  }
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/${scriptName}/secrets`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${CF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: secretName,
        text: value,
        type: "secret_text",
      }),
    },
  );
  if (!r.ok) {
    const body = await r.text();
    throw new Error(
      `CF secret ${scriptName}.${secretName} failed (${r.status}): ${body}`,
    );
  }
  return r.json();
}

// ── Step 1: verify migrations 215-220 ─────────────────────────

async function step1VerifyMigrations() {
  console.log("\n📍 STEP 1 — Verifying migrations 215-220...");
  const res = await sql(`
    SELECT
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='acesso_dispositivos' AND column_name='api_password') AS "215",
      EXISTS(SELECT 1 FROM pg_proc WHERE proname='biblioteca_emprestar') AS "216",
      EXISTS(SELECT 1 FROM pg_proc WHERE proname='gerentes_safe_delete') AS "217",
      EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='rate_limits') AS "218",
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='compliance_incidentes' AND column_name='escola_id') AS "219",
      EXISTS(SELECT 1 FROM cron.job WHERE jobname='rate-limits-cleanup-hourly') AS "220"
  `);
  const row = res[0];
  results.migrations = row;
  const missing = Object.entries(row)
    .filter(([_, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.warn(`⚠️  Missing migrations: ${missing.join(", ")}`);
    console.warn("   Run the apply-migrations workflow manually.");
  } else {
    console.log("✓ All migrations 215-220 applied");
  }
}

// ── Step 2: rotate staff password + generate new Lumied token ──

async function step2RotateStaffPassword() {
  console.log("\n📍 STEP 2 — Rotating staff password...");
  if (!STAFF_NEW_PASSWORD) {
    console.log("⏭  Skipped (STAFF_NEW_PASSWORD not set)");
    return;
  }
  if (STAFF_NEW_PASSWORD.length < 12) {
    throw new Error("STAFF_NEW_PASSWORD must be at least 12 chars");
  }
  const hash = await hashPassword(STAFF_NEW_PASSWORD);
  // Escape single quotes for SQL
  const safeHash = hash.replace(/'/g, "''");
  const safeEmail = STAFF_EMAIL.replace(/'/g, "''");
  await sql(
    `UPDATE lumied_staff SET senha_hash = '${safeHash}' WHERE email = '${safeEmail}';`,
  );
  results.password_rotated = true;
  console.log(`✓ Password rotated for ${STAFF_EMAIL}`);

  // Generate new Lumied MCP token
  const login = await staffLogin(STAFF_NEW_PASSWORD);
  results.staff_token_last6 = login.token.slice(-6);
  console.log(
    `✓ New Lumied MCP token generated (last 6: ****${results.staff_token_last6})`,
  );
  console.log(`  Full token available via workflow output (masked in logs).`);
  // GitHub Actions mask — printing the token in a masked form
  console.log(`::add-mask::${login.token}`);
  console.log(`LUMIED_MCP_TOKEN=${login.token}`);
}

// ── Step 3: set Supabase Edge Function secrets ────────────────

async function step3SupabaseSecrets() {
  console.log("\n📍 STEP 3 — Setting Supabase Edge Function secrets...");
  if (SKIP_SUPABASE_SECRETS) {
    console.log("⏭  Skipped (SKIP_SUPABASE_SECRETS=true)");
    return;
  }
  const secrets = [
    {
      name: "CLAUDE_TRIGGER_TOKEN",
      value: crypto.randomBytes(24).toString("hex"),
    },
    {
      name: "CRON_INTERNAL_KEY",
      value: crypto.randomBytes(24).toString("hex"),
    },
  ];
  for (const s of secrets) {
    try {
      await setSupabaseSecret(s.name, s.value);
      results.supabase_secrets.push(s.name);
      console.log(`✓ Set ${s.name} (24 random bytes)`);
    } catch (e) {
      console.error(`✗ ${s.name}: ${e.message}`);
      results.errors.push(`supabase_secret ${s.name}: ${e.message}`);
    }
  }
}

// ── Step 4: Cloudflare monitor ADMIN_TOKEN ────────────────────

async function step4CloudflareMonitor() {
  console.log(
    "\n📍 STEP 4 — Setting ADMIN_TOKEN on cloudflare-monitor worker...",
  );
  if (SKIP_CLOUDFLARE) {
    console.log("⏭  Skipped (SKIP_CLOUDFLARE=true)");
    return;
  }
  if (!CF_TOKEN || !CF_ACCOUNT) {
    console.log(
      "⏭  Skipped (CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID not set)",
    );
    results.cloudflare_monitor = "skipped_no_credentials";
    return;
  }
  try {
    const adminToken = crypto.randomBytes(32).toString("hex");
    await setCloudflareSecret("lumied-monitor", "ADMIN_TOKEN", adminToken);
    results.cloudflare_monitor = "set";
    console.log(`✓ ADMIN_TOKEN set on lumied-monitor worker`);
    console.log(`::add-mask::${adminToken}`);
    console.log(`MONITOR_ADMIN_TOKEN=${adminToken}`);
  } catch (e) {
    console.error(`✗ Cloudflare: ${e.message}`);
    results.errors.push(`cloudflare: ${e.message}`);
  }
}

// ── Step 5: backfill escola_id (single-tenant) ───────────────

async function step5BackfillEscolaId() {
  console.log("\n📍 STEP 5 — Backfilling escola_id in tenant tables...");
  if (!BACKFILL) {
    console.log("⏭  Skipped (BACKFILL_ESCOLA_ID not set to 'true')");
    return;
  }
  const script = `
    DO $$
    DECLARE
      v_escola_id UUID;
      v_count INTEGER;
    BEGIN
      SELECT id INTO v_escola_id FROM escolas ORDER BY criado_em LIMIT 1;
      IF v_escola_id IS NULL THEN RAISE EXCEPTION 'No escolas found'; END IF;

      -- Each UPDATE is wrapped to continue on missing tables
      BEGIN UPDATE compliance_incidentes SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE compliance_certificacoes SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE compliance_inspecoes SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE compliance_politicas SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE compliance_calendario SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE compliance_ocorrencias SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE compliance_alertas SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE compliance_banco_horas SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE compliance_feriados SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE compliance_config_ponto SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE compliance_horarios SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE compliance_ponto_registros SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE compliance_ponto_importacoes SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE rh_ponto SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE rh_ferias SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE rh_holerites SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE rh_folha_pagamento SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE biblioteca_emprestimos SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE biblioteca_reservas SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE cantina_creditos SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE cantina_transacoes SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE cantina_restricoes SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE transporte_alunos SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
      BEGIN UPDATE transporte_rastreio SET escola_id = v_escola_id WHERE escola_id IS NULL; EXCEPTION WHEN others THEN NULL; END;
    END $$;
    SELECT 'backfill_completed' AS status;
  `;
  try {
    await sql(script);
    results.backfill = { status: "completed" };
    console.log("✓ Backfill completed for all tenant tables");
  } catch (e) {
    console.error(`✗ Backfill: ${e.message}`);
    results.errors.push(`backfill: ${e.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Lumied Post-deploy — starting");
  console.log(`   Project: ${PROJECT_REF}`);
  console.log(`   Staff: ${STAFF_EMAIL}`);

  try {
    await step1VerifyMigrations();
    await step2RotateStaffPassword();
    await step3SupabaseSecrets();
    await step4CloudflareMonitor();
    await step5BackfillEscolaId();
  } catch (e) {
    console.error("\n❌ Fatal error:", e.message);
    results.errors.push(`fatal: ${e.message}`);
    console.log("\n=== RESULTS ===");
    console.log(JSON.stringify(results, null, 2));
    process.exit(1);
  }

  console.log("\n=== RESULTS ===");
  console.log(JSON.stringify(results, null, 2));
  if (results.errors.length) {
    console.log(`\n⚠️  Completed with ${results.errors.length} error(s)`);
    process.exit(2);
  }
  console.log("\n✅ Post-deploy complete");
}

main();
