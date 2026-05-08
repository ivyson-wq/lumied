-- ═══════════════════════════════════════════════════════════════
-- Mig 295 — acesso_alertas com fluxo de retirada (chegada → encaminhamento → saída)
-- ═══════════════════════════════════════════════════════════════
-- Tabela `acesso_alertas` é referenciada por acesso/index.ts mas nunca foi criada.
-- Cria do zero com colunas legadas + novas de fluxo.

CREATE TABLE IF NOT EXISTS acesso_alertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  evento_id uuid REFERENCES acesso_eventos(id) ON DELETE SET NULL,

  tipo text NOT NULL CHECK (tipo IN (
    'chegada_responsavel',
    'saida_aluno',
    'entrada_aluno',
    'nao_autorizado',
    'desconhecido',
    'tentativa_saida_solo'
  )),

  pessoa_nome text,
  aluno_id uuid,
  aluno_nome text,
  turma text,
  mensagem text NOT NULL,

  destinatario_tipo text NOT NULL CHECK (destinatario_tipo IN ('recepcao','professora','todos')),
  destinatario_id uuid,

  lido boolean NOT NULL DEFAULT false,
  urgente boolean NOT NULL DEFAULT false,

  status text NOT NULL DEFAULT 'aguardando' CHECK (status IN (
    'aguardando',
    'encaminhado',
    'concluido',
    'cancelado'
  )),

  responsavel_evento_id uuid REFERENCES acesso_eventos(id) ON DELETE SET NULL,
  encaminhado_em timestamptz,
  encaminhado_por uuid,
  concluido_em timestamptz,
  concluido_evento_id uuid REFERENCES acesso_eventos(id) ON DELETE SET NULL,

  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alertas_escola_criado
  ON acesso_alertas (escola_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_alertas_destinatario_lido
  ON acesso_alertas (escola_id, destinatario_tipo, lido, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_alertas_professora_destino
  ON acesso_alertas (destinatario_id, lido, criado_em DESC)
  WHERE destinatario_tipo = 'professora';

-- Índice parcial: alertas em fluxo aberto (aguardando ou encaminhado), pra match rápido na saída do aluno
CREATE INDEX IF NOT EXISTS idx_alertas_aberto_aluno
  ON acesso_alertas (escola_id, aluno_id, status, criado_em DESC)
  WHERE status IN ('aguardando','encaminhado');

-- Índice pra agrupar alertas do mesmo evento de chegada (pai com N filhos)
CREATE INDEX IF NOT EXISTS idx_alertas_responsavel_evento
  ON acesso_alertas (responsavel_evento_id)
  WHERE responsavel_evento_id IS NOT NULL;

-- Tenant isolation (mig 243-245): trigger rejeita inserts sem escola_id válido
SELECT add_tenant_isolation('acesso_alertas');
