-- ═══════════════════════════════════════════════════════════════
-- 304: Reduzir frequência de pg_cron pra economizar Disk IO budget
--
-- Contexto (2026-05-08): projeto Lumied estourou Disk IO Budget do
-- Free Tier (250GB/mês). DB ficou throttled por horas. Vilão #1:
-- fn_tenant_audit_check rodando a cada 30 min faz 217 full-scans
-- por execução = ~10k full-scans/dia.
--
-- Política nova: TODOS os crons recorrentes intra-dia → 2x/dia
-- (06:00 e 18:00 UTC = 03:00 e 15:00 BRT). Crons já diários ou
-- mais raros mantêm. Cleanups que LIBERAM storage mantêm frequência.
-- ═══════════════════════════════════════════════════════════════

DO $reagenda$
DECLARE
  r record;
BEGIN
  -- Helper: reagenda só se já existe (evita erro)
  FOR r IN SELECT jobname FROM cron.job WHERE jobname IN (
    -- Crons recorrentes pesados / hourly / */N min — TODOS pra 2x/dia
    'tenant-audit-check',           -- era */30 (vilão #1)
    'processar-remocoes-face',      -- era */15
    'wa-expirar-janelas',           -- era hourly
    'alm-reval-warmup',             -- era hourly (warmup proxy reval)
    'ticket-resolver-1h',           -- era hourly
    'rate-limits-cleanup-hourly'    -- era hourly
  )
  LOOP
    PERFORM cron.unschedule(r.jobname);
    RAISE NOTICE 'Desagendado: %', r.jobname;
  END LOOP;
END $reagenda$;

-- 1) tenant-audit-check (era */30 → 2x/dia)
SELECT cron.schedule('tenant-audit-check', '0 6,18 * * *', 'SELECT fn_tenant_audit_check()');

-- 2) processar-remocoes-face (era */15 → 2x/dia)
SELECT cron.schedule(
  'processar-remocoes-face',
  '0 6,18 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1/acesso',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer 954890ffb56addceaf8b692336fe3ab5249a50214592e2bc012c8d56daea474e'
    ),
    body := jsonb_build_object('action','acesso_processar_remocoes_face')
  );
  $cron$
);

-- 3) wa-expirar-janelas (era hourly → 2x/dia)
SELECT cron.schedule('wa-expirar-janelas', '0 6,18 * * *', 'SELECT wa_expirar_janelas_vencidas()');

-- 4) alm-reval-warmup (era hourly → 2x/dia)
-- O warmup do reval-proxy ainda faz sentido, mas 2x/dia já mantém cache aquecido pras horas de uso pesado
SELECT cron.schedule(
  'alm-reval-warmup',
  '0 6,18 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://reval-proxy.ivyson.workers.dev/warmup',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('source','pg_cron')
  );
  $cron$
);

-- 5) ticket-resolver-1h (era hourly → 2x/dia)
-- Tickets pendentes vão demorar até 12h pra primeira tentativa de IA, mas isso é aceitável
SELECT cron.schedule('ticket-resolver-1h', '0 6,18 * * *', 'SELECT public.ticket_resolver_if_needed()');

-- 6) rate-limits-cleanup-hourly (era hourly → 2x/dia)
SELECT cron.schedule('rate-limits-cleanup-hourly', '0 6,18 * * *', 'SELECT public.rate_limits_cleanup()');

-- 7) bridge-comandos-cleanup (era */5 → 30 min)
-- Esse não vai pra 2x/dia porque a fila de comandos do bridge precisa ser limpa frequentemente,
-- senão acumula e o Bridge fica lento. */30 já é 90% menos load que */5
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bridge-comandos-cleanup') THEN
    PERFORM cron.unschedule('bridge-comandos-cleanup');
  END IF;
END $$;
SELECT cron.schedule('bridge-comandos-cleanup', '*/30 * * * *', 'SELECT cleanup_bridge_comandos()');

-- ═══════════════════════════════════════════════════════════════
-- Crons que MANTÊM frequência (são leves OU críticos OU já diários)
--   - compliance-verificar-ponto: já era 2x/dia em dias úteis ✓
--   - ponto-pull-afd-diario: 1x/dia 03:30 BRT ✓
--   - cleanup-* (notificacoes/audit/wa/sessions/etc): semanal/mensal ✓
--   - backup-escolas-daily: 1x/dia ✓
--   - lpr-eventos-cleanup, cleanup-impressoes-storage: diário ✓
--   - calcular-risk-scores, calcular-engagement-familias: 1x/dia ✓
--   - ia-insights-diarios, ia-reset-*: 1x/dia ✓
--   - fin-* (conciliacao, inadimplencia, boletos, relatorio): diário/mensal ✓
--   - gtm-nurture-daily: 1x/dia ✓
-- ═══════════════════════════════════════════════════════════════

-- Diagnóstico: lista os crons após reagendamento
DO $$
DECLARE
  r record;
  total int;
BEGIN
  SELECT count(*) INTO total FROM cron.job;
  RAISE NOTICE '=== Total de pg_cron jobs ativos: % ===', total;
  FOR r IN SELECT jobname, schedule FROM cron.job ORDER BY jobname LOOP
    RAISE NOTICE '  % | %', r.jobname, r.schedule;
  END LOOP;
END $$;
