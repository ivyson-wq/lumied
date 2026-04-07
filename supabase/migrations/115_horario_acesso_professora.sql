-- Migration 115: Horário de acesso das professoras ao sistema
-- Permite que o gerente defina janelas de horário em que cada professora pode acessar o portal

CREATE TABLE IF NOT EXISTS professora_horario_acesso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professora_id uuid NOT NULL REFERENCES professoras(id) ON DELETE CASCADE,
  dia_semana smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0=domingo, 6=sábado
  hora_inicio time NOT NULL DEFAULT '07:00',
  hora_fim time NOT NULL DEFAULT '18:00',
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),
  UNIQUE(professora_id, dia_semana)
);

CREATE INDEX idx_prof_horario_prof ON professora_horario_acesso(professora_id);
CREATE INDEX idx_prof_horario_ativo ON professora_horario_acesso(ativo);

-- Comentário
COMMENT ON TABLE professora_horario_acesso IS 'Janelas de acesso ao sistema por professora. Se não houver registro, acesso é livre (backwards compatible).';
COMMENT ON COLUMN professora_horario_acesso.dia_semana IS '0=Domingo, 1=Segunda, 2=Terça, 3=Quarta, 4=Quinta, 5=Sexta, 6=Sábado';
