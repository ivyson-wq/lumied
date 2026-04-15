-- =====================================================
-- 234: Garante senha funcional do gerente demo
-- =====================================================
-- Isolado da 233 (que pode falhar em outros blocos e abortar o password).
-- Hash PBKDF2-SHA256 da senha "LumiedDemo2026!" com salt fixo a1b2...
-- Formato hex:hex, 100k iterações — compatível com verificarSenha()
-- =====================================================

DO $$
DECLARE
  pw_hash text := 'a1b2c3d4e5f607182930415263748596:d6e7fd9b50d06fea9ade077a5d5bdda3ab8e5a33a621eb7e8b776eadcc6b6250';
  demo_escola_id uuid;
  rows_updated int;
BEGIN
  SELECT id INTO demo_escola_id FROM escolas WHERE nome ILIKE 'Demo Lumied%' LIMIT 1;
  IF demo_escola_id IS NULL THEN
    INSERT INTO escolas (nome, slug, saas_status, saas_valor_mensal)
    VALUES ('Demo Lumied', 'demo', 'ativo', 0)
    RETURNING id INTO demo_escola_id;
    RAISE NOTICE 'Escola demo criada em 234: %', demo_escola_id;
  END IF;

  -- Força senha + vínculo com escola demo
  UPDATE gerentes
     SET senha_hash = pw_hash,
         escola_id  = demo_escola_id
   WHERE email = 'demo@lumied.com.br';

  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  IF rows_updated = 0 THEN
    -- Gerente não existe ainda — cria
    BEGIN
      INSERT INTO gerentes (nome, email, senha_hash, escola_id)
      VALUES ('Gerente Demo', 'demo@lumied.com.br', pw_hash, demo_escola_id);
      RAISE NOTICE 'Gerente demo criado em 234.';
    EXCEPTION WHEN OTHERS THEN
      -- Fallback sem escola_id se a coluna não existir
      INSERT INTO gerentes (nome, email, senha_hash)
      VALUES ('Gerente Demo', 'demo@lumied.com.br', pw_hash)
      ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash;
      RAISE NOTICE 'Gerente demo criado (fallback sem escola_id): %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'Senha do gerente demo atualizada (% linha(s)).', rows_updated;
  END IF;

  -- Sincronizar com usuarios (se tabela existir e houver vínculo)
  BEGIN
    UPDATE usuarios
       SET senha_hash = pw_hash
     WHERE email = 'demo@lumied.com.br';
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    IF rows_updated > 0 THEN
      RAISE NOTICE 'Sincronizado em usuarios: % linha(s).', rows_updated;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Sync usuarios ignorado: %', SQLERRM;
  END;

END $$;
