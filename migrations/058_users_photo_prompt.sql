-- 058_users_photo_prompt.sql
-- TR seed (test) profilleri: fotoğrafı üreten prompt'un BİREBİR klonu profil kaydında saklanır.
-- Yalnız seed profilleri doldurur (scripts/seed/tr-seed-lib.ts buildUserRow); gerçek kullanıcılarda NULL.
-- Şekil (jsonb): { prompt, prompt_sha1, model, replicate_id, input, generated_at, seed_id, province, district }
-- Mobil API yolları users'ı açık kolon listesiyle seçer (user/matching/page-message/notification-engine) → istemciye gitmez.
-- İstisna: admin panel `admin.service.getUserDetail` select('*') (EJS şablonu alan seçiyor; HTTP'ye çıkmıyor) — backlog: açık liste.
-- Anon/authenticated kolon grant'ı (051) yeni kolona genişlemez → PostgREST'ten okunamaz (canlı role_column_grants, 2026-09-15).

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS photo_prompt JSONB;

COMMENT ON COLUMN users.photo_prompt IS
  'Seed profilleri: foto üretim prompt''unun tam klonu + üretim meta verisi (model, replicate_id, sha1). Gerçek kullanıcıda NULL.';

COMMIT;
