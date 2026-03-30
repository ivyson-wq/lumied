-- =====================================================
-- 069: Gestão de RH / Folha de Pagamento
-- =====================================================

CREATE TABLE IF NOT EXISTS rh_funcionarios (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id uuid,
  nome text NOT NULL,
  cpf text,
  rg text,
  email text,
  telefone text,
  cargo text,
  departamento text,                       -- 'pedagogico','administrativo','manutencao','cantina','transporte'
  tipo_contrato text DEFAULT 'clt',        -- 'clt','pj','estagio','temporario'
  data_admissao date,
  data_demissao date,
  salario_base numeric,
  carga_horaria integer DEFAULT 40,        -- horas semanais
  banco text,
  agencia text,
  conta text,
  pix text,
  status text DEFAULT 'ativo',             -- 'ativo','afastado','ferias','desligado'
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE rh_funcionarios DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS rh_ponto (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  funcionario_id uuid NOT NULL REFERENCES rh_funcionarios(id),
  tipo text NOT NULL,                      -- 'entrada','saida','inicio_intervalo','fim_intervalo'
  timestamp timestamptz DEFAULT now(),
  localizacao text,
  ip text,
  observacao text
);
ALTER TABLE rh_ponto DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS rh_ferias (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  funcionario_id uuid NOT NULL REFERENCES rh_funcionarios(id),
  periodo_aquisitivo_inicio date NOT NULL,
  periodo_aquisitivo_fim date NOT NULL,
  data_inicio date NOT NULL,
  data_fim date NOT NULL,
  dias integer NOT NULL,
  abono_pecuniario boolean DEFAULT false,
  status text DEFAULT 'solicitada',        -- 'solicitada','aprovada','em_gozo','concluida','cancelada'
  aprovado_por text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE rh_ferias DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS rh_holerites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  funcionario_id uuid NOT NULL REFERENCES rh_funcionarios(id),
  mes integer NOT NULL,
  ano integer NOT NULL,
  salario_bruto numeric NOT NULL,
  proventos jsonb DEFAULT '[]'::jsonb,     -- [{descricao, referencia, valor}]
  descontos jsonb DEFAULT '[]'::jsonb,     -- [{descricao, referencia, valor}]
  total_proventos numeric,
  total_descontos numeric,
  salario_liquido numeric,
  fgts numeric,
  inss numeric,
  irrf numeric,
  pdf_url text,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(funcionario_id, mes, ano)
);
ALTER TABLE rh_holerites DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS rh_folha_pagamento (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  mes integer NOT NULL,
  ano integer NOT NULL,
  status text DEFAULT 'aberta',            -- 'aberta','calculada','fechada','paga'
  total_funcionarios integer,
  total_bruto numeric,
  total_descontos numeric,
  total_liquido numeric,
  total_encargos numeric,
  gerado_em timestamptz,
  fechado_em timestamptz,
  UNIQUE(mes, ano)
);
ALTER TABLE rh_folha_pagamento DISABLE ROW LEVEL SECURITY;
