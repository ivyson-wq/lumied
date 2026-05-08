-- ═══════════════════════════════════════════════════════════════
--  Migration 303 — fix issue #15
--
--  trg_sync_familia_aluno (mig 109) está quebrada desde mig 243 porque
--  insere em alunos sem escola_id, sendo bloqueada pelo trigger
--  enforce_tenant_escola_id. Resultado: qualquer INSERT/UPDATE em
--  familias falha em prod desde abril/2026.
--
--  Fix:
--   1. Skip sync se NEW.escola_id IS NULL (caso transitório)
--   2. INSERT em alunos passa NEW.escola_id
--   3. Lookup em series filtra por escola_id (evita match cross-tenant)
--   4. ON CONFLICT também sincroniza escola_id (família muda de escola)
--
--  Issue: https://github.com/ivyson-wq/lumied/issues/15
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_familia_to_aluno()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Skip se família ainda não tem escola atribuída
  IF NEW.escola_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.nome_aluno IS NOT NULL AND NEW.nome_aluno != ''
     AND NEW.email IS NOT NULL AND NEW.email != '' THEN
    INSERT INTO alunos (
      nome, email, familia_email, serie_id, responsavel_nome, resp_nome,
      cpf, serie, escola_id
    )
    SELECT
      NEW.nome_aluno, NEW.email, NEW.email, s.id,
      NEW.nome_responsavel, NEW.nome_responsavel,
      NEW.cpf, NEW.serie, NEW.escola_id
    FROM (
      SELECT id FROM series
      WHERE nome = NEW.serie AND escola_id = NEW.escola_id
      LIMIT 1
    ) s
    RIGHT JOIN (SELECT 1) dummy ON true
    ON CONFLICT (email) DO UPDATE SET
      nome = EXCLUDED.nome,
      familia_email = EXCLUDED.familia_email,
      serie_id = COALESCE(EXCLUDED.serie_id, alunos.serie_id),
      responsavel_nome = EXCLUDED.responsavel_nome,
      resp_nome = EXCLUDED.resp_nome,
      cpf = EXCLUDED.cpf,
      serie = EXCLUDED.serie,
      escola_id = EXCLUDED.escola_id,
      atualizado_em = now();
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.sync_familia_to_aluno() IS
  'Sincroniza familias → alunos. Mig 303 fixou: passa escola_id no INSERT/UPDATE (estava quebrado desde mig 243). Issue #15.';
