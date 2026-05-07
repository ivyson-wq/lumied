-- ═══════════════════════════════════════════════════════════════
--  Migration 274 — Preenche gaps do RBAC default para manutencao/impressoes
--
--  Sintoma: usuários com papéis [secretaria, manutencao] não conseguem
--  acessar os módulos "manutencao" e "impressoes" porque permissoes_papel
--  só tem entrada para o papel 'gerente'. Resultado: dropEduc/Lumied dá
--  403 silencioso ou tela vazia (#14 do backlog — caso Heloisa).
-- ═══════════════════════════════════════════════════════════════

INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  -- papel 'manutencao': obviamente precisa do módulo manutencao
  ('manutencao', 'manutencao', true, true),
  ('manutencao', 'impressoes', true, false),     -- consegue ver pedidos pra contexto

  -- papel 'secretaria': normalmente lida com manutenção e impressão na escola
  ('secretaria', 'manutencao', true, true),
  ('secretaria', 'impressoes', true, true),

  -- papel 'comercial': contexto de manutenção (read-only) só pra atendimento
  ('comercial', 'manutencao', true, false),

  -- papel 'impressao': obviamente precisa do módulo impressoes
  ('impressao', 'impressoes', true, true)
ON CONFLICT (papel, modulo) DO UPDATE SET
  pode_ver = EXCLUDED.pode_ver,
  pode_editar = EXCLUDED.pode_editar;

-- Documenta no comentário da tabela
COMMENT ON TABLE permissoes_papel IS
  'RBAC defaults por papel × módulo. Papéis: gerente, diretor, secretaria, comercial, financeiro, manutencao, impressao, professora, professora_assistente, nutricionista, almoxarifado, equipe_admin, equipe_visualizar. Override individual via permissoes_usuario.';
