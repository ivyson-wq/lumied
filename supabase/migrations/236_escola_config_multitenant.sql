-- =====================================================
-- 236: escola_config multi-tenant
-- =====================================================
-- Corrige bug crítico: escola_config era single-tenant (PK apenas em
-- chave), o que fazia toda nova escola onboarded compartilhar a config
-- da primeira escola (Maple Bear Caxias). A partir desta migration:
--   · escola_id obrigatório em cada linha
--   · PK composta (chave, escola_id) — cada escola tem seu próprio conjunto
--   · Rows existentes são atribuídas à escola default (primeira ativa)
--   · Depois é replicado para todas as outras escolas como template
-- =====================================================

-- 1. Adicionar coluna (nullable primeiro, para backfill)
ALTER TABLE escola_config
  ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;

-- 2. Backfill — atribui rows órfãs à primeira escola ativa (normalmente Maple Bear Caxias)
DO $$
DECLARE
  default_escola_id uuid;
  outras_escolas_ids uuid[];
  outra_escola uuid;
  cfg record;
BEGIN
  SELECT id INTO default_escola_id FROM escolas WHERE ativo = true ORDER BY criado_em LIMIT 1;

  IF default_escola_id IS NULL THEN
    RAISE NOTICE 'Nenhuma escola ativa. Migration 236 parcial — backfill ignorado.';
    RETURN;
  END IF;

  -- Backfill órfãs
  UPDATE escola_config SET escola_id = default_escola_id WHERE escola_id IS NULL;

  -- Copiar config da escola default para todas as outras escolas (se não tiverem)
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO outras_escolas_ids
    FROM escolas WHERE ativo = true AND id <> default_escola_id;

  FOREACH outra_escola IN ARRAY outras_escolas_ids LOOP
    FOR cfg IN SELECT chave, valor, descricao, categoria FROM escola_config WHERE escola_id = default_escola_id LOOP
      INSERT INTO escola_config (chave, valor, descricao, categoria, escola_id)
      VALUES (cfg.chave, cfg.valor, cfg.descricao, cfg.categoria, outra_escola)
      ON CONFLICT DO NOTHING;
    END LOOP;
    RAISE NOTICE 'Config replicada para escola %.', outra_escola;
  END LOOP;
END $$;

-- 3. Tornar NOT NULL (depois do backfill)
ALTER TABLE escola_config ALTER COLUMN escola_id SET NOT NULL;

-- 4. Trocar PK: (chave) → (chave, escola_id)
DO $$
DECLARE
  pk_name text;
BEGIN
  SELECT conname INTO pk_name
    FROM pg_constraint
   WHERE conrelid = 'escola_config'::regclass AND contype = 'p';
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE escola_config DROP CONSTRAINT %I', pk_name);
  END IF;
  ALTER TABLE escola_config ADD PRIMARY KEY (chave, escola_id);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_escola_config_escola ON escola_config(escola_id);

-- 5. Para a escola Demo Lumied: override de branding (remove Maple Bear)
DO $$
DECLARE
  demo_id uuid;
BEGIN
  SELECT id INTO demo_id FROM escolas WHERE nome ILIKE 'Demo Lumied%' LIMIT 1;
  IF demo_id IS NOT NULL THEN
    INSERT INTO escola_config (chave, valor, categoria, escola_id) VALUES
      ('escola_nome',   '"Demo Lumied"'::jsonb,  'escola',   demo_id),
      ('escola_icone',  '"🎭"'::jsonb,             'tema',     demo_id),
      ('escola_logo_url', '"/lumied-logo-preto.png"'::jsonb, 'branding', demo_id),
      ('cor_primaria',  '"#6C63FF"'::jsonb,       'tema',     demo_id)
    ON CONFLICT (chave, escola_id) DO UPDATE
      SET valor = EXCLUDED.valor, atualizado_em = now();
  END IF;
END $$;

COMMENT ON COLUMN escola_config.escola_id IS 'FK para escolas — obrigatório desde mig 236. Configs são per-escola.';
