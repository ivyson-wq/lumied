-- ═══════════════════════════════════════════════════════════════
--  Migration 245 — [P0] Tenant isolation COMPLETO (pós-incidente)
-- ═══════════════════════════════════════════════════════════════
-- Expande 243/244 para cobrir TODAS as tabelas tenant-scoped restantes.
-- Objetivo: zero tabela visível entre escolas, mesmo que vazia hoje.
--
-- Estratégia por categoria:
--   1. TENANT com dados: backfill via FK (quando possível) + ADD COLUMN + trigger
--   2. TENANT vazia: só ADD COLUMN + trigger (preventivo)
--   3. CHILD de tenant: ADD COLUMN + backfill via FK pai + trigger
--   4. GLOBAL/SaaS: deixa como está (não precisa escola_id)
--   5. SESSÕES: skip (herdam via user FK)
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- HELPER: adicionar escola_id + FK + index + trigger em uma tabela
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION add_tenant_isolation(p_table text) RETURNS void AS $$
BEGIN
  -- ADD COLUMN if not exists
  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE', p_table);
  -- INDEX
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(escola_id)', 'idx_' || p_table || '_escola', p_table);
  -- TRIGGER (drop + create para idempotência)
  EXECUTE format('DROP TRIGGER IF EXISTS trg_tenant_check ON %I', p_table);
  EXECUTE format('CREATE TRIGGER trg_tenant_check BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()', p_table);
END $$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────
-- CATEGORIA 1: TENANT SIMPLES — só precisa ADD COLUMN + trigger
-- (tabelas vazias ou sem FK derivável; ficam NULL e trigger protege novos inserts)
-- ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
  tenants_simples text[] := ARRAY[
    -- Controle de acesso (biometria) — CRÍTICO
    'acesso_cadastro_tokens','acesso_dispositivos','acesso_eventos','acesso_faces',
    'acesso_permissoes_retirada','acesso_presenca','acesso_rfid',
    -- Ponto/AFD — CRÍTICO LGPD/CLT
    'afd_events','afd_imports',
    'ponto_daily_summary','ponto_employees','ponto_justificativas',
    -- Agenda/comunicação
    'agenda_fotos','agenda_registros',
    'alertas_emergencia',
    'chat_leituras','chat_participantes',
    -- Almoxarifado (resto)
    'alm_categorias','alm_compras','alm_entregas','alm_insumo_historico','alm_notificacoes',
    -- Alunos login
    'alunos_login',
    'atestados_professoras',
    -- BI / dashboards por escola
    'bi_dashboards','bi_snapshots',
    -- Compliance (resto)
    'compliance_audit_trail','compliance_ciencias','compliance_incidentes_historico',
    'compliance_politicas_aceites','compliance_quiz_atribuicoes','compliance_quiz_perguntas',
    'compliance_quiz_respostas','compliance_quizzes','compliance_treinamentos',
    'compliance_treinamentos_presenca',
    -- Contabilidade
    'contabil_config','contabil_exportacoes',
    -- Contratos assinaturas
    'contrato_assinaturas',
    -- Cozinha child tables
    'cozinha_compra_itens','cozinha_receita_ingredientes',
    -- CRM (resto)
    'crm_interacoes','crm_reunioes','crm_turmas_vagas','comercial_metas',
    -- Diplomas/pedagógico
    'diplomas_professoras','documentos_gerados','documentos_templates',
    'relatorio_competencias','relatorios_pedagogicos',
    -- EAD
    'ead_materiais','ead_presencas',
    -- Financeiro (resto)
    'fin_boleto_batch_items','fin_notas_fiscais','fin_saldos_patrimoniais',
    -- Frequência
    'frequencia_alertas',
    -- Gestoras e horários
    'horarios_disponiveis','professora_horario_acesso',
    -- IA
    'ia_conversas','ia_insights',
    -- Impressões
    'impressoes','impressoes_orcamento',
    -- Indicações (escolas → B2B)
    'indicacoes','indicacoes_b2b','indicacoes_b2b_config',
    -- Inscrições em atividades
    'inscricoes_atividades',
    -- LGPD
    'lgpd_audit_log','lgpd_consentimentos','lgpd_solicitacoes',
    -- Loja
    'loja_itens_pedido','loja_pagamentos','loja_pedidos',
    -- Manutenção (equipes)
    'manut_equipes',
    -- Matrículas (form + documentos)
    'matricula_documentos','matricula_formularios',
    -- Milestones
    'milestones',
    -- Notas (lançamentos + avaliações)
    'notas_avaliacoes','notas_lancamentos',
    -- Notificações
    'notificacao_preferencias','notificacao_queue',
    -- Offline sync (por tenant)
    'offline_sync_log',
    -- PDI
    'pdi_acompanhamentos','pdi_ciclos','pdi_competencias','pdi_metas','pdis',
    -- Pesquisas
    'pesquisa_perguntas','pesquisa_respostas',
    -- Pickup / cobranca
    'pickup_notificacoes','pix_cobrancas',
    -- Provas
    'provas','provas_prova_questoes','provas_questoes','provas_respostas',
    -- Reuniões
    'reunioes','solicitacoes','solicitacoes_acesso',
    -- Suporte interno
    'suporte_mensagens',
    -- Streaks gamificação
    'teacher_streaks',
    -- Autorizações cross usuario-escola
    'usuarios_autorizados',
    -- Atividades contas a receber
    'atividades_contas_receber',
    -- WhatsApp tenant (cada escola tem config própria)
    'wa_confirmacoes_evento','wa_conversation_state','wa_departments','wa_janelas',
    'wa_messages_log','wa_respostas','wa_routing_keywords','wa_scheduled_meetings',
    'wa_urgency_keywords','wa_config',
    -- Audit eventos (já tem escola_id mas faltava trigger)
    'audit_eventos',
    -- IA uso por escola
    'escola_ia_uso',
    -- Gestoras (caso seja tenant — usuárias adicionais)
    'gestoras'
  ];
