-- =====================================================
-- 238: Fix cron de backups — usa service_role_key em vez de
--     CRON_INTERNAL_KEY (que não era sincronizado com o Postgres).
-- =====================================================
-- O cron agendado em 237 passava `current_setting('app.settings.cron_internal_key')`
-- como Bearer, mas esse setting nunca era populado no Postgres (só a env da
-- edge function era). Resultado: cron batia na função com Bearer vazio e
-- recebia 403.
--
-- Fix: usar o service_role_key do Supabase — é um JWT estático conhecido
-- tanto pelo Postgres (via vault.decrypted_secrets OR app.settings) quanto
-- pela edge function (env SUPABASE_SERVICE_ROLE_KEY).
--
-- Setup necessário (1x): o usuário precisa rodar no Supabase SQL Editor,
-- como superuser:
--   ALTER DATABASE postgres SET app.settings.service_role_key TO '<service_role_jwt>';
--   SELECT pg_reload_conf();
-- Isso persiste entre restarts. O valor está em:
--   Supabase Dashboard → Settings → API → service_role secret
-- =====================================================

-- Desagenda o job antigo (se existir)
DO $$ BEGIN
  PERFORM cron.unschedule('backup-escolas-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Reagenda usando service_role
DO $$
BEGIN
  PERFORM cron.schedule(
    'backup-escolas-daily',
    '0 6 * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/backup-escolas',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer ' || COALESCE(
            current_setting('app.settings.service_role_key', true),
            (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
            ''
          )
        ),
        body := '{"action":"run_all","_from":"pg_cron"}'::jsonb
      );
    $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.schedule falhou (pg_cron/net podem não estar habilitados): %', SQLERRM;
END $$;

COMMENT ON EXTENSION pg_cron IS
  'Usado para job backup-escolas-daily. Se parar de rodar, checar: ' ||
  '1) ALTER DATABASE postgres SET app.settings.service_role_key foi setado; ' ||
  '2) extensão net/pg_net está habilitada; 3) cron.job_run_details mostra success.';
