-- =====================================================
-- 062: PIX Integrado (conciliação automática)
-- =====================================================

CREATE TABLE IF NOT EXISTS pix_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  chave_pix text NOT NULL,
  tipo_chave text DEFAULT 'cnpj',          -- 'cpf','cnpj','email','telefone','aleatoria'
  nome_beneficiario text,
  cidade text DEFAULT 'Caxias do Sul',
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE pix_config DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pix_cobrancas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  boleto_id uuid,                          -- referência ao boleto original (se houver)
  mensalidade_id uuid,
  txid text UNIQUE,                        -- ID da transação PIX
  qr_code_payload text,                    -- Payload do QR Code (Copia e Cola)
  qr_code_base64 text,                     -- Imagem QR em base64
  valor numeric NOT NULL,
  descricao text,
  familia_email text,
  status text DEFAULT 'ativa',             -- 'ativa','paga','expirada','cancelada'
  pago_em timestamptz,
  pago_valor numeric,
  e2e_id text,                             -- End-to-end ID do pagamento
  criado_em timestamptz DEFAULT now(),
  expira_em timestamptz
);
ALTER TABLE pix_cobrancas DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pix_txid ON pix_cobrancas(txid);
CREATE INDEX IF NOT EXISTS idx_pix_status ON pix_cobrancas(status) WHERE status = 'ativa';
