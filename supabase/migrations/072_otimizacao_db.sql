-- =====================================================
-- 072: Otimização do Banco de Dados
-- P0/P1: Indexes, FKs, constraints, naming, cleanup
-- =====================================================

-- ═══════════════════════════════════════════════════════
-- P0: TABELA CENTRAL DE ALUNOS (normalização)
-- ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS alunos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  email text UNIQUE NOT NULL,
  familia_email text,
  serie_id uuid REFERENCES series(id),
  data_nascimento date,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);
ALTER TABLE alunos DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_alunos_email ON alunos(email);
CREATE INDEX IF NOT EXISTS idx_alunos_familia ON alunos(familia_email);
CREATE INDEX IF NOT EXISTS idx_alunos_serie ON alunos(serie_id);

-- Seed: popular alunos a partir de familias existentes
INSERT INTO alunos (nome, email, familia_email, serie_id)
SELECT f.nome_aluno, f.email, f.email, s.id
FROM familias f
LEFT JOIN series s ON s.nome = f.serie
WHERE f.nome_aluno IS NOT NULL AND f.nome_aluno != ''
  AND f.email IS NOT NULL AND f.email != ''
ON CONFLICT (email) DO NOTHING;

-- ═══════════════════════════════════════════════════════
-- P0: INDEXES FALTANTES (60+ indexes)
-- ═══════════════════════════════════════════════════════

-- 049: notas
CREATE INDEX IF NOT EXISTS idx_notas_disc_serie ON notas_disciplinas(serie_id);
CREATE INDEX IF NOT EXISTS idx_notas_disc_prof ON notas_disciplinas(professor_id);
CREATE INDEX IF NOT EXISTS idx_notas_aval_disc ON notas_avaliacoes(disciplina_id);
CREATE INDEX IF NOT EXISTS idx_notas_aval_periodo ON notas_avaliacoes(periodo_id);
CREATE INDEX IF NOT EXISTS idx_notas_lanc_aval ON notas_lancamentos(avaliacao_id);
CREATE INDEX IF NOT EXISTS idx_notas_lanc_aluno ON notas_lancamentos(aluno_email);
CREATE INDEX IF NOT EXISTS idx_boletins_aluno ON boletins(aluno_email, ano);
CREATE INDEX IF NOT EXISTS idx_boletins_periodo ON boletins(periodo_id);

-- 050: frequencia
CREATE INDEX IF NOT EXISTS idx_freq_chamadas_serie ON frequencia_chamadas(serie_id, data);
CREATE INDEX IF NOT EXISTS idx_freq_chamadas_prof ON frequencia_chamadas(professor_id);
CREATE INDEX IF NOT EXISTS idx_freq_registros_chamada ON frequencia_registros(chamada_id);
CREATE INDEX IF NOT EXISTS idx_freq_alertas_aluno ON frequencia_alertas(aluno_email);

-- 051: diario
CREATE INDEX IF NOT EXISTS idx_diario_serie_data ON diario_registros(serie_id, data);
CREATE INDEX IF NOT EXISTS idx_diario_prof ON diario_registros(professor_id);

-- 053: pesquisas
CREATE INDEX IF NOT EXISTS idx_pesquisa_perguntas_pesq ON pesquisa_perguntas(pesquisa_id);
CREATE INDEX IF NOT EXISTS idx_pesquisa_respostas_pesq ON pesquisa_respostas(pesquisa_id);
CREATE INDEX IF NOT EXISTS idx_autorizacoes_familia ON autorizacoes(familia_email);

-- 054: agenda
CREATE INDEX IF NOT EXISTS idx_agenda_registros_serie ON agenda_registros(serie_id, data);
CREATE INDEX IF NOT EXISTS idx_agenda_registros_aluno ON agenda_registros(aluno_email);
CREATE INDEX IF NOT EXISTS idx_agenda_itens_registro ON agenda_itens(registro_id);

