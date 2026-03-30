-- =====================================================
-- 074: RLS + Multi-tenancy (escola_id em tabelas de dados)
-- =====================================================

-- 1. Adicionar escola_id nas tabelas principais de dados
ALTER TABLE familias ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE professoras ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE secretarias ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE gerentes ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE series ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE alunos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE notas_disciplinas ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE notas_periodos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE notas_config ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE frequencia_config ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE pesquisas ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE chat_conversas ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE crm_estagios ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE crm_templates ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE fin_lancamentos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE fin_plano_contas ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE achados_perdidos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE biblioteca_acervo ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE transporte_rotas ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE rh_funcionarios ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE loja_produtos ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE ead_aulas ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE regua_config ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE bi_indicadores ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE contrato_templates ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE cantina_cardapio ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE pix_config ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);

-- 2. Indexes para escola_id
CREATE INDEX IF NOT EXISTS idx_familias_escola ON familias(escola_id);
CREATE INDEX IF NOT EXISTS idx_professoras_escola ON professoras(escola_id);
CREATE INDEX IF NOT EXISTS idx_series_escola ON series(escola_id);
CREATE INDEX IF NOT EXISTS idx_alunos_escola ON alunos(escola_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_escola ON crm_leads(escola_id);
CREATE INDEX IF NOT EXISTS idx_fin_lanc_escola ON fin_lancamentos(escola_id);
CREATE INDEX IF NOT EXISTS idx_notif_escola ON notificacoes(escola_id);

-- 3. Popular escola_id com a escola padrão (para dados existentes)
UPDATE familias SET escola_id = (SELECT id FROM escolas WHERE ativo = true ORDER BY criado_em LIMIT 1) WHERE escola_id IS NULL;
UPDATE professoras SET escola_id = (SELECT id FROM escolas WHERE ativo = true ORDER BY criado_em LIMIT 1) WHERE escola_id IS NULL;
UPDATE secretarias SET escola_id = (SELECT id FROM escolas WHERE ativo = true ORDER BY criado_em LIMIT 1) WHERE escola_id IS NULL;
UPDATE gerentes SET escola_id = (SELECT id FROM escolas WHERE ativo = true ORDER BY criado_em LIMIT 1) WHERE escola_id IS NULL;
UPDATE series SET escola_id = (SELECT id FROM escolas WHERE ativo = true ORDER BY criado_em LIMIT 1) WHERE escola_id IS NULL;
UPDATE alunos SET escola_id = (SELECT id FROM escolas WHERE ativo = true ORDER BY criado_em LIMIT 1) WHERE escola_id IS NULL;

-- 4. Habilitar RLS nas tabelas principais (com policy permissiva por enquanto)
-- As policies reais serão aplicadas quando o middleware de escola_id estiver no backend

ALTER TABLE familias ENABLE ROW LEVEL SECURITY;
CREATE POLICY familias_service_role ON familias FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE professoras ENABLE ROW LEVEL SECURITY;
CREATE POLICY professoras_service_role ON professoras FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE series ENABLE ROW LEVEL SECURITY;
CREATE POLICY series_service_role ON series FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE alunos ENABLE ROW LEVEL SECURITY;
CREATE POLICY alunos_service_role ON alunos FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE notas_lancamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY notas_lanc_service_role ON notas_lancamentos FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_leads_service_role ON crm_leads FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE fin_lancamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY fin_lanc_service_role ON fin_lancamentos FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY notif_service_role ON notificacoes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE chat_conversas ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_conv_service_role ON chat_conversas FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE pesquisas ENABLE ROW LEVEL SECURITY;
CREATE POLICY pesquisas_service_role ON pesquisas FOR ALL USING (true) WITH CHECK (true);
