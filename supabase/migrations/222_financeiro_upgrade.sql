-- ═══════════════════════════════════════════════════════
-- Migration 222: Financial Module Upgrade
-- Conciliação automática, boletos batch, inadimplência,
-- relatório mensal, folha de pagamento
-- ═══════════════════════════════════════════════════════

-- 1. Conciliação automática — log de execuções
CREATE TABLE IF NOT EXISTS fin_conciliacao_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid REFERENCES escolas(id),
  data_inicio date NOT NULL,
  data_fim date NOT NULL,
  total_transacoes integer DEFAULT 0,
  matched integer DEFAULT 0,
  created integer DEFAULT 0,
  pendente_revisao integer DEFAULT 0,
  status text DEFAULT 'sucesso' CHECK (status IN ('sucesso','erro','parcial')),
  erro text,
  executado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_conc_exec_escola ON fin_conciliacao_execucoes(escola_id);

-- 2. Boletos batch — lote pendente de aprovação
CREATE TABLE IF NOT EXISTS fin_boletos_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid REFERENCES escolas(id),
  mes_referencia text NOT NULL,
  total_boletos integer DEFAULT 0,
  valor_total numeric(15,2) DEFAULT 0,
  status text DEFAULT 'aguardando_aprovacao' CHECK (status IN ('aguardando_aprovacao','aprovado','emitido','parcial','rejeitado')),
  gerado_em timestamptz DEFAULT now(),
  aprovado_em timestamptz,
  aprovado_por text,
  emitido_em timestamptz,
  erro text
);
CREATE INDEX IF NOT EXISTS idx_fin_batch_escola ON fin_boletos_batch(escola_id, status);

-- 3. Boletos batch items — itens individuais por aluno
CREATE TABLE IF NOT EXISTS fin_boleto_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES fin_boletos_batch(id) ON DELETE CASCADE,
  aluno_id uuid,
  familia_email text,
  familia_nome text,
  crianca_nome text,
  cpf_pagador text,
  itens jsonb DEFAULT '[]',
  descricao_detalhada text,
  valor_total numeric(15,2) NOT NULL,
  vencimento date NOT NULL,
  status text DEFAULT 'aguardando' CHECK (status IN ('aguardando','aprovado','emitido','erro','cancelado')),
  nosso_numero text,
  codigo_barras text,
  linha_digitavel text,
  pix_copia_cola text,
  inter_response jsonb,
  erro text,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_batch_items_batch ON fin_boleto_batch_items(batch_id);

-- 4. Inadimplência — tracking por aluno
CREATE TABLE IF NOT EXISTS fin_inadimplencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid REFERENCES escolas(id),
  familia_email text NOT NULL,
  familia_nome text,
  crianca_nome text,
  dias_atraso integer NOT NULL,
  valor_total_devedor numeric(15,2) NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('7d','15d','28d')),
  mensalidades_ids uuid[] DEFAULT '{}',
  status text DEFAULT 'alerta' CHECK (status IN ('alerta','cobranca_extrajudicial','resolvido')),
  email_advogado_em timestamptz,
  resolvido_em timestamptz,
  resolvido_por text,
  atualizado_em timestamptz DEFAULT now(),
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_inadimpl_escola ON fin_inadimplencia(escola_id, status);
CREATE INDEX IF NOT EXISTS idx_fin_inadimpl_bucket ON fin_inadimplencia(bucket, status);

-- 5. Relatório mensal — log de envios
CREATE TABLE IF NOT EXISTS fin_relatorio_mensal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid REFERENCES escolas(id),
  mes text NOT NULL,
  receitas_total numeric(15,2) DEFAULT 0,
  despesas_total numeric(15,2) DEFAULT 0,
  resultado numeric(15,2) DEFAULT 0,
  dados jsonb DEFAULT '{}',
  sugestoes_ia text,
  enviado_para text,
  enviado_em timestamptz DEFAULT now()
);

-- 6. Folha de pagamento — uploads
CREATE TABLE IF NOT EXISTS fin_folha_upload (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid REFERENCES escolas(id),
  mes_referencia text,
  arquivo_url text,
  dados_parseados jsonb DEFAULT '[]',
  status text DEFAULT 'upload' CHECK (status IN ('upload','parsed','reviewed','downloaded')),
  criado_em timestamptz DEFAULT now(),
  criado_por text
);

