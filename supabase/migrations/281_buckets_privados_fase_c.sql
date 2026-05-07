-- ═══════════════════════════════════════════════════════════════
--  Migration 281 — Fase C: impressoes privado
--
--  Maior volume (358 registros, 382 storage objects, 774MB). Usa
--  signed URL TTL = expira_em - now() pra bater com retenção de 7d
--  (mig 270). Caps em 1h floor pra arquivos prestes a expirar.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE impressoes ADD COLUMN IF NOT EXISTS arquivo_path text;
CREATE INDEX IF NOT EXISTS idx_impressoes_path ON impressoes(arquivo_path) WHERE arquivo_path IS NOT NULL;

-- Backfill: extrai path do segmento depois de '/impressoes/'
UPDATE impressoes
   SET arquivo_path = SUBSTRING(arquivo_url FROM '/impressoes/(.+)$')
 WHERE arquivo_path IS NULL
   AND arquivo_url IS NOT NULL
   AND arquivo_url LIKE '%/impressoes/%';

UPDATE storage.buckets SET public=false WHERE name='impressoes';
