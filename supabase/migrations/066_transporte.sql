-- =====================================================
-- 066: Transporte Escolar
-- =====================================================

CREATE TABLE IF NOT EXISTS transporte_rotas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  turno text,                              -- 'manha','tarde','integral'
  motorista_nome text,
  motorista_telefone text,
  motorista_cnh text,
  veiculo text,                            -- 'Van Sprinter','Micro-ônibus'
  placa text,
  capacidade integer DEFAULT 15,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE transporte_rotas DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS transporte_alunos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rota_id uuid NOT NULL REFERENCES transporte_rotas(id) ON DELETE CASCADE,
  aluno_email text NOT NULL,
  aluno_nome text NOT NULL,
  ponto_embarque text,                     -- endereço ou referência
  endereco text,
  ordem integer DEFAULT 0,                 -- ordem de parada
  ativo boolean DEFAULT true,
  UNIQUE(rota_id, aluno_email)
);
ALTER TABLE transporte_alunos DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS transporte_rastreio (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rota_id uuid NOT NULL REFERENCES transporte_rotas(id),
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  velocidade numeric,
  direcao numeric,
  timestamp timestamptz DEFAULT now()
);
ALTER TABLE transporte_rastreio DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_rastreio_rota ON transporte_rastreio(rota_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS transporte_notificacoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rota_id uuid REFERENCES transporte_rotas(id),
  aluno_email text,
  tipo text NOT NULL,                      -- 'partida','chegada_escola','saida_escola','chegada_casa','atraso'
  mensagem text,
  enviado boolean DEFAULT false,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE transporte_notificacoes DISABLE ROW LEVEL SECURITY;
