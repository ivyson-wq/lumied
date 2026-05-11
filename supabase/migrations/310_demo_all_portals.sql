-- =====================================================
-- 310: Demo unificado — mesmo user/senha em TODOS os portais
-- =====================================================
-- Email: demo@lumied.com.br
-- Senha: LumiedDemo2026!
-- Hash PBKDF2-SHA256 100k iter, salt fixo hex:hex
--
-- Portais cobertos:
--   ✓ Gerente (já existia em 233/234)
--   ✓ Professora (já existia em 233 — ana.demo, beatriz.demo, etc.)
--   + Secretaria (NOVO)
--   + Admin Escola (NOVO)
--   + Aluno (NOVO — alunos_login)
--   + Lumied Staff / Admin Central (NOVO)
--
-- Idempotente. ON CONFLICT DO NOTHING ou DO UPDATE.
-- =====================================================

DO $$
DECLARE
  pw_hash text := 'a1b2c3d4e5f607182930415263748596:d6e7fd9b50d06fea9ade077a5d5bdda3ab8e5a33a621eb7e8b776eadcc6b6250';
  demo_escola_id uuid;
  demo_serie_id uuid;
BEGIN
  -- Resolve escola demo
  SELECT id INTO demo_escola_id FROM escolas WHERE slug = 'demo' LIMIT 1;
  IF demo_escola_id IS NULL THEN
    SELECT id INTO demo_escola_id FROM escolas WHERE nome ILIKE 'Demo Lumied%' LIMIT 1;
  END IF;
  IF demo_escola_id IS NULL THEN
    RAISE NOTICE '[310] Escola demo não encontrada. Abortando.';
    RETURN;
  END IF;

  -- Resolve uma série demo para vincular aluno
  SELECT id INTO demo_serie_id FROM series WHERE nome ILIKE '%Demo%' AND escola_id = demo_escola_id LIMIT 1;
  IF demo_serie_id IS NULL THEN
    SELECT id INTO demo_serie_id FROM series WHERE escola_id = demo_escola_id LIMIT 1;
  END IF;

  -- ══════════════════════════════════════════════════════════
  -- 1. SECRETARIA
  -- ══════════════════════════════════════════════════════════
  BEGIN
    INSERT INTO secretarias (nome, email, senha_hash, escola_id)
    VALUES ('Secretária Demo', 'demo@lumied.com.br', pw_hash, demo_escola_id)
    ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, escola_id = EXCLUDED.escola_id;
    RAISE NOTICE '[310] Secretaria demo OK.';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[310] Secretaria: %', SQLERRM;
  END;

  -- ══════════════════════════════════════════════════════════
  -- 2. ADMIN ESCOLA (tabela admins NÃO tem escola_id)
  -- ══════════════════════════════════════════════════════════
  BEGIN
    INSERT INTO admins (nome, email, senha_hash)
    VALUES ('Admin Demo', 'demo@lumied.com.br', pw_hash)
    ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash;
    RAISE NOTICE '[310] Admin escola demo OK.';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[310] Admin: %', SQLERRM;
  END;

  -- ══════════════════════════════════════════════════════════
  -- 3. ALUNO (alunos_login) — desabilita user triggers para evitar
  --    conflito com sync_aluno_login_to_usuarios + enforce_tenant
  -- ══════════════════════════════════════════════════════════
  BEGIN
    -- Garante escola_id no usuarios antes (trigger precisa)
    UPDATE usuarios SET escola_id = demo_escola_id WHERE email = 'demo@lumied.com.br' AND escola_id IS NULL;

    ALTER TABLE alunos_login DISABLE TRIGGER USER;

    INSERT INTO alunos_login (aluno_nome, email, senha_hash, familia_email, serie, ativo, escola_id)
    VALUES ('Aluno Demo', 'demo@lumied.com.br', pw_hash, 'demo@lumied.com.br', 'Jardim 2 (Demo)', true, demo_escola_id)
    ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, ativo = true, escola_id = demo_escola_id;

    ALTER TABLE alunos_login ENABLE TRIGGER USER;

    -- Garante papel aluno no usuarios
    UPDATE usuarios SET papeis = CASE
      WHEN 'aluno' = ANY(papeis) THEN papeis
      ELSE array_append(papeis, 'aluno')
    END WHERE email = 'demo@lumied.com.br';

    RAISE NOTICE '[310] Aluno login demo OK.';
  EXCEPTION WHEN OTHERS THEN
    -- Re-habilita triggers mesmo em caso de erro
    ALTER TABLE alunos_login ENABLE TRIGGER USER;
    RAISE NOTICE '[310] Aluno login: %', SQLERRM;
  END;

  -- ══════════════════════════════════════════════════════════
  -- 4. LUMIED STAFF (Admin Central)
  -- ══════════════════════════════════════════════════════════
  BEGIN
    INSERT INTO lumied_staff (nome, email, senha_hash, cargo)
    VALUES ('Staff Demo', 'demo@lumied.com.br', pw_hash, 'suporte')
    ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash;
    RAISE NOTICE '[310] Lumied Staff demo OK.';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[310] Lumied Staff: %', SQLERRM;
  END;

  -- ══════════════════════════════════════════════════════════
  -- 5. USUARIOS (tabela unificada — garante sync)
  -- ══════════════════════════════════════════════════════════
  BEGIN
    UPDATE usuarios
       SET senha_hash = pw_hash
     WHERE email = 'demo@lumied.com.br';
    -- Se não existe, a trigger de sync das tabelas legadas deve criar.
    -- Mas garante papéis amplos para o demo ver tudo:
    UPDATE usuarios
       SET papeis = ARRAY['gerente','secretaria','financeiro','comercial','manutencao']::text[]
     WHERE email = 'demo@lumied.com.br';
    RAISE NOTICE '[310] Usuarios sync OK.';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[310] Usuarios: %', SQLERRM;
  END;

  -- ══════════════════════════════════════════════════════════
  -- 6. REFORÇO: Gerente + Professoras (idempotente)
  -- ══════════════════════════════════════════════════════════
  BEGIN
    UPDATE gerentes SET senha_hash = pw_hash WHERE email = 'demo@lumied.com.br';
    UPDATE professoras SET senha_hash = pw_hash WHERE email LIKE '%.demo@lumied.com.br';
    RAISE NOTICE '[310] Gerente + Professoras reforçados.';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[310] Reforço: %', SQLERRM;
  END;

  -- ══════════════════════════════════════════════════════════
  -- 7. PAIS (Supabase Auth — magic link, mas garante que existe)
  -- ══════════════════════════════════════════════════════════
  -- Portal Pais usa magic link via Supabase Auth.
  -- Cadastra familia com email demo para que o link funcione.
  BEGIN
    INSERT INTO familias (nome_resp, email, telefone, escola_id)
    VALUES ('Família Demo', 'demo@lumied.com.br', '(54) 99000-0000', demo_escola_id)
    ON CONFLICT (email) DO UPDATE SET escola_id = EXCLUDED.escola_id;
    RAISE NOTICE '[310] Familia demo OK.';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[310] Familia: %', SQLERRM;
  END;

END $$;
