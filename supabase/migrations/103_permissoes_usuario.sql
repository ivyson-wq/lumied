-- Migration 103: Per-user permission overrides + complete papel defaults

-- ── Per-user permission override table ──
CREATE TABLE IF NOT EXISTS permissoes_usuario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id UUID NOT NULL REFERENCES escolas(id),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo TEXT NOT NULL,
  pode_ver BOOLEAN DEFAULT FALSE,
  pode_editar BOOLEAN DEFAULT FALSE,
  atualizado_por TEXT,
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(usuario_id, modulo)
);
ALTER TABLE permissoes_usuario ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_perm_usuario ON permissoes_usuario(usuario_id);

-- ── Add all current modules to permissoes_papel for existing roles ──
-- Gerente: full access to all new modules
INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  ('gerente', 'alunos', true, true),
  ('gerente', 'turmas', true, true),
  ('gerente', 'notas', true, true),
  ('gerente', 'frequencia', true, true),
  ('gerente', 'comunicacao', true, true),
  ('gerente', 'crm', true, true),
  ('gerente', 'compliance', true, true),
  ('gerente', 'biblioteca', true, true),
  ('gerente', 'cantina', true, true),
  ('gerente', 'transporte', true, true),
  ('gerente', 'rh', true, true),
  ('gerente', 'whatsapp', true, true),
  ('gerente', 'loja', true, true),
  ('gerente', 'analytics', true, true),
  ('gerente', 'config', true, true),
  ('gerente', 'historico_aluno', true, true)
ON CONFLICT (papel, modulo) DO NOTHING;

-- Diretor: full access to all new modules
INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  ('diretor', 'alunos', true, true),
  ('diretor', 'turmas', true, true),
  ('diretor', 'notas', true, true),
  ('diretor', 'frequencia', true, true),
  ('diretor', 'comunicacao', true, true),
  ('diretor', 'crm', true, true),
  ('diretor', 'compliance', true, true),
  ('diretor', 'biblioteca', true, true),
  ('diretor', 'cantina', true, true),
  ('diretor', 'transporte', true, true),
  ('diretor', 'rh', true, true),
  ('diretor', 'whatsapp', true, true),
  ('diretor', 'loja', true, true),
  ('diretor', 'analytics', true, true),
  ('diretor', 'config', true, true),
  ('diretor', 'historico_aluno', true, true)
ON CONFLICT (papel, modulo) DO NOTHING;

-- Financeiro: add missing new modules (view only where appropriate)
INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  ('financeiro', 'alunos', true, false),
  ('financeiro', 'turmas', true, false),
  ('financeiro', 'notas', false, false),
  ('financeiro', 'frequencia', false, false),
  ('financeiro', 'comunicacao', false, false),
  ('financeiro', 'crm', true, false),
  ('financeiro', 'compliance', false, false),
  ('financeiro', 'biblioteca', false, false),
  ('financeiro', 'cantina', false, false),
  ('financeiro', 'transporte', false, false),
  ('financeiro', 'rh', true, false),
  ('financeiro', 'whatsapp', false, false),
  ('financeiro', 'loja', true, false),
  ('financeiro', 'analytics', true, false),
  ('financeiro', 'config', false, false),
  ('financeiro', 'historico_aluno', false, false)
ON CONFLICT (papel, modulo) DO NOTHING;

-- ── Professora defaults ──
INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  ('professora', 'dashboard', true, false),
  ('professora', 'notas', true, true),
  ('professora', 'frequencia', true, true),
  ('professora', 'comunicacao', true, true),
  ('professora', 'diplomas', true, true),
  ('professora', 'atividades', true, false),
  -- Remaining modules: no access
  ('professora', 'alunos', false, false),
  ('professora', 'turmas', false, false),
  ('professora', 'turnos', false, false),
  ('professora', 'atestados', false, false),
  ('professora', 'financeiro', false, false),
  ('professora', 'equipe', false, false),
  ('professora', 'familias', false, false),
  ('professora', 'config', false, false),
  ('professora', 'crm', false, false),
  ('professora', 'almoxarifado', false, false),
  ('professora', 'compliance', false, false),
  ('professora', 'biblioteca', false, false),
  ('professora', 'cantina', false, false),
  ('professora', 'transporte', false, false),
  ('professora', 'rh', false, false),
  ('professora', 'whatsapp', false, false),
  ('professora', 'loja', false, false),
  ('professora', 'analytics', false, false),
  ('professora', 'historico_aluno', false, false)
