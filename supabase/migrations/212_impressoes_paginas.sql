-- 212: Adicionar num_paginas à tabela impressoes para contagem correta da cota
-- A cota agora é baseada em copias × num_paginas (total de folhas impressas)

ALTER TABLE impressoes ADD COLUMN IF NOT EXISTS num_paginas integer NOT NULL DEFAULT 1 CHECK (num_paginas > 0);

-- Atualizar registros existentes: assumir 1 página para manter retrocompatibilidade
UPDATE impressoes SET num_paginas = 1 WHERE num_paginas IS NULL;
