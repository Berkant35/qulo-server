-- 061: "Hatırlamıyorum" edinim kanalı (2026-09-23)
-- Mobil 2.0.12 anketten "Atla" butonunu kaldırıyor; kaçış yolu skip yerine veri
-- üreten bu kanal. Şema değişikliği yok, tek satır. 18 dil (th/id dahil);
-- eksik dilde pickLabel en'e düşer. Rollback: 061_acquisition_dont_remember_rollback.sql
INSERT INTO acquisition_channels (key, label, emoji, sort_order, is_freeform) VALUES
  ('dont_remember', '{"tr":"Hatırlamıyorum","en":"I don''t remember","de":"Weiß ich nicht mehr","fr":"Je ne m''en souviens pas","es":"No lo recuerdo","ar":"لا أتذكر","ru":"Не помню","pt":"Não me lembro","it":"Non ricordo","ja":"覚えていない","ko":"기억나지 않아요","zh":"不记得了","nl":"Weet ik niet meer","pl":"Nie pamiętam","sv":"Jag minns inte","hi":"मुझे याद नहीं","th":"จำไม่ได้","id":"Saya tidak ingat"}', '🤷', 80, false)
-- Rollback (is_active=false) sonrası yeniden uygulanınca kanal geri açılır; etiketlere dokunulmaz.
ON CONFLICT (key) DO UPDATE SET is_active = true;
