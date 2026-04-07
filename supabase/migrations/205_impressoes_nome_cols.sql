-- 205: Adicionar colunas de nome desnormalizadas em impressoes
ALTER TABLE impressoes ADD COLUMN IF NOT EXISTS professora_nome text;
ALTER TABLE impressoes ADD COLUMN IF NOT EXISTS turma_nome text;
