# Günlük ödüllü reklam (2.2.0, B3) — mobil sözleşmesi

Kullanıcı günde 1 kez ödüllü reklam izler, `rewards.rewardedAd.purple` (varsayılan 10) mor kazanır.
Ödülü **yalnız sunucu** verir (AdMob SSV). **İstemci bakiyeyi kendisi artırmaz.**

Kaynak: https://developers.google.com/admob/android/rewarded-video-ssv (2026-11-18). iOS aynı SSV mekanizmasını
kullanır (`GADServerSideVerificationOptions`).

## Akış
1. `GET /api/v1/rewards/rewarded-ad/status` (Bearer) →
   `{ available, purple, resetsAt, customData, ssvUserId }`. `available=false` ise butonu gösterme (özellik kapalı, günlük hak
   bitti veya sunucu yapılandırılmamış). `resetsAt`: hakkın yenileneceği an (UTC gece yarısı, ISO).
2. Reklamı yüklemeden/göstermeden önce `ServerSideVerificationOptions` kur:
   - Android: `setUserId(<status.ssvUserId>)`, `setCustomData(<status.customData>)`
   - iOS: `GADServerSideVerificationOptions.userIdentifier = <kullanıcı id>`, `.customRewardString = <customData>`
   `customData` ve `ssvUserId` **olduğu gibi** verilir. **Gerçek Qulo kullanıcı id'si hiçbir alanda Google'a gitmez** (iOS
   Privacy Manifest `UserID` beyanı): `ssvUserId` tersine çevrilemez takma kimlik; `customData` içinde gerçek kullanıcı
   AES-256-GCM ile şifreli taşınır (`v2.<gün>.<nonce>.<şifreli>.<mac>`), yalnız sunucu çözer. Her reklam öncesi
   yeniden `status` çağır; jeton yalnız o UTC gününde geçerli.
3. Reklam gösterilir, kullanıcı ödülü kazanınca (`onUserEarnedReward`) **bakiyeyi artırma**. Kısa bir gecikmeyle
   (saniyeler) bakiye/`status` yenile: Google SSV callback'ini sunucuya yollar, mor sunucuda yatar.
   Birkaç denemeden sonra bakiye artmadıysa sessizce geç (kullanıcıya hata gösterme; ödül gecikmeli yatabilir).
4. Ödül sonrası `status` yeniden `available=false` döner (günlük hak doldu).

## Sunucu içi uç (mobil çağırmaz)
`GET /api/v1/rewards/rewarded-ad/ssv` — yalnız Google çağırır. Kimliksiz; ham sorgu ECDSA (SHA-256, DER, web-safe base64)
ile doğrulanır. İmza geçersiz → 400; imzası geçerli her durum → 200 (ödül verilmese bile). Mor `reference_id =
REWARDED_AD:<userId>:<yyyy-mm-dd>:<slot>`; ayrıca `transaction_id` ve (kullanıcı, gün, slot) `rewarded_ad_claims`
tablosunda benzersizdir.

## Yapılandırma (qulo-surum)
- Env: `REWARDED_AD_TOKEN_SECRET` (>=16 karakter rastgele), `REWARDED_AD_UNIT_IDS` (virgülle, iOS + Android rewarded
  birim kimlikleri; yalnız birim numarası, `ca-app-pub-…/123` verilirse son parça alınır). Yoksa özellik KAPALI.
- Economy config: `rewards.rewardedAd { enabled (varsayılan false), purple (0–50, 10), dailyLimit (0–5, 1) }`.
  `GET /app/economy` `rewards.rewardedAd`'ı gösterir (mobil `enabled`'a bakabilir).
- AdMob konsolu: her rewarded birim için SSV callback URL'si =
  `https://<sunucu>/api/v1/rewards/rewarded-ad/ssv`; birimde "Server-side verification" açık.
- Migration 088 (`rewarded_ad_claims`) uygulanmadan sunucu ödül vermez (`status` available=false).
