-- ═══════════════════════════════════════════════════════════════
--  Migration 287 — Buffer pós-uso + tempo de carga em recursos
--
--  Aulas atrasam e tablets precisam carregar entre usos. O recurso
--  efetivamente ocupa [inicio - tempo_carga_min, fim + buffer_pos_uso_min]
--  e o trigger anti-conflito considera essa janela expandida.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE recursos
  ADD COLUMN IF NOT EXISTS buffer_pos_uso_min int NOT NULL DEFAULT 15
    CHECK (buffer_pos_uso_min >= 0 AND buffer_pos_uso_min <= 240),
  ADD COLUMN IF NOT EXISTS tempo_carga_min int NOT NULL DEFAULT 0
    CHECK (tempo_carga_min >= 0 AND tempo_carga_min <= 240);

COMMENT ON COLUMN recursos.buffer_pos_uso_min IS
  'Minutos de margem após o fim da reserva (cobre atrasos de aula). Outra reserva só pode começar após fim+buffer.';
COMMENT ON COLUMN recursos.tempo_carga_min IS
  'Minutos necessários antes do início (ex: tablet carregando bateria, sala sendo preparada). Outra reserva só pode terminar antes de inicio-tempo_carga.';

-- Defaults inteligentes por tipo de recurso (idempotente — só aplica
-- quando ambos campos ainda estão nos defaults absolutos 15/0).
UPDATE recursos SET buffer_pos_uso_min = 15, tempo_carga_min = 30
 WHERE tipo = 'tablet'    AND buffer_pos_uso_min = 15 AND tempo_carga_min = 0;
UPDATE recursos SET buffer_pos_uso_min = 10, tempo_carga_min = 5
 WHERE tipo = 'projetor'  AND buffer_pos_uso_min = 15 AND tempo_carga_min = 0;
UPDATE recursos SET buffer_pos_uso_min = 15, tempo_carga_min = 10
 WHERE tipo = 'sala'      AND buffer_pos_uso_min = 15 AND tempo_carga_min = 0;

-- Trigger anti-conflito v2: respeita buffer + carga do recurso
CREATE OR REPLACE FUNCTION reservas_anti_conflito() RETURNS trigger AS $$
DECLARE
  conflito_id uuid;
  buffer_min int := 0;
  carga_min int := 0;
BEGIN
  IF NEW.status <> 'ativa' THEN RETURN NEW; END IF;
  SELECT buffer_pos_uso_min, tempo_carga_min INTO buffer_min, carga_min
    FROM recursos WHERE id = NEW.recurso_id;
  buffer_min := COALESCE(buffer_min, 0);
  carga_min := COALESCE(carga_min, 0);

  -- Janela efetiva da NOVA reserva: precisa de tempo_carga antes
  -- e libera só depois de fim + buffer
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
