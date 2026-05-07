-- ═══════════════════════════════════════════════════════════════
--  Migration 277 — RLS forced em todas tabelas tenant restantes
--
--  Continuação da 276 (que cobriu LGPD/financeiro/contratos).
--  Service_role bypassa RLS automaticamente, então edge functions
--  continuam funcionando. Bloqueia acesso direto via REST com anon
--  key — defesa em profundidade caso a chave vaze.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  r record;
  total int := 0;
  ja int := 0;
BEGIN
  FOR r IN
    SELECT t.tablename
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE t.schemaname = 'public'
      AND n.nspname = 'public'
      AND c.relrowsecurity = false
      AND EXISTS (
        SELECT 1 FROM information_schema.columns ic
        WHERE ic.table_name = t.tablename AND ic.column_name = 'escola_id'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tablename);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.tablename);
      total := total + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Falhou em %: %', r.tablename, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'RLS forced em % tabela(s) tenant', total;
END $$;
