-- ═══════════════════════════════════════════════════════════════
--  Migration 242: GTM Funnel — CRM Lumied, nurturing, ROI calc
-- ═══════════════════════════════════════════════════════════════
-- Extende leads_comerciais (mig 201) com campos do funil outbound 7-toques,
-- cria gtm_lead_events (histórico), gtm_nurture_enviados (drip),
-- gtm_roi_calc_log (MQL auto-qualificado), indicacoes_clicks (tracking).

-- ── 1. Estender leads_comerciais ───────────────────────────────────────
ALTER TABLE leads_comerciais
  ADD COLUMN IF NOT EXISTS cidade TEXT,
  ADD COLUMN IF NOT EXISTS uf TEXT,
  ADD COLUMN IF NOT EXISTS alunos_estimados INT,
  ADD COLUMN IF NOT EXISTS sistema_atual TEXT,
  ADD COLUMN IF NOT EXISTS tier_sugerido TEXT CHECK (tier_sugerido IS NULL OR tier_sugerido IN ('starter','start','evolucao','prestige')),
  ADD COLUMN IF NOT EXISTS toque_atual SMALLINT DEFAULT 0,   -- 0 = sem toque, 1..7 = sequência outbound
  ADD COLUMN IF NOT EXISTS proximo_passo TEXT,
  ADD COLUMN IF NOT EXISTS proximo_passo_em DATE,
  ADD COLUMN IF NOT EXISTS responsavel_staff_id UUID REFERENCES lumied_staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qualificado_mql BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS qualificado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nurture_optout BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS calendly_event_uri TEXT,
  ADD COLUMN IF NOT EXISTS calendly_booking_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS perdido_motivo TEXT,
  ADD COLUMN IF NOT EXISTS fechado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS valor_mrr NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_leads_toque ON leads_comerciais(toque_atual, status);
CREATE INDEX IF NOT EXISTS idx_leads_prox_passo ON leads_comerciais(proximo_passo_em) WHERE proximo_passo_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_mql ON leads_comerciais(qualificado_mql) WHERE qualificado_mql = true;

-- ── 2. Histórico de eventos ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gtm_lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads_comerciais(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,       -- 'toque', 'status_change', 'nurture_sent', 'roi_calc', 'calendly_booked', 'nota'
  toque SMALLINT,           -- 1..7 quando tipo='toque'
  status_de TEXT,
  status_para TEXT,
  descricao TEXT,
  meta JSONB,
  ator_staff_id UUID REFERENCES lumied_staff(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON gtm_lead_events(lead_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_lead_events_tipo ON gtm_lead_events(tipo, criado_em DESC);

-- ── 3. Drip de nurturing (5 emails em 14 dias pós-MQL) ────────────────
-- Passos: 1=boas-vindas(D+0), 2=case ROI(D+3), 3=comparativo(D+7), 4=proposta(D+11), 5=break-up(D+14)
CREATE TABLE IF NOT EXISTS gtm_nurture_enviados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads_comerciais(id) ON DELETE CASCADE,
  passo SMALLINT NOT NULL CHECK (passo BETWEEN 1 AND 5),
  enviado_em TIMESTAMPTZ DEFAULT NOW(),
  email_subject TEXT,
  resend_id TEXT,
  UNIQUE (lead_id, passo)
);
CREATE INDEX IF NOT EXISTS idx_nurture_lead ON gtm_nurture_enviados(lead_id);

-- ── 4. ROI calculator — log de quem usou (MQL auto-qualificado) ───────
CREATE TABLE IF NOT EXISTS gtm_roi_calc_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads_comerciais(id) ON DELETE SET NULL,
  email TEXT,
  alunos INT NOT NULL,
  mensalidade_media NUMERIC(10,2) NOT NULL,
  inadimplencia_pct NUMERIC(5,2) NOT NULL,
  sistema_atual TEXT,
  horas_admin_semana NUMERIC(5,1),
  resultado_recuperacao_anual NUMERIC(12,2),
  resultado_economia_hora_anual NUMERIC(12,2),
  resultado_total_anual NUMERIC(12,2),
  tier_sugerido TEXT,
  custo_lumied_anual NUMERIC(10,2),
  roi_multiplicador NUMERIC(5,1),
  ip TEXT,
  user_agent TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_roi_lead ON gtm_roi_calc_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_roi_criado ON gtm_roi_calc_log(criado_em DESC);

-- ── 5. Tracking de indicações ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS indicacoes_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id UUID REFERENCES escolas(id) ON DELETE SET NULL,     -- escola que indicou
  indicador_nome TEXT,
  indicador_email TEXT,
  lead_id UUID REFERENCES leads_comerciais(id) ON DELETE SET NULL,
  codigo TEXT,
  ip TEXT,
  user_agent TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_indic_escola ON indicacoes_clicks(escola_id);

-- ── 6. RLS ───────────────────────────────────────────────────────────
ALTER TABLE gtm_lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE gtm_nurture_enviados ENABLE ROW LEVEL SECURITY;
ALTER TABLE gtm_roi_calc_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE indicacoes_clicks ENABLE ROW LEVEL SECURITY;
-- Leitura por service role apenas (SaaS-level, não tenant) — nenhuma policy = tudo negado para clientes.

-- ── 7. Helper view: funil ─────────────────────────────────────────────
CREATE OR REPLACE VIEW gtm_funil_resumo AS
SELECT
  status,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '30 days') AS ultimo_30d,
  COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '7 days') AS ultimo_7d,
  COALESCE(SUM(valor_mrr) FILTER (WHERE status = 'fechado'), 0) AS mrr_fechado
