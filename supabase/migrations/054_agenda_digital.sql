-- =====================================================
-- 054: Agenda Digital / Diário do Aluno
-- =====================================================

-- Registro diário por turma/aluno
CREATE TABLE IF NOT EXISTS agenda_registros (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  serie_id uuid REFERENCES series(id),
  aluno_email text,                    -- NULL = registro para toda a turma
  aluno_nome text,
  data date NOT NULL,
  professor_id uuid REFERENCES professoras(id),
  publicado boolean DEFAULT false,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE agenda_registros DISABLE ROW LEVEL SECURITY;

-- Itens do dia (atividades, refeições, sono, humor, fotos, obs)
CREATE TABLE IF NOT EXISTS agenda_itens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  registro_id uuid NOT NULL REFERENCES agenda_registros(id) ON DELETE CASCADE,
  tipo text NOT NULL,                  -- 'atividade','refeicao','sono','humor','foto','observacao'
  titulo text,
  descricao text,
  valor text,                          -- para humor: 'feliz','neutro','triste'; para sono: '1h30'
  hora time,
  ordem integer DEFAULT 0,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE agenda_itens DISABLE ROW LEVEL SECURITY;

-- Fotos da agenda
CREATE TABLE IF NOT EXISTS agenda_fotos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id uuid REFERENCES agenda_itens(id) ON DELETE CASCADE,
  registro_id uuid REFERENCES agenda_registros(id) ON DELETE CASCADE,
  url text NOT NULL,
  thumbnail_url text,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE agenda_fotos DISABLE ROW LEVEL SECURITY;
