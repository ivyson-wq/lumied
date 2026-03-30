-- =====================================================
-- 075: Multi-tenancy — Limites por plano + subdomínios
-- =====================================================

-- 1. Limites por plano
CREATE TABLE IF NOT EXISTS plano_limites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  plano_id uuid NOT NULL REFERENCES planos(id) ON DELETE CASCADE,
  recurso text NOT NULL,            -- 'max_alunos','max_storage_gb','max_usuarios','max_leads'
  limite integer NOT NULL,
  UNIQUE(plano_id, recurso)
);
ALTER TABLE plano_limites DISABLE ROW LEVEL SECURITY;

-- Seed limites por plano
INSERT INTO plano_limites (plano_id, recurso, limite)
SELECT p.id, v.recurso, v.limite FROM planos p
CROSS JOIN (VALUES
  ('essencial','max_alunos',100),('essencial','max_usuarios',5),('essencial','max_storage_gb',5),('essencial','max_leads',50),
  ('profissional','max_alunos',300),('profissional','max_usuarios',15),('profissional','max_storage_gb',20),('profissional','max_leads',200),
  ('premium','max_alunos',1000),('premium','max_usuarios',50),('premium','max_storage_gb',100),('premium','max_leads',1000),
  ('enterprise','max_alunos',999999),('enterprise','max_usuarios',999999),('enterprise','max_storage_gb',999999),('enterprise','max_leads',999999)
) AS v(plano_slug, recurso, limite)
WHERE p.slug = v.plano_slug
ON CONFLICT (plano_id, recurso) DO NOTHING;

-- 2. Subdomínio por escola
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS subdominio text UNIQUE;
UPDATE escolas SET subdominio = slug WHERE subdominio IS NULL AND slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_escolas_subdominio ON escolas(subdominio);

-- 3. Uso atual por escola (cache atualizado periodicamente)
CREATE TABLE IF NOT EXISTS escola_uso (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  recurso text NOT NULL,
  uso_atual integer DEFAULT 0,
  atualizado_em timestamptz DEFAULT now(),
  UNIQUE(escola_id, recurso)
);
ALTER TABLE escola_uso DISABLE ROW LEVEL SECURITY;

-- 4. Função para verificar limite
CREATE OR REPLACE FUNCTION check_limite(p_escola_id uuid, p_recurso text)
RETURNS boolean AS $$
DECLARE
  v_limite integer;
  v_uso integer;
BEGIN
  -- Buscar limite do plano da escola
  SELECT pl.limite INTO v_limite
  FROM escolas e
  JOIN plano_limites pl ON pl.plano_id = e.plano_id AND pl.recurso = p_recurso
  WHERE e.id = p_escola_id;

  IF v_limite IS NULL THEN RETURN true; END IF; -- sem limite configurado = permitido

  -- Buscar uso atual
  SELECT COALESCE(uso_atual, 0) INTO v_uso
  FROM escola_uso
  WHERE escola_id = p_escola_id AND recurso = p_recurso;

  RETURN COALESCE(v_uso, 0) < v_limite;
END;
$$ LANGUAGE plpgsql;

-- 5. Histórico de uso (para analytics)
CREATE TABLE IF NOT EXISTS escola_uso_historico (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  recurso text NOT NULL,
  valor integer NOT NULL,
  data date NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(escola_id, recurso, data)
);
ALTER TABLE escola_uso_historico DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_uso_hist_escola ON escola_uso_historico(escola_id, data);
