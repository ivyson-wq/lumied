-- Migration 110: Unificar tabelas de usuarios
-- Consolida gerentes/professoras/secretarias → usuarios
-- Consolida gerente_sessoes/professora_sessoes/secretaria_sessoes → sessoes
-- Mantém tabelas legadas como views para backwards compatibility

-- ═══════════════════════════════════════════════════════
-- 1. Garantir que usuarios tem todos os registros atualizados
-- ═══════════════════════════════════════════════════════

-- Adicionar campos extras em usuarios que existem nas tabelas legadas
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS serie_id uuid REFERENCES series(id);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS series_monitoras text[] DEFAULT '{}';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();

-- Resync gerentes → usuarios
INSERT INTO usuarios (id, nome, email, senha_hash, papel, escola_id, criado_em)
SELECT id, nome, email, senha_hash, 'gerente', escola_id, criado_em
FROM gerentes
WHERE email IS NOT NULL AND email != ''
ON CONFLICT (email) DO UPDATE SET
  nome = EXCLUDED.nome,
  senha_hash = CASE WHEN EXCLUDED.senha_hash != '' THEN EXCLUDED.senha_hash ELSE usuarios.senha_hash END,
  escola_id = COALESCE(EXCLUDED.escola_id, usuarios.escola_id),
  atualizado_em = now();

-- Resync professoras → usuarios
INSERT INTO usuarios (id, nome, email, senha_hash, papel, tipo, serie_id, series_monitoras, escola_id, criado_em)
SELECT id, nome, email, COALESCE(senha_hash, ''),
  CASE WHEN tipo = 'manutencao' THEN 'manutencao'
       WHEN tipo = 'professora_assistente' THEN 'professora_assistente'
       ELSE 'professora' END,
  tipo, serie_id, series_monitoras, escola_id, criado_em
FROM professoras
WHERE email IS NOT NULL AND email != ''
ON CONFLICT (email) DO UPDATE SET
  nome = EXCLUDED.nome,
  senha_hash = CASE WHEN EXCLUDED.senha_hash != '' THEN EXCLUDED.senha_hash ELSE usuarios.senha_hash END,
  tipo = COALESCE(EXCLUDED.tipo, usuarios.tipo),
  serie_id = COALESCE(EXCLUDED.serie_id, usuarios.serie_id),
  series_monitoras = COALESCE(EXCLUDED.series_monitoras, usuarios.series_monitoras),
  escola_id = COALESCE(EXCLUDED.escola_id, usuarios.escola_id),
  atualizado_em = now();

-- Resync secretarias → usuarios
INSERT INTO usuarios (id, nome, email, senha_hash, papel, escola_id, criado_em)
SELECT id, nome, email, senha_hash, 'secretaria', escola_id, criado_em
FROM secretarias
WHERE email IS NOT NULL AND email != ''
ON CONFLICT (email) DO UPDATE SET
  nome = EXCLUDED.nome,
  senha_hash = CASE WHEN EXCLUDED.senha_hash != '' THEN EXCLUDED.senha_hash ELSE usuarios.senha_hash END,
  escola_id = COALESCE(EXCLUDED.escola_id, usuarios.escola_id),
  atualizado_em = now();

-- Garantir IDs sincronizados (usuarios.id = gerentes.id etc)
UPDATE usuarios u SET id = g.id FROM gerentes g WHERE u.email = g.email AND u.id != g.id;
UPDATE usuarios u SET id = p.id FROM professoras p WHERE u.email = p.email AND u.id != p.id;
UPDATE usuarios u SET id = s.id FROM secretarias s WHERE u.email = s.email AND u.id != s.id;

-- ═══════════════════════════════════════════════════════
-- 2. Tabela unificada de sessões
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sessoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token text NOT NULL,
  expira_em timestamptz NOT NULL,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE sessoes DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_sessoes_token ON sessoes(token);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_sessoes_expira ON sessoes(expira_em);

