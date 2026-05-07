-- ═══════════════════════════════════════════════════════════════
--  Migration 276 — Auditoria do sistema: cleanup gaps + RLS críticos
--
--  Achados da auditoria pós-274/275:
--  1. cleanup_all_expired_sessions não inclui lumied_staff_sessoes
--     (12/12 acumuladas expiradas). secretaria_sessoes/professora_sessoes
--     ok (cron 03:00 limpa).
--  2. ~140 tabelas tenant sem RLS habilitada. Defesa em profundidade
--     fraca se anon key vazar. Service role bypassa RLS então edge
--     functions continuam funcionando — habilitamos sem policy nas
--     tabelas mais sensíveis (LGPD/financeiro/contratos/impressoes).
-- ═══════════════════════════════════════════════════════════════

-- PARTE A — completa cleanup de sessões
CREATE OR REPLACE FUNCTION cleanup_all_expired_sessions() RETURNS integer AS $$
DECLARE
  deleted integer := 0;
  d integer;
BEGIN
  DELETE FROM gerente_sessoes WHERE expira_em < now(); GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  DELETE FROM professora_sessoes WHERE expira_em < now(); GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  DELETE FROM secretaria_sessoes WHERE expira_em < now(); GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  DELETE FROM admin_sessoes WHERE expira_em < now(); GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  DELETE FROM aluno_sessoes WHERE expira_em < now(); GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  DELETE FROM sessoes WHERE expira_em < now(); GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  -- Estava faltando — staff Lumied tinha 12/12 sessões expiradas acumuladas
  DELETE FROM lumied_staff_sessoes WHERE expira_em < now(); GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  -- Cleanup WebAuthn challenges (expire after 5 min)
  DELETE FROM webauthn_challenges WHERE criado_em < now() - interval '5 minutes'; GET DIAGNOSTICS d = ROW_COUNT; deleted := deleted + d;
  RETURN deleted;
END;
$$ LANGUAGE plpgsql;

-- Executa uma vez agora pra zerar backlog
SELECT cleanup_all_expired_sessions();

-- PARTE B — RLS forçada em tabelas mais sensíveis (defesa em profundidade)
-- Sem policy: tudo bloqueado via REST anônimo; service_role bypassa
-- automaticamente, edge functions continuam funcionando normal.
DO $$
DECLARE
  tbl text;
  criticas text[] := ARRAY[
    -- LGPD (compliance regulatório)
    'lgpd_consentimentos', 'lgpd_audit_log', 'lgpd_solicitacoes',
    -- Financeiro (sensível)
    'fin_mensalidades', 'fin_boletos_emitidos', 'fin_boleto_batch_items',
    'fin_notas_fiscais', 'fin_saldos_patrimoniais', 'pix_cobrancas',
    'cobranca_tratativas', 'regua_execucoes', 'saas_faturas', 'lumied_contas_receber',
    -- Compliance/auditoria
    'compliance_audit_trail', 'compliance_ciencias', 'audit_log_cadastro',
    -- Contratos digitais (assinatura eletrônica)
    'contratos', 'contrato_assinaturas',
    -- Documentos do aluno
    'matricula_documentos', 'documentos_gerados',
    -- Impressões (arquivos PDF dos professores)
    'impressoes',
    -- Comunicados pais (PII)
    'comunicados_pais',
    -- Backup / restore (secrets)
    'backups_log', 'restores_log',
    -- Webhooks/secrets
    'wa_messages_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY criticas LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
      RAISE NOTICE '✓ RLS forçada em %', tbl;
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE '⚠ Tabela % não existe, skip', tbl;
    END;
  END LOOP;
END $$;

-- PARTE C — view de auditoria de RLS pra monitoramento contínuo
CREATE OR REPLACE VIEW rls_audit AS
SELECT
  c.relname AS tabela,
  c.relrowsecurity AS rls_on,
  c.relforcerowsecurity AS rls_force,
  EXISTS (
    SELECT 1 FROM information_schema.columns ic
    WHERE ic.table_name = c.relname AND ic.column_name = 'escola_id'
  ) AS tenant_scoped
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

COMMENT ON VIEW rls_audit IS
  'Status de RLS por tabela. tenant_scoped=true e rls_on=false = candidato a habilitar.';
