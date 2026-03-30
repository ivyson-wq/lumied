-- =====================================================
-- 078: LGPD Compliance
-- Consent management, data export, right to erasure
-- =====================================================

-- 1. Termos e consentimentos
CREATE TABLE IF NOT EXISTS lgpd_consentimentos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  tipo text NOT NULL,                      -- 'termos_uso','politica_privacidade','marketing','cookies','dados_sensiveis'
  versao text NOT NULL DEFAULT '1.0',
  consentido boolean NOT NULL DEFAULT true,
  ip text,
  user_agent text,
  consentido_em timestamptz DEFAULT now(),
  revogado_em timestamptz,
  UNIQUE(email, tipo, versao)
);
ALTER TABLE lgpd_consentimentos DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_lgpd_consent_email ON lgpd_consentimentos(email);

-- 2. Solicitações de dados (export/delete)
CREATE TABLE IF NOT EXISTS lgpd_solicitacoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  tipo text NOT NULL,                      -- 'exportar_dados','excluir_dados','retificar_dados'
  status text DEFAULT 'pendente',          -- 'pendente','em_processamento','concluida','recusada'
  dados_exportados jsonb,                  -- para exportação: contém todos os dados do titular
  motivo_recusa text,
  processado_por text,
  solicitado_em timestamptz DEFAULT now(),
  processado_em timestamptz
);
ALTER TABLE lgpd_solicitacoes DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_lgpd_solic_email ON lgpd_solicitacoes(email);

-- 3. Log de acesso a dados pessoais (audit trail LGPD)
CREATE TABLE IF NOT EXISTS lgpd_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_email text,
  usuario_tipo text,                       -- 'gerente','professora','admin'
  acao text NOT NULL,                      -- 'visualizou','exportou','editou','excluiu'
  tabela text NOT NULL,                    -- nome da tabela acessada
  registro_id text,                        -- ID do registro acessado
  dados_acessados text[],                  -- colunas acessadas
  ip text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE lgpd_audit_log DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_lgpd_audit_email ON lgpd_audit_log(usuario_email);
CREATE INDEX IF NOT EXISTS idx_lgpd_audit_data ON lgpd_audit_log(criado_em DESC);

-- 4. Função para exportar todos os dados de um titular
CREATE OR REPLACE FUNCTION lgpd_exportar_dados(p_email text)
RETURNS jsonb AS $$
DECLARE
  resultado jsonb := '{}'::jsonb;
  familia_data jsonb;
  aluno_data jsonb;
  notas_data jsonb;
  freq_data jsonb;
  boletos_data jsonb;
  docs_data jsonb;
BEGIN
  -- Dados da família
  SELECT jsonb_agg(to_jsonb(f) - 'id') INTO familia_data
  FROM familias f WHERE f.email = p_email;
  resultado := resultado || jsonb_build_object('familia', COALESCE(familia_data, '[]'::jsonb));

  -- Dados do aluno
  SELECT jsonb_agg(to_jsonb(a) - 'id') INTO aluno_data
  FROM alunos a WHERE a.email = p_email OR a.familia_email = p_email;
  resultado := resultado || jsonb_build_object('alunos', COALESCE(aluno_data, '[]'::jsonb));

  -- Notas
  SELECT jsonb_agg(jsonb_build_object('avaliacao', na.avaliacao_id, 'valor', nl.valor, 'conceito', nl.conceito))
  INTO notas_data
  FROM notas_lancamentos nl
  JOIN notas_avaliacoes na ON na.id = nl.avaliacao_id
  WHERE nl.aluno_email = p_email;
  resultado := resultado || jsonb_build_object('notas', COALESCE(notas_data, '[]'::jsonb));

  -- Frequência
  SELECT jsonb_agg(jsonb_build_object('data', fc.data, 'status', fr.status))
  INTO freq_data
  FROM frequencia_registros fr
  JOIN frequencia_chamadas fc ON fc.id = fr.chamada_id
  WHERE fr.aluno_email = p_email;
  resultado := resultado || jsonb_build_object('frequencia', COALESCE(freq_data, '[]'::jsonb));

  -- Boletos
  SELECT jsonb_agg(to_jsonb(b) - 'id') INTO boletos_data
  FROM boletos b WHERE b.pagador_email = p_email;
  resultado := resultado || jsonb_build_object('boletos', COALESCE(boletos_data, '[]'::jsonb));

  -- Documentos gerados
  SELECT jsonb_agg(jsonb_build_object('tipo', d.tipo, 'gerado_em', d.gerado_em))
  INTO docs_data
  FROM documentos_gerados d WHERE d.aluno_email = p_email;
  resultado := resultado || jsonb_build_object('documentos', COALESCE(docs_data, '[]'::jsonb));

  -- Consentimentos
  resultado := resultado || jsonb_build_object('consentimentos',
    COALESCE((SELECT jsonb_agg(to_jsonb(c) - 'id') FROM lgpd_consentimentos c WHERE c.email = p_email), '[]'::jsonb));

  RETURN resultado;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Função para anonimizar dados de um titular (direito ao esquecimento)
CREATE OR REPLACE FUNCTION lgpd_anonimizar(p_email text)
RETURNS integer AS $$
DECLARE
  affected integer := 0;
  d integer;
BEGIN
  -- Anonimizar famílias
  UPDATE familias SET nome_responsavel = 'ANONIMIZADO', nome_aluno = 'ANONIMIZADO', cpf = NULL, telefone = NULL
  WHERE email = p_email; GET DIAGNOSTICS d = ROW_COUNT; affected := affected + d;

  -- Anonimizar alunos
  UPDATE alunos SET nome = 'ANONIMIZADO', ativo = false
  WHERE email = p_email OR familia_email = p_email; GET DIAGNOSTICS d = ROW_COUNT; affected := affected + d;

  -- Anonimizar notas (manter valores, remover identificação)
  UPDATE notas_lancamentos SET aluno_nome = 'ANONIMIZADO'
  WHERE aluno_email = p_email; GET DIAGNOSTICS d = ROW_COUNT; affected := affected + d;

  -- Anonimizar frequência
  UPDATE frequencia_registros SET aluno_nome = 'ANONIMIZADO'
  WHERE aluno_email = p_email; GET DIAGNOSTICS d = ROW_COUNT; affected := affected + d;

  -- Revogar consentimentos
  UPDATE lgpd_consentimentos SET revogado_em = now()
  WHERE email = p_email AND revogado_em IS NULL; GET DIAGNOSTICS d = ROW_COUNT; affected := affected + d;

  -- Remover sessões
  DELETE FROM aluno_sessoes WHERE aluno_id IN (SELECT id FROM alunos_login WHERE email = p_email);

  -- Log
  INSERT INTO lgpd_audit_log (usuario_email, acao, tabela, dados_acessados)
  VALUES (p_email, 'anonimizou', 'multiple', ARRAY['nome','cpf','telefone']);

  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
