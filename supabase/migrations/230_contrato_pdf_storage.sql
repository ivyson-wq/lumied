-- =====================================================
-- 230: Contrato PDF em Storage
-- =====================================================
-- Após a assinatura completa, o browser gera um PDF do contrato
-- (html2pdf) e faz upload para o bucket 'contratos-pdf'. O caminho é
-- guardado em contratos.pdf_path para uso posterior (email ao advogado).
-- =====================================================

ALTER TABLE contratos
  ADD COLUMN IF NOT EXISTS pdf_path text,
  ADD COLUMN IF NOT EXISTS pdf_gerado_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_contratos_pdf_path ON contratos(pdf_path) WHERE pdf_path IS NOT NULL;

-- Bucket privado para PDFs de contratos assinados
INSERT INTO storage.buckets (id, name, public)
VALUES ('contratos-pdf', 'contratos-pdf', false)
ON CONFLICT (id) DO NOTHING;
