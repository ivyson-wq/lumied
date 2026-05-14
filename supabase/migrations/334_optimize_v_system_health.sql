-- ════════════════════════════════════════════════════════════════
-- Mig 334 — otimizar v_system_health (information_schema → pg_catalog)
-- ════════════════════════════════════════════════════════════════
-- Motivação: pg_stat_statements (audit 2026-05-14) — 4.88s/call
-- (1.5% do tempo total). Mesma causa de fn_db_health_check antes da
-- mig 333: information_schema é caro em PG, e a view usa duas vezes
-- (tables_with_escola_id + missing_fk_indexes).
--
-- Fix: trocar por pg_catalog (pg_class/attribute/constraint/index).
-- Shape preservada (6 métricas, mesmos nomes, mesmo type text) pra
-- não quebrar consumidores.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_system_health AS
  SELECT 'tables_with_escola_id'::text AS metric,
         count(DISTINCT c.oid)::text   AS value
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'escola_id'
    WHERE c.relkind  = 'r'
      AND n.nspname = 'public'
      AND a.attnum  > 0
      AND NOT a.attisdropped
UNION ALL
  SELECT 'tables_with_trigger', count(*)::text
    FROM pg_trigger
    WHERE tgname = 'trg_tenant_check'
UNION ALL
  SELECT 'missing_fk_indexes', count(*)::text
    FROM pg_constraint con
    JOIN pg_class     c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = con.conrelid
                       AND a.attnum   = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND n.nspname   = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index ix
        WHERE ix.indrelid = con.conrelid
          AND a.attnum    = ANY(ix.indkey)
      )
UNION ALL
  SELECT 'cron_jobs', count(*)::text
    FROM cron.job
    WHERE active = true
UNION ALL
  SELECT 'audit_alerts_pending', count(*)::text
    FROM tenant_audit_alerts
    WHERE NOT resolvido
UNION ALL
  SELECT 'expired_sessions',
         (SELECT count(*) FROM sessoes WHERE expira_em < now())::text;
