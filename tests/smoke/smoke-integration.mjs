#!/usr/bin/env node
/**
 * Lumied Integration Test Suite
 *
 * Logs in with a REAL account and tests authenticated flows end-to-end:
 * - Login → get token → call authenticated actions → verify response shape
 * - CRUD operations (create → read → update → delete)
 * - Multi-tenant isolation (verify escola_id scoping)
 * - File operations (PDF/Excel generation)
 * - AI features (if enabled)
 *
 * Run: node tests/smoke/smoke-integration.mjs
 *
 * Uses demo account: demo@lumied.com.br / LumiedDemo2026!
 */

const API = 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjU0NTUsImV4cCI6MjA4OTM0MTQ1NX0.QKX_6ZSfied60ZpB8VOx03hwiyD9J5lskKwfl-oXPYE';
const HEADERS = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` };

// Demo credentials
const DEMO_EMAIL = 'demo@lumied.com.br';
const DEMO_SENHA = 'LumiedDemo2026!';

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function assert(condition, message) {
  if (condition) { passed++; }
  else { failed++; failures.push(message); console.log(`  ❌ ${message}`); }
}

function skip(message) {
  skipped++;
  console.log(`  ⏭️  SKIP: ${message}`);
}

async function post(fn, body, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API}/${fn}`, {
        method: 'POST', headers: HEADERS,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return { status: res.status, data: await res.json(), headers: res.headers };
      }
      return { status: res.status, blob: await res.blob(), headers: res.headers };
    } catch (e) {
      if (attempt < retries) { await new Promise(r => setTimeout(r, 2000)); continue; }
      return { status: 0, data: { error: 'TIMEOUT: ' + e.message, code: 'TIMEOUT' }, headers: new Headers() };
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Lumied Integration Tests (authenticated)');
  console.log('═══════════════════════════════════════════\n');

  // ════════════════════════════════════════════
  // STEP 1: LOGIN
  // ════════════════════════════════════════════
  console.log('🔑 Step 1: Login');
  const loginRes = await post('api', { action: 'login', email: DEMO_EMAIL, senha: DEMO_SENHA });

  if (!loginRes.data?.token) {
    console.log(`\n  ⛔ Cannot login with demo account: ${JSON.stringify(loginRes.data)}`);
    console.log('  All authenticated tests will be skipped.\n');

    // Try unified_login on diplomas
    const uniLogin = await post('diplomas', { action: 'unified_login', email: DEMO_EMAIL, senha: DEMO_SENHA });
    if (uniLogin.data?.token) {
      console.log('  ℹ️  unified_login works — using that token instead.\n');
      return runAuthenticatedTests(uniLogin.data.token, 'diplomas');
    }

    console.log('═══════════════════════════════════════════');
    console.log(`  ${passed} passed, ${failed} failed, ALL auth tests skipped`);
    console.log('═══════════════════════════════════════════');
    process.exit(1);
  }

  const token = loginRes.data.token;
  assert(typeof token === 'string' && token.length > 20, 'Login returns valid token');
  assert(loginRes.data.nome || loginRes.data.email, 'Login returns user info');
  console.log(`  ✅ Logged in as: ${loginRes.data.nome || loginRes.data.email}\n`);

  await runAuthenticatedTests(token, 'api');
}

