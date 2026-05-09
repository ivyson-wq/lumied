-- ═══════════════════════════════════════════════════════════════
-- 307: Reestruturação comercial — 2 planos base + 6 add-ons
--
-- Contexto (2026-05-09): Análise de mercado mostrou que tiers
-- com saltos grandes (6→30 módulos) criam friction na venda.
-- Modelo híbrido simplifica decisão e maximiza LTV via upsell.
--
-- Novo modelo:
--   Essencial (R$897/697): core completo (28 módulos)
--   Rede (R$2.497/1.997): multi-escola, todos os módulos
--   + 6 add-ons opcionais de receita recorrente
-- ═══════════════════════════════════════════════════════════════

-- 1) Desativar planos antigos (preservar dados históricos)
UPDATE planos SET ativo = false WHERE slug IN ('starter_lite', 'start', 'evolucao', 'prestige');

-- 2) Criar plano Essencial
INSERT INTO planos (id, slug, nome, descricao, preco_mensal, preco_anual, ordem, ativo)
VALUES (
  'e0000001-0000-0000-0000-000000000001',
  'essencial',
  'Essencial',
  'Gestão escolar completa — todos os módulos core num só lugar',
  897, 697, 1, true
) ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, descricao = EXCLUDED.descricao,
  preco_mensal = EXCLUDED.preco_mensal, preco_anual = EXCLUDED.preco_anual,
  ordem = EXCLUDED.ordem, ativo = EXCLUDED.ativo;

-- 3) Reativar e atualizar plano Rede existente
UPDATE planos SET
  nome = 'Rede',
  descricao = 'Multi-escola, todos os módulos + add-ons, gerente de sucesso, SLA 99.9%',
  preco_mensal = 2497, preco_anual = 1997, ordem = 2, ativo = true
WHERE slug = 'rede';

-- 4) Limites do Essencial
DELETE FROM plano_limites WHERE plano_id = 'e0000001-0000-0000-0000-000000000001';
INSERT INTO plano_limites (plano_id, recurso, limite) VALUES
  ('e0000001-0000-0000-0000-000000000001', 'max_alunos', 500),
  ('e0000001-0000-0000-0000-000000000001', 'max_turmas', 50),
  ('e0000001-0000-0000-0000-000000000001', 'max_usuarios', 30),
  ('e0000001-0000-0000-0000-000000000001', 'max_storage_gb', 20),
  ('e0000001-0000-0000-0000-000000000001', 'max_whatsapp_msgs', 0),
  ('e0000001-0000-0000-0000-000000000001', 'max_leads', 200);

-- 5) Limites do Rede
DELETE FROM plano_limites WHERE plano_id = '1bb9ef93-c4dd-403d-9820-0baaa8f05563';
INSERT INTO plano_limites (plano_id, recurso, limite) VALUES
  ('1bb9ef93-c4dd-403d-9820-0baaa8f05563', 'max_alunos', 999999),
  ('1bb9ef93-c4dd-403d-9820-0baaa8f05563', 'max_turmas', 999),
  ('1bb9ef93-c4dd-403d-9820-0baaa8f05563', 'max_usuarios', 500),
  ('1bb9ef93-c4dd-403d-9820-0baaa8f05563', 'max_storage_gb', 500),
  ('1bb9ef93-c4dd-403d-9820-0baaa8f05563', 'max_whatsapp_msgs', 5000),
  ('1bb9ef93-c4dd-403d-9820-0baaa8f05563', 'max_leads', 999999);

-- 6) Módulos do Essencial (core completo — 28+ módulos)
DELETE FROM plano_modulos WHERE plano_id = 'e0000001-0000-0000-0000-000000000001';
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT 'e0000001-0000-0000-0000-000000000001', id FROM modulos
WHERE slug IN (
  'diplomas', 'notas', 'frequencia', 'portal_aluno', 'webauthn',
  'documentos', 'calendario', 'matricula',
  'agenda_digital', 'crm', 'pesquisas', 'chat',
  'diario_classe', 'relatorios_bncc', 'banco_provas',
  'financeiro', 'pix', 'regua_cobranca', 'contratos',
  'almoxarifado', 'pickup', 'achados', 'biblioteca', 'cantina',
  'transporte', 'impressoes',
  'compliance',
  'atestados', 'emergencias', 'atividades', 'turno', 'pdi', 'manutencao'
);