-- 055: chat
CREATE INDEX IF NOT EXISTS idx_chat_conversas_serie ON chat_conversas(serie_id);

-- 056: matricula
CREATE INDEX IF NOT EXISTS idx_matr_docs_matricula ON matricula_documentos(matricula_id);
CREATE INDEX IF NOT EXISTS idx_matr_contratos_matricula ON matricula_contratos(matricula_id);

-- 057: relatorios
CREATE INDEX IF NOT EXISTS idx_relat_ped_aluno ON relatorios_pedagogicos(aluno_email, ano);
CREATE INDEX IF NOT EXISTS idx_relat_ped_prof ON relatorios_pedagogicos(professor_id);
CREATE INDEX IF NOT EXISTS idx_relat_comp_relatorio ON relatorio_competencias(relatorio_id);

-- 059: provas
CREATE INDEX IF NOT EXISTS idx_provas_resp_prova ON provas_respostas(prova_id);
CREATE INDEX IF NOT EXISTS idx_provas_resp_aluno ON provas_respostas(aluno_email);

-- 060: contratos
CREATE INDEX IF NOT EXISTS idx_contratos_familia ON contratos(familia_email);
CREATE INDEX IF NOT EXISTS idx_contratos_status ON contratos(status);
CREATE INDEX IF NOT EXISTS idx_contrato_assin ON contrato_assinaturas(contrato_id);

-- 061: regua
CREATE INDEX IF NOT EXISTS idx_regua_exec_familia ON regua_execucoes(familia_email);
CREATE INDEX IF NOT EXISTS idx_regua_exec_config ON regua_execucoes(config_id);

-- 062: pix
CREATE INDEX IF NOT EXISTS idx_pix_familia ON pix_cobrancas(familia_email);

-- 063: biblioteca
CREATE INDEX IF NOT EXISTS idx_biblio_emp_acervo ON biblioteca_emprestimos(acervo_id);
CREATE INDEX IF NOT EXISTS idx_biblio_emp_aluno ON biblioteca_emprestimos(aluno_email);
CREATE INDEX IF NOT EXISTS idx_biblio_emp_status ON biblioteca_emprestimos(status);
CREATE INDEX IF NOT EXISTS idx_biblio_res_acervo ON biblioteca_reservas(acervo_id);

-- 065: cantina
CREATE INDEX IF NOT EXISTS idx_cantina_trans_aluno ON cantina_transacoes(aluno_email);
CREATE INDEX IF NOT EXISTS idx_cantina_restr_aluno ON cantina_restricoes(aluno_email);

-- 066: transporte
CREATE INDEX IF NOT EXISTS idx_transporte_alunos_rota ON transporte_alunos(rota_id);
CREATE INDEX IF NOT EXISTS idx_transporte_notif_rota ON transporte_notificacoes(rota_id);

-- 067: ead
CREATE INDEX IF NOT EXISTS idx_ead_aulas_serie ON ead_aulas(serie_id);
CREATE INDEX IF NOT EXISTS idx_ead_aulas_disc ON ead_aulas(disciplina_id);
CREATE INDEX IF NOT EXISTS idx_ead_aulas_prof ON ead_aulas(professor_id);
CREATE INDEX IF NOT EXISTS idx_ead_materiais_aula ON ead_materiais(aula_id);
CREATE INDEX IF NOT EXISTS idx_ead_presencas_aula ON ead_presencas(aula_id);

