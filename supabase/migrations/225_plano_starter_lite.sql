-- =====================================================
-- 225: Plano Starter Lite (entrada R$ 790/mês, 200 alunos)
-- Objetivo: competir com Sponte/Escolaweb Starter (R$ 915/mês)
-- Posicionamento: substituto direto de sistemas legados
-- =====================================================

INSERT INTO planos (slug, nome, descricao, preco_mensal, preco_anual, ordem, ativo)
VALUES (
  'starter_lite',
  'Starter',
  'O básico digital, sem complicação — alternativa direta a Sponte/Escolaweb',
  790, 632, 0, true
)
ON CONFLICT (slug) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  preco_mensal = EXCLUDED.preco_mensal,
  preco_anual = EXCLUDED.preco_anual,
  ordem = EXCLUDED.ordem,
  ativo = EXCLUDED.ativo;

-- Limites: 200 alunos, 5 usuários, 5GB storage, 50 leads
INSERT INTO plano_limites (plano_id, recurso, limite)
SELECT p.id, r.recurso, r.limite
FROM planos p, (VALUES
  ('max_alunos', 200),
  ('max_usuarios', 5),
  ('max_storage_gb', 5),
  ('max_leads', 50)
) AS r(recurso, limite)
WHERE p.slug = 'starter_lite'
ON CONFLICT (plano_id, recurso) DO UPDATE SET limite = EXCLUDED.limite;

-- Módulos inclusos: secretaria, acadêmico, financeiro básico, CRM, comunicação portal
-- Excluídos: IA, WhatsApp, Compliance CLT, Acesso Facial, Almoxarifado, RH
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id FROM planos p, modulos m
WHERE p.slug = 'starter_lite' AND m.slug IN (
  'notas', 'frequencia', 'portal_aluno', 'documentos', 'calendario',
  'matricula', 'diario_classe', 'financeiro', 'crm',
  'agenda_digital', 'webauthn', 'diplomas'
)
ON CONFLICT DO NOTHING;
