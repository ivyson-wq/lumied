-- ═══════════════════════════════════════════════════════════════
--  Migration 219: Multi-tenant escola_id on operational tables
--
--  Idempotent — safe to re-run. Adds escola_id column + index +
--  backfills from parent FKs (or from the first escola as a
--  single-tenant fallback). Does NOT set NOT NULL yet — legacy
--  rows with null escola_id survive until a later tightening
--  migration. Every ALTER is wrapped in IF NOT EXISTS / DO blocks
--  so the script tolerates tables that haven't been created yet
--  by migrations that didn't ship to this environment.
--
--  Rationale: before onboarding the 2nd tenant, operacional/rh/
--  compliance tables referenced by edge functions need a proper
--  escola_id for tenant isolation. Previously these were scoped
--  via parent FKs (acervo_id, rota_id, funcionario_id) or not at
--  all — which breaks down with more than one tenant.
-- ═══════════════════════════════════════════════════════════════

-- Helper: id of the default (first) escola, used as fallback
-- backfill value when no parent relationship is available.
DO $mig$
DECLARE
  default_escola_id uuid;
BEGIN
  SELECT id INTO default_escola_id FROM escolas ORDER BY criado_em NULLS LAST, id LIMIT 1;

  -- If there are zero escolas, there's nothing to backfill; we still
  -- add the columns so schema matches code.
  PERFORM set_config('lumied.default_escola_id', COALESCE(default_escola_id::text, ''), true);
END
$mig$;

-- ═══════════════════════════════════════════════════════════════
--  COMPLIANCE
-- ═══════════════════════════════════════════════════════════════

