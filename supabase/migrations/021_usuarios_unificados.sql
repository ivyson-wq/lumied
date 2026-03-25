-- ══════════════════════════════════════════════════════════
--  021 — Sistema unificado de usuários
--  Papéis: gerente, professora, professora_assistente, secretaria, manutencao
-- ══════════════════════════════════════════════════════════

-- 1. Tabela unificada de usuários
CREATE TABLE IF NOT EXISTS usuarios (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome         text NOT NULL,
  email        text UNIQUE NOT NULL,
  senha_hash   text NOT NULL,
  papel        text NOT NULL CHECK (papel IN ('gerente','professora','professora_assistente','secretaria','manutencao')),
  ativo        boolean DEFAULT true,
  criado_em    timestamptz DEFAULT now()
);

ALTER TABLE usuarios DISABLE ROW LEVEL SECURITY;

-- 2. Tabela unificada de sessões
CREATE TABLE IF NOT EXISTS sessoes (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id   uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token        text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expira_em    timestamptz NOT NULL DEFAULT now() + interval '7 days',
  criado_em    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessoes_token ON sessoes(token);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id);
ALTER TABLE sessoes DISABLE ROW LEVEL SECURITY;

-- 3. Migrar dados existentes (ignora duplicatas por email)
INSERT INTO usuarios (id, nome, email, senha_hash, papel, criado_em)
SELECT id, nome, email, senha_hash, 'gerente', criado_em FROM gerentes
ON CONFLICT (email) DO NOTHING;

INSERT INTO usuarios (id, nome, email, senha_hash, papel, criado_em)
SELECT id, nome, email, COALESCE(senha_hash, ''),
  CASE WHEN tipo = 'professora_assistente' THEN 'professora_assistente'
       WHEN tipo = 'manutencao' THEN 'manutencao'
       ELSE 'professora' END,
  criado_em
FROM professoras
WHERE senha_hash IS NOT NULL AND senha_hash != ''
ON CONFLICT (email) DO NOTHING;

INSERT INTO usuarios (id, nome, email, senha_hash, papel, criado_em)
SELECT id, nome, email, senha_hash, 'secretaria', criado_em FROM secretarias
ON CONFLICT (email) DO NOTHING;

-- 4. Atualizar manutencoes para usar usuario_id genérico
ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id);
-- Copiar de professora_id para usuario_id onde possível
UPDATE manutencoes SET usuario_id = professora_id WHERE professora_id IS NOT NULL;

-- 5. Índices para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_usuarios_papel ON usuarios(papel);
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
