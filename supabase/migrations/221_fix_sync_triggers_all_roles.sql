-- ═══════════════════════════════════════════════════════
-- Migration 221: Fix legacy sync triggers to handle ALL roles
--
-- Problem: trg_sync_usuario_legacy and trg_sync_sessao_legacy only
-- handled gerente, professora/prof_assistente/manutencao, and secretaria.
-- Roles like impressao, comercial, financeiro, diretor were NOT synced
-- to the secretarias table, causing users to be invisible in the
-- Portal da Equipe (secretaria.html).
-- ═══════════════════════════════════════════════════════

-- 1. Fix sync_usuario_to_legacy: handle all roles that use Portal da Equipe
CREATE OR REPLACE FUNCTION sync_usuario_to_legacy()
RETURNS TRIGGER AS $$
DECLARE
  v_roles text[];
  v_features text[] := '{}';
BEGIN
  -- Use papeis array if available, otherwise fall back to papel column
  v_roles := COALESCE(NEW.papeis, ARRAY[NEW.papel]);

  -- Sync to gerentes if gerente/diretor/financeiro
  IF NEW.papel IN ('gerente', 'diretor', 'financeiro') OR
     v_roles && ARRAY['gerente', 'diretor', 'financeiro'] THEN
    INSERT INTO gerentes (id, nome, email, senha_hash, escola_id, criado_em)
    VALUES (NEW.id, NEW.nome, NEW.email, NEW.senha_hash, NEW.escola_id, NEW.criado_em)
    ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, escola_id = EXCLUDED.escola_id;
  END IF;

  -- Sync to professoras if professora/prof_assistente/manutencao
  IF NEW.papel IN ('professora', 'professora_assistente', 'manutencao') OR
     v_roles && ARRAY['professora', 'professora_assistente', 'manutencao'] THEN
    INSERT INTO professoras (id, nome, email, senha_hash, tipo, serie_id, series_monitoras, escola_id, criado_em)
    VALUES (NEW.id, NEW.nome, NEW.email, NEW.senha_hash, COALESCE(NEW.tipo, NEW.papel), NEW.serie_id, COALESCE(NEW.series_monitoras, '{}'), NEW.escola_id, NEW.criado_em)
    ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, tipo = EXCLUDED.tipo, serie_id = EXCLUDED.serie_id, series_monitoras = EXCLUDED.series_monitoras, escola_id = EXCLUDED.escola_id;
  END IF;

  -- Sync to secretarias if any Portal da Equipe role
  IF NEW.papel IN ('secretaria', 'comercial', 'financeiro', 'diretor', 'manutencao', 'impressao') OR
     v_roles && ARRAY['secretaria', 'comercial', 'financeiro', 'diretor', 'manutencao', 'impressao'] THEN
    -- Auto-derive features from roles
    IF 'secretaria' = ANY(v_roles) THEN v_features := v_features || ARRAY['atestados']; END IF;
    IF 'comercial' = ANY(v_roles) THEN v_features := v_features || ARRAY['crm', 'templates', 'metas']; END IF;
    IF 'financeiro' = ANY(v_roles) OR 'diretor' = ANY(v_roles) THEN v_features := v_features || ARRAY['financeiro']; END IF;
    IF 'manutencao' = ANY(v_roles) THEN v_features := v_features || ARRAY['manutencao']; END IF;
    IF 'impressao' = ANY(v_roles) THEN v_features := v_features || ARRAY['impressao']; END IF;
    -- Default to atestados if no features derived
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

-- 2. Fix sync_sessao_to_legacy: handle all roles for session sync
CREATE OR REPLACE FUNCTION sync_sessao_to_legacy()
RETURNS TRIGGER AS $$
DECLARE
  v_papel text;
  v_papeis text[];
BEGIN
  SELECT papel, papeis INTO v_papel, v_papeis FROM usuarios WHERE id = NEW.usuario_id;
  v_papeis := COALESCE(v_papeis, ARRAY[v_papel]);

  -- Sync to gerente_sessoes
  IF v_papel IN ('gerente', 'diretor', 'financeiro') OR
     v_papeis && ARRAY['gerente', 'diretor', 'financeiro'] THEN
    INSERT INTO gerente_sessoes (gerente_id, token, expira_em, criado_em)
    VALUES (NEW.usuario_id, NEW.token, NEW.expira_em, NEW.criado_em)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Sync to professora_sessoes
  IF v_papel IN ('professora', 'professora_assistente', 'manutencao') OR
     v_papeis && ARRAY['professora', 'professora_assistente', 'manutencao'] THEN
    INSERT INTO professora_sessoes (professora_id, token, expira_em, criado_em)
    VALUES (NEW.usuario_id, NEW.token, NEW.expira_em, NEW.criado_em)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Sync to secretaria_sessoes
  IF v_papel IN ('secretaria', 'comercial', 'financeiro', 'diretor', 'manutencao', 'impressao') OR
     v_papeis && ARRAY['secretaria', 'comercial', 'financeiro', 'diretor', 'manutencao', 'impressao'] THEN
    -- Need secretaria_id from secretarias table
    DECLARE
      v_sec_id uuid;
    BEGIN
      SELECT id INTO v_sec_id FROM secretarias WHERE email = (SELECT email FROM usuarios WHERE id = NEW.usuario_id) LIMIT 1;
      IF v_sec_id IS NOT NULL THEN
        INSERT INTO secretaria_sessoes (secretaria_id, token, expira_em, criado_em)
        VALUES (v_sec_id, NEW.token, NEW.expira_em, NEW.criado_em)
        ON CONFLICT DO NOTHING;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Backfill: ensure all existing users with Portal da Equipe roles have secretarias rows
DO $$
DECLARE
  r RECORD;
  v_features text[];
BEGIN
  FOR r IN
    SELECT u.id, u.nome, u.email, u.senha_hash, u.papeis, u.papel, u.escola_id, u.criado_em
    FROM usuarios u
    WHERE u.ativo = true
      AND (
        u.papel IN ('secretaria','comercial','financeiro','diretor','manutencao','impressao')
        OR u.papeis && ARRAY['secretaria','comercial','financeiro','diretor','manutencao','impressao']
      )
      AND NOT EXISTS (SELECT 1 FROM secretarias s WHERE s.email = u.email)
  LOOP
    v_features := '{}';
    IF 'secretaria' = ANY(COALESCE(r.papeis, ARRAY[r.papel])) THEN v_features := v_features || ARRAY['atestados']; END IF;
    IF 'comercial' = ANY(COALESCE(r.papeis, ARRAY[r.papel])) THEN v_features := v_features || ARRAY['crm','templates','metas']; END IF;
    IF 'financeiro' = ANY(COALESCE(r.papeis, ARRAY[r.papel])) OR 'diretor' = ANY(COALESCE(r.papeis, ARRAY[r.papel])) THEN v_features := v_features || ARRAY['financeiro']; END IF;
    IF 'manutencao' = ANY(COALESCE(r.papeis, ARRAY[r.papel])) THEN v_features := v_features || ARRAY['manutencao']; END IF;
    IF 'impressao' = ANY(COALESCE(r.papeis, ARRAY[r.papel])) THEN v_features := v_features || ARRAY['impressao']; END IF;
    IF array_length(v_features, 1) IS NULL THEN v_features := ARRAY['atestados']; END IF;

    INSERT INTO secretarias (id, nome, email, senha_hash, features, escola_id, criado_em, ativo)
    VALUES (r.id, r.nome, r.email, r.senha_hash, v_features, r.escola_id, r.criado_em, true)
    ON CONFLICT (email) DO NOTHING;
  END LOOP;
END $$;
