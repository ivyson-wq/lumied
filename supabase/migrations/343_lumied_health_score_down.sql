-- ═══════════════════════════════════════════════════════════════
-- Rollback mig 343 — Lumied Health Score
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'lumied-health-score-refresh';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP FUNCTION IF EXISTS refresh_all_lumied_health_scores();
DROP FUNCTION IF EXISTS fn_lumied_health_score(uuid);
DROP FUNCTION IF EXISTS fn_amps_atual(uuid);
DROP FUNCTION IF EXISTS fn_amps_at_d60(uuid);
DROP TABLE IF EXISTS escola_health_score_cache CASCADE;
