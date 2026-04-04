-- Migration 105: Seed Maple Bear Caxias do Sul
-- Garante que a escola existe com subdominio preenchido

UPDATE escolas
SET subdominio = 'maplebearcaxias',
    ativo = true
WHERE slug = 'maple-bear-caxias' AND (subdominio IS NULL OR subdominio = '');

-- Se não existir por slug, tenta inserir
INSERT INTO escolas (nome, subdominio, slug, ativo)
SELECT 'Maple Bear Caxias do Sul', 'maplebearcaxias', 'maple-bear-caxias', true
WHERE NOT EXISTS (SELECT 1 FROM escolas WHERE slug = 'maple-bear-caxias');
