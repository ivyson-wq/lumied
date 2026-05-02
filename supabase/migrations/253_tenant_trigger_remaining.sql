-- ════════════════════════════════════════════════════════════════
--  Migration 253: Adiciona trg_tenant_check nas 27 tabelas restantes
--  que possuem escola_id mas não tinham o trigger.
-- ════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl text;
  remaining_tables text[] := ARRAY[
    'indicacoes_clicks',
    'lumied_contas_receber',
    'regua_execucoes',
    'rh_folha_pagamento',
    'rh_funcionarios',
    'rh_holerites',
    'rh_ponto',
    'roi_config',
    'roi_snapshots',
    'saas_assinaturas',
    'saas_clientes_inter',
    'saas_faturas',
    'tickets',
    'transporte_alunos',
    'transporte_notificacoes',
    'transporte_rastreio',
    'transporte_rotas',
    'wa_consumo_alertas',
    'wa_consumo_mensal',
    'wa_documentos',
    'wa_eventos',
    'wa_familias',
    'wa_faqs',
    'wa_mensagens',
    'wa_relatorios_semanais',
    'wa_staff',
    'wa_turmas'
  ];
BEGIN
  FOREACH tbl IN ARRAY remaining_tables LOOP
    -- Só cria se a tabela existe e o trigger ainda não existe
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl)
       AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tenant_check' AND tgrelid = ('public.' || tbl)::regclass)
    THEN
      EXECUTE format(
        'CREATE TRIGGER trg_tenant_check BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()',
        tbl
      );
      -- Índice se não existe
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = tbl AND indexname = 'idx_' || tbl || '_escola') THEN
        EXECUTE format('CREATE INDEX idx_%I_escola ON public.%I(escola_id)', tbl, tbl);
      END IF;
      RAISE NOTICE 'Trigger + index criado para: %', tbl;
    END IF;
  END LOOP;
END $$;

-- Backfill: garantir que registros existentes tenham escola_id
-- (usar a escola Maple como fallback para dados legados sem escola)
DO $$
DECLARE
  tbl text;
  cnt integer;
  remaining_tables text[] := ARRAY[
    'indicacoes_clicks','lumied_contas_receber','regua_execucoes',
    'rh_folha_pagamento','rh_funcionarios','rh_holerites','rh_ponto',
    'roi_config','roi_snapshots','tickets',
    'transporte_alunos','transporte_notificacoes','transporte_rastreio','transporte_rotas',
    'wa_consumo_alertas','wa_consumo_mensal','wa_documentos','wa_eventos',
    'wa_familias','wa_faqs','wa_mensagens','wa_relatorios_semanais','wa_staff','wa_turmas'
  ];
BEGIN
  FOREACH tbl IN ARRAY remaining_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE escola_id IS NULL', tbl) INTO cnt;
      IF cnt > 0 THEN
        EXECUTE format(
          'UPDATE public.%I SET escola_id = ''f0ab6402-67a0-4829-bdaa-05e90e0b6f9b'' WHERE escola_id IS NULL',
          tbl
        );
        RAISE NOTICE 'Backfill % registros em %', cnt, tbl;
      END IF;
    END IF;
  END LOOP;
END $$;

-- Nota: saas_assinaturas, saas_clientes_inter, saas_faturas são tabelas SaaS
-- que referenciam escola mas são gerenciadas centralmente. O trigger garante
-- que novos registros sempre tenham escola_id.
