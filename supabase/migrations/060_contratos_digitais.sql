-- =====================================================
-- 060: Contratos Digitais + Assinatura Eletrônica
-- =====================================================

CREATE TABLE IF NOT EXISTS contrato_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  tipo text DEFAULT 'matricula',          -- 'matricula','rematricula','servicos'
  html_template text NOT NULL,
  variaveis jsonb DEFAULT '[]'::jsonb,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE contrato_templates DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS contratos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  matricula_id uuid REFERENCES crm_matriculas(id),
  familia_email text NOT NULL,
  familia_nome text,
  template_id uuid REFERENCES contrato_templates(id),
  dados_preenchidos jsonb DEFAULT '{}'::jsonb,
  html_renderizado text,
  status text DEFAULT 'rascunho',          -- 'rascunho','enviado','visualizado','assinado','cancelado'
  enviado_em timestamptz,
  visualizado_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE contratos DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS contrato_assinaturas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contrato_id uuid NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'responsavel', -- 'responsavel','escola','testemunha'
  nome_signatario text,
  assinatura_base64 text,                   -- Canvas signature data
  ip text,
  user_agent text,
  assinado_em timestamptz DEFAULT now()
);
ALTER TABLE contrato_assinaturas DISABLE ROW LEVEL SECURITY;
