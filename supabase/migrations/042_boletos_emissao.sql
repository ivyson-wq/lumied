-- Boletos emitidos pela escola
CREATE TABLE IF NOT EXISTS fin_boletos_emitidos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  mensalidade_id uuid REFERENCES fin_mensalidades(id),
  familia_email text,
  familia_nome text,
  crianca_nome text,
  cpf_pagador text,
  valor numeric NOT NULL,
  vencimento date NOT NULL,
  descricao text,
  -- Dados retornados pelo Inter
  nosso_numero text,
  codigo_barras text,
  linha_digitavel text,
  pix_copia_cola text,
  status text DEFAULT 'emitido' CHECK (status IN ('emitido','pago','vencido','cancelado')),
  inter_response jsonb,
  criado_em timestamptz DEFAULT now(),
  pago_em timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fin_boletos_status ON fin_boletos_emitidos(status);
ALTER TABLE fin_boletos_emitidos DISABLE ROW LEVEL SECURITY;

-- Notas fiscais emitidas
CREATE TABLE IF NOT EXISTS fin_notas_fiscais (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  boleto_id uuid REFERENCES fin_boletos_emitidos(id),
  mensalidade_id uuid REFERENCES fin_mensalidades(id),
  familia_email text,
  familia_nome text,
  cpf_cnpj_tomador text,
  valor numeric NOT NULL,
  descricao_servico text,
  numero_nf text,
  codigo_verificacao text,
  status text DEFAULT 'pendente' CHECK (status IN ('pendente','emitida','cancelada','erro')),
  pdf_url text,
  xml_url text,
  erro_msg text,
  criado_em timestamptz DEFAULT now()
);

ALTER TABLE fin_notas_fiscais DISABLE ROW LEVEL SECURITY;
