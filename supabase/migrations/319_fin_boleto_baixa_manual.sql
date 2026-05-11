-- ══════════════════════════════════════════════════════════════
--  319 — Campos para baixa manual de boletos
--  Rastreia quem marcou como pago manualmente (vs webhook Inter)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE fin_boletos_emitidos ADD COLUMN IF NOT EXISTS baixa_manual boolean DEFAULT false;
ALTER TABLE fin_boletos_emitidos ADD COLUMN IF NOT EXISTS baixa_manual_por text;
ALTER TABLE fin_boletos_emitidos ADD COLUMN IF NOT EXISTS baixa_manual_em timestamptz;
ALTER TABLE fin_boletos_emitidos ADD COLUMN IF NOT EXISTS baixa_manual_obs text;
COMMENT ON COLUMN fin_boletos_emitidos.baixa_manual IS 'Se true, pagamento registrado manualmente (não via webhook Inter)';
