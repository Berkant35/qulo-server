-- 035_account_deletion_feedback.sql
-- Account Deletion Feedback (churn analizi)
-- Spec: docs/superpowers/specs/2026-06-27-account-deletion-reasons-design.md
--
-- NOT: Canlı Supabase DB canonical kaynaktır; bu dosya repo mirror'ıdır.
-- Uygulama: Supabase dashboard SQL editor (veya Supabase MCP apply_migration).
--
-- Tasarım kararları:
--  * Ayrı tablo (users'a kolon EKLEME) — kullanıcı sonradan purge edilse bile churn satırı kalsın.
--  * user_id'de FK YOK (purge sonrası satır yaşamalı); sadece referans amaçlı.
--  * reason_code canonical kod saklanır, çevrilmiş string DEĞİL.

CREATE TABLE IF NOT EXISTS account_deletion_feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID,                       -- FK yok (purge sonrası satır kalsın)
  reason_code  TEXT NOT NULL,              -- canonical taksonomi kodu
  reason_text  TEXT,                       -- opsiyonel serbest metin ("other")
  app_version  TEXT,                       -- istemci sürümü
  platform     TEXT,                       -- ios / android
  locale       TEXT,                       -- kullanıcı dili (segmentasyon)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adf_reason_code ON account_deletion_feedback (reason_code);
CREATE INDEX IF NOT EXISTS idx_adf_created_at  ON account_deletion_feedback (created_at);

-- Proje pattern'i: service_role kullanılıyor, RLS kapalı
ALTER TABLE account_deletion_feedback DISABLE ROW LEVEL SECURITY;
