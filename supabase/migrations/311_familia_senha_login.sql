-- =====================================================
-- 311: Login por senha no Portal Pais
-- =====================================================
-- Adiciona senha_hash em familias para login alternativo ao magic link.
-- Famílias podem acessar via:
--   1. Magic link (já existente) — email com link clicável
--   2. Email + senha (NOVO) — action "familia_login"
--
-- A senha é OPCIONAL — famílias sem senha continuam usando magic link.
-- =====================================================

-- 1. Adicionar coluna senha_hash
ALTER TABLE familias ADD COLUMN IF NOT EXISTS senha_hash text;

-- 2. Criar tabela de sessões para famílias (login por senha)
CREATE TABLE IF NOT EXISTS familia_sessoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  familia_id uuid NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expira_em timestamptz NOT NULL,
  criado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_familia_sessoes_token ON familia_sessoes(token);
CREATE INDEX IF NOT EXISTS idx_familia_sessoes_exp ON familia_sessoes(expira_em);

-- 3. Setar senha demo
DO $$
DECLARE
  pw_hash text := 'a1b2c3d4e5f607182930415263748596:d6e7fd9b50d06fea9ade077a5d5bdda3ab8e5a33a621eb7e8b776eadcc6b6250';
BEGIN
  UPDATE familias SET senha_hash = pw_hash WHERE email = 'demo@lumied.com.br';
END $$;
