-- Adicionar dados do responsavel na matricula
ALTER TABLE crm_matriculas ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE crm_matriculas ADD COLUMN IF NOT EXISTS telefone text;
ALTER TABLE crm_matriculas ADD COLUMN IF NOT EXISTS data_nascimento date;
