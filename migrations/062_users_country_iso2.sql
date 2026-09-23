-- 062: users.country tek biçim — ISO 3166-1 alpha-2 (2026-09-23)
-- Mobil 2.0.12 konumdan ülke kodu yazmaya başlıyor (TR, US...). Sütundaki tek mevcut değer
-- seed/test akışının yazdığı tam ad 'Türkiye' (417 satır, 09-23 sayımı); FormatManager ISO-2
-- bekler. CHECK kısıtı YOK: seed-store-profiles/seed-test-users hâlâ tam ad yazıyor (backlog).
UPDATE users SET country = 'TR' WHERE country = 'Türkiye';
