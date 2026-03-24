-- Migration 011: PDI – Plano de Desenvolvimento Individual das Professoras

-- 1. Ciclos anuais (criados pela gestora)
CREATE TABLE IF NOT EXISTS pdi_ciclos (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  nome        text        NOT NULL,          -- ex: "PDI 2026"
  ano         integer     NOT NULL,
  data_inicio date        NOT NULL,
  data_fim    date        NOT NULL,
  ativo       boolean     DEFAULT true,
  criado_por  text        NOT NULL,          -- nome da gestora
  criado_em   timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pdi_ciclos_ano_ativo
  ON pdi_ciclos(ano) WHERE ativo = true;

-- 2. Um PDI por professora por ciclo
CREATE TABLE IF NOT EXISTS pdis (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  professora_id     uuid        REFERENCES professoras(id) ON DELETE CASCADE NOT NULL,
  ciclo_id          uuid        REFERENCES pdi_ciclos(id) ON DELETE CASCADE NOT NULL,
  status            text        DEFAULT 'rascunho'
                                  CHECK (status IN (
                                    'rascunho',
                                    'aguardando_aprovacao',
                                    'em_andamento',
                                    'encerrado'
                                  )),
  -- campos de encerramento
  feedback_gestora  text,
  nota_final        integer     CHECK (nota_final BETWEEN 1 AND 4),
  -- timestamps de workflow
  submetido_em      timestamptz,
  aprovado_em       timestamptz,
  encerrado_em      timestamptz,
  criado_em         timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pdis_prof_ciclo
  ON pdis(professora_id, ciclo_id);

CREATE INDEX IF NOT EXISTS idx_pdis_professora ON pdis(professora_id);
CREATE INDEX IF NOT EXISTS idx_pdis_ciclo       ON pdis(ciclo_id);
CREATE INDEX IF NOT EXISTS idx_pdis_status      ON pdis(status);

-- 3. Avaliação por competência (7 áreas) – uma linha por área por PDI
--    Preenchida pela professora na autoavaliação; gestora preenche nota_gestora depois
CREATE TABLE IF NOT EXISTS pdi_competencias (
  id             uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  pdi_id         uuid    REFERENCES pdis(id) ON DELETE CASCADE NOT NULL,
  area           text    NOT NULL
                           CHECK (area IN (
                             'linguagem',
                             'metodologia',
                             'avaliacao',
                             'intercultural',
                             'colaboracao',
                             'inovacao',
                             'desenvolvimento'
                           )),
  nota_auto      integer CHECK (nota_auto      BETWEEN 1 AND 4),
  nota_gestora   integer CHECK (nota_gestora   BETWEEN 1 AND 4),
  comentario     text,
  UNIQUE (pdi_id, area)
);

CREATE INDEX IF NOT EXISTS idx_pdi_comp_pdi ON pdi_competencias(pdi_id);

-- 4. Metas SMART (3-5 por PDI, propostas pela professora)
CREATE TABLE IF NOT EXISTS pdi_metas (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  pdi_id          uuid    REFERENCES pdis(id) ON DELETE CASCADE NOT NULL,
  descricao       text    NOT NULL,   -- "O que quero alcançar"
  indicador       text    NOT NULL,   -- "Como vou medir"
  prazo           date    NOT NULL,
  area_vinculada  text    CHECK (area_vinculada IN (
                             'linguagem', 'metodologia', 'avaliacao',
                             'intercultural', 'colaboracao', 'inovacao', 'desenvolvimento'
                           )),
  -- Pode ser vinculada a um diploma aprovado como evidência
  diploma_id      uuid    REFERENCES diplomas_professoras(id) ON DELETE SET NULL,
  status          text    DEFAULT 'pendente'
                            CHECK (status IN ('pendente', 'em_andamento', 'concluido', 'revisado')),
  progressao_pct  integer DEFAULT 0 CHECK (progressao_pct BETWEEN 0 AND 100),
  evidencia_texto text,   -- relato livre da professora
  criado_em       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdi_metas_pdi ON pdi_metas(pdi_id);

-- 5. Acompanhamentos / check-ins (semestral e final)
CREATE TABLE IF NOT EXISTS pdi_acompanhamentos (
  id                  uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  pdi_id              uuid    REFERENCES pdis(id) ON DELETE CASCADE NOT NULL,
  tipo                text    NOT NULL CHECK (tipo IN ('semestral', 'final')),
  relato_professora   text,
  feedback_gestora    text,
  criado_em           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdi_acomp_pdi ON pdi_acompanhamentos(pdi_id);
