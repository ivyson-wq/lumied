-- ═══════════════════════════════════════════════════════════════
--  Migration 225 — Índices de hot path (sessões legadas + lookups)
--  Hub whoami verifica 4 tabelas de sessão por token a cada request;
--  professora_email é lookup hot-path no hub.
-- ═══════════════════════════════════════════════════════════════

-- Sessões legadas — lookup por token
CREATE INDEX IF NOT EXISTS idx_gerente_sessoes_token ON gerente_sessoes(token);
CREATE INDEX IF NOT EXISTS idx_secretaria_sessoes_token ON secretaria_sessoes(token);
CREATE INDEX IF NOT EXISTS idx_professora_sessoes_token ON professora_sessoes(token);

-- Lookups por email (hub_whoami, resolução de usuário)
CREATE INDEX IF NOT EXISTS idx_professoras_email ON professoras(email);
CREATE INDEX IF NOT EXISTS idx_secretarias_email ON secretarias(email);
CREATE INDEX IF NOT EXISTS idx_gerentes_email ON gerentes(email);
