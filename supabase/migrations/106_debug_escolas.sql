-- Migration 106: Debug - verificar colunas e dados de escolas
-- Listar as colunas da tabela escolas
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'escolas' ORDER BY ordinal_position
  LOOP
    RAISE NOTICE 'COL: % (% nullable=%)', r.column_name, r.data_type, r.is_nullable;
  END LOOP;

  FOR r IN SELECT id, nome, slug, subdominio, ativo FROM escolas LIMIT 5
  LOOP
    RAISE NOTICE 'ESCOLA: id=% nome=% slug=% sub=% ativo=%', r.id, r.nome, r.slug, r.subdominio, r.ativo;
  END LOOP;
END $$;
