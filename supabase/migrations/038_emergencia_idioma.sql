-- Alertas de emergencia
CREATE TABLE IF NOT EXISTS alertas_emergencia (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo text NOT NULL CHECK (tipo IN ('incendio','intruso','emergencia_medica','evacuacao','outro')),
  mensagem text,
  acionado_por text NOT NULL,
  acionado_por_id text,
  ativo boolean DEFAULT true,
  resolvido_em timestamptz,
  resolvido_por text,
  criado_em timestamptz DEFAULT now()
);

ALTER TABLE alertas_emergencia DISABLE ROW LEVEL SECURITY;

-- Preferencia de idioma por usuario
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS idioma text DEFAULT 'pt';
