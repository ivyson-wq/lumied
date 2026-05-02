-- ════════════════════════════════════════════════════════════════
--  Migration 256: Índices FK faltantes + Cleanup de logs + Self-healing
-- ════════════════════════════════════════════════════════════════

-- ═══ PARTE A: Criar índices automaticamente para todas FK sem índice ═══
DO $$
DECLARE
  r record;
  idx_name text;
BEGIN
  FOR r IN
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_indexes pi
        WHERE pi.tablename = tc.table_name
          AND pi.indexdef LIKE '%' || kcu.column_name || '%'
      )
  LOOP
    idx_name := 'idx_' || r.table_name || '_' || r.column_name;
    -- Truncar nome se muito longo (max 63 chars no PostgreSQL)
    IF length(idx_name) > 63 THEN
      idx_name := substring(idx_name, 1, 63);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = idx_name) THEN
      EXECUTE format('CREATE INDEX %I ON public.%I(%I)', idx_name, r.table_name, r.column_name);
      RAISE NOTICE 'Index criado: %.%', r.table_name, r.column_name;
    END IF;
  END LOOP;
END $$;

-- ═══ PARTE B: Jobs de cleanup para tabelas de log ═══

-- Cleanup: notificações lidas com mais de 90 dias
SELECT cron.schedule(
  'cleanup-notificacoes-90d',
  '0 4 * * 0',  -- domingo 4am
  'DELETE FROM notificacoes WHERE lida = true AND criado_em < now() - interval ''90 days'''
);

-- Cleanup: audit_eventos com mais de 180 dias
SELECT cron.schedule(
  'cleanup-audit-180d',
  '0 4 1 * *',  -- dia 1 de cada mês 4am
  'DELETE FROM audit_eventos WHERE criado_em < now() - interval ''180 days'''
);

-- Cleanup: acesso_eventos com mais de 365 dias (preservar presença)
SELECT cron.schedule(
  'cleanup-acesso-eventos-365d',
  '0 4 1 * *',
  'DELETE FROM acesso_eventos WHERE criado_em < now() - interval ''365 days'''
);

-- Cleanup: rate_limits expirados (já tem hourly, mas adicionar deep clean)
SELECT cron.schedule(
  'cleanup-rate-limits-deep',
  '0 5 * * 0',
  'DELETE FROM rate_limits WHERE window_start < now() - interval ''7 days'''
);

-- Cleanup: wa_messages_log com mais de 90 dias
SELECT cron.schedule(
  'cleanup-wa-messages-90d',
  '0 4 * * 0',
  'DELETE FROM wa_messages_log WHERE criado_em < now() - interval ''90 days'''
);

-- Cleanup: tenant_audit_alerts resolvidos com mais de 30 dias
SELECT cron.schedule(
  'cleanup-audit-alerts-30d',
  '0 5 1 * *',
  'DELETE FROM tenant_audit_alerts WHERE resolvido = true AND criado_em < now() - interval ''30 days'''
);

-- Cleanup: sessões expiradas (reforço do existing job)
SELECT cron.schedule(
  'cleanup-all-expired-sessions',
  '0 3 * * *',
  'DELETE FROM professora_sessoes WHERE expira_em < now() - interval ''7 days'';
   DELETE FROM secretaria_sessoes WHERE expira_em < now() - interval ''7 days'';
   DELETE FROM gerente_sessoes WHERE expira_em < now() - interval ''7 days'';
   DELETE FROM admin_sessoes WHERE expira_em < now() - interval ''7 days'';
   DELETE FROM aluno_sessoes WHERE expira_em < now() - interval ''7 days'';'
);

-- ═══ PARTE C: Self-healing — auto-fix FK indexes no futuro ═══
CREATE OR REPLACE FUNCTION fn_auto_create_fk_indexes() RETURNS void AS $$
DECLARE
  r record;
  idx_name text;
  created integer := 0;
BEGIN
  FOR r IN
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_indexes pi
        WHERE pi.tablename = tc.table_name
          AND pi.indexdef LIKE '%' || kcu.column_name || '%'
      )
  LOOP
    idx_name := 'idx_' || r.table_name || '_' || r.column_name;
    IF length(idx_name) > 63 THEN idx_name := substring(idx_name, 1, 63); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = idx_name) THEN
      EXECUTE format('CREATE INDEX %I ON public.%I(%I)', idx_name, r.table_name, r.column_name);
      created := created + 1;
    END IF;
  END LOOP;
  IF created > 0 THEN
    RAISE NOTICE 'Auto-created % FK indexes', created;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Roda semanalmente para auto-criar índices em novas FKs
SELECT cron.schedule(
  'auto-fk-indexes-weekly',
  '0 5 * * 0',  -- domingo 5am
  'SELECT fn_auto_create_fk_indexes()'
);

-- ═══ PARTE D: Health check view expandida ═══
CREATE OR REPLACE VIEW v_system_health AS
SELECT
  'tables_total' as metric,
  count(*)::text as value
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'

UNION ALL

SELECT 'tenant_tables',
  count(*)::text
FROM pg_trigger WHERE tgname = 'trg_tenant_check'

UNION ALL

SELECT 'null_escola_id_tables',
  '0'  -- placeholder, real check in fn_tenant_audit_check

UNION ALL

SELECT 'missing_fk_indexes',
  count(*)::text
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM pg_indexes pi
    WHERE pi.tablename = tc.table_name AND pi.indexdef LIKE '%' || kcu.column_name || '%'
  )

UNION ALL

SELECT 'cron_jobs_active',
  count(*)::text
FROM cron.job WHERE active = true

UNION ALL

SELECT 'expired_sessions',
  (SELECT count(*) FROM sessoes WHERE expira_em < now())::text

UNION ALL

SELECT 'unread_notifications',
  (SELECT count(*) FROM notificacoes WHERE lida = false)::text;
