-- ═══════════════════════════════════════════════════════════════
--  Migration 275 — Auditoria RBAC: preenche gaps críticos
--
--  Continuação da 274. Auditoria completa em permissoes_papel achou
--  buracos onde papéis perdem o próprio sentido sem aquela permissão
--  (ex: nutricionista sem cantina/cozinha, comercial sem CRM,
--  equipe_admin sem o módulo equipe).
--  Conservador: só adiciona o que é "óbvio que faltou".
-- ═══════════════════════════════════════════════════════════════

INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  -- ── Nutricionista: sem cantina/cozinha o papel não funciona
  ('nutricionista', 'cantina',    true, true),
  ('nutricionista', 'cozinha',    true, true),
  ('nutricionista', 'compliance', true, false),   -- treinamento sanitário

  -- ── Comercial: praticamente todo o portal de vendas estava bloqueado
  ('comercial', 'crm',          true, true),
  ('comercial', 'alunos',       true, false),
  ('comercial', 'dashboard',    true, false),
  ('comercial', 'familias',     true, true),       -- matrículas
  ('comercial', 'comunicacao',  true, true),
  ('comercial', 'whatsapp',     true, true),
  ('comercial', 'atividades',   true, false),
  ('comercial', 'turmas',       true, false),
  ('comercial', 'historico_aluno', true, false),

  -- ── Impressão: precisa contexto pra saber onde entregar
  ('impressao', 'turmas',     true, false),
  ('impressao', 'alunos',     true, false),
  ('impressao', 'dashboard',  true, false),

  -- ── Equipe_admin / equipe_visualizar: ironicamente sem o próprio módulo "equipe"
  ('equipe_admin',      'equipe', true, true),
  ('equipe_visualizar', 'equipe', true, false),

  -- ── Professora: PDI/calendário são essenciais; impressão pra pedir cópia
  ('professora', 'pdi',        true, true),
  ('professora', 'calendario', true, false),
  ('professora', 'impressoes', true, true),

  -- ── Secretaria: calendário/PDI/emergência são parte do dia-a-dia
  ('secretaria', 'calendario', true, true),
  ('secretaria', 'pdi',        true, true),
  ('secretaria', 'emergencia', true, true),

  -- ── Manutenção: emergência (alarmes/incidentes) é parte de infra
  ('manutencao', 'emergencia', true, true),

  -- ── Financeiro: ver equipe pra contexto de folha
  ('financeiro', 'equipe', true, false)
ON CONFLICT (papel, modulo) DO UPDATE SET
  pode_ver = EXCLUDED.pode_ver,
  pode_editar = EXCLUDED.pode_editar;
