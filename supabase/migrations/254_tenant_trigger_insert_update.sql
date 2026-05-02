-- ════════════════════════════════════════════════════════════════
--  Migration 254: Atualiza trg_tenant_check para BEFORE INSERT OR UPDATE
--
--  O trigger original só disparava em INSERT. Isso permitia que um
--  UPDATE acidental setasse escola_id = NULL sem ser bloqueado.
--  Agora o trigger dispara em ambos INSERT e UPDATE.
-- ════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT tgrelid::regclass::text
    FROM pg_trigger
    WHERE tgname = 'trg_tenant_check'
  LOOP
    -- Remove o trigger antigo (BEFORE INSERT only)
    EXECUTE format('DROP TRIGGER IF EXISTS trg_tenant_check ON public.%I', tbl);
    -- Recria com BEFORE INSERT OR UPDATE
    EXECUTE format(
      'CREATE TRIGGER trg_tenant_check BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()',
      tbl
    );
  END LOOP;
END $$;

-- Adiciona NOT NULL constraint nas tabelas que ainda permitem NULL
-- (defesa em profundidade: trigger + constraint)
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.column_name = 'escola_id'
      AND c.table_schema = 'public'
      AND c.is_nullable = 'YES'
      AND t.table_type = 'BASE TABLE'
  LOOP
    -- Só adiciona NOT NULL se não existem registros com NULL
    EXECUTE format(
      'DO $inner$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM public.%I WHERE escola_id IS NULL LIMIT 1) THEN
          ALTER TABLE public.%I ALTER COLUMN escola_id SET NOT NULL;
        END IF;
      END $inner$;',
      tbl, tbl
    );
  END LOOP;
END $$;
