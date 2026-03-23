-- ══════════════════════════════════════════════════════════
--  018 — Tabela de solicitações de manutenção
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manutencoes (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  professora_id   uuid NOT NULL REFERENCES professoras(id) ON DELETE CASCADE,
  descricao       text NOT NULL,
  localizacao     text NOT NULL,
  urgencia        text NOT NULL CHECK (urgencia IN ('baixa','media','alta','critica')),
  foto_url        text,
  status          text NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente','aprovada','em_execucao','concluida','rejeitada')),
  equipe_responsavel text,
  observacao_gerente text,
  data_conclusao  date,
  criado_em       timestamptz DEFAULT now(),
  atualizado_em   timestamptz DEFAULT now()
);

-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_manutencoes_professora ON manutencoes(professora_id);
CREATE INDEX IF NOT EXISTS idx_manutencoes_status ON manutencoes(status);
CREATE INDEX IF NOT EXISTS idx_manutencoes_urgencia ON manutencoes(urgencia);

-- Desabilitar RLS (mesmo padrão das outras tabelas do projeto)
ALTER TABLE manutencoes DISABLE ROW LEVEL SECURITY;

-- Bucket para fotos de manutenção (se não existir)
-- Executar manualmente no Supabase se necessário:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('manutencoes', 'manutencoes', true) ON CONFLICT DO NOTHING;
