-- ═══════════════════════════════════════════════════════════════
--  Migration 244 — [P0] Tenant isolation: guards + fix demo_reset
-- ═══════════════════════════════════════════════════════════════
-- Complementa 243. Corrige o bug que originou o vazamento (demo_reset
-- sem filtro por escola_id) e adiciona trigger defensivo que bloqueia
-- INSERT em tabelas tenant sem escola_id.
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- PARTE A — Fix demo_reset (CAUSA RAIZ)
-- Antes: DELETE/INSERT sem filtro por escola_id → apagava dados de
-- qualquer tenant com padrão '.demo@example.com' e inseria mensalidades
-- sem escola_id (lendo de TODAS as escolas com .aluno@example.com).
-- ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  PERFORM cron.unschedule('demo-reset-weekly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION demo_reset() RETURNS int AS $$
DECLARE
  demo_escola_id uuid;
  deletados int := 0;
BEGIN
  SELECT id INTO demo_escola_id FROM escolas WHERE nome ILIKE 'Demo Lumied%' LIMIT 1;
  IF demo_escola_id IS NULL THEN
    RAISE NOTICE 'demo_reset: escola Demo não encontrada, abortando';
    RETURN 0;
  END IF;

  -- DELETES — todos agora obrigatoriamente filtrados por escola_id
  DELETE FROM cobranca_tratativas WHERE escola_id = demo_escola_id;
  GET DIAGNOSTICS deletados = ROW_COUNT;
  DELETE FROM regua_execucoes    WHERE escola_id = demo_escola_id;
  DELETE FROM fin_inadimplencia  WHERE escola_id = demo_escola_id;
  DELETE FROM fin_mensalidades   WHERE escola_id = demo_escola_id;
  DELETE FROM alm_requisicoes    WHERE escola_id = demo_escola_id;
  DELETE FROM alm_entregas
    WHERE requisicao_id IN (SELECT id FROM alm_requisicoes WHERE escola_id = demo_escola_id)
       OR requisicao_id NOT IN (SELECT id FROM alm_requisicoes);
  DELETE FROM backups_log        WHERE escola_id = demo_escola_id AND status = 'em_andamento';

  -- Marca timestamp de último reset
  INSERT INTO escola_config (chave, valor, escola_id, categoria)
  VALUES ('demo_last_reset', to_jsonb(now()::text), demo_escola_id, 'geral')
  ON CONFLICT (chave, escola_id) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();

  RAISE NOTICE 'demo_reset concluído (escola %): % registros apagados', demo_escola_id, deletados;
  RETURN deletados;
END $$ LANGUAGE plpgsql;

-- Re-agenda cron com INSERT de mensalidades TAMBÉM filtrado por escola_id
DO $$ BEGIN
  PERFORM cron.schedule(
    'demo-reset-weekly',
    '0 7 * * 1',
    $cron$
      SELECT demo_reset();
      -- Re-seed mensalidades APENAS dos alunos da escola demo
      INSERT INTO fin_mensalidades (familia_email, familia_nome, crianca_nome, serie, valor_total, valor_turno, mes, status, data_vencimento, data_pagamento, escola_id)
      SELECT a.familia_email, f.nome_responsavel, a.nome, s.nome, 2850.00, 2850.00,
             to_char(CURRENT_DATE - (m || ' months')::interval, 'YYYY-MM'),
             CASE
               WHEN m = 0 THEN CASE WHEN (row_number() OVER (PARTITION BY a.escola_id ORDER BY a.nome)) % 7 = 0 THEN 'pendente' ELSE 'pago' END
               WHEN m = 1 THEN CASE WHEN (row_number() OVER (PARTITION BY a.escola_id ORDER BY a.nome)) % 12 = 0 THEN 'atrasado' ELSE 'pago' END
               ELSE 'pago'
             END,
             (date_trunc('month', CURRENT_DATE - (m || ' months')::interval) + INTERVAL '9 days')::date,
             CASE WHEN m > 0 THEN (CURRENT_DATE - ((m-1) || ' months')::interval - INTERVAL '20 days')::date ELSE NULL END,
             a.escola_id
      FROM alunos a
      JOIN familias f ON f.email = a.familia_email AND f.escola_id = a.escola_id
      LEFT JOIN series s ON s.id = a.serie_id AND s.escola_id = a.escola_id
      CROSS JOIN generate_series(0, 2) AS m
      WHERE a.email LIKE '%.aluno@example.com'
        AND a.escola_id = (SELECT id FROM escolas WHERE nome ILIKE 'Demo Lumied%' LIMIT 1)
      ON CONFLICT (familia_email, crianca_nome, mes) DO NOTHING;
    $cron$
  );
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'demo-reset cron schedule: %', SQLERRM;
END $$;

-- ────────────────────────────────────────────────────────────────
-- PARTE B — Trigger defensivo: rejeita INSERT sem escola_id válido
--
-- Aplicado em tabelas tenant-scoped. Força que toda linha tenha
-- escola_id apontando para uma escola existente. Evita regressão
-- se alguma edge function ou seed esquecer o escola_id no futuro.
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION enforce_tenant_escola_id() RETURNS trigger AS $$
BEGIN
  IF NEW.escola_id IS NULL THEN
    RAISE EXCEPTION 'Tenant isolation: INSERT/UPDATE em % sem escola_id. Todas as tabelas tenant-scoped exigem escola_id.', TG_TABLE_NAME
      USING ERRCODE = 'check_violation', HINT = 'Garanta que o código define escola_id antes do insert';
  END IF;
  -- Valida existência apenas em INSERT (UPDATE com FK CASCADE já garante)
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM escolas WHERE id = NEW.escola_id) THEN
    RAISE EXCEPTION 'Tenant isolation: escola_id % não existe em escolas', NEW.escola_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Aplica em tabelas tenant-scoped que acabaram de receber escola_id
