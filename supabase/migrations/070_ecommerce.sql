-- =====================================================
-- 070: E-commerce / Loja Virtual
-- =====================================================

CREATE TABLE IF NOT EXISTS loja_produtos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  descricao text,
  categoria text,                          -- 'uniforme','material','evento','livro'
  preco numeric NOT NULL,
  preco_promocional numeric,
  estoque integer DEFAULT 0,
  imagem_url text,
  imagens jsonb DEFAULT '[]'::jsonb,       -- URLs adicionais
  tamanhos jsonb DEFAULT '[]'::jsonb,      -- ["PP","P","M","G","GG"] para uniformes
  ativo boolean DEFAULT true,
  destaque boolean DEFAULT false,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE loja_produtos DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS loja_pedidos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  numero serial,
  familia_email text NOT NULL,
  familia_nome text,
  status text DEFAULT 'pendente',          -- 'pendente','pago','preparando','enviado','entregue','cancelado'
  subtotal numeric DEFAULT 0,
  desconto numeric DEFAULT 0,
  total numeric DEFAULT 0,
  metodo_pagamento text,                   -- 'pix','boleto','cartao'
  endereco_entrega text,
  observacoes text,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE loja_pedidos DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS loja_itens_pedido (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pedido_id uuid NOT NULL REFERENCES loja_pedidos(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES loja_produtos(id),
  quantidade integer NOT NULL DEFAULT 1,
  tamanho text,
  preco_unitario numeric NOT NULL,
  subtotal numeric NOT NULL
);
ALTER TABLE loja_itens_pedido DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS loja_pagamentos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pedido_id uuid NOT NULL REFERENCES loja_pedidos(id) ON DELETE CASCADE,
  metodo text NOT NULL,                    -- 'pix','boleto','cartao'
  valor numeric NOT NULL,
  status text DEFAULT 'pendente',          -- 'pendente','aprovado','recusado','estornado'
  gateway_id text,                         -- ID no gateway de pagamento
  pago_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE loja_pagamentos DISABLE ROW LEVEL SECURITY;
