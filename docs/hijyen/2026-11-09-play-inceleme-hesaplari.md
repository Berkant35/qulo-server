# Play inceleme hesapları → `is_test_account = true` (2026-11-09)

Sahip: qulo-backend. Neden: Google Play inceleme/ön-lansman cihazlarının açtığı hesaplar Android kayıt ve huni
rakamlarını ~2,5 kat şişiriyordu (2.0.18 plan, "Sürümsüz hijyen").

## Teyit ölçütleri (hepsi birlikte)
- E-posta `^[a-z]+\.[0-9]{5}@gmail\.com$` (üretilmiş ad + 5 hane), `auth_provider = google`, `user_consents.platform = android`.
- Oluşturma zamanı sürüm gönderim gecelerine ya da hemen ertesine denk (10-18/19, 10-31→11-01, 11-02, 11-03);
  çoğu aynı dakika içinde ikili (ör. 11-01 00:19 iki hesap, 11-02 01:23 iki hesap).
- Davranış: tek aktif gün, en uzun oturum 18 dk, 6 saat sonra dönüş 0; swipe 0, quiz 0, mesaj 0, eşleşme 0,
  IAP/abonelik 0; başka kullanıcıdan beğeni 0; konum (lat) hiçbirinde yok.
- Aynı kalıbın 09-02…10-07 arasındaki 32 hesabı zaten `is_test_account = true` idi (elle işaretlenmiş).
  `billiconaway` adı iki kez üretilmiş (09-05 `.95875` zaten test, 11-01 `.74357` bu listede).

## Dışarıda bırakılan
- Yok. 20 hesabın hiçbirinde gerçek kullanıcı izi (dönüş, etkileşim, ödeme, konum) yok.
- Not: `joshhart.23594` ve `rochellecohen.16710` profili doldurmuş (2 soru + foto + push token) ama aynı dakikada açılmış
  ikiz bot hesabı var, 17–18 dk sonra bir daha dönmemiş, konumsuz oldukları için hiç kimseye gösterilmemiş. Teyitli sayıldı.

## İşaretlenen 20 hesap
| id | e-posta | oluşturma (TR) |
|---|---|---|
| f33888dc-cf87-4015-bad6-e6be4be33ea9 | jenniferreyes.14634 | 10-18 22:59 |
| 505c5852-968c-4ebd-8f66-d491b5bc346a | vickysingleton.78774 | 10-18 22:59 |
| b420371b-90b4-4ff8-a244-0ac230ab53b3 | neliabowens.26293 | 10-18 23:08 |
| 54935fcf-ca57-4964-8ec0-4fb40a1a9506 | codypatterson.12163 | 10-18 23:32 |
| 6383df2f-117c-4f9d-b4eb-04347de80c90 | jennifermathis.89904 | 10-19 14:14 |
| 725ae216-77f9-419e-886b-aebf073f2776 | pattywalker.97713 | 10-19 14:22 |
| 9d59a2e4-6211-4af8-8c6f-10a291a68912 | mamieballard.79370 | 10-19 14:38 |
| 3d2f60ad-a47b-4aff-8c4e-f3dbaef5ae6a | pennymassey.34261 | 10-19 15:27 |
| ae1acda9-fe12-446e-8db7-3699ecafd5c3 | melodymoreno.44110 | 10-31 23:55 |
| 533376c5-e6f9-45eb-a11f-f67cb120dc79 | luzpeters.19902 | 10-31 23:56 |
| 5c9a5463-1189-4370-b430-76e94a39e116 | joshhart.23594 | 11-01 00:19 |
| 7500314a-4fa3-4be3-b229-54075f84739c | billiconaway.74357 | 11-01 00:19 |
| 9521bd7b-ecb2-4b34-b4b8-14decf085f01 | angiewelch.88908 | 11-02 00:47 |
| 6d846542-9fc3-4b18-b8eb-5c102fbc9f1a | deannadoyle.63897 | 11-02 00:49 |
| 0ea18099-317f-4a4c-891e-142376f3d78f | suecolon.74141 | 11-02 00:58 |
| 50cd07e0-aeac-44f2-8db0-ec644a3116e9 | calebmoody.34475 | 11-02 00:59 |
| 8f6d384f-1d87-4709-b5b5-5d1276dc3046 | rickeylewis.86073 | 11-02 01:23 |
| 78ddefe1-f025-4f03-8516-895326f4a588 | rochellecohen.16710 | 11-02 01:23 |
| 4b3ffc58-fcea-485f-a1ca-414f2e7c70a6 | carolelove.99516 | 11-03 11:19 |
| 7f8d6d6e-eca1-42ee-a74b-a5ec2d775b5e | conniealexander.13115 | 11-03 17:14 |

## Uygulanan
```sql
UPDATE public.users SET is_test_account = true
 WHERE id IN (<yukarıdaki 20 id>) AND is_test_account = false;
```

## Geri dönüş
```sql
UPDATE public.users SET is_test_account = false
 WHERE id IN (
  'f33888dc-cf87-4015-bad6-e6be4be33ea9','505c5852-968c-4ebd-8f66-d491b5bc346a','b420371b-90b4-4ff8-a244-0ac230ab53b3',
  '54935fcf-ca57-4964-8ec0-4fb40a1a9506','6383df2f-117c-4f9d-b4eb-04347de80c90','725ae216-77f9-419e-886b-aebf073f2776',
  '9d59a2e4-6211-4af8-8c6f-10a291a68912','3d2f60ad-a47b-4aff-8c4e-f3dbaef5ae6a','ae1acda9-fe12-446e-8db7-3699ecafd5c3',
  '533376c5-e6f9-45eb-a11f-f67cb120dc79','5c9a5463-1189-4370-b430-76e94a39e116','7500314a-4fa3-4be3-b229-54075f84739c',
  '9521bd7b-ecb2-4b34-b4b8-14decf085f01','6d846542-9fc3-4b18-b8eb-5c102fbc9f1a','0ea18099-317f-4a4c-891e-142376f3d78f',
  '50cd07e0-aeac-44f2-8db0-ec644a3116e9','8f6d384f-1d87-4709-b5b5-5d1276dc3046','78ddefe1-f025-4f03-8516-895326f4a588',
  '4b3ffc58-fcea-485f-a1ca-414f2e7c70a6','7f8d6d6e-eca1-42ee-a74b-a5ec2d775b5e');
```

## Kalıcı çözüm önerisi (yapılmadı)
Kayıtta bu kalıbı otomatik test hesabı yapmak gerçek kullanıcıyı da yakalayabilir (kalıp Google'ın değil, rastgele bir
e-posta biçimi). Sürüm gecelerinde bu sorguyu tekrar çalıştırmak daha güvenli.
