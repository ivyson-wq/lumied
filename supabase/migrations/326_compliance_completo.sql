-- Migration 326: Compliance Escolar Completo
-- LGPD, AVCB, Consentimentos, ANVISA, Acessibilidade, Seguros, Fiscal

-- ═══════════════════════════════════════════════════
-- 1. LGPD — Gestão de Consentimento e Proteção de Dados
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_lgpd_consentimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  tipo text NOT NULL, -- matricula, fotos, passeio, dados_terceiros, marketing, pesquisa, biometria
  titulo text NOT NULL,
  descricao text,
  versao integer DEFAULT 1,
  obrigatorio boolean DEFAULT false,
  vigente_desde date,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lgpd_consent_escola ON compliance_lgpd_consentimentos(escola_id);

CREATE TABLE IF NOT EXISTS compliance_lgpd_aceites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  consentimento_id uuid NOT NULL REFERENCES compliance_lgpd_consentimentos(id) ON DELETE CASCADE,
  familia_id uuid REFERENCES familias(id),
  aluno_id uuid REFERENCES alunos(id),
  responsavel_nome text,
  responsavel_email text,
  aceito boolean NOT NULL,
  ip_address text,
  user_agent text,
  aceito_em timestamptz DEFAULT now(),
  revogado_em timestamptz,
  motivo_revogacao text,
  UNIQUE(consentimento_id, familia_id, aluno_id)
);
CREATE INDEX IF NOT EXISTS idx_lgpd_aceites_escola ON compliance_lgpd_aceites(escola_id);
CREATE INDEX IF NOT EXISTS idx_lgpd_aceites_familia ON compliance_lgpd_aceites(familia_id);

CREATE TABLE IF NOT EXISTS compliance_lgpd_incidentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  tipo text NOT NULL, -- vazamento, acesso_indevido, perda, outro
  gravidade text DEFAULT 'media', -- baixa, media, alta, critica
  descricao text NOT NULL,
  dados_afetados text, -- tipos de dados
  titulares_afetados integer DEFAULT 0,
  data_ocorrencia date NOT NULL,
  data_deteccao date,
  notificado_anpd boolean DEFAULT false,
  notificado_anpd_em timestamptz,
  notificado_titulares boolean DEFAULT false,
  notificado_titulares_em timestamptz,
  medidas_tomadas text,
  status text DEFAULT 'aberto', -- aberto, investigando, resolvido, reportado
  responsavel text,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lgpd_inc_escola ON compliance_lgpd_incidentes(escola_id);

CREATE TABLE IF NOT EXISTS compliance_lgpd_solicitacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  tipo text NOT NULL, -- acesso, retificacao, exclusao, portabilidade, oposicao
  solicitante_nome text NOT NULL,
  solicitante_email text NOT NULL,
  solicitante_cpf text,
  descricao text,
  status text DEFAULT 'pendente', -- pendente, em_andamento, concluido, recusado
  prazo_legal date, -- 15 dias úteis per LGPD
  respondido_em timestamptz,
  resposta text,
  responsavel text,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lgpd_solic_escola ON compliance_lgpd_solicitacoes(escola_id);

