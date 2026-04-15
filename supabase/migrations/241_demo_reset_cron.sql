-- =====================================================
-- 241: Cron de reset semanal do demo
-- =====================================================
-- Toda segunda 04:00 BRT (07:00 UTC), limpa dados voláteis da escola Demo
-- Lumied e re-roda o seed. Mantém a demo apresentável para vendas.
-- =====================================================

DO $$ BEGIN
  PERFORM cron.unschedule('demo-reset-weekly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION demo_reset() RETURNS int AS $$
DECLARE
  demo_escola_id uuid;
  deletados int := 0;
BEGIN
  SELECT id INTO demo_escola_id FROM escolas WHERE nome ILIKE 'Demo Lumied%' LIMIT 1;
  IF demo_escola_id IS NULL THEN RETURN 0; END IF;

  -- Limpa dados voláteis (evita poluição de runs anteriores de testes de venda)
  DELETE FROM cobranca_tratativas WHERE escola_id = demo_escola_id; GET DIAGNOSTICS deletados = ROW_COUNT;
  DELETE FROM regua_execucoes WHERE escola_id = demo_escola_id;
  DELETE FROM fin_inadimplencia WHERE familia_email LIKE '%.demo@example.com';
  DELETE FROM fin_mensalidades WHERE familia_email LIKE '%.demo@example.com';
  DELETE FROM alm_requisicoes WHERE turma_id IN (SELECT id FROM alm_turmas WHERE nome LIKE '%(Demo)');
  DELETE FROM alm_entregas WHERE requisicao_id NOT IN (SELECT id FROM alm_requisicoes);
  DELETE FROM backups_log WHERE escola_id = demo_escola_id AND status = 'em_andamento';
  -- Preserva: alunos, professoras, familias, orçamentos, insumos, turmas (reseeded sobre eles)

  -- Marca demo_last_reset no escola_config
  INSERT INTO escola_config (chave, valor, escola_id, categoria)
  VALUES ('demo_last_reset', to_jsonb(now()::text), demo_escola_id, 'geral')
  ON CONFLICT (chave, escola_id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();

  RETURN deletados;
END $$ LANGUAGE plpgsql;

-- Agenda: toda segunda 07:00 UTC (04:00 BRT)
DO $$ BEGIN
  PERFORM cron.schedule(
    'demo-reset-weekly',
    '0 7 * * 1',
    $cron$
      -- Limpa voláteis
      SELECT demo_reset();
      -- Re-aplica seed de mensalidades (script da migration 233, inline)
      INSERT INTO fin_mensalidades (familia_email, familia_nome, crianca_nome, serie, valor_total, valor_turno, mes, status, data_vencimento, data_pagamento)
      SELECT a.familia_email, f.nome_resp, a.nome, s.nome, 2850.00, 2850.00,
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
    $cron$
  );
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'demo-reset cron schedule: %', SQLERRM;
END $$;
