-- 050_questions_reorder_index_fix.sql
--
-- SORUN: Soru siralama (PATCH /questions/me/reorder -> RPC reorder_questions)
-- migration 029'dan beri yapisal olarak KIRIK.
--
-- Prod'da (user_id, order_num) uzerinde IKI unique yapi vardi:
--   questions_user_id_order_num_key   UNIQUE ... DEFERRABLE INITIALLY DEFERRED
--   uq_questions_user_order           CREATE UNIQUE INDEX (029) — deferrable DEGIL
-- Ilki repo'da hic yoktu: Nisan 2026'da RPC ile birlikte SQL Editor'da elle
-- eklenmis (commit 96a7837, "use Supabase RPC for atomic question reorder").
-- 029 (2026-06-13) bunu bilmeden "unique kisit ekle" diye ikinci, deferrable
-- olmayan bir index ekledi.
--
-- RPC satir satir `UPDATE ... SET order_num = i` yapiyor; iki soruyu yer
-- degistirmek bile ara adimda gecici bir mukerrer uretir. Deferrable kisit bunu
-- commit'e kadar bekler — ama deferrable olmayan index aninda patlar. Yani kimlik
-- (no-op) disindaki HER siralama unique_violation ile basarisiz oluyordu; servis
-- 500 donuyor, mobil siralamayi sessizce geri aliyordu (yalniz dev.log).
--
-- KANIT (2026-09-10):
--   1. Gecici tabloda A/B (gercek veriye dokunulmadi):
--        prod hali (kisit + 029 index): iki soru takasi -> unique_violation (029 index)
--        yalniz deferrable kisit:       ayni takas       -> ok
--   2. Gercek prod RPC + gercek indexler, test hesabinin iki sorusu, zorunlu
--      geri almayla: unique_violation "uq_questions_user_order". Sira degismedi.
--   3. Garanti korunuyor: yalniz deferrable kisitla GERCEK bir mukerrer reddedildi.
--
-- SAHA ETKISI: flow_events'te 2026-06-12'den beri TEK reorder cagrisi yok.
-- Kaydedici PATCH'i goruyor (3.904 cagri / 155 kullanici), bu yol hicbir erken
-- cikisa takilmiyor, ekran rotali. Yani kimse denememis — bug LATENT, bilinen bir
-- kullanici etkilenmedi.
--
-- GUVENLIK (uygulamadan once olculdu): anon ve authenticated RPC'yi EXECUTE
-- edebiliyor ve questions uzerinde UPDATE grant'leri var, AMA tabloda RLS acik ve
-- 0 policy var, RPC de SECURITY INVOKER. Anon/authenticated olarak no-op UPDATE:
-- 0 satir; servis rolu: 2 satir (pozitif kontrol). Yani bu index'i kaldirmak
-- anon'a yazma yolu ACMIYOR. (Bugun RPC'yi pratikte koruyan sey ironik bicimde bu
-- bug'di; asil koruma RLS ve o yerinde.)
--
-- ON CONFLICT: PostgreSQL deferrable kisiti ON CONFLICT hakemi olarak kabul
-- etmez. (user_id, order_num) uzerinde ON CONFLICT/upsert kullanan kod YOK (src,
-- scripts, migrations, web tarandi) — index'i kaldirmak bir upsert'i kirmiyor.
--
-- DUZELTME: once deferrable kisitin varligini garanti et (prod'da no-op; repo'dan
-- sifirdan kurulan bir ortamda uniqueness'in hic kalmamasini onler), SONRA 029'un
-- index'ini kaldir. Sira onemli: arada uniqueness'siz bir an olmasin.
--
-- Geri alma: 050_questions_reorder_index_fix_rollback.sql

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.questions'::regclass
      AND conname = 'questions_user_id_order_num_key'
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_user_id_order_num_key
      UNIQUE (user_id, order_num) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DROP INDEX IF EXISTS public.uq_questions_user_order;

COMMIT;

-- ---------------------------------------------------------------------------
-- REFERANS (bu migration CALISTIRMIYOR): prod'daki RPC tanimi, repo'da ilk kez.
-- 2026-04-16'dan beri yalnizca prod'da yasiyordu (drift). Tam bir drift-yakalama
-- migration'i backlog'da (tasks/todo.md).
--
-- CREATE OR REPLACE FUNCTION public.reorder_questions(p_user_id uuid, p_ordered_ids uuid[])
--  RETURNS void LANGUAGE plpgsql AS $function$
-- BEGIN
--   FOR i IN 1..array_length(p_ordered_ids, 1) LOOP
--     UPDATE questions SET order_num = i
--     WHERE id = p_ordered_ids[i] AND user_id = p_user_id;
--   END LOOP;
-- END;
-- $function$;
