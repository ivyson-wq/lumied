-- ═══════════════════════════════════════════════════════════════
--  Migration 270 — Impressões: hash, retenção 7d, modo lançamento
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE impressoes
  ADD COLUMN IF NOT EXISTS arquivo_hash text,
  ADD COLUMN IF NOT EXISTS arquivo_tamanho bigint,
  ADD COLUMN IF NOT EXISTS expira_em timestamptz;

-- Index para detectar duplicidade rápida (escola + hash recente)
CREATE INDEX IF NOT EXISTS idx_impressoes_hash
  ON impressoes(escola_id, arquivo_hash, criado_em DESC)
  WHERE arquivo_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_impressoes_expira
  ON impressoes(expira_em) WHERE expira_em IS NOT NULL;

-- Cron diário 04:00 BRT (07:00 UTC): apaga arquivos com expira_em vencido E status final.
CREATE OR REPLACE FUNCTION impressoes_retencao_cleanup() RETURNS int AS $$
DECLARE
  removidos int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT id, arquivo_url FROM impressoes
    WHERE expira_em < now()
      AND status IN ('rejeitado','impresso','entregue')
  LOOP
    -- Apenas marca url como vazia (storage cleanup pode ser feito em job separado)
    UPDATE impressoes SET arquivo_url = '' WHERE id = r.id;
    removidos := removidos + 1;
  END LOOP;
  RAISE NOTICE 'impressoes_retencao_cleanup: % registros expurgados', removidos;
  RETURN removidos;
END $$ LANGUAGE plpgsql;

DO $$ BEGIN
  PERFORM cron.unschedule('impressoes-retencao-cleanup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
  PERFORM cron.schedule('impressoes-retencao-cleanup', '0 7 * * *', 'SELECT impressoes_retencao_cleanup();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron impressoes_retencao: %', SQLERRM;
END $$;

-- Backfill: define expira_em para registros existentes (criado_em + 7d)
UPDATE impressoes SET expira_em = criado_em + interval '7 days' WHERE expira_em IS NULL;
