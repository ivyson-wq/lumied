-- refresh_token pode ser null em alguns fluxos do ML
ALTER TABLE ml_tokens ALTER COLUMN refresh_token DROP NOT NULL;
