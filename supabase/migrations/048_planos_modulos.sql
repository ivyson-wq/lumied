-- =====================================================
-- 048: Sistema de Planos, Módulos e Controle por Escola
-- =====================================================

-- PLANOS (templates de tier)
CREATE TABLE IF NOT EXISTS planos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  nome text NOT NULL,
  descricao text,
  preco_mensal numeric DEFAULT 0,
  preco_anual numeric DEFAULT 0,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE planos DISABLE ROW LEVEL SECURITY;

-- MODULOS (todos — existentes + novos)
CREATE TABLE IF NOT EXISTS modulos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  nome text NOT NULL,
  descricao text,
  icone text DEFAULT '📦',
  grupo text NOT NULL,
  ordem integer DEFAULT 0,
  portais text[] DEFAULT '{}',
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE modulos DISABLE ROW LEVEL SECURITY;

-- PLANO <-> MODULO (template: quais módulos cada tier inclui)
CREATE TABLE IF NOT EXISTS plano_modulos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  plano_id uuid NOT NULL REFERENCES planos(id) ON DELETE CASCADE,
  modulo_id uuid NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  UNIQUE(plano_id, modulo_id)
);
ALTER TABLE plano_modulos DISABLE ROW LEVEL SECURITY;

-- ESCOLAS (clientes)
CREATE TABLE IF NOT EXISTS escolas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  cnpj text,
  slug text UNIQUE,
  plano_id uuid REFERENCES planos(id),
  plano_inicio date,
  plano_fim date,
  contato_nome text,
  contato_email text,
  contato_telefone text,
  supabase_url text,
  supabase_anon_key text,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE escolas DISABLE ROW LEVEL SECURITY;

-- ESCOLA <-> MODULO (override granular por escola)
CREATE TABLE IF NOT EXISTS escola_modulos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  modulo_id uuid NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  habilitado boolean NOT NULL DEFAULT true,
  UNIQUE(escola_id, modulo_id)
);
ALTER TABLE escola_modulos DISABLE ROW LEVEL SECURITY;

