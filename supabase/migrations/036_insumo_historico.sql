-- Historico de atualizacoes de preco dos insumos
CREATE TABLE IF NOT EXISTS alm_insumo_historico (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  insumo_id uuid NOT NULL REFERENCES alm_insumos(id) ON DELETE CASCADE,
  preco_anterior numeric,
  preco_novo numeric,
  unidade_compra_anterior text,
  unidade_compra_nova text,
  qtd_emb_anterior numeric,
  qtd_emb_nova numeric,
  produto_encontrado text,
  fonte text,
  url text,
  match_pct integer,
  criado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insumo_hist ON alm_insumo_historico(insumo_id);
ALTER TABLE alm_insumo_historico DISABLE ROW LEVEL SECURITY;
