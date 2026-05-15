-- ═══════════════════════════════════════════════════════════════
-- Migration 343 — Lumied Health Score (LHS) + AMPS
--
-- Sprint 2 do Lumied Activation Program. Materializa as métricas
-- do plano:
--   • LHS (0-100): composite de Adoção 40% + Stakeholders 20% +
--     Outcomes 25% + Sentimento 15%
--   • AMPS — Active Modules Per School @ D60: a North Star Metric
--
-- Lê de product_events (mig 342). Cache materializado refreshado
-- diariamente via pg_cron 04:00 BRT.
-- ═══════════════════════════════════════════════════════════════

-- ─── Cache de score (1 row por escola, sobrescreve) ───────────
CREATE TABLE IF NOT EXISTS escola_health_score_cache (
  escola_id   uuid PRIMARY KEY REFERENCES escolas(id) ON DELETE CASCADE,
  score       int  NOT NULL CHECK (score BETWEEN 0 AND 100),
  color       text NOT NULL CHECK (color IN ('green','yellow','red')),
  breakdown   jsonb NOT NULL DEFAULT '{}'::jsonb,
  amps_atual  int  NOT NULL DEFAULT 0,
  amps_d60    int,  -- só preenche quando escola tem ≥60 dias de vida
  delta_30d   int  NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_cache_color_score
  ON escola_health_score_cache(color, score);

CREATE INDEX IF NOT EXISTS idx_health_cache_delta
  ON escola_health_score_cache(delta_30d);

-- Não é tabela "tenant" tradicional (admin-only). Sem add_tenant_isolation.

COMMENT ON TABLE escola_health_score_cache IS
  'Cache do Lumied Health Score (mig 343). Refresh diário via pg_cron lumied-health-score-refresh @ 04:00 BRT.';

-- ─── Função: AMPS @ D60 (a North Star) ────────────────────────
-- Active Modules per School nos primeiros 60 dias de vida da escola.
-- Módulo "ativo" = ≥5 eventos no período.
-- Exclui módulos auxiliares (auth, onboarding, outro).
CREATE OR REPLACE FUNCTION fn_amps_at_d60(p_escola_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  WITH ed AS (
    SELECT id, criado_em FROM escolas WHERE id = p_escola_id
  ),
  ativos AS (
    SELECT pe.module
    FROM product_events pe, ed
    WHERE pe.escola_id = ed.id
      AND pe.module IS NOT NULL
      AND pe.module NOT IN ('auth','onboarding','outro')
      AND pe.created_at >= ed.criado_em
      AND pe.created_at <  ed.criado_em + interval '60 days'
    GROUP BY pe.module
    HAVING count(*) >= 5
  )
  SELECT coalesce(count(*)::int, 0) FROM ativos;
$$;

COMMENT ON FUNCTION fn_amps_at_d60 IS
  'North Star Metric. AMPS @ D60: módulos ativos (≥5 eventos) nos primeiros 60 dias da escola.';

-- ─── Função: AMPS atual (rolling 14d) ────────────────────────
CREATE OR REPLACE FUNCTION fn_amps_atual(p_escola_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  WITH ativos AS (
    SELECT module
    FROM product_events
    WHERE escola_id = p_escola_id
      AND created_at > now() - interval '14 days'
      AND module IS NOT NULL
      AND module NOT IN ('auth','onboarding','outro')
    GROUP BY module
    HAVING count(*) >= 5
  )
  SELECT coalesce(count(*)::int, 0) FROM ativos;
$$;

-- ─── Função: LHS — composite score ─────────────────────────────
CREATE OR REPLACE FUNCTION fn_lumied_health_score(p_escola_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  -- Adoção
  v_amps int := 0;
  v_active_modules text[] := ARRAY[]::text[];
  v_dau int := 0;
  v_mau int := 0;
  v_dau_mau numeric := 0;
  v_adocao numeric := 0;  -- 0..1

  -- Stakeholders
  v_personas_count int := 0;
  v_personas_logged text[] := ARRAY[]::text[];
  v_stakeholders numeric := 0;

  -- Outcomes
  v_baixa_auto int := 0;
  v_baixa_total int := 0;
  v_sla_ok int := 0;
  v_sla_total int := 0;
  v_outcomes numeric := 0.5;

  -- Sentiment (placeholder até NPS real)
  v_sentiment numeric := 0.75;

  -- Score final
  v_score int;
  v_color text;
BEGIN
  -- ─── Adoção: AMPS atual + DAU/MAU ───────────────────────────
  SELECT array_agg(module), count(*)
    INTO v_active_modules, v_amps
  FROM (
    SELECT module
    FROM product_events
    WHERE escola_id = p_escola_id
      AND created_at > now() - interval '14 days'
      AND module IS NOT NULL
      AND module NOT IN ('auth','onboarding','outro')
    GROUP BY module
    HAVING count(*) >= 5
  ) m;
  v_amps := coalesce(v_amps, 0);
  v_active_modules := coalesce(v_active_modules, ARRAY[]::text[]);

  SELECT count(DISTINCT user_id) INTO v_dau
  FROM product_events
  WHERE escola_id = p_escola_id
    AND user_id IS NOT NULL
    AND created_at > now() - interval '1 day';

  SELECT count(DISTINCT user_id) INTO v_mau
  FROM product_events
  WHERE escola_id = p_escola_id
    AND user_id IS NOT NULL
    AND created_at > now() - interval '30 days';

  v_dau_mau := CASE WHEN v_mau > 0 THEN v_dau::numeric / v_mau ELSE 0 END;

  -- AMPS contribui 70%, DAU/MAU 30%. AMPS 5+ é máximo.
  v_adocao := LEAST(v_amps::numeric / 5.0, 1.0) * 0.7
            + LEAST(v_dau_mau, 1.0) * 0.3;

  -- ─── Stakeholders: 4 personas esperadas logaram últimos 7d ──
  SELECT count(DISTINCT persona), array_agg(DISTINCT persona)
    INTO v_personas_count, v_personas_logged
  FROM product_events
  WHERE escola_id = p_escola_id
    AND created_at > now() - interval '7 days'
    AND persona IN ('diretor','financeiro','secretaria','manutencao');
  v_personas_count := coalesce(v_personas_count, 0);
  v_personas_logged := coalesce(v_personas_logged, ARRAY[]::text[]);
  v_stakeholders := v_personas_count::numeric / 4.0;

  -- ─── Outcomes: % baixa auto + % chamados no SLA (30d) ──────
  SELECT
    count(*) FILTER (WHERE event_name = 'financeiro.baixa.automatica'),
    count(*) FILTER (WHERE event_name IN ('financeiro.baixa.automatica','financeiro.baixa.manual'))
    INTO v_baixa_auto, v_baixa_total
  FROM product_events
  WHERE escola_id = p_escola_id
    AND created_at > now() - interval '30 days';

  SELECT
    count(*) FILTER (WHERE event_name = 'manutencao.chamado.fechado_no_sla'),
    count(*) FILTER (WHERE event_name LIKE 'manutencao.chamado.fechado%')
    INTO v_sla_ok, v_sla_total
  FROM product_events
  WHERE escola_id = p_escola_id
    AND created_at > now() - interval '30 days';

  v_outcomes := (
      CASE WHEN v_baixa_total > 0 THEN v_baixa_auto::numeric / v_baixa_total ELSE 0.5 END
    + CASE WHEN v_sla_total   > 0 THEN v_sla_ok::numeric   / v_sla_total   ELSE 0.5 END
  ) / 2.0;

  -- ─── Score final ───────────────────────────────────────────
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
        'score',          round(v_adocao * 100)::int,
        'amps',           v_amps,
        'active_modules', v_active_modules,
        'dau',            v_dau,
        'mau',            v_mau,
        'dau_mau_ratio',  round(v_dau_mau, 3)
      ),
      'stakeholders', jsonb_build_object(
        'score',     round(v_stakeholders * 100)::int,
        'count',     v_personas_count,
        'esperadas', 4,
        'logaram',   v_personas_logged
      ),
      'outcomes', jsonb_build_object(
        'score',        round(v_outcomes * 100)::int,
        'baixa_auto',   v_baixa_auto,
        'baixa_total',  v_baixa_total,
        'chamados_sla', v_sla_ok,
        'chamados_total', v_sla_total
      ),
      'sentiment', jsonb_build_object(
        'score', round(v_sentiment * 100)::int,
        'fonte', 'default (NPS não integrado ainda)'
      )
    ),
    'computed_at', now()
  );
END;
$$;

COMMENT ON FUNCTION fn_lumied_health_score IS
  'Lumied Health Score (LHS) — composite 0-100. Adoção 40% + Stakeholders 20% + Outcomes 25% + Sentimento 15%.';

-- ─── Refresh em massa ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_all_lumied_health_scores()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_escola RECORD;
  v_result jsonb;
  v_prev_score int;
  v_count int := 0;
  v_started timestamptz := now();
BEGIN
  FOR v_escola IN
    SELECT id, criado_em FROM escolas WHERE ativo = true
  LOOP
    -- Calcula score atual
    v_result := fn_lumied_health_score(v_escola.id);

    -- Pega score anterior pra calcular delta_30d (compara com cache atual, que tem ~24h)
    SELECT score INTO v_prev_score
    FROM escola_health_score_cache
    WHERE escola_id = v_escola.id;

    INSERT INTO escola_health_score_cache (
      escola_id, score, color, breakdown, amps_atual, amps_d60, delta_30d, computed_at, updated_at
    )
    VALUES (
      v_escola.id,
      (v_result->>'score')::int,
      v_result->>'color',
      v_result->'breakdown',
      (v_result->>'amps_atual')::int,
      CASE
        WHEN v_escola.criado_em <= now() - interval '60 days'
          THEN fn_amps_at_d60(v_escola.id)
        ELSE NULL
      END,
      0, -- delta calculado abaixo via UPDATE
      (v_result->>'computed_at')::timestamptz,
      now()
    )
    ON CONFLICT (escola_id) DO UPDATE SET
      score       = EXCLUDED.score,
      color       = EXCLUDED.color,
      breakdown   = EXCLUDED.breakdown,
      amps_atual  = EXCLUDED.amps_atual,
      amps_d60    = EXCLUDED.amps_d60,
      delta_30d   = EXCLUDED.score - coalesce(v_prev_score, EXCLUDED.score),
      computed_at = EXCLUDED.computed_at,
      updated_at  = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'escolas_processadas', v_count,
    'duracao_ms', round(extract(epoch from (now() - v_started)) * 1000)::int,
    'finalizado_em', now()
  );
END;
$$;

COMMENT ON FUNCTION refresh_all_lumied_health_scores IS
  'Refresha LHS de todas escolas ativas. Roda diariamente via pg_cron 04:00 BRT.';

-- ─── pg_cron: schedule diário (04:00 BRT = 07:00 UTC) ─────────
-- Remove agendamento anterior se já existir (idempotente).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'lumied-health-score-refresh';
EXCEPTION WHEN OTHERS THEN
  -- pg_cron pode não estar habilitado em dev local; segue em frente
  RAISE NOTICE 'pg_cron unschedule pulou: %', SQLERRM;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'lumied-health-score-refresh',
    '0 7 * * *',
    $cmd$SELECT refresh_all_lumied_health_scores();$cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule pulou: %', SQLERRM;
END $$;
