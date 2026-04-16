-- ═══════════════════════════════════════════════════════════════
--  Migration 249 — Papel Almoxarifado
--
--  Adiciona papel 'almoxarifado' ao RBAC. Atua via portal de Equipe
--  (secretaria.html) com acesso ao módulo Almoxarifado:
--    • Pode: visualizar catálogo, pendentes, todas requisições, painel,
--            aprovar/rejeitar requisições, ver compras, marcar comprado,
--            encaminhar compra, ver orçamentos (READ-ONLY), gerar PDFs.
--    • NÃO pode: definir orçamento, editar catálogo (insumos/turmas),
--                atualização em massa de preços, criar req em nome de prof.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  ('almoxarifado', 'almoxarifado',      true, true),    -- operação diária
  ('almoxarifado', 'alunos',            true, false),   -- contexto
  ('almoxarifado', 'turmas',            true, false),   -- contexto
  ('almoxarifado', 'dashboard',         true, false)
ON CONFLICT (papel, modulo) DO UPDATE SET
  pode_ver = EXCLUDED.pode_ver,
  pode_editar = EXCLUDED.pode_editar;

COMMENT ON TABLE permissoes_papel IS
  'RBAC defaults por papel × módulo. Papéis suportados: gerente, diretor, secretaria, comercial, financeiro, manutencao, impressao, professora, professora_assistente, nutricionista, almoxarifado.';