-- 069: rh
CREATE INDEX IF NOT EXISTS idx_rh_ponto_func ON rh_ponto(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_rh_ferias_func ON rh_ferias(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_rh_holerites_func ON rh_holerites(funcionario_id);

-- 070: ecommerce
CREATE INDEX IF NOT EXISTS idx_loja_pedidos_familia ON loja_pedidos(familia_email);
CREATE INDEX IF NOT EXISTS idx_loja_pedidos_status ON loja_pedidos(status);
CREATE INDEX IF NOT EXISTS idx_loja_itens_pedido ON loja_itens_pedido(pedido_id);
CREATE INDEX IF NOT EXISTS idx_loja_pagamentos_pedido ON loja_pagamentos(pedido_id);

-- Tabelas existentes
CREATE INDEX IF NOT EXISTS idx_fin_mensalidades_familia ON fin_mensalidades(familia_email);
CREATE INDEX IF NOT EXISTS idx_boletos_vencimento ON boletos(vencimento);

-- ═══════════════════════════════════════════════════════
-- P1: NAMING — professor_id → professora_id
-- ═══════════════════════════════════════════════════════
ALTER TABLE notas_disciplinas RENAME COLUMN professor_id TO professora_id;
ALTER TABLE frequencia_chamadas RENAME COLUMN professor_id TO professora_id;
ALTER TABLE relatorios_pedagogicos RENAME COLUMN professor_id TO professora_id;

-- ═══════════════════════════════════════════════════════
-- P1: ATUALIZADO_EM em tabelas mutáveis
-- ═══════════════════════════════════════════════════════
ALTER TABLE familias ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();
ALTER TABLE notas_lancamentos ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();
ALTER TABLE frequencia_registros ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();
ALTER TABLE pesquisas ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();
ALTER TABLE contratos ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();
ALTER TABLE provas ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();
ALTER TABLE provas_respostas ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();
ALTER TABLE biblioteca_emprestimos ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();
ALTER TABLE ead_aulas ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();
ALTER TABLE rh_funcionarios ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();
ALTER TABLE loja_produtos ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();
ALTER TABLE planos ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();
ALTER TABLE escolas ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();
ALTER TABLE boletos ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();

-- Trigger para auto-update
CREATE OR REPLACE FUNCTION trigger_set_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN NEW.atualizado_em = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════
-- P2: CHECK CONSTRAINTS
-- ═══════════════════════════════════════════════════════
DO $$ BEGIN
  ALTER TABLE notas_avaliacoes ADD CONSTRAINT notas_aval_max_check CHECK (valor_maximo > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE notas_lancamentos ADD CONSTRAINT notas_lanc_valor_check CHECK (valor >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE rh_holerites ADD CONSTRAINT rh_holerites_mes_check CHECK (mes BETWEEN 1 AND 12);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE rh_folha_pagamento ADD CONSTRAINT rh_folha_mes_check CHECK (mes BETWEEN 1 AND 12);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE loja_pedidos ADD CONSTRAINT loja_pedidos_total_check CHECK (total >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE loja_itens_pedido ADD CONSTRAINT loja_itens_qty_check CHECK (quantidade > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE biblioteca_emprestimos ADD CONSTRAINT biblio_emp_dates_check CHECK (data_devolucao_prevista >= data_emprestimo);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════
-- P2: CLEANUP — tabelas obsoletas
-- ═══════════════════════════════════════════════════════
DROP TABLE IF EXISTS alm_turmas CASCADE;
DROP TABLE IF EXISTS diario_bncc_habilidades CASCADE;

-- ═══════════════════════════════════════════════════════
-- P3: PRECISÃO NUMÉRICA para financeiro
-- ═══════════════════════════════════════════════════════
ALTER TABLE loja_produtos ALTER COLUMN preco TYPE numeric(15,2);
ALTER TABLE loja_produtos ALTER COLUMN preco_promocional TYPE numeric(15,2);
ALTER TABLE loja_itens_pedido ALTER COLUMN preco_unitario TYPE numeric(15,2);
ALTER TABLE loja_itens_pedido ALTER COLUMN subtotal TYPE numeric(15,2);
ALTER TABLE loja_pedidos ALTER COLUMN total TYPE numeric(15,2);
ALTER TABLE loja_pedidos ALTER COLUMN subtotal TYPE numeric(15,2);
ALTER TABLE pix_cobrancas ALTER COLUMN valor TYPE numeric(15,2);
ALTER TABLE rh_funcionarios ALTER COLUMN salario_base TYPE numeric(15,2);
