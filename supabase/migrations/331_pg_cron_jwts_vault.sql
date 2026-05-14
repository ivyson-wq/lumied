-- ═══════════════════════════════════════════════════════════════
--  Migration 331 — Migra JWTs e tokens hardcoded de pg_cron pro vault
--
--  Contexto: além da CRON_INTERNAL_KEY (já migrada em mig 330),
--  existiam 18 jobs com tokens inline em cron.job.command:
--   • 10 jobs com service_role JWT (daily-digest, compliance-*,
--     wa-relatorio-semanal, ia-insights-diarios, roi-snapshot-mensal,
--     backup-escolas-daily, reativar-leads-frios, lead-scoring,
--     followup-demo)
--   • 7 jobs com ipcron- token (insta-publisher.vercel.app crons)
--   • 1 job com acesso bridge token (processar-remocoes-face)
--
--  Esses não vazaram com o repo público (cron.job é DB-only), mas
--  o pattern de hardcode é frágil: rotação exige reescrever 18 jobs,
--  e DB admins veem o valor em plain text em cron.job.command.
--
--  Pré-requisito: vault.{service_role_key, insta_publisher_cron_key,
--  acesso_bridge_internal_key} populados via Management API ANTES
--  de aplicar esta mig (pra não ter valor hardcoded em arquivo público).
-- ═══════════════════════════════════════════════════════════════

-- ── Helpers SECURITY DEFINER pra ler do vault em runtime ──
CREATE OR REPLACE FUNCTION public._service_role_jwt() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1), '__missing_service_role__')
$$;

CREATE OR REPLACE FUNCTION public._insta_publisher_key() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'insta_publisher_cron_key' LIMIT 1), '__missing_insta_key__')
$$;

CREATE OR REPLACE FUNCTION public._acesso_internal_key() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'acesso_bridge_internal_key' LIMIT 1), '__missing_acesso_key__')
$$;

REVOKE ALL ON FUNCTION public._service_role_jwt() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._insta_publisher_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._acesso_internal_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._service_role_jwt() TO postgres;
GRANT EXECUTE ON FUNCTION public._insta_publisher_key() TO postgres;
GRANT EXECUTE ON FUNCTION public._acesso_internal_key() TO postgres;

-- ─────────────────────────────────────────────────────────────────
--  Reschedule jobs com service_role JWT (10 jobs)
-- ─────────────────────────────────────────────────────────────────

SELECT cron.unschedule('daily-digest') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='daily-digest');
SELECT cron.schedule('daily-digest', '0 20 * * 1-5', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/daily-digest',
    '{"action":"generate"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._service_role_jwt()),
    5000
  )
$$);

SELECT cron.unschedule('compliance-verificar-ponto') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='compliance-verificar-ponto');
SELECT cron.schedule('compliance-verificar-ponto', '0 6,18 * * 1-5', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/compliance',
    '{"action":"compliance_verificar_ponto_auto"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._service_role_jwt()),
    5000
  )
$$);

SELECT cron.unschedule('compliance-verificar-prazos') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='compliance-verificar-prazos');
SELECT cron.schedule('compliance-verificar-prazos', '0 7 * * 1-5', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/compliance',
    '{"action":"compliance_verificar_prazos_auto"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._service_role_jwt()),
    5000
  )
$$);

SELECT cron.unschedule('wa-relatorio-semanal') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='wa-relatorio-semanal');
SELECT cron.schedule('wa-relatorio-semanal', '0 9 * * 6', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/api',
    '{"action":"wa_relatorio_semanal"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._service_role_jwt()),
    5000
  )
$$);

SELECT cron.unschedule('ia-insights-diarios') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='ia-insights-diarios');
SELECT cron.schedule('ia-insights-diarios', '0 10 * * 1-5', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/lumied-ai',
    '{"action":"insights_diarios"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._service_role_jwt()),
    5000
  )
$$);

SELECT cron.unschedule('roi-snapshot-mensal') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='roi-snapshot-mensal');
SELECT cron.schedule('roi-snapshot-mensal', '0 6 1 * *', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/api',
    '{"action":"roi_snapshot_mensal"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._service_role_jwt()),
    5000
  )
$$);

SELECT cron.unschedule('backup-escolas-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='backup-escolas-daily');
SELECT cron.schedule('backup-escolas-daily', '0 6 * * *', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/backup-escolas',
    '{"action":"run_all","_from":"pg_cron"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._service_role_jwt()),
    5000
  )
$$);

