-- ═══════════════════════════════════════════════════════════════
--  Migration 278 — atestados: bucket privado + signed URL
--
--  Atestados médicos são PII (compliance LGPD). Hoje o bucket é
--  público e arquivo_url é uma URL pública direta. Mudamos pra bucket
--  privado + signed URL gerada fresh em cada read.
--  Migração:
--    1. Adicionar coluna arquivo_path em atestados_professoras
--    2. Backfill arquivo_path extraindo path da arquivo_url existente
--    3. Tornar bucket privado (URLs públicas antigas vão parar de
--       funcionar — handlers vão regenerar via getSignedFileUrl)
-- ═══════════════════════════════════════════════════════════════

-- Parte 1: schema
ALTER TABLE atestados_professoras
  ADD COLUMN IF NOT EXISTS arquivo_path text;

CREATE INDEX IF NOT EXISTS idx_atest_prof_path
  ON atestados_professoras(arquivo_path) WHERE arquivo_path IS NOT NULL;

-- Parte 2: backfill — pega substring depois de "/atestados/"
UPDATE atestados_professoras
   SET arquivo_path = SUBSTRING(arquivo_url FROM '/atestados/(.+)$')
 WHERE arquivo_path IS NULL
   AND arquivo_url IS NOT NULL
   AND arquivo_url LIKE '%/atestados/%';

-- Parte 3: bucket privado
UPDATE storage.buckets SET public = false WHERE name = 'atestados';
