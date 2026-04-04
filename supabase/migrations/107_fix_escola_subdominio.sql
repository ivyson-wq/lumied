-- Migration 107: Fix subdominio da Maple Bear Caxias
-- O subdominio deve ser 'maplebearcaxias' (sem hifens), não o slug

UPDATE escolas
SET subdominio = 'maplebearcaxias'
WHERE slug = 'maple-bear-caxias';

-- Adicionar coluna 'plano' (text) se não existir, pois staff_dashboard a usa
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS plano text;

-- Preencher plano baseado no plano_id
UPDATE escolas e
SET plano = p.slug
FROM planos p
WHERE e.plano_id = p.id AND e.plano IS NULL;
