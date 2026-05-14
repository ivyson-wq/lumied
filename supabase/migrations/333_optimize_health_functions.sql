-- ════════════════════════════════════════════════════════════════
-- Mig 333 — otimizar fn_db_health_check + fn_tenant_audit_check
-- ════════════════════════════════════════════════════════════════
-- Motivação: pg_stat_statements (audit 2026-05-14) mostrou:
--   - fn_db_health_check()    — 2 calls × 6.86s (4.1% do total)
--   - fn_tenant_audit_check() — 4 calls × 665ms (0.8%)
--   - v_system_health         — 1 call × 4.88s (1.5%)
-- Total ~6.4% do tempo de DB drenado por health checks.
--
-- Causa: ambos usam information_schema (caro em PG) + loop com
-- EXECUTE format('SELECT count(*) FROM tbl WHERE escola_id IS NULL')
-- 217 vezes (uma por tabela com trg_tenant_check).
--
-- Fix:
--   1. information_schema.{tables,columns,table_constraints,
--      key_column_usage} → pg_catalog (pg_class/attribute/constraint/
--      trigger/namespace) com indexes nativos
--   2. Loop EXECUTE 217× → 1 UNION ALL dinâmico → 1 EXECUTE só
-- Comportamento preservado (mesmos INSERTs, mesmos NOTICEs).
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_db_health_check()
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  r record;
  idx_name text;
  created_indexes integer := 0;
  created_triggers integer := 0;
  fixed_nulls integer := 0;
  null_query text := '';
  has_first boolean := false;
BEGIN
  -- 1. Auto-criar trg_tenant_check em tabelas com escola_id sem trigger
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'escola_id'
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = c.oid AND t.tgname = 'trg_tenant_check'
      )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_tenant_check BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()',
      r.table_name
    );
    created_triggers := created_triggers + 1;
    INSERT INTO tenant_audit_alerts (tipo, tabela, detalhes)
    VALUES ('auto_fix_trigger', r.table_name, 'Trigger criado automaticamente pelo self-healing');
  END LOOP;

  -- 2. Auto-criar índices em FKs sem índice
  FOR r IN
    SELECT
      c.relname AS table_name,
      a.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index ix
        WHERE ix.indrelid = con.conrelid
          AND a.attnum = ANY(ix.indkey)
      )
  LOOP
    idx_name := 'idx_' || r.table_name || '_' || r.column_name;
    IF length(idx_name) > 63 THEN idx_name := substring(idx_name, 1, 63); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = idx_name) THEN
      EXECUTE format('CREATE INDEX %I ON public.%I(%I)', idx_name, r.table_name, r.column_name);
      created_indexes := created_indexes + 1;
    END IF;
  END LOOP;

  -- 3. Contar escola_id NULL em UMA query (UNION ALL dinâmico)
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.tgname = 'trg_tenant_check'
      AND n.nspname = 'public'
  LOOP
    IF has_first THEN
      null_query := null_query || ' UNION ALL ';
    END IF;
    null_query := null_query || format(
      'SELECT %L::text AS tabela, count(*)::integer AS cnt FROM public.%I WHERE escola_id IS NULL',
      r.tbl, r.tbl
    );
    has_first := true;
  END LOOP;

  IF has_first THEN
    FOR r IN EXECUTE 'SELECT tabela, cnt FROM (' || null_query || ') x WHERE cnt > 0'
    LOOP
      fixed_nulls := fixed_nulls + r.cnt;
      INSERT INTO tenant_audit_alerts (tipo, tabela, detalhes, registros_afetados)
      VALUES ('null_escola_id', r.tabela, r.cnt || ' registros com NULL — detectado pelo health check', r.cnt);
    END LOOP;
  END IF;

  IF created_triggers > 0 OR created_indexes > 0 OR fixed_nulls > 0 THEN
    RAISE NOTICE 'DB Health: triggers=%, indexes=%, nulls=%', created_triggers, created_indexes, fixed_nulls;
  END IF;
END;
$function$;


CREATE OR REPLACE FUNCTION public.fn_tenant_audit_check()
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  r record;
  alert_count integer := 0;
  null_query text := '';
  has_first boolean := false;
BEGIN
  -- 1. Tabelas com escola_id mas sem trigger (auto-fix) — pg_catalog
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'escola_id'
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = c.oid AND t.tgname = 'trg_tenant_check'
      )
  LOOP
    INSERT INTO tenant_audit_alerts (tipo, tabela, detalhes)
    VALUES ('missing_trigger', r.table_name, 'Tabela tem escola_id mas não tem trg_tenant_check')
    ON CONFLICT DO NOTHING;
    alert_count := alert_count + 1;
    EXECUTE format(
      'CREATE TRIGGER trg_tenant_check BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()',
      r.table_name
    );
    RAISE NOTICE 'AUTO-FIX: Trigger criado em %', r.table_name;
  END LOOP;

  -- 2. Registros escola_id NULL — 1 query UNION ALL
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.tgname = 'trg_tenant_check'
      AND n.nspname = 'public'
  LOOP
    IF has_first THEN
      null_query := null_query || ' UNION ALL ';
    END IF;
    null_query := null_query || format(
      'SELECT %L::text AS tabela, count(*)::integer AS cnt FROM public.%I WHERE escola_id IS NULL',
      r.tbl, r.tbl
    );
    has_first := true;
  END LOOP;

  IF has_first THEN
    FOR r IN EXECUTE 'SELECT tabela, cnt FROM (' || null_query || ') x WHERE cnt > 0'
    LOOP
      INSERT INTO tenant_audit_alerts (tipo, tabela, detalhes, registros_afetados)
      VALUES ('null_escola_id', r.tabela, r.cnt || ' registros com escola_id NULL', r.cnt);
      alert_count := alert_count + 1;
      RAISE NOTICE 'ALERTA: % tem % registros com escola_id NULL', r.tabela, r.cnt;
    END LOOP;
  END IF;

  -- 3. Tabelas com criado_em sem escola_id (heurística) — pg_catalog
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
      AND c.relname NOT IN (
        'escolas','planos','plano_limites','plano_modulos','plano_precos',
        'lumied_staff','lumied_staff_sessoes','lumied_staff_audit',
        'modulos','permissoes_papel','faq_respostas',
        'gerente_sessoes','professora_sessoes','secretaria_sessoes','sessoes',
        'webauthn_challenges','webauthn_credentials',
        'ml_tokens','newsletter_subscribers','blog_posts','blog_topics',
        'rate_limits','tenant_audit_alerts',
        'configuracoes','config_series_idade'
      )
      AND c.relname NOT LIKE 'supabase_%'
      AND c.relname NOT LIKE 'schema_%'
      AND NOT EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'escola_id'
          AND a.attnum > 0 AND NOT a.attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'criado_em'
          AND a.attnum > 0 AND NOT a.attisdropped
      )
      AND NOT EXISTS (
        SELECT 1 FROM tenant_audit_alerts
        WHERE tabela = c.relname
          AND tipo = 'missing_column'
          AND criado_em > now() - interval '24 hours'
      )
  LOOP
    INSERT INTO tenant_audit_alerts (tipo, tabela, detalhes)
    VALUES ('missing_column', r.table_name, 'Tabela tem criado_em mas não tem escola_id — possível falha de tenant isolation');
    alert_count := alert_count + 1;
  END LOOP;

  IF alert_count > 0 THEN
    RAISE NOTICE 'Tenant audit: % alertas encontrados', alert_count;
  END IF;
END;
$function$;
