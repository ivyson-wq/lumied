-- ═══════════════════════════════════════════════════════════════
--  Migration 263 — Tirar dúvida sobre o chamado de manutenção
--  Coordenação pode pedir esclarecimento antes de aprovar/rejeitar.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE manutencoes
  ADD COLUMN IF NOT EXISTS pergunta_coordenacao text,
  ADD COLUMN IF NOT EXISTS pergunta_em timestamptz,
  ADD COLUMN IF NOT EXISTS pergunta_por text,
  ADD COLUMN IF NOT EXISTS pergunta_resposta text,
  ADD COLUMN IF NOT EXISTS pergunta_respondida_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_manut_pergunta_pendente
  ON manutencoes(escola_id, pergunta_em)
  WHERE pergunta_em IS NOT NULL AND pergunta_resposta IS NULL;

COMMENT ON COLUMN manutencoes.pergunta_coordenacao IS
  'Pergunta da coordenação ao solicitante (quando precisa esclarecer antes de aprovar/rejeitar).';
