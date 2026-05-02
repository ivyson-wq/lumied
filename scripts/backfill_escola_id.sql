DO $$
DECLARE
  r record;
  cnt integer;
BEGIN
  FOR r IN
    SELECT tgrelid::regclass::text as tbl
    FROM pg_trigger
    WHERE tgname = 'trg_tenant_check'
    ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE escola_id IS NULL', r.tbl) INTO cnt;
    IF cnt > 0 THEN
      RAISE NOTICE 'NULL escola_id: % = % rows', r.tbl, cnt;
      EXECUTE format('UPDATE public.%I SET escola_id = ''f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'' WHERE escola_id IS NULL', r.tbl);
    END IF;
  END LOOP;
END $$;
