-- Contas patrimoniais para Balanco Patrimonial
ALTER TABLE fin_plano_contas DROP CONSTRAINT IF EXISTS fin_plano_contas_tipo_check;
ALTER TABLE fin_plano_contas ADD CONSTRAINT fin_plano_contas_tipo_check
  CHECK (tipo IN ('receita','despesa','ativo','passivo','patrimonio'));

-- Seed contas patrimoniais
INSERT INTO fin_plano_contas (codigo, nome, tipo) VALUES
  ('3', 'Ativo', 'ativo'),
  ('3.1', 'Caixa e Bancos', 'ativo'),
  ('3.2', 'Contas a Receber', 'ativo'),
  ('3.3', 'Estoques', 'ativo'),
  ('3.4', 'Imobilizado', 'ativo'),
  ('3.5', 'Outros Ativos', 'ativo'),
  ('4', 'Passivo', 'passivo'),
  ('4.1', 'Fornecedores', 'passivo'),
  ('4.2', 'Obrigacoes Trabalhistas', 'passivo'),
  ('4.3', 'Obrigacoes Fiscais', 'passivo'),
  ('4.4', 'Emprestimos', 'passivo'),
  ('4.5', 'Outros Passivos', 'passivo'),
  ('5', 'Patrimonio Liquido', 'patrimonio'),
  ('5.1', 'Capital Social', 'patrimonio'),
  ('5.2', 'Reservas', 'patrimonio'),
  ('5.3', 'Lucros/Prejuizos Acumulados', 'patrimonio')
ON CONFLICT DO NOTHING;

-- Conciliacao bancaria
CREATE TABLE IF NOT EXISTS fin_extrato_bancario (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  data_transacao date NOT NULL,
  descricao text NOT NULL,
  valor numeric NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('credito','debito')),
  saldo numeric,
  lancamento_id uuid REFERENCES fin_lancamentos(id),
  conciliado boolean DEFAULT false,
  banco text,
  importado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_extrato_data ON fin_extrato_bancario(data_transacao);
ALTER TABLE fin_extrato_bancario DISABLE ROW LEVEL SECURITY;

-- Saldos patrimoniais (para balanco)
CREATE TABLE IF NOT EXISTS fin_saldos_patrimoniais (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES fin_plano_contas(id),
  mes text NOT NULL,
  saldo numeric NOT NULL DEFAULT 0,
  UNIQUE(conta_id, mes)
);

ALTER TABLE fin_saldos_patrimoniais DISABLE ROW LEVEL SECURITY;
