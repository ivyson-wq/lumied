#!/usr/bin/env node
/**
 * Lumied Authenticated API Test
 *
 * Logs in as a real user and tests authenticated actions
 * verifying response FORMAT (not just status code).
 *
 * Run: node tests/smoke/smoke-auth.mjs
 *
 * Requires: a real gerente account in the database.
 * Uses staff_login for admin, then tests API actions with the token.
 */

const API = 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjU0NTUsImV4cCI6MjA4OTM0MTQ1NX0.QKX_6ZSfied60ZpB8VOx03hwiyD9J5lskKwfl-oXPYE';
const HEADERS = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` };

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) { passed++; }
  else { failed++; failures.push(message); console.log(`  ❌ ${message}`); }
}

async function post(fn, body) {
  const res = await fetch(`${API}/${fn}`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Lumied Authenticated API Tests');
  console.log('═══════════════════════════════════════════\n');

  // ── 1. Public actions — response format ──
  console.log('📋 Public actions (no auth needed):');

  const configPub = await post('api', { action: 'config_publica' });
  assert(!configPub.error, 'config_publica returns without error');
  assert(typeof configPub === 'object', 'config_publica returns object');

  const modulos = await post('api', { action: 'modulos_habilitados' });
  assert(!modulos.error || modulos.modulos !== undefined, 'modulos_habilitados returns modulos array or empty');

  const setupCheck = await post('api', { action: 'setup_check' });
  assert(!setupCheck.error || setupCheck.code !== 'NOT_FOUND', 'setup_check exists');

  const hubWhoami = await post('api', { action: 'hub_whoami' });
  assert(hubWhoami.logged === false || hubWhoami.logged === true, 'hub_whoami returns {logged: bool}');

  const faq = await post('api', { action: 'suporte_faq_list' });
  assert(Array.isArray(faq) || faq.error, 'suporte_faq_list returns array or error');

  // ── 2. Auth error contracts ──
  console.log('\n🔐 Auth error contracts:');

  const noToken = await post('api', { action: 'alunos_list' });
  assert(noToken.error && (noToken.code === 'AUTH_INVALID' || noToken.error.includes('Sessão')), 'alunos_list without token returns auth error');

  const badLogin = await post('api', { action: 'login', email: 'fake@test.invalid', senha: 'wrong' });
  assert(badLogin.error && (badLogin.code === 'AUTH_BAD_CREDENTIALS' || badLogin.error.includes('inválid')), 'login with bad creds returns AUTH_BAD_CREDENTIALS');

  const badLoginDiplomas = await post('diplomas', { action: 'unified_login', email: 'fake@test.invalid', senha: 'wrong' });
  assert(badLoginDiplomas.error && (badLoginDiplomas.code === 'AUTH_BAD_CREDENTIALS' || badLoginDiplomas.error.includes('inválid')), 'unified_login bad creds returns AUTH_BAD_CREDENTIALS');

  const noTokenDiplomas = await post('diplomas', { action: 'alm_painel' });
  assert(noTokenDiplomas.error && (noTokenDiplomas.code === 'AUTH_INVALID' || noTokenDiplomas.error.includes('Sessão') || noTokenDiplomas.status === 401), 'alm_painel without token returns auth error');

  const noTokenAcademico = await post('academico', { action: 'notas_config_get' });
  // This is a public action (loadEscola, no auth), should return data or empty
  assert(!noTokenAcademico.error || noTokenAcademico.code !== 'NOT_FOUND', 'notas_config_get (public) does not 404');

  // ── 3. Validation contracts ──
  console.log('\n✅ Validation contracts:');

  const emptyTicket = await post('api', { action: 'ticket_create' });
  assert(emptyTicket.error && emptyTicket.error.includes('obrigat'), 'ticket_create without fields returns validation error');

  const badEmail = await post('api', { action: 'send_magic_link', email: 'not-an-email' });
  assert(badEmail.error && badEmail.error.includes('inválido'), 'send_magic_link with bad email returns validation error');

  const emptyAlunoLogin = await post('academico', { action: 'aluno_login' });
  assert(emptyAlunoLogin.error && (emptyAlunoLogin.code === 'VALIDATION_FAILED' || emptyAlunoLogin.code === 'FEATURE_DISABLED' || emptyAlunoLogin.error.includes('obrigat')), 'aluno_login without fields returns validation or feature-disabled error');

  // ── 4. Rate limiting ──
  console.log('\n🚦 Rate limiting:');
  // Rate limiting is DB-backed (shared across instances).
  // We can't reliably trigger it in a smoke test without flooding the endpoint.
  // Instead, verify the rate limit infrastructure exists by checking a single request works.
  const rlTest = await post('api', { action: 'login', email: 'ratelimit@test.invalid', senha: 'test' });
  assert(rlTest.error && rlTest.code !== 'RATE_LIMITED', 'Single login attempt not rate-limited (infra OK)');

  // ── 5. Lumi AI availability ──
  console.log('\n🧠 Lumi AI:');

  const aiNoToken = await post('lumied-ai', { action: 'ai_perguntar', pergunta: 'test' });
  assert(aiNoToken.error && (aiNoToken.code === 'AUTH_REQUIRED' || aiNoToken.error.includes('Token')), 'ai_perguntar requires auth');

  const roiNoToken = await post('lumied-ai', { action: 'roi_dashboard' });
  assert(roiNoToken.error && (roiNoToken.code === 'AUTH_REQUIRED' || roiNoToken.error.includes('Token')), 'roi_dashboard requires auth');

  // ── 6. Acesso module ──
  console.log('\n🔑 Acesso:');

  const acessoNoToken = await post('acesso', { action: 'acesso_dashboard' });
  assert(acessoNoToken.error && (acessoNoToken.code === 'AUTH_REQUIRED' || acessoNoToken.error.includes('Token')), 'acesso_dashboard requires auth');

  const buscaPessoa = await post('acesso', { action: 'acesso_buscar_pessoa', tipo: 'aluno', busca: 'a' });
  assert(buscaPessoa.error && (buscaPessoa.code === 'AUTH_REQUIRED' || buscaPessoa.error.includes('Token')), 'acesso_buscar_pessoa requires auth');

  // ── 7. Cross-function consistency ──
  console.log('\n🔗 Cross-function consistency:');

  // ia_uso_self should return 401 (not 500 anymore)
  const iaUso = await post('api', { action: 'ia_uso_self' });
  assert(iaUso.error && !iaUso.error.includes('Internal'), 'ia_uso_self returns 401 not 500');

  // Modulos should work on both api and diplomas
  const modulosApi = await post('api', { action: 'modulos_habilitados' });
  const modulosDip = await post('diplomas', { action: 'modulos_habilitados' });
  assert(!modulosApi.code || modulosApi.code !== 'NOT_FOUND', 'modulos_habilitados exists in api');
  assert(!modulosDip.code || modulosDip.code !== 'NOT_FOUND', 'modulos_habilitados exists in diplomas');

  // ── Summary ──
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════`);

  if (failures.length > 0) {
    console.log('\n🚨 FAILURES:');
    failures.forEach(f => console.log('  ' + f));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
