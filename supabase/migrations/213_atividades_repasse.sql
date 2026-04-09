-- 213: Valor de repasse por aluno nas atividades extras + contas a receber

-- Valor que cada atividade extra deve pagar à escola por aluno/mês
ALTER TABLE atividades ADD COLUMN IF NOT EXISTS valor_repasse_aluno numeric NOT NULL DEFAULT 0 CHECK (valor_repasse_aluno >= 0);

-- Contas a receber das atividades extras
CREATE TABLE IF NOT EXISTS atividades_contas_receber (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  atividade_id uuid NOT NULL REFERENCES atividades(id) ON DELETE CASCADE,
  atividade_nome text NOT NULL,
  mes_apuracao text NOT NULL,              -- "2026-04"
  qtd_alunos integer NOT NULL DEFAULT 0,
  valor_por_aluno numeric NOT NULL DEFAULT 0,
  valor_total numeric NOT NULL DEFAULT 0,  -- qtd_alunos × valor_por_aluno
  data_vencimento date NOT NULL,           -- dia 05 do mês seguinte
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'cancelado', 'atrasado')),
  data_pagamento date,
  observacao text,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(atividade_id, mes_apuracao)
);

CREATE INDEX IF NOT EXISTS idx_ativ_contas_mes ON atividades_contas_receber(mes_apuracao);
CREATE INDEX IF NOT EXISTS idx_ativ_contas_status ON atividades_contas_receber(status);
