-- Calendario escolar
CREATE TABLE IF NOT EXISTS calendario_eventos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo text NOT NULL,
  descricao text,
  data_inicio date NOT NULL,
  data_fim date,
  tipo text NOT NULL DEFAULT 'evento' CHECK (tipo IN ('feriado','reuniao','evento','data_comemorativa','recesso','avaliacao')),
  cor text DEFAULT '#C8102E',
  visivel_pais boolean DEFAULT true,
  visivel_professoras boolean DEFAULT true,
  criado_por text,
  criado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cal_datas ON calendario_eventos(data_inicio, data_fim);
ALTER TABLE calendario_eventos DISABLE ROW LEVEL SECURITY;
