-- Migration 295: Auto-cadastro de aluno com validação interna
-- Aluno preenche formulário público em familia.html → registro vai pra fila do
-- gerente em gerente.html → aprovação cria alunos_login (trigger Mig 294 sincroniza
-- pra usuarios.papeis += 'aluno') + dispara magic link via Resend.

CREATE TABLE IF NOT EXISTS aluno_solicitacoes_acesso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  aluno_nome text NOT NULL,
  aluno_email text NOT NULL,
  serie text,
  responsavel_nome text,
  responsavel_email text,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'aprovado', 'rejeitado')),
  motivo_rejeicao text,
  observacoes_admin text,
  ip_origem text,
  criado_em timestamptz DEFAULT now(),
  decidido_por uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  decidido_em timestamptz
);

ALTER TABLE aluno_solicitacoes_acesso DISABLE ROW LEVEL SECURITY;

-- Anti-duplicata: bloqueia novo pedido com mesmo email enquanto há um pendente/aprovado na escola.
CREATE UNIQUE INDEX IF NOT EXISTS idx_aluno_sol_email_escola_aberta
  ON aluno_solicitacoes_acesso (aluno_email, escola_id)
  WHERE status IN ('pendente', 'aprovado');

CREATE INDEX IF NOT EXISTS idx_aluno_sol_escola_status
  ON aluno_solicitacoes_acesso (escola_id, status, criado_em DESC);

-- Tenant isolation (Mig 245): trigger BEFORE INSERT rejeita escola_id ausente/inválido.
SELECT add_tenant_isolation('aluno_solicitacoes_acesso');

COMMENT ON TABLE aluno_solicitacoes_acesso IS
  'Fila de auto-cadastro de aluno. Aprovação cria alunos_login → trigger Mig 294 sincroniza usuarios.papeis.';
