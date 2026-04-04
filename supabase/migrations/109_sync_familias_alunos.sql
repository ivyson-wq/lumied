-- Migration 109: Sincronizar familias → alunos automaticamente
-- Problema: alunos só foi populada uma vez (072), novas familias não sincronizam

-- 1. Resync: popular alunos com todas as familias que faltam (DISTINCT ON email)
INSERT INTO alunos (nome, email, familia_email, serie_id)
SELECT DISTINCT ON (f.email) f.nome_aluno, f.email, f.email, s.id
FROM familias f
LEFT JOIN series s ON s.nome = f.serie
WHERE f.nome_aluno IS NOT NULL AND f.nome_aluno != ''
  AND f.email IS NOT NULL AND f.email != ''
ORDER BY f.email, f.atualizado_em DESC NULLS LAST
ON CONFLICT (email) DO UPDATE SET
  nome = EXCLUDED.nome,
  familia_email = EXCLUDED.familia_email,
  serie_id = COALESCE(EXCLUDED.serie_id, alunos.serie_id),
  atualizado_em = now();

-- 2. Adicionar colunas úteis em alunos (denormalizadas de familias)
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS responsavel_nome text;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS resp_nome text;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS cpf text;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS turma text;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS serie text;

-- 3. Preencher colunas denormalizadas
UPDATE alunos a
SET
  responsavel_nome = f.nome_responsavel,
  resp_nome = f.nome_responsavel,
  cpf = f.cpf,
  serie = f.serie
FROM familias f
WHERE a.email = f.email;

-- 4. Trigger: sincronizar familias → alunos em INSERT/UPDATE
CREATE OR REPLACE FUNCTION sync_familia_to_aluno()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.nome_aluno IS NOT NULL AND NEW.nome_aluno != ''
     AND NEW.email IS NOT NULL AND NEW.email != '' THEN
    INSERT INTO alunos (nome, email, familia_email, serie_id, responsavel_nome, resp_nome, cpf, serie)
    SELECT
      NEW.nome_aluno,
      NEW.email,
      NEW.email,
      s.id,
      NEW.nome_responsavel,
      NEW.nome_responsavel,
      NEW.cpf,
      NEW.serie
    FROM (SELECT id FROM series WHERE nome = NEW.serie LIMIT 1) s
    RIGHT JOIN (SELECT 1) dummy ON true
    ON CONFLICT (email) DO UPDATE SET
      nome = EXCLUDED.nome,
      familia_email = EXCLUDED.familia_email,
      serie_id = COALESCE(EXCLUDED.serie_id, alunos.serie_id),
      responsavel_nome = EXCLUDED.responsavel_nome,
      resp_nome = EXCLUDED.resp_nome,
      cpf = EXCLUDED.cpf,
      serie = EXCLUDED.serie,
      atualizado_em = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_familia_aluno ON familias;
CREATE TRIGGER trg_sync_familia_aluno
  AFTER INSERT OR UPDATE ON familias
  FOR EACH ROW
  EXECUTE FUNCTION sync_familia_to_aluno();

-- 5. Trigger: desativar aluno quando familia é deletada
CREATE OR REPLACE FUNCTION deactivate_aluno_on_familia_delete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE alunos SET ativo = false, atualizado_em = now()
  WHERE email = OLD.email;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deactivate_aluno ON familias;
CREATE TRIGGER trg_deactivate_aluno
  AFTER DELETE ON familias
  FOR EACH ROW
  EXECUTE FUNCTION deactivate_aluno_on_familia_delete();
