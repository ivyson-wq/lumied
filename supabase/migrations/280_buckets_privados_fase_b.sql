-- ═══════════════════════════════════════════════════════════════
--  Migration 280 — Fase B: manutencoes + boletos privados
-- ═══════════════════════════════════════════════════════════════

-- ── manutencoes (9 fotos com URL em produção) ──
ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS foto_path text;
CREATE INDEX IF NOT EXISTS idx_manut_foto_path ON manutencoes(foto_path) WHERE foto_path IS NOT NULL;
UPDATE manutencoes
   SET foto_path = SUBSTRING(foto_url FROM '/manutencoes/(.+)$')
 WHERE foto_path IS NULL
   AND foto_url IS NOT NULL
   AND foto_url LIKE '%/manutencoes/%';

-- ── boletos (1 registro real, 99 órfãos no storage) ──
ALTER TABLE boletos ADD COLUMN IF NOT EXISTS pdf_path text;
CREATE INDEX IF NOT EXISTS idx_boletos_pdf_path ON boletos(pdf_path) WHERE pdf_path IS NOT NULL;
UPDATE boletos
   SET pdf_path = SUBSTRING(pdf_url FROM '/boletos/(.+)$')
 WHERE pdf_path IS NULL
   AND pdf_url IS NOT NULL
   AND pdf_url LIKE '%/boletos/%';

-- Buckets privados
UPDATE storage.buckets SET public=false WHERE name IN ('manutencoes','boletos');
