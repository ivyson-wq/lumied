#!/usr/bin/env node
/**
 * Lumied API Contract Smoke Test
 *
 * Tests EVERY action in EVERY edge function with a real HTTP request.
 * Verifies that no action returns "ação desconhecida" (NOT_FOUND).
 *
 * Expected responses for unauthenticated requests:
 *   - 401 AUTH_REQUIRED / AUTH_INVALID → action EXISTS, auth works
 *   - 400 VALIDATION_FAILED / BAD_REQUEST → action EXISTS, validation works
 *   - 403 FORBIDDEN / FEATURE_DISABLED → action EXISTS, gating works
 *   - 429 RATE_LIMITED → action EXISTS, rate limiting works
 *   - 200 (for public actions) → action EXISTS, returns data
 *
 * FAIL conditions:
 *   - 404 NOT_FOUND "ação desconhecida" → BUG: action not registered
 *   - Network error → edge function not deployed
 *   - 500 INTERNAL_ERROR → BUG: unhandled crash
 *
 * Run: node tests/smoke/smoke-api.mjs
 */

const API = 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjU0NTUsImV4cCI6MjA4OTM0MTQ1NX0.QKX_6ZSfied60ZpB8VOx03hwiyD9J5lskKwfl-oXPYE';
const HEADERS = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` };

let passed = 0;
let failed = 0;
let warnings = 0;
const failures = [];

async function testAction(fn, action, extraBody = {}) {
  const body = { action, ...extraBody };
  try {
    const res = await fetch(`${API}/${fn}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }

    const code = data?.code || '';
    const error = data?.error || '';

    // FAIL: action not registered in backend
    if (code === 'NOT_FOUND' || error.includes('desconhecida') || error.includes('unknown')) {
      failed++;
      const msg = `FAIL ${fn}/${action}: NOT_FOUND — action not registered`;
      failures.push(msg);
      console.log(`  ❌ ${msg}`);
      return false;
    }

    // FAIL: 500 internal error (unhandled crash)
    if (res.status === 500 && code === 'INTERNAL_ERROR') {
      failed++;
      const msg = `FAIL ${fn}/${action}: 500 INTERNAL_ERROR — ${error.slice(0, 80)}`;
      failures.push(msg);
      console.log(`  ❌ ${msg}`);
      return false;
    }

    // WARN: unexpected status
    if (res.status >= 500) {
      warnings++;
      console.log(`  ⚠️  WARN ${fn}/${action}: ${res.status} — ${error.slice(0, 60)}`);
      return true;
    }

    // OK: any 2xx, 3xx, 4xx (auth/validation errors are expected without token)
    passed++;
    return true;
  } catch (e) {
    failed++;
    const msg = `FAIL ${fn}/${action}: NETWORK ERROR — ${e.message}`;
    failures.push(msg);
    console.log(`  ❌ ${msg}`);
    return false;
  }
}

async function runBatch(fn, actions, extraBody = {}) {
  console.log(`\n📡 ${fn} (${actions.length} actions)`);
  // Run in batches of 5 to avoid rate limiting
  for (let i = 0; i < actions.length; i += 5) {
    const batch = actions.slice(i, i + 5);
    await Promise.all(batch.map(a => testAction(fn, a, extraBody)));
    // Small delay between batches to avoid 429
    if (i + 5 < actions.length) await new Promise(r => setTimeout(r, 500));
  }
}

// ═══════════════════════════════════════════
// All actions per edge function
// ═══════════════════════════════════════════

const API_ACTIONS = [
  // Public
  'config_publica', 'setup_check', 'modulos_habilitados', 'ticket_create',
  'hub_whoami', 'hub_bootstrap', 'send_magic_link',
  // Auth
  'login', 'logout',
  // Gerente (authenticated — will return 401, that's OK)
  'solicitacoes_list', 'series_list_all', 'series_create',
  'gerentes_list', 'usuarios_list', 'usuarios_create',
  'permissoes_get', 'alunos_list', 'aluno_criar',
  'config_set', 'config_get', 'logo_upload',
  'atividades_list', 'atividades_list_all', 'atividades_create',
  'inscricoes_atividades_list',
  // CRM
  'crm_estagios_list', 'crm_leads_list', 'crm_lead_save', 'crm_lead_mover',
  'crm_interacoes_list', 'crm_templates_list', 'crm_dashboard',
  'crm_vagas_list', 'crm_matriculas_list', 'crm_calcular_serie',
  // Financeiro
  'financeiro_resp_get', 'financeiro_resp_salvar',
  'financeiro_decisoes_pendentes', 'financeiro_decisoes_list',
  'financeiro_decisao_aprovar', 'financeiro_decisao_rejeitar',
  'financeiro_solicitar_upgrade', 'financeiro_extras_disponiveis',
  'financeiro_wa_consumo',
  // Impressoes
  'impressoes_pendentes', 'impressoes_todas',
  'impressao_aprovar', 'impressao_rejeitar',
  'impressao_marcar_impresso', 'impressao_marcar_entregue',
  'impressoes_orcamento_list',
  // Emergencia
  'emergencia_acionar', 'emergencia_ativos', 'emergencia_historico',
  // Notificacoes
  'notif_list', 'notif_marcar_lida', 'notif_marcar_todas',
  // Contratos
  'contrato_templates_list', 'contratos_list', 'contrato_gerar', 'contrato_delete',
  // Matriculas
  'matricula_formulario_get', 'matricula_status_list',
  // Indicacoes
  'indicacao_rastrear',
  // WhatsApp
  'wa_family_by_phone', 'suporte_faq_list',
  // IA
  'ia_uso_self', 'aluno_resumo_ia',
];

