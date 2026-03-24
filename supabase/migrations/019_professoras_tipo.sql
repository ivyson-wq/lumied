-- ══════════════════════════════════════════════════════════
--  019 — Adicionar coluna 'tipo' na tabela professoras
--  Níveis: professora, professora_assistente, manutencao
-- ══════════════════════════════════════════════════════════

ALTER TABLE professoras
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'professora'
  CHECK (tipo IN ('professora', 'professora_assistente', 'manutencao'));
