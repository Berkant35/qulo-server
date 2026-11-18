# Plus Haftalık — sözleşme (2.2.0, B4 / K1)

Tek yeni ürün: **Plus Haftalık**. Plan `plus` kalır (haklar/limitler Plus ile aynı kaynak, kopya yok);
**dönem** (`weekly` | `monthly`) ayrı alan. Premium'a haftalık YOK. Deneme süresi YOK. Fiyat mağazada, kodda değil.

## Ürün kimlikleri
| Platform | Ürün kimliği | Plan | Dönem |
|---|---|---|---|
| iOS (App Store) | `quloplusweekly` | plus | weekly |
| Android (Google Play) | `quloplusweekly` | plus | weekly |

Sunucuda `SUBSCRIPTION_WEEKLY_PRODUCT_IDS` (`src/types/index.ts`) iki platformu ayrı anahtar tutar. Google'ın
`urun:basePlan` biçimi `storeProductKey` ile kırpılır. Haritada olmayan abonelik ürünü: webhook `console.warn`
(`[webhook] unknown subscription product ignored`) ile yok sayılır, 200 döner; `POST /subscriptions/activate`
400 `UNKNOWN_PRODUCT` döner.

## Dönem bonusu
- Aylık: `subscriptionLimits[plan].monthlyPurpleBonus` (değişmedi; Plus 500, Premium 1000 canlı).
- Haftalık: economy config `subscriptionBonuses.weekly.plus` (varsayılan **100**, sınır 0–500). Alan eski
  config sürümlerinde yoksa 100 uygulanır (migration gerekmez). Admin'den değiştirilebilir.
- Her dönem (INITIAL_PURCHASE ve her RENEWAL) için bir kez. Tekilleştirme `reference_id`:
  aylık `sub_<plan>_<bitişISO>`, haftalık `sub_plus_weekly_<bitişISO>` (bitiş ISO normalize). İstemci
  `activate` + webhook aynı dönemi bildirse tek bonus. Ek: migration 047 kısmi tekil indeksi.
- PRODUCT_CHANGE bonus vermez (eski kural). Ürün değişimi yürürlüğe girince gelen INITIAL_PURCHASE/RENEWAL
  yeni ürünün dönemi sayılır ve o ürünün bonusunu bir kez verir. Erişim her olaydan sonra RevenueCat
  GET /subscribers'tan yazılır (kesinti yok).
- Rainbow ödenmiş pay: haftalık bonus da `rainbow.subscriptionPaidShare.plus` (0,30) ile hesaplanır
  (haftalık 100 → 30). Rainbow şu an kapalı; açmadan önce fiyatla birlikte gözden geçirilmeli.

## Şema
Migration `089_subscription_period.sql` (+ `_rollback`): `users.subscription_period text`
(`weekly|monthly|NULL`). **Sunucu yayınlanmadan ÖNCE uygulanmalı** (yeni kod `users` güncellemesine bu kolonu
yazar; kolon yoksa güncelleme topluca reddedilir). NULL + plan = `monthly` (eski aboneler).

## Yanıt alanları (mevcutlar değişmedi, yalnız ekleme)
- `GET /subscriptions/daily-stats`: `plan` (`free|plus|premium`, süresi dolmuşsa `free`), `period`
  (`weekly|monthly|null`), `periodPurpleBonus` (bu planın/dönemin bonusu: haftalık Plus 100, aylık Plus 500).
  Eski `monthlyPurpleBonus` aynen (haftalık kullanıcıda da aylık Plus değeri) — **mobil haftalıkta
  `periodPurpleBonus` göstermeli**.
- `GET /subscriptions/status` ve activate yanıtı: `subscription.period`.
- `GET /users/me`: `subscriptionPeriod` (plan yoksa null).
- `GET /app/economy`: `config.subscriptionBonuses.weekly.plus` (paywall'da "haftada 100 mor" metni için).

## Mobil (C6) göstermesi gerekenler
Paywall'da üçüncü seçenek Plus Haftalık; mağaza fiyatı `priceString` (haftalık dönem etiketi mağazadan).
Haklar Plus ile aynı; fark: "her hafta 100 mor" (aylıkta "ayda 500"). Aktif abonelikte dönem etiketi
`subscriptionPeriod`/`period`'dan. `purchasableProductIds`'e `quloplusweekly` eklenir (iOS+Android).

## E1 — mağaza / RevenueCat notu
- App Store Connect: otomatik yenilenen abonelik `quloplusweekly`, 1 hafta süre, mevcut Plus abonelik
  grubunda (yükseltme/düşürme sırası: haftalık < aylık Plus < Premium), deneme yok.
- Google Play: abonelik `quloplusweekly` (base plan haftalık), deneme yok.
- RevenueCat: ürün `quloplusweekly` (iki mağaza), **mevcut Plus entitlement'ına bağlanır** (yeni entitlement
  yok), mevcut offering'e paket olarak eklenir. Webhook'ta ürün kimliği birebir bu olmalı, yoksa para
  alınıp hak verilmez (sunucu uyarı loglar).
- Sırası: migration 089 → sunucu → mağaza ürünleri/RC → mobil.

## Ölçüm
Abonelik ölçüm event'i sunucuda yok; `iap_transactions.product_id` webhook'ta ürün kimliğini (`quloplusweekly`)
taşır, dönem ürün kimliğinden türetilir. Analitik için `users.subscription_period` ayrım sağlar.
