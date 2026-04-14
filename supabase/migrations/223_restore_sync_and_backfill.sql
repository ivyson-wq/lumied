-- ═══════════════════════════════════════════════════════
-- 223 — Restaura trigger completo (regressão da 212) + backfill global
--
-- Contexto:
--   - Migration 221 introduziu trigger completo (gerente/diretor/financeiro,
--     professora/prof_ass/manutencao, e portal-da-equipe com features).
--   - Migration 212 (aplicada depois via management API) sobrescreveu o trigger
--     com uma versão simplificada, removendo suporte a comercial/financeiro/
--     diretor/impressao na sync para `secretarias` e a derivação de features.
--
-- Esta migration:
--   1. Restaura a função `sync_usuario_to_legacy` na versão completa da 221.
--   2. Estende o backfill para também corrigir `gerentes` e `professoras`
--      (a 221 só fazia backfill de secretarias).
-- ═══════════════════════════════════════════════════════

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
    -- tipo DEVE bater com check constraint de professoras.tipo
    -- (não podemos usar papel=diretor/gerente aqui). Derivar do papeis.
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
    ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, tipo = EXCLUDED.tipo, serie_id = EXCLUDED.serie_id, series_monitoras = EXCLUDED.series_monitoras, escola_id = EXCLUDED.escola_id;
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

-- Backfill via no-op UPDATE em usuarios ativos — dispara o trigger e corrige
-- todas as tabelas legadas de uma vez.
UPDATE usuarios SET nome = nome WHERE ativo = true;
