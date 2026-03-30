-- =====================================================
-- 058: Portal do Aluno
-- =====================================================

CREATE TABLE IF NOT EXISTS alunos_login (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aluno_nome text NOT NULL,
  email text UNIQUE NOT NULL,
  senha_hash text NOT NULL,
  familia_email text,                    -- referência ao email da família
  serie text,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE alunos_login DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS aluno_sessoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aluno_id uuid NOT NULL REFERENCES alunos_login(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL,
  expira_em timestamptz NOT NULL,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE aluno_sessoes DISABLE ROW LEVEL SECURITY;