-- 7. Alterações em tabelas existentes

-- fin_boletos_emitidos: batch_item_id + comprovante
DO $$ BEGIN
  ALTER TABLE fin_boletos_emitidos ADD COLUMN IF NOT EXISTS batch_item_id uuid REFERENCES fin_boleto_batch_items(id);
  ALTER TABLE fin_boletos_emitidos ADD COLUMN IF NOT EXISTS comprovante_url text;
EXCEPTION WHEN others THEN NULL;
END $$;

-- fin_mensalidades: link para batch item
DO $$ BEGIN
  ALTER TABLE fin_mensalidades ADD COLUMN IF NOT EXISTS boleto_batch_item_id uuid REFERENCES fin_boleto_batch_items(id);
EXCEPTION WHEN others THEN NULL;
END $$;

-- fin_extrato_bancario: escola_id + origem + tipos Inter
DO $$ BEGIN
  ALTER TABLE fin_extrato_bancario ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
  ALTER TABLE fin_extrato_bancario ADD COLUMN IF NOT EXISTS origem text DEFAULT 'manual';
  ALTER TABLE fin_extrato_bancario ADD COLUMN IF NOT EXISTS inter_tipo_operacao text;
  ALTER TABLE fin_extrato_bancario ADD COLUMN IF NOT EXISTS inter_tipo_transacao text;
EXCEPTION WHEN others THEN NULL;
END $$;

-- rh_funcionarios: tipo_conta (corrente/poupanca)
DO $$ BEGIN
  ALTER TABLE rh_funcionarios ADD COLUMN IF NOT EXISTS tipo_conta text DEFAULT 'corrente';
EXCEPTION WHEN others THEN NULL;
END $$;

-- 8. Config keys para escola_config (idempotent)
INSERT INTO escola_config (chave, valor, descricao, categoria)
VALUES
  ('email_advogado', '""'::jsonb, 'Email do advogado para cobrança extrajudicial', 'financeiro'),
  ('dia_vencimento_boleto', '"10"'::jsonb, 'Dia do vencimento dos boletos (padrão: 10)', 'financeiro')
ON CONFLICT (chave) DO NOTHING;

-- 9. pg_cron jobs
DO $$ BEGIN
  -- Conciliação diária (04h BRT = 07h UTC)
  PERFORM cron.schedule(
    'fin-conciliacao-diaria',
    '0 7 * * *',
    $$SELECT net.http_post(
      url := current_setting('app.settings.service_url') || '/functions/v1/financeiro-ext',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object('action', 'conciliacao_automatica', '_cron_key', current_setting('app.settings.cron_internal_key'))
    )$$
  );

  -- Boletos batch dia 28 (08h BRT = 11h UTC)
  PERFORM cron.schedule(
    'fin-boletos-dia28',
    '0 11 28 * *',
    $$SELECT net.http_post(
      url := current_setting('app.settings.service_url') || '/functions/v1/financeiro-ext',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object('action', 'boletos_gerar_batch', '_cron_key', current_setting('app.settings.cron_internal_key'))
    )$$
  );

  -- Inadimplência diária (09h BRT = 12h UTC)
  PERFORM cron.schedule(
    'fin-inadimplencia-diaria',
    '0 12 * * *',
    $$SELECT net.http_post(
      url := current_setting('app.settings.service_url') || '/functions/v1/financeiro-ext',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object('action', 'inadimplencia_verificar', '_cron_key', current_setting('app.settings.cron_internal_key'))
    )$$
  );

  -- Relatório mensal dia 1 (08h BRT = 11h UTC)
  PERFORM cron.schedule(
    'fin-relatorio-dia1',
    '0 11 1 * *',
    $$SELECT net.http_post(
      url := current_setting('app.settings.service_url') || '/functions/v1/financeiro-ext',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object('action', 'relatorio_mensal_enviar', '_cron_key', current_setting('app.settings.cron_internal_key'))
    )$$
  );
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_cron jobs skipped (cron extension may not be available): %', SQLERRM;
END $$;
