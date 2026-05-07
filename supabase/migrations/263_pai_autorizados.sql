-- ═══════════════════════════════════════════════════════════════
--  Migration 263 — Autorização de retirada pelos pais
--
--  Permite que famílias cadastrem provisoriamente pessoas autorizadas
--  para retirar a criança (avó visitante, motorista de Uber, etc.),
--  com CPF, email, prazo de validade e gatilho automático de
--  cadastro facial via link enviado por email.
-- ═══════════════════════════════════════════════════════════════

-- 1. CPF do autorizado
ALTER TABLE acesso_permissoes_retirada
  ADD COLUMN IF NOT EXISTS responsavel_cpf text;

CREATE INDEX IF NOT EXISTS idx_perm_ret_cpf
  ON acesso_permissoes_retirada(escola_id, responsavel_cpf)
  WHERE responsavel_cpf IS NOT NULL;

COMMENT ON COLUMN acesso_permissoes_retirada.responsavel_cpf IS
  'CPF do autorizado (apenas dígitos). Obrigatório quando criado_por_familia=true.';

-- 2. Origem da autorização (gerente OR família)
ALTER TABLE acesso_permissoes_retirada
  ADD COLUMN IF NOT EXISTS criado_por_familia boolean NOT NULL DEFAULT false;

ALTER TABLE acesso_permissoes_retirada
  ADD COLUMN IF NOT EXISTS criado_por_pai_email text;

COMMENT ON COLUMN acesso_permissoes_retirada.criado_por_familia IS
  'true = autorização criada pelo responsável legal no portal dos pais. false = criada pelo gerente.';
COMMENT ON COLUMN acesso_permissoes_retirada.criado_por_pai_email IS
  'Email do pai/mãe que criou a autorização (auditoria). NULL quando criado pelo gerente.';

-- 3. Trigger para expirar autorizações vencidas (limpeza diária)
CREATE OR REPLACE FUNCTION cleanup_autorizacoes_vencidas() RETURNS void AS $$
BEGIN
  UPDATE acesso_permissoes_retirada
  SET autorizado = false
  WHERE autorizado = true
    AND validade IS NOT NULL
    AND validade < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_autorizacoes_vencidas IS
  'Desativa autorizações cuja validade já passou. Rodar via pg_cron diário.';
