-- Campo turma_destino: turma selecionada por quem imprime para entrega correta
ALTER TABLE impressoes ADD COLUMN IF NOT EXISTS turma_destino text;
ALTER TABLE impressoes ADD COLUMN IF NOT EXISTS num_paginas integer;
