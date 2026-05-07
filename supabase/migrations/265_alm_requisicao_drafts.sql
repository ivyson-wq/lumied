-- ═══════════════════════════════════════════════════════════════
--  Migration 265 — Rascunhos de requisição + edição
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE alm_requisicoes
  ADD COLUMN IF NOT EXISTS is_draft boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS atualizado_em timestamptz;

-- Index parcial: rascunhos da professora (usado no auto-save)
CREATE INDEX IF NOT EXISTS idx_alm_req_draft
  ON alm_requisicoes(escola_id, professora_id, is_draft)
  WHERE is_draft = true;

-- Trigger atualiza atualizado_em em UPDATE
CREATE OR REPLACE FUNCTION alm_req_set_atualizado() RETURNS trigger AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alm_req_atualizado ON alm_requisicoes;
CREATE TRIGGER trg_alm_req_atualizado
  BEFORE UPDATE ON alm_requisicoes
  FOR EACH ROW EXECUTE FUNCTION alm_req_set_atualizado();
