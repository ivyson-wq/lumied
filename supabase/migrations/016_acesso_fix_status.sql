-- Migration 016: Corrige coluna status em solicitacoes_acesso
-- Caso a tabela tenha sido criada sem DEFAULT/NOT NULL no status,
-- os inserts salvam NULL e a listagem do gerente (filtra status='pendente') fica vazia.

-- 1. Garante que registros existentes com status NULL virem 'pendente'
UPDATE solicitacoes_acesso
  SET status = 'pendente'
  WHERE status IS NULL;

-- 2. Adiciona DEFAULT 'pendente' na coluna status
ALTER TABLE solicitacoes_acesso
  ALTER COLUMN status SET DEFAULT 'pendente';

-- 3. Adiciona NOT NULL (seguro agora que não há NULLs)
ALTER TABLE solicitacoes_acesso
  ALTER COLUMN status SET NOT NULL;
