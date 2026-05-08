-- ═══════════════════════════════════════════════════════════════
-- 298: Módulo "ponto" — Parser AFD (Portaria 671)
-- Registra o módulo no catálogo + libera nos planos avancado/rede.
-- Backend já existe em supabase/functions/ponto desde mig 091.
-- Schema das tabelas (ponto_employees, afd_imports, afd_events,
-- ponto_daily_summary, ponto_justificativas) também já existe.
-- ═══════════════════════════════════════════════════════════════

-- 1) Catálogo
INSERT INTO modulos (slug, nome, descricao, icone, grupo, portais, ordem, ativo)
VALUES (
  'ponto',
  'Ponto AFD',
  'Importação de AFD (Portaria 671), espelho de ponto, justificativas e dashboard de RH',
  '🕐',
  'gestao',
  ARRAY['gerente'],
  72,
  true
) ON CONFLICT (slug) DO UPDATE
  SET nome = EXCLUDED.nome,
      descricao = EXCLUDED.descricao,
      icone = EXCLUDED.icone,
      ativo = true;

-- 2) Liberar nos planos avancado e rede (mesmos planos do feature `rh`)
INSERT INTO plano_modulos (plano_id, modulo_id)
SELECT p.id, m.id
FROM planos p, modulos m
WHERE p.slug IN ('avancado', 'rede', 'prestige')
  AND m.slug = 'ponto'
ON CONFLICT DO NOTHING;

-- 3) Habilitar automaticamente em escolas que já estão nesses planos
INSERT INTO escola_modulos (escola_id, modulo_id, habilitado)
SELECT e.id, m.id, true
FROM escolas e, planos p, modulos m
WHERE e.plano_id = p.id
  AND p.slug IN ('avancado', 'rede', 'prestige')
  AND m.slug = 'ponto'
ON CONFLICT (escola_id, modulo_id) DO UPDATE
  SET habilitado = true;
