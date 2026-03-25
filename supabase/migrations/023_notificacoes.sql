-- Tabela unificada de notificações para todos os portais
CREATE TABLE IF NOT EXISTS notificacoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  portal text NOT NULL,              -- 'professora', 'secretaria', 'gerente', 'pais'
  destinatario text NOT NULL,        -- email ou ID do destinatário
  titulo text NOT NULL,
  mensagem text NOT NULL,
  tipo text DEFAULT 'info',          -- 'info', 'success', 'warning', 'error'
  lida boolean DEFAULT false,
  criado_em timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_dest ON notificacoes (portal, destinatario, lida);

ALTER TABLE notificacoes DISABLE ROW LEVEL SECURITY;
