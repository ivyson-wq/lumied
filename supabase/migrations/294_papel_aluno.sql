-- Migration 294: Papel 'aluno' em usuarios.papeis
-- Unifica login do aluno com magic link da família. aluno.html é aposentado;
-- portal único é familia.html, com aba "Aluno" e RBAC frontend filtrando abas.
--
-- Estratégia conservadora — não toca em alunos_login/aluno_sessoes (mantidos
-- para o login antigo via senha durante o piloto).

-- ═══════════════════════════════════════════════════════════════
-- 1. Backfill — alunos existentes em alunos_login viram usuarios com papel 'aluno'
-- ═══════════════════════════════════════════════════════════════

INSERT INTO usuarios (id, nome, email, senha_hash, papel, papeis, tipo, escola_id, criado_em)
SELECT
  al.id,
  al.aluno_nome,
  al.email,
  COALESCE(al.senha_hash, ''),
  'aluno',
  ARRAY['aluno']::text[],
  'aluno',
  a.escola_id,
  al.criado_em
FROM alunos_login al
LEFT JOIN alunos a ON a.email = al.email
WHERE al.email IS NOT NULL AND al.email != ''
ON CONFLICT (email) DO UPDATE SET
  papeis = CASE
    WHEN 'aluno' = ANY(usuarios.papeis) THEN usuarios.papeis
    ELSE array_append(usuarios.papeis, 'aluno')
  END,
  atualizado_em = now();

-- ═══════════════════════════════════════════════════════════════
-- 2. Trigger — novos registros em alunos_login sincronizam para usuarios
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sync_aluno_login_to_usuarios()
RETURNS TRIGGER AS $$
DECLARE
  v_escola_id uuid;
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' THEN
    RETURN NEW;
  END IF;

  SELECT escola_id INTO v_escola_id FROM alunos WHERE email = NEW.email LIMIT 1;

  INSERT INTO usuarios (id, nome, email, senha_hash, papel, papeis, tipo, escola_id, criado_em)
  VALUES (
    NEW.id, NEW.aluno_nome, NEW.email, COALESCE(NEW.senha_hash, ''),
    'aluno', ARRAY['aluno']::text[], 'aluno', v_escola_id, NEW.criado_em
  )
  ON CONFLICT (email) DO UPDATE SET
    nome = EXCLUDED.nome,
    papeis = CASE
      WHEN 'aluno' = ANY(usuarios.papeis) THEN usuarios.papeis
      ELSE array_append(usuarios.papeis, 'aluno')
    END,
    atualizado_em = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_aluno_login_usuarios ON alunos_login;
CREATE TRIGGER trg_sync_aluno_login_usuarios
  AFTER INSERT OR UPDATE ON alunos_login
  FOR EACH ROW
  EXECUTE FUNCTION sync_aluno_login_to_usuarios();

-- ═══════════════════════════════════════════════════════════════
-- 3. Trigger — aluno marcado inativo em alunos_login remove papel 'aluno' do usuario
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sync_aluno_login_inactive()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.ativo = true AND NEW.ativo = false THEN
    UPDATE usuarios
       SET papeis = array_remove(papeis, 'aluno'),
           atualizado_em = now()
     WHERE email = NEW.email;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_aluno_login_inactive ON alunos_login;
CREATE TRIGGER trg_sync_aluno_login_inactive
  AFTER UPDATE OF ativo ON alunos_login
  FOR EACH ROW
  EXECUTE FUNCTION sync_aluno_login_inactive();

COMMENT ON COLUMN usuarios.papeis IS 'Papéis válidos: gerente, professora, professora_assistente, secretaria, comercial, manutencao, diretor, financeiro, nutricionista, almoxarifado, aluno';
