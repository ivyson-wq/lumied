-- Novos papeis de usuario
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_papel_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_papel_check
  CHECK (papel IN ('gerente','diretor','financeiro','professora','professora_assistente','secretaria','manutencao'));

-- Permissoes por papel (quais modulos cada papel acessa)
CREATE TABLE IF NOT EXISTS permissoes_papel (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  papel text NOT NULL,
  modulo text NOT NULL,
  pode_ver boolean DEFAULT true,
  pode_editar boolean DEFAULT false,
  UNIQUE(papel, modulo)
);

ALTER TABLE permissoes_papel DISABLE ROW LEVEL SECURITY;

-- Permissoes padrao
INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  -- Gerente: acesso total
  ('gerente', 'dashboard', true, true), ('gerente', 'turnos', true, true),
  ('gerente', 'atividades', true, true), ('gerente', 'diplomas', true, true),
  ('gerente', 'atestados', true, true), ('gerente', 'pdi', true, true),
  ('gerente', 'almoxarifado', true, true), ('gerente', 'impressoes', true, true),
  ('gerente', 'manutencao', true, true), ('gerente', 'emergencia', true, true),
  ('gerente', 'achados', true, true), ('gerente', 'calendario', true, true),
  ('gerente', 'equipe', true, true), ('gerente', 'familias', true, true),
  ('gerente', 'financeiro', true, true), ('gerente', 'configuracoes', true, true),
  -- Diretor: acesso total (igual gerente)
  ('diretor', 'dashboard', true, true), ('diretor', 'turnos', true, true),
  ('diretor', 'atividades', true, true), ('diretor', 'diplomas', true, true),
  ('diretor', 'atestados', true, true), ('diretor', 'pdi', true, true),
  ('diretor', 'almoxarifado', true, true), ('diretor', 'impressoes', true, true),
  ('diretor', 'manutencao', true, true), ('diretor', 'emergencia', true, true),
  ('diretor', 'achados', true, true), ('diretor', 'calendario', true, true),
  ('diretor', 'equipe', true, true), ('diretor', 'familias', true, true),
  ('diretor', 'financeiro', true, true), ('diretor', 'configuracoes', true, true),
  -- Financeiro: financeiro + dashboard + familias
  ('financeiro', 'dashboard', true, false), ('financeiro', 'financeiro', true, true),
  ('financeiro', 'familias', true, false), ('financeiro', 'turnos', true, false),
  ('financeiro', 'atividades', true, false)
ON CONFLICT (papel, modulo) DO NOTHING;

-- Plano de Contas
CREATE TABLE IF NOT EXISTS fin_plano_contas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo text,
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('receita','despesa')),
  categoria_pai uuid REFERENCES fin_plano_contas(id),
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);

ALTER TABLE fin_plano_contas DISABLE ROW LEVEL SECURITY;

-- Seed plano de contas
INSERT INTO fin_plano_contas (codigo, nome, tipo) VALUES
  ('1', 'Receitas', 'receita'),
  ('1.1', 'Mensalidades', 'receita'),
  ('1.2', 'Atividades Extracurriculares', 'receita'),
  ('1.3', 'Material Didatico', 'receita'),
  ('1.4', 'Matriculas', 'receita'),
  ('1.5', 'Eventos', 'receita'),
  ('1.6', 'Outras Receitas', 'receita'),
  ('2', 'Despesas', 'despesa'),
  ('2.1', 'Folha de Pagamento', 'despesa'),
  ('2.2', 'Encargos Trabalhistas', 'despesa'),
  ('2.3', 'Aluguel e Condominio', 'despesa'),
  ('2.4', 'Energia e Agua', 'despesa'),
  ('2.5', 'Material de Escritorio', 'despesa'),
  ('2.6', 'Material Didatico', 'despesa'),
  ('2.7', 'Alimentacao', 'despesa'),
  ('2.8', 'Manutencao e Reparos', 'despesa'),
  ('2.9', 'Marketing', 'despesa'),
  ('2.10', 'Impostos e Taxas', 'despesa'),
  ('2.11', 'Outras Despesas', 'despesa')
ON CONFLICT DO NOTHING;

-- Lancamentos Financeiros
CREATE TABLE IF NOT EXISTS fin_lancamentos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo text NOT NULL CHECK (tipo IN ('receita','despesa')),
  conta_id uuid REFERENCES fin_plano_contas(id),
  descricao text NOT NULL,
  valor numeric NOT NULL CHECK (valor > 0),
  data_lancamento date NOT NULL,
  data_vencimento date,
  data_pagamento date,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','pago','cancelado','atrasado')),
  fornecedor text,
  familia_email text,
  familia_nome text,
  comprovante_url text,
  observacao text,
  criado_por text,
  criado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_lanc_tipo ON fin_lancamentos(tipo, status);
CREATE INDEX IF NOT EXISTS idx_fin_lanc_data ON fin_lancamentos(data_lancamento);
ALTER TABLE fin_lancamentos DISABLE ROW LEVEL SECURITY;

-- Mensalidades geradas
CREATE TABLE IF NOT EXISTS fin_mensalidades (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  familia_email text NOT NULL,
  familia_nome text,
  crianca_nome text,
  serie text,
  turno text,
  valor_turno numeric NOT NULL DEFAULT 0,
  valor_atividades numeric NOT NULL DEFAULT 0,
  valor_total numeric NOT NULL DEFAULT 0,
  mes text NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','pago','atrasado','cancelado')),
  data_vencimento date,
  data_pagamento date,
  observacao text,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(familia_email, crianca_nome, mes)
);

CREATE INDEX IF NOT EXISTS idx_fin_mens_mes ON fin_mensalidades(mes, status);
ALTER TABLE fin_mensalidades DISABLE ROW LEVEL SECURITY;
