-- ═══════════════════════════════════════════════════════════════
-- Rollback mig 342 — product_events
--
-- ATENÇÃO: drop perde toda telemetria histórica. Se for rollback
-- em prod, exportar primeiro pra storage:
--   COPY product_events TO '/tmp/product_events_backup.csv' CSV HEADER;
-- ═══════════════════════════════════════════════════════════════

-- O trigger é removido automaticamente com a tabela.
DROP TABLE IF EXISTS product_events CASCADE;
