-- Migration 108: Verify escola data
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, nome, slug, subdominio, plano, plano_id, ativo FROM escolas LIMIT 5
  LOOP
    RAISE NOTICE 'ESCOLA: nome=% slug=% sub=% plano=% plano_id=% ativo=%', r.nome, r.slug, r.subdominio, r.plano, r.plano_id, r.ativo;
  END LOOP;
END $$;
