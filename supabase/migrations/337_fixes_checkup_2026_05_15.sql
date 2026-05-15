-- ═══════════════════════════════════════════════════════════════
--  Migration 337 — Fixes do checkup geral de 2026-05-15
--
--  Cobre 2 bloqueantes encontrados no checkup:
--
--  • familia_sessoes (mig 311) criada sem escola_id NOT NULL —
--    lookup por token retornava sessão de qualquer tenant. Regressão
--    direta do incidente de tenant isolation 16/04/2026.
--  • impressoes_retencao_cleanup duplicado em pg_proc (uma versão sem
--    args, outra com retention_days int) — o cron call era ambíguo
--    e falhava com "function ... is not unique" há ~9h.
-- ═══════════════════════════════════════════════════════════════

-- 1. familia_sessoes: garantir tenant isolation
ALTER TABLE familia_sessoes
  ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE;

-- Backfill via familia → familias.escola_id (FK transitiva)
UPDATE familia_sessoes fs
   SET escola_id = f.escola_id
  FROM familias f
 WHERE fs.familia_id = f.id
   AND fs.escola_id IS NULL;

-- Limpa sessões órfãs (família deletada) — não devem existir, mas safe
DELETE FROM familia_sessoes WHERE escola_id IS NULL;

ALTER TABLE familia_sessoes ALTER COLUMN escola_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_familia_sessoes_escola
  ON familia_sessoes(escola_id);

-- Trigger enforce_tenant_escola_id em INSERT (instala via helper)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_tenant_isolation') THEN
    PERFORM add_tenant_isolation('familia_sessoes');
  END IF;
END $$;

-- 2. impressoes_retencao_cleanup: drop a versão sem args (mais antiga)
-- A versão com `retention_days integer DEFAULT 7 RETURNS jsonb` é a
-- chamada pelo cron — pg_cron usa SQL `SELECT impressoes_retencao_cleanup()`
-- que casa com a versão sem args quando ela existe, gerando ambiguidade.
DROP FUNCTION IF EXISTS public.impressoes_retencao_cleanup() CASCADE;

-- 3. Idempotência: dedup é feito no backend (janela 60s antes do INSERT
-- em manutencao_solicitar_material). Índice partial pra acelerar a query
-- de dedup (sem expressões não-IMMUTABLE).
CREATE INDEX IF NOT EXISTS idx_alm_compras_manut_dedup
  ON alm_compras(origem_id, encaminhado_em DESC)
  WHERE origem = 'manutencao';

COMMENT ON COLUMN familia_sessoes.escola_id IS
  'Tenant isolation — adicionado em 337 (regressão da mig 311).';
