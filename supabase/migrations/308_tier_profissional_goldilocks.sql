-- ═══════════════════════════════════════════════════════════════
-- 308: Adicionar tier Profissional (Goldilocks) + reduzir add-ons
--
-- Contexto: Análise neuromarketing — 2 tiers criam decisão binária
-- que empurra para o barato. 3 tiers com Profissional como target
-- capturam 55% dos clientes no tier médio (R$1.197 vs R$697).
-- WhatsApp e IA movidos para Profissional (maiores diferenciais).
-- ═══════════════════════════════════════════════════════════════

-- 1) Criar plano Profissional
INSERT INTO planos (id, slug, nome, descricao, preco_mensal, preco_anual, ordem, ativo)
VALUES (
  'e0000001-0000-0000-0000-000000000003',
  'profissional',
  'Profissional',
  'WhatsApp + IA inclusos. O plano que 6 em 10 escolas escolhem.',
  1497, 1197, 2, true
) ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, descricao = EXCLUDED.descricao,
  preco_mensal = EXCLUDED.preco_mensal, preco_anual = EXCLUDED.preco_anual,
  ordem = EXCLUDED.ordem, ativo = EXCLUDED.ativo;

-- 2) Rede vira tier 3
UPDATE planos SET ordem = 3 WHERE slug = 'rede';

-- 3) Limites do Profissional
DELETE FROM plano_limites WHERE plano_id = 'e0000001-0000-0000-0000-000000000003';
INSERT INTO plano_limites (plano_id, recurso, limite) VALUES
  ('e0000001-0000-0000-0000-000000000003', 'max_alunos', 1000),
  ('e0000001-0000-0000-0000-000000000003', 'max_turmas', 80),
  ('e0000001-0000-0000-0000-000000000003', 'max_usuarios', 60),
  ('e0000001-0000-0000-0000-000000000003', 'max_storage_gb', 50),
  ('e0000001-0000-0000-0000-000000000003', 'max_whatsapp_msgs', 1000),
  ('e0000001-0000-0000-0000-000000000003', 'max_leads', 500);

-- 4) Módulos do Profissional = Essencial + WhatsApp + BI
DELETE FROM plano_modulos WHERE plano_id = 'e0000001-0000-0000-0000-000000000003';
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT 'e0000001-0000-0000-0000-000000000003', modulo_id
FROM plano_modulos WHERE plano_id = 'e0000001-0000-0000-0000-000000000001';

INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT 'e0000001-0000-0000-0000-000000000003', id FROM modulos
WHERE slug IN ('whatsapp_gateway', 'whatsapp_departamental', 'bi_analytics')
ON CONFLICT DO NOTHING;

-- 5) Remove WhatsApp and IA add-ons (now in Profissional tier)
DELETE FROM addons WHERE slug IN ('whatsapp', 'ia_lumi');
