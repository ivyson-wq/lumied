-- Add turno column to familias table
ALTER TABLE familias ADD COLUMN IF NOT EXISTS turno text;
