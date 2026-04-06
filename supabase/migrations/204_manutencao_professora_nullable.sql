-- 204: Permitir manutencoes sem professora_id (chamados da secretaria/gerente)
ALTER TABLE manutencoes ALTER COLUMN professora_id DROP NOT NULL;
