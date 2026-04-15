-- =====================================================
-- 233: Escola Demo — dados populados para screenshots
-- =====================================================
-- Enriquece a escola "Demo Lumied" criada em 232 com:
--   · gerente demo com senha funcional (LumiedDemo2026!)
--   · 4 professoras, 25 alunos, 25 famílias
--   · catálogo de insumos + orçamentos + requisições em vários estados
--   · 3 meses de mensalidades com mix de status
--   · inadimplências com tratativas manuais e log de envios
--   · 2 comunicados enviados
--
-- Idempotente. Seguro para rodar várias vezes.
-- Usa EXCEPTION blocks para sobreviver a divergências de esquema.
-- =====================================================

DO $$
DECLARE
  demo_escola_id   uuid;
  demo_gerente_id  uuid;
  serie_b1         uuid;
  serie_j2         uuid;
  serie_pre        uuid;
  prof_ids         uuid[];
  aluno_ids        uuid[];
  turma_id         uuid;
  ins_ids          uuid[];
  req_id           uuid;
  i int;
  -- Hash PBKDF2 da senha "LumiedDemo2026!" com salt fixo
  pw_hash text := 'a1b2c3d4e5f607182930415263748596:d6e7fd9b50d06fea9ade077a5d5bdda3ab8e5a33a621eb7e8b776eadcc6b6250';
