-- ═══════════════════════════════════════════════════════════════
--  Migration 329 — outbound-pulse via pg_cron
--
--  Migra o cron diário de outbound do GitHub Actions pra pg_cron.
--  Motivo: GH Actions free tier (2000 min/mês) está estourando por
--  causa do CI; tirar workflows não-essenciais economiza minutos.
--
--  Edge function: outbound-pulse-cron (porta do scripts/outbound-pulse.mjs)
--  Schedule: 10:00 UTC dias úteis (07:00 BRT, igual ao YAML antigo)
-- ═══════════════════════════════════════════════════════════════

-- Garante extensões
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove job antigo se existir (idempotência)
SELECT cron.unschedule('outbound-pulse-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'outbound-pulse-daily');

-- Agenda novo job
SELECT cron.schedule(
  'outbound-pulse-daily',
  '0 10 * * 1-5',  -- 10h UTC = 07h BRT, dias úteis
  $$
  SELECT net.http_post(
    url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/outbound-pulse-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', 'lumied_cron_dbb4070f6b5601bb23bd2cb38d373bea'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000  -- 5min p/ acomodar 40 leads × Anthropic
  );
  $$
);

COMMENT ON EXTENSION pg_cron IS 'pg_cron: schedule diário do outbound-pulse-cron via http_post.';
