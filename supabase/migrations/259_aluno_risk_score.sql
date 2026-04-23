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
  $$
  SELECT net.http_post(
    url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/api',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc2NTQ1NSwiZXhwIjoyMDg5MzQxNDU1fQ.MI9khO-VnKpmi80n12rsuBySOPdOi7KhapCV5JOAsj8"}'::jsonb,
    body := '{"action":"calcular_risk_scores"}'::jsonb
  );
  $$
);
