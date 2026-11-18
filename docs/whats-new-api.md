# Yenilikler (What's New) — mobil sözleşme

Kalem A5 (2.2.0). Mobil tarafı: C5. Tablo: `whats_new` (migration 086, 2.2.0 yayınında uygulanır).

## Uç

`GET /api/v1/app/whats-new?version=2.2.0&platform=ios&locale=tr`

Kimlik doğrulama yok (`/app/config` ile aynı düzey; giriş öncesi de çağrılabilir). `generalLimiter` altında.

| Parametre | Kural |
|---|---|
| `version` | zorunlu, `x.y.z` (uygulamanın `versionName`'i). `2.2.0+112` gelirse `+build` atılır. Aksi halde 400 `VALIDATION_ERROR` |
| `platform` | zorunlu, `ios` \| `android` (`all` yalnız admin kaydında) |
| `locale` | opsiyonel; 18 dilden biri (`tr-TR` gibi etiket de olur). Bilinmiyor/yok -> `en` |

## Yanıt (200)

```json
{ "item": { "id": "uuid", "version": "2.2.0", "title": "...", "body": "...", "ctaLabel": "Tamam" | null, "imageUrl": "https://..." | null } }
```

Gösterilecek kayıt yoksa: `{ "item": null }`.

Seçim kuralı: istemci sürümüne **tam eşleşen** aktif kayıt; önce platforma özel, yoksa `all`. Metin dili: istenen dil, yoksa `en`.
Sunucu önbelleği 60 sn; admin kaydı kaydedince anında temizlenir.

## Mobil davranış

- Uygulama güncellendikten sonra açılışta **bir kez** sorulur; `item` varsa mevcut overlay kuyruğu üzerinden gösterilir.
- Gösterilen `item.id` yerelde saklanır; aynı `id` bir daha gösterilmez (yeni sürüm = yeni kayıt = yeni `id`).
- Ağ/sunucu hatası, 4xx/5xx veya `item: null` -> **sessizce geç**, hata gösterme, yeniden deneme döngüsü yok (bir sonraki açılışta yine sorulur).
- `ctaLabel` null ise yalnız kapat düğmesi gösterilir; `imageUrl` null ise görselsiz yerleşim.
- Metin sınırları (sunucu zorlar): başlık ≤60, gövde ≤400, düğme ≤24 karakter.

## Backoffice

`/admin/whats-new` — liste (sürüm, platform, durum, dil doluluğu), oluştur/düzenle (18 dil, EN zorunlu), aç/kapat.
Aynı (sürüm, platform) için tek aktif kayıt (DB kısıtı).

## Güvenlik

`whats_new` RLS açık, politika yok: yalnız service_role. Kırmızı test planı (uygulandıktan sonra):
anon/publishable key ile `GET /rest/v1/whats_new?select=*` -> 401/403 ya da boş dizi (veri dönmemeli);
anon ile `POST /rest/v1/whats_new` -> reddedilmeli. Yeşil: `GET /api/v1/app/whats-new` (service_role) 200.
