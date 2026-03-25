-- Adiciona campos de referência de preço para revisão manual
ALTER TABLE alm_insumos ADD COLUMN IF NOT EXISTS preco_referencia numeric;
ALTER TABLE alm_insumos ADD COLUMN IF NOT EXISTS referencia_nome text;
ALTER TABLE alm_insumos ADD COLUMN IF NOT EXISTS referencia_fonte text;
ALTER TABLE alm_insumos ADD COLUMN IF NOT EXISTS referencia_url text;
ALTER TABLE alm_insumos ADD COLUMN IF NOT EXISTS preco_atualizado_em timestamptz;
