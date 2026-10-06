-- 077 rollback · Kehanet açığı — gösterim kapısı
-- ÖNCE sunucu deploy'u geri alınır ya da backoffice'ten served_gate_enabled kapatılır (yeni kod
-- discover_served'e yazar/okur), SONRA bu dosya. Kod kolon/tablo yokken kapıyı kapalı sayar,
-- served yazımı hata koduyla loglanıp Discover'ı bozmaz.

ALTER TABLE public.app_config DROP COLUMN IF EXISTS served_gate_enabled;

DROP TABLE IF EXISTS public.discover_served;
