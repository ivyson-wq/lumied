-- ═══════════════════════════════════════════════════════════════
--  Migration 114: Cadastro de face público (link para famílias)
-- ═══════════════════════════════════════════════════════════════

-- Tokens de cadastro (links únicos para famílias)
CREATE TABLE IF NOT EXISTS acesso_cadastro_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token text UNIQUE NOT NULL,
  pessoa_tipo text NOT NULL CHECK (pessoa_tipo IN ('aluno','responsavel','funcionario')),
  pessoa_id uuid NOT NULL,
  pessoa_nome text NOT NULL,
  email text,
  gerado_por text NOT NULL,
  usado boolean DEFAULT false,
  usado_em timestamptz,
  expira_em timestamptz NOT NULL,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE acesso_cadastro_tokens DISABLE ROW LEVEL SECURITY;
CREATE INDEX idx_acesso_tokens_token ON acesso_cadastro_tokens(token);

-- Novo status para faces aguardando aprovação
ALTER TABLE acesso_faces DROP CONSTRAINT IF EXISTS acesso_faces_sync_status_check;
ALTER TABLE acesso_faces ADD CONSTRAINT acesso_faces_sync_status_check
  CHECK (sync_status IN ('pendente','sincronizado','erro','aguardando_aprovacao'));

-- Coluna de qualidade na tabela de faces
ALTER TABLE acesso_faces ADD COLUMN IF NOT EXISTS qualidade_scores jsonb;
ALTER TABLE acesso_faces ADD COLUMN IF NOT EXISTS qualidade_ok boolean DEFAULT true;
