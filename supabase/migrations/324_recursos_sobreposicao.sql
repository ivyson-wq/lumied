-- ═══════════════════════════════════════════════════════════════
--  Migration 324 — Permitir sobreposição de horários em recursos
--
--  Alguns recursos (ex: sala grande, projetor compartilhado) podem
--  ser usados por múltiplas turmas ao mesmo tempo. A flag
--  permite_sobreposicao desliga o trigger anti-conflito para esse recurso.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE recursos
  ADD COLUMN IF NOT EXISTS permite_sobreposicao boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN recursos.permite_sobreposicao IS
  'Se true, o trigger anti-conflito é ignorado e múltiplas reservas podem se sobrepor.';

-- Trigger anti-conflito v3: respeita permite_sobreposicao
CREATE OR REPLACE FUNCTION reservas_anti_conflito() RETURNS trigger AS $$
DECLARE
  conflito_id uuid;
  buffer_min int := 0;
  carga_min int := 0;
  sobrepoe boolean := false;
BEGIN
  IF NEW.status <> 'ativa' THEN RETURN NEW; END IF;
  SELECT buffer_pos_uso_min, tempo_carga_min, permite_sobreposicao
    INTO buffer_min, carga_min, sobrepoe
    FROM recursos WHERE id = NEW.recurso_id;
  IF COALESCE(sobrepoe, false) THEN RETURN NEW; END IF;
  buffer_min := COALESCE(buffer_min, 0);
  carga_min := COALESCE(carga_min, 0);

  SELECT id INTO conflito_id FROM reservas_recursos
  WHERE recurso_id = NEW.recurso_id
    AND status = 'ativa'
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND tstzrange(inicio - make_interval(mins => carga_min),
                  fim    + make_interval(mins => buffer_min), '[)')
        && tstzrange(NEW.inicio - make_interval(mins => carga_min),
                     NEW.fim    + make_interval(mins => buffer_min), '[)')
  LIMIT 1;
  IF conflito_id IS NOT NULL THEN
    RAISE EXCEPTION 'Conflito de reserva: este recurso já está reservado em parte do horário (considerando margem de % min e carga de % min) — reserva %',
      buffer_min, carga_min, conflito_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
