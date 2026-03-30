-- =====================================================
-- 080: Smart Notifications + Memory Book
-- =====================================================

-- 1. Notification preferences per user
CREATE TABLE IF NOT EXISTS notificacao_preferencias (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  canal text NOT NULL,               -- 'push','email','whatsapp','in_app'
  categoria text NOT NULL,           -- 'urgente','importante','informativo','administrativo'
  habilitado boolean DEFAULT true,
  horario_inicio time DEFAULT '07:00',
  horario_fim time DEFAULT '21:00',
  UNIQUE(email, canal, categoria)
);
ALTER TABLE notificacao_preferencias DISABLE ROW LEVEL SECURITY;

-- 2. Notification queue (for batching)
CREATE TABLE IF NOT EXISTS notificacao_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  destinatario_email text NOT NULL,
  canal text NOT NULL,               -- 'push','email','whatsapp'
  categoria text DEFAULT 'informativo',
  titulo text NOT NULL,
  corpo text NOT NULL,
  dados jsonb,                       -- metadata (foto_url, link, etc.)
  agendado_para timestamptz DEFAULT now(),
  enviado boolean DEFAULT false,
  enviado_em timestamptz,
  lote_id text,                      -- batch identifier for daily digest
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE notificacao_queue DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_notif_queue_pending ON notificacao_queue(destinatario_email, agendado_para) WHERE enviado = false;

-- 3. Memory book (auto-generated monthly summaries)
CREATE TABLE IF NOT EXISTS memory_books (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aluno_email text NOT NULL,
  aluno_nome text,
  mes text NOT NULL,                 -- '2026-03'
  escola_id uuid REFERENCES escolas(id),
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { fotos: [], atividades: [], marcos: [], frequencia: {} }
  total_fotos integer DEFAULT 0,
  total_atividades integer DEFAULT 0,
  gerado_em timestamptz DEFAULT now(),
  UNIQUE(aluno_email, mes)
);
ALTER TABLE memory_books DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_memory_aluno ON memory_books(aluno_email);

-- 4. Offline sync queue (for tracking pending syncs)
CREATE TABLE IF NOT EXISTS offline_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_email text NOT NULL,
  usuario_tipo text NOT NULL,
  action text NOT NULL,
  dados jsonb NOT NULL,
  status text DEFAULT 'pending',     -- 'pending','synced','conflict','failed'
  tentativas integer DEFAULT 0,
  criado_offline_em timestamptz NOT NULL,
  sincronizado_em timestamptz,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE offline_sync_log DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_offline_sync_pending ON offline_sync_log(usuario_email) WHERE status = 'pending';
