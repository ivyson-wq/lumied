-- Migration 014: Almoxarifado – Purchase tracking
-- Tracks which approved items have been forwarded for purchase and which were bought

CREATE TABLE IF NOT EXISTS alm_compras (
  id               uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  requisicao_id    uuid    NOT NULL REFERENCES alm_requisicoes(id) ON DELETE CASCADE,
  insumo_nome      text    NOT NULL,
  insumo_id        uuid    REFERENCES alm_insumos(id) ON DELETE SET NULL,
  qty              numeric NOT NULL DEFAULT 1,
  -- Platform data (best price found at time of approval)
  plataforma       text    NOT NULL,   -- 'Mercado Livre' | 'Shopee' | 'Amazon'
  produto_nome     text,               -- exact product title on platform
  preco_unit       numeric,            -- price per unit on platform (null if unknown)
  preco_total      numeric,            -- preco_unit * qty
  match_pct        integer,            -- similarity % between item name and product title
  url_produto      text,               -- direct product page link
  url_carrinho     text,               -- pre-filled cart/checkout link (ML only)
  -- Status
  status           text    NOT NULL DEFAULT 'pendente'
                             CHECK (status IN ('pendente', 'comprado', 'cancelado')),
  encaminhado_em   timestamptz DEFAULT now(),
  encaminhado_por  text,               -- gerente name
  comprado_em      timestamptz,
  comprado_por     text,
  nota             text
);

CREATE INDEX IF NOT EXISTS idx_alm_compras_req    ON alm_compras(requisicao_id);
CREATE INDEX IF NOT EXISTS idx_alm_compras_status ON alm_compras(status);
CREATE INDEX IF NOT EXISTS idx_alm_compras_data   ON alm_compras(encaminhado_em DESC);
