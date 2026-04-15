-- =====================================================
-- 240: Billing SaaS via Asaas
-- =====================================================
-- Cobrança recorrente das escolas (NOSSO cliente) via Asaas.
-- Cada escola vira um "customer" do Asaas + assinatura mensal.
-- =====================================================

CREATE TABLE IF NOT EXISTS saas_clientes_asaas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL UNIQUE REFERENCES escolas(id) ON DELETE CASCADE,
  asaas_customer_id text NOT NULL,
  cpf_cnpj          text,
  criado_em         timestamptz DEFAULT now(),
  atualizado_em     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saas_assinaturas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  asaas_subscription_id text NOT NULL UNIQUE,
  valor             numeric(12,2) NOT NULL,
  ciclo             text NOT NULL DEFAULT 'MONTHLY'
                    CHECK (ciclo IN ('MONTHLY','YEARLY','QUARTERLY','SEMIANNUALLY')),
  proximo_vencimento date,
  status            text NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','INACTIVE','EXPIRED','CANCELLED')),
  forma_pagamento   text NOT NULL DEFAULT 'BOLETO'
                    CHECK (forma_pagamento IN ('BOLETO','CREDIT_CARD','PIX','UNDEFINED')),
  criado_em         timestamptz DEFAULT now(),
  atualizado_em     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saas_faturas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  asaas_payment_id  text NOT NULL UNIQUE,
  assinatura_id     uuid REFERENCES saas_assinaturas(id) ON DELETE SET NULL,
  valor             numeric(12,2) NOT NULL,
  valor_pago        numeric(12,2),
  data_vencimento   date NOT NULL,
  data_pagamento    date,
  status            text NOT NULL,
    -- PENDING, RECEIVED, CONFIRMED, OVERDUE, REFUNDED, RECEIVED_IN_CASH, REFUND_REQUESTED, CHARGEBACK_REQUESTED, CHARGEBACK_DISPUTE, AWAITING_CHARGEBACK_REVERSAL, DUNNING_REQUESTED, DUNNING_RECEIVED, AWAITING_RISK_ANALYSIS
  forma_pagamento   text,
  url_fatura        text,
  url_boleto        text,
  pix_copia_cola    text,
  descricao         text,
  webhook_raw       jsonb,
  criado_em         timestamptz DEFAULT now(),
  atualizado_em     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_faturas_escola   ON saas_faturas(escola_id);
CREATE INDEX IF NOT EXISTS idx_saas_faturas_status   ON saas_faturas(status);
CREATE INDEX IF NOT EXISTS idx_saas_faturas_venc     ON saas_faturas(data_vencimento);

ALTER TABLE saas_clientes_asaas DISABLE ROW LEVEL SECURITY;
ALTER TABLE saas_assinaturas DISABLE ROW LEVEL SECURITY;
ALTER TABLE saas_faturas DISABLE ROW LEVEL SECURITY;

-- Função que sincroniza escolas.saas_proximo_vencimento + saas_status a partir
-- da fatura mais recente (rodada após webhook do Asaas).
CREATE OR REPLACE FUNCTION sincronizar_saas_status(p_escola_id uuid) RETURNS void AS $$
DECLARE
  ultima_fatura record;
  novo_status text;
BEGIN
  SELECT data_vencimento, data_pagamento, status INTO ultima_fatura
    FROM saas_faturas
   WHERE escola_id = p_escola_id
   ORDER BY data_vencimento DESC LIMIT 1;

  IF ultima_fatura.data_vencimento IS NULL THEN RETURN; END IF;

  IF ultima_fatura.status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH') THEN
    novo_status := 'ativo';
  ELSIF ultima_fatura.data_vencimento >= CURRENT_DATE THEN
    novo_status := 'ativo';
  ELSIF ultima_fatura.data_vencimento >= CURRENT_DATE - INTERVAL '7 days' THEN
    novo_status := 'atraso';
  ELSIF ultima_fatura.data_vencimento >= CURRENT_DATE - INTERVAL '15 days' THEN
    novo_status := 'suspenso';
  ELSE
    novo_status := 'bloqueado';
  END IF;

  UPDATE escolas SET
    saas_proximo_vencimento = ultima_fatura.data_vencimento,
    saas_ultimo_pagamento   = ultima_fatura.data_pagamento,
    saas_status             = novo_status
   WHERE id = p_escola_id;
END $$ LANGUAGE plpgsql;

COMMENT ON TABLE saas_clientes_asaas IS 'Vínculo 1:1 entre escola e customer no Asaas.';
COMMENT ON TABLE saas_assinaturas IS 'Assinaturas mensais recorrentes via Asaas (mensalidade da escola para a Lumied).';
COMMENT ON TABLE saas_faturas IS 'Faturas individuais geradas pelo Asaas. Sync via webhook.';
