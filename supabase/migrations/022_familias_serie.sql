-- Adiciona coluna serie na tabela familias
ALTER TABLE familias ADD COLUMN IF NOT EXISTS serie text;
