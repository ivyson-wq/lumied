CREATE OR REPLACE FUNCTION fn_tenant_audit_check() RETURNS void AS $$
DECLARE
  r record;
  cnt integer;
  alert_count integer := 0;
  whitelist text[] := ARRAY[
    'escolas','planos','plano_limites','plano_modulos','plano_precos',
    'lumied_staff','lumied_staff_sessoes','lumied_staff_audit','lumied_staff_papeis',
    'lumied_categorias_despesa','lumied_centros_custo','lumied_contas_pagar',
    'modulos','permissoes_papel','faq_respostas',
    'gerente_sessoes','professora_sessoes','secretaria_sessoes','sessoes',
    'admin_sessoes','admins','aluno_sessoes',
    'webauthn_challenges','webauthn_credentials',
    'ml_tokens','newsletter_subscribers','blog_posts','blog_topics',
    'rate_limits','tenant_audit_alerts',
    'configuracoes','config_series_idade',
    'compliance_certificacoes_tipos','compliance_inspecao_templates',
    'escola_extras','push_subscriptions','suporte_faq','suporte_tickets',
    'gtm_lead_events','gtm_roi_calc_log','leads_comerciais'
  ];
BEGIN
  -- 1. Tabelas com escola_id mas sem trigger (auto-fix)
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.column_name = 'escola_id' AND c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN (SELECT tgrelid::regclass::text FROM pg_trigger WHERE tgname = 'trg_tenant_check')
  LOOP
    INSERT INTO tenant_audit_alerts (tipo, tabela, detalhes)
    VALUES ('missing_trigger', r.table_name, 'AUTO-FIX: Trigger criado automaticamente');
    alert_count := alert_count + 1;
    EXECUTE format(
      'CREATE TRIGGER trg_tenant_check BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()',
      r.table_name
    );
  END LOOP;

  -- 2. Registros com NULL escola_id
  FOR r IN SELECT tgrelid::regclass::text as tbl FROM pg_trigger WHERE tgname = 'trg_tenant_check'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE escola_id IS NULL', r.tbl) INTO cnt;
    IF cnt > 0 THEN
      INSERT INTO tenant_audit_alerts (tipo, tabela, detalhes, registros_afetados)
      VALUES ('null_escola_id', r.tbl, cnt || ' registros com escola_id NULL', cnt);
      alert_count := alert_count + 1;
    END IF;
  END LOOP;

  -- 3. Tabelas sem escola_id que deveriam ter
  FOR r IN
    SELECT t.table_name FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND t.table_name != ALL(whitelist)
      AND t.table_name NOT LIKE 'supabase_%' AND t.table_name NOT LIKE 'schema_%'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_name = t.table_name AND c.table_schema = 'public' AND c.column_name = 'escola_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_name = t.table_name AND c.table_schema = 'public' AND c.column_name = 'criado_em'
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM tenant_audit_alerts
      WHERE tabela = r.table_name AND tipo = 'missing_column' AND criado_em > now() - interval '24 hours'
    ) THEN
      INSERT INTO tenant_audit_alerts (tipo, tabela, detalhes)
      VALUES ('missing_column', r.table_name, 'Tabela tem criado_em mas nao tem escola_id');
      alert_count := alert_count + 1;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
