-- =====================================================
-- 071: Sistema de Temas Visuais
-- =====================================================
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS tema text DEFAULT 'corporativo';
-- Valores: 'ludico', 'serio', 'interativo', 'corporativo'