BEGIN
  FOREACH t IN ARRAY tenants_simples LOOP
    BEGIN
      PERFORM add_tenant_isolation(t);
      RAISE NOTICE '✓ Tenant isolation aplicado em %', t;
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE '⚠ Tabela % não existe, skip', t;
    END;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────
-- CATEGORIA 2: BACKFILL via FK pai (child tables)
-- ────────────────────────────────────────────────────────────────

-- Helper para tentar backfill child → pai de forma tolerante
CREATE OR REPLACE FUNCTION try_backfill_child(p_child text, p_parent text, p_fk_col text) RETURNS int AS $$
DECLARE affected int;
BEGIN
  EXECUTE format('UPDATE %I c SET escola_id = p.escola_id FROM %I p WHERE c.%I = p.id AND c.escola_id IS NULL', p_child, p_parent, p_fk_col);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'backfill %→% falhou: %', p_child, p_parent, SQLERRM;
  RETURN 0;
END $$ LANGUAGE plpgsql;

-- Todos os backfills child→pai via helper (tolerante a erro)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('alm_requisicao_itens','alm_requisicoes','requisicao_id'),
    ('alm_entregas','alm_requisicoes','requisicao_id'),
    ('alm_compras','alm_requisicoes','requisicao_id'),
    ('alm_insumo_historico','alm_insumos','insumo_id'),
    ('chat_participantes','chat_conversas','conversa_id'),
    ('chat_leituras','chat_conversas','conversa_id'),
    ('cozinha_compra_itens','cozinha_compras','compra_id'),
    ('cozinha_receita_ingredientes','cozinha_receitas','receita_id'),
    ('compliance_quiz_perguntas','compliance_quizzes','quiz_id'),
    ('provas_prova_questoes','provas','prova_id'),
    ('loja_itens_pedido','loja_pedidos','pedido_id'),
    ('loja_pagamentos','loja_pedidos','pedido_id'),
    ('fin_boleto_batch_items','fin_boletos_batch','batch_id')
  ) AS t(child, parent, fk_col)
  LOOP
    PERFORM try_backfill_child(r.child, r.parent, r.fk_col);
  END LOOP;
END $$;

-- impressoes / impressoes_orcamento — backfill por criado_em < cutoff demo
DO $$ BEGIN
  UPDATE impressoes SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
    WHERE escola_id IS NULL AND criado_em < '2026-04-15 17:00:10.914105+00';
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- pickup_notificacoes → familias (via email) ou se criado pré-cutoff → Maple
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pickup_notificacoes' AND column_name='criado_em') THEN
    UPDATE pickup_notificacoes SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
      WHERE escola_id IS NULL AND criado_em < '2026-04-15 17:00:10.914105+00';
  END IF;
