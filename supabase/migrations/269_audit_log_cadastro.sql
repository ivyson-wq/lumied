-- ═══════════════════════════════════════════════════════════════
--  Migration 269 — Audit log de cadastros (turmas, atividades, etc)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_log_cadastro (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id   uuid REFERENCES escolas(id) ON DELETE CASCADE,
  entidade    text NOT NULL,           -- 'series', 'atividades', 'professoras', etc.
  entidade_id text NOT NULL,
  acao        text NOT NULL CHECK (acao IN ('insert','update','delete')),
  antes       jsonb,
  depois      jsonb,
  autor       text,                    -- nome do autor (auth.users.email ou role)
  criado_em   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_escola ON audit_log_cadastro(escola_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entidade ON audit_log_cadastro(entidade, entidade_id, criado_em DESC);

-- Função genérica que registra audit
CREATE OR REPLACE FUNCTION audit_cadastro_trigger() RETURNS trigger AS $$
DECLARE
  v_escola_id uuid;
  v_id text;
BEGIN
  -- escola_id pode estar em NEW ou OLD
  v_escola_id := COALESCE((NEW.escola_id)::uuid, (OLD.escola_id)::uuid);
  v_id := COALESCE(NEW.id::text, OLD.id::text);

  INSERT INTO audit_log_cadastro (escola_id, entidade, entidade_id, acao, antes, depois)
  VALUES (
    v_escola_id,
    TG_TABLE_NAME,
    v_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'insert' WHEN TG_OP = 'UPDATE' THEN 'update' ELSE 'delete' END,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Aplica em series e atividades
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['series','atividades'] LOOP
    BEGIN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_cadastro ON %I', tbl);
      EXECUTE format('CREATE TRIGGER trg_audit_cadastro AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_cadastro_trigger()', tbl);
      RAISE NOTICE '✓ Audit aplicado em %', tbl;
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE '⚠ Tabela % não existe, skip', tbl;
    END;
  END LOOP;
END $$;