ON CONFLICT (papel, modulo) DO NOTHING;

-- ── Professora Assistente defaults ──
INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  ('professora_assistente', 'dashboard', true, false),
  ('professora_assistente', 'frequencia', true, true),
  ('professora_assistente', 'comunicacao', true, false),
  -- Remaining modules: no access
  ('professora_assistente', 'alunos', false, false),
  ('professora_assistente', 'turmas', false, false),
  ('professora_assistente', 'turnos', false, false),
  ('professora_assistente', 'atividades', false, false),
  ('professora_assistente', 'notas', false, false),
  ('professora_assistente', 'diplomas', false, false),
  ('professora_assistente', 'atestados', false, false),
  ('professora_assistente', 'financeiro', false, false),
  ('professora_assistente', 'equipe', false, false),
  ('professora_assistente', 'familias', false, false),
  ('professora_assistente', 'config', false, false),
  ('professora_assistente', 'crm', false, false),
  ('professora_assistente', 'almoxarifado', false, false),
  ('professora_assistente', 'compliance', false, false),
  ('professora_assistente', 'biblioteca', false, false),
  ('professora_assistente', 'cantina', false, false),
  ('professora_assistente', 'transporte', false, false),
  ('professora_assistente', 'rh', false, false),
  ('professora_assistente', 'whatsapp', false, false),
  ('professora_assistente', 'loja', false, false),
  ('professora_assistente', 'analytics', false, false),
  ('professora_assistente', 'historico_aluno', false, false)
ON CONFLICT (papel, modulo) DO NOTHING;

-- ── Secretaria defaults ──
INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  ('secretaria', 'dashboard', true, false),
  ('secretaria', 'alunos', true, true),
  ('secretaria', 'familias', true, true),
  ('secretaria', 'atestados', true, true),
  ('secretaria', 'turmas', true, false),
  ('secretaria', 'crm', true, false),
  -- Remaining modules: no access
  ('secretaria', 'turnos', false, false),
  ('secretaria', 'atividades', false, false),
  ('secretaria', 'notas', false, false),
  ('secretaria', 'frequencia', false, false),
  ('secretaria', 'comunicacao', false, false),
  ('secretaria', 'diplomas', false, false),
  ('secretaria', 'financeiro', false, false),
  ('secretaria', 'equipe', false, false),
  ('secretaria', 'config', false, false),
  ('secretaria', 'almoxarifado', false, false),
  ('secretaria', 'compliance', false, false),
  ('secretaria', 'biblioteca', false, false),
  ('secretaria', 'cantina', false, false),
  ('secretaria', 'transporte', false, false),
  ('secretaria', 'rh', false, false),
  ('secretaria', 'whatsapp', false, false),
  ('secretaria', 'loja', false, false),
  ('secretaria', 'analytics', false, false),
  ('secretaria', 'historico_aluno', false, false)
ON CONFLICT (papel, modulo) DO NOTHING;

-- ── Manutencao defaults ──
INSERT INTO permissoes_papel (papel, modulo, pode_ver, pode_editar) VALUES
  ('manutencao', 'almoxarifado', true, true),
  -- Remaining modules: no access
  ('manutencao', 'dashboard', false, false),
  ('manutencao', 'alunos', false, false),
  ('manutencao', 'turmas', false, false),
  ('manutencao', 'turnos', false, false),
  ('manutencao', 'atividades', false, false),
  ('manutencao', 'notas', false, false),
  ('manutencao', 'frequencia', false, false),
  ('manutencao', 'comunicacao', false, false),
  ('manutencao', 'diplomas', false, false),
  ('manutencao', 'atestados', false, false),
  ('manutencao', 'financeiro', false, false),
  ('manutencao', 'equipe', false, false),
  ('manutencao', 'familias', false, false),
  ('manutencao', 'config', false, false),
  ('manutencao', 'crm', false, false),
  ('manutencao', 'compliance', false, false),
  ('manutencao', 'biblioteca', false, false),
  ('manutencao', 'cantina', false, false),
  ('manutencao', 'transporte', false, false),
  ('manutencao', 'rh', false, false),
  ('manutencao', 'whatsapp', false, false),
  ('manutencao', 'loja', false, false),
  ('manutencao', 'analytics', false, false),
  ('manutencao', 'historico_aluno', false, false)
ON CONFLICT (papel, modulo) DO NOTHING;
