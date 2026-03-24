-- Migration 015: Controle de Acesso
-- Tabelas para solicitações de acesso de famílias e lista de autorizados

CREATE TABLE IF NOT EXISTS solicitacoes_acesso (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  nome          text        NOT NULL,
  cpf           text        NOT NULL,
  email         text        NOT NULL,
  telefone      text        NOT NULL,
  nome_crianca  text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pendente',  -- pendente | aprovado | rejeitado
  criado_em     timestamptz DEFAULT now(),
  processado_em timestamptz,
  processado_por text
);

CREATE TABLE IF NOT EXISTS usuarios_autorizados (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  email      text        NOT NULL UNIQUE,
  nome       text,
  criado_por text,
  criado_em  timestamptz DEFAULT now()
);