BEGIN
  SELECT id INTO demo_escola_id FROM escolas WHERE nome ILIKE 'Demo Lumied%' LIMIT 1;
  IF demo_escola_id IS NULL THEN
    RAISE NOTICE 'Escola demo não encontrada. Rode a migration 232 primeiro.';
    RETURN;
  END IF;

  -- ── 1. Senha funcional do gerente demo ──
  UPDATE gerentes SET senha_hash = pw_hash, escola_id = demo_escola_id
  WHERE email = 'demo@lumied.com.br';

  -- ── 2. Séries (pegar IDs das que já existem ou criar) ──
  SELECT id INTO serie_b1  FROM series WHERE nome = 'Berçário 1 (Demo)' LIMIT 1;
  SELECT id INTO serie_j2  FROM series WHERE nome = 'Jardim 2 (Demo)'   LIMIT 1;
  SELECT id INTO serie_pre FROM series WHERE nome = 'Pré-escola (Demo)' LIMIT 1;

  -- ── 3. Professoras (4) ──
  BEGIN
    INSERT INTO professoras (nome, email, senha_hash, serie_id, escola_id)
    VALUES
      ('Ana Paula (Demo)',     'ana.demo@lumied.com.br',     pw_hash, serie_b1,  demo_escola_id),
      ('Beatriz Cardoso (Demo)','beatriz.demo@lumied.com.br', pw_hash, serie_j2,  demo_escola_id),
      ('Carla Moreira (Demo)', 'carla.demo@lumied.com.br',   pw_hash, serie_pre, demo_escola_id),
      ('Débora Souza (Demo)',  'debora.demo@lumied.com.br',  pw_hash, serie_j2,  demo_escola_id)
    ON CONFLICT (email) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Professoras: %', SQLERRM; END;

  -- ── 4. Famílias (demo: 25 famílias fictícias) ──
  BEGIN
    INSERT INTO familias (nome_resp, email, telefone)
    SELECT
      'Resp. ' || nome,
      lower(regexp_replace(nome, '\W+', '.', 'g')) || '.demo@example.com',
      '(54) 99' || lpad((100 + i*13)::text, 3, '0') || '-' || lpad((i*7)::text, 4, '0')
    FROM (VALUES
      (1,'Alice Silva'),(2,'Arthur Costa'),(3,'Beatriz Lima'),(4,'Bernardo Souza'),
      (5,'Clara Oliveira'),(6,'Davi Santos'),(7,'Eduarda Pereira'),(8,'Enzo Ribeiro'),
      (9,'Felipe Martins'),(10,'Giovanna Rocha'),(11,'Heitor Alves'),(12,'Isabella Dias'),
      (13,'João Pedro Costa'),(14,'Julia Ferreira'),(15,'Kaique Barbosa'),(16,'Laura Nunes'),
      (17,'Lorenzo Teixeira'),(18,'Maria Eduarda'),(19,'Miguel Cardoso'),(20,'Nina Cavalcanti'),
      (21,'Otávio Ramos'),(22,'Pedro Henrique'),(23,'Rafaela Moura'),(24,'Sofia Azevedo'),
      (25,'Theo Campos')
    ) AS t(i,nome)
    ON CONFLICT (email) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Familias: %', SQLERRM; END;

  -- ── 5. Alunos (25, vinculados às famílias) ──
  BEGIN
    INSERT INTO alunos (nome, email, familia_email, serie_id, data_nascimento)
    SELECT
      nome,
      lower(regexp_replace(nome, '\W+', '.', 'g')) || '.aluno@example.com',
      lower(regexp_replace(nome, '\W+', '.', 'g')) || '.demo@example.com',
      CASE (i % 3) WHEN 0 THEN serie_b1 WHEN 1 THEN serie_j2 ELSE serie_pre END,
      (DATE '2020-01-01' + (i * 37)::int)
    FROM (VALUES
      (1,'Alice Silva'),(2,'Arthur Costa'),(3,'Beatriz Lima'),(4,'Bernardo Souza'),
      (5,'Clara Oliveira'),(6,'Davi Santos'),(7,'Eduarda Pereira'),(8,'Enzo Ribeiro'),
      (9,'Felipe Martins'),(10,'Giovanna Rocha'),(11,'Heitor Alves'),(12,'Isabella Dias'),
      (13,'João Pedro Costa'),(14,'Julia Ferreira'),(15,'Kaique Barbosa'),(16,'Laura Nunes'),
      (17,'Lorenzo Teixeira'),(18,'Maria Eduarda'),(19,'Miguel Cardoso'),(20,'Nina Cavalcanti'),
      (21,'Otávio Ramos'),(22,'Pedro Henrique'),(23,'Rafaela Moura'),(24,'Sofia Azevedo'),
      (25,'Theo Campos')
    ) AS t(i,nome)
    ON CONFLICT (email) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Alunos: %', SQLERRM; END;

  -- ── 6. Catálogo de insumos ──
  BEGIN
    INSERT INTO alm_insumos (nome, unidade, preco, estoque_qty, categoria, descricao)
    VALUES
      ('Tinta guache 250ml',  'frasco',  8.50, 30, 'Arte',        'Tinta guache atóxica 250ml, cores variadas'),
      ('Papel A4 500fls',     'resma',  32.00, 12, 'Papelaria',   'Papel sulfite branco A4 75g/m², resma 500 folhas'),
      ('Cola bastão 40g',     'unidade', 5.90, 45, 'Papelaria',   'Cola em bastão 40g atóxica'),
      ('Pincel escolar nº 10','unidade', 4.20, 28, 'Arte',        'Pincel escolar cerdas macias'),
      ('Massinha 12 cores',   'caixa',  15.00, 18, 'Arte',        'Massa de modelar 12 cores 180g'),
      ('Cartolina colorida',  'unidade', 2.50, 50, 'Papelaria',   'Cartolina 150g, diversas cores'),
      ('Lápis de cor 24',     'caixa',  22.00, 22, 'Arte',        'Lápis de cor 24 cores sextavado'),
      ('Tesoura sem ponta',   'unidade', 9.00, 15, 'Papelaria',   'Tesoura infantil sem ponta'),
      ('Tinta glitter 150ml', 'frasco', 11.50,  8, 'Arte',        'Tinta com glitter 150ml'),
      ('EVA colorido A4',     'folha',   1.80, 60, 'Arte',        'EVA liso cores sortidas'),
      ('Caneta hidrográfica', 'caixa',  18.00, 14, 'Arte',        'Canetinhas ponta fina 12 cores'),
      ('Fita crepe 18mm',     'rolo',    4.50, 20, 'Papelaria',   'Fita crepe 18mm x 50m')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Insumos: %', SQLERRM; END;

  -- ── 7. Turmas do almoxarifado + orçamentos ──
  BEGIN
    INSERT INTO alm_turmas (nome, cor) VALUES
      ('Berçário 1 (Demo)', '#3B82F6'),
      ('Jardim 2 (Demo)',   '#10B981'),
      ('Pré-escola (Demo)', '#F59E0B')
    ON CONFLICT DO NOTHING;

    FOR turma_id IN SELECT id FROM alm_turmas WHERE nome LIKE '%(Demo)' LOOP
      INSERT INTO alm_orcamentos (turma_id, mes, valor) VALUES
        (turma_id, to_char(CURRENT_DATE, 'YYYY-MM'), 800.00),
        (turma_id, to_char(CURRENT_DATE - INTERVAL '1 month', 'YYYY-MM'), 800.00)
      ON CONFLICT DO NOTHING;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Turmas/Orçamentos: %', SQLERRM; END;

  -- ── 8. Mensalidades (3 meses x ~25 alunos, mix de status) ──
  BEGIN
    INSERT INTO fin_mensalidades (familia_email, familia_nome, crianca_nome, serie, valor_total, valor_turno, mes, status, data_vencimento, data_pagamento)
    SELECT
      a.familia_email,
      f.nome_resp,
      a.nome,
      s.nome,
      2850.00,
      2850.00,
      to_char(CURRENT_DATE - (m || ' months')::interval, 'YYYY-MM'),
      CASE
        WHEN m = 0 THEN CASE WHEN (row_number() OVER (ORDER BY a.nome)) % 7 = 0 THEN 'pendente' ELSE 'pago' END
        WHEN m = 1 THEN CASE WHEN (row_number() OVER (ORDER BY a.nome)) % 12 = 0 THEN 'atrasado' ELSE 'pago' END
        ELSE 'pago'
      END,
      (date_trunc('month', CURRENT_DATE - (m || ' months')::interval) + INTERVAL '9 days')::date,
      CASE WHEN m > 0 THEN (CURRENT_DATE - ((m-1) || ' months')::interval - INTERVAL '20 days')::date ELSE NULL END
    FROM alunos a
    JOIN familias f ON f.email = a.familia_email
    LEFT JOIN series s ON s.id = a.serie_id
    CROSS JOIN generate_series(0, 2) AS m
    WHERE a.email LIKE '%.aluno@example.com'
    ON CONFLICT (familia_email, crianca_nome, mes) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Mensalidades: %', SQLERRM; END;

  -- ── 9. Inadimplências (extraídas de mensalidades atrasadas) ──
  BEGIN
    INSERT INTO fin_inadimplencia (familia_email, crianca_nome, dias_atraso, valor_total_devedor, bucket, mensalidades_ids)
    SELECT
      m.familia_email, m.crianca_nome,
      (CURRENT_DATE - m.data_vencimento),
      m.valor_total,
      CASE
        WHEN (CURRENT_DATE - m.data_vencimento) >= 28 THEN '28d'
        WHEN (CURRENT_DATE - m.data_vencimento) >= 15 THEN '15d'
        ELSE '7d'
      END,
      ARRAY[m.id]
    FROM fin_mensalidades m
    WHERE m.status = 'atrasado'
      AND m.familia_email LIKE '%demo@example.com'
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Inadimplência: %', SQLERRM; END;

  -- ── 10. Tratativas de cobrança (para mostrar timeline) ──
  BEGIN
    INSERT INTO cobranca_tratativas (escola_id, mensalidade_id, familia_email, usuario_nome, usuario_papel, tipo, observacao, data_prevista_pagamento, valor_negociado)
    SELECT
      demo_escola_id,
      m.id,
      m.familia_email,
      'Gerente Demo',
      'gerente',
      'ligacao',
      'Contato realizado. Responsável confirmou dificuldade temporária e prometeu regularizar na próxima semana.',
      (CURRENT_DATE + INTERVAL '7 days')::date,
      m.valor_total
    FROM fin_mensalidades m
    WHERE m.status = 'atrasado' AND m.familia_email LIKE '%demo@example.com'
    LIMIT 3;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Tratativas: %', SQLERRM; END;

  -- ── 11. Log de envios da régua (simula histórico automático) ──
  BEGIN
    INSERT INTO regua_execucoes (escola_id, mensalidade_id, familia_email, destinatario, canal, assunto, corpo, status, disparado_auto, enviado_em, metadata)
    SELECT
      demo_escola_id, m.id, m.familia_email, m.familia_email, 'email',
      'Lembrete: mensalidade vence em 5 dias',
      'Olá! Sua mensalidade de ' || m.mes || ' no valor de R$ ' || m.valor_total || ' vence em breve. Atenciosamente, Demo Lumied.',
      'enviado', true,
      (m.data_vencimento - INTERVAL '5 days'),
      jsonb_build_object('evento','lembrete_vencimento','dias_offset',-5)
    FROM fin_mensalidades m
    WHERE m.familia_email LIKE '%demo@example.com' AND m.status IN ('atrasado','pago');

    INSERT INTO regua_execucoes (escola_id, mensalidade_id, familia_email, destinatario, canal, assunto, corpo, status, disparado_auto, enviado_em, metadata)
    SELECT
      demo_escola_id, m.id, m.familia_email, m.familia_email, 'email',
      'Mensalidade em atraso',
      'Identificamos que sua mensalidade está em atraso desde ' || m.data_vencimento || '. Por favor, regularize.',
      'enviado', true,
      (m.data_vencimento + INTERVAL '1 day'),
      jsonb_build_object('evento','pos_vencimento','dias_offset',1)
    FROM fin_mensalidades m
    WHERE m.familia_email LIKE '%demo@example.com' AND m.status = 'atrasado';
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Régua execuções: %', SQLERRM; END;

  -- ── 12. Requisições de almoxarifado (variedade de status) ──
  BEGIN
    -- Requisição pendente (aguardando aprovação)
    FOR turma_id IN SELECT id FROM alm_turmas WHERE nome LIKE '%(Demo)' LIMIT 2 LOOP
      INSERT INTO alm_requisicoes (professora_id, turma_id, mes, itens, total, status, observacao)
      SELECT
        (SELECT id FROM professoras WHERE email LIKE '%demo@lumied.com.br' ORDER BY random() LIMIT 1),
        turma_id,
        to_char(CURRENT_DATE, 'YYYY-MM'),
        '[
          {"nome":"Tinta guache 250ml","unidade":"frasco","qty_solicitado":6,"preco_unit":8.50},
          {"nome":"Pincel escolar nº 10","unidade":"unidade","qty_solicitado":8,"preco_unit":4.20},
          {"nome":"Papel A4 500fls","unidade":"resma","qty_solicitado":2,"preco_unit":32.00}
        ]'::jsonb,
        (6*8.50 + 8*4.20 + 2*32.00),
        'pendente',
        'Projeto de artes da próxima semana'
      ;
    END LOOP;

    -- Requisição aprovada
    INSERT INTO alm_requisicoes (professora_id, turma_id, mes, itens, total, status, aprovado_em)
    SELECT
      (SELECT id FROM professoras WHERE email LIKE '%demo@lumied.com.br' ORDER BY random() LIMIT 1),
      (SELECT id FROM alm_turmas WHERE nome LIKE '%(Demo)' LIMIT 1),
      to_char(CURRENT_DATE - INTERVAL '5 days', 'YYYY-MM'),
      '[
        {"nome":"Cola bastão 40g","unidade":"unidade","qty_solicitado":20,"qty_aprovado":20,"preco_unit":5.90},
        {"nome":"Massinha 12 cores","unidade":"caixa","qty_solicitado":5,"qty_aprovado":5,"preco_unit":15.00}
      ]'::jsonb,
      (20*5.90 + 5*15.00),
      'aprovado',
      (CURRENT_DATE - INTERVAL '3 days');
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Requisições: %', SQLERRM; END;

  -- ── 13. Comunicados (se a tabela existir) ──
  BEGIN
    INSERT INTO comunicados (titulo, corpo, enviado_em, escola_id)
    VALUES
      ('Reunião de Pais — Abril', 'Convidamos todos os responsáveis para nossa reunião trimestral no dia 20/04 às 19h. Presença confirmada via portal.', CURRENT_DATE - INTERVAL '3 days', demo_escola_id),
      ('Cardápio da Semana', 'Confira o cardápio desta semana no portal dos pais. Restrições alimentares já estão atualizadas no sistema.', CURRENT_DATE - INTERVAL '1 day', demo_escola_id)
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Comunicados: % (tabela pode não existir — ignorado)', SQLERRM; END;

  RAISE NOTICE 'Seed demo populado com sucesso. Escola: %, Login gerente: demo@lumied.com.br / LumiedDemo2026!', demo_escola_id;

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Seed demo populado falhou (parcial): %', SQLERRM;
END $$;

-- Após o seed: garantir que a saas_status da demo permanece como cortesia
UPDATE escolas SET saas_status = 'ativo', saas_valor_mensal = 0 WHERE nome ILIKE 'Demo Lumied%';