END $$;

-- alm_insumo_historico pré-cutoff → Maple (tinha 473 linhas antes da demo)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='alm_insumo_historico' AND column_name='criado_em') THEN
    UPDATE alm_insumo_historico SET escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
      WHERE escola_id IS NULL AND criado_em < '2026-04-15 17:00:10.914105+00';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────
-- CATEGORIA 3: Reaplica trigger nas tabelas que já tinham escola_id
-- mas sem trigger (garantir cobertura completa)
-- ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
  ja_tinham text[] := ARRAY[
    'achados_perdidos','aluno_historico','backups_log','bi_indicadores',
    'biblioteca_acervo','biblioteca_emprestimos','biblioteca_reservas',
    'cantina_cardapio','cantina_creditos','cantina_restricoes','cantina_transacoes',
    'chat_conversas','cobranca_tratativas','compliance_banco_horas','compliance_calendario',
    'compliance_certificacoes','compliance_config_ponto','compliance_feriados',
    'compliance_horarios','compliance_incidentes','compliance_inspecoes','compliance_politicas',
    'compliance_ponto_importacoes','contrato_templates',
    'cozinha_alimento_lotes','cozinha_alimentos','cozinha_amostras','cozinha_cardapios',
    'cozinha_compras','cozinha_config','cozinha_consumo','cozinha_desperdicio',
    'cozinha_higienizacao_execucoes','cozinha_higienizacao_tarefas','cozinha_receitas',
    'cozinha_temperatura_registros','crm_estagios','crm_templates','ead_aulas',
    'escola_adocao','escola_decisoes_financeiras','escola_extras_contratados',
    'escola_upsell_triggers','escola_uso_historico',
    'fin_boletos_batch','fin_conciliacao_execucoes','fin_extrato_bancario',
    'fin_folha_upload','fin_inadimplencia','fin_lancamentos','fin_plano_contas',
    'fin_relatorio_mensal','frequencia_config','indicacoes_config',
    'loja_produtos','lumied_staff_audit','manutencoes','memory_books',
    'notas_config','notas_disciplinas','notas_periodos','notificacoes',
    'onboarding_progresso','permissoes_usuario','pesquisas','regua_config',
    'resp_financeiro_historico','restores_log','rh_ferias'
  ];
BEGIN
  FOREACH t IN ARRAY ja_tinham LOOP
    BEGIN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_tenant_check ON %I', t);
      EXECUTE format('CREATE TRIGGER trg_tenant_check BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()', t);
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      RAISE NOTICE '⚠ Tabela % não protegida (não existe ou sem escola_id)', t;
    END;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────
-- CATEGORIA 4: Atualiza a view tenant_isolation_audit com TODAS as tenant
-- ────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS tenant_isolation_audit;
CREATE VIEW tenant_isolation_audit AS
SELECT
  c.table_name AS tabela,
  (SELECT COUNT(*) FROM pg_class WHERE relname = c.table_name AND relkind = 'r') AS exists,
  (SELECT has_escola_id FROM (
    SELECT TRUE AS has_escola_id FROM information_schema.columns
    WHERE table_name = c.table_name AND column_name = 'escola_id' LIMIT 1
  ) x) AS has_escola_id,
  (SELECT COUNT(*) > 0 FROM information_schema.triggers
    WHERE event_object_table = c.table_name AND trigger_name = 'trg_tenant_check') AS has_trigger
