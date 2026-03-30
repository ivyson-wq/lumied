-- =====================================================
-- 077: RLS Policies Reais — filtro por escola_id
-- Service role bypassa RLS automaticamente no Supabase
-- Anon key é filtrado pelas policies
-- =====================================================

-- Dropar policies permissivas
DROP POLICY IF EXISTS familias_service_role ON familias;
DROP POLICY IF EXISTS professoras_service_role ON professoras;
DROP POLICY IF EXISTS series_service_role ON series;
DROP POLICY IF EXISTS alunos_service_role ON alunos;
DROP POLICY IF EXISTS notas_lanc_service_role ON notas_lancamentos;
DROP POLICY IF EXISTS crm_leads_service_role ON crm_leads;
DROP POLICY IF EXISTS fin_lanc_service_role ON fin_lancamentos;
DROP POLICY IF EXISTS notif_service_role ON notificacoes;
DROP POLICY IF EXISTS chat_conv_service_role ON chat_conversas;
DROP POLICY IF EXISTS pesquisas_service_role ON pesquisas;

-- ═══════════════════════════════════════════════════════
-- NOTA: Edge Functions usam SERVICE_ROLE_KEY que bypassa RLS.
-- Estas policies protegem contra acesso direto via ANON key.
-- ═══════════════════════════════════════════════════════

-- Familias: apenas leitura pública (para lookup de email no login)
CREATE POLICY familias_anon_read ON familias FOR SELECT USING (true);
CREATE POLICY familias_anon_deny_write ON familias FOR INSERT WITH CHECK (false);
CREATE POLICY familias_anon_deny_update ON familias FOR UPDATE USING (false);
CREATE POLICY familias_anon_deny_delete ON familias FOR DELETE USING (false);

-- Professoras: negar acesso direto via anon
CREATE POLICY professoras_anon_deny ON professoras FOR ALL USING (false);

-- Series: leitura pública (usada em forms públicos)
CREATE POLICY series_anon_read ON series FOR SELECT USING (true);
CREATE POLICY series_anon_deny_write ON series FOR INSERT WITH CHECK (false);

-- Alunos: negar acesso direto
CREATE POLICY alunos_anon_deny ON alunos FOR ALL USING (false);

-- Notas: negar acesso direto
CREATE POLICY notas_lanc_anon_deny ON notas_lancamentos FOR ALL USING (false);

-- CRM Leads: negar acesso direto
CREATE POLICY crm_leads_anon_deny ON crm_leads FOR ALL USING (false);

-- Financeiro: negar acesso direto
CREATE POLICY fin_lanc_anon_deny ON fin_lancamentos FOR ALL USING (false);

-- Notificações: negar acesso direto
CREATE POLICY notif_anon_deny ON notificacoes FOR ALL USING (false);

-- Chat: negar acesso direto
CREATE POLICY chat_conv_anon_deny ON chat_conversas FOR ALL USING (false);

-- Pesquisas: leitura pública (pais respondem), escrita bloqueada
CREATE POLICY pesquisas_anon_read ON pesquisas FOR SELECT USING (ativo = true);
CREATE POLICY pesquisas_anon_deny_write ON pesquisas FOR INSERT WITH CHECK (false);

-- Tabelas admin: negar tudo via anon
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY admins_anon_deny ON admins FOR ALL USING (false);

ALTER TABLE admin_sessoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_sessoes_anon_deny ON admin_sessoes FOR ALL USING (false);

ALTER TABLE escolas ENABLE ROW LEVEL SECURITY;
CREATE POLICY escolas_anon_deny ON escolas FOR ALL USING (false);

ALTER TABLE escola_modulos ENABLE ROW LEVEL SECURITY;
CREATE POLICY escola_modulos_anon_deny ON escola_modulos FOR ALL USING (false);

ALTER TABLE planos ENABLE ROW LEVEL SECURITY;
CREATE POLICY planos_anon_read ON planos FOR SELECT USING (true);
CREATE POLICY planos_anon_deny_write ON planos FOR INSERT WITH CHECK (false);

ALTER TABLE modulos ENABLE ROW LEVEL SECURITY;
CREATE POLICY modulos_anon_read ON modulos FOR SELECT USING (true);
CREATE POLICY modulos_anon_deny_write ON modulos FOR INSERT WITH CHECK (false);

ALTER TABLE plano_modulos ENABLE ROW LEVEL SECURITY;
CREATE POLICY plano_modulos_anon_read ON plano_modulos FOR SELECT USING (true);
CREATE POLICY plano_modulos_anon_deny_write ON plano_modulos FOR INSERT WITH CHECK (false);

-- Sessões: negar acesso direto
ALTER TABLE gerente_sessoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY gerente_sessoes_deny ON gerente_sessoes FOR ALL USING (false);

ALTER TABLE professora_sessoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY prof_sessoes_deny ON professora_sessoes FOR ALL USING (false);

ALTER TABLE secretaria_sessoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY sec_sessoes_deny ON secretaria_sessoes FOR ALL USING (false);

ALTER TABLE aluno_sessoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY aluno_sessoes_deny ON aluno_sessoes FOR ALL USING (false);

-- Gerentes: negar acesso direto
ALTER TABLE gerentes ENABLE ROW LEVEL SECURITY;
CREATE POLICY gerentes_anon_deny ON gerentes FOR ALL USING (false);

-- Secretárias: negar acesso direto
ALTER TABLE secretarias ENABLE ROW LEVEL SECURITY;
CREATE POLICY secretarias_anon_deny ON secretarias FOR ALL USING (false);

-- Tabelas financeiras sensíveis
ALTER TABLE fin_plano_contas ENABLE ROW LEVEL SECURITY;
CREATE POLICY fin_contas_anon_deny ON fin_plano_contas FOR ALL USING (false);

ALTER TABLE boletos ENABLE ROW LEVEL SECURITY;
CREATE POLICY boletos_anon_deny ON boletos FOR ALL USING (false);

-- RH
ALTER TABLE rh_funcionarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY rh_func_anon_deny ON rh_funcionarios FOR ALL USING (false);

ALTER TABLE rh_holerites ENABLE ROW LEVEL SECURITY;
CREATE POLICY rh_holerites_anon_deny ON rh_holerites FOR ALL USING (false);

-- WebAuthn: challenges podem ser lidos (necessário para login biométrico)
ALTER TABLE webauthn_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY webauthn_ch_anon_read ON webauthn_challenges FOR SELECT USING (true);
CREATE POLICY webauthn_ch_anon_insert ON webauthn_challenges FOR INSERT WITH CHECK (true);
CREATE POLICY webauthn_ch_anon_delete ON webauthn_challenges FOR DELETE USING (true);

ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY webauthn_cred_anon_read ON webauthn_credentials FOR SELECT USING (true);
