-- Achados e Perdidos
CREATE TABLE IF NOT EXISTS achados_perdidos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  descricao text NOT NULL,
  local_encontrado text,
  foto_url text,
  postado_por_id uuid NOT NULL,
  postado_por_nome text,
  status text NOT NULL DEFAULT 'interno' CHECK (status IN ('interno','publico','devolvido')),
  publicar_em timestamptz DEFAULT now() + interval '12 hours',
  devolvido_para text,
  devolvido_em timestamptz,
  criado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_achados_status ON achados_perdidos(status);
ALTER TABLE achados_perdidos DISABLE ROW LEVEL SECURITY;

-- Storage bucket para fotos
INSERT INTO storage.buckets (id, name, public) VALUES ('achados-perdidos', 'achados-perdidos', true)
ON CONFLICT (id) DO NOTHING;
