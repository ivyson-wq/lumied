-- ═══════════════════════════════════════════════════════════════
--  Migration 105: Assinatura Eletrônica Robusta
--  Hash SHA-256, código de verificação, selo probatório
-- ═══════════════════════════════════════════════════════════════

-- Hash do documento para garantir integridade
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS documento_hash TEXT;
-- Código de verificação único (para consulta pública)
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS codigo_verificacao TEXT UNIQUE;
-- Assinado em (timestamp preciso)
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS assinado_em TIMESTAMPTZ;

-- Dados probatórios na assinatura
ALTER TABLE contrato_assinaturas ADD COLUMN IF NOT EXISTS documento_hash TEXT;
ALTER TABLE contrato_assinaturas ADD COLUMN IF NOT EXISTS aceite_termos BOOLEAN DEFAULT FALSE;
ALTER TABLE contrato_assinaturas ADD COLUMN IF NOT EXISTS geolocation TEXT;

-- Index para consulta por código
CREATE INDEX IF NOT EXISTS idx_contratos_codigo ON contratos(codigo_verificacao);
