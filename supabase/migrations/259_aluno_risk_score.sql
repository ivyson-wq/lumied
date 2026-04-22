-- Risk score per student (calculated daily)
CREATE TABLE IF NOT EXISTS aluno_risk_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  aluno_email text NOT NULL,
  aluno_nome text,
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  score_frequencia integer DEFAULT 0,
  score_notas integer DEFAULT 0,
  score_engajamento_pais integer DEFAULT 0,
  score_tendencia integer DEFAULT 0,
  fatores jsonb DEFAULT '[]',
  calculado_em timestamptz DEFAULT now(),
  UNIQUE(escola_id, aluno_email)
);

CREATE INDEX IF NOT EXISTS idx_risk_scores_escola ON aluno_risk_scores(escola_id);
CREATE INDEX IF NOT EXISTS idx_risk_scores_score ON aluno_risk_scores(score DESC);

SELECT add_tenant_isolation('aluno_risk_scores');

-- Schedule daily calculation at 06:00 BRT (09:00 UTC)
SELECT cron.schedule(
  'calcular-risk-scores',
  '0 9 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.cron_internal_key', true)
    ),
    body := '{"action":"calcular_risk_scores"}'::jsonb
  )$$
);
