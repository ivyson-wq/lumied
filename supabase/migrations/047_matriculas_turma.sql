-- Adicionar turma (A, B, C...) nas matriculas
ALTER TABLE crm_matriculas ADD COLUMN IF NOT EXISTS turma text DEFAULT 'A';
