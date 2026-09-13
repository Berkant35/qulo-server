-- 054_preferred_languages_tek_kaynak.sql
-- Dil tercihi tek kaynak (2026-09-13).
--
-- Bulgu (canli DB): Turkce disi locale'li 28 kullanicinin 22'sinde
-- users.preferred_languages = {tr} kalmisti. Kayit, sosyal giris ve onboarding
-- (PUT /me/languages -> set_user_languages) yalniz user_languages tablosuna yaziyordu;
-- sutun 012'deki DEFAULT ARRAY['tr'] ile doluyordu. matching.service (5.6) ve
-- quiz.service ise ONCE sutunu okur -> yabanci kullanici yalniz Turkce sorulu
-- profilleri goruyor, Turkler onu hic gormuyordu. Turk kullanicinin onboarding'de
-- sectigi ek diller de (tablo {tr,en}, sutun {tr}) eslesmeye hic girmiyordu.
--
-- Kural: users.preferred_languages kanonik, user_languages turev; ikisi de SADECE
-- set_user_languages RPC'si ile yazilir (tek transaction). RPC uygulama dilini
-- (users.locale) her zaman listeye ekler ve tekrarlari sira koruyarak duser —
-- yani PUT, PATCH, kayit ve bu migration ayni kuraldan gecer.
-- Bu fonksiyon yalniz service_role tarafindan cagrilir; kullanici siniri
-- (p_user_id = istekteki kullanici) uygulama katmanindadir.
-- Parity testi: tests/services/user-language.service.test.ts (bu dosyayi okur).

BEGIN;

-- 1) Varsayilan artefakti kapat: yeni satir bos dizi ile dogar; kayit INSERT'i
--    preferred_languages = [locale] yazar, RPC turev tabloyu tamamlar.
ALTER TABLE users
  ALTER COLUMN preferred_languages SET DEFAULT '{}'::text[];

-- 2) RPC: tek yazma yolu. Donus tipi degistigi icin DROP + CREATE
--    (CREATE OR REPLACE donus tipini degistiremez).
DROP FUNCTION IF EXISTS set_user_languages(uuid, text[]);

CREATE FUNCTION set_user_languages(p_user_id uuid, p_languages text[])
RETURNS text[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_locale text;
  v_langs  text[];
BEGIN
  SELECT locale INTO v_locale FROM users WHERE id = p_user_id;

  -- Uygulama dili her zaman listede; tekrarlar ilk gorunum sirasiyla tekillesir.
  SELECT array_agg(l ORDER BY first_ord) INTO v_langs
  FROM (
    SELECT l, min(ord) AS first_ord
    FROM unnest(array_append(p_languages, v_locale)) WITH ORDINALITY AS t(l, ord)
    WHERE l IS NOT NULL
    GROUP BY l
  ) s;
  v_langs := COALESCE(v_langs, '{}'::text[]);

  DELETE FROM user_languages WHERE user_id = p_user_id;
  INSERT INTO user_languages (user_id, language_code)
  SELECT p_user_id, unnest(v_langs)
  ON CONFLICT (user_id, language_code) DO NOTHING;
  UPDATE users
  SET preferred_languages = v_langs
  WHERE id = p_user_id;

  RETURN v_langs;
END;
$$;

-- Istemci anahtarlari dogrudan cagiramasin (041/043/052 ilkesi).
REVOKE ALL ON FUNCTION set_user_languages(uuid, text[]) FROM PUBLIC, anon, authenticated;

-- 3) Yedek tablo — denetim izi + rollback kaynagi. Yeni public tablo RLS'siz dogar ve
--    anon key ile okunur/silinirdi (038/045 ilkesi): RLS acik + policy yok + REVOKE.
CREATE TABLE IF NOT EXISTS _backup_054_preferred_languages (
  user_id uuid PRIMARY KEY,
  old_preferred_languages text[],
  old_user_languages text[],
  reason text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._backup_054_preferred_languages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._backup_054_preferred_languages FROM PUBLIC, anon, authenticated;

-- 4) Veri duzeltmesi — dongu icinde RPC (CTE icinden ayni tabloyu degistiren fonksiyon
--    cagrisi yok). Kural, aktif her kullanici icin:
--      artefakt (sutun tam olarak {tr} VE uygulama dili tr degil): tablo ∪ {locale};
--        kullanicinin hic Turkce sorusu yoksa 'tr' duser (eski istemci artefakti tabloya da sizmisti)
--      digerleri: sutun ∪ tablo ∪ {locale}  (hicbir dil kaybolmaz)
--    Kume olarak hem sutuna hem tabloya esitse dokunulmaz. Dokunulan her satir once yedeklenir.
DO $$
DECLARE
  r record;
  v_supported text[] := ARRAY['tr','en','de','fr','es','ar','ru','pt','it','ja','ko','zh','nl','pl','sv','hi'];
  v_langs text[];
BEGIN
  FOR r IN
    SELECT u.id,
           u.locale,
           COALESCE(u.preferred_languages, '{}'::text[]) AS pref,
           COALESCE((SELECT array_agg(ul.language_code ORDER BY ul.created_at)
                     FROM user_languages ul WHERE ul.user_id = u.id), '{}'::text[]) AS tbl,
           (u.preferred_languages = '{tr}' AND u.locale <> 'tr') AS artifact,
           EXISTS (SELECT 1 FROM questions q WHERE q.user_id = u.id AND q.locale = 'tr') AS has_tr_question
    FROM users u
    WHERE u.is_deleted = false
  LOOP
    SELECT array_agg(l ORDER BY first_ord) INTO v_langs
    FROM (
      SELECT l, min(ord) AS first_ord
      FROM unnest(
        (CASE WHEN r.artifact THEN r.tbl ELSE r.pref || r.tbl END) || ARRAY[r.locale]
      ) WITH ORDINALITY AS t(l, ord)
      WHERE l = ANY (v_supported)
        AND (NOT r.artifact OR r.has_tr_question OR l <> 'tr')
      GROUP BY l
    ) s;
    v_langs := COALESCE(v_langs, ARRAY[r.locale]);

    IF v_langs <@ r.pref AND r.pref <@ v_langs AND v_langs <@ r.tbl AND r.tbl <@ v_langs THEN
      CONTINUE;
    END IF;

    INSERT INTO _backup_054_preferred_languages (user_id, old_preferred_languages, old_user_languages, reason)
    VALUES (r.id, r.pref, r.tbl, CASE WHEN r.artifact THEN 'default_tr_artifact' ELSE 'merge' END)
    ON CONFLICT (user_id) DO NOTHING;

    PERFORM set_user_languages(r.id, v_langs);
  END LOOP;
END $$;

COMMIT;
