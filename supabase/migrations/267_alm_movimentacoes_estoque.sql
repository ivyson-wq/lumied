-- ═══════════════════════════════════════════════════════════════
--  Migration 267 — Movimentações de estoque do almoxarifado
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS alm_movimentacoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id     uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  insumo_id     uuid NOT NULL REFERENCES alm_insumos(id) ON DELETE CASCADE,
  tipo          text NOT NULL CHECK (tipo IN ('entrada', 'saida', 'ajuste')),
  qty           numeric NOT NULL CHECK (qty >= 0),
  requisicao_id uuid REFERENCES alm_requisicoes(id) ON DELETE SET NULL,
  usuario_id    uuid,
  motivo        text,
  saldo_antes   numeric,
  saldo_depois  numeric,
  criado_em     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alm_mov_insumo ON alm_movimentacoes(insumo_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_alm_mov_escola ON alm_movimentacoes(escola_id, criado_em DESC);

DO $$ BEGIN
  PERFORM add_tenant_isolation('alm_movimentacoes');
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'CREATE TRIGGER trg_tenant_check BEFORE INSERT ON alm_movimentacoes FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()';
END $$;

COMMENT ON TABLE alm_movimentacoes IS
  'Auditoria de saídas/entradas/ajustes de estoque. Saída automática gerada pelo alm_aprovar quando estoque cobre parte ou todo do pedido.';
