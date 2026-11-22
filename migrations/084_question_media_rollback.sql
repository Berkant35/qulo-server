-- 084 rollback · soru medya kolonları, bayrak ve şikâyet bağı kaldırılır.
-- DİKKAT: kolonlardaki veri kaybolur (voice/image yolları). Önce media_questions_enabled=false yapıp
-- istemcilerin medya yazmasını durdur. CHECK kısıtları kolonlarla birlikte düşer.
-- report_category enum'una eklenen 'INAPPROPRIATE_MEDIA' GERİ ALINMAZ: Postgres enum değeri
-- düşürmeyi desteklemez (tip yeniden kurulmadan). Kalması zararsızdır — validator'dan çıkarılırsa
-- hiçbir istemci gönderemez; o kategoriyle yazılmış şikâyet satırları da okunabilir kalır.

ALTER TABLE public.photo_moderation_checks DROP COLUMN IF EXISTS kind;
ALTER TABLE public.reports DROP COLUMN IF EXISTS question_id;
ALTER TABLE public.app_config DROP COLUMN IF EXISTS media_questions_enabled;
ALTER TABLE public.questions
  DROP COLUMN IF EXISTS image_status,
  DROP COLUMN IF EXISTS image_path,
  DROP COLUMN IF EXISTS voice_duration_ms,
  DROP COLUMN IF EXISTS voice_path;
