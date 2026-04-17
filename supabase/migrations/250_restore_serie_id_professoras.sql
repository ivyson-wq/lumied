-- ═══════════════════════════════════════════════════════════════
--  Migration 250 — Restore serie_id in professoras + fix trigger
-- ═══════════════════════════════════════════════════════════════
-- Problem: Migration 243 did `UPDATE usuarios SET escola_id = ...` which
-- fired `sync_usuario_to_legacy`. The trigger's ON CONFLICT clause
-- unconditionally sets `serie_id = EXCLUDED.serie_id`, overwriting real
-- serie_id values with NULL (since usuarios.serie_id is typically NULL).
--
-- Fix:
--   1. Restore serie_id from alm_requisicoes.turma_id (most recent per teacher)
--   2. Patch trigger to use COALESCE so it never overwrites non-null values with NULL
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- PARTE A — Restore serie_id from alm_requisicoes (most recent per teacher)
-- ────────────────────────────────────────────────────────────────

-- Use the most recent alm_requisicao per professora to recover serie_id.
-- Only update rows where serie_id is currently NULL (idempotent).
UPDATE professoras p
SET serie_id = sub.turma_id
FROM (
  SELECT DISTINCT ON (r.professora_id)
    r.professora_id,
    r.turma_id
  FROM alm_requisicoes r
  JOIN series s ON s.id = r.turma_id  -- ensure turma_id is a valid serie
  WHERE r.turma_id IS NOT NULL
  ORDER BY r.professora_id, r.criado_em DESC
) sub
WHERE p.id = sub.professora_id
  AND p.serie_id IS NULL
  AND p.escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b';

-- Log how many were restored
DO $$
DECLARE
  v_restored int;
  v_still_null int;
BEGIN
  SELECT count(*) INTO v_still_null
  FROM professoras
  WHERE escola_id = 'f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'
    AND serie_id IS NULL;

  RAISE NOTICE 'Mig 250 — Professoras Maple Bear still without serie_id: %', v_still_null;
END $$;

-- ────────────────────────────────────────────────────────────────
-- PARTE B — Fix sync_usuario_to_legacy trigger to use COALESCE
-- ────────────────────────────────────────────────────────────────
-- The ON CONFLICT clause now uses COALESCE: if the incoming value
-- (from usuarios) is NULL, keep the existing value in the legacy table.
-- This prevents future escola_id backfills or user updates from
-- accidentally wiping serie_id / series_monitoras.

CREATE OR REPLACE FUNCTION sync_usuario_to_legacy()
RETURNS TRIGGER AS $$
DECLARE
  v_roles text[];
  v_features text[] := '{}';
BEGIN
  v_roles := COALESCE(NEW.papeis, ARRAY[NEW.papel]);

  IF NEW.papel IN ('gerente', 'diretor', 'financeiro') OR
     v_roles && ARRAY['gerente', 'diretor', 'financeiro'] THEN
    INSERT INTO gerentes (id, nome, email, senha_hash, escola_id, criado_em)
    VALUES (NEW.id, NEW.nome, NEW.email, NEW.senha_hash, NEW.escola_id, NEW.criado_em)
    ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, escola_id = EXCLUDED.escola_id;
  END IF;

  IF NEW.papel IN ('professora', 'professora_assistente', 'manutencao') OR
     v_roles && ARRAY['professora', 'professora_assistente', 'manutencao'] THEN
    DECLARE v_tipo text;
    BEGIN
      v_tipo := COALESCE(
        NEW.tipo,
        CASE
          WHEN 'professora' = ANY(v_roles) THEN 'professora'
          WHEN 'professora_assistente' = ANY(v_roles) THEN 'professora_assistente'
          WHEN 'manutencao' = ANY(v_roles) THEN 'manutencao'
          ELSE 'professora'
        END
      );
    INSERT INTO professoras (id, nome, email, senha_hash, tipo, serie_id, series_monitoras, escola_id, criado_em)
    VALUES (NEW.id, NEW.nome, NEW.email, NEW.senha_hash, v_tipo, NEW.serie_id, COALESCE(NEW.series_monitoras, '{}'), NEW.escola_id, NEW.criado_em)
    ON CONFLICT (email) DO UPDATE SET
      nome = EXCLUDED.nome,
      senha_hash = EXCLUDED.senha_hash,
      tipo = EXCLUDED.tipo,
      serie_id = COALESCE(EXCLUDED.serie_id, professoras.serie_id),
      series_monitoras = COALESCE(EXCLUDED.series_monitoras, professoras.series_monitoras),
      escola_id = EXCLUDED.escola_id;
    END;
  END IF;

  IF NEW.papel IN ('secretaria', 'comercial', 'financeiro', 'diretor', 'manutencao', 'impressao') OR
     v_roles && ARRAY['secretaria', 'comercial', 'financeiro', 'diretor', 'manutencao', 'impressao'] THEN
    IF 'secretaria' = ANY(v_roles) THEN v_features := v_features || ARRAY['atestados']; END IF;
    IF 'comercial' = ANY(v_roles) THEN v_features := v_features || ARRAY['crm', 'templates', 'metas']; END IF;
    IF 'financeiro' = ANY(v_roles) OR 'diretor' = ANY(v_roles) THEN v_features := v_features || ARRAY['financeiro']; END IF;
    IF 'manutencao' = ANY(v_roles) THEN v_features := v_features || ARRAY['manutencao']; END IF;
    IF 'impressao' = ANY(v_roles) THEN v_features := v_features || ARRAY['impressao']; END IF;
    IF array_length(v_features, 1) IS NULL THEN v_features := ARRAY['atestados']; END IF;

    INSERT INTO secretarias (id, nome, email, senha_hash, features, escola_id, criado_em)
    VALUES (NEW.id, NEW.nome, NEW.email, NEW.senha_hash, v_features, NEW.escola_id, NEW.criado_em)
    ON CONFLICT (email) DO UPDATE SET
      nome = EXCLUDED.nome,
      senha_hash = EXCLUDED.senha_hash,
      features = EXCLUDED.features,
      escola_id = EXCLUDED.escola_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
