-- =====================================================
-- 048: Tabela escola_config — configuração dinâmica
-- Permite que o mesmo código rode para qualquer escola
-- =====================================================

CREATE TABLE IF NOT EXISTS escola_config (
  chave TEXT PRIMARY KEY,
  valor JSONB NOT NULL,
  descricao TEXT,
  categoria TEXT DEFAULT 'geral',
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE escola_config DISABLE ROW LEVEL SECURITY;

-- Trigger para atualizar timestamp
CREATE OR REPLACE FUNCTION escola_config_updated()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_escola_config_updated
  BEFORE UPDATE ON escola_config
  FOR EACH ROW EXECUTE FUNCTION escola_config_updated();

-- =====================================================
-- SEED: Valores padrão (Maple Bear Caxias do Sul)
-- Cada escola nova altera estes valores no setup
-- =====================================================

-- ── Dados da Escola ──
INSERT INTO escola_config (chave, valor, descricao, categoria) VALUES
('escola_nome',        '"Maple Bear Caxias do Sul"',   'Nome da escola',           'escola'),
('escola_subtitulo',   '"Rio Grande do Sul"',           'Subtítulo / cidade',       'escola'),
('escola_cnpj',        '"44.034.235/0001-70"',          'CNPJ da escola',           'escola'),
('escola_email_domain','"maplebearcaxiasdosul.com.br"', 'Domínio de e-mail',        'escola'),
('escola_email_sender','"noreply@maplebearcaxiasdosul.com.br"', 'E-mail remetente', 'escola'),
('escola_url',         '"https://app.maplebearcaxiasdosul.com.br"', 'URL pública',  'escola'),
('escola_lat',         '-28.8628',                      'Latitude da escola',       'escola'),
('escola_lon',         '-51.5201',                      'Longitude da escola',      'escola'),
('escola_pickup_raio', '200',                           'Raio (metros) para pickup','escola'),
('escola_email_notif', '"secretaria@maplebearcaxiasdosul.com.br"', 'E-mail que recebe notificações (ausências, turnos, etc.)', 'escola'),
('escola_resend_info', '"Configure RESEND_API_KEY nos secrets do Supabase Edge Functions"', 'Instrução de config do Resend', 'escola'),
('superusuario_email', '"ivyson@gmail.com"', 'E-mail do superusuário (único com acesso ao admin.html)', 'sistema')
ON CONFLICT (chave) DO NOTHING;

-- ── Branding / Cores ──
INSERT INTO escola_config (chave, valor, descricao, categoria) VALUES
('cor_primaria',    '"#C8102E"',              'Cor principal (botões, header)',    'branding'),
('cor_escura',      '"#a00d24"',              'Cor hover/dark',                   'branding'),
('cor_light',       '"rgba(200,16,46,.07)"',  'Cor de fundo suave',              'branding'),
('cor_cream',       '"#f8f5f0"',              'Cor de fundo do body',            'branding'),
('escola_logo_url', 'null',                   'URL do logotipo (null = fallback)','branding'),
('escola_icone',    '"🍁"',                   'Emoji/ícone da escola',           'branding')
ON CONFLICT (chave) DO NOTHING;

-- ── Turnos e Preços ──
INSERT INTO escola_config (chave, valor, descricao, categoria) VALUES
('turnos_config', '[
  {"id":"integral_5x","grupo":"Integral","nome":"Integral · 5× na semana","preco":4395.00,"inicio":"07:30"},
  {"id":"integral_4x","grupo":"Integral","nome":"Integral · 4× na semana","preco":4303.57,"inicio":"07:30"},
  {"id":"integral_3x","grupo":"Integral","nome":"Integral · 3× na semana","preco":4072.13,"inicio":"07:30"},
  {"id":"integral_2x","grupo":"Integral","nome":"Integral · 2× na semana","preco":3760.70,"inicio":"07:30"},
  {"id":"integral_1x","grupo":"Integral","nome":"Integral · 1× na semana","preco":3300.00,"inicio":"07:30"},
  {"id":"semi_5x","grupo":"Semi-Integral","nome":"Semi-Integral · 5× na semana","preco":4030.00,"inicio":"09:45"},
  {"id":"semi_4x","grupo":"Semi-Integral","nome":"Semi-Integral · 4× na semana","preco":3991.57,"inicio":"09:45"},
  {"id":"semi_3x","grupo":"Semi-Integral","nome":"Semi-Integral · 3× na semana","preco":3773.13,"inicio":"09:45"},
  {"id":"semi_2x","grupo":"Semi-Integral","nome":"Semi-Integral · 2× na semana","preco":3534.70,"inicio":"09:45"},
  {"id":"semi_1x","grupo":"Semi-Integral","nome":"Semi-Integral · 1× na semana","preco":3196.27,"inicio":"09:45"},
  {"id":"tarde","grupo":"Outros","nome":"Apenas a Tarde","preco":null,"inicio":"13:30"},
  {"id":"diaria","grupo":"Outros","nome":"Diária","preco":150.00,"inicio":null}
]', 'Configuração de turnos e preços', 'turnos')
ON CONFLICT (chave) DO NOTHING;

-- ── Módulos Ativos ──
INSERT INTO escola_config (chave, valor, descricao, categoria) VALUES
('modulos_ativos', '["turnos","atividades","boletos","achados_perdidos","pickup","almoxarifado","crm","financeiro","manutencao","calendario","emergencia","impressoes","growth_plan"]',
  'Módulos habilitados para esta escola', 'modulos')
ON CONFLICT (chave) DO NOTHING;

-- ── Séries Padrão (nomes das turmas) ──
INSERT INTO escola_config (chave, valor, descricao, categoria) VALUES
('series_padrao', '["Bear Care","Toddler","Nursery","Junior Kindergarten (JK)","Senior Kindergarten (SK)","Year 1","Year 2","Year 3","Year 4","Year 5"]',
  'Nomes das séries padrão da escola', 'escola')
ON CONFLICT (chave) DO NOTHING;

-- ── Horários dos Turnos (para exibição) ──
INSERT INTO escola_config (chave, valor, descricao, categoria) VALUES
('horarios_turnos', '{"integral":"07:30h","semi":"09:45h","tarde":"13:30h","fundamental_tarde":"13:10h"}',
  'Horários de início dos turnos', 'turnos')
ON CONFLICT (chave) DO NOTHING;

-- ── Nota sobre turno fundamental ──
INSERT INTO escola_config (chave, valor, descricao, categoria) VALUES
('nota_turno_fundamental', '"Para Ensino Fundamental o turno Tarde inicia às 13:10h."',
  'Nota exibida no formulário de turno', 'turnos')
ON CONFLICT (chave) DO NOTHING;
