/**
 * Değişmez yola (zaman damgalı ad, `upsert: false`) yazılan dosyaların istemci önbelleği: 30 gün.
 *
 * Varsayılan 3600 sn idi; telefon her fotoğrafı saatte bir yeniden doğruluyordu (her biri bir
 * Supabase isteği + log satırı). Kenar önbelleğini bu değer belirlemez: Pro'daki Smart CDN kenarda
 * zaten olabildiğince uzun tutar ve dosya silinince ≤60 sn'de temizler.
 *
 * Neden 1 yıl değil (review 2026-09-28): `max-age` yoldaki her önbelleği bağlar; silinen bir
 * fotoğraf istemci/ara önbellekte o kadar yaşayabilir. Mobilin görsel önbelleği
 * (flutter_cache_manager) kullanılmayan dosyayı zaten 30 günde atar, yani uzun süre ek kazanç getirmez.
 *
 * Aynı yola üzerine yazılan (upsert) dosyada KULLANMA: istemci eski içeriği 30 gün görür.
 */
export const DEGISMEZ_DOSYA_CACHE_CONTROL = "2592000";