-- Migrar sessões existentes
INSERT INTO sessoes (usuario_id, token, expira_em, criado_em)
SELECT gerente_id, token, expira_em, criado_em FROM gerente_sessoes
WHERE gerente_id IN (SELECT id FROM usuarios)
ON CONFLICT DO NOTHING;

INSERT INTO sessoes (usuario_id, token, expira_em, criado_em)
SELECT professora_id, token, expira_em, criado_em FROM professora_sessoes
WHERE professora_id IN (SELECT id FROM usuarios)
ON CONFLICT DO NOTHING;

INSERT INTO sessoes (usuario_id, token, expira_em, criado_em)
SELECT secretaria_id, token, expira_em, criado_em FROM secretaria_sessoes
WHERE secretaria_id IN (SELECT id FROM usuarios)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════
-- 3. Adicionar usuario_id FK nas tabelas dependentes
-- ═══════════════════════════════════════════════════════

-- Para cada tabela, usar DO block para tolerância a tabelas/colunas inexistentes
-- Macro: add usuario_id + copy from legacy column

DO $$ BEGIN ALTER TABLE diplomas_professoras ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id) ON DELETE CASCADE; UPDATE diplomas_professoras SET usuario_id = professora_id WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE atestados_professoras ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id) ON DELETE CASCADE; UPDATE atestados_professoras SET usuario_id = professora_id WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE pdis ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id) ON DELETE CASCADE; UPDATE pdis SET usuario_id = professora_id WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE alm_requisicoes ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id) ON DELETE CASCADE; UPDATE alm_requisicoes SET usuario_id = professora_id WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE alm_notificacoes ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id) ON DELETE CASCADE; UPDATE alm_notificacoes SET usuario_id = professora_id WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notas_disciplinas ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id); UPDATE notas_disciplinas SET usuario_id = professora_id WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notas_lancamentos ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id); UPDATE notas_lancamentos SET usuario_id = lancado_por WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE frequencia_chamadas ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id); UPDATE frequencia_chamadas SET usuario_id = professora_id WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE relatorios_pedagogicos ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id); UPDATE relatorios_pedagogicos SET usuario_id = professora_id WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE agenda_digital_aulas ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id); UPDATE agenda_digital_aulas SET usuario_id = professora_id WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE relatorios_bncc ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id); UPDATE relatorios_bncc SET usuario_id = professora_id WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE banco_provas_questoes ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id); UPDATE banco_provas_questoes SET usuario_id = criado_por WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE banco_provas_simulados ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id); UPDATE banco_provas_simulados SET usuario_id = criado_por WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE impressoes ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id) ON DELETE CASCADE; UPDATE impressoes SET usuario_id = professora_id WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE ead_aulas ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id); UPDATE ead_aulas SET usuario_id = professora_id WHERE usuario_id IS NULL; EXCEPTION WHEN undefined_table THEN NULL; WHEN undefined_column THEN NULL; END $$;

-- onboarding_push_eventos (may not exist in all envs)
DO $$ BEGIN
  ALTER TABLE onboarding_push_eventos ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id) ON DELETE CASCADE;
  UPDATE onboarding_push_eventos SET usuario_id = professora_id WHERE usuario_id IS NULL AND professora_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- compliance tables
DO $$ BEGIN
  ALTER TABLE compliance_horarios ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id) ON DELETE CASCADE;
  UPDATE compliance_horarios SET usuario_id = professora_id WHERE usuario_id IS NULL AND professora_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE compliance_ponto_registros ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id);
  UPDATE compliance_ponto_registros SET usuario_id = professora_id WHERE usuario_id IS NULL AND professora_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE compliance_ocorrencias ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id);
  UPDATE compliance_ocorrencias SET usuario_id = professora_id WHERE usuario_id IS NULL AND professora_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE compliance_faltas ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id);
  UPDATE compliance_faltas SET usuario_id = professora_id WHERE usuario_id IS NULL AND professora_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE compliance_ciencias ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id);
  UPDATE compliance_ciencias SET usuario_id = professora_id WHERE usuario_id IS NULL AND professora_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE compliance_quiz_atribuicoes ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id);
  UPDATE compliance_quiz_atribuicoes SET usuario_id = professora_id WHERE usuario_id IS NULL AND professora_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════
