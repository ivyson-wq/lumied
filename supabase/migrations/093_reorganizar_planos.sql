-- =====================================================
-- 093: Reorganização Comercial dos Planos e Módulos
-- 5 tiers por jornada: Starter → Gestão → Automação → Avançado → Rede
-- Preços +30% com novo tier intermediário
-- =====================================================

-- ═══════════════════════════════════════════════════════
-- 1. ATUALIZAR PLANOS EXISTENTES + CRIAR NOVO
-- ═══════════════════════════════════════════════════════

-- Renomear e atualizar planos existentes
UPDATE planos SET
  slug = 'starter', nome = 'Starter', descricao = 'Digitalize o básico — notas, frequência e portal do aluno',
  preco_mensal = 259, preco_anual = 207, ordem = 1
WHERE slug = 'essencial';

UPDATE planos SET
  slug = 'gestao', nome = 'Gestão', descricao = 'Tudo num lugar só — comunicação, CRM, financeiro e operacional',
  preco_mensal = 649, preco_anual = 519, ordem = 2
WHERE slug = 'profissional';

UPDATE planos SET
  slug = 'automacao', nome = 'Automação', descricao = 'O sistema trabalha por você — cobranças, WhatsApp, compliance',
  preco_mensal = 1169, preco_anual = 935, ordem = 3
WHERE slug = 'premium';

UPDATE planos SET
  slug = 'rede', nome = 'Rede', descricao = 'Escale para múltiplas unidades — BI, RH, app nativo, multi-tenant',
  preco_mensal = 1949, preco_anual = 1559, ordem = 5
WHERE slug = 'enterprise';

-- Criar novo plano Avançado (entre Automação e Rede)
INSERT INTO planos (slug, nome, descricao, preco_mensal, preco_anual, ordem, ativo)
VALUES ('avancado', 'Avançado', 'Analytics, RH e integrações avançadas para escolas que crescem rápido', 1559, 1247, 4, true)
ON CONFLICT (slug) DO UPDATE SET
  nome = EXCLUDED.nome, descricao = EXCLUDED.descricao,
  preco_mensal = EXCLUDED.preco_mensal, preco_anual = EXCLUDED.preco_anual, ordem = EXCLUDED.ordem;

-- ═══════════════════════════════════════════════════════
-- 2. ATUALIZAR LIMITES POR PLANO
-- ═══════════════════════════════════════════════════════

-- Limpar limites antigos e recriar
DELETE FROM plano_limites;

-- Starter: 80 alunos, 3 usuários, 2GB
INSERT INTO plano_limites (plano_id, recurso, limite)
SELECT p.id, r.recurso, r.limite
FROM planos p, (VALUES
  ('max_alunos', 80), ('max_usuarios', 3), ('max_storage_gb', 2), ('max_leads', 20)
) AS r(recurso, limite)
WHERE p.slug = 'starter';

-- Gestão: 300 alunos, 15 usuários, 15GB
INSERT INTO plano_limites (plano_id, recurso, limite)
SELECT p.id, r.recurso, r.limite
FROM planos p, (VALUES
  ('max_alunos', 300), ('max_usuarios', 15), ('max_storage_gb', 15), ('max_leads', 200)
) AS r(recurso, limite)
WHERE p.slug = 'gestao';

-- Automação: 800 alunos, 40 usuários, 50GB
INSERT INTO plano_limites (plano_id, recurso, limite)
SELECT p.id, r.recurso, r.limite
FROM planos p, (VALUES
  ('max_alunos', 800), ('max_usuarios', 40), ('max_storage_gb', 50), ('max_leads', 500)
) AS r(recurso, limite)
WHERE p.slug = 'automacao';

-- Avançado: 1500 alunos, 80 usuários, 150GB
INSERT INTO plano_limites (plano_id, recurso, limite)
SELECT p.id, r.recurso, r.limite
FROM planos p, (VALUES
  ('max_alunos', 1500), ('max_usuarios', 80), ('max_storage_gb', 150), ('max_leads', 2000)
) AS r(recurso, limite)
WHERE p.slug = 'avancado';

-- Rede: ilimitado
INSERT INTO plano_limites (plano_id, recurso, limite)
SELECT p.id, r.recurso, r.limite
FROM planos p, (VALUES
  ('max_alunos', 999999), ('max_usuarios', 999999), ('max_storage_gb', 999999), ('max_leads', 999999)
) AS r(recurso, limite)
WHERE p.slug = 'rede';

