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

-- NOTA HISTÓRICA: o agendamento original tinha CRON_INTERNAL_KEY hardcoded
-- (commit 3673bbf, pré-repo-público). Mig 330 supersede com vault lookup.
-- Placeholder aqui mantém o registro do schedule original; valor real vem
-- do vault.lumied_cron_key via _cron_key() helper (criado em mig 330).
DO $$
BEGIN
  -- Só agenda se o helper ainda não existe (replay de histórico do zero)
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_cron_key' AND pronamespace = 'public'::regnamespace) THEN
    PERFORM cron.schedule(
      'outbound-pulse-daily-stub',
      '0 10 * * 1-5',
      'SELECT 1'  -- noop até mig 330 rodar e reescrever
    );
  END IF;
END $$;

COMMENT ON EXTENSION pg_cron IS 'pg_cron: schedule diário do outbound-pulse-cron via http_post.';
