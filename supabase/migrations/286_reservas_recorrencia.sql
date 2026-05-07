-- ═══════════════════════════════════════════════════════════════
--  Migration 286 — Reservas recorrentes
--
--  Recursos compartilhados (tablets, projetores) costumam ter horário
--  fixo semanal por turma. Implementação prática: 1 reserva-pai gera
--  N reservas-filhas (uma por ocorrência). Cada filha respeita o
--  trigger anti-conflito existente. Cancelar a série = cancelar todas.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE reservas_recursos
  ADD COLUMN IF NOT EXISTS recorrencia text
    CHECK (recorrencia IN ('unica', 'semanal', 'diaria') OR recorrencia IS NULL),
  ADD COLUMN IF NOT EXISTS recorrencia_ate date,
  ADD COLUMN IF NOT EXISTS serie_id uuid REFERENCES reservas_recursos(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_reservas_serie ON reservas_recursos(serie_id) WHERE serie_id IS NOT NULL;

COMMENT ON COLUMN reservas_recursos.recorrencia IS
  'NULL/unica = pontual; semanal/diaria = parent de uma série; filhas têm serie_id apontando pro parent.';
