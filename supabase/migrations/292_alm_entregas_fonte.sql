-- ═══════════════════════════════════════════════════════════════
--  Migration 292 — Fonte da entrega (estoque vs compra)
--
--  alm_entregas representa qty alocada/entregue à turma. Quando o
--  gerente aprova uma requisição, o sistema pode atender parte com
--  estoque (auto-entrega imediata) e parte via compra (entrega após
--  recebimento). Coluna `fonte` identifica a origem pra romaneio,
--  relatório e auditoria.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE alm_entregas
  ADD COLUMN IF NOT EXISTS fonte text NOT NULL DEFAULT 'compra'
    CHECK (fonte IN ('estoque', 'compra'));

CREATE INDEX IF NOT EXISTS idx_alm_entregas_fonte
  ON alm_entregas(escola_id, fonte);

COMMENT ON COLUMN alm_entregas.fonte IS
  'Origem da entrega: estoque (auto na aprovação, vinda do almox) ou compra (após recebimento do fornecedor via alm_distribuir_grupo).';
