-- =====================================================
-- 231: Onboarding Checklist + Billing SaaS
-- =====================================================
-- Adiciona suporte a:
--   1) Checklist de onboarding por escola (etapas concluídas)
--   2) Billing SaaS: vencimento do plano, status, grace period
-- =====================================================

-- ── Onboarding checklist ──
ALTER TABLE escolas
  ADD COLUMN IF NOT EXISTS onboarding_checklist jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS onboarding_dismissed_em timestamptz;

-- Etapas reconhecidas (documentação; valores livres por frontend)
-- { "cadastrar_alunos": {concluido_em, por_usuario},
--   "cadastrar_professoras": {...},
--   "configurar_financeiro": {...},
--   "configurar_comunicacao": {...},
--   "aceitar_termos_dpa": {...},
--   "primeiro_comunicado": {...},
--   "primeira_mensalidade": {...},
--   "convidar_familias": {...} }

-- ── Billing SaaS ──
ALTER TABLE escolas
  ADD COLUMN IF NOT EXISTS saas_proximo_vencimento date,
  ADD COLUMN IF NOT EXISTS saas_ultimo_pagamento date,
  ADD COLUMN IF NOT EXISTS saas_status text DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS saas_grace_ate date,
  ADD COLUMN IF NOT EXISTS saas_valor_mensal numeric(12,2),
  ADD COLUMN IF NOT EXISTS saas_forma_pagamento text;  -- 'cartao','boleto','pix'

DO $$ BEGIN
  ALTER TABLE escolas ADD CONSTRAINT escolas_saas_status_check
    CHECK (saas_status IN ('ativo','aviso','atraso','grace','suspenso','bloqueado','cancelado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_escolas_saas_status ON escolas(saas_status);
CREATE INDEX IF NOT EXISTS idx_escolas_saas_venc ON escolas(saas_proximo_vencimento);

-- Função auxiliar: computa estado atual a partir de datas
CREATE OR REPLACE FUNCTION escola_saas_estado(e escolas) RETURNS text AS $$
BEGIN
  IF e.saas_status IN ('cancelado','bloqueado') THEN RETURN e.saas_status; END IF;
  IF e.saas_proximo_vencimento IS NULL THEN RETURN 'ativo'; END IF;
  IF CURRENT_DATE <= e.saas_proximo_vencimento - INTERVAL '7 days' THEN RETURN 'ativo'; END IF;
  IF CURRENT_DATE <= e.saas_proximo_vencimento THEN RETURN 'aviso'; END IF;
  IF e.saas_grace_ate IS NOT NULL AND CURRENT_DATE <= e.saas_grace_ate THEN RETURN 'grace'; END IF;
  IF CURRENT_DATE <= e.saas_proximo_vencimento + INTERVAL '7 days' THEN RETURN 'atraso'; END IF;
  IF CURRENT_DATE <= e.saas_proximo_vencimento + INTERVAL '15 days' THEN RETURN 'suspenso'; END IF;
  RETURN 'bloqueado';
END;
$$ LANGUAGE plpgsql;

-- View para consumo no frontend
CREATE OR REPLACE VIEW vw_escola_saas AS
SELECT
  e.id, e.nome,
  e.saas_proximo_vencimento,
  e.saas_ultimo_pagamento,
  e.saas_valor_mensal,
  e.saas_forma_pagamento,
  e.saas_grace_ate,
  escola_saas_estado(e) AS estado,
  CASE
    WHEN e.saas_proximo_vencimento IS NULL THEN NULL
    ELSE (e.saas_proximo_vencimento - CURRENT_DATE)
  END AS dias_para_vencimento
FROM escolas e;

COMMENT ON COLUMN escolas.saas_status IS 'Status do plano SaaS da escola — ativo/aviso/atraso/grace/suspenso/bloqueado/cancelado';
COMMENT ON COLUMN escolas.onboarding_checklist IS 'Progresso do checklist de onboarding: {etapa: {concluido_em, por}}';
