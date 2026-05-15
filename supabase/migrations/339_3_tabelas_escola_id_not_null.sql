-- ═══════════════════════════════════════════════════════════════
--  Migration 339 — Fecha últimas 3 tabelas tenant com escola_id nullable
--
--  Resíduo do checkup 2026-05-15: audit_log_cadastro, fin_notificacao_log,
--  fin_recibos ainda tinham escola_id NULLABLE mesmo após mig 245. Em
--  prod o count de NULLs era 0 nas 3 (verificado antes da migration),
--  então SET NOT NULL é seguro.
--
--  Benefício: fn_db_health_check pula completamente a etapa de NULL audit
--  agora que zero tabelas têm escola_id nullable (drop adicional vs mig 338).
-- ═══════════════════════════════════════════════════════════════

-- Re-verificação defensiva: se houver NULL, abortar (não silenciar).
DO $$
DECLARE
  n_null integer;
BEGIN
  SELECT (SELECT count(*) FROM audit_log_cadastro WHERE escola_id IS NULL)
       + (SELECT count(*) FROM fin_notificacao_log WHERE escola_id IS NULL)
       + (SELECT count(*) FROM fin_recibos        WHERE escola_id IS NULL)
    INTO n_null;
  IF n_null > 0 THEN
    RAISE EXCEPTION 'Mig 339 abortada: % linhas com escola_id NULL nas 3 tabelas. Backfill antes.', n_null;
  END IF;
END $$;

ALTER TABLE audit_log_cadastro  ALTER COLUMN escola_id SET NOT NULL;
ALTER TABLE fin_notificacao_log ALTER COLUMN escola_id SET NOT NULL;
ALTER TABLE fin_recibos         ALTER COLUMN escola_id SET NOT NULL;
