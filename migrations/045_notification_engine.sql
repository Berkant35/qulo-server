-- 045_notification_engine.sql
-- Akilli bildirim motoru (Faz 1): backoffice'ten ayarlanan tek satirlik config + karar kaydi.
-- Motor node-cron ile 15 dk'da bir kosar (src/cron/notification-engine.cron.ts); her kullanici icin
-- gunde en fazla bir karar uretir ve push_log'a yazar (sent / dry_run / suppressed / holdout / failed).
-- Iki tablo da sunucu (service_role) tarafindan yazilir; RLS acik + policy yok -> anon/authenticated
-- okuyamaz (041 ilkesi). Tasarim: docs/superpowers/specs/2026-09-07-akilli-bildirim-motoru-design.md

CREATE TABLE IF NOT EXISTS notification_engine_config (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

INSERT INTO notification_engine_config (id, config)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE notification_engine_config ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS push_log (
  id               bigserial PRIMARY KEY,
  run_id           uuid NOT NULL,
  mode             text NOT NULL CHECK (mode IN ('live', 'dry_run')),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_key         text NOT NULL,
  decision         text NOT NULL CHECK (decision IN ('sent', 'dry_run', 'suppressed', 'holdout', 'failed')),
  reason           text,
  locale           text,
  payload          jsonb,
  notification_id  uuid REFERENCES notifications(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_log_user_created ON push_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_log_rule_created ON push_log (rule_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_log_run ON push_log (run_id);

ALTER TABLE push_log ENABLE ROW LEVEL SECURITY;