FROM leads_comerciais
GROUP BY status;

-- ── 8. Função: agendar próximo nurture tick (chamado pelo cron) ───────
-- Para cada lead qualificado_mql=true, nurture_optout=false, verifica quais
-- passos (1..5) já passaram do gatilho de tempo mas não foram enviados.
CREATE OR REPLACE FUNCTION gtm_nurture_pendentes()
RETURNS TABLE (
  lead_id UUID,
  passo SMALLINT,
  email TEXT,
  nome_escola TEXT,
  alunos_estimados INT,
  sistema_atual TEXT,
  tier_sugerido TEXT,
  criado_em TIMESTAMPTZ
) AS $$
  WITH cronograma AS (
    SELECT passo, intervalo FROM (VALUES
      (1::SMALLINT, INTERVAL '0 days'),   -- boas-vindas
      (2::SMALLINT, INTERVAL '3 days'),   -- case ROI
      (3::SMALLINT, INTERVAL '7 days'),   -- comparativo
      (4::SMALLINT, INTERVAL '11 days'),  -- proposta
      (5::SMALLINT, INTERVAL '14 days')   -- break-up
    ) AS t(passo, intervalo)
  )
  SELECT l.id, c.passo, l.email, l.nome_escola, l.alunos_estimados, l.sistema_atual, l.tier_sugerido,
         COALESCE(l.qualificado_em, l.criado_em)
  FROM leads_comerciais l
  CROSS JOIN cronograma c
  WHERE l.qualificado_mql = true
    AND l.nurture_optout = false
    AND l.status NOT IN ('fechado','perdido','demo_agendada')
    AND NOW() >= COALESCE(l.qualificado_em, l.criado_em) + c.intervalo
    AND NOT EXISTS (SELECT 1 FROM gtm_nurture_enviados ne WHERE ne.lead_id = l.id AND ne.passo = c.passo)
  ORDER BY l.id, c.passo;
$$ LANGUAGE SQL STABLE;

-- ── 9. Tier sugerido baseado em alunos ─────────────────────────────────
CREATE OR REPLACE FUNCTION gtm_sugerir_tier(alunos INT)
RETURNS TEXT AS $$
  SELECT CASE
    WHEN alunos IS NULL THEN 'start'
    WHEN alunos <= 200 THEN 'starter'
    WHEN alunos <= 300 THEN 'start'
    WHEN alunos <= 800 THEN 'evolucao'
    ELSE 'prestige'
  END;
$$ LANGUAGE SQL IMMUTABLE;

-- ── 10. pg_cron: nurture diário 09:00 BRT (12:00 UTC) ─────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('gtm-nurture-daily');
    PERFORM cron.schedule(
      'gtm-nurture-daily',
      '0 12 * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/gtm',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.settings.service_role_key', true)),
        body := jsonb_build_object('action','nurture_tick')
      );
      $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.schedule gtm-nurture-daily falhou: %', SQLERRM;
END $$;
