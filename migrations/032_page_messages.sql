-- 032_page_messages.sql
-- In-app, sayfa-özelinde, segment bazlı onboarding/info mesajları.
-- Push campaign'den ayrı; segment motorunu paylaşır, FCM göndermez.
BEGIN;

CREATE TABLE IF NOT EXISTS page_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,                 -- admin-içi etiket (kullanıcıya gösterilmez)
  page          text NOT NULL,                 -- hedef sayfa anahtarı (PAGE_KEYS)
  display_type  text NOT NULL,                 -- banner | bottom_sheet | modal | inline_card
  content       jsonb NOT NULL,                -- { "tr": {title,body,cta_label}, "en": {...}, ... } 16 dil
  image_url     text,
  action_url    text,                          -- internal deep link veya quloapp.com URL
  frequency     text NOT NULL DEFAULT 'once',  -- once | every_visit | until_dismissed | daily
  priority      int  NOT NULL DEFAULT 0,
  segment       jsonb,                         -- null = herkes
  start_at      timestamptz,
  end_at        timestamptz,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES admin_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS page_message_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_message_id uuid NOT NULL REFERENCES page_messages(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event           text NOT NULL,               -- shown | clicked | dismissed
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_messages_active_page
  ON page_messages(is_active, page);
CREATE INDEX IF NOT EXISTS idx_pme_msg_event
  ON page_message_events(page_message_id, event);
CREATE INDEX IF NOT EXISTS idx_pme_user_msg
  ON page_message_events(user_id, page_message_id);

ALTER TABLE page_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE page_message_events DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE page_messages IS 'Admin-yönetimli, sayfa-özelinde, segment bazlı in-app mesajlar';
COMMENT ON COLUMN page_messages.content IS '16 dil map: locale -> {title, body, cta_label}';
COMMENT ON TABLE page_message_events IS 'Frekans state + analitik (shown/clicked/dismissed)';

COMMIT;
