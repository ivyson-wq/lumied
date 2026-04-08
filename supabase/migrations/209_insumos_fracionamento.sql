-- ══════════════════════════════════════════════════════════
--  209 — Atualizar fracionamento de insumos comuns
--  Permite que professoras peçam unidades individuais (1 folha, 1 folha EVA)
--  em vez de pacotes/resmas inteiras.
--  preco_unitario = preco / qtd_por_embalagem
-- ══════════════════════════════════════════════════════════

-- Papel A4: resma de 500 folhas
UPDATE alm_insumos SET unidade = 'folha', unidade_compra = 'resma', qtd_por_embalagem = 500
WHERE LOWER(nome) LIKE '%folha a4%' OR LOWER(nome) LIKE '%papel a4%' OR LOWER(nome) LIKE '%a4 branca%';

-- Papel A3: resma de 500 folhas
UPDATE alm_insumos SET unidade = 'folha', unidade_compra = 'resma', qtd_por_embalagem = 500
WHERE LOWER(nome) LIKE '%folha a3%' OR LOWER(nome) LIKE '%papel a3%';

-- Papel Sulfite genérico
UPDATE alm_insumos SET unidade = 'folha', unidade_compra = 'resma', qtd_por_embalagem = 500
WHERE LOWER(nome) LIKE '%sulfite%' AND qtd_por_embalagem = 1;

-- Papel Cartolina: pacote de 100
UPDATE alm_insumos SET unidade = 'folha', unidade_compra = 'pacote', qtd_por_embalagem = 100
WHERE LOWER(nome) LIKE '%cartolina%' AND qtd_por_embalagem = 1;

-- Papel Color Set: pacote de 50
UPDATE alm_insumos SET unidade = 'folha', unidade_compra = 'pacote', qtd_por_embalagem = 50
WHERE LOWER(nome) LIKE '%color set%' AND qtd_por_embalagem = 1;

-- Papel Crepom: pacote de 10
UPDATE alm_insumos SET unidade = 'folha', unidade_compra = 'pacote', qtd_por_embalagem = 10
WHERE LOWER(nome) LIKE '%crepom%' AND qtd_por_embalagem = 1;

-- Papel Contact / Adesivo: rolo (metros)
UPDATE alm_insumos SET unidade = 'metro', unidade_compra = 'rolo', qtd_por_embalagem = 25
WHERE LOWER(nome) LIKE '%contact%' AND qtd_por_embalagem = 1;

-- EVA: pacote de 10 folhas
UPDATE alm_insumos SET unidade = 'folha', unidade_compra = 'pacote', qtd_por_embalagem = 10
WHERE LOWER(nome) LIKE '%eva%' AND qtd_por_embalagem = 1;

-- TNT: rolo de 50 metros
UPDATE alm_insumos SET unidade = 'metro', unidade_compra = 'rolo', qtd_por_embalagem = 50
WHERE LOWER(nome) LIKE '%tnt%' AND qtd_por_embalagem = 1;

-- Fita Crepe/Adesiva/Durex: rolo
UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'pacote', qtd_por_embalagem = 6
WHERE LOWER(nome) LIKE '%fita crepe%' AND qtd_por_embalagem = 1;

UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'pacote', qtd_por_embalagem = 6
WHERE LOWER(nome) LIKE '%fita adesiva%' AND qtd_por_embalagem = 1;

UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'pacote', qtd_por_embalagem = 12
WHERE LOWER(nome) LIKE '%durex%' AND qtd_por_embalagem = 1;

-- Cola bastão: pacote de 12
UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'pacote', qtd_por_embalagem = 12
WHERE LOWER(nome) LIKE '%cola bast%' AND qtd_por_embalagem = 1;

-- Cola branca: frasco (já unitário, apenas garantir)
UPDATE alm_insumos SET unidade = 'frasco', unidade_compra = 'caixa', qtd_por_embalagem = 12
WHERE LOWER(nome) LIKE '%cola branca%' AND qtd_por_embalagem = 1;

-- Lápis de cor / Lápis preto: caixa de 12
UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'caixa', qtd_por_embalagem = 12
WHERE LOWER(nome) LIKE '%lápis de cor%' AND qtd_por_embalagem = 1;

UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'caixa', qtd_por_embalagem = 12
WHERE LOWER(nome) LIKE '%lapis de cor%' AND qtd_por_embalagem = 1;

UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'caixa', qtd_por_embalagem = 72
WHERE LOWER(nome) LIKE '%lápis preto%' AND qtd_por_embalagem = 1;

UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'caixa', qtd_por_embalagem = 72
WHERE LOWER(nome) LIKE '%lapis preto%' AND qtd_por_embalagem = 1;

-- Caneta esferográfica: caixa de 50
UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'caixa', qtd_por_embalagem = 50
WHERE LOWER(nome) LIKE '%caneta esfer%' AND qtd_por_embalagem = 1;

-- Canetinha / Canetão: pacote de 12
UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'estojo', qtd_por_embalagem = 12
WHERE (LOWER(nome) LIKE '%canetinha%' OR LOWER(nome) LIKE '%canetão%' OR LOWER(nome) LIKE '%canetao%') AND qtd_por_embalagem = 1;

-- Giz de cera: caixa de 12
UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'caixa', qtd_por_embalagem = 12
WHERE LOWER(nome) LIKE '%giz de cera%' AND qtd_por_embalagem = 1;

-- Pincel / Pincel para pintura: já unitário
-- Tesoura: já unitária
-- Borracha: caixa de 40
UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'caixa', qtd_por_embalagem = 40
WHERE LOWER(nome) LIKE '%borracha%' AND qtd_por_embalagem = 1;

-- Apontador: caixa de 24
UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'caixa', qtd_por_embalagem = 24
WHERE LOWER(nome) LIKE '%apontador%' AND qtd_por_embalagem = 1;

-- Tinta guache: frasco (já unitário, pacote de 6)
UPDATE alm_insumos SET unidade = 'frasco', unidade_compra = 'caixa', qtd_por_embalagem = 6
WHERE LOWER(nome) LIKE '%guache%' AND qtd_por_embalagem = 1;

-- Barbante: rolo de 200m
UPDATE alm_insumos SET unidade = 'metro', unidade_compra = 'rolo', qtd_por_embalagem = 200
WHERE LOWER(nome) LIKE '%barbante%' AND qtd_por_embalagem = 1;

-- Elástico: pacote de 100
UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'pacote', qtd_por_embalagem = 100
WHERE LOWER(nome) LIKE '%elástico%' AND qtd_por_embalagem = 1;

-- Palito de churrasco/picolé: pacote de 100
UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'pacote', qtd_por_embalagem = 100
WHERE (LOWER(nome) LIKE '%palito%') AND qtd_por_embalagem = 1;

-- Clips/Grampos: caixa de 100/500
UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'caixa', qtd_por_embalagem = 100
WHERE LOWER(nome) LIKE '%clips%' AND qtd_por_embalagem = 1;

UPDATE alm_insumos SET unidade = 'unidade', unidade_compra = 'caixa', qtd_por_embalagem = 5000
WHERE LOWER(nome) LIKE '%grampo%' AND qtd_por_embalagem = 1;
