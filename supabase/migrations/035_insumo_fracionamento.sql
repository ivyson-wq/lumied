-- Fracionamento de insumos: unidade de compra vs unidade de consumo
ALTER TABLE alm_insumos ADD COLUMN IF NOT EXISTS unidade_compra text;
ALTER TABLE alm_insumos ADD COLUMN IF NOT EXISTS qtd_por_embalagem numeric DEFAULT 1 CHECK (qtd_por_embalagem > 0);
-- unidade existente passa a ser a unidade de CONSUMO (o que a professora pede)
-- unidade_compra é como o item é comprado (ex: caixa, pacote, resma)
-- preco é o preco da EMBALAGEM (compra)
-- preco por unidade de consumo = preco / qtd_por_embalagem
