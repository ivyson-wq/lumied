-- ═══════════════════════════════════════════════════════════════
--  Migration 246: Papéis Granulares para Staff Lumied
-- ═══════════════════════════════════════════════════════════════
--  Substitui o CHECK constraint em lumied_staff.cargo por um sistema
--  de papéis + permissões recurso×ação, permitindo personalizar o que
--  cada papel (TI, CS Pedagógico, Comercial etc) pode fazer.
--
--  Modelo:
--    lumied_staff_papeis         — catálogo de papéis (nome + slug)
--    lumied_staff_permissoes     — matriz (papel, recurso, acao) → allow
--    lumied_staff.papel_id       — FK opcional (cargo string permanece p/ compat)
--
--  Recursos controlados:
--    escolas, staff, tickets, crm, saas_billing, financeiro_lumied,
--    centros_custo, backups, audit, governance, saude_cs, playbooks, ia_uso
-- ═══════════════════════════════════════════════════════════════

-- ── Catálogo de papéis ──
CREATE TABLE IF NOT EXISTS lumied_staff_papeis (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT UNIQUE NOT NULL,
  nome         TEXT NOT NULL,
  descricao    TEXT,
  sistema      BOOLEAN DEFAULT FALSE,   -- true = não pode deletar (seeds)
  criado_em    TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

-- ── Matriz de permissões ──
CREATE TABLE IF NOT EXISTS lumied_staff_permissoes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  papel_id  UUID NOT NULL REFERENCES lumied_staff_papeis(id) ON DELETE CASCADE,
  recurso   TEXT NOT NULL,
  acao      TEXT NOT NULL,
  UNIQUE (papel_id, recurso, acao)
);
CREATE INDEX IF NOT EXISTS idx_staff_perm_papel ON lumied_staff_permissoes(papel_id);
CREATE INDEX IF NOT EXISTS idx_staff_perm_lookup ON lumied_staff_permissoes(recurso, acao);

