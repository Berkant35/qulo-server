-- Migration 014: Referral System
-- Arkadaşını getir, mor elmas kap

-- Referral code kolonu (users tablosuna)
ALTER TABLE users ADD COLUMN referral_code VARCHAR(8) UNIQUE;

-- Mevcut kullanıcılara referral code generate et
UPDATE users
SET referral_code = upper(substr(md5(random()::text || id::text), 1, 8))
WHERE referral_code IS NULL;

-- NOT NULL constraint ekle (mevcut kullanıcılar güncellendikten sonra)
ALTER TABLE users ALTER COLUMN referral_code SET NOT NULL;

-- Referrals tablosu
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  referrer_rewarded BOOLEAN NOT NULL DEFAULT false,
  referee_rewarded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT uq_referee UNIQUE (referee_id),
  CONSTRAINT chk_no_self_referral CHECK (referrer_id != referee_id)
);

-- Indexler
CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX idx_referrals_status ON referrals(status);
CREATE INDEX idx_users_referral_code ON users(referral_code);