-- (pula aquelas com ambíguos remanescentes — elas serão incluídas após
-- revisão humana dos 7 casos restantes)
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'series','professoras','alunos','usuarios','gerentes','secretarias',
    'calendario_eventos','atividades','crm_matriculas','ausencias','boletos',
    'alm_insumos','alm_requisicoes','alm_orcamentos',
    'fin_mensalidades','fin_boletos_emitidos','diario_registros',
    'frequencia_chamadas','frequencia_registros','chat_mensagens',
    'contratos','boletins','autorizacoes','agenda_itens',
    'familias','crm_leads','escola_modulos','escola_config','escola_uso',
    'compliance_ponto_registros','compliance_ocorrencias','compliance_alertas',
    'regua_config','pix_config','ia_config'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    BEGIN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_tenant_check ON %I', tbl);
      EXECUTE format('CREATE TRIGGER trg_tenant_check BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()', tbl);
      RAISE NOTICE '✓ Trigger de tenant isolation aplicado em %', tbl;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      RAISE NOTICE '⚠ Tabela % não existe ou sem escola_id, skip', tbl;
    END;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────
-- PARTE C — View de auditoria contínua: órfãos por tabela
-- Staff consulta para monitorar qualquer regressão futura.
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW tenant_isolation_audit AS
SELECT 'series' tabela, COUNT(*) FILTER (WHERE escola_id IS NULL) orfaos, COUNT(*) total FROM series
UNION ALL SELECT 'professoras', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM professoras
UNION ALL SELECT 'alunos', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM alunos
UNION ALL SELECT 'usuarios', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM usuarios
UNION ALL SELECT 'gerentes', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM gerentes
UNION ALL SELECT 'secretarias', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM secretarias
UNION ALL SELECT 'familias', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM familias
UNION ALL SELECT 'calendario_eventos', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM calendario_eventos
UNION ALL SELECT 'atividades', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM atividades
UNION ALL SELECT 'crm_matriculas', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM crm_matriculas
UNION ALL SELECT 'ausencias', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM ausencias
UNION ALL SELECT 'boletos', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM boletos
UNION ALL SELECT 'alm_insumos', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM alm_insumos
UNION ALL SELECT 'alm_requisicoes', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM alm_requisicoes
UNION ALL SELECT 'alm_orcamentos', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM alm_orcamentos
UNION ALL SELECT 'manutencoes', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM manutencoes
UNION ALL SELECT 'notas_config', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM notas_config
UNION ALL SELECT 'notas_periodos', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM notas_periodos
UNION ALL SELECT 'frequencia_config', COUNT(*) FILTER (WHERE escola_id IS NULL), COUNT(*) FROM frequencia_config
ORDER BY 2 DESC;

COMMENT ON VIEW tenant_isolation_audit IS 'Monitoramento contínuo de órfãos (escola_id NULL). 0 em todas = isolamento completo.';
COMMENT ON FUNCTION enforce_tenant_escola_id IS 'Trigger defensivo contra inserts tenant-less. Criado em resposta ao incidente 16/04/2026 (demo_reset bug).';
