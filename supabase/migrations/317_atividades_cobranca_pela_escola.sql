-- ══════════════════════════════════════════════════════════════
--  317 — Flag cobranca_pela_escola em atividades
--  Permite configurar se a cobrança é feita pela escola (inclui no boleto)
--  ou pela empresa fornecedora (cobra direto da família).
-- ══════════════════════════════════════════════════════════════

ALTER TABLE atividades ADD COLUMN IF NOT EXISTS cobranca_pela_escola boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN atividades.cobranca_pela_escola IS 'Se true, valor incluído no boleto da escola. Se false, empresa fornecedora cobra direto.';

-- Maple Bear CXS: todas as atividades extras são cobradas pela empresa fornecedora
UPDATE atividades SET cobranca_pela_escola = false
WHERE escola_id = (SELECT id FROM escolas WHERE nome ILIKE '%maple%' LIMIT 1);
