-- 202: Otimizar ticket-resolver cron (15min → 1h)
-- Evita invocações desnecessárias quando não há tickets abertos.
-- Usa verificação SQL antes de chamar a Edge Function via pg_net.

-- Remover job anterior
SELECT cron.unschedule('ticket-resolver-15min') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'ticket-resolver-15min'
);

-- Criar função auxiliar que verifica e chama
CREATE OR REPLACE FUNCTION public.ticket_resolver_if_needed()
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  ticket_count int;
BEGIN
  SELECT count(*) INTO ticket_count FROM tickets WHERE status = 'aberto' LIMIT 1;
  IF ticket_count > 0 THEN
    PERFORM net.http_post(
      url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/ticket-resolver',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzc2NTQ1NSwiZXhwIjoyMDg5MzQxNDU1fQ.MI9khO-VnKpmi80n12rsuBySOPdOi7KhapCV5JOAsj8"}'::jsonb,
      body := '{}'::jsonb
    );
  END IF;
END
$fn$;

-- Novo job: a cada 1 hora, chama a função auxiliar
SELECT cron.schedule(
  'ticket-resolver-1h',
  '0 * * * *',
  $$SELECT public.ticket_resolver_if_needed()$$
);