-- 7) Módulos do Rede (TODOS)
DELETE FROM plano_modulos WHERE plano_id = '1bb9ef93-c4dd-403d-9820-0baaa8f05563';
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT '1bb9ef93-c4dd-403d-9820-0baaa8f05563', id FROM modulos;

-- 8) Tabela de add-ons
CREATE TABLE IF NOT EXISTS addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  nome text NOT NULL,
  descricao text,
  preco_mensal numeric NOT NULL,
  modulos_ids uuid[] DEFAULT '{}',
  limites jsonb DEFAULT '{}',
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now()
);

ALTER TABLE addons ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='addons' AND policyname='service_role_bypass') THEN
    CREATE POLICY "service_role_bypass" ON addons FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 9) Inserir add-ons
INSERT INTO addons (slug, nome, descricao, preco_mensal, modulos_ids, limites) VALUES
(
  'whatsapp',
  'WhatsApp Business',
  'API oficial Meta. Comunicados, régua de cobrança, FAQ bot. 1.000 msgs inclusas.',
  197,
  (SELECT array_agg(id) FROM modulos WHERE slug IN ('whatsapp_gateway', 'whatsapp_departamental')),
  '{"max_whatsapp_msgs": 1000, "msg_excedente": 0.15}'::jsonb
),
(
  'ia_lumi',
  'Lumi — Assistente IA',
  'Claude AI com acesso aos dados da escola. Insights, comunicados, análise de inadimplência, FAQ bot.',
  297,
  '{}',
  '{"max_ai_queries": 500}'::jsonb
),
(
  'face_id',
  'Face ID + Controle de Acesso',
  'Biometria facial, RFID, presença automática, LPR veicular, alertas real-time.',
  397,
  (SELECT array_agg(id) FROM modulos WHERE slug IN ('controle_acesso')),
  '{}'::jsonb
),
(
  'ponto_clt',
  'Ponto CLT (Portaria 671)',
  'REP, parser AFD, espelho de ponto, banco de horas, HE 50%/100%, hora noturna.',
  197,
  (SELECT array_agg(id) FROM modulos WHERE slug IN ('ponto')),
  '{}'::jsonb
),
(
  'rh_completo',
  'RH Completo',
  'Folha de pagamento, férias, admissão/demissão, integração contábil.',
  247,
  (SELECT array_agg(id) FROM modulos WHERE slug IN ('rh', 'contabil')),
  '{}'::jsonb
),
(
  'loja',
  'Loja Virtual',
  'E-commerce de uniformes, materiais e eventos. Checkout PIX integrado.',
  97,
  (SELECT array_agg(id) FROM modulos WHERE slug IN ('ecommerce')),
  '{}'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  nome = EXCLUDED.nome, descricao = EXCLUDED.descricao,
  preco_mensal = EXCLUDED.preco_mensal, modulos_ids = EXCLUDED.modulos_ids,
  limites = EXCLUDED.limites;

-- 10) Tabela escola_addons
CREATE TABLE IF NOT EXISTS escola_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  addon_id uuid NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
  ativo boolean DEFAULT true,
  contratado_em timestamptz DEFAULT now(),
  cancelado_em timestamptz,
  UNIQUE(escola_id, addon_id)
);

CREATE INDEX IF NOT EXISTS idx_escola_addons_escola ON escola_addons(escola_id);
ALTER TABLE escola_addons ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='escola_addons' AND policyname='service_role_bypass') THEN
    CREATE POLICY "service_role_bypass" ON escola_addons FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
