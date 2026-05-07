-- ═══════════════════════════════════════════════════════════════
--  Migration 264 — Aviso automático: turmas sem requisição no mês
-- ═══════════════════════════════════════════════════════════════
--  Toda primeira semana do mês (default dia 05 às 09:00 BRT) varre
--  cada escola. Para cada turma com aviso_requisicao_mensal=true
--  que ainda NÃO tem requisição no mês corrente, cria notificação
--  in-app pra professora responsável e pros gerentes da escola.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE series
  ADD COLUMN IF NOT EXISTS aviso_requisicao_mensal boolean DEFAULT true;

CREATE OR REPLACE FUNCTION aviso_requisicoes_mensais() RETURNS int AS $$
DECLARE
  mes_atual text := to_char(CURRENT_DATE, 'YYYY-MM');
  notificacoes_criadas int := 0;
  r record;
  prof_id uuid;
  prof_nome text;
BEGIN
  FOR r IN
    SELECT s.id AS turma_id, s.nome AS turma_nome, s.escola_id
    FROM series s
    WHERE COALESCE(s.aviso_requisicao_mensal, true) = true
      AND s.ativo IS NOT FALSE
      AND NOT EXISTS (
        SELECT 1 FROM alm_requisicoes r
        WHERE r.turma_id = s.id
          AND r.mes = mes_atual
          AND r.escola_id = s.escola_id
      )
  LOOP
    -- Professora responsável (via series_monitoras OU serie_id)
    FOR prof_id, prof_nome IN
      SELECT p.id, p.nome FROM professoras p
      WHERE p.escola_id = r.escola_id
        AND (p.serie_id = r.turma_id OR r.turma_id = ANY(COALESCE(p.series_monitoras, ARRAY[]::uuid[])))
    LOOP
      INSERT INTO notificacoes (portal, destinatario, titulo, mensagem, tipo, escola_id)
      VALUES (
        'professora',
        prof_id::text,
        'Sem requisições neste mês',
        format('A turma %s ainda não tem requisições registradas em %s. Confirme se está tudo certo ou registre as necessidades.',
               r.turma_nome, to_char(CURRENT_DATE, 'MM/YYYY')),
        'warning',
        r.escola_id
      )
      ON CONFLICT DO NOTHING;
      notificacoes_criadas := notificacoes_criadas + 1;
    END LOOP;

    -- Gerentes da escola
    INSERT INTO notificacoes (portal, destinatario, titulo, mensagem, tipo, escola_id)
    SELECT 'gerente', g.id::text,
           'Turma sem requisições no mês',
           format('A turma %s ainda não tem requisições em %s.', r.turma_nome, to_char(CURRENT_DATE, 'MM/YYYY')),
           'warning',
           r.escola_id
    FROM gerentes g WHERE g.escola_id = r.escola_id
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS notificacoes_criadas = ROW_COUNT;
  END LOOP;

  RAISE NOTICE 'aviso_requisicoes_mensais: % notificações criadas para %', notificacoes_criadas, mes_atual;
  RETURN notificacoes_criadas;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION aviso_requisicoes_mensais IS
  'Mensal (dia 05 09:00 BRT): notifica professoras + gerentes de turmas sem requisição no mês corrente.';

-- Agenda no pg_cron (default dia 5 às 12:00 UTC ≈ 09:00 BRT)
DO $$ BEGIN
  PERFORM cron.unschedule('aviso-requisicoes-mensais');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM cron.schedule(
    'aviso-requisicoes-mensais',
    '0 12 5 * *',
    'SELECT aviso_requisicoes_mensais();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'aviso-requisicoes cron schedule: %', SQLERRM;
END $$;
