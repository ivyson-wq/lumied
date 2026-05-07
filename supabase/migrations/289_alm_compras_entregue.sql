-- ═══════════════════════════════════════════════════════════════
--  Migration 289 — Status 'entregue' em alm_compras + colunas
--
--  Suporta o fluxo de distribuição ao receber: status 'comprado' vai
--  pra 'entregue' quando o gerente registra a entrega pelas turmas.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE alm_compras
  ADD COLUMN IF NOT EXISTS entregue_em timestamptz,
  ADD COLUMN IF NOT EXISTS entregue_por text;

-- Atualiza CHECK pra incluir 'entregue'
ALTER TABLE alm_compras DROP CONSTRAINT IF EXISTS alm_compras_status_check;
ALTER TABLE alm_compras
  ADD CONSTRAINT alm_compras_status_check
  CHECK (status IN ('pendente', 'comprado', 'entregue', 'cancelado'));

CREATE INDEX IF NOT EXISTS idx_alm_compras_entregue ON alm_compras(escola_id, entregue_em DESC) WHERE status = 'entregue';
