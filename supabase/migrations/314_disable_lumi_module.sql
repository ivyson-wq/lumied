-- ══════════════════════════════════════════════════════════════
--  314 — Lumi IA como módulo togglável + desabilitada por padrão
--  Adiciona módulo lumi_ia à tabela modulos para controle via admin.
--  NÃO adicionado a plano_modulos: desabilitado para todas as escolas.
--  Ativa kill_switch_ia como safety net no backend.
-- ══════════════════════════════════════════════════════════════

-- 1. Módulo lumi_ia
INSERT INTO modulos (slug, nome, descricao, icone, grupo, portais, ordem, ativo)
VALUES (
  'lumi_ia',
  'Lumi — Assistente IA',
  'Assistente IA nativo em todos os portais (perguntas, insights, MCP)',
  '✨',
  'comunicacao',
  ARRAY['gerente','professora','pais','secretaria','aluno'],
  35,
  true
) ON CONFLICT (slug) DO NOTHING;

-- 2. Ativa kill_switch_ia (desliga chamadas Anthropic no backend)
UPDATE feature_flags SET ativo = true WHERE chave = 'kill_switch_ia';
