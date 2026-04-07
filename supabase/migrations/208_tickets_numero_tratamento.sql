-- Ticket number for user tracking + treatment fields for staff
CREATE SEQUENCE IF NOT EXISTS tickets_numero_seq START 1001;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS numero integer DEFAULT nextval('tickets_numero_seq');
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tratamento text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS proximos_passos text;
UPDATE tickets SET numero = nextval('tickets_numero_seq') WHERE numero IS NULL;
