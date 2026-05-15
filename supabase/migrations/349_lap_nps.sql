-- ═══════════════════════════════════════════════════════════════
-- Migration 349 — Lumied NPS (Sprint 18)
--
-- Coleta NPS in-app. Score alimenta o pilar Sentimento do LHS.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lap_nps_responses (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id     uuid        NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  user_id       uuid,
  user_papel    text,
  user_email    text,
  score         smallint    NOT NULL CHECK (score BETWEEN 0 AND 10),
  comentario    text,
  categoria     text        CHECK (categoria IN ('promoter','passive','detractor')),
  contexto      text,                                -- tela/módulo em que respondeu
  criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nps_escola_data
  ON lap_nps_responses(escola_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_nps_categoria
  ON lap_nps_responses(categoria, criado_em DESC);

SELECT add_tenant_isolation('lap_nps_responses');

-- Função: NPS médio dos últimos 60 dias por escola
CREATE OR REPLACE FUNCTION fn_nps_escola(p_escola_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT score, categoria FROM lap_nps_responses
    WHERE escola_id = p_escola_id
      AND criado_em > now() - interval '60 days'
  )
  SELECT jsonb_build_object(
    'count',     coalesce((SELECT count(*) FROM r), 0),
    'promoters', coalesce((SELECT count(*) FROM r WHERE categoria='promoter'), 0),
    'passives',  coalesce((SELECT count(*) FROM r WHERE categoria='passive'), 0),
    'detractors',coalesce((SELECT count(*) FROM r WHERE categoria='detractor'), 0),
    'nps',       CASE
      WHEN (SELECT count(*) FROM r) = 0 THEN NULL
      ELSE round(
        ((SELECT count(*) FROM r WHERE categoria='promoter')::numeric
         - (SELECT count(*) FROM r WHERE categoria='detractor')::numeric)
        / (SELECT count(*) FROM r) * 100
      )::int
    END,
    'score_medio', coalesce((SELECT round(avg(score)::numeric, 1) FROM r), NULL)
  );
$$;

COMMENT ON TABLE lap_nps_responses IS 'Respostas NPS in-app (mig 349). Score 0-10 + categoria automática.';
COMMENT ON FUNCTION fn_nps_escola IS 'NPS dos últimos 60 dias de uma escola.';

-- ─── Atualiza fn_lumied_health_score pra usar NPS real ──────────
CREATE OR REPLACE FUNCTION fn_lumied_health_score(p_escola_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_amps int := 0;
  v_active_modules text[] := ARRAY[]::text[];
  v_dau int := 0;
  v_mau int := 0;
  v_dau_mau numeric := 0;
  v_adocao numeric := 0;
  v_personas_count int := 0;
  v_personas_logged text[] := ARRAY[]::text[];
  v_stakeholders numeric := 0;
  v_baixa_auto int := 0;
  v_baixa_total int := 0;
  v_sla_ok int := 0;
  v_sla_total int := 0;
  v_outcomes numeric := 0.5;
  v_sentiment numeric := 0.75;
  v_nps_data jsonb;
  v_nps_score int;
  v_score int;
  v_color text;
BEGIN
  -- Adoção
  SELECT array_agg(module), count(*)
    INTO v_active_modules, v_amps
  FROM (
    SELECT module FROM product_events
    WHERE escola_id = p_escola_id
      AND created_at > now() - interval '14 days'
      AND module IS NOT NULL
      AND module NOT IN ('auth','onboarding','outro')
    GROUP BY module HAVING count(*) >= 5
  ) m;
  v_amps := coalesce(v_amps, 0);
  v_active_modules := coalesce(v_active_modules, ARRAY[]::text[]);

  SELECT count(DISTINCT user_id) INTO v_dau FROM product_events
   WHERE escola_id = p_escola_id AND user_id IS NOT NULL AND created_at > now() - interval '1 day';
  SELECT count(DISTINCT user_id) INTO v_mau FROM product_events
   WHERE escola_id = p_escola_id AND user_id IS NOT NULL AND created_at > now() - interval '30 days';
  v_dau_mau := CASE WHEN v_mau > 0 THEN v_dau::numeric / v_mau ELSE 0 END;
  v_adocao := LEAST(v_amps::numeric / 5.0, 1.0) * 0.7 + LEAST(v_dau_mau, 1.0) * 0.3;

  -- Stakeholders
  SELECT count(DISTINCT persona), array_agg(DISTINCT persona)
    INTO v_personas_count, v_personas_logged
  FROM product_events
  WHERE escola_id = p_escola_id
    AND created_at > now() - interval '7 days'
    AND persona IN ('diretor','financeiro','secretaria','manutencao');
  v_personas_count := coalesce(v_personas_count, 0);
  v_personas_logged := coalesce(v_personas_logged, ARRAY[]::text[]);
  v_stakeholders := v_personas_count::numeric / 4.0;

  -- Outcomes
  SELECT count(*) FILTER (WHERE event_name = 'financeiro.baixa.automatica'),
         count(*) FILTER (WHERE event_name IN ('financeiro.baixa.automatica','financeiro.baixa.manual'))
    INTO v_baixa_auto, v_baixa_total
  FROM product_events
  WHERE escola_id = p_escola_id AND created_at > now() - interval '30 days';

  SELECT count(*) FILTER (WHERE event_name = 'manutencao.chamado.fechado_no_sla'),
         count(*) FILTER (WHERE event_name LIKE 'manutencao.chamado.fechado%')
    INTO v_sla_ok, v_sla_total
  FROM product_events
  WHERE escola_id = p_escola_id AND created_at > now() - interval '30 days';

  v_outcomes := (
      CASE WHEN v_baixa_total > 0 THEN v_baixa_auto::numeric / v_baixa_total ELSE 0.5 END
    + CASE WHEN v_sla_total   > 0 THEN v_sla_ok::numeric   / v_sla_total   ELSE 0.5 END
  ) / 2.0;

  -- Sentiment: usa NPS real quando tem dados, senão default 0.75
  v_nps_data := fn_nps_escola(p_escola_id);
  v_nps_score := (v_nps_data->>'nps')::int;
  IF v_nps_score IS NOT NULL THEN
    -- NPS vai de -100 a +100. Normaliza pra 0..1.
    v_sentiment := GREATEST(0, LEAST(1, (v_nps_score + 100)::numeric / 200));
  END IF;

  -- Score final
  v_score := round(
      0.40 * v_adocao       * 100
    + 0.20 * v_stakeholders * 100
    + 0.25 * v_outcomes     * 100
    + 0.15 * v_sentiment    * 100
  )::int;

  v_color := CASE
    WHEN v_score >= 80 THEN 'green'
    WHEN v_score >= 60 THEN 'yellow'
    ELSE 'red'
  END;

  RETURN jsonb_build_object(
    'score', v_score,
    'color', v_color,
    'amps_atual', v_amps,
    'breakdown', jsonb_build_object(
      'adocao', jsonb_build_object(
        'score', round(v_adocao*100)::int,
        'amps', v_amps,
        'active_modules', v_active_modules,
        'dau', v_dau, 'mau', v_mau, 'dau_mau_ratio', round(v_dau_mau,3)
      ),
      'stakeholders', jsonb_build_object(
        'score', round(v_stakeholders*100)::int,
        'count', v_personas_count, 'esperadas', 4, 'logaram', v_personas_logged
      ),
      'outcomes', jsonb_build_object(
        'score', round(v_outcomes*100)::int,
        'baixa_auto', v_baixa_auto, 'baixa_total', v_baixa_total,
        'chamados_sla', v_sla_ok, 'chamados_total', v_sla_total
      ),
      'sentiment', jsonb_build_object(
        'score', round(v_sentiment*100)::int,
        'nps', v_nps_score,
        'nps_count', (v_nps_data->>'count')::int,
        'fonte', CASE WHEN v_nps_score IS NULL THEN 'default (sem NPS)' ELSE 'nps_real' END
      )
    ),
    'computed_at', now()
  );
END;
$$;
