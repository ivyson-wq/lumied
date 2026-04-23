-- ════════════════════════════════════════════════════════════════
--  Migration 258: Cleanup impressões + Otimização de cron jobs
-- ════════════════════════════════════════════════════════════════

-- ═══ PARTE A: Cron job para limpeza de impressões (entregues/rejeitadas > 15 dias) ═══

SELECT cron.schedule(
  'cleanup-impressoes-storage',
  '0 4 * * *',  -- diário às 04:00 UTC (01:00 BRT)
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/diplomas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.cron_internal_key', true)
    ),
    body := '{"action":"impressoes_cleanup"}'::jsonb
  );
  $$
);

-- ═══ PARTE B: Otimização de cron jobs — reduzir invocações desnecessárias ═══

-- 1. refresh-dashboard-stats: de */5 (288/dia) para */15 (96/dia) — -192 invocações/dia
--    Dashboard não precisa de refresh a cada 5 min, 15 min é suficiente
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'refresh-dashboard-stats'),
  schedule := '*/15 * * * *'
);

-- 2. tenant-audit-check: de */30 (48/dia) para 1x/dia — -47 invocações/dia
--    Auditoria de tenant não precisa rodar a cada 30 min, 1x/dia é suficiente
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'tenant-audit-check'),
  schedule := '0 5 * * *'
);

-- 3. ticket-resolver: TEM DUAS entradas (*/40 e 0 * * *) — remover a duplicada
--    ticket-resolver-40min e ticket-resolver-1h fazem a mesma coisa
--    Manter apenas a de 1h (24 invocações/dia) e remover */40 (36/dia) — -36 invocações/dia
SELECT cron.unschedule('ticket-resolver-40min');

-- 4. cleanup-expired-sessions: TEM DUAS entradas (ambas 0 3 * * *)
--    cleanup-expired-sessions e cleanup-all-expired-sessions são redundantes
--    cleanup-all-expired-sessions já faz DELETE em todas as tabelas de sessão
SELECT cron.unschedule('cleanup-expired-sessions');

-- 5. rate-limits-cleanup-hourly: de 1x/hora (24/dia) para 2x/dia — -22 invocações/dia
--    Rate limits com TTL de 7 dias não precisam de cleanup horário
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'rate-limits-cleanup-hourly'),
  schedule := '0 3,15 * * *'
);

-- 6. wa-expirar-janelas: de 1x/hora para 2x/dia — -22 invocações/dia
--    Janelas de WhatsApp expiram por TTL, verificar 2x/dia basta
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'wa-expirar-janelas'),
  schedule := '0 6,18 * * *'
);

-- ═══ RESUMO DA OTIMIZAÇÃO ═══
-- ANTES: ~487 invocações/dia de cron (estimativa)
-- DEPOIS: ~168 invocações/dia de cron
-- Redução: ~319 invocações/dia = ~9.570/mês
-- Crons removidos: 2 (ticket-resolver-40min, cleanup-expired-sessions)
-- Novo: cleanup-impressoes-storage (1x/dia)
