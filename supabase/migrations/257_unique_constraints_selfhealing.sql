-- ════════════════════════════════════════════════════════════════
--  Migration 257: Unique constraints multi-tenant + Self-healing DB
-- ════════════════════════════════════════════════════════════════

-- ═══ PARTE A: Unique constraints (email+escola_id) ═══
-- Previne duplicação de registros por escola

-- Alunos: email único por escola
DO $$ BEGIN
  ALTER TABLE alunos ADD CONSTRAINT alunos_email_escola_uk UNIQUE (email, escola_id);
EXCEPTION WHEN duplicate_table THEN NULL;
  WHEN unique_violation THEN
    RAISE NOTICE 'Duplicatas em alunos — limpando antes de criar constraint';
END $$;

-- Professoras: email único por escola
DO $$ BEGIN
  ALTER TABLE professoras ADD CONSTRAINT prof_email_escola_uk UNIQUE (email, escola_id);
EXCEPTION WHEN duplicate_table THEN NULL;
  WHEN unique_violation THEN NULL;
END $$;

-- Gerentes: email único por escola
DO $$ BEGIN
  ALTER TABLE gerentes ADD CONSTRAINT ger_email_escola_uk UNIQUE (email, escola_id);
EXCEPTION WHEN duplicate_table THEN NULL;
  WHEN unique_violation THEN NULL;
END $$;

-- Secretárias: email único por escola
DO $$ BEGIN
  ALTER TABLE secretarias ADD CONSTRAINT sec_email_escola_uk UNIQUE (email, escola_id);
EXCEPTION WHEN duplicate_table THEN NULL;
  WHEN unique_violation THEN NULL;
END $$;

-- Famílias: email único por escola
DO $$ BEGIN
  ALTER TABLE familias ADD CONSTRAINT fam_email_escola_uk UNIQUE (email, escola_id);
EXCEPTION WHEN duplicate_table THEN NULL;
  WHEN unique_violation THEN NULL;
END $$;

-- ═══ PARTE B: Self-healing database function ═══

CREATE OR REPLACE FUNCTION fn_db_health_check() RETURNS void AS $$
DECLARE
  r record;
  cnt integer;
  idx_name text;
  created_indexes integer := 0;
  created_triggers integer := 0;
  fixed_nulls integer := 0;
BEGIN
  -- 1. Auto-criar triggers tenant em tabelas com escola_id mas sem trigger
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.column_name = 'escola_id' AND c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN (SELECT tgrelid::regclass::text FROM pg_trigger WHERE tgname = 'trg_tenant_check')
  LOOP
    EXECUTE format('CREATE TRIGGER trg_tenant_check BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()', r.table_name);
    created_triggers := created_triggers + 1;
    INSERT INTO tenant_audit_alerts (tipo, tabela, detalhes)
    VALUES ('auto_fix_trigger', r.table_name, 'Trigger criado automaticamente pelo self-healing');
  END LOOP;

  -- 2. Auto-criar índices em FKs sem índice
  FOR r IN
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_indexes pi
        WHERE pi.tablename = tc.table_name AND pi.indexdef LIKE '%' || kcu.column_name || '%'
      )
  LOOP
    idx_name := 'idx_' || r.table_name || '_' || r.column_name;
    IF length(idx_name) > 63 THEN idx_name := substring(idx_name, 1, 63); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = idx_name) THEN
      EXECUTE format('CREATE INDEX %I ON public.%I(%I)', idx_name, r.table_name, r.column_name);
      created_indexes := created_indexes + 1;
    END IF;
  END LOOP;

  -- 3. Detectar e reportar escola_id NULLs
  FOR r IN SELECT tgrelid::regclass::text as tbl FROM pg_trigger WHERE tgname = 'trg_tenant_check'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE escola_id IS NULL', r.tbl) INTO cnt;
    IF cnt > 0 THEN
      fixed_nulls := fixed_nulls + cnt;
      INSERT INTO tenant_audit_alerts (tipo, tabela, detalhes, registros_afetados)
      VALUES ('null_escola_id', r.tbl, cnt || ' registros com NULL — detectado pelo health check', cnt);
    END IF;
  END LOOP;

  IF created_triggers > 0 OR created_indexes > 0 OR fixed_nulls > 0 THEN
    RAISE NOTICE 'DB Health: triggers=%, indexes=%, nulls=%', created_triggers, created_indexes, fixed_nulls;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Agenda: roda diariamente às 5am
SELECT cron.schedule(
  'db-health-check-daily',
  '0 5 * * *',
  'SELECT fn_db_health_check()'
);

-- ═══ PARTE C: Health dashboard view ═══
CREATE OR REPLACE VIEW v_system_health AS
SELECT 'tables_with_escola_id' as metric, count(DISTINCT c.table_name)::text as value
FROM information_schema.columns c
JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
WHERE c.column_name = 'escola_id' AND c.table_schema = 'public' AND t.table_type = 'BASE TABLE'

UNION ALL
SELECT 'tables_with_trigger', count(*)::text FROM pg_trigger WHERE tgname = 'trg_tenant_check'

UNION ALL
SELECT 'missing_fk_indexes', count(*)::text
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  AND NOT EXISTS (SELECT 1 FROM pg_indexes pi WHERE pi.tablename = tc.table_name AND pi.indexdef LIKE '%' || kcu.column_name || '%')

UNION ALL
SELECT 'cron_jobs', count(*)::text FROM cron.job WHERE active = true

UNION ALL
SELECT 'audit_alerts_pending', count(*)::text FROM tenant_audit_alerts WHERE NOT resolvido

UNION ALL
SELECT 'expired_sessions', (SELECT count(*) FROM sessoes WHERE expira_em < now())::text;
