-- Migration 220: pg_cron job para limpar tabela rate_limits a cada hora
-- Depende da migration 218 (rate_limits + rate_limits_cleanup function)

-- Garante que pg_cron está habilitado
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove job existente se houver (idempotente)
DO $$
BEGIN
  PERFORM cron.unschedule('rate-limits-cleanup-hourly');
EXCEPTION WHEN OTHERS THEN
  NULL; -- ignora se não existir
END $$;

-- Agenda o job para rodar no minuto 0 de cada hora
SELECT cron.schedule(
  'rate-limits-cleanup-hourly',
  '0 * * * *',
  $$SELECT public.rate_limits_cleanup();$$
);
