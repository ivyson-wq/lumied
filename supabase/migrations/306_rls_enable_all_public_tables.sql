-- ═══════════════════════════════════════════════════════════════
-- 306: Enable RLS on ALL public tables flagged by Supabase monitor
--
-- Contexto (2026-05-09): Supabase Security Advisor reportou 72
-- critical issues — todas tabelas public sem RLS. A maioria é do
-- schema Construfare mas compartilha o mesmo projeto Supabase.
--
-- Estratégia:
--   1. ALTER TABLE ENABLE ROW LEVEL SECURITY em todas as 66 tabelas
--   2. Criar policy "service_role only" como default seguro
--      (edge functions usam service_role_key, então continuam funcionando)
--   3. Fix security definer views → security_invoker
--   4. Revogar acesso direto a colunas sensíveis em corretores_auth
--
-- IMPORTANTE: NÃO quebra nada porque:
--   - Edge functions usam SUPABASE_SERVICE_ROLE_KEY (bypassa RLS)
--   - Anon key sem policy = acesso bloqueado (correto)
--   - Se alguma tabela precisar de acesso anon, criar policy específica depois
-- ═══════════════════════════════════════════════════════════════

-- ── 1) Enable RLS em todas as 66 tabelas ─────────────────────────

DO $rls$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'condicoes_comerciais',
    'aprovacoes_eventos',
    'snapshots_mensais',
    'tickets',
    'ticket_comentarios',
    'conciliacao_clientes',
    'sienge_baixas_csv_imports',
    'sienge_baixas_csv_linhas',
    'compras_solicitacoes_itens',
    'compras_pedidos_itens',
    'sienge_baixas_propostas',
    'conciliacao_fornecedores',
    'sienge_baixas_propostas_cp',
    'compras_recebimentos_itens',
    'documentos',
    'extratos_bancarios',
    'extrato_linhas',
    'orcamento_itens',
    'orcamentos',
    'orcamento_despesas',
    'documentos_versoes',
    'corretores_auth',
    'corretores',
    'obras_materiais_comerciais',
    'lista_espera',
    'propostas_venda',
    'notificacoes_email',
    'sienge_reconcile_chunks',
    'regua_config',
    'financiamentos',
    'financiamentos_historico',
    'cotacoes',
    'aprovacoes_config',
    'aprovacoes',
    'cotacoes_fornecedores',
    'obras_personalizacoes',
    'cotacoes_itens',
    'cotacoes_respostas',
    'config_inadimplencia',
    'reservas',
    'sienge_bills_raw',
    'sienge_receivables_raw',
    'sienge_reconcile_state',
    'comercial_audit_log',
    'compras_pedidos_parcelas',
    'fornecedores_contratos_retencoes',
    'contrato_clausulas',
    'contratos_gerados',
    'compliance_documentos',
    'compliance_fornecedor',
    'fornecedores_contratos_itens',
    'fornecedores_contratos_categorias',
    'fornecedores_contratos_parcelas',
    'recibos_pagamento',
    'fluxo_caixa_previsto',
    'compras_log',
    'fluxo_caixa_saldo_inicial',
    'fluxo_caixa_linhas',
    'estoque_movimentos',
    'cobrancas_avisos',
    'fluxo_caixa_realizado_manual',
    'empreendimento_contrato_dados',
    'cobrancas',
    'contrato_templates',
    'notificacoes',
    'lgpd_access_log',
    'organizacoes',
    'app_errors'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      -- Create service_role bypass policy if none exists
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=tbl
      ) THEN
        EXECUTE format(
          'CREATE POLICY "service_role_bypass" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
          tbl
        );
      END IF;
      RAISE NOTICE 'RLS enabled: %', tbl;
    ELSE
      RAISE NOTICE 'Table not found (skipped): %', tbl;
    END IF;
  END LOOP;
END $rls$;

-- ── 2) Fix Security Definer Views → Security Invoker ─────────────
-- Views with security_definer run as the view OWNER (usually postgres),
-- bypassing RLS. Change to security_invoker so RLS applies.

DO $views$
DECLARE
  vw text;
  views text[] := ARRAY['estoque_saldos', 'v_snapshots_tendencia', 'v_tickets_resumo'];
  vdef text;
BEGIN
  FOREACH vw IN ARRAY views LOOP
    IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name=vw) THEN
      -- Get current view definition
      SELECT definition INTO vdef FROM pg_views WHERE schemaname='public' AND viewname=vw;
      IF vdef IS NOT NULL THEN
        EXECUTE format('CREATE OR REPLACE VIEW public.%I WITH (security_invoker = true) AS %s', vw, vdef);
        RAISE NOTICE 'View fixed (security_invoker): %', vw;
      END IF;
    ELSE
      RAISE NOTICE 'View not found (skipped): %', vw;
    END IF;
  END LOOP;
END $views$;

-- ── 3) Protect sensitive columns in corretores_auth ──────────────
-- Revoke SELECT on password hash columns from anon/authenticated roles
-- (RLS already blocks access, but defense-in-depth)

DO $cols$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='corretores_auth') THEN
    -- Revoke column-level access to sensitive fields
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='corretores_auth' AND column_name='senha_hash') THEN
      EXECUTE 'REVOKE SELECT (senha_hash) ON public.corretores_auth FROM anon, authenticated';
      RAISE NOTICE 'Revoked anon/authenticated access to corretores_auth.senha_hash';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='corretores_auth' AND column_name='password_hash') THEN
      EXECUTE 'REVOKE SELECT (password_hash) ON public.corretores_auth FROM anon, authenticated';
      RAISE NOTICE 'Revoked anon/authenticated access to corretores_auth.password_hash';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='corretores_auth' AND column_name='token') THEN
      EXECUTE 'REVOKE SELECT (token) ON public.corretores_auth FROM anon, authenticated';
      RAISE NOTICE 'Revoked anon/authenticated access to corretores_auth.token';
    END IF;
  END IF;
END $cols$;

-- ── 4) Diagnóstico final ─────────────────────────────────────────
DO $$
DECLARE
  total int;
  enabled int;
BEGIN
  SELECT count(*) INTO total FROM pg_tables WHERE schemaname = 'public';
  SELECT count(*) INTO enabled FROM pg_tables t
    WHERE t.schemaname = 'public'
    AND EXISTS (SELECT 1 FROM pg_class c WHERE c.relname = t.tablename AND c.relrowsecurity = true);
  RAISE NOTICE '=== RLS Status: % of % public tables have RLS enabled ===', enabled, total;
END $$;
