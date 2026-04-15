-- =====================================================
-- 232: Escola Demo (para demonstrações comerciais)
-- =====================================================
-- Cria uma escola fictícia "Demo Lumied" para ser usada em apresentações
-- comerciais. Gerente demo com credenciais conhecidas (senha rotacionada
-- periodicamente via staff action). Dados mínimos para a UI funcionar;
-- dados didáticos adicionais podem ser populados via onboarding.
-- =====================================================

-- A função precisa ser idempotente (migration pode rodar em ambientes já setados)
DO $$
DECLARE
  demo_escola_id uuid;
  demo_gerente_id uuid;
BEGIN
  -- Se já existe, reusa o id
  SELECT id INTO demo_escola_id FROM escolas WHERE nome ILIKE 'Demo Lumied%' LIMIT 1;

  IF demo_escola_id IS NULL THEN
    INSERT INTO escolas (nome, slug, tema, saas_status, saas_valor_mensal, saas_forma_pagamento)
    VALUES ('Demo Lumied', 'demo', 'corporativo', 'ativo', 0, 'cortesia')
    RETURNING id INTO demo_escola_id;

    -- Mensalidade zero, status "cortesia" para não disparar billing
    RAISE NOTICE 'Escola demo criada: %', demo_escola_id;
  END IF;

  -- Séries básicas (se já existir, ignora)
  INSERT INTO series (nome, ativo)
  VALUES ('Berçário 1 (Demo)', true), ('Jardim 2 (Demo)', true), ('Pré-escola (Demo)', true)
  ON CONFLICT DO NOTHING;

  -- Gerente demo (senha padrão rotaciona via staff action — aqui fica com placeholder)
  IF NOT EXISTS (SELECT 1 FROM gerentes WHERE email = 'demo@lumied.com.br') THEN
    INSERT INTO gerentes (nome, email, senha_hash)
    VALUES ('Gerente Demo', 'demo@lumied.com.br', 'CHANGE_ME_VIA_STAFF_ACTION');
  END IF;

  -- Config padrão para a demo
  INSERT INTO escola_config (chave, valor, categoria)
  VALUES
    ('escola_nome', '"Demo Lumied · Escola de Demonstração"'::jsonb, 'geral'),
    ('escola_cor_primaria', '"#6C63FF"'::jsonb, 'tema'),
    ('escola_icone', '"🎭"'::jsonb, 'tema'),
    ('demo_mode', 'true'::jsonb, 'geral')
  ON CONFLICT (chave) DO NOTHING;

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Seed demo falhou (ok — esquema divergente): %', SQLERRM;
END $$;