-- ═══════════════════════════════════════════════════════
-- 3. RECONFIGURAR MÓDULOS POR PLANO
-- ═══════════════════════════════════════════════════════

-- Limpar mapeamento antigo
DELETE FROM plano_modulos;

-- ── STARTER (6 módulos — "Saio do papel") ────────────
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE p.slug = 'starter' AND m.slug IN (
  'notas', 'frequencia', 'portal_aluno', 'documentos', 'calendario', 'webauthn'
);

-- ── GESTÃO (19 módulos — "Tudo num lugar só") ────────
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE p.slug = 'gestao' AND m.slug IN (
  -- Starter
  'notas', 'frequencia', 'portal_aluno', 'documentos', 'calendario', 'webauthn',
  -- + Comunicação
  'agenda_digital', 'chat', 'pesquisas',
  -- + Comercial
  'crm', 'matricula',
  -- + Acadêmico
  'diario_classe', 'relatorios_bncc', 'banco_provas',
  -- + Operacional básico
  'financeiro', 'almoxarifado', 'pickup', 'achados',
  -- + Growth
  'diplomas'
);

-- ── AUTOMAÇÃO (30 módulos — "O sistema trabalha por você") ──
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE p.slug = 'automacao' AND m.slug IN (
  -- Gestão
  'notas', 'frequencia', 'portal_aluno', 'documentos', 'calendario', 'webauthn',
  'agenda_digital', 'chat', 'pesquisas', 'crm', 'matricula',
  'diario_classe', 'relatorios_bncc', 'banco_provas',
  'financeiro', 'almoxarifado', 'pickup', 'achados', 'diplomas',
  -- + Automação financeira
  'regua_cobranca', 'pix', 'contratos',
  -- + Compliance
  'compliance',
  -- + Operacional avançado
  'biblioteca', 'cantina', 'transporte',
  -- + Comunicação avançada
  'emergencias', 'atestados', 'impressoes',
  -- + Extras
  'turno', 'atividades'
);

-- ── AVANÇADO (35 módulos — "Analytics e RH") ─────────
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE p.slug = 'avancado' AND m.slug IN (
  -- Automação
  'notas', 'frequencia', 'portal_aluno', 'documentos', 'calendario', 'webauthn',
  'agenda_digital', 'chat', 'pesquisas', 'crm', 'matricula',
  'diario_classe', 'relatorios_bncc', 'banco_provas',
  'financeiro', 'almoxarifado', 'pickup', 'achados', 'diplomas',
  'regua_cobranca', 'pix', 'contratos', 'compliance',
  'biblioteca', 'cantina', 'transporte',
  'emergencias', 'atestados', 'impressoes', 'turno', 'atividades',
  -- + Analytics e RH
  'bi_analytics', 'rh', 'contabil',
  -- + Manutenção
  'manutencao',
  -- + PDI
  'pdi'
);

-- ── REDE (todos os módulos — "Escale para múltiplas unidades") ──
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE p.slug = 'rede' AND m.ativo = true;

-- ═══════════════════════════════════════════════════════
-- 4. TABELA DE ADOÇÃO (health score por escola)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS escola_adocao (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE,
  data_snapshot date NOT NULL DEFAULT CURRENT_DATE,
  modulos_ativos integer DEFAULT 0,
  modulos_disponiveis integer DEFAULT 0,
  usuarios_logando integer DEFAULT 0,
  usuarios_total integer DEFAULT 0,
  score_saude numeric(5,2) DEFAULT 0,           -- 0-100
  modulos_subutilizados text[],                  -- slugs de módulos pagos sem uso
  alertas text[],                                -- mensagens de alerta
  criado_em timestamptz DEFAULT now(),
  UNIQUE(escola_id, data_snapshot)
);
ALTER TABLE escola_adocao DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════
-- 5. TABELA DE UPSELL TRIGGERS
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS escola_upsell_triggers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE,
  tipo text NOT NULL,                            -- 'limite_proximo','modulo_bloqueado','uso_frequente','busca_feature'
  mensagem text NOT NULL,
  plano_sugerido text,                           -- slug do plano sugerido
  mostrado boolean DEFAULT false,
  clicou boolean DEFAULT false,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE escola_upsell_triggers DISABLE ROW LEVEL SECURITY;
