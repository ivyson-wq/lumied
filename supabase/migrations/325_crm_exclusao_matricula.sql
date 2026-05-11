-- 325: Workflow de exclusão de matrícula com aprovação do gerente
-- Secretaria solicita exclusão → gerente aprova/rejeita

CREATE TABLE IF NOT EXISTS crm_matricula_exclusoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  matricula_id uuid NOT NULL REFERENCES crm_matriculas(id) ON DELETE CASCADE,
  solicitado_por text NOT NULL,          -- email de quem solicitou
  solicitado_papel text NOT NULL DEFAULT 'secretaria', -- secretaria | gerente
  motivo text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','rejeitado')),
  aprovado_por text,                     -- email do gerente que aprovou/rejeitou
  observacao_resposta text,              -- nota do gerente ao aprovar/rejeitar
  criado_em timestamptz DEFAULT now(),
  respondido_em timestamptz,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE
);

CREATE INDEX idx_crm_mat_excl_escola ON crm_matricula_exclusoes(escola_id);
CREATE INDEX idx_crm_mat_excl_status ON crm_matricula_exclusoes(status, escola_id);
CREATE INDEX idx_crm_mat_excl_matricula ON crm_matricula_exclusoes(matricula_id);

-- Tenant isolation trigger
SELECT add_tenant_isolation('crm_matricula_exclusoes');

-- RLS
ALTER TABLE crm_matricula_exclusoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_mat_excl_tenant ON crm_matricula_exclusoes
  USING (escola_id = current_setting('app.escola_id', true)::uuid);