SELECT cron.unschedule('reativar-leads-frios') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='reativar-leads-frios');
SELECT cron.schedule('reativar-leads-frios', '0 13 * * *', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/api',
    '{"action":"reativar_leads_frios_auto"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._service_role_jwt()),
    5000
  )
$$);

SELECT cron.unschedule('lead-scoring') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='lead-scoring');
SELECT cron.schedule('lead-scoring', '0 9 * * *', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/api',
    '{"action":"lead_scoring_auto"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._service_role_jwt()),
    5000
  )
$$);

SELECT cron.unschedule('followup-demo') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='followup-demo');
SELECT cron.schedule('followup-demo', '0 12 * * *', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/api',
    '{"action":"followup_demo_auto"}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._service_role_jwt()),
    5000
  )
$$);

-- ─────────────────────────────────────────────────────────────────
--  Reschedule jobs com ipcron- token (7 jobs)
-- ─────────────────────────────────────────────────────────────────

SELECT cron.unschedule('insta_publisher_insights') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='insta_publisher_insights');
SELECT cron.schedule('insta_publisher_insights', '0 4 * * *', $$
  SELECT net.http_post(
    'https://insta-publisher.vercel.app/api/insights-sync',
    '{}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._insta_publisher_key()),
    5000
  )
$$);

SELECT cron.unschedule('insta-master-cron') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='insta-master-cron');
SELECT cron.schedule('insta-master-cron', '0 12 * * *', $$
  SELECT net.http_post(
    url := 'https://insta-publisher.vercel.app/api/cron/master',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._insta_publisher_key()),
    body := '{}'::jsonb
  ) AS request_id;
$$);

SELECT cron.unschedule('insta-blog-auto') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='insta-blog-auto');
SELECT cron.schedule('insta-blog-auto', '0 13 * * *', $$
  SELECT net.http_post(
    url := 'https://insta-publisher.vercel.app/api/cron/blog-auto',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._insta_publisher_key()),
    body := '{}'::jsonb
  ) AS request_id;
$$);

SELECT cron.unschedule('insta-publisher-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='insta-publisher-tick');
SELECT cron.schedule('insta-publisher-tick', '0 12 * * *', $$
  SELECT net.http_post(
    url := 'https://insta-publisher.vercel.app/api/cron/tick',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._insta_publisher_key()),
    body := '{}'::jsonb
  ) AS request_id;
$$);

SELECT cron.unschedule('insta-publisher-auto-generate') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='insta-publisher-auto-generate');
SELECT cron.schedule('insta-publisher-auto-generate', '0 12 * * *', $$
  SELECT net.http_post(
    url := 'https://insta-publisher.vercel.app/api/cron/auto-generate',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._insta_publisher_key()),
    body := '{}'::jsonb
  ) AS request_id;
$$);

SELECT cron.unschedule('insta-blog-nurture') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='insta-blog-nurture');
SELECT cron.schedule('insta-blog-nurture', '0 12 * * *', $$
  SELECT net.http_post(
    url := 'https://insta-publisher.vercel.app/api/cron/blog-nurture',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._insta_publisher_key()),
    body := '{}'::jsonb
  ) AS request_id;
$$);

SELECT cron.unschedule('insta-publisher-healthcheck') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='insta-publisher-healthcheck');
SELECT cron.schedule('insta-publisher-healthcheck', '0 14 * * *', $$
  SELECT net.http_get(
    url := 'https://insta-publisher.vercel.app/api/health/content-pipeline?send_alert=1',
    headers := jsonb_build_object('Authorization','Bearer '||public._insta_publisher_key())
  ) AS request_id;
$$);

-- ─────────────────────────────────────────────────────────────────
--  Reschedule job com token acesso (1 job)
-- ─────────────────────────────────────────────────────────────────

SELECT cron.unschedule('processar-remocoes-face') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='processar-remocoes-face');
SELECT cron.schedule('processar-remocoes-face', '0 6,18 * * *', $$
  SELECT net.http_post(
    url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/acesso',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._acesso_internal_key()),
    body := jsonb_build_object('action','acesso_processar_remocoes_face')
  );
$$);

COMMENT ON FUNCTION public._service_role_jwt() IS 'pg_cron helper: lê service_role JWT do vault.service_role_key';
COMMENT ON FUNCTION public._insta_publisher_key() IS 'pg_cron helper: lê Bearer token p/ insta-publisher.vercel.app';
COMMENT ON FUNCTION public._acesso_internal_key() IS 'pg_cron helper: lê internal key da edge function acesso (processar_remocoes_face)';