FROM (
  -- tabelas que DEVEM ser tenant
  SELECT unnest(ARRAY[
    'series','professoras','alunos','usuarios','gerentes','secretarias','familias','crm_leads',
    'calendario_eventos','atividades','crm_matriculas','ausencias','boletos','alm_insumos',
    'alm_requisicoes','alm_orcamentos','fin_mensalidades','fin_boletos_emitidos','diario_registros',
    'frequencia_chamadas','frequencia_registros','chat_mensagens','contratos','boletins',
    'autorizacoes','agenda_itens','manutencoes','notas_config','notas_periodos','frequencia_config',
    'escola_config','escola_modulos','escola_uso','compliance_ponto_registros','compliance_ocorrencias',
    'compliance_alertas','regua_config','pix_config','ia_config',
    -- 245 adicionou:
    'acesso_cadastro_tokens','acesso_dispositivos','acesso_eventos','acesso_faces','acesso_permissoes_retirada','acesso_presenca','acesso_rfid',
    'afd_events','afd_imports','ponto_daily_summary','ponto_employees','ponto_justificativas',
    'agenda_fotos','agenda_registros','alertas_emergencia','chat_leituras','chat_participantes',
    'alm_categorias','alm_compras','alm_entregas','alm_insumo_historico','alm_notificacoes','alm_requisicao_itens',
    'alunos_login','atestados_professoras','bi_dashboards','bi_snapshots',
    'compliance_audit_trail','compliance_ciencias','compliance_incidentes_historico','compliance_politicas_aceites',
    'compliance_quiz_atribuicoes','compliance_quiz_perguntas','compliance_quiz_respostas','compliance_quizzes',
    'compliance_treinamentos','compliance_treinamentos_presenca','contabil_config','contabil_exportacoes',
    'contrato_assinaturas','cozinha_compra_itens','cozinha_receita_ingredientes',
    'crm_interacoes','crm_reunioes','crm_turmas_vagas','comercial_metas',
    'diplomas_professoras','documentos_gerados','documentos_templates',
    'ead_materiais','ead_presencas','fin_boleto_batch_items','fin_notas_fiscais','fin_saldos_patrimoniais',
    'frequencia_alertas','horarios_disponiveis','ia_conversas','ia_insights',
    'impressoes','impressoes_orcamento','indicacoes','indicacoes_b2b','inscricoes_atividades',
    'lgpd_audit_log','lgpd_consentimentos','lgpd_solicitacoes','loja_itens_pedido','loja_pagamentos','loja_pedidos',
    'manut_equipes','matricula_documentos','matricula_formularios','milestones',
    'notas_avaliacoes','notas_lancamentos','notificacao_preferencias','notificacao_queue',
    'offline_sync_log','pdi_acompanhamentos','pdi_ciclos','pdi_competencias','pdi_metas','pdis',
    'pesquisa_perguntas','pesquisa_respostas','pickup_notificacoes','pix_cobrancas',
    'professora_horario_acesso','provas','provas_prova_questoes','provas_questoes','provas_respostas',
    'relatorio_competencias','relatorios_pedagogicos','reunioes','solicitacoes','solicitacoes_acesso',
    'suporte_mensagens','teacher_streaks','usuarios_autorizados','atividades_contas_receber',
    'wa_confirmacoes_evento','wa_conversation_state','wa_departments','wa_janelas',
    'wa_messages_log','wa_respostas','wa_routing_keywords','wa_scheduled_meetings','wa_urgency_keywords','wa_config',
    'audit_eventos','escola_ia_uso','gestoras','relatorio_pedagogico'
  ]) AS table_name
) c;

COMMENT ON VIEW tenant_isolation_audit IS 'Status de isolamento por tabela tenant. Ideal: has_escola_id=true E has_trigger=true em todas.';

-- ────────────────────────────────────────────────────────────────
-- Relatório final
-- ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  total_protegidas int;
  total_expected int;
  missing int;
BEGIN
  SELECT COUNT(*) INTO total_protegidas FROM tenant_isolation_audit
    WHERE exists = 1 AND has_escola_id = true AND has_trigger = true;
  SELECT COUNT(*) INTO total_expected FROM tenant_isolation_audit WHERE exists = 1;
  SELECT COUNT(*) INTO missing FROM tenant_isolation_audit
    WHERE exists = 1 AND (has_escola_id IS NULL OR has_escola_id = false OR has_trigger = false);
  RAISE NOTICE '═══════════════════════════════════════';
  RAISE NOTICE 'MIG 245 — Tenant isolation completo';
  RAISE NOTICE '  Tabelas tenant existentes: %', total_expected;
  RAISE NOTICE '  Totalmente protegidas: %', total_protegidas;
  RAISE NOTICE '  Com gap: %', missing;
  RAISE NOTICE '═══════════════════════════════════════';
END $$;
