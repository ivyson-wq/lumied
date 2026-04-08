-- Migration 210: Add turno and dias_semana columns to alunos table
-- Turnos dashboard now reads from alunos instead of solicitacoes

ALTER TABLE alunos ADD COLUMN IF NOT EXISTS turno text;
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS dias_semana text[];

-- Sync trigger: if familias has turno, copy to alunos
CREATE OR REPLACE FUNCTION sync_familia_turno_to_aluno()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.turno IS NOT NULL THEN
    UPDATE alunos SET turno = NEW.turno WHERE email = NEW.email OR familia_email = NEW.email;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_familia_turno ON familias;
CREATE TRIGGER trg_sync_familia_turno
  AFTER INSERT OR UPDATE OF turno ON familias
  FOR EACH ROW
  EXECUTE FUNCTION sync_familia_turno_to_aluno();
