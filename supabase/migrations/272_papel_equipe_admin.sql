-- ═══════════════════════════════════════════════════════════════
--  Migration 272 — Papéis equipe_admin e equipe_visualizar
--
--  Granularidade pra gerenciar atividades extras + turmas pela equipe
--  sem dar acesso de gerente. equipe_admin pode criar/editar/desativar;
--  equipe_visualizar só lê.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  -- equipe_admin: cria/edita atividades e turmas
  ('equipe_admin', 'turmas',       true, true),
  ('equipe_admin', 'atividades',   true, true),
  ('equipe_admin', 'alunos',       true, false),
  ('equipe_admin', 'dashboard',    true, false),
  -- equipe_visualizar: somente leitura
  ('equipe_visualizar', 'turmas',     true, false),
  ('equipe_visualizar', 'atividades', true, false),
  ('equipe_visualizar', 'alunos',     true, false),
  ('equipe_visualizar', 'dashboard',  true, false)
ON CONFLICT (papel, modulo) DO UPDATE SET
  pode_ver = EXCLUDED.pode_ver,
  pode_editar = EXCLUDED.pode_editar;

COMMENT ON TABLE permissoes_papel IS
  'RBAC defaults por papel × módulo. Papéis suportados: gerente, diretor, secretaria, comercial, financeiro, manutencao, impressao, professora, professora_assistente, nutricionista, almoxarifado, equipe_admin, equipe_visualizar.';
