# Admin Guide — Push Mesajları

## Ne için var

Push notification metinlerini (`new_message`, `new_match` vs.) deploy gerektirmeden değiştirmek için. Admin paneline yazdığın metin **anında** geçerli olur, bir sonraki push yeni metinle gider.

## Nereden açılır

Admin paneline login ol → sol sidebar → **🔔 Push Mesajları**

## Mesaj düzenleme

1. Liste sayfasında bir tip seç (örn. `new_message`) → `Düzenle`
2. `Başlık` veya `Gövde` alanlarına yeni metni yaz
   - Boş bırakırsan dosyadaki orijinal metin geçerli kalır
   - `{name}`, `{badge}`, `{result}` placeholder'larını kullanabilirsin
3. Önizleme bölümünde nasıl görüneceğini gör (placeholder'lar örnek değerlerle dolar)
4. `Kaydet`
5. Değişiklik **anında** geçerli olur — bir sonraki push yeni metinle gider

## Push'u tamamen kapatma

Edit ekranında `Aktif` kutucuğunu kaldır → `Kaydet` → onay penceresi → kabul edersen o tip push **artık hiç gönderilmez**. DB'de bildirim yine kaydedilir ama FCM atlanır.

## Default'a geri dönme

İki yol:
- **Tek alan için:** Input'un altındaki `Default'a dön` linkine tıkla → o alan boşalır → `Kaydet`
- **Tüm override için:** Edit sayfasının altındaki `Override'ı tamamen sil` butonu → confirm → DB satırı silinir

## Dil seçimi

Liste sayfasının üst sağındaki `TR` / `EN` linkleriyle hangi dili düzenlediğini değiştir. Her dil için ayrı override yazılır — TR için yazdığın EN'i etkilemez.

## Hata durumunda

- **DB sorunu çıkarsa:** Sistem otomatik olarak dosyadaki orijinal metni kullanır (`tr.json` / `en.json`)
- **Yanlış placeholder (örn. `{foo}`) yazarsan:** Form `Kaydet`'i reddeder — izinli liste: `{name}`, `{badge}`, `{result}`
- **Push gelmezse:** Önce `Aktif` durumunu kontrol et, sonra Railway log'larında `sendPush` hatası var mı bak

## Hangi tipler editlenebilir

Panelde **6 tip** vardır:

| Tip | Ne zaman tetiklenir | Placeholder'lar |
|---|---|---|
| `new_message` | Sohbette text mesajı geldiğinde | `{name}` (gönderen) |
| `new_message_image` | Sohbette fotoğraf mesajı geldiğinde | `{name}` (gönderen) |
| `new_match` | Senin sorularını biri çözdüğünde (sana giden push) | (yok veya `{badge}` — badge param varsa `new_match_badge` template'i kullanılır) |
| `new_match_solver` | Sen birinin sorularını çözdüğünde (sana giden push) | (yok) |
| `new_match_badge` | `new_match` badge varyantı (otomatik tetiklenir, badge param ile) | `{badge}` |
| `chat_question_answered` | Sohbet sorusu cevaplandığında | `{result}` (doğru/yanlış) |

## Panelde olmayan tipler

- **`campaign`** — Kampanya push'ları (admin/campaigns'ten yönetilir). Body kampanya tarafından dinamik gelir, push template'i editlenmez.
