-- =====================================================
-- 229: Cobrança — Log completo de envios + Tratativas
-- =====================================================
-- Objetivos:
--   1) Log auditável de TODO email de cobrança enviado (assunto, corpo,
--      destinatário, provider id, status, erro, aberturas).
--   2) Tratativas: observações livres dos usuários sobre cada cobrança
--      (ligações, promessas de pagamento, acordos, anotações).
-- =====================================================

-- ── 1. Extensão de regua_execucoes (log de envios) ──
ALTER TABLE regua_execucoes
  ADD COLUMN IF NOT EXISTS escola_id uuid REFERENCES escolas(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS mensalidade_id uuid,
  ADD COLUMN IF NOT EXISTS aluno_id uuid,
  ADD COLUMN IF NOT EXISTS familia_id uuid,
  ADD COLUMN IF NOT EXISTS destinatario text,
  ADD COLUMN IF NOT EXISTS assunto text,
  ADD COLUMN IF NOT EXISTS corpo text,
  ADD COLUMN IF NOT EXISTS corpo_html text,
  ADD COLUMN IF NOT EXISTS provider text DEFAULT 'resend',
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS tentativa smallint DEFAULT 1,
  ADD COLUMN IF NOT EXISTS entregue_em timestamptz,
  ADD COLUMN IF NOT EXISTS aberto_em timestamptz,
  ADD COLUMN IF NOT EXISTS clicado_em timestamptz,
  ADD COLUMN IF NOT EXISTS bounce_em timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS disparado_por uuid,       -- usuario que disparou (manual)
  ADD COLUMN IF NOT EXISTS disparado_auto boolean DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_regua_execucoes_escola      ON regua_execucoes(escola_id);
CREATE INDEX IF NOT EXISTS idx_regua_execucoes_mensalidade ON regua_execucoes(mensalidade_id);
CREATE INDEX IF NOT EXISTS idx_regua_execucoes_aluno       ON regua_execucoes(aluno_id);
CREATE INDEX IF NOT EXISTS idx_regua_execucoes_familia     ON regua_execucoes(familia_email);
CREATE INDEX IF NOT EXISTS idx_regua_execucoes_enviado_em  ON regua_execucoes(enviado_em DESC);
CREATE INDEX IF NOT EXISTS idx_regua_execucoes_status      ON regua_execucoes(status);

-- ── 2. cobranca_tratativas (observações de usuários) ──
CREATE TABLE IF NOT EXISTS cobranca_tratativas (
  id                      uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escola_id               uuid REFERENCES escolas(id) ON DELETE CASCADE,
  mensalidade_id          uuid,
  aluno_id                uuid,
  familia_email           text,

  -- quem registrou
  usuario_id              uuid,
  usuario_nome            text NOT NULL,
  usuario_papel           text,                       -- gerente, financeiro, secretaria, ...

  -- conteúdo
  tipo                    text NOT NULL DEFAULT 'nota'
                          CHECK (tipo IN (
                            'nota','ligacao','whatsapp','email_manual',
                            'reuniao','visita','promessa_pagamento',
                            'acordo','negativacao','cartorio','outros'
                          )),
  observacao              text NOT NULL,

  -- campos estruturados para tratativas específicas
  data_prevista_pagamento date,
  valor_negociado         numeric(12,2),
  resultado               text,                       -- livre: "conseguiu contato","prometeu pagar","sem resposta"...
  anexos                  jsonb DEFAULT '[]'::jsonb,  -- [{nome, url}]

  -- rastreio
  execucao_id             uuid REFERENCES regua_execucoes(id) ON DELETE SET NULL, -- opcional: vincula a um envio específico

  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),
  deleted_at              timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tratativas_escola        ON cobranca_tratativas(escola_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tratativas_mensalidade   ON cobranca_tratativas(mensalidade_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tratativas_aluno         ON cobranca_tratativas(aluno_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tratativas_familia       ON cobranca_tratativas(familia_email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tratativas_usuario       ON cobranca_tratativas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_tratativas_created       ON cobranca_tratativas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tratativas_promessa      ON cobranca_tratativas(data_prevista_pagamento)
  WHERE tipo = 'promessa_pagamento' AND deleted_at IS NULL;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION trg_tratativas_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tratativas_updated_at ON cobranca_tratativas;
CREATE TRIGGER tratativas_updated_at
  BEFORE UPDATE ON cobranca_tratativas
  FOR EACH ROW EXECUTE FUNCTION trg_tratativas_updated_at();

-- RLS: edge functions usam service role, então desabilitamos (padrão do projeto)
ALTER TABLE cobranca_tratativas DISABLE ROW LEVEL SECURITY;

-- ── 3. View consolidada: timeline de cobrança por mensalidade ──
CREATE OR REPLACE VIEW vw_cobranca_timeline AS
SELECT
  'envio'::text                AS tipo_evento,
  e.id                         AS evento_id,
  e.escola_id,
  e.mensalidade_id,
  e.aluno_id,
  e.familia_email,
  e.canal                      AS canal_ou_tipo,
  e.assunto                    AS titulo,
  e.corpo                      AS conteudo,
  e.status,
  NULL::text                   AS usuario_nome,
  e.enviado_em                 AS ocorrido_em,
  jsonb_build_object(
    'provider_message_id', e.provider_message_id,
    'aberto_em', e.aberto_em,
    'clicado_em', e.clicado_em,
    'erro_msg', e.erro_msg,
    'disparado_auto', e.disparado_auto
  )                            AS extras
FROM regua_execucoes e
UNION ALL
SELECT
  'tratativa'::text,
  t.id,
  t.escola_id,
  t.mensalidade_id,
  t.aluno_id,
  t.familia_email,
  t.tipo,
  COALESCE(t.resultado, t.tipo),
  t.observacao,
  NULL::text,
  t.usuario_nome,
  t.created_at,
  jsonb_build_object(
    'data_prevista_pagamento', t.data_prevista_pagamento,
    'valor_negociado', t.valor_negociado,
    'usuario_papel', t.usuario_papel,
    'anexos', t.anexos
  )
FROM cobranca_tratativas t
WHERE t.deleted_at IS NULL;

COMMENT ON TABLE cobranca_tratativas IS 'Log de tratativas (observações manuais) sobre cobranças — ligações, promessas, acordos, notas.';
COMMENT ON VIEW  vw_cobranca_timeline IS 'Timeline unificada: envios automáticos + tratativas manuais por mensalidade/família.';
