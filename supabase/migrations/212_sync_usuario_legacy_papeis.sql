-- ═══════════════════════════════════════════════════════
-- 212 — [SUPERSEDED] Corrige sync usuarios → tabelas legadas
--
-- ⚠️  Esta migration foi SOBRESCRITA pela 223 e deveria ter sido
--    um no-op após a 221. O trigger definitivo é o da 223 (gerentes/
--    professoras/secretarias com features derivadas + suporte a
--    diretor/comercial/financeiro/impressao). A 224 corrige o FK
--    do sync de sessões. Mantida aqui só pelo histórico — NÃO edite.
--
-- Bug original: trigger sync_usuario_to_legacy usava NEW.papel (string),
-- mas usuários podem ter múltiplos papéis em NEW.papeis (array).
-- Resultado: quando gerente também era professora, só `gerentes`
-- recebia senha_hash/escola_id; `professoras` ficava com NULL e
-- o login da professora falhava.
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sync_usuario_to_legacy()
RETURNS TRIGGER AS $$
DECLARE
  v_papeis text[];
BEGIN
  -- Preferir array `papeis`; fallback para singular `papel`
  v_papeis := CASE
    WHEN NEW.papeis IS NOT NULL AND array_length(NEW.papeis, 1) > 0 THEN NEW.papeis
    WHEN NEW.papel IS NOT NULL THEN ARRAY[NEW.papel]
    ELSE ARRAY[]::text[]
  END;

  IF 'gerente' = ANY(v_papeis) THEN
    INSERT INTO gerentes (id, nome, email, senha_hash, escola_id, criado_em)
    VALUES (NEW.id, NEW.nome, NEW.email, NEW.senha_hash, NEW.escola_id, NEW.criado_em)
    ON CONFLICT (email) DO UPDATE SET
      nome = EXCLUDED.nome,
      senha_hash = EXCLUDED.senha_hash,
      escola_id = EXCLUDED.escola_id;
  END IF;

  IF 'professora' = ANY(v_papeis)
     OR 'professora_assistente' = ANY(v_papeis)
     OR 'manutencao' = ANY(v_papeis) THEN
    INSERT INTO professoras (id, nome, email, senha_hash, tipo, serie_id, series_monitoras, escola_id, criado_em)
    VALUES (
      NEW.id, NEW.nome, NEW.email, NEW.senha_hash,
      COALESCE(
        NEW.tipo,
        CASE
          WHEN 'professora' = ANY(v_papeis) THEN 'professora'
          WHEN 'professora_assistente' = ANY(v_papeis) THEN 'professora_assistente'
          ELSE 'manutencao'
        END
      ),
      NEW.serie_id,
      COALESCE(NEW.series_monitoras, '{}'),
      NEW.escola_id,
      NEW.criado_em
    )
    ON CONFLICT (email) DO UPDATE SET
      nome = EXCLUDED.nome,
      senha_hash = EXCLUDED.senha_hash,
      tipo = EXCLUDED.tipo,
      serie_id = EXCLUDED.serie_id,
      series_monitoras = EXCLUDED.series_monitoras,
      escola_id = EXCLUDED.escola_id;
  END IF;

  IF 'secretaria' = ANY(v_papeis) THEN
    INSERT INTO secretarias (id, nome, email, senha_hash, escola_id, criado_em)
    VALUES (NEW.id, NEW.nome, NEW.email, NEW.senha_hash, NEW.escola_id, NEW.criado_em)
    ON CONFLICT (email) DO UPDATE SET
      nome = EXCLUDED.nome,
      senha_hash = EXCLUDED.senha_hash,
      escola_id = EXCLUDED.escola_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill: força re-sincronização de todos os usuários para
-- preencher senha_hash/escola_id ausentes nas tabelas legadas.
UPDATE usuarios SET nome = nome WHERE ativo = true;
