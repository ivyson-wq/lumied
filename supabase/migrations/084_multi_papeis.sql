-- ══════════════════════════════════════════════════════════
--  084 — Multi-papéis por usuário + papel Comercial
--  Permite que um usuário tenha mais de um papel (ex: gerente + professora)
-- ══════════════════════════════════════════════════════════

-- 1. Adicionar coluna papeis (array) e migrar dados do campo papel
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS papeis text[] DEFAULT '{}';

-- 2. Migrar dados existentes: papel → papeis
UPDATE usuarios SET papeis = ARRAY[papel] WHERE papeis = '{}' OR papeis IS NULL;

-- 3. Remover constraint antiga do campo papel (mantém coluna para compatibilidade)
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_papel_check;

-- 4. Índice GIN para busca eficiente em arrays
CREATE INDEX IF NOT EXISTS idx_usuarios_papeis ON usuarios USING gin(papeis);

-- 5. Comentário documentando papéis válidos
COMMENT ON COLUMN usuarios.papeis IS 'Papéis válidos: gerente, professora, professora_assistente, secretaria, comercial, manutencao, diretor, financeiro';
