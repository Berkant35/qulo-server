-- 043_user_languages_hi_atomic.sql
-- Google Play inceleme ekibinin (Hindi cihaz) ortaya cikardigi iki sorun:
--
-- (1) `user_languages.language_code` CHECK constraint'i 15 dilde kalmisti; sunucu
--     (constants/locales.ts) ve mobil 16 dil destekliyor. `hi` gonderen her istemci
--     PUT /me/languages'ta 500 aliyordu (2026-09-02 ve 09-05, 24 kez).
--
-- (2) `setUserLanguages` once DELETE sonra INSERT yapiyordu — iki ayri istek, tek
--     transaction degil. INSERT patlayinca kullanicinin dil listesi SILINMIS kaliyordu
--     (inceleme hesaplarinin user_languages satiri bos). Degisim tek SQL fonksiyonunda
--     yapilir: fonksiyon govdesi tek transaction'dir, INSERT hata verirse DELETE de
--     geri alinir.
--
-- Constraint listesi = SUPPORTED_LOCALES; parity testi bu dosyayi okur
-- (tests/services/user-language.service.test.ts). Yeni dil eklerken ikisini birlikte
-- guncelle.

ALTER TABLE user_languages
  DROP CONSTRAINT IF EXISTS user_languages_language_code_check;

ALTER TABLE user_languages
  ADD CONSTRAINT user_languages_language_code_check
  CHECK (language_code = ANY (ARRAY[
    'tr', 'en', 'de', 'fr', 'es', 'ar', 'ru',
    'pt', 'it', 'ja', 'ko', 'zh', 'nl', 'pl', 'sv', 'hi'
  ]));

CREATE OR REPLACE FUNCTION set_user_languages(p_user_id uuid, p_languages text[])
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM user_languages WHERE user_id = p_user_id;
  INSERT INTO user_languages (user_id, language_code)
  SELECT p_user_id, unnest(p_languages)
  ON CONFLICT (user_id, language_code) DO NOTHING;
$$;

-- Sunucu service_role ile cagirir; istemci anahtarlari dogrudan cagiramasin (041 ile ayni ilke).
REVOKE ALL ON FUNCTION set_user_languages(uuid, text[]) FROM PUBLIC, anon, authenticated;
