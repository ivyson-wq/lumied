-- Helper function to find auth user ID by email (used by familias_reset_senha)
-- SECURITY DEFINER allows calling from edge functions without exposing auth schema
CREATE OR REPLACE FUNCTION public.get_auth_uid_by_email(p_email text)
RETURNS uuid AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;
