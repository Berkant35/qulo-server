-- Add token expiration column for email verification and password reset
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

-- Index for efficient expired token cleanup (optional future use)
CREATE INDEX IF NOT EXISTS idx_users_token_expires_at ON users (token_expires_at)
  WHERE token_expires_at IS NOT NULL;