-- ADMIN AUTH (superadmins do painel admin.html)
CREATE TABLE IF NOT EXISTS admins (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  email text UNIQUE NOT NULL,
  senha_hash text NOT NULL,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE admins DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_sessoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL,
  expira_em timestamptz NOT NULL,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE admin_sessoes DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- SEED: Planos
-- =====================================================
INSERT INTO planos (slug, nome, descricao, ordem) VALUES
  ('essencial',     'Essencial',     'Core acadêmico + módulos base',                    0),
  ('profissional',  'Profissional',  'Essencial + comunicação + engajamento',             1),
  ('premium',       'Premium',       'Profissional + automação financeira + operações',   2),
  ('enterprise',    'Enterprise',    'Todos os módulos disponíveis',                      3)
ON CONFLICT (slug) DO NOTHING;

-- =====================================================
-- SEED: Módulos (existentes + novos)
-- =====================================================
INSERT INTO modulos (slug, nome, grupo, icone, portais, ordem) VALUES
  -- Existentes
  ('pickup',        'Pickup / Fila de Retirada',             'existente', '🚗', '{gerente,professora,pais}',           1),
  ('turno',         'Mudança de Turno',                      'existente', '🔄', '{gerente,pais}',                      2),
  ('atividades',    'Atividades Extracurriculares',          'existente', '⚽', '{gerente,pais}',                      3),
  ('diplomas',      'Diplomas & Ranking',                    'existente', '🏅', '{gerente,professora}',                4),
  ('pdi',           'Annual Growth Plan (PDI)',               'existente', '📈', '{gerente,professora,pais}',           5),
  ('almoxarifado',  'Almoxarifado',                          'existente', '📦', '{gerente,professora}',                6),
  ('manutencao',    'Manutenção',                            'existente', '🔧', '{gerente,professora}',                7),
  ('achados',       'Achados & Perdidos',                    'existente', '🔍', '{gerente,professora,pais}',           8),
  ('impressoes',    'Impressões',                            'existente', '🖨️', '{gerente,professora}',               9),
  ('financeiro',    'Financeiro',                            'existente', '💰', '{gerente}',                          10),
  ('crm',           'CRM',                                   'existente', '🎯', '{gerente}',                          11),
  ('calendario',    'Calendário Escolar',                    'existente', '📅', '{gerente,pais}',                     12),
  ('emergencias',   'Emergências',                           'existente', '🚨', '{gerente}',                          13),
  ('atestados',     'Atestados',                             'existente', '📋', '{gerente,professora,secretaria}',    14),
  ('webauthn',      'Login Biométrico',                      'existente', '🔐', '{gerente,professora,secretaria,pais}',15),
  -- Novos: Acadêmico
  ('notas',         'Notas / Boletim / Conceitos',           'academico', '📝', '{gerente,professora,pais}',          20),
  ('frequencia',    'Controle de Frequência / Chamada',      'academico', '✅', '{gerente,professora,pais}',          21),
  ('diario_classe', 'Diário de Classe Digital',              'academico', '📖', '{gerente,professora}',               22),
  ('relatorios_bncc','Relatórios Pedagógicos / BNCC',        'academico', '📊', '{gerente,professora,pais}',          23),
  ('banco_provas',  'Banco de Provas / Avaliações Online',   'academico', '📝', '{gerente,professora,aluno}',         24),
  ('portal_aluno',  'Portal do Aluno',                       'academico', '🎓', '{aluno}',                            25),
  -- Novos: Comunicação
  ('agenda_digital','Agenda Digital / Diário do Aluno',      'comunicacao','📅', '{professora,pais}',                 30),
  ('chat',          'Comunicação / Chat escola-família',     'comunicacao','💬', '{gerente,professora,pais,secretaria}',31),
  ('pesquisas',     'Pesquisas / Enquetes / Autorizações',   'comunicacao','📊', '{gerente,pais}',                    32),
  -- Novos: Administrativo
  ('matricula',     'Matrícula / Rematrícula Online',        'administrativo','📋', '{gerente,pais}',                 40),
  ('documentos',    'Documentos do Aluno',                   'administrativo','📄', '{gerente,secretaria,pais}',      41),
  ('contratos',     'Contratos Digitais + Assinatura',       'administrativo','✍️', '{gerente,pais}',                 42),
  -- Novos: Financeiro
  ('regua_cobranca','Régua de Cobrança Automática',          'financeiro','🔔', '{gerente}',                          50),
  ('pix',           'PIX Integrado',                         'financeiro','💳', '{gerente,pais}',                     51),
  ('contabil',      'Integração Contábil',                   'financeiro','🧮', '{gerente}',                          52),
  -- Novos: Operacional
  ('biblioteca',    'Gestão de Biblioteca',                  'operacional','📚', '{gerente,pais,aluno}',              60),
  ('cantina',       'Gestão de Cantina / Refeitório',        'operacional','🍽️', '{gerente,pais}',                   61),
  ('transporte',    'Transporte Escolar',                    'operacional','🚌', '{gerente,pais}',                    62),
  -- Novos: Avançado
  ('app_nativo',    'App Nativo (iOS/Android)',               'avancado',  '📱', '{pais}',                            70),
  ('ead',           'EAD / Aulas Online',                    'avancado',  '🎥', '{gerente,professora,aluno}',         71),
  ('rh',            'Gestão de RH / Folha',                  'avancado',  '👔', '{gerente}',                          72),
  ('bi_analytics',  'BI / Analytics Avançado',               'avancado',  '📈', '{gerente}',                          73),
  ('ecommerce',     'E-commerce / Loja Virtual',             'avancado',  '🛒', '{gerente,pais}',                    74)
ON CONFLICT (slug) DO NOTHING;

-- =====================================================
-- SEED: Mapeamento plano <-> módulos (cumulativo)
-- =====================================================

-- Todos os existentes entram em todos os planos
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE m.grupo = 'existente'
ON CONFLICT DO NOTHING;

-- ESSENCIAL: + notas, frequencia, diario_classe, documentos, pesquisas
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE p.slug IN ('essencial','profissional','premium','enterprise')
  AND m.slug IN ('notas','frequencia','diario_classe','documentos','pesquisas')
ON CONFLICT DO NOTHING;

-- PROFISSIONAL: + agenda_digital, chat, matricula, relatorios_bncc, portal_aluno, banco_provas
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE p.slug IN ('profissional','premium','enterprise')
  AND m.slug IN ('agenda_digital','chat','matricula','relatorios_bncc','portal_aluno','banco_provas')
ON CONFLICT DO NOTHING;

-- PREMIUM: + contratos, regua_cobranca, pix, biblioteca, bi_analytics, cantina, transporte
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE p.slug IN ('premium','enterprise')
  AND m.slug IN ('contratos','regua_cobranca','pix','biblioteca','bi_analytics','cantina','transporte')
ON CONFLICT DO NOTHING;

-- ENTERPRISE: + app_nativo, ead, contabil, rh, ecommerce
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE p.slug = 'enterprise'
  AND m.slug IN ('app_nativo','ead','contabil','rh','ecommerce')
ON CONFLICT DO NOTHING;

-- =====================================================
-- SEED: Escola padrão (Maple Bear Caxias do Sul) com plano Enterprise
-- =====================================================
INSERT INTO escolas (nome, cnpj, slug, plano_id)
SELECT 'Maple Bear Caxias do Sul', '44.034.235/0001-70', 'maple-bear-caxias', p.id
FROM planos p WHERE p.slug = 'enterprise'
ON CONFLICT (slug) DO NOTHING;
