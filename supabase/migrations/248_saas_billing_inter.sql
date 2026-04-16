-- ═══════════════════════════════════════════════════════════════
--  Migration 248: Migrar cobrança SaaS de ASAAS → Banco Inter
-- ═══════════════════════════════════════════════════════════════
--  Contexto: ASAAS nunca chegou a ser usado em produção — podemos dropar
--  de forma limpa. Substituímos pelo relay mTLS que já existe (mesmo
--  usado pelos boletos de aluno das escolas).
--
--  Mudanças:
--    • DROP saas_clientes_asaas (nunca teve dados reais)
--    • saas_assinaturas: renomeia asaas_subscription_id → inter_ref (nullable)
--    • saas_faturas: renomeia asaas_payment_id → inter_cobranca_id;
--                    adiciona nosso_numero, pix_txid, codigo_barras
--    • NOVA: saas_clientes_inter (CPF/CNPJ + dados pagador)
--    • NOVA função: gerar_faturas_saas_mes() — cron mensal emite fatura
-- ═══════════════════════════════════════════════════════════════

-- ── DROP ASAAS ──
DROP TABLE IF EXISTS saas_clientes_asaas CASCADE;

-- ── Renomear colunas existentes ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='saas_assinaturas' AND column_name='asaas_subscription_id') THEN
    ALTER TABLE saas_assinaturas RENAME COLUMN asaas_subscription_id TO inter_ref;
    ALTER TABLE saas_assinaturas ALTER COLUMN inter_ref DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='saas_faturas' AND column_name='asaas_payment_id') THEN
    ALTER TABLE saas_faturas RENAME COLUMN asaas_payment_id TO inter_cobranca_id;
    ALTER TABLE saas_faturas ALTER COLUMN inter_cobranca_id DROP NOT NULL;
  END IF;
END $$;

-- ── Novos campos específicos do Inter ──
ALTER TABLE saas_faturas ADD COLUMN IF NOT EXISTS nosso_numero TEXT;
ALTER TABLE saas_faturas ADD COLUMN IF NOT EXISTS pix_txid     TEXT;
ALTER TABLE saas_faturas ADD COLUMN IF NOT EXISTS codigo_barras TEXT;
ALTER TABLE saas_faturas ADD COLUMN IF NOT EXISTS linha_digitavel TEXT;
CREATE INDEX IF NOT EXISTS idx_saas_faturas_nosso_numero ON saas_faturas(nosso_numero);
CREATE INDEX IF NOT EXISTS idx_saas_faturas_inter_cob ON saas_faturas(inter_cobranca_id);

-- ── Tabela de clientes Inter (substitui saas_clientes_asaas) ──
CREATE TABLE IF NOT EXISTS saas_clientes_inter (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id         UUID NOT NULL UNIQUE REFERENCES escolas(id) ON DELETE CASCADE,
  cpf_cnpj          TEXT NOT NULL,
  nome_pagador      TEXT NOT NULL,
  email             TEXT,
  telefone          TEXT,
  endereco_logradouro TEXT,
  endereco_numero   TEXT,
  endereco_bairro   TEXT,
  endereco_cidade   TEXT,
  endereco_uf       TEXT,
  endereco_cep      TEXT,
  criado_em         TIMESTAMPTZ DEFAULT now(),
  atualizado_em     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE saas_clientes_inter DISABLE ROW LEVEL SECURITY;

-- ── Atualiza função de sincronização (mesmo nome, mesma lógica, independente do provedor) ──
-- sincronizar_saas_status continua válida — ela usa só saas_faturas.status

-- ── Função: gerar faturas mensais (chamada pelo cron) ──
CREATE OR REPLACE FUNCTION gerar_faturas_saas_mes() RETURNS TABLE(escola_id UUID, valor NUMERIC, data_vencimento DATE) AS $$
-- Para cada assinatura ACTIVE, verifica se já tem fatura no mês corrente.
-- Se não tiver, cria uma fatura com status PENDING no status.
-- A edge function saas-billing-inter pega as PENDING sem inter_cobranca_id
-- e emite as cobranças no Inter. Esse split (DB cria → edge emite) evita
-- que a função do Postgres precise chamar API externa.
BEGIN
  RETURN QUERY
  INSERT INTO saas_faturas (escola_id, assinatura_id, valor, data_vencimento, status, descricao, forma_pagamento)
  SELECT
    a.escola_id,
    a.id,
    a.valor,
    -- Próximo vencimento: dia da assinatura no mês seguinte
    make_date(
      EXTRACT(YEAR FROM CURRENT_DATE + INTERVAL '1 month')::INT,
      EXTRACT(MONTH FROM CURRENT_DATE + INTERVAL '1 month')::INT,
      LEAST(EXTRACT(DAY FROM a.proximo_vencimento)::INT, 28)
    ),
    'PENDING',
    'Mensalidade Lumied — ' || to_char(CURRENT_DATE + INTERVAL '1 month', 'MM/YYYY'),
    COALESCE(a.forma_pagamento, 'BOLETO')
  FROM saas_assinaturas a
  WHERE a.status = 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1 FROM saas_faturas f
       WHERE f.assinatura_id = a.id
         AND date_trunc('month', f.data_vencimento) = date_trunc('month', CURRENT_DATE + INTERVAL '1 month')
    )
  RETURNING saas_faturas.escola_id, saas_faturas.valor, saas_faturas.data_vencimento;
END $$ LANGUAGE plpgsql;

-- ── Agendamento cron (dia 25 de cada mês às 03:00 BRT → 06:00 UTC) ──
-- Gera as faturas com ~10 dias de antecedência para a edge function
-- ter tempo de emitir as cobranças no Inter antes do vencimento.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule('gerar-faturas-saas-mensal') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='gerar-faturas-saas-mensal');
    PERFORM cron.schedule('gerar-faturas-saas-mensal', '0 6 25 * *', $cron$ SELECT gerar_faturas_saas_mes(); $cron$);
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_cron schedule falhou (ok em dev): %', SQLERRM;
END $$;

COMMENT ON TABLE saas_clientes_inter IS 'Dados do pagador Inter (CPF/CNPJ, endereço) por escola.';
COMMENT ON FUNCTION gerar_faturas_saas_mes IS 'pg_cron mensal (dia 25) — cria faturas PENDING do próximo mês. Edge saas-billing-inter emite no Inter.';
