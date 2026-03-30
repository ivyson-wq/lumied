-- =====================================================
-- 056: Matrícula / Rematrícula Online
-- =====================================================

-- Formulários de matrícula configuráveis
CREATE TABLE IF NOT EXISTS matricula_formularios (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ano integer NOT NULL,
  tipo text NOT NULL DEFAULT 'nova',     -- 'nova','rematricula'
  titulo text,
  campos jsonb DEFAULT '[]'::jsonb,      -- campos customizáveis [{nome,tipo,obrigatorio}]
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(ano, tipo)
);
ALTER TABLE matricula_formularios DISABLE ROW LEVEL SECURITY;

-- Documentos enviados com a matrícula
CREATE TABLE IF NOT EXISTS matricula_documentos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  matricula_id uuid REFERENCES crm_matriculas(id) ON DELETE CASCADE,
  tipo text NOT NULL,                    -- 'rg','cpf','comprovante_residencia','certidao_nascimento','historico','foto'
  nome_arquivo text,
  arquivo_url text NOT NULL,
  validado boolean DEFAULT false,
  validado_por text,
  validado_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE matricula_documentos DISABLE ROW LEVEL SECURITY;

-- Contratos gerados para matrículas
CREATE TABLE IF NOT EXISTS matricula_contratos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  matricula_id uuid REFERENCES crm_matriculas(id) ON DELETE CASCADE,
  template_html text,
  dados_json jsonb,
  status text DEFAULT 'rascunho',        -- 'rascunho','enviado','assinado','cancelado'
  assinado_em timestamptz,
  assinatura_ip text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE matricula_contratos DISABLE ROW LEVEL SECURITY;

-- Seed: formulário padrão
INSERT INTO matricula_formularios (ano, tipo, titulo, campos) VALUES
(2026, 'nova', 'Matrícula 2026', '[
  {"nome":"nome_crianca","tipo":"texto","obrigatorio":true,"label":"Nome completo da criança"},
  {"nome":"data_nascimento","tipo":"data","obrigatorio":true,"label":"Data de nascimento"},
  {"nome":"serie_pretendida","tipo":"select","obrigatorio":true,"label":"Série pretendida"},
  {"nome":"nome_responsavel","tipo":"texto","obrigatorio":true,"label":"Nome do responsável"},
  {"nome":"cpf_responsavel","tipo":"texto","obrigatorio":true,"label":"CPF do responsável"},
  {"nome":"email","tipo":"email","obrigatorio":true,"label":"Email"},
  {"nome":"telefone","tipo":"telefone","obrigatorio":true,"label":"Telefone/WhatsApp"},
  {"nome":"endereco","tipo":"texto","obrigatorio":false,"label":"Endereço"},
  {"nome":"escola_anterior","tipo":"texto","obrigatorio":false,"label":"Escola anterior"},
  {"nome":"observacoes","tipo":"textarea","obrigatorio":false,"label":"Observações"}
]'::jsonb),
(2026, 'rematricula', 'Rematrícula 2026', '[
  {"nome":"confirma_dados","tipo":"sim_nao","obrigatorio":true,"label":"Confirmo que os dados cadastrados estão corretos"},
  {"nome":"serie_proxima","tipo":"select","obrigatorio":true,"label":"Série para 2026"},
  {"nome":"turno_preferencia","tipo":"select","obrigatorio":false,"label":"Preferência de turno"},
  {"nome":"observacoes","tipo":"textarea","obrigatorio":false,"label":"Observações"}
]'::jsonb)
ON CONFLICT (ano, tipo) DO NOTHING;
