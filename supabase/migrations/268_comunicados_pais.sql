-- ═══════════════════════════════════════════════════════════════
--  Migration 268 — Comunicados dos pais (saída antecipada / atraso)
-- ═══════════════════════════════════════════════════════════════

-- Justificativas pré-cadastradas pela escola
CREATE TABLE IF NOT EXISTS comunicados_justificativas (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  label     text NOT NULL,
  requer_aprovacao boolean DEFAULT false,
  ordem     int DEFAULT 99,
  ativa     boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_com_just_escola ON comunicados_justificativas(escola_id) WHERE ativa = true;

-- Comunicados enviados pelos pais
CREATE TABLE IF NOT EXISTS comunicados_pais (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id     uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  aluno_id      uuid REFERENCES alunos(id) ON DELETE SET NULL,
  aluno_nome    text NOT NULL,
  responsavel_email text NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('saida_antecipada', 'atraso')),
  horario       text NOT NULL,
  justificativa_id uuid REFERENCES comunicados_justificativas(id) ON DELETE SET NULL,
  justificativa_livre text,
  status        text NOT NULL DEFAULT 'aprovado'
                  CHECK (status IN ('pendente', 'aprovado', 'rejeitado')),
  aprovador_id  uuid,
  nota_aprovador text,
  criado_em     timestamptz DEFAULT now(),
  aprovado_em   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_com_pais_escola ON comunicados_pais(escola_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_com_pais_status ON comunicados_pais(escola_id, status) WHERE status = 'pendente';

-- Tenant isolation
DO $$ BEGIN
  PERFORM add_tenant_isolation('comunicados_justificativas');
  PERFORM add_tenant_isolation('comunicados_pais');
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'CREATE TRIGGER trg_tenant_check BEFORE INSERT ON comunicados_justificativas FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()';
  EXECUTE 'CREATE TRIGGER trg_tenant_check BEFORE INSERT ON comunicados_pais FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()';
END $$;

-- Sementes default por escola (idempotente)
INSERT INTO comunicados_justificativas (escola_id, label, requer_aprovacao, ordem)
SELECT e.id, j.label, j.requer_aprovacao, j.ordem
FROM escolas e
CROSS JOIN (VALUES
  ('Consulta médica',     false, 10),
  ('Compromisso familiar', false, 20),
  ('Transporte',           false, 30),
  ('Enjoo / mal-estar',    false, 40),
  ('Atividade extra fora', false, 50)
) AS j(label, requer_aprovacao, ordem)
WHERE NOT EXISTS (
  SELECT 1 FROM comunicados_justificativas
  WHERE escola_id = e.id AND label = j.label
);
