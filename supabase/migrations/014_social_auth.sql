-- 014_social_auth.sql
-- Social authentication support: Google Sign-In & Apple Sign-In

-- auth_provider: hangi yöntemle kayıt olunduğunu belirtir
ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'email';

-- provider_id: Google/Apple sub claim (unique identifier)
ALTER TABLE users ADD COLUMN provider_id TEXT;

-- provider_id unique olmalı (aynı sosyal hesapla çoklu kayıt engellemek için)
CREATE UNIQUE INDEX idx_users_provider_id ON users (provider_id) WHERE provider_id IS NOT NULL;

-- password_hash nullable (sosyal login kullanıcılarının şifresi yok)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
