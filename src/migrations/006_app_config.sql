-- 006_app_config.sql
-- App configuration table (single row) for version control & maintenance mode

CREATE TABLE IF NOT EXISTS app_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_version_ios text NOT NULL DEFAULT '2.0.0',
  min_version_android text NOT NULL DEFAULT '2.0.0',
  latest_version_ios text NOT NULL DEFAULT '2.0.0',
  latest_version_android text NOT NULL DEFAULT '2.0.0',
  store_url_ios text NOT NULL DEFAULT '',
  store_url_android text NOT NULL DEFAULT '',
  is_maintenance boolean NOT NULL DEFAULT false,
  maintenance_message_tr text,
  maintenance_message_en text,
  is_force_update_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed default row
INSERT INTO app_config (
  min_version_ios, min_version_android,
  latest_version_ios, latest_version_android,
  store_url_ios, store_url_android,
  is_maintenance, is_force_update_enabled
) VALUES (
  '2.0.0', '2.0.0',
  '2.0.0', '2.0.0',
  '', '',
  false, true
);

-- Disable RLS (service_role kullanıyoruz)
ALTER TABLE app_config DISABLE ROW LEVEL SECURITY;
