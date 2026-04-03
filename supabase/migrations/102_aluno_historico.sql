-- ═══════════════════════════════════════════════════════════════
--  Migration 102: Histórico de Interações do Aluno
--  Atas, ocorrências, registros de acompanhamento
--  Acesso restrito: coordenação e direção
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS aluno_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id UUID NOT NULL REFERENCES escolas(id),

  -- Aluno referenciado
  aluno_email TEXT,                 -- email do aluno (se tiver)
  aluno_nome TEXT NOT NULL,         -- nome do aluno
  turma TEXT,                       -- turma/série no momento do registro

  -- Conteúdo
  tipo TEXT NOT NULL CHECK (tipo IN (
    'ata_ocorrencia',               -- Ata de ocorrência comportamental
    'acompanhamento_pedagogico',    -- Registro de acompanhamento pedagógico
    'reuniao_responsaveis',         -- Ata de reunião com pais/responsáveis
    'encaminhamento',               -- Encaminhamento para especialista
    'observacao',                   -- Observação geral da coordenação
    'documento_whatsapp'            -- Documento recebido via WhatsApp
  )),
  titulo TEXT NOT NULL,
  descricao TEXT,
  arquivo_url TEXT,                 -- URL do documento/foto anexo
  wa_documento_id UUID REFERENCES wa_documentos(id),  -- Link com doc recebido via WhatsApp

  -- Quem registrou
  registrado_por TEXT NOT NULL,     -- Nome de quem registrou
  registrado_por_papel TEXT CHECK (registrado_por_papel IN ('coordenacao', 'direcao', 'secretaria')),

  -- Visibilidade (restrito por padrão)
  visivel_para TEXT[] DEFAULT ARRAY['coordenacao', 'direcao'],

  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_aluno_historico_escola ON aluno_historico(escola_id);
CREATE INDEX IF NOT EXISTS idx_aluno_historico_aluno ON aluno_historico(aluno_nome);
CREATE INDEX IF NOT EXISTS idx_aluno_historico_email ON aluno_historico(aluno_email);
CREATE INDEX IF NOT EXISTS idx_aluno_historico_tipo ON aluno_historico(tipo);

-- RLS: acesso restrito
ALTER TABLE aluno_historico ENABLE ROW LEVEL SECURITY;

-- Atualizar wa_documentos para incluir ata_aluno
ALTER TABLE wa_documentos DROP CONSTRAINT IF EXISTS wa_documentos_classificacao_check;
ALTER TABLE wa_documentos ADD CONSTRAINT wa_documentos_classificacao_check CHECK (classificacao IN (
  'atestado_medico', 'certificacao', 'politica', 'inspecao',
  'documento_aluno', 'ata_aluno', 'contrato', 'nota_fiscal',
  'comprovante', 'comunicado', 'ata_reuniao', 'relatorio', 'outro'
));
