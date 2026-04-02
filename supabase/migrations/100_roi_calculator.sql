-- =====================================================
-- 100: ROI Calculator — Métricas reais + Calculadora pública
-- =====================================================

-- ── Expandir roi_snapshots com métricas detalhadas ──
ALTER TABLE roi_snapshots ADD COLUMN IF NOT EXISTS matriculas_digitais integer DEFAULT 0;
ALTER TABLE roi_snapshots ADD COLUMN IF NOT EXISTS comunicados_enviados integer DEFAULT 0;
ALTER TABLE roi_snapshots ADD COLUMN IF NOT EXISTS trocas_turno integer DEFAULT 0;
ALTER TABLE roi_snapshots ADD COLUMN IF NOT EXISTS tickets_resolvidos_auto integer DEFAULT 0;
ALTER TABLE roi_snapshots ADD COLUMN IF NOT EXISTS quizzes_aplicados integer DEFAULT 0;
ALTER TABLE roi_snapshots ADD COLUMN IF NOT EXISTS whatsapp_msgs integer DEFAULT 0;
ALTER TABLE roi_snapshots ADD COLUMN IF NOT EXISTS insights_gerados integer DEFAULT 0;
ALTER TABLE roi_snapshots ADD COLUMN IF NOT EXISTS evasoes_evitadas integer DEFAULT 0;
ALTER TABLE roi_snapshots ADD COLUMN IF NOT EXISTS minutos_economizados integer DEFAULT 0;
ALTER TABLE roi_snapshots ADD COLUMN IF NOT EXISTS valor_inadimplencia_evitada numeric DEFAULT 0;
ALTER TABLE roi_snapshots ADD COLUMN IF NOT EXISTS valor_economizado_total numeric DEFAULT 0;

-- ── Configuração de premissas ROI por escola ────────
CREATE TABLE IF NOT EXISTS roi_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE,
  -- Inputs da escola (para cálculo real)
  custo_mensal_sistemas_anteriores numeric DEFAULT 0,   -- R$ gastos com sistemas antes do Lumied
  salario_medio_admin numeric DEFAULT 3500,             -- R$/mês secretaria/admin
  total_staff_admin integer DEFAULT 2,                  -- pessoas na secretaria
  mensalidade_media_aluno numeric DEFAULT 2500,         -- R$/mês por aluno
  taxa_evasao_anterior numeric DEFAULT 8,               -- % evasão antes do Lumied
  taxa_inadimplencia_anterior numeric DEFAULT 10,        -- % inadimplência antes
  custo_hora_admin numeric DEFAULT 22,                  -- R$/hora
  -- Premissas (ajustáveis)
  operational_savings_rate numeric DEFAULT 0.30,
  evasion_reduction_rate numeric DEFAULT 0.40,
  conversion_improvement_rate numeric DEFAULT 0.05,
  default_reduction_rate numeric DEFAULT 0.20,
  minutes_per_digital_enrollment numeric DEFAULT 45,
  minutes_per_communique numeric DEFAULT 8,
  minutes_per_shift_change numeric DEFAULT 20,
  --
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),
  UNIQUE(escola_id)
);
ALTER TABLE roi_config DISABLE ROW LEVEL SECURITY;

CREATE TRIGGER roi_config_atualizado
  BEFORE UPDATE ON roi_config
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();

-- ── Cron: snapshot mensal ROI (1º de cada mês, 6h UTC)
SELECT cron.schedule(
  'roi-snapshot-mensal',
  '0 6 1 * *',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/lumied-ai',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"action":"roi_gerar_snapshot"}'::jsonb
  )$$
);