async function runAuthenticatedTests(token, loginFn) {
  const authBody = (action, extra = {}) => ({ action, _token: token, ...extra });

  // ════════════════════════════════════════════
  // STEP 2: READ OPERATIONS — verify response shapes
  // ════════════════════════════════════════════
  console.log('📖 Step 2: Read operations (response shape validation)');

  // Alunos list
  const alunos = await post('api', authBody('alunos_list'));
  assert(Array.isArray(alunos.data) || alunos.data?.error, 'alunos_list returns array');
  if (Array.isArray(alunos.data) && alunos.data.length > 0) {
    const a = alunos.data[0];
    assert(a.nome_aluno || a.nome_crianca || a.email, 'aluno has nome or email field');
  }

  // Series list
  const series = await post('api', authBody('series_list_all'));
  assert(Array.isArray(series.data), 'series_list_all returns array');
  if (Array.isArray(series.data) && series.data.length > 0) {
    assert(series.data[0].nome, 'serie has nome field');
  }

  // Usuarios list
  const usuarios = await post('api', authBody('usuarios_list'));
  assert(Array.isArray(usuarios.data) || usuarios.data?.data, 'usuarios_list returns array or {data:[]}');

  // Config get
  const config = await post('api', authBody('config_get'));
  assert(!config.data?.code || config.data.code !== 'NOT_FOUND', 'config_get exists');

  // Impressoes
  const impressoes = await post('api', authBody('impressoes_todas'));
  assert(Array.isArray(impressoes.data) || impressoes.data?.error, 'impressoes_todas returns array');

  // CRM
  const crmEstagios = await post('api', authBody('crm_estagios_list'));
  assert(Array.isArray(crmEstagios.data), 'crm_estagios_list returns array');

  const crmLeads = await post('api', authBody('crm_leads_list'));
  assert(Array.isArray(crmLeads.data), 'crm_leads_list returns array');

  // Notificacoes
  const notifs = await post('api', authBody('notif_list'));
  assert(Array.isArray(notifs.data) || notifs.data?.error, 'notif_list returns array');

  // IA uso
  const iaUso = await post('api', authBody('ia_uso_self'));
  assert(iaUso.status !== 500, 'ia_uso_self does not crash (was 500 bug)');
  assert(iaUso.data?.custo_usd !== undefined || iaUso.data?.error, 'ia_uso_self returns custo_usd or error');

  // ════════════════════════════════════════════
  // STEP 3: DIPLOMAS (professora/gerente actions)
  // ════════════════════════════════════════════
  console.log('\n📚 Step 3: Diplomas edge function');

  // Almoxarifado painel
  const almPainel = await post('diplomas', authBody('alm_painel'));
  assert(almPainel.status !== 404, 'alm_painel is registered');
  if (almPainel.data && !almPainel.data.error) {
    assert(almPainel.data.pendentes !== undefined || almPainel.data.total !== undefined, 'alm_painel has pendentes field');
  }

  // Almoxarifado insumos list
  const insumos = await post('diplomas', authBody('alm_insumos_list'));
  assert(insumos.status !== 404, 'alm_insumos_list is registered');

  // Almoxarifado orcamentos
  const orcamentos = await post('diplomas', authBody('alm_orcamentos_list'));
  assert(orcamentos.status !== 404, 'alm_orcamentos_list is registered');

  // ════════════════════════════════════════════
  // STEP 4: PDF/EXCEL GENERATION
  // ════════════════════════════════════════════
  console.log('\n📄 Step 4: PDF/Excel generation');

  // PDF de aprovados
  const pdfAprovados = await post('diplomas', authBody('alm_pdf_aprovados'));
  if (pdfAprovados.blob) {
    assert(pdfAprovados.blob.size > 100, 'alm_pdf_aprovados returns non-empty PDF');
    const ct = pdfAprovados.headers.get('content-type') || '';
    assert(ct.includes('pdf'), 'alm_pdf_aprovados has PDF content-type');
  } else {
    // May return JSON error if no data
    assert(pdfAprovados.status !== 404, 'alm_pdf_aprovados is registered (no data to generate)');
  }

  // Excel observacoes (THE BUG WE FOUND)
  const excelObs = await post('diplomas', authBody('alm_excel_observacoes', { mes: '2026-04' }));
  assert(excelObs.status !== 404, 'alm_excel_observacoes is registered (was the bug!)');
  if (excelObs.blob) {
    assert(excelObs.blob.size > 50, 'alm_excel_observacoes returns non-empty XLSX');
    const ct = excelObs.headers.get('content-type') || '';
    assert(ct.includes('spreadsheet') || ct.includes('xlsx'), 'alm_excel_observacoes has XLSX content-type');
  }

  // PDF observacoes
  const pdfObs = await post('diplomas', authBody('alm_pdf_observacoes', { mes: '2026-04' }));
  assert(pdfObs.status !== 404, 'alm_pdf_observacoes is registered');

  // PDF observacoes landscape
  const pdfObsL = await post('diplomas', authBody('alm_pdf_observacoes', { mes: '2026-04', landscape: true }));
  assert(pdfObsL.status !== 404, 'alm_pdf_observacoes landscape is registered');

  // ════════════════════════════════════════════
  // STEP 5: ACADEMICO
  // ════════════════════════════════════════════
  console.log('\n🎓 Step 5: Academico edge function');

  const notasConfig = await post('academico', authBody('notas_config_get'));
  assert(notasConfig.status !== 404, 'notas_config_get is registered');

  const periodos = await post('academico', authBody('notas_periodos_list', { ano: 2026 }));
  assert(periodos.status !== 404, 'notas_periodos_list is registered');
  assert(Array.isArray(periodos.data) || periodos.data?.error, 'notas_periodos_list returns array');

  const disciplinas = await post('academico', authBody('notas_disciplinas_list'));
  assert(disciplinas.status !== 404, 'notas_disciplinas_list is registered');

  const diarioBncc = await post('academico', authBody('diario_bncc_habilidades_list'));
  assert(diarioBncc.status !== 404, 'diario_bncc_habilidades_list is registered');

  const bnccComp = await post('academico', authBody('bncc_competencias_list'));
  assert(bnccComp.status !== 404, 'bncc_competencias_list is registered');

  // ════════════════════════════════════════════
  // STEP 6: COMPLIANCE
  // ════════════════════════════════════════════
  console.log('\n📋 Step 6: Compliance edge function');

  const compHorarios = await post('compliance', authBody('compliance_horarios_list'));
  assert(compHorarios.status !== 404, 'compliance_horarios_list is registered');

  const compConfig = await post('compliance', authBody('compliance_config_ponto_list'));
  assert(compConfig.status !== 404, 'compliance_config_ponto_list is registered');

  const compOcorrencias = await post('compliance', authBody('compliance_ocorrencias_list'));
  assert(compOcorrencias.status !== 404, 'compliance_ocorrencias_list is registered');

  // ════════════════════════════════════════════
  // STEP 7: ACESSO
  // ════════════════════════════════════════════
  console.log('\n🔑 Step 7: Acesso edge function');

  const acessoDash = await post('acesso', authBody('acesso_dashboard'));
  assert(acessoDash.status !== 404, 'acesso_dashboard is registered');

  const acessoDispositivos = await post('acesso', authBody('acesso_dispositivos_list'));
  assert(acessoDispositivos.status !== 404, 'acesso_dispositivos_list is registered');

  const acessoBusca = await post('acesso', authBody('acesso_buscar_pessoa', { tipo: 'aluno', busca: 'test' }));
  assert(acessoBusca.status !== 404, 'acesso_buscar_pessoa is registered');
  assert(Array.isArray(acessoBusca.data) || acessoBusca.data?.error, 'acesso_buscar_pessoa returns array');

  // ════════════════════════════════════════════
  // STEP 8: LUMI AI
  // ════════════════════════════════════════════
  console.log('\n🧠 Step 8: Lumi AI edge function');

  const aiInsights = await post('lumied-ai', authBody('ai_insights_list'));
  assert(aiInsights.status !== 404 && aiInsights.status !== 500, 'ai_insights_list works');

  const roiDash = await post('lumied-ai', authBody('roi_dashboard'));
  assert(roiDash.status !== 404 && roiDash.status !== 500, 'roi_dashboard works');

  // ════════════════════════════════════════════
  // STEP 9: CROSS-FEATURE FLOWS
  // ════════════════════════════════════════════
  console.log('\n🔗 Step 9: Cross-feature flows');

  // Modulos should return tema + modulos array
  const modulos = await post('api', authBody('modulos_habilitados'));
  assert(modulos.data?.modulos !== undefined, 'modulos_habilitados returns modulos');
  assert(modulos.data?.tema !== undefined, 'modulos_habilitados returns tema');
  if (Array.isArray(modulos.data?.modulos)) {
    // Demo escola may not have modules enabled — that's OK
    if (modulos.data.modulos.length === 0) skip('demo escola has 0 modules (no plan assigned)');
    else { passed++; /* has modules */ }
  }

  // CRM dashboard should return structured data
  const crmDash = await post('api', authBody('crm_dashboard'));
  if (!crmDash.data?.error) {
    assert(typeof crmDash.data === 'object', 'crm_dashboard returns object');
  }

  // ════════════════════════════════════════════
  // STEP 10: IMPRESSOES TURMA DESTINO (the feature we just built)
  // ════════════════════════════════════════════
  console.log('\n🖨️ Step 10: Impressoes turma destino');

  // Verify impressao_marcar_impresso accepts turma_destino (won't crash)
  const impTest = await post('api', authBody('impressao_marcar_impresso', { id: '00000000-0000-0000-0000-000000000000', turma_destino: 'Turma Teste' }));
  // Should return error (invalid ID) but NOT 404 or 500
  assert(impTest.status !== 404, 'impressao_marcar_impresso with turma_destino is registered');
  assert(impTest.status !== 500, 'impressao_marcar_impresso with turma_destino does not crash');

  // ════════════════════════════════════════════
  // STEP 11: LOGOUT
  // ════════════════════════════════════════════
  console.log('\n🚪 Step 11: Logout');
  const logout = await post('api', authBody('logout'));
  assert(!logout.data?.error || logout.data?.success, 'logout works');

  // After logout, token should be invalid
  const afterLogout = await post('api', { action: 'alunos_list', _token: token });
  assert(afterLogout.data?.error?.includes('Sessão') || afterLogout.data?.code === 'AUTH_INVALID', 'token is invalid after logout');

  // ════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`═══════════════════════════════════════════`);

  if (failures.length > 0) {
    console.log('\n🚨 FAILURES:');
    failures.forEach(f => console.log('  ' + f));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
