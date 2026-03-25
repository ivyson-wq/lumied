-- Habilita pg_cron e agenda atualização de preços no 1o dia de cada mês às 6h
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Chama a edge function diplomas com action alm_atualizar_precos
-- Via pg_net (HTTP request from PostgreSQL)
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'atualizar-precos-insumos',
  '0 6 1 * *',  -- 1o dia de cada mês às 06:00 UTC
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/diplomas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', current_setting('app.settings.anon_key'),
      'Authorization', 'Bearer ' || current_setting('app.settings.anon_key')
    ),
    body := '{"action":"alm_atualizar_precos"}'::jsonb
  );
  $$
);
