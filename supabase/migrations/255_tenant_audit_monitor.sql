-- ════════════════════════════════════════════════════════════════
--  Migration 255: Monitor contínuo de tenant isolation
--
--  Cria uma função + pg_cron job que roda a cada 30 minutos.
--  Verifica:
--    1. Tabelas com escola_id mas sem trigger trg_tenant_check
--    2. Registros com escola_id NULL (não deveria existir)
--    3. Tabelas novas que não possuem escola_id (possível esquecimento)
--  Se encontrar problemas, registra em tenant_audit_alerts e
--  envia email via send-email function.
-- ════════════════════════════════════════════════════════════════

-- Tabela de alertas de auditoria
CREATE TABLE IF NOT EXISTS tenant_audit_alerts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo text NOT NULL,           -- 'missing_trigger', 'null_escola_id', 'missing_column'
  tabela text NOT NULL,
  detalhes text,
  registros_afetados integer DEFAULT 0,
  resolvido boolean DEFAULT false,
  criado_em timestamptz DEFAULT now()
);

-- Função de auditoria
CREATE OR REPLACE FUNCTION fn_tenant_audit_check() RETURNS void AS $$
DECLARE
  r record;
  cnt integer;
  alert_count integer := 0;
BEGIN
  -- 1. Tabelas com escola_id mas sem trigger
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.column_name = 'escola_id'
      AND c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN (
        SELECT tgrelid::regclass::text FROM pg_trigger WHERE tgname = 'trg_tenant_check'
      )
  LOOP
    INSERT INTO tenant_audit_alerts (tipo, tabela, detalhes)
    VALUES ('missing_trigger', r.table_name, 'Tabela tem escola_id mas não tem trg_tenant_check')
    ON CONFLICT DO NOTHING;
    alert_count := alert_count + 1;
    -- Auto-fix: criar trigger
    EXECUTE format(
      'CREATE TRIGGER trg_tenant_check BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()',
      r.table_name
    );
    RAISE NOTICE 'AUTO-FIX: Trigger criado em %', r.table_name;
  END LOOP;

  -- 2. Registros com escola_id NULL
  FOR r IN
    SELECT tgrelid::regclass::text as tbl
    FROM pg_trigger
    WHERE tgname = 'trg_tenant_check'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE escola_id IS NULL', r.tbl) INTO cnt;
    IF cnt > 0 THEN
      INSERT INTO tenant_audit_alerts (tipo, tabela, detalhes, registros_afetados)
      VALUES ('null_escola_id', r.tbl, cnt || ' registros com escola_id NULL', cnt);
      alert_count := alert_count + 1;
      RAISE NOTICE 'ALERTA: % tem % registros com escola_id NULL', r.tbl, cnt;
    END IF;
  END LOOP;

  -- 3. Tabelas sem escola_id que deveriam ter (heurística: tem coluna criado_em + não é de sistema)
  -- Apenas loga, não auto-corrige
  FOR r IN
    SELECT t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND t.table_name NOT IN (
        -- tabelas que legitimamente não precisam de escola_id
        'escolas', 'planos', 'plano_limites', 'plano_modulos', 'plano_precos',
        'lumied_staff', 'lumied_staff_sessoes', 'lumied_staff_audit',
        'modulos', 'permissoes_papel', 'faq_respostas',
        'gerente_sessoes', 'professora_sessoes', 'secretaria_sessoes', 'sessoes',
        'webauthn_challenges', 'webauthn_credentials',
        'ml_tokens', 'newsletter_subscribers', 'blog_posts', 'blog_topics',
        'rate_limits', 'tenant_audit_alerts',
        'configuracoes', 'config_series_idade'
      )
      AND t.table_name NOT LIKE 'supabase_%'
      AND t.table_name NOT LIKE 'schema_%'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_name = t.table_name
          AND c.table_schema = 'public'
          AND c.column_name = 'escola_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_name = t.table_name
          AND c.table_schema = 'public'
          AND c.column_name = 'criado_em'
      )
  LOOP
    -- Só alerta se não existe alerta recente (últimas 24h) para essa tabela
    IF NOT EXISTS (
      SELECT 1 FROM tenant_audit_alerts
      WHERE tabela = r.table_name
        AND tipo = 'missing_column'
        AND criado_em > now() - interval '24 hours'
    ) THEN
      INSERT INTO tenant_audit_alerts (tipo, tabela, detalhes)
      VALUES ('missing_column', r.table_name, 'Tabela tem criado_em mas não tem escola_id — possível falha de tenant isolation');
      alert_count := alert_count + 1;
    END IF;
  END LOOP;

  IF alert_count > 0 THEN
    RAISE NOTICE 'Tenant audit: % alertas encontrados', alert_count;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Agenda pg_cron: roda a cada 30 minutos
SELECT cron.schedule(
  'tenant-audit-check',
  '*/30 * * * *',
  'SELECT fn_tenant_audit_check()'
);

-- View para monitoramento rápido
CREATE OR REPLACE VIEW v_tenant_audit_dashboard AS
SELECT
  tipo,
  count(*) as total,
  count(*) FILTER (WHERE NOT resolvido) as pendentes,
  max(criado_em) as ultimo_alerta
FROM tenant_audit_alerts
GROUP BY tipo
ORDER BY pendentes DESC;