const DIPLOMAS_ACTIONS = [
  // Professora (real names from backend)
  'prof_turnos_dashboard', 'prof_atividades_dashboard',
  'prof_alterar_senha', 'pdi_prof_view',
  // Gerente (almoxarifado)
  'alm_painel', 'alm_pendentes', 'alm_todas_reqs',
  'alm_aprovar', 'alm_rejeitar',
  'alm_insumos_list', 'alm_insumo_save',
  'alm_series_list', 'alm_orcamentos_list',
  'alm_relatorio', 'alm_pdf_observacoes', 'alm_excel_observacoes',
  'alm_pdf_pendentes', 'alm_pdf_aprovados',
  'alm_pdf_entregues', 'alm_pdf_guia_recebimento', 'alm_pdf_romaneio_turma',
  // Almox compras
  'alm_compras_pendentes', 'alm_compras_todas',
  'alm_encaminhar_compra', 'alm_marcar_comprado',
  'alm_buscar_precos',
  // Professora almox
  'alm_catalogo', 'alm_minha_turma', 'alm_minhas_reqs',
  'alm_criar_req', 'alm_notif_list',
  // Auth
  'unified_login', 'professora_login', 'modulos_habilitados',
  // Pais/Pickup (real names)
  'pickup_meus_filhos', 'pickup_meus_hoje', 'pickup_avisar',
  'pickup_fila_hoje', 'pickup_chegou',
];

const ACADEMICO_ACTIONS = [
  'notas_config_get', 'notas_periodos_list', 'notas_disciplinas_list',
  'notas_avaliacoes_list', 'notas_lancamentos_list',
  'notas_calcular_media', 'boletim_get', 'notas_alunos_serie',
  'frequencia_config_get', 'frequencia_chamada_list',
  'frequencia_registros_list', 'frequencia_relatorio_aluno',
  'diario_registros_list', 'diario_bncc_habilidades_list',
  'documento_templates_list', 'documentos_aluno_list',
  'relatorio_pedagogico_list', 'bncc_competencias_list',
  'aluno_login', 'aluno_logout',
  'aluno_notas_get', 'aluno_frequencia_get',
  'provas_questoes_list', 'provas_list', 'provas_respostas_list',
  'provas_disponiveis_aluno',
];

const LUMIED_AI_ACTIONS = [
  'ai_perguntar', 'ai_perguntar_mcp', 'ai_perguntar_prof',
  'ai_insights_list', 'ai_insight_acao',
  'ai_redigir_comunicado', 'ai_analisar_turma', 'ai_parecer_bncc',
  'ai_previsao_inadimplencia',
  'roi_dashboard', 'roi_config_salvar',
];

const ACESSO_ACTIONS = [
  'acesso_dashboard', 'acesso_dispositivos_list',
  'acesso_dispositivo_save', 'acesso_dispositivo_delete', 'acesso_dispositivo_ping',
  'acesso_faces_list', 'acesso_face_cadastrar', 'acesso_face_delete',
  'acesso_face_sync_all', 'acesso_buscar_pessoa',
  'acesso_rfid_list', 'acesso_rfid_cadastrar', 'acesso_rfid_delete',
  'acesso_permissoes_list', 'acesso_permissao_save', 'acesso_permissao_delete',
  'acesso_eventos_list', 'acesso_alertas_list',
  'acesso_presenca_list', 'acesso_config_list',
];

const COMPLIANCE_ACTIONS = [
  'compliance_horarios_list', 'compliance_horarios_upsert',
  'compliance_importar_ponto', 'compliance_verificar_ponto',
  'compliance_ocorrencias_list', 'compliance_config_ponto_list',
  'compliance_calendario_list', 'compliance_banco_horas_list',
  'compliance_feriados_list', 'compliance_alertas_list',
  'compliance_inspecoes_list',
  'compliance_politicas_list', 'compliance_ciencias_list',
];

const ADMIN_ACTIONS = [
  'escolas_list', 'escola_dashboard',
  'staff_list', 'staff_tickets_list', 'tickets_list',
  'staff_audit_log', 'system_health',
  'staff_login', 'staff_dashboard',
  'planos_list', 'modulos_list',
];

// ═══════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Lumied API Contract Smoke Test');
  console.log('  Testing REAL HTTP requests to production');
  console.log('═══════════════════════════════════════════');

  await runBatch('api', API_ACTIONS);
  await runBatch('diplomas', DIPLOMAS_ACTIONS);
  await runBatch('academico', ACADEMICO_ACTIONS);
  await runBatch('lumied-ai', LUMIED_AI_ACTIONS);
  await runBatch('acesso', ACESSO_ACTIONS);
  await runBatch('compliance', COMPLIANCE_ACTIONS);
  await runBatch('admin', ADMIN_ACTIONS);

  console.log('\n═══════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed, ${warnings} warnings`);
  console.log('═══════════════════════════════════════════');

  if (failures.length > 0) {
    console.log('\n🚨 FAILURES:');
    failures.forEach(f => console.log('  ' + f));
  }

  console.log(`\nTotal actions tested: ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
