-- ═══════════════════════════════════════════════════════════════
--  Migration 266 — Relatórios dinâmicos: visualizações salvas
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alm_relatorio_visualizacoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id   uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  criado_por  text,
  nome        text NOT NULL,
  config      jsonb NOT NULL DEFAULT '{}',
  -- config schema: { filtros: {status, turma_id, professora_id, data_de, data_ate, fornecedor},
  --                  agrupamento: 'turma'|'professora'|'categoria'|'mes'|'fornecedor',
  --                  colunas: [...] }
  criado_em   timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alm_relat_escola ON alm_relatorio_visualizacoes(escola_id);

-- Trigger tenant isolation
DO $$ BEGIN
  PERFORM add_tenant_isolation('alm_relatorio_visualizacoes');
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'CREATE TRIGGER trg_tenant_check BEFORE INSERT ON alm_relatorio_visualizacoes FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()';
END $$;
