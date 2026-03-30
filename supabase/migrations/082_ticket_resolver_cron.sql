-- 082: Cron job para resolver tickets automaticamente a cada 15 minutos
-- Usa pg_cron + pg_net para chamar a Edge Function ticket-resolver

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Remover job anterior se existir
SELECT cron.unschedule('ticket-resolver-15min') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'ticket-resolver-15min'
);

-- Criar o cron job: a cada 15 minutos chama a Edge Function
SELECT cron.schedule(
  'ticket-resolver-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/ticket-resolver',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc2NTQ1NSwiZXhwIjoyMDg5MzQxNDU1fQ.MI9khO-VnKpmi80n12rsuBySOPdOi7KhapCV5JOAsj8"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
