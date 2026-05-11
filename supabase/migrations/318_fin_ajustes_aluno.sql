-- ══════════════════════════════════════════════════════════════
--  318 — Ajustes recorrentes por aluno (descontos, bolsas, acréscimos)
--  Aplicados automaticamente na geração de cada lote de boletos.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fin_ajustes_aluno (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escola_id uuid NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
  aluno_id uuid NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
  aluno_nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('desconto_fixo','desconto_percentual','acrescimo_fixo')),
  valor numeric NOT NULL CHECK (valor >= 0),
  descricao text NOT NULL,
  categoria_aplicacao text NOT NULL DEFAULT 'total'
    CHECK (categoria_aplicacao IN ('mensalidade','alimentacao','total')),
  ativo boolean NOT NULL DEFAULT true,
  data_inicio date NOT NULL DEFAULT CURRENT_DATE,
  data_fim date,
  criado_por text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fin_ajustes_aluno_escola ON fin_ajustes_aluno(escola_id);
CREATE INDEX idx_fin_ajustes_aluno_aluno ON fin_ajustes_aluno(aluno_id) WHERE ativo = true;
SELECT add_tenant_isolation('fin_ajustes_aluno');
