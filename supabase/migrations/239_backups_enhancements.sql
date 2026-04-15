-- =====================================================
-- 239: Enhancements nos backups — retention custom, alerts, faces
-- =====================================================

ALTER TABLE escolas
  ADD COLUMN IF NOT EXISTS saas_retention_dias_override integer,
  ADD COLUMN IF NOT EXISTS saas_backup_alert_email text,
  ADD COLUMN IF NOT EXISTS saas_backup_incluir_faces boolean DEFAULT false;

COMMENT ON COLUMN escolas.saas_retention_dias_override IS 'Dias de retention custom (null = usa default do tier).';
COMMENT ON COLUMN escolas.saas_backup_alert_email IS 'Email p/ alertas de falha de backup (fallback: superusuario_email da config).';
COMMENT ON COLUMN escolas.saas_backup_incluir_faces IS 'Se true, backup baixa e inclui imagens de faces (aumenta tamanho).';

-- Atualiza função de retention para respeitar override
CREATE OR REPLACE FUNCTION backup_retention_days(p_escola_id uuid) RETURNS int AS $$
DECLARE
  override_dias int;
  tier text;
BEGIN
  SELECT saas_retention_dias_override INTO override_dias FROM escolas WHERE id = p_escola_id;
  IF override_dias IS NOT NULL AND override_dias > 0 THEN RETURN override_dias; END IF;

  SELECT lower(coalesce(p.slug, p.nome, ''))
    INTO tier
    FROM escolas e LEFT JOIN planos p ON p.id = e.plano_id
   WHERE e.id = p_escola_id;

  RETURN CASE
    WHEN tier LIKE '%prestige%' THEN 90
    WHEN tier LIKE '%evolu%'    THEN 30
    ELSE 14
  END;
EXCEPTION WHEN OTHERS THEN RETURN 14;
END $$ LANGUAGE plpgsql;

-- Tabela de restores para auditoria
CREATE TABLE IF NOT EXISTS restores_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id     uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  backup_data   date NOT NULL,
  modo          text NOT NULL CHECK (modo IN ('preview','apply')),
  iniciado_por  text,
  tabelas_afetadas integer,
  linhas_afetadas  bigint,
  status        text NOT NULL DEFAULT 'em_andamento'
                CHECK (status IN ('em_andamento','sucesso','erro','abortado')),
  erro_msg      text,
  iniciado_em   timestamptz DEFAULT now(),
  concluido_em  timestamptz
);
ALTER TABLE restores_log DISABLE ROW LEVEL SECURITY;
