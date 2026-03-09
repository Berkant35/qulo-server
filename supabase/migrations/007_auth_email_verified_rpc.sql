-- RPC: auth.users tablosundan email doğrulama durumunu kontrol et
-- LOWER() ile case-insensitive karşılaştırma

CREATE OR REPLACE FUNCTION public.is_auth_email_verified(user_email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  result BOOLEAN;
BEGIN
  SELECT (email_confirmed_at IS NOT NULL) INTO result
  FROM auth.users
  WHERE LOWER(email) = LOWER(user_email)
  LIMIT 1;
  RETURN COALESCE(result, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
