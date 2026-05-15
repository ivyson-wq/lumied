-- ═══════════════════════════════════════════════════════════════
-- Migration 346 — lap_activation_dismiss
--
-- Suporte do Activation Checklist (Sprint 4 do LAP). Cada linha
-- representa um item "escondido até X" ou "marcado como feito"
-- por um usuário/escola.
--
-- Estado do checklist é calculado JOIN com product_events (mig 345).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lap_activation_dismiss (
  escola_id        uuid        NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL,
  item_key         text        NOT NULL,
  dismissed_until  timestamptz,  -- null = permanente / até marcação manual
  marked_done      boolean     NOT NULL DEFAULT false,
  marked_done_at   timestamptz,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (escola_id, user_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_lap_dismiss_escola
  ON lap_activation_dismiss(escola_id);

CREATE INDEX IF NOT EXISTS idx_lap_dismiss_until
  ON lap_activation_dismiss(dismissed_until)
  WHERE dismissed_until IS NOT NULL;

-- Tenant isolation
SELECT add_tenant_isolation('lap_activation_dismiss');

-- Trigger pra atualizar atualizado_em
CREATE OR REPLACE FUNCTION lap_dismiss_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lap_dismiss_touch ON lap_activation_dismiss;
CREATE TRIGGER trg_lap_dismiss_touch
  BEFORE UPDATE ON lap_activation_dismiss
  FOR EACH ROW EXECUTE FUNCTION lap_dismiss_touch();

COMMENT ON TABLE lap_activation_dismiss IS
  'Estado de dismiss/mark do Activation Checklist (mig 346). Catálogo de itens fica em código (_shared/lap_checklist.ts).';
