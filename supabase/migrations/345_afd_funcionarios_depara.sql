-- 345_afd_funcionarios_depara.sql
-- De-para entre o "PIS" gravado no AFD pelo dispositivo (que pode ser o PIS oficial,
-- mas costuma ser um identificador interno do REP/iDFace) e o cadastro do funcionário
-- em ponto_employees. Resolve o caso real (Maple Bento, 2026-05-15): AFD com 171
-- funcionários, 0 matches por PIS direto.
--
-- Diferente de ponto_employees (que guarda PIS oficial para folha), esta tabela é
-- alimentada automaticamente pela importação do AFD (registro tipo 5) e exposta na
-- UI para associação/criação manual.

CREATE TABLE IF NOT EXISTS afd_funcionarios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id       uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  pis_afd         varchar(12) NOT NULL,
  nome_afd        text,
  cargo_afd       text,
  employee_id     uuid REFERENCES ponto_employees(id) ON DELETE SET NULL,
  primeiro_visto  date,
  ultimo_visto    date,
  total_eventos   integer NOT NULL DEFAULT 0,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (escola_id, pis_afd)
);

CREATE INDEX IF NOT EXISTS idx_afd_funcionarios_escola
  ON afd_funcionarios(escola_id);

CREATE INDEX IF NOT EXISTS idx_afd_funcionarios_employee
  ON afd_funcionarios(employee_id) WHERE employee_id IS NOT NULL;

ALTER TABLE afd_funcionarios ENABLE ROW LEVEL SECURITY;

-- Trigger de tenant isolation (padrão das migs 243-245)
SELECT add_tenant_isolation('afd_funcionarios');

-- Backfill retroativo: extrai PIS distintos dos eventos órfãos das importações
-- já aplicadas (não temos o conteúdo bruto do tipo 5, então nome_afd fica NULL —
-- o usuário preenche manualmente na UI ao associar).
INSERT INTO afd_funcionarios (escola_id, pis_afd, primeiro_visto, ultimo_visto, total_eventos)
SELECT
  e.escola_id,
  e.pis,
  MIN(e.data_evento),
  MAX(e.data_evento),
  COUNT(*)
FROM afd_events e
WHERE e.employee_id IS NULL
GROUP BY e.escola_id, e.pis
ON CONFLICT (escola_id, pis_afd) DO UPDATE SET
  primeiro_visto = LEAST(afd_funcionarios.primeiro_visto, EXCLUDED.primeiro_visto),
  ultimo_visto   = GREATEST(afd_funcionarios.ultimo_visto, EXCLUDED.ultimo_visto),
  total_eventos  = EXCLUDED.total_eventos,
  atualizado_em  = now();
