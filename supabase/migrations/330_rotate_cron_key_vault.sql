-- ═══════════════════════════════════════════════════════════════
--  Migration 330 — Rotação do CRON_INTERNAL_KEY via vault
--
--  Contexto: repo virou público em 14/05; a CRON_INTERNAL_KEY antiga
--  estava hardcoded em migs 283/290/329, outbound-pulse.yml e
--  scripts/outbound-pulse.mjs — agora público no git permanentemente.
--  Rotação obrigatória.
--
--  Nova key vive APENAS em:
--    • vault.lumied_cron_key  (secret_id 05e78fe2-07c3-4d5e-8467-66270f7d47fe)
--    • Supabase env CRON_INTERNAL_KEY (edge functions)
--    • GitHub Actions secret CRON_INTERNAL_KEY (workflows)
--
--  Nenhuma mig nem código de repo contém a key inline daqui pra frente.
-- ═══════════════════════════════════════════════════════════════

-- Helper local: lê a key do vault em tempo de execução do cron.
-- Usado dentro do command SQL de cada job rescheduled abaixo.
CREATE OR REPLACE FUNCTION public._cron_key() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lumied_cron_key' LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._cron_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._cron_key() TO postgres;

-- ── 1. Jobs que tinham a key HARDCODED em Authorization Bearer ──

-- 77: calcular-risk-scores
SELECT cron.unschedule('calcular-risk-scores') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='calcular-risk-scores');
SELECT cron.schedule('calcular-risk-scores', '0 9 * * *', $$
  SELECT net.http_post(
    url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/api',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._cron_key()),
    body := '{"action":"calcular_risk_scores"}'::jsonb
  )
$$);

-- 78: calcular-engagement-familias
SELECT cron.unschedule('calcular-engagement-familias') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='calcular-engagement-familias');
SELECT cron.schedule('calcular-engagement-familias', '0 3 * * *', $$
  SELECT net.http_post(
    url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/api',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._cron_key()),
    body := '{"action":"calcular_engagement_todas_escolas"}'::jsonb
  )
$$);

-- 82: atualizar-precos-insumos
SELECT cron.unschedule('atualizar-precos-insumos') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='atualizar-precos-insumos');
SELECT cron.schedule('atualizar-precos-insumos', '0 6 1 * *', $$
  SELECT net.http_post(
    url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/diplomas',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._cron_key()),
    body := '{"action":"alm_atualizar_precos"}'::jsonb,
    timeout_milliseconds := 5000
  )
$$);

-- 122: ponto-pull-afd-diario
SELECT cron.unschedule('ponto-pull-afd-diario') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='ponto-pull-afd-diario');
SELECT cron.schedule('ponto-pull-afd-diario', '30 6 * * *', $$
  SELECT net.http_post(
    url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/ponto',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public._cron_key()),
    body := jsonb_build_object('action','ponto_pull_afd_diario_cron')
  );
$$);

-- 124: outbound-pulse-daily (criado em mig 329 com hardcode)
SELECT cron.unschedule('outbound-pulse-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='outbound-pulse-daily');
SELECT cron.schedule('outbound-pulse-daily', '0 10 * * 1-5', $$
  SELECT net.http_post(
    url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/outbound-pulse-cron',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-key', public._cron_key()),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
$$);

-- ── 2. Jobs que liam de current_setting('app.settings.cron_internal_key') ──
-- Antes liam de um GUC database-level que requer superuser pra rotacionar.
-- Migramos pra mesma fonte (vault) pra ficar tudo uniforme e rotacionável
-- só via Management API.

-- 117: boletos-gerar-batch-mensal
SELECT cron.unschedule('boletos-gerar-batch-mensal') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='boletos-gerar-batch-mensal');
SELECT cron.schedule('boletos-gerar-batch-mensal', '0 11 28 * *', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/financeiro-ext',
    jsonb_build_object('action','boletos_gerar_batch','_cron_key', public._cron_key()),
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','apikey', current_setting('app.settings.anon_key', true)),
    5000
  )
$$);

-- 118: inadimplencia-verificar-diario
SELECT cron.unschedule('inadimplencia-verificar-diario') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='inadimplencia-verificar-diario');
SELECT cron.schedule('inadimplencia-verificar-diario', '0 12 * * 1-5', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/financeiro-ext',
    jsonb_build_object('action','inadimplencia_verificar','_cron_key', public._cron_key()),
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','apikey', current_setting('app.settings.anon_key', true)),
    5000
  )
$$);

-- 119: conciliacao-bancaria-diaria
SELECT cron.unschedule('conciliacao-bancaria-diaria') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='conciliacao-bancaria-diaria');
SELECT cron.schedule('conciliacao-bancaria-diaria', '0 10 * * 1-5', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/financeiro-ext',
    jsonb_build_object('action','conciliacao_automatica','_cron_key', public._cron_key()),
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','apikey', current_setting('app.settings.anon_key', true)),
    5000
  )
$$);

-- 120: relatorio-financeiro-mensal
SELECT cron.unschedule('relatorio-financeiro-mensal') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='relatorio-financeiro-mensal');
SELECT cron.schedule('relatorio-financeiro-mensal', '0 11 3 * *', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/financeiro-ext',
    jsonb_build_object('action','relatorio_mensal_enviar','_cron_key', public._cron_key()),
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','apikey', current_setting('app.settings.anon_key', true)),
    5000
  )
$$);

-- 121: workflow-processar-eventos
SELECT cron.unschedule('workflow-processar-eventos') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='workflow-processar-eventos');
SELECT cron.schedule('workflow-processar-eventos', '*/30 * * * *', $$
  SELECT net.http_post(
    'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/workflows',
    jsonb_build_object('action','workflow_processar_eventos','_cron_key', public._cron_key()),
    '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','apikey', current_setting('app.settings.anon_key', true)),
    5000
  )
$$);

COMMENT ON FUNCTION public._cron_key() IS 'Helper p/ pg_cron ler CRON_INTERNAL_KEY do vault em tempo de execução. Permite rotação só atualizando vault.lumied_cron_key — nenhum mig precisa hardcode.';
