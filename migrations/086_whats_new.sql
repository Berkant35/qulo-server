-- 086 · whats_new — güncelleme sonrası uygulama içi "Yenilikler" pop-up içeriği (2.2.0 kalem A5).
--
-- Her sürüm için backoffice'ten yönetilir: app_version (istemci sürümüne TAM eşleşir), platform
-- ('all' | 'ios' | 'android'), content (dil kodu -> {title, body, cta_label?}; en az 'en'), görsel, aç/kapa.
--
-- GÜVENLİK: RLS AÇIK ve HİÇ POLİTİKA YOK — tabloya yalnız service_role (qulo-server) erişir; anon /
-- publishable key ile PostgREST üzerinden okuma/yazma kapalı. Politika EKLEME: bu tablonun tek okuyucusu
-- GET /api/v1/app/whats-new ucudur. Ek olarak anon/authenticated yetkileri açıkça geri alınır.
--
-- Rollback: 086_whats_new_rollback.sql. Uygulama: 2.2.0 yayınında (release/2.2.0).

BEGIN;

CREATE TABLE IF NOT EXISTS public.whats_new (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  app_version text        NOT NULL CHECK (app_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  platform    text        NOT NULL DEFAULT 'all' CHECK (platform IN ('all', 'ios', 'android')),
  content     jsonb       NOT NULL CHECK (jsonb_typeof(content) = 'object' AND content ? 'en'),
  image_url   text        NULL CHECK (image_url IS NULL OR image_url ~ '^https://'),
  is_active   boolean     NOT NULL DEFAULT false,
  created_by  uuid        NULL REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Aynı sürüm+platform için tek AKTİF kayıt (pasif taslaklar çoğalabilir).
CREATE UNIQUE INDEX IF NOT EXISTS whats_new_aktif_surum_platform_uq
  ON public.whats_new (app_version, platform)
  WHERE is_active;

ALTER TABLE public.whats_new ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whats_new FROM anon, authenticated;

COMMIT;
