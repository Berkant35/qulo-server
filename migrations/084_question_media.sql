-- 084 · Sesli ve görselli soru (2.0.19) — soru medya kolonları, uzaktan açma anahtarı, şikâyet bağı.
--
-- Neden: sorulara kısa ses (<=15 sn) ve/veya görsel eklenebilir. Görsel moderasyondan geçene kadar
-- 'pending' kalır (image_status); dosyalar PRIVATE `question-media` bucket'ında (src/config/supabase.ts).
-- media_questions_enabled varsayılan KAPALI: mağaza sürümü beklemeden backoffice'ten açılır (079 deseni).
-- Hepsi IF NOT EXISTS: yeniden uygulama zararsız. Rollback: 084_question_media_rollback.sql.
-- Bu migration repo'da hazırdır; prod'a uygulama ayrı adımdır (Task 14).

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS voice_path text,
  ADD COLUMN IF NOT EXISTS voice_duration_ms integer
    CONSTRAINT questions_voice_duration_ms_check CHECK (voice_duration_ms BETWEEN 1 AND 15000),
  ADD COLUMN IF NOT EXISTS image_path text,
  ADD COLUMN IF NOT EXISTS image_status text
    CONSTRAINT questions_image_status_check CHECK (image_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS media_questions_enabled boolean NOT NULL DEFAULT false;

-- Şikâyet, belirli bir soruya bağlanabilir; soru silinirse şikâyet kaydı kalır.
-- (reports.category enum'u prod'da var ama migration'ı yok — yeni değer dosya sonunda eklenir.)
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS question_id uuid REFERENCES public.questions(id) ON DELETE SET NULL;

-- Foto moderasyon kuyruğu profil fotoğrafı + soru görseli için ortak; mevcut satırlar 'profile' olur.
ALTER TABLE public.photo_moderation_checks
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'profile'
    CONSTRAINT photo_moderation_checks_kind_check CHECK (kind IN ('profile', 'question'));

-- Şikâyet kategorisi: prod'da reports.category Postgres enum'u `report_category` (migration'ı yok);
-- validator 'INAPPROPRIATE_MEDIA' kabul ediyor ama enum'da değer yoksa INSERT 22P02 → 500 olur.
-- KENDİ BAŞINA bir ifade olarak uygula: ALTER TYPE ... ADD VALUE eski PG'de (<12) transaction bloğu
-- içinde çalışmaz, yenilerde de eklenen değer aynı transaction'da kullanılamaz. Çalıştırıcı dosyayı
-- tek transaction'a sarıyorsa bu satırı ayrı çalıştır. IF NOT EXISTS: yeniden uygulama zararsız.
ALTER TYPE public.report_category ADD VALUE IF NOT EXISTS 'INAPPROPRIATE_MEDIA';
