-- ═══════════════════════════════════════════════════════════════
-- 341_crm_v2_cron.sql — Jobs pg_cron para CRM v2
--
-- Processa cadências de follow-up (1h) e snooze (5min).
-- Não chama edge function — toda lógica em SQL puro pra evitar
-- depender de service key + reduzir latência.
--
-- Saída prática: cadência matura → cria crm_snooze pendente.
-- Extensão lista snoozes pendentes e mostra na sidebar do operador
-- como "Lembretes pra disparar agora".
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ─── _crm_process_cadencias() ───────────────────────────────
-- Pra cada lead_cadencia ativa, decide se já é hora de disparar
-- o próximo passo. Se sim: cria crm_snooze pendente + incrementa
-- passo_atual. Se chegou ao fim: marca concluida.
CREATE OR REPLACE FUNCTION public._crm_process_cadencias() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  lc RECORD;
  cad RECORD;
  passo jsonb;
  base_ts timestamptz;
  due_at timestamptz;
  dias_apos int;
  template_id uuid;
  total_disparados int := 0;
  total_concluidas int := 0;
BEGIN
  FOR lc IN
    SELECT lc.*, c.passos, c.parar_quando
    FROM crm_lead_cadencias lc
    JOIN crm_cadencias c ON c.id = lc.cadencia_id
    WHERE lc.status = 'ativa' AND c.ativo = true
  LOOP
    -- passo atual existe na cadência?
    IF lc.passo_atual >= jsonb_array_length(lc.passos) THEN
      UPDATE crm_lead_cadencias SET status = 'concluida' WHERE id = lc.id;
      total_concluidas := total_concluidas + 1;
      CONTINUE;
    END IF;

    passo := lc.passos -> lc.passo_atual;
    dias_apos := COALESCE((passo->>'dias_apos')::int, 1);
    template_id := NULLIF(passo->>'template_id', '')::uuid;
    base_ts := COALESCE(lc.ultimo_disparo_em, lc.iniciada_em);
    due_at := base_ts + (dias_apos || ' days')::interval;

    IF due_at <= now() THEN
      -- gera snooze pendente pra operador disparar
      INSERT INTO crm_snooze (
        lead_id, template_id, escola_id, agendado_para,
        mensagem_preview, criado_por, status
      ) VALUES (
        lc.lead_id, template_id, lc.escola_id, now(),
        'Cadência: passo ' || (lc.passo_atual + 1) || ' (' || COALESCE(passo->>'descricao', 'follow-up') || ')',
        'cadencia_auto', 'pendente'
      );

      UPDATE crm_lead_cadencias SET
        passo_atual = lc.passo_atual + 1,
        ultimo_disparo_em = now()
      WHERE id = lc.id;

      total_disparados := total_disparados + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'disparados', total_disparados,
    'concluidas', total_concluidas,
    'executado_em', now()
  );
END $$;

REVOKE ALL ON FUNCTION public._crm_process_cadencias() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._crm_process_cadencias() TO postgres;

-- ─── _crm_process_snooze_expirar() ──────────────────────────
-- Marca snoozes com mais de 7 dias atrasados como 'expirado'.
CREATE OR REPLACE FUNCTION public._crm_process_snooze_expirar() RETURNS int
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE crm_snooze SET status = 'expirado'
  WHERE status = 'pendente' AND agendado_para < now() - interval '7 days'
  RETURNING 1;
  SELECT count(*)::int FROM crm_snooze WHERE status = 'expirado' AND agendado_para < now() - interval '7 days' - interval '1 minute';
$$;
REVOKE ALL ON FUNCTION public._crm_process_snooze_expirar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._crm_process_snooze_expirar() TO postgres;

-- ─── _crm_cadencia_parar_em_resposta() ──────────────────────
-- Trigger: quando uma nova interação do contato chega (tipo='whatsapp'),
-- se a cadência tem parar_quando='qualquer_resposta', pausa a cadência.
-- Heurística simples: descrição contém [Contato] = é resposta entrante.
CREATE OR REPLACE FUNCTION public._crm_cadencia_parar_em_resposta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo = 'whatsapp' AND NEW.descricao ILIKE '%[Contato]%' THEN
    UPDATE crm_lead_cadencias lc
    SET status = 'pausada'
    FROM crm_cadencias c
    WHERE lc.cadencia_id = c.id
      AND lc.lead_id = NEW.lead_id
      AND lc.status = 'ativa'
      AND c.parar_quando = 'qualquer_resposta';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_crm_cad_parar_resposta ON crm_interacoes;
CREATE TRIGGER trg_crm_cad_parar_resposta
  AFTER INSERT ON crm_interacoes
  FOR EACH ROW EXECUTE FUNCTION public._crm_cadencia_parar_em_resposta();

-- ─── Jobs pg_cron ───────────────────────────────────────────
-- Cadências: a cada 30 min entre 08:00-19:00 BRT (11h-22h UTC)
-- (evita disparar follow-up de madrugada)
SELECT cron.unschedule('crm-cadencias-process')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='crm-cadencias-process');
SELECT cron.schedule('crm-cadencias-process', '*/30 11-22 * * 1-6', $$
  SELECT public._crm_process_cadencias();
$$);

-- Snooze expirar: 03:00 BRT diário
SELECT cron.unschedule('crm-snooze-expirar')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='crm-snooze-expirar');
SELECT cron.schedule('crm-snooze-expirar', '0 6 * * *', $$
  SELECT public._crm_process_snooze_expirar();
$$);

COMMENT ON FUNCTION public._crm_process_cadencias() IS 'Processa cadências CRM v2 (mig 341)';
COMMENT ON FUNCTION public._crm_process_snooze_expirar() IS 'Expira snoozes com >7d atraso (mig 341)';
