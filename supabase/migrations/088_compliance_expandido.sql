-- =====================================================
-- 088: Compliance Expandido — Melhores Práticas Internacionais
-- Proteção ao aluno, certificações, inspeções, políticas,
-- calendário regulatório, anti-bullying, auditoria
-- =====================================================

-- ═══════════════════════════════════════════════════════
-- 1. PROTEÇÃO AO ALUNO / SAFEGUARDING
-- ═══════════════════════════════════════════════════════

-- Incidentes de segurança e proteção ao aluno
CREATE TABLE IF NOT EXISTS compliance_incidentes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo text NOT NULL,                       -- 'bullying','cyberbullying','assedio','discriminacao','violencia','acidente','saude','outro'
  gravidade text DEFAULT 'media',           -- 'baixa','media','alta','critica'
  descricao text NOT NULL,
  data_ocorrencia date NOT NULL,
  local_ocorrencia text,                    -- 'sala_aula','patio','refeitorio','transporte','online','outro'
  -- Envolvidos
  aluno_vitima_id uuid,
  aluno_agressor_id uuid,
  vitima_nome text,
  agressor_nome text,
  testemunhas text,
  -- Registro
  registrado_por text NOT NULL,
  registrado_por_tipo text,                 -- 'professora','gerente','secretaria','pai','aluno','anonimo'
  anonimo boolean DEFAULT false,
  -- Tratamento
  status text DEFAULT 'registrado',         -- 'registrado','em_investigacao','medidas_aplicadas','resolvido','encaminhado_externo','arquivado'
  investigador text,
  medidas_tomadas text,
  encaminhamento_externo text,              -- 'conselho_tutelar','policia','ministerio_publico','nenhum'
  parecer_final text,
  -- Notificações
  pais_notificados boolean DEFAULT false,
  pais_notificados_em timestamptz,
  conselho_notificado boolean DEFAULT false,
  -- Metadata
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_incidentes DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_comp_incidentes_tipo ON compliance_incidentes(tipo, status);
CREATE INDEX idx_comp_incidentes_data ON compliance_incidentes(data_ocorrencia);

