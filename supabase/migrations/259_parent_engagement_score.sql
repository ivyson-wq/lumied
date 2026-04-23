-- ════════════════════════════════════════════════════════════════
--  Migration 259: Parent Engagement Score
--  Score proprietário 0-100 por família — KPI de retenção
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS familia_engagement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  familia_email text NOT NULL,
  familia_nome text,
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  -- Components
  score_app_usage integer DEFAULT 0,       -- frequência de logins no app
  score_pagamento integer DEFAULT 0,       -- pontualidade nos pagamentos
  score_comunicacao integer DEFAULT 0,     -- taxa de resposta a mensagens
  score_presenca integer DEFAULT 0,        -- presença em reuniões/eventos
  -- Trend
  trend text DEFAULT 'estavel' CHECK (trend IN ('subindo','estavel','descendo')),
  score_anterior integer DEFAULT 0,
  -- Metadata
  detalhes jsonb DEFAULT '{}',
  calculado_em timestamptz DEFAULT now(),
  UNIQUE(escola_id, familia_email)
);

CREATE INDEX idx_engagement_escola ON familia_engagement(escola_id);
CREATE INDEX idx_engagement_score ON familia_engagement(escola_id, score);

SELECT add_tenant_isolation('familia_engagement');

-- ─── pg_cron: calcular engagement diariamente às 03:00 UTC ───
SELECT cron.schedule(
  'calcular-engagement-familias',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/api',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc2NTQ1NSwiZXhwIjoyMDg5MzQxNDU1fQ.MI9khO-VnKpmi80n12rsuBySOPdOi7KhapCV5JOAsj8"}'::jsonb,
    body := '{"action":"calcular_engagement_todas_escolas"}'::jsonb
  );
  $$
);
