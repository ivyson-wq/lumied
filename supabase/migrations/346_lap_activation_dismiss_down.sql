-- Rollback mig 346
DROP TABLE IF EXISTS lap_activation_dismiss CASCADE;
DROP FUNCTION IF EXISTS lap_dismiss_touch();
