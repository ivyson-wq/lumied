-- ═══════════════════════════════════════════════════════════════
--  Migration 283 — Fix de 6 cron jobs com 100% de falhas
--
--  Auditoria (cron.job_run_details últimos 7d):
--   - calcular-risk-scores       7/7 falhas (parameter app.settings.supabase_url não existe)
--   - calcular-engagement-familias 7/7 falhas (idem)
--   - cleanup-audit-180d         falha (coluna criado_em → 'at')
--   - cleanup-wa-messages-90d    falha (coluna criado_em → 'created_at')
--   - cleanup-rate-limits-deep   falha (coluna window_start → 'bucket_start')
--   - atualizar-precos-insumos   falha (JSON com escape errado)
-- ═══════════════════════════════════════════════════════════════

-- 1) calcular-risk-scores e calcular-engagement-familias usavam
--    current_setting('app.settings.supabase_url') que não existe e
--    Management API não tem permissão pra ALTER DATABASE SET.
--    Fix: reescrever os 2 crons hardcoding URL + cron_internal_key.

DO $$ BEGIN PERFORM cron.unschedule('calcular-risk-scores'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'calcular-risk-scores',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer lumied_cron_dbb4070f6b5601bb23bd2cb38d373bea'
    ),
    body := '{"action":"calcular_risk_scores"}'::jsonb
  )
  $$
);

DO $$ BEGIN PERFORM cron.unschedule('calcular-engagement-familias'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'calcular-engagement-familias',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer lumied_cron_dbb4070f6b5601bb23bd2cb38d373bea'
    ),
    body := '{"action":"calcular_engagement_todas_escolas"}'::jsonb
  )
  $$
);

-- 2) cleanup-audit-180d: coluna correta é 'at'
DO $$ BEGIN PERFORM cron.unschedule('cleanup-audit-180d'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'cleanup-audit-180d',
  '0 4 1 * *',
  $$DELETE FROM audit_eventos WHERE at < now() - interval '180 days'$$
);

-- 3) cleanup-wa-messages-90d: coluna correta é 'created_at'
DO $$ BEGIN PERFORM cron.unschedule('cleanup-wa-messages-90d'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'cleanup-wa-messages-90d',
  '0 4 * * 0',
  $$DELETE FROM wa_messages_log WHERE created_at < now() - interval '90 days'$$
);

-- 4) cleanup-rate-limits-deep: coluna correta é 'bucket_start'
DO $$ BEGIN PERFORM cron.unschedule('cleanup-rate-limits-deep'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT