-- =====================================================
-- 237: Backups diários por escola
-- =====================================================
-- Cria infra para backups diários individualizados:
--   · Tabela backups_log (auditoria)
--   · Bucket privado backups-escolas
--   · pg_cron job diário às 06:00 UTC (03:00 BRT)
-- =====================================================

CREATE TABLE IF NOT EXISTS backups_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id      uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  data_backup    date NOT NULL,
  status         text NOT NULL DEFAULT 'em_andamento'
                   CHECK (status IN ('em_andamento','sucesso','erro','rotated')),
  tamanho_bytes  bigint,
  storage_path   text,
  erro_msg       text,
  tabelas_inc    integer,
  linhas_total   bigint,
  iniciado_em    timestamptz NOT NULL DEFAULT now(),
  concluido_em   timestamptz,
  UNIQUE (escola_id, data_backup)
);

CREATE INDEX IF NOT EXISTS idx_backups_escola       ON backups_log(escola_id);
CREATE INDEX IF NOT EXISTS idx_backups_data         ON backups_log(data_backup DESC);
CREATE INDEX IF NOT EXISTS idx_backups_status_data  ON backups_log(status, data_backup);

ALTER TABLE backups_log DISABLE ROW LEVEL SECURITY;

-- Bucket privado
INSERT INTO storage.buckets (id, name, public)
VALUES ('backups-escolas','backups-escolas', false)
ON CONFLICT (id) DO NOTHING;

-- Retention em dias por tier (fallback 14)
CREATE OR REPLACE FUNCTION backup_retention_days(p_escola_id uuid) RETURNS int AS $$
DECLARE
  tier text;
BEGIN
  SELECT lower(coalesce(p.slug, p.nome, ''))
    INTO tier
    FROM escolas e LEFT JOIN planos p ON p.id = e.plano_id
   WHERE e.id = p_escola_id;

  RETURN CASE
    WHEN tier LIKE '%prestige%' THEN 90
    WHEN tier LIKE '%evolu%'    THEN 30
    ELSE 14
  END;
EXCEPTION WHEN OTHERS THEN RETURN 14;
END $$ LANGUAGE plpgsql;

-- pg_cron: dispara a edge function de backup todos os dias às 06:00 UTC
-- (depende do pg_cron estar habilitado e das extensões http/supabase_functions_http).
-- Se o cron falhar por falta de extensão, o bloco EXCEPTION impede rollback.
DO $$
DECLARE
  supa_url text := 'https://brgorknbrjlfwvrrlwxj.supabase.co';
  service_role text := current_setting('app.settings.service_role', true);
BEGIN
  PERFORM cron.unschedule('backup-escolas-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

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
          'Authorization','Bearer ' || current_setting('app.settings.cron_internal_key', true)
        ),
        body := '{"action":"run_all","_from":"pg_cron"}'::jsonb
      );
    $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.schedule falhou (pg_cron/net podem não estar habilitados): %', SQLERRM;
END $$;

COMMENT ON TABLE backups_log IS 'Auditoria de backups diários por escola. Unique (escola_id, data_backup) evita duplicatas.';
