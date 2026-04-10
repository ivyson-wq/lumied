-- Migration 214: Novo papel "impressao" — acesso apenas ao módulo de impressões no portal da secretaria

-- Permissões RBAC default para o papel impressao:
-- Único módulo acessível: impressoes (ver + editar)
-- Todos os demais módulos ficam bloqueados por padrão
INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  ('impressao', 'impressoes', true, true)
ON CONFLICT (papel, modulo) DO NOTHING;