-- compliance_horarios → backfill via professoras.escola_id
DO $$ BEGIN
  ALTER TABLE compliance_horarios ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE compliance_horarios ch
    SET escola_id = p.escola_id
    FROM professoras p
    WHERE ch.professora_id = p.id
      AND ch.escola_id IS NULL
      AND p.escola_id IS NOT NULL;
  UPDATE compliance_horarios
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_compliance_horarios_escola_id ON compliance_horarios(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- compliance_ocorrencias → backfill via professoras.escola_id
DO $$ BEGIN
  ALTER TABLE compliance_ocorrencias ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE compliance_ocorrencias co
    SET escola_id = p.escola_id
    FROM professoras p
    WHERE co.professora_id = p.id
      AND co.escola_id IS NULL
      AND p.escola_id IS NOT NULL;
  UPDATE compliance_ocorrencias
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_compliance_ocorrencias_escola_id ON compliance_ocorrencias(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- compliance_alertas → backfill via professoras.escola_id
DO $$ BEGIN
  ALTER TABLE compliance_alertas ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE compliance_alertas ca
    SET escola_id = p.escola_id
    FROM professoras p
    WHERE ca.professora_id = p.id
      AND ca.escola_id IS NULL
      AND p.escola_id IS NOT NULL;
  UPDATE compliance_alertas
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_compliance_alertas_escola_id ON compliance_alertas(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- compliance_ponto_registros → backfill via professoras.escola_id
DO $$ BEGIN
  ALTER TABLE compliance_ponto_registros ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE compliance_ponto_registros cpr
    SET escola_id = p.escola_id
    FROM professoras p
    WHERE cpr.professora_id = p.id
      AND cpr.escola_id IS NULL
      AND p.escola_id IS NOT NULL;
  UPDATE compliance_ponto_registros
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_compliance_ponto_registros_escola_id ON compliance_ponto_registros(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- compliance_ponto_importacoes → fallback to default escola only
DO $$ BEGIN
  ALTER TABLE compliance_ponto_importacoes ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE compliance_ponto_importacoes
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_compliance_ponto_importacoes_escola_id ON compliance_ponto_importacoes(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- compliance_incidentes → fallback to default escola
DO $$ BEGIN
  ALTER TABLE compliance_incidentes ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE compliance_incidentes
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_compliance_incidentes_escola_id ON compliance_incidentes(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- compliance_certificacoes → backfill via rh_funcionarios.escola_id
DO $$ BEGIN
  ALTER TABLE compliance_certificacoes ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE compliance_certificacoes cc
    SET escola_id = rf.escola_id
    FROM rh_funcionarios rf
    WHERE cc.funcionario_id = rf.id
      AND cc.escola_id IS NULL
      AND rf.escola_id IS NOT NULL;
  UPDATE compliance_certificacoes
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_compliance_certificacoes_escola_id ON compliance_certificacoes(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- compliance_inspecoes → fallback to default escola
DO $$ BEGIN
  ALTER TABLE compliance_inspecoes ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE compliance_inspecoes
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_compliance_inspecoes_escola_id ON compliance_inspecoes(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- compliance_politicas → fallback to default escola
DO $$ BEGIN
  ALTER TABLE compliance_politicas ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE compliance_politicas
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_compliance_politicas_escola_id ON compliance_politicas(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- compliance_calendario → fallback to default escola
DO $$ BEGIN
  ALTER TABLE compliance_calendario ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE compliance_calendario
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_compliance_calendario_escola_id ON compliance_calendario(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- compliance_banco_horas → backfill via professoras.escola_id
DO $$ BEGIN
  ALTER TABLE compliance_banco_horas ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE compliance_banco_horas cbh
    SET escola_id = p.escola_id
    FROM professoras p
    WHERE cbh.professora_id = p.id
      AND cbh.escola_id IS NULL
      AND p.escola_id IS NOT NULL;
  UPDATE compliance_banco_horas
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_compliance_banco_horas_escola_id ON compliance_banco_horas(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- compliance_feriados → fallback to default escola (currently global list)
DO $$ BEGIN
  ALTER TABLE compliance_feriados ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE compliance_feriados
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_compliance_feriados_escola_id ON compliance_feriados(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- compliance_config_ponto → fallback to default escola (currently single-tenant key/value)
DO $$ BEGIN
  ALTER TABLE compliance_config_ponto ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE compliance_config_ponto
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_compliance_config_ponto_escola_id ON compliance_config_ponto(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════
--  RH
-- ═══════════════════════════════════════════════════════════════

-- rh_ponto → via rh_funcionarios.escola_id
DO $$ BEGIN
  ALTER TABLE rh_ponto ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE rh_ponto rp
    SET escola_id = rf.escola_id
    FROM rh_funcionarios rf
    WHERE rp.funcionario_id = rf.id
      AND rp.escola_id IS NULL
      AND rf.escola_id IS NOT NULL;
  UPDATE rh_ponto
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_rh_ponto_escola_id ON rh_ponto(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- rh_ferias → via rh_funcionarios.escola_id
DO $$ BEGIN
  ALTER TABLE rh_ferias ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE rh_ferias rfe
    SET escola_id = rf.escola_id
    FROM rh_funcionarios rf
    WHERE rfe.funcionario_id = rf.id
      AND rfe.escola_id IS NULL
      AND rf.escola_id IS NOT NULL;
  UPDATE rh_ferias
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_rh_ferias_escola_id ON rh_ferias(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- rh_holerites → via rh_funcionarios.escola_id
DO $$ BEGIN
  ALTER TABLE rh_holerites ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE rh_holerites rh
    SET escola_id = rf.escola_id
    FROM rh_funcionarios rf
    WHERE rh.funcionario_id = rf.id
      AND rh.escola_id IS NULL
      AND rf.escola_id IS NOT NULL;
  UPDATE rh_holerites
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_rh_holerites_escola_id ON rh_holerites(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- rh_folha_pagamento → no parent FK to a funcionario; fallback to default escola
-- (pay-slip runs are per-month, per-tenant; tenant resolved at runtime)
DO $$ BEGIN
  ALTER TABLE rh_folha_pagamento ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE rh_folha_pagamento
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_rh_folha_pagamento_escola_id ON rh_folha_pagamento(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════
--  OPERACIONAL — Biblioteca / Cantina / Transporte
-- ═══════════════════════════════════════════════════════════════

-- biblioteca_emprestimos → via biblioteca_acervo.escola_id
DO $$ BEGIN
  ALTER TABLE biblioteca_emprestimos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE biblioteca_emprestimos be
    SET escola_id = ba.escola_id
    FROM biblioteca_acervo ba
    WHERE be.acervo_id = ba.id
      AND be.escola_id IS NULL
      AND ba.escola_id IS NOT NULL;
  UPDATE biblioteca_emprestimos
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_biblioteca_emprestimos_escola_id ON biblioteca_emprestimos(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- biblioteca_reservas → via biblioteca_acervo.escola_id
DO $$ BEGIN
  ALTER TABLE biblioteca_reservas ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE biblioteca_reservas br
    SET escola_id = ba.escola_id
    FROM biblioteca_acervo ba
    WHERE br.acervo_id = ba.id
      AND br.escola_id IS NULL
      AND ba.escola_id IS NOT NULL;
  UPDATE biblioteca_reservas
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_biblioteca_reservas_escola_id ON biblioteca_reservas(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- cantina_creditos → fallback to default escola (aluno_email is text; alunos join is fragile)
DO $$ BEGIN
  ALTER TABLE cantina_creditos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  -- best-effort backfill via alunos.email
  BEGIN
    UPDATE cantina_creditos cc
      SET escola_id = a.escola_id
      FROM alunos a
      WHERE cc.aluno_email = a.email
        AND cc.escola_id IS NULL
        AND a.escola_id IS NOT NULL;
  EXCEPTION WHEN others THEN NULL; END;
  UPDATE cantina_creditos
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_cantina_creditos_escola_id ON cantina_creditos(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- cantina_transacoes → same pattern
DO $$ BEGIN
  ALTER TABLE cantina_transacoes ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  BEGIN
    UPDATE cantina_transacoes ct
      SET escola_id = a.escola_id
      FROM alunos a
      WHERE ct.aluno_email = a.email
        AND ct.escola_id IS NULL
        AND a.escola_id IS NOT NULL;
  EXCEPTION WHEN others THEN NULL; END;
  UPDATE cantina_transacoes
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_cantina_transacoes_escola_id ON cantina_transacoes(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- cantina_restricoes → same pattern
DO $$ BEGIN
  ALTER TABLE cantina_restricoes ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  BEGIN
    UPDATE cantina_restricoes cr
      SET escola_id = a.escola_id
      FROM alunos a
      WHERE cr.aluno_email = a.email
        AND cr.escola_id IS NULL
        AND a.escola_id IS NOT NULL;
  EXCEPTION WHEN others THEN NULL; END;
  UPDATE cantina_restricoes
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_cantina_restricoes_escola_id ON cantina_restricoes(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- transporte_alunos → via transporte_rotas.escola_id
DO $$ BEGIN
  ALTER TABLE transporte_alunos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE transporte_alunos ta
    SET escola_id = tr.escola_id
    FROM transporte_rotas tr
    WHERE ta.rota_id = tr.id
      AND ta.escola_id IS NULL
      AND tr.escola_id IS NOT NULL;
  UPDATE transporte_alunos
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_transporte_alunos_escola_id ON transporte_alunos(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- transporte_rastreio → via transporte_rotas.escola_id
DO $$ BEGIN
  ALTER TABLE transporte_rastreio ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE transporte_rastreio trr
    SET escola_id = tr.escola_id
    FROM transporte_rotas tr
    WHERE trr.rota_id = tr.id
      AND trr.escola_id IS NULL
      AND tr.escola_id IS NOT NULL;
  UPDATE transporte_rastreio
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_transporte_rastreio_escola_id ON transporte_rastreio(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- transporte_notificacoes → via transporte_rotas.escola_id
DO $$ BEGIN
  ALTER TABLE transporte_notificacoes ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  UPDATE transporte_notificacoes tn
    SET escola_id = tr.escola_id
    FROM transporte_rotas tr
    WHERE tn.rota_id = tr.id
      AND tn.escola_id IS NULL
      AND tr.escola_id IS NOT NULL;
  UPDATE transporte_notificacoes
    SET escola_id = NULLIF(current_setting('lumied.default_escola_id', true), '')::uuid
    WHERE escola_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_transporte_notificacoes_escola_id ON transporte_notificacoes(escola_id);
EXCEPTION WHEN others THEN NULL; END $$;
