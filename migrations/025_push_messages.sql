-- 025_push_messages.sql
-- Override table for push notification templates (Phase 1 dynamic notification system)
-- Defaults live in src/locales/{tr,en}.json — DB rows override per (type, locale)

CREATE TABLE IF NOT EXISTS push_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL,
  locale      text NOT NULL,
  title       text,
  body        text,
  is_active   boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  UNIQUE (type, locale),
  CHECK (title IS NOT NULL OR body IS NOT NULL OR is_active = false)
);

COMMENT ON TABLE push_messages IS 'Per-(type, locale) override layer for push notification templates';
COMMENT ON COLUMN push_messages.is_active IS 'false = push is muted entirely (no FCM send)';
