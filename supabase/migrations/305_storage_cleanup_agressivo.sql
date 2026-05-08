-- ═══════════════════════════════════════════════════════════════
-- 305: Cleanup agressivo de tabelas verbosas + reduz retenção
--
-- Contexto (2026-05-08): storage size do projeto Lumied estourou.
-- Estratégia: reduzir período de retenção dos cleanups existentes
-- (mig 256) E rodar DELETE imediato retroativo pra liberar espaço já.
--
-- Períodos novos (todos cortes em half ou mais):
--   audit_eventos:        180d → 60d
--   acesso_eventos:       365d → 90d
--   wa_messages_log:       90d → 30d
--   notificacoes (lidas):  90d → 30d
--   tenant_audit_alerts:   30d → 14d
--   pickup_notificacoes:   sem cleanup → 60d (NOVO)
--   bridge_comandos (executados): sem cleanup formal → 7d (NOVO)
--   lpr_eventos:           sem cutoff explícito → 30d (NOVO)
-- ═══════════════════════════════════════════════════════════════

-- ── 1) DELETE retroativo IMEDIATO ────────────────────────────────
-- Roda agora pra liberar storage; cada bloco em DO pra não falhar
-- se a tabela não existir ou estiver vazia.

DO $$ DECLARE n bigint; BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='audit_eventos') THEN
    EXECUTE 'DELETE FROM audit_eventos WHERE at < now() - interval ''60 days''';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'audit_eventos: % linhas removidas', n;
  END IF;
END $$;

DO $$ DECLARE n bigint; BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='acesso_eventos') THEN
    EXECUTE 'DELETE FROM acesso_eventos WHERE criado_em < now() - interval ''90 days''';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'acesso_eventos: % linhas removidas', n;
  END IF;
END $$;

DO $$ DECLARE n bigint; BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='wa_messages_log') THEN
    EXECUTE 'DELETE FROM wa_messages_log WHERE created_at < now() - interval ''30 days''';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'wa_messages_log: % linhas removidas', n;
  END IF;
END $$;

DO $$ DECLARE n bigint; BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='notificacoes') THEN
    EXECUTE 'DELETE FROM notificacoes WHERE lida = true AND criado_em < now() - interval ''30 days''';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'notificacoes (lidas >30d): % linhas removidas', n;
  END IF;
END $$;

DO $$ DECLARE n bigint; BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tenant_audit_alerts') THEN
    EXECUTE 'DELETE FROM tenant_audit_alerts WHERE resolvido = true AND criado_em < now() - interval ''14 days''';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'tenant_audit_alerts (resolvidos >14d): % linhas removidas', n;
  END IF;
END $$;

DO $$ DECLARE n bigint; BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='pickup_notificacoes') THEN
    EXECUTE 'DELETE FROM pickup_notificacoes WHERE criado_em < now() - interval ''60 days''';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'pickup_notificacoes: % linhas removidas', n;
  END IF;
END $$;

DO $$ DECLARE n bigint; BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='acesso_bridge_comandos') THEN
    EXECUTE $sql$DELETE FROM acesso_bridge_comandos WHERE status IN ('executado','expirado','erro') AND criado_em < now() - interval '7 days'$sql$;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'acesso_bridge_comandos (executados >7d): % linhas removidas', n;
  END IF;
END $$;

DO $$ DECLARE n bigint; BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='lpr_eventos') THEN
    EXECUTE 'DELETE FROM lpr_eventos WHERE criado_em < now() - interval ''30 days''';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'lpr_eventos: % linhas removidas', n;
  END IF;
END $$;

DO $$ DECLARE n bigint; BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='ai_prompts_log') THEN
    EXECUTE 'DELETE FROM ai_prompts_log WHERE criado_em < now() - interval ''30 days''';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'ai_prompts_log: % linhas removidas', n;
  END IF;
END $$;

DO $$ DECLARE n bigint; BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='wa_clicks') THEN
    EXECUTE 'DELETE FROM wa_clicks WHERE criado_em < now() - interval ''90 days''';
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'wa_clicks (>90d): % linhas removidas', n;
  END IF;
END $$;

-- ── 2) Reagenda crons de cleanup com retenção menor ─────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='cleanup-audit-180d') THEN
    PERFORM cron.unschedule('cleanup-audit-180d');
  END IF;
END $$;
SELECT cron.schedule('cleanup-audit-60d', '0 4 * * 0',  -- domingo 4am
  $$DELETE FROM audit_eventos WHERE at < now() - interval '60 days'$$);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='cleanup-acesso-eventos-365d') THEN
    PERFORM cron.unschedule('cleanup-acesso-eventos-365d');
  END IF;
END $$;
SELECT cron.schedule('cleanup-acesso-eventos-90d', '0 4 * * 0',
  $$DELETE FROM acesso_eventos WHERE criado_em < now() - interval '90 days'$$);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='cleanup-wa-messages-90d') THEN
    PERFORM cron.unschedule('cleanup-wa-messages-90d');
  END IF;
END $$;
SELECT cron.schedule('cleanup-wa-messages-30d', '0 4 * * 0',
  $$DELETE FROM wa_messages_log WHERE created_at < now() - interval '30 days'$$);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='cleanup-notificacoes-90d') THEN
    PERFORM cron.unschedule('cleanup-notificacoes-90d');
  END IF;
END $$;
SELECT cron.schedule('cleanup-notificacoes-30d', '0 4 * * 0',
  $$DELETE FROM notificacoes WHERE lida = true AND criado_em < now() - interval '30 days'$$);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='cleanup-audit-alerts-30d') THEN
    PERFORM cron.unschedule('cleanup-audit-alerts-30d');
  END IF;
END $$;
SELECT cron.schedule('cleanup-audit-alerts-14d', '0 5 1 * *',
  $$DELETE FROM tenant_audit_alerts WHERE resolvido = true AND criado_em < now() - interval '14 days'$$);

-- Crons NOVOS pra tabelas que não tinham cleanup
SELECT cron.schedule('cleanup-pickup-notif-60d', '0 4 * * 0',
  $$DELETE FROM pickup_notificacoes WHERE criado_em < now() - interval '60 days'$$);

SELECT cron.schedule('cleanup-bridge-comandos-7d', '0 4 * * *',
  $$DELETE FROM acesso_bridge_comandos WHERE status IN ('executado','expirado','erro') AND criado_em < now() - interval '7 days'$$);

SELECT cron.schedule('cleanup-lpr-eventos-30d', '0 4 * * 0',
  $$DELETE FROM lpr_eventos WHERE criado_em < now() - interval '30 days'$$);

-- ── 3) VACUUM nas tabelas mexidas pra realmente liberar storage ─
-- pg_cron não permite VACUUM (transaction-bound). Roda manualmente após:
--   VACUUM (ANALYZE, VERBOSE) audit_eventos, acesso_eventos, wa_messages_log,
--   notificacoes, tenant_audit_alerts, pickup_notificacoes,
--   acesso_bridge_comandos, lpr_eventos, ai_prompts_log, wa_clicks;

-- ── 4) Diagnóstico final ─────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '=== Top 15 tabelas por tamanho após cleanup ===';
  FOR r IN
    SELECT schemaname || '.' || tablename AS tbl,
           pg_size_pretty(pg_total_relation_size(schemaname||'.'||quote_ident(tablename))) AS sz,
           pg_total_relation_size(schemaname||'.'||quote_ident(tablename)) AS bytes
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY bytes DESC
    LIMIT 15
  LOOP
    RAISE NOTICE '  % | %', rpad(r.tbl, 50), r.sz;
  END LOOP;
END $$;