-- Histórico de ações em cada incidente
CREATE TABLE IF NOT EXISTS compliance_incidentes_historico (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  incidente_id uuid NOT NULL REFERENCES compliance_incidentes(id) ON DELETE CASCADE,
  acao text NOT NULL,                       -- 'criado','investigacao_iniciada','medida_aplicada','pais_notificados','encaminhado','resolvido','reaberto'
  descricao text,
  realizado_por text NOT NULL,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_incidentes_historico DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════
-- 2. CERTIFICAÇÕES E TREINAMENTOS OBRIGATÓRIOS
-- ═══════════════════════════════════════════════════════

-- Tipos de certificação/treinamento que a escola exige
CREATE TABLE IF NOT EXISTS compliance_certificacoes_tipos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,                       -- 'Primeiros Socorros','LGPD','Anti-bullying','Combate a Incêndio','BNCC','Inclusão'
  descricao text,
  obrigatorio boolean DEFAULT true,
  aplica_a text DEFAULT 'todos',            -- 'todos','professoras','administrativo','gestao'
  validade_meses integer,                   -- null = sem validade, 12 = renovar anualmente
  carga_horaria_minima integer,             -- horas mínimas
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_certificacoes_tipos DISABLE ROW LEVEL SECURITY;

-- Certificações por funcionário
CREATE TABLE IF NOT EXISTS compliance_certificacoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  funcionario_id uuid NOT NULL REFERENCES rh_funcionarios(id) ON DELETE CASCADE,
  tipo_id uuid NOT NULL REFERENCES compliance_certificacoes_tipos(id),
  data_obtencao date NOT NULL,
  data_vencimento date,                     -- calculada se tipo tem validade
  instituicao text,                         -- onde obteve
  numero_certificado text,
  arquivo_url text,                         -- comprovante digitalizado
  status text DEFAULT 'valida',             -- 'valida','vencida','pendente','revogada'
  observacoes text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_certificacoes DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_comp_cert_func ON compliance_certificacoes(funcionario_id);
CREATE INDEX idx_comp_cert_venc ON compliance_certificacoes(data_vencimento);

-- Treinamentos programados
CREATE TABLE IF NOT EXISTS compliance_treinamentos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo_id uuid NOT NULL REFERENCES compliance_certificacoes_tipos(id),
  titulo text NOT NULL,
  descricao text,
  data_prevista date NOT NULL,
  hora_inicio time,
  hora_fim time,
  local text,
  instrutor text,
  max_participantes integer,
  status text DEFAULT 'agendado',           -- 'agendado','em_andamento','concluido','cancelado'
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_treinamentos DISABLE ROW LEVEL SECURITY;

-- Presença em treinamentos
CREATE TABLE IF NOT EXISTS compliance_treinamentos_presenca (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  treinamento_id uuid NOT NULL REFERENCES compliance_treinamentos(id) ON DELETE CASCADE,
  funcionario_id uuid NOT NULL REFERENCES rh_funcionarios(id),
  presente boolean DEFAULT false,
  nota_avaliacao numeric,
  certificacao_gerada boolean DEFAULT false,
  UNIQUE(treinamento_id, funcionario_id)
);
ALTER TABLE compliance_treinamentos_presenca DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════
-- 3. INSPEÇÕES DE SAÚDE, HIGIENE E INFRAESTRUTURA
-- ═══════════════════════════════════════════════════════

-- Templates de checklist de inspeção
CREATE TABLE IF NOT EXISTS compliance_inspecao_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,                       -- 'Inspeção Diária Cantina','Inspeção Mensal Instalações','Vistoria Playground'
  categoria text NOT NULL,                  -- 'higiene','infraestrutura','seguranca','cantina','playground','transporte'
  itens jsonb NOT NULL DEFAULT '[]',        -- [{item, obrigatorio, tipo:'sim_nao'|'nota_1_5'|'texto'}]
  frequencia text DEFAULT 'mensal',         -- 'diaria','semanal','mensal','trimestral','semestral','anual'
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_inspecao_templates DISABLE ROW LEVEL SECURITY;

-- Inspeções realizadas
CREATE TABLE IF NOT EXISTS compliance_inspecoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES compliance_inspecao_templates(id),
  data_inspecao date NOT NULL,
  inspetor text NOT NULL,
  respostas jsonb NOT NULL DEFAULT '[]',    -- [{item, resposta, observacao, foto_url}]
  nota_geral numeric,                       -- score calculado
  conformidade_pct numeric,                 -- % de itens conformes
  pendencias_criticas integer DEFAULT 0,
  status text DEFAULT 'concluida',          -- 'concluida','pendencias','reprovada'
  observacoes text,
  proxima_inspecao date,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_inspecoes DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_comp_inspecoes_data ON compliance_inspecoes(data_inspecao);

-- ═══════════════════════════════════════════════════════
-- 4. POLÍTICAS E DOCUMENTOS (REPOSITÓRIO)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_politicas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo text NOT NULL,                     -- 'Política Anti-Bullying','Código de Conduta','Política de Privacidade'
  categoria text NOT NULL,                  -- 'conduta','privacidade','seguranca','pedagogico','rh','financeiro','saude'
  versao text DEFAULT '1.0',
  conteudo_html text,                       -- conteúdo da política
  arquivo_url text,                         -- PDF se preferir
  aceite_obrigatorio boolean DEFAULT false, -- se funcionários devem assinar
  aplica_a text DEFAULT 'todos',            -- 'todos','professoras','administrativo','pais','alunos'
  vigente_desde date,
  revisao_proxima date,
  status text DEFAULT 'vigente',            -- 'rascunho','vigente','revogada','em_revisao'
  criado_por text,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_politicas DISABLE ROW LEVEL SECURITY;

-- Aceites de políticas
CREATE TABLE IF NOT EXISTS compliance_politicas_aceites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  politica_id uuid NOT NULL REFERENCES compliance_politicas(id) ON DELETE CASCADE,
  funcionario_id uuid REFERENCES rh_funcionarios(id),
  nome_signatario text NOT NULL,
  email_signatario text NOT NULL,
  tipo_signatario text,                     -- 'funcionario','professor','pai','aluno'
  ip_assinatura text,
  aceito_em timestamptz DEFAULT now(),
  UNIQUE(politica_id, email_signatario)
);
ALTER TABLE compliance_politicas_aceites DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════
-- 5. CALENDÁRIO DE COMPLIANCE (PRAZOS REGULATÓRIOS)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_calendario (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  titulo text NOT NULL,
  descricao text,
  categoria text NOT NULL,                  -- 'trabalhista','fiscal','pedagogico','mec','lgpd','saude','seguranca'
  data_limite date NOT NULL,
  recorrencia text,                         -- 'unica','mensal','trimestral','semestral','anual'
  responsavel text,
  status text DEFAULT 'pendente',           -- 'pendente','em_andamento','concluido','atrasado'
  prioridade text DEFAULT 'normal',         -- 'baixa','normal','alta','critica'
  dias_alerta_antes integer DEFAULT 30,     -- quando alertar
  alerta_enviado boolean DEFAULT false,
  concluido_em timestamptz,
  concluido_por text,
  evidencia_url text,                       -- comprovante de cumprimento
  observacoes text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_calendario DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_comp_cal_data ON compliance_calendario(data_limite, status);

-- ═══════════════════════════════════════════════════════
-- 6. AUDITORIA FINANCEIRA — TRILHA DE AUDITORIA
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_audit_trail (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tabela text NOT NULL,                     -- tabela afetada
  registro_id text NOT NULL,                -- ID do registro
  acao text NOT NULL,                       -- 'insert','update','delete'
  dados_anteriores jsonb,
  dados_novos jsonb,
  usuario text NOT NULL,
  ip text,
  motivo text,                              -- justificativa para alteração sensível
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE compliance_audit_trail DISABLE ROW LEVEL SECURITY;

CREATE INDEX idx_comp_audit_tabela ON compliance_audit_trail(tabela, criado_em);

-- ═══════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════

CREATE TRIGGER compliance_incidentes_atualizado
  BEFORE UPDATE ON compliance_incidentes
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();

CREATE TRIGGER compliance_politicas_atualizado
  BEFORE UPDATE ON compliance_politicas
  FOR EACH ROW EXECUTE FUNCTION trigger_set_atualizado_em();

-- ═══════════════════════════════════════════════════════
-- DADOS INICIAIS
-- ═══════════════════════════════════════════════════════

-- Tipos de certificação padrão
INSERT INTO compliance_certificacoes_tipos (nome, descricao, obrigatorio, aplica_a, validade_meses, carga_horaria_minima) VALUES
('Primeiros Socorros', 'Curso de primeiros socorros e suporte básico de vida', true, 'todos', 24, 8),
('LGPD — Proteção de Dados', 'Treinamento sobre Lei Geral de Proteção de Dados aplicada à educação', true, 'todos', 12, 4),
('Anti-Bullying e Convivência', 'Prevenção e combate ao bullying e cyberbullying escolar', true, 'professoras', 12, 4),
('Prevenção e Combate a Incêndio', 'Brigadista e uso de extintores', true, 'todos', 24, 8),
('BNCC e Práticas Pedagógicas', 'Atualização sobre Base Nacional Comum Curricular', true, 'professoras', 12, 8),
('Educação Inclusiva', 'Atendimento a alunos com necessidades especiais', true, 'professoras', 24, 8),
('Segurança Alimentar (Cantina)', 'Boas práticas de manipulação de alimentos', true, 'administrativo', 12, 4),
('Direção Defensiva (Transporte)', 'Direção defensiva para motoristas de transporte escolar', true, 'administrativo', 12, 8)
ON CONFLICT DO NOTHING;

-- Templates de inspeção padrão
INSERT INTO compliance_inspecao_templates (nome, categoria, frequencia, itens) VALUES
('Inspeção Diária — Cantina', 'cantina', 'diaria', '[
  {"item":"Temperatura da geladeira dentro do padrão (0-5°C)","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Alimentos armazenados com etiqueta de validade","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Superfícies de preparo limpas e higienizadas","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Funcionários com touca, luvas e avental","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Lixeiras com tampa e pedal funcionando","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Piso limpo e seco","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Observações gerais","obrigatorio":false,"tipo":"texto"}
]'::jsonb),
('Inspeção Mensal — Instalações', 'infraestrutura', 'mensal', '[
  {"item":"Extintores de incêndio dentro da validade","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Saídas de emergência desobstruídas e sinalizadas","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Iluminação de emergência funcionando","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Playground sem peças soltas ou quebradas","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Banheiros limpos e abastecidos (papel, sabonete)","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Câmeras de segurança operacionais","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Portões e cercas em bom estado","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Pisos sem desnível ou buracos","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Estado geral da pintura e paredes","obrigatorio":false,"tipo":"nota_1_5"},
  {"item":"Observações e fotos","obrigatorio":false,"tipo":"texto"}
]'::jsonb),
('Vistoria Semanal — Transporte Escolar', 'transporte', 'semanal', '[
  {"item":"Cintos de segurança funcionando em todos os assentos","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Documentação do veículo em dia (CRLV, seguro)","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Motorista com CNH categoria D e curso de transporte escolar","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Kit de primeiros socorros presente e completo","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Extintores de incêndio dentro da validade","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Sinalização de transporte escolar visível","obrigatorio":true,"tipo":"sim_nao"},
  {"item":"Observações","obrigatorio":false,"tipo":"texto"}
]'::jsonb)
ON CONFLICT DO NOTHING;

-- Calendário regulatório padrão (ano 2026)
INSERT INTO compliance_calendario (titulo, descricao, categoria, data_limite, recorrencia, prioridade, dias_alerta_antes) VALUES
('RAIS — Relação Anual de Informações Sociais', 'Entrega da RAIS ao Ministério do Trabalho', 'trabalhista', '2026-04-17', 'anual', 'alta', 30),
('eSocial — Folha de Pagamento Mensal', 'Envio do eSocial com eventos de folha', 'trabalhista', '2026-04-07', 'mensal', 'alta', 5),
('FGTS Digital — Recolhimento Mensal', 'Recolhimento do FGTS até o dia 20', 'fiscal', '2026-04-20', 'mensal', 'alta', 5),
('INSS Patronal — Recolhimento', 'GPS/DARF de INSS patronal', 'fiscal', '2026-04-20', 'mensal', 'alta', 5),
('IRRF — Retenção na Fonte', 'Recolhimento de IRRF sobre folha', 'fiscal', '2026-04-20', 'mensal', 'normal', 5),
('Censo Escolar — Coleta', 'Preenchimento do Censo Escolar (INEP/MEC)', 'mec', '2026-06-30', 'anual', 'critica', 60),
('Projeto Político Pedagógico — Revisão', 'Revisão anual do PPP conforme LDB art. 12', 'pedagogico', '2026-02-28', 'anual', 'alta', 45),
('Alvará Sanitário — Renovação', 'Renovação do alvará da vigilância sanitária', 'saude', '2026-03-31', 'anual', 'alta', 60),
('Alvará de Funcionamento — Renovação', 'Renovação do alvará de funcionamento junto à prefeitura', 'seguranca', '2026-01-31', 'anual', 'alta', 60),
('AVCB — Auto de Vistoria do Corpo de Bombeiros', 'Renovação ou revalidação do AVCB', 'seguranca', '2026-06-30', 'anual', 'critica', 90),
('Revisão LGPD — Relatório de Impacto (RIPD)', 'Elaborar/atualizar o Relatório de Impacto à Proteção de Dados', 'lgpd', '2026-03-31', 'anual', 'alta', 45),
('Simulação de Evacuação', 'Simulação de evacuação de emergência conforme legislação', 'seguranca', '2026-06-15', 'semestral', 'alta', 30),
('Capacitação Obrigatória — CIPA/SIPAT', 'Semana Interna de Prevenção de Acidentes do Trabalho', 'trabalhista', '2026-10-15', 'anual', 'normal', 45)
ON CONFLICT DO NOTHING;

-- Cron: verificar prazos de compliance diariamente às 07:00 UTC
SELECT cron.schedule(
  'compliance-verificar-prazos',
  '0 7 * * 1-5',
  $$SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/compliance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{"action":"compliance_verificar_prazos_auto"}'::jsonb
  )$$
);

-- Cron: verificar certificações vencidas — diariamente
SELECT cron.schedule(
  'compliance-verificar-certificacoes',
  '0 8 * * 1-5',
  $$UPDATE compliance_certificacoes SET status = 'vencida' WHERE data_vencimento < CURRENT_DATE AND status = 'valida'$$
);