-- ── Vincular staff a um papel ──
ALTER TABLE lumied_staff
  ADD COLUMN IF NOT EXISTS papel_id UUID REFERENCES lumied_staff_papeis(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_staff_papel ON lumied_staff(papel_id);

-- Remover CHECK antigo em cargo para aceitar novos slugs
ALTER TABLE lumied_staff DROP CONSTRAINT IF EXISTS lumied_staff_cargo_check;

-- ── Seed dos papéis default ──
INSERT INTO lumied_staff_papeis (slug, nome, descricao, sistema) VALUES
  ('fundador',      'Fundador',           'Acesso total a tudo (bypass de permissões).', TRUE),
  ('cto',           'CTO',                'Acesso quase total, sem financeiro interno.', TRUE),
  ('ti',            'TI / Infra',         'Infraestrutura, backups, governance, observabilidade.', TRUE),
  ('cs_pedagogico', 'CS Pedagógico',      'Acompanhamento pedagógico das escolas — saúde, tickets, playbooks.', TRUE),
  ('cs_tecnico',    'CS Técnico',         'Suporte técnico — tickets, backups, IA.', TRUE),
  ('comercial',     'Comercial',          'CRM, funil, onboarding comercial, cobrança das escolas.', TRUE),
  ('suporte',       'Suporte',            'Tickets e consulta a escolas.', TRUE),
  ('financeiro',    'Financeiro Interno', 'Contas a pagar/receber, centros de custo, fluxo de caixa.', TRUE)
ON CONFLICT (slug) DO NOTHING;

-- ── Seed das permissões por papel ──
-- Recursos × ações (semântica "action" = verbo; convenção 'ver' sempre significa listagem + leitura)

-- CTO: tudo exceto financeiro_lumied
INSERT INTO lumied_staff_permissoes (papel_id, recurso, acao)
SELECT p.id, r.recurso, r.acao FROM lumied_staff_papeis p
  CROSS JOIN (VALUES
    ('escolas','ver'),('escolas','criar'),('escolas','editar'),('escolas','suspender'),
    ('staff','ver'),('staff','criar'),('staff','editar'),('staff','desativar'),('staff','gerenciar_papeis'),
    ('tickets','ver'),('tickets','responder'),('tickets','fechar'),('tickets','escalar'),
    ('crm','ver'),('crm','editar'),('crm','mover_funil'),
    ('saas_billing','ver'),('saas_billing','criar_fatura'),('saas_billing','cancelar'),('saas_billing','registrar_pagto'),
    ('backups','ver'),('backups','restaurar'),('backups','download'),
    ('audit','ver'),
    ('governance','ver'),('governance','editar_flags'),
    ('saude_cs','ver'),('saude_cs','ack_alerta'),
    ('playbooks','ver'),('playbooks','executar'),
    ('ia_uso','ver'),('ia_uso','ajustar_budget')
  ) AS r(recurso, acao)
WHERE p.slug='cto'
ON CONFLICT DO NOTHING;

-- TI: infraestrutura
INSERT INTO lumied_staff_permissoes (papel_id, recurso, acao)
SELECT p.id, r.recurso, r.acao FROM lumied_staff_papeis p
  CROSS JOIN (VALUES
    ('escolas','ver'),
    ('staff','ver'),
    ('backups','ver'),('backups','restaurar'),('backups','download'),
    ('governance','ver'),('governance','editar_flags'),
    ('audit','ver'),
    ('ia_uso','ver'),('ia_uso','ajustar_budget'),
    ('saude_cs','ver')
  ) AS r(recurso, acao)
WHERE p.slug='ti'
ON CONFLICT DO NOTHING;

-- CS Pedagógico: saúde das escolas + tickets + playbooks
INSERT INTO lumied_staff_permissoes (papel_id, recurso, acao)
SELECT p.id, r.recurso, r.acao FROM lumied_staff_papeis p
  CROSS JOIN (VALUES
    ('escolas','ver'),('escolas','editar'),
    ('saude_cs','ver'),('saude_cs','ack_alerta'),
    ('tickets','ver'),('tickets','responder'),('tickets','fechar'),('tickets','escalar'),
    ('playbooks','ver'),('playbooks','executar'),
    ('crm','ver')
  ) AS r(recurso, acao)
WHERE p.slug='cs_pedagogico'
ON CONFLICT DO NOTHING;

-- CS Técnico: suporte técnico
INSERT INTO lumied_staff_permissoes (papel_id, recurso, acao)
SELECT p.id, r.recurso, r.acao FROM lumied_staff_papeis p
  CROSS JOIN (VALUES
    ('escolas','ver'),
    ('tickets','ver'),('tickets','responder'),('tickets','fechar'),('tickets','escalar'),
    ('backups','ver'),
    ('saude_cs','ver'),
    ('ia_uso','ver')
  ) AS r(recurso, acao)
WHERE p.slug='cs_tecnico'
ON CONFLICT DO NOTHING;

-- Comercial: CRM + onboarding + cobrança
INSERT INTO lumied_staff_permissoes (papel_id, recurso, acao)
SELECT p.id, r.recurso, r.acao FROM lumied_staff_papeis p
  CROSS JOIN (VALUES
    ('escolas','ver'),('escolas','criar'),('escolas','editar'),
    ('crm','ver'),('crm','editar'),('crm','mover_funil'),
    ('saas_billing','ver'),('saas_billing','criar_fatura'),('saas_billing','registrar_pagto'),
    ('financeiro_lumied','ver_cr')
  ) AS r(recurso, acao)
WHERE p.slug='comercial'
ON CONFLICT DO NOTHING;

-- Suporte: tickets e escolas (ver)
INSERT INTO lumied_staff_permissoes (papel_id, recurso, acao)
SELECT p.id, r.recurso, r.acao FROM lumied_staff_papeis p
  CROSS JOIN (VALUES
    ('escolas','ver'),
    ('tickets','ver'),('tickets','responder'),('tickets','fechar')
  ) AS r(recurso, acao)
WHERE p.slug='suporte'
ON CONFLICT DO NOTHING;

-- Financeiro Interno: CP, CR, centros de custo
INSERT INTO lumied_staff_permissoes (papel_id, recurso, acao)
SELECT p.id, r.recurso, r.acao FROM lumied_staff_papeis p
  CROSS JOIN (VALUES
    ('escolas','ver'),
    ('financeiro_lumied','ver_cp'),('financeiro_lumied','criar_cp'),('financeiro_lumied','editar_cp'),('financeiro_lumied','pagar_cp'),
    ('financeiro_lumied','ver_cr'),('financeiro_lumied','criar_cr'),('financeiro_lumied','editar_cr'),
    ('centros_custo','ver'),('centros_custo','gerenciar'),
    ('saas_billing','ver'),('saas_billing','registrar_pagto')
  ) AS r(recurso, acao)
WHERE p.slug='financeiro'
ON CONFLICT DO NOTHING;

-- Fundador: não precisa de linhas na matriz — função de check abaixo dá bypass.

-- ── Backfill: mapear cargo string → papel_id ──
UPDATE lumied_staff SET papel_id = (SELECT id FROM lumied_staff_papeis WHERE slug='fundador')
  WHERE cargo='fundador' AND papel_id IS NULL;
UPDATE lumied_staff SET papel_id = (SELECT id FROM lumied_staff_papeis WHERE slug='cto')
  WHERE cargo='cto' AND papel_id IS NULL;
UPDATE lumied_staff SET papel_id = (SELECT id FROM lumied_staff_papeis WHERE slug='suporte')
  WHERE cargo='suporte' AND papel_id IS NULL;
UPDATE lumied_staff SET papel_id = (SELECT id FROM lumied_staff_papeis WHERE slug='comercial')
  WHERE cargo='comercial' AND papel_id IS NULL;
UPDATE lumied_staff SET papel_id = (SELECT id FROM lumied_staff_papeis WHERE slug='cs_tecnico')
  WHERE cargo='cs' AND papel_id IS NULL;

-- ── Função central de verificação de permissão ──
CREATE OR REPLACE FUNCTION staff_tem_permissao(
  p_staff_id UUID,
  p_recurso  TEXT,
  p_acao     TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_cargo TEXT;
  v_papel UUID;
  v_has   BOOLEAN;
BEGIN
  SELECT cargo, papel_id INTO v_cargo, v_papel
    FROM lumied_staff WHERE id = p_staff_id AND ativo = TRUE;

  IF v_cargo IS NULL THEN RETURN FALSE; END IF;
  IF v_cargo = 'fundador' THEN RETURN TRUE; END IF;  -- bypass fundador
  IF v_papel IS NULL THEN RETURN FALSE; END IF;

  SELECT EXISTS(
    SELECT 1 FROM lumied_staff_permissoes
     WHERE papel_id = v_papel AND recurso = p_recurso AND acao = p_acao
  ) INTO v_has;

  RETURN COALESCE(v_has, FALSE);
END $$ LANGUAGE plpgsql STABLE;

-- ── RLS ──
ALTER TABLE lumied_staff_papeis DISABLE ROW LEVEL SECURITY;
ALTER TABLE lumied_staff_permissoes DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE lumied_staff_papeis IS 'Catálogo de papéis granulares do Staff Lumied (TI, CS Pedagógico, etc).';
COMMENT ON TABLE lumied_staff_permissoes IS 'Matriz (papel × recurso × ação) — controla o que cada papel pode fazer.';
COMMENT ON FUNCTION staff_tem_permissao IS 'Retorna true se staff pode executar acao no recurso. Fundador = bypass.';
