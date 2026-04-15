-- ═══════════════════════════════════════════════════════════════
--  Migration 228 — Papel Nutricionista
--
--  Adiciona papel 'nutricionista' ao RBAC. Atua via portal de
--  Equipe (secretaria.html) com acesso ao módulo Cozinha.
-- ═══════════════════════════════════════════════════════════════

-- Permissões default: acesso total ao módulo cozinha,
-- leitura aos módulos correlatos (alunos/turmas p/ ver restrições)
INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  ('nutricionista', 'cozinha',        true, true),
  ('nutricionista', 'alunos',         true, false),
  ('nutricionista', 'turmas',         true, false),
  ('nutricionista', 'dashboard',      true, false)
ON CONFLICT (papel, modulo) DO UPDATE SET
  pode_ver = EXCLUDED.pode_ver,
  pode_editar = EXCLUDED.pode_editar;

-- Sinaliza papel válido em constraints (se existir)
-- A coluna papeis é text[], então não há check constraint restritiva.
-- O gate real fica nos edge functions (authGerenteOrSecretaria).

COMMENT ON TABLE permissoes_papel IS
  'RBAC defaults por papel × módulo. Papéis suportados: gerente, diretor, secretaria, comercial, financeiro, manutencao, impressao, professora, professora_assistente, nutricionista.';
