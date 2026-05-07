-- ═══════════════════════════════════════════════════════════════
--  Migration 271 — Recursos compartilhados + reservas (tablets etc)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS recursos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id     uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  tipo          text NOT NULL,           -- 'tablet','projetor','sala','impressora', etc.
  identificacao text NOT NULL,           -- número de patrimônio ou nome único
  modelo        text,
  localizacao   text,
  fixo          boolean NOT NULL DEFAULT false,  -- true = fixo na sala (não-móvel)
  ativo         boolean NOT NULL DEFAULT true,
  observacao    text,
  criado_em     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recursos_escola ON recursos(escola_id, tipo) WHERE ativo = true;

CREATE TABLE IF NOT EXISTS reservas_recursos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id     uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  recurso_id    uuid NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
  turma_id      uuid REFERENCES series(id) ON DELETE SET NULL,
  professora_id uuid REFERENCES professoras(id) ON DELETE SET NULL,
  inicio        timestamptz NOT NULL,
  fim           timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','cancelada','concluida')),
  observacao    text,
  criado_em     timestamptz DEFAULT now(),
  CHECK (fim > inicio)
);

CREATE INDEX IF NOT EXISTS idx_reservas_recurso ON reservas_recursos(recurso_id, inicio, fim) WHERE status = 'ativa';
CREATE INDEX IF NOT EXISTS idx_reservas_escola ON reservas_recursos(escola_id, inicio DESC);

-- Tenant isolation
DO $$ BEGIN
  PERFORM add_tenant_isolation('recursos');
  PERFORM add_tenant_isolation('reservas_recursos');
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'CREATE TRIGGER trg_tenant_check BEFORE INSERT ON recursos FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()';
  EXECUTE 'CREATE TRIGGER trg_tenant_check BEFORE INSERT ON reservas_recursos FOR EACH ROW EXECUTE FUNCTION enforce_tenant_escola_id()';
END $$;

-- Trigger anti-conflito: rejeita reserva com sobreposição no mesmo recurso ativo
CREATE OR REPLACE FUNCTION reservas_anti_conflito() RETURNS trigger AS $$
DECLARE
  conflito_id uuid;
BEGIN
  IF NEW.status <> 'ativa' THEN RETURN NEW; END IF;
  SELECT id INTO conflito_id FROM reservas_recursos
  WHERE recurso_id = NEW.recurso_id
    AND status = 'ativa'
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND tstzrange(inicio, fim, '[)') && tstzrange(NEW.inicio, NEW.fim, '[)')
  LIMIT 1;
  IF conflito_id IS NOT NULL THEN
    RAISE EXCEPTION 'Conflito de reserva: este recurso já está reservado em parte do horário (reserva %)', conflito_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservas_anti_conflito ON reservas_recursos;
CREATE TRIGGER trg_reservas_anti_conflito
  BEFORE INSERT OR UPDATE ON reservas_recursos
  FOR EACH ROW EXECUTE FUNCTION reservas_anti_conflito();
