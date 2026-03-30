-- =====================================================
-- 053: Pesquisas / Enquetes / Autorizações
-- =====================================================

CREATE TABLE IF NOT EXISTS pesquisas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo text NOT NULL,
  descricao text,
  tipo text NOT NULL DEFAULT 'enquete',   -- 'enquete','autorizacao','satisfacao'
  publico_alvo text DEFAULT 'todos',      -- 'todos','serie:Bear Care','turma:...'
  ativo boolean DEFAULT true,
  data_limite date,
  criado_por text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE pesquisas DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pesquisa_perguntas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pesquisa_id uuid NOT NULL REFERENCES pesquisas(id) ON DELETE CASCADE,
  texto text NOT NULL,
  tipo text NOT NULL DEFAULT 'texto',     -- 'texto','multipla','escala','sim_nao'
  opcoes jsonb DEFAULT '[]'::jsonb,       -- para tipo 'multipla': ["Opção A","Opção B","Opção C"]
  obrigatoria boolean DEFAULT true,
  ordem integer DEFAULT 0
);
ALTER TABLE pesquisa_perguntas DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pesquisa_respostas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pesquisa_id uuid NOT NULL REFERENCES pesquisas(id) ON DELETE CASCADE,
  pergunta_id uuid NOT NULL REFERENCES pesquisa_perguntas(id) ON DELETE CASCADE,
  respondido_por text NOT NULL,        -- email do responsável
  familia_id text,
  valor text,                           -- resposta do usuário
  respondido_em timestamptz DEFAULT now(),
  UNIQUE(pergunta_id, respondido_por)
);
ALTER TABLE pesquisa_respostas DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS autorizacoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pesquisa_id uuid NOT NULL REFERENCES pesquisas(id) ON DELETE CASCADE,
  familia_email text NOT NULL,
  aluno_nome text,
  autorizado boolean,
  assinatura_data timestamptz,
  ip text,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(pesquisa_id, familia_email)
);
ALTER TABLE autorizacoes DISABLE ROW LEVEL SECURITY;
