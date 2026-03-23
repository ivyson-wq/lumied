-- Migration 017: Garantir permissões corretas em solicitacoes_acesso e usuarios_autorizados
-- O RLS habilitado sem políticas causa insert silencioso (sem erro, sem dado salvo).

-- Desabilita RLS nas duas tabelas (função usa service_role que bypassa RLS de qualquer forma,
-- mas tabelas criadas pelo dashboard podem ter RLS ON por padrão)
ALTER TABLE IF EXISTS solicitacoes_acesso DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS usuarios_autorizados DISABLE ROW LEVEL SECURITY;

-- Garante permissões ao role anon e authenticated (necessário para edge functions sem service_role)
GRANT ALL ON solicitacoes_acesso TO service_role;
GRANT ALL ON usuarios_autorizados TO service_role;
