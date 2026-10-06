-- 077 · Kehanet açığı — gösterim kapısı (alt iş 3)
-- Spec: docs/superpowers/specs/2026-10-06-kehanet-acigi-gosterim-kapisi-design.md
--
-- Discover'ın son 30 günde izleyiciye gösterdiği kartlar. LIKE swipe ve quiz/start yalnız bu
-- kartlara (ya da swipe/match/quiz geçmişi olan hedefe) açıktır; bilinen bir UUID ile hedefin
-- cinsiyet tercihini 403/200 farkından okumak (kehanet) böylece kapanır. Satırlar günlük cron'la
-- 30 günden eskiyse silinir. PostgREST'e (anon/authenticated) tamamen kapalı; yalnız sunucu
-- (service_role) okur/yazar.

CREATE TABLE IF NOT EXISTS public.discover_served (
  viewer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  served_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_id, target_id)
);

-- Temizlik cron'u (served_at < now() - 30 gün) için.
CREATE INDEX IF NOT EXISTS idx_discover_served_served_at ON public.discover_served (served_at);
-- target_id FK'sının ON DELETE CASCADE'i hedef silinince tam tarama yapmasın.
CREATE INDEX IF NOT EXISTS idx_discover_served_target ON public.discover_served (target_id);

REVOKE ALL ON public.discover_served FROM anon, authenticated;
ALTER TABLE public.discover_served ENABLE ROW LEVEL SECURITY;  -- policy yok ⇒ anon/auth erişimi kapalı

-- Geçiş anahtarı: deploy'dan önce açılmış Discover sayfalarının served kaydı yok; anahtar
-- deploy'dan ~30 dk sonra backoffice'ten açılır. Kapalıyken yalnız engel + tek tip yanıt uygulanır.
ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS served_gate_enabled boolean NOT NULL DEFAULT false;
