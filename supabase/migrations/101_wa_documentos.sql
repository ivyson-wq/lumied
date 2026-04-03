-- ═══════════════════════════════════════════════════════════════
--  Migration 101: WhatsApp Document Intake
--  Staff envia documentos via WhatsApp → classificação IA → arquivamento
-- ═══════════════════════════════════════════════════════════════

-- Tabela de documentos recebidos via WhatsApp
CREATE TABLE IF NOT EXISTS wa_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id UUID NOT NULL REFERENCES escolas(id),
  remetente_whatsapp TEXT NOT NULL,
  remetente_nome TEXT,
  remetente_papel TEXT CHECK (remetente_papel IN ('coordenacao', 'direcao', 'secretaria', 'professor', 'outro')),

  -- Arquivo original
  media_id TEXT,                    -- Meta media ID (para download)
  media_type TEXT NOT NULL,         -- image/jpeg, application/pdf, etc.
  arquivo_url TEXT,                 -- URL no Supabase Storage após upload
  arquivo_nome TEXT,                -- Nome original do arquivo
  arquivo_tamanho_kb INTEGER,

  -- Classificação IA
  classificacao TEXT CHECK (classificacao IN (
    'atestado_medico',
    'certificacao',
    'politica',
    'inspecao',
    'documento_aluno',
    'contrato',
    'nota_fiscal',
    'comprovante',
    'comunicado',
    'ata_reuniao',
    'relatorio',
    'outro'
  )),
  classificacao_confianca REAL,     -- 0.0 a 1.0
  classificacao_motivo TEXT,        -- Explicação da IA
  destino_sugerido TEXT,            -- Ex: "compliance_certificacoes", "atestados_professoras"
  destino_id UUID,                  -- ID do registro criado no destino final

  -- Contexto extraído pela IA
  contexto JSONB DEFAULT '{}',     -- { "pessoa": "Maria", "tipo": "Primeiros Socorros", "validade": "2027-01-15" }

  -- Status do fluxo
  status TEXT NOT NULL DEFAULT 'pendente_classificacao' CHECK (status IN (
    'pendente_classificacao',       -- Acabou de chegar, aguardando IA
    'aguardando_confirmacao',       -- IA classificou, aguardando user confirmar
    'confirmado',                   -- User confirmou, documento arquivado
    'rejeitado',                    -- User rejeitou classificação
    'reclassificado',               -- User escolheu outra classificação
    'erro'                          -- Erro no processamento
  )),

  -- Mensagem WhatsApp de contexto (texto que acompanhou o doc)
  mensagem_contexto TEXT,

  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Index para busca rápida
CREATE INDEX IF NOT EXISTS idx_wa_documentos_escola ON wa_documentos(escola_id);
CREATE INDEX IF NOT EXISTS idx_wa_documentos_status ON wa_documentos(status);
CREATE INDEX IF NOT EXISTS idx_wa_documentos_remetente ON wa_documentos(remetente_whatsapp);

-- Registrar staff autorizado a enviar documentos via WhatsApp
CREATE TABLE IF NOT EXISTS wa_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id UUID NOT NULL REFERENCES escolas(id),
  whatsapp TEXT NOT NULL,
  nome TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('coordenacao', 'direcao', 'secretaria', 'professor', 'outro')),
  ativo BOOLEAN DEFAULT TRUE,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(escola_id, whatsapp)
);

-- RLS
ALTER TABLE wa_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_staff ENABLE ROW LEVEL SECURITY;