-- 4. Triggers para manter sincronização bidirecional
--    (enquanto código legado ainda usa tabelas antigas)
-- ═══════════════════════════════════════════════════════

-- Sync usuarios → gerentes (quando papel = 'gerente')
CREATE OR REPLACE FUNCTION sync_usuario_to_legacy()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.papel = 'gerente' THEN
    INSERT INTO gerentes (id, nome, email, senha_hash, escola_id, criado_em)
    VALUES (NEW.id, NEW.nome, NEW.email, NEW.senha_hash, NEW.escola_id, NEW.criado_em)
    ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, escola_id = EXCLUDED.escola_id;
  ELSIF NEW.papel IN ('professora', 'professora_assistente', 'manutencao') THEN
    INSERT INTO professoras (id, nome, email, senha_hash, tipo, serie_id, series_monitoras, escola_id, criado_em)
    VALUES (NEW.id, NEW.nome, NEW.email, NEW.senha_hash, COALESCE(NEW.tipo, NEW.papel), NEW.serie_id, COALESCE(NEW.series_monitoras, '{}'), NEW.escola_id, NEW.criado_em)
    ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, tipo = EXCLUDED.tipo, serie_id = EXCLUDED.serie_id, series_monitoras = EXCLUDED.series_monitoras, escola_id = EXCLUDED.escola_id;
  ELSIF NEW.papel = 'secretaria' THEN
    INSERT INTO secretarias (id, nome, email, senha_hash, escola_id, criado_em)
    VALUES (NEW.id, NEW.nome, NEW.email, NEW.senha_hash, NEW.escola_id, NEW.criado_em)
    ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, escola_id = EXCLUDED.escola_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_usuario_legacy ON usuarios;
CREATE TRIGGER trg_sync_usuario_legacy
  AFTER INSERT OR UPDATE ON usuarios
  FOR EACH ROW
  EXECUTE FUNCTION sync_usuario_to_legacy();

-- Sync sessoes → legacy session tables
CREATE OR REPLACE FUNCTION sync_sessao_to_legacy()
RETURNS TRIGGER AS $$
DECLARE
  v_papel text;
BEGIN
  SELECT papel INTO v_papel FROM usuarios WHERE id = NEW.usuario_id;
  IF v_papel = 'gerente' THEN
    INSERT INTO gerente_sessoes (gerente_id, token, expira_em, criado_em)
    VALUES (NEW.usuario_id, NEW.token, NEW.expira_em, NEW.criado_em)
    ON CONFLICT DO NOTHING;
  ELSIF v_papel IN ('professora', 'professora_assistente', 'manutencao') THEN
    INSERT INTO professora_sessoes (professora_id, token, expira_em, criado_em)
    VALUES (NEW.usuario_id, NEW.token, NEW.expira_em, NEW.criado_em)
    ON CONFLICT DO NOTHING;
  ELSIF v_papel = 'secretaria' THEN
    INSERT INTO secretaria_sessoes (secretaria_id, token, expira_em, criado_em)
    VALUES (NEW.usuario_id, NEW.token, NEW.expira_em, NEW.criado_em)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_sessao_legacy ON sessoes;
CREATE TRIGGER trg_sync_sessao_legacy
  AFTER INSERT ON sessoes
  FOR EACH ROW
  EXECUTE FUNCTION sync_sessao_to_legacy();

-- ═══════════════════════════════════════════════════════
-- 5. Cron: limpar sessões expiradas da tabela unificada
-- ═══════════════════════════════════════════════════════
-- (O cron existente em 076 já limpa as tabelas legadas)
-- Adicionar limpeza da nova tabela quando cron disponível