-- ═══════════════════════════════════════════════════
-- 2. AVCB — Segurança contra Incêndio
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_avcb (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  numero_avcb text,
  data_emissao date,
  data_validade date,
  arquivo_url text,
  status text DEFAULT 'vigente', -- vigente, vencido, em_renovacao
  observacoes text,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_avcb_escola ON compliance_avcb(escola_id);

CREATE TABLE IF NOT EXISTS compliance_extintores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  tipo text NOT NULL, -- agua, po_quimico, co2, espuma, abc
  localizacao text NOT NULL,
  numero_patrimonio text,
  data_fabricacao date,
  data_recarga date,
  proxima_recarga date,
  data_teste_hidrostatico date,
  proximo_teste date,
  status text DEFAULT 'ok', -- ok, vencido, recarregar, substituir
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_extintores_escola ON compliance_extintores(escola_id);

CREATE TABLE IF NOT EXISTS compliance_simulados_evacuacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  data_simulado date NOT NULL,
  tipo text DEFAULT 'incendio', -- incendio, terremoto, invasao, geral
  participantes integer DEFAULT 0,
  tempo_evacuacao_seg integer,
  pontos_melhoria text,
  fotos_url text[],
  responsavel text,
  proximo_simulado date,
  status text DEFAULT 'realizado', -- agendado, realizado, cancelado
  observacoes text,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_simulados_escola ON compliance_simulados_evacuacao(escola_id);

CREATE TABLE IF NOT EXISTS compliance_plano_evacuacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  versao integer DEFAULT 1,
  arquivo_url text,
  ponto_encontro text,
  responsavel_geral text,
  responsavel_blocos jsonb, -- [{bloco, responsavel, suplente}]
  telefones_emergencia jsonb, -- [{nome, telefone}]
  atualizado_em timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════
-- 3. CONSENTIMENTOS DE MATRÍCULA
-- ═══════════════════════════════════════════════════

-- Usa compliance_lgpd_consentimentos + compliance_lgpd_aceites
-- Seed de tipos padrão
INSERT INTO compliance_lgpd_consentimentos (escola_id, tipo, titulo, descricao, obrigatorio, vigente_desde)
SELECT e.id, t.tipo, t.titulo, t.descricao, t.obrigatorio, CURRENT_DATE
FROM escolas e
CROSS JOIN (VALUES
  ('matricula', 'Termo de Matrícula', 'Concordo com o regulamento interno e projeto pedagógico da escola.', true),
  ('emergencia_medica', 'Autorização de Emergência Médica', 'Autorizo a escola a encaminhar meu filho(a) para atendimento médico de emergência.', true),
  ('fotos', 'Uso de Imagem', 'Autorizo o uso de fotos e vídeos do meu filho(a) em materiais da escola e redes sociais.', false),
  ('passeio_local', 'Autorização para Passeios Locais', 'Autorizo a participação em passeios pedagógicos na cidade.', false),
  ('dados_terceiros', 'Compartilhamento de Dados', 'Autorizo o compartilhamento de dados acadêmicos com plataformas pedagógicas parceiras.', false),
  ('biometria', 'Reconhecimento Facial / Biometria', 'Autorizo o cadastro e uso de dados biométricos para controle de acesso.', false)
) AS t(tipo, titulo, descricao, obrigatorio)
WHERE NOT EXISTS (SELECT 1 FROM compliance_lgpd_consentimentos c WHERE c.escola_id = e.id AND c.tipo = t.tipo);

-- ═══════════════════════════════════════════════════
-- 4. ANVISA / Saúde e Segurança Alimentar
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_anvisa_temperaturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  equipamento text NOT NULL, -- geladeira_1, freezer_1, balcao_quente, etc.
  temperatura numeric(5,1) NOT NULL,
  unidade text DEFAULT 'C',
  dentro_limite boolean,
  limite_min numeric(5,1),
  limite_max numeric(5,1),
  registrado_por text,
  registrado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_anvisa_temp_escola ON compliance_anvisa_temperaturas(escola_id);
CREATE INDEX IF NOT EXISTS idx_anvisa_temp_data ON compliance_anvisa_temperaturas(registrado_em);

CREATE TABLE IF NOT EXISTS compliance_anvisa_equipamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  nome text NOT NULL, -- Geladeira Principal, Freezer, Balcão Quente
  tipo text NOT NULL, -- geladeira, freezer, balcao_quente, balcao_frio
  localizacao text,
  limite_min numeric(5,1), -- temp mínima aceitável
  limite_max numeric(5,1), -- temp máxima aceitável
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance_anvisa_controle_pragas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  empresa text NOT NULL,
  contrato_url text,
  data_servico date NOT NULL,
  proximo_servico date,
  tipo_servico text, -- desinsetizacao, desratizacao, descupinizacao, completo
  certificado_url text,
  observacoes text,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pragas_escola ON compliance_anvisa_controle_pragas(escola_id);

CREATE TABLE IF NOT EXISTS compliance_anvisa_manipuladores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  funcionario_nome text NOT NULL,
  curso text NOT NULL, -- Boas Práticas de Manipulação
  instituicao text,
  data_conclusao date,
  validade date,
  certificado_url text,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════
-- 5. ACESSIBILIDADE (LBI 13.146/2015)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_acessibilidade_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  area text NOT NULL, -- entrada_principal, corredores, salas, banheiros, patio, refeitorio, biblioteca
  item text NOT NULL, -- rampa, corrimao, piso_tatil, banheiro_acessivel, elevador, sinalizacao_braille
  conforme boolean DEFAULT false,
  observacao text,
  foto_url text,
  plano_acao text,
  prazo_correcao date,
  responsavel text,
  corrigido boolean DEFAULT false,
  corrigido_em date,
  auditado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acess_audit_escola ON compliance_acessibilidade_audit(escola_id);

CREATE TABLE IF NOT EXISTS compliance_pei (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  aluno_id uuid REFERENCES alunos(id),
  aluno_nome text,
  diagnostico text,
  cid text, -- código CID
  necessidades text[], -- tempo_extra, leitor, material_ampliado, interprete_libras, sala_recursos, tutor
  acomodacoes text,
  objetivos text,
  professor_aee text, -- Atendimento Educacional Especializado
  data_inicio date,
  data_revisao date,
  status text DEFAULT 'ativo', -- ativo, em_revisao, encerrado
  observacoes text,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pei_escola ON compliance_pei(escola_id);
CREATE INDEX IF NOT EXISTS idx_pei_aluno ON compliance_pei(aluno_id);

-- ═══════════════════════════════════════════════════
-- 6. SEGUROS
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_seguros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  tipo text NOT NULL, -- responsabilidade_civil, acidentes_pessoais, patrimonial, vida_funcionarios, transporte
  seguradora text NOT NULL,
  numero_apolice text,
  cobertura_resumo text,
  valor_cobertura numeric(12,2),
  premio_mensal numeric(10,2),
  data_inicio date,
  data_fim date,
  arquivo_url text,
  status text DEFAULT 'vigente', -- vigente, vencido, em_renovacao, cancelado
  contato_sinistro text,
  observacoes text,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seguros_escola ON compliance_seguros(escola_id);

-- ═══════════════════════════════════════════════════
-- 7. FISCAL / eSocial — Status de Obrigações
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_fiscal_obrigacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  obrigacao text NOT NULL, -- esocial, fgts, inss, irrf, rais, dirf, dctfweb
  competencia text NOT NULL, -- 2026-01, 2026-02, etc.
  status text DEFAULT 'pendente', -- pendente, enviado, confirmado, erro, atrasado
  data_envio date,
  protocolo text,
  comprovante_url text,
  valor numeric(12,2),
  observacoes text,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(escola_id, obrigacao, competencia)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_escola ON compliance_fiscal_obrigacoes(escola_id);

-- ═══════════════════════════════════════════════════
-- 8. REGISTROS PROFISSIONAIS (role-specific)
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS compliance_registros_profissionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  funcionario_id uuid REFERENCES rh_funcionarios(id),
  funcionario_nome text,
  tipo_registro text NOT NULL, -- crp, crefn, crefito, coren, crea, oab, cnh_d, conselho_outro
  numero_registro text,
  orgao text, -- CRP-RS, CRN-2, etc.
  data_emissao date,
  data_validade date,
  arquivo_url text,
  status text DEFAULT 'valido', -- valido, vencido, pendente, suspenso
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reg_prof_escola ON compliance_registros_profissionais(escola_id);

CREATE TABLE IF NOT EXISTS compliance_antecedentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  funcionario_id uuid REFERENCES rh_funcionarios(id),
  funcionario_nome text,
  tipo text NOT NULL, -- criminal, sexual_offender, policia_federal, policia_civil
  data_emissao date,
  data_validade date,
  resultado text DEFAULT 'nada_consta', -- nada_consta, pendencias, negativo
  arquivo_url text,
  criado_em timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_antecedentes_escola ON compliance_antecedentes(escola_id);

-- ═══════════════════════════════════════════════════
-- Tenant isolation triggers
-- ═══════════════════════════════════════════════════

DO $$ BEGIN
  PERFORM add_tenant_isolation('compliance_lgpd_consentimentos');
  PERFORM add_tenant_isolation('compliance_lgpd_aceites');
  PERFORM add_tenant_isolation('compliance_lgpd_incidentes');
  PERFORM add_tenant_isolation('compliance_lgpd_solicitacoes');
  PERFORM add_tenant_isolation('compliance_avcb');
  PERFORM add_tenant_isolation('compliance_extintores');
  PERFORM add_tenant_isolation('compliance_simulados_evacuacao');
  PERFORM add_tenant_isolation('compliance_plano_evacuacao');
  PERFORM add_tenant_isolation('compliance_anvisa_temperaturas');
  PERFORM add_tenant_isolation('compliance_anvisa_equipamentos');
  PERFORM add_tenant_isolation('compliance_anvisa_controle_pragas');
  PERFORM add_tenant_isolation('compliance_anvisa_manipuladores');
  PERFORM add_tenant_isolation('compliance_acessibilidade_audit');
  PERFORM add_tenant_isolation('compliance_pei');
  PERFORM add_tenant_isolation('compliance_seguros');
  PERFORM add_tenant_isolation('compliance_fiscal_obrigacoes');
  PERFORM add_tenant_isolation('compliance_registros_profissionais');
  PERFORM add_tenant_isolation('compliance_antecedentes');
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- RLS
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'compliance_lgpd_consentimentos','compliance_lgpd_aceites','compliance_lgpd_incidentes','compliance_lgpd_solicitacoes',
    'compliance_avcb','compliance_extintores','compliance_simulados_evacuacao','compliance_plano_evacuacao',
    'compliance_anvisa_temperaturas','compliance_anvisa_equipamentos','compliance_anvisa_controle_pragas','compliance_anvisa_manipuladores',
    'compliance_acessibilidade_audit','compliance_pei','compliance_seguros','compliance_fiscal_obrigacoes',
    'compliance_registros_profissionais','compliance_antecedentes'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'rls_' || tbl, tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (true)', 'rls_' || tbl, tbl);
  END LOOP;
END $$;
