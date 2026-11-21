# Planlı yerel bildirim senkronu — sözleşme (2.2.0 A6)

Amaç: aynı konuda sunucu push'u ile istemcinin yerel (planlı) bildirimi ÇİFT gitmesin.
İstemci arka plana geçerken planladığı kuralları bildirir; sunucu motoru `until`'e dek o kullanıcı için
aynı konulu kuralı atlar. Özellik `localScheduleEnabled` bayrağıyla kapalı başlar.

## Bayrak
- `GET /api/v1/app/config` yanıtında `localScheduleEnabled: boolean` (varsayılan `false`, fail-closed).
- Kaynak: `app_config.local_schedule_enabled` (migration 090). Backoffice → App Config → "Planlı Yerel Bildirim".
- Sunucu önbelleği 60 sn. Kolon yoksa / okunamazsa `false`.

## Uç
`PATCH /api/v1/users/me/local-schedule` (kimlikli; `/users` öneki mevcut `/me/*` uçlarıyla aynı — `/api/v1/me/...` YOK).

```json
{ "localScheduled": ["quiz_unfinished", "limit_refreshed", "new_people", "return_3d", "return_7d"], "until": "2026-11-29T09:00:00Z" }
```

| Alan | Kural |
|---|---|
| `localScheduled` | Bilinen kural adları dizisi (yukarıdaki beş). Bilinmeyen ad → 400. Tekrarlar teke indirilir. Boş dizi = planı temizle. |
| `until` | ISO 8601 (zaman dilimi ofsetli). Dolu liste için zorunlu; en fazla şimdi + 8 gün (aşarsa 400). Boş listede yok sayılır. |

Yanıt: `204 No Content`. Hatalar: `400` doğrulama, `401` kimliksiz, `429` genel rate limit, `500` DB hatası.
İstemci öne gelince `{ "localScheduled": [] }` ile temizler (ayrı `DELETE` yok).

## Motor eşlemesi (`until` geçmemişken)
| Yerel kural | Atlanan sunucu kuralı |
|---|---|
| `quiz_unfinished` | `lifecycle_quiz_unfinished` |
| `new_people` | `lifecycle_new_people` |
| `return_3d`, `return_7d` | `lifecycle_new_people` (yerel metin "sen yokken yeni insanlar katıldı"; 3–30 gün inaktif penceresi aynı) |
| `limit_refreshed` | — (sunucuda böyle bir kural yok; ad kabul edilir, etkisi yok) |

`day1_return` eşlenmez: kayıttan 4–30 saat penceresi `return_3d` (72 sa+) ile zamanda kesişmez ve her yeni
kullanıcıda `return_3d` planlı olacağından bastırmak kuralı tamamen öldürürdü. `winback` (30+ gün) `until` (≤ 8 gün)
sonrasına düşer, çakışmaz. `unread_message`, `match_waiting`, `likes_waiting`, `profile_incomplete` etkilenmez.

Süresi geçmiş / bozuk kayıt = plan yok (fail-open: çift bildirim, kayıp bildirimden iyidir).
Holdout (`fnv1a32(userId)%100 < holdout_pct`), tavanlar, tercihler, "günde tek karar" değişmez; yerel plan yalnız
kural SEÇİMİNİ etkiler (atlanan kural yerine sıradaki uyan kural seçilebilir).

## Saklama ve maliyet
`users.local_schedule jsonb` = `{"rules":[...],"until":"ISO"}` | NULL. Motor zaten her turda `users`'ı okur;
kolon aynı sorguya eklendi → ek sorgu yok. İstemci başına en fazla iki PATCH/oturum (paused → plan, resumed → temizle):
tek satır UPDATE, kullanıcı başına.

## Yayın sırası
1. Migration 090 (kolonlar; `local_schedule` yokken yeni sunucu kodu motor sorgusunda hata verir).
2. Sunucu kodu (release/2.2.0).
3. Mobil: `NoopLocalScheduleSync` yerine bu ucu çağıran gerçek `LocalScheduleSync`.
4. Bayrak (`local_schedule_enabled`) en son, backoffice'ten.
