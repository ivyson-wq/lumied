-- =====================================================
-- 055: Comunicação / Chat escola-família
-- =====================================================

CREATE TABLE IF NOT EXISTS chat_conversas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo text NOT NULL DEFAULT 'direta',   -- 'direta','grupo','turma','aviso'
  titulo text,                            -- para grupos/turmas
  serie_id uuid REFERENCES series(id),   -- para tipo 'turma'
  criado_por_tipo text,                   -- 'gerente','professora','secretaria','pais'
  criado_por_id text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE chat_conversas DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS chat_participantes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversa_id uuid NOT NULL REFERENCES chat_conversas(id) ON DELETE CASCADE,
  usuario_tipo text NOT NULL,             -- 'gerente','professora','secretaria','pais'
  usuario_id text NOT NULL,               -- email ou UUID
  usuario_nome text,
  papel text DEFAULT 'membro',            -- 'membro','admin'
  silenciado boolean DEFAULT false,
  UNIQUE(conversa_id, usuario_tipo, usuario_id)
);
ALTER TABLE chat_participantes DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS chat_mensagens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversa_id uuid NOT NULL REFERENCES chat_conversas(id) ON DELETE CASCADE,
  remetente_tipo text NOT NULL,
  remetente_id text NOT NULL,
  remetente_nome text,
  conteudo text NOT NULL,
  tipo_msg text DEFAULT 'texto',          -- 'texto','imagem','arquivo','aviso'
  arquivo_url text,
  requer_aprovacao boolean DEFAULT false,
  aprovada boolean DEFAULT true,
  aprovada_por text,
  editada boolean DEFAULT false,
  excluida boolean DEFAULT false,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE chat_mensagens DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS chat_leituras (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversa_id uuid NOT NULL REFERENCES chat_conversas(id) ON DELETE CASCADE,
  usuario_tipo text NOT NULL,
  usuario_id text NOT NULL,
  ultima_leitura timestamptz DEFAULT now(),
  UNIQUE(conversa_id, usuario_tipo, usuario_id)
);
ALTER TABLE chat_leituras DISABLE ROW LEVEL SECURITY;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_chat_msg_conversa ON chat_mensagens(conversa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_chat_part_usuario ON chat_participantes(usuario_tipo, usuario_id);
