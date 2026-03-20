# AI Question Bank — Hardcoded Soru Bankası

**Tarih:** 2026-03-20
**Branch:** APP-1915
**Durum:** Tasarım onaylandı

## Amaç

Mevcut Gemini API bağımlılığını kaldırarak, önceden hazırlanmış 5000 sorudan oluşan (10 dil x 500) bir soru bankası ile `POST /questions/ai-suggest` endpoint'ini beslemek. Client tarafında sıfır değişiklik. Popülarite tracking ile en çok kabul edilen sorular öne çıkar. Admin panelden CRUD yönetimi.

## Mevcut Durum

- `POST /questions/ai-suggest` → Gemini 2.0 Flash API'ye bağımlı
- Gemini free tier kota aşımı (429 RESOURCE_EXHAUSTED) ile 500 hatası
- Client: `AiSuggestionModel { questionText, answers, correctAnswer, hint, category }`
- Client `correct_answer` alanını zorunlu bekliyor
- Mevcut `ai_question_suggestions` tablosu Gemini cache olarak kullanılıyor

## Tasarım Kararları

1. **Gemini bağımlılığı kaldırılıyor** — sıfır dış API çağrısı
2. **DB tabanlı soru bankası** — admin panelden canlı güncelleme, popülarite tracking
3. **Client değişikliği yok** — aynı request/response formatı korunuyor
4. **`correct_answer` her zaman `1` dönüyor** — kişisel tercih sorularında doğru cevap yok, client uyumluluğu için sabit
5. **Profil bazlı filtreleme** — yaş, cinsiyet, ton bilgisine göre hedefli soru önerisi
6. **Tracking: question create üzerinden** — yeni endpoint yok, `POST /questions` sırasında normalize edilmiş `question_text` + `locale` eşleşmesiyle `selected_count++`
7. **`ai_question_suggestions` tablosu** — migration sırasında truncate edilecek, rollback gerekirse bırakılabilir

---

## 1. Veritabanı Şeması

### Tablo: `ai_question_bank`

| Kolon | Tip | Constraint | Açıklama |
|-------|-----|-----------|----------|
| `id` | uuid | PK, default gen_random_uuid() | |
| `locale` | text | NOT NULL | Dil kodu (SUPPORTED_LOCALES'dan) |
| `category` | text | NOT NULL | QUESTION_CATEGORIES'dan |
| `question_text` | text | NOT NULL | Soru metni |
| `answers` | jsonb | NOT NULL | `["s1", "s2", "s3", "s4"]` |
| `hint` | text | nullable | Opsiyonel ipucu |
| `target_gender` | text | nullable | `'male'`, `'female'`, `null` (herkes) |
| `target_age_min` | int | nullable | Min yaş filtresi |
| `target_age_max` | int | nullable | Max yaş filtresi |
| `tone` | text | NOT NULL, default 'fun' | `'flirty'`, `'fun'`, `'deep'` |
| `shown_count` | int | NOT NULL, default 0 | Kaç kez önerildi |
| `selected_count` | int | NOT NULL, default 0 | Kaç kez seçildi |
| `is_active` | boolean | NOT NULL, default true | Soft-delete |
| `created_at` | timestamptz | NOT NULL, default now() | |
| `updated_at` | timestamptz | NOT NULL, default now() | Admin güncellemelerini takip |

### Constraint'ler

```sql
UNIQUE(locale, question_text)  -- Aynı dilde duplicate soru önleme + tracking eşleşmesi için
```

### Index'ler

```sql
CREATE INDEX idx_qbank_locale_cat_active ON ai_question_bank(locale, category, is_active);
CREATE INDEX idx_qbank_locale_active ON ai_question_bank(locale, is_active);
CREATE INDEX idx_qbank_locale_qtext ON ai_question_bank(locale, question_text);  -- Tracking sorgusu için
```

---

## 2. Endpoint Davranışı

### Request (degismiyor)

```
POST /api/v1/questions/ai-suggest
Authorization: Bearer <token>
```

```json
{
  "category": "personality",
  "profile_based": false,
  "locale": "tr",
  "count": 5
}
```

### Response (degismiyor)

```json
{
  "suggestions": [
    {
      "question_text": "Ilk bulusmada nereye gitmek istersin?",
      "answers": ["Kitapciya", "Kafeye", "Catida film izlemeye", "Muzeye"],
      "correct_answer": 1,
      "hint": null,
      "category": "personality"
    }
  ]
}
```

### Precedence kuralı

Hem `profile_based: true` hem `category` verilirse, `profile_based` önceliklidir (mevcut davranış korunuyor). `category` bu durumda göz ardı edilir.

### Siralama Algoritmasi (Popularity Score)

```
score = (selected_count + 1) / (shown_count + 2)
```

Laplace smoothing: yeni sorular ~0.5 score ile baslar.

### Kullanıcı mevcut soru dedup'u

Her iki akışta da (kategori/profil bazlı), sorgu öncesinde kullanıcının `questions` tablosundaki mevcut `question_text` değerleri çekilir ve bankadan eşleşenler hariç tutulur. Kullanıcı aynı soruyu tekrar öneri olarak görmez.

### Boş havuz fallback

Bir kategori için soru bulunamazsa (henüz seed edilmemiş veya tümü deaktif):
- Boş `suggestions: []` dön
- Client zaten `ai_suggest_empty` mesajını gösteriyor

### Akis: Kategori bazli (`category` verilmisse)

1. Kullanıcının mevcut sorularını çek (dedup için)
2. `ai_question_bank` tablosundan filtrele: `locale + category + is_active = true` + dedup
3. Score hesapla, azalan sirala, ust `count * 3` kayit al
4. Bu havuzdan rastgele `count` adet sec
5. Secilen soruların `shown_count` degerini atomik arttir: `UPDATE SET shown_count = shown_count + 1 WHERE id = ANY($ids)` (supabase.rpc veya raw SQL ile)
6. Response don

### Akis: Profil bazli (`profile_based: true`)

1. Kullanicinin `age`, `gender` bilgisini + mevcut sorularını DB'den cek
2. `ai_question_bank` tablosundan filtrele:
   - `locale + is_active = true` + dedup
   - `target_gender IS NULL OR target_gender = user.gender`
   - `target_age_min IS NULL OR user.age >= target_age_min`
   - `target_age_max IS NULL OR user.age <= target_age_max`
3. Score hesapla, azalan sirala, ust `count * 3` kayit al
4. Rastgele `count` adet sec
5. Atomik `shown_count++` (yukarıdaki ile aynı pattern)
6. Response don

### Tracking: selected_count artirma

Yeni endpoint yok. Mevcut `POST /questions` (soru olusturma) handler'inda:
- Gelen `question_text`'i normalize et (trim + lowercase)
- `ai_question_bank`'ta `locale` + normalize edilmiş `question_text` ile eslesme ara
- Bulunursa atomik `selected_count = selected_count + 1`
- Bulunamazsa (kullanici kendi sorusunu yazmis) hicbir sey yapma
- Bu işlem fire-and-forget: tracking hatası soru oluşturmayı engellemez

---

## 3. Admin Panel CRUD

### Route'lar

Mevcut admin auth middleware'i arkasinda (REST API, JSON response):

| Method | Path | Aciklama |
|--------|------|----------|
| `GET` | `/admin/question-bank` | Listeleme (pagination + filtreler + metrikler) |
| `POST` | `/admin/question-bank` | Tek soru ekle |
| `POST` | `/admin/question-bank/bulk` | Toplu ekleme (max 500/istek) |
| `PUT` | `/admin/question-bank/:id` | Soru guncelle (`updated_at` otomatik güncellenir) |
| `DELETE` | `/admin/question-bank/:id` | Soft-delete (is_active = false) |

### Listeleme Response

```json
{
  "data": [
    {
      "id": "uuid",
      "locale": "tr",
      "category": "personality",
      "question_text": "...",
      "answers": ["...", "...", "...", "..."],
      "hint": null,
      "target_gender": null,
      "target_age_min": null,
      "target_age_max": 25,
      "tone": "flirty",
      "shown_count": 342,
      "selected_count": 89,
      "acceptance_rate": 0.26,
      "is_active": true,
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 1200 }
}
```

`acceptance_rate` computed field: `selected_count / NULLIF(shown_count, 0)` — sorgu zamanında hesaplanır, tabloda tutulmaz. `shown_count = 0` ise `null` döner.

### Filtreler (query params)

`?locale=tr&category=personality&tone=flirty&is_active=true&sort=acceptance_rate&order=desc&page=1&limit=50`

### Admin Panel UI

Mevcut admin panel yapisina uygun yeni sayfa:
- Tablo gorunumu: soru metni (kirpilmis), kategori badge, dil, ton, hedef kitle
- Metrikler kolonu: gosterilme / secilme / oran (%)
- Aksiyonlar: duzenle, deaktif et
- Ustte filtre bar + "Soru Ekle" butonu

---

## 4. Soru Bankasi Icerigi (Seed Data)

### Dil Destegi (10 dil)

Mevcut `SUPPORTED_LOCALES` ile uyumlu. `hi` (Hintçe) eklenmesi gerekiyor.

| Dil | Kod | Soru Adedi |
|-----|-----|------------|
| Turkce | `tr` | 500 |
| Ingilizce | `en` | 500 |
| Ispanyolca | `es` | 500 |
| Arapca | `ar` | 500 |
| Portekizce | `pt` | 500 |
| Fransizca | `fr` | 500 |
| Almanca | `de` | 500 |
| Japonca | `ja` | 500 |
| Hintce | `hi` | 500 |
| Cince (Mandarin) | `zh` | 500 |

**Toplam: 5000 soru**

### Kategori Dagilimi (her dil icin 500)

Seed sadece 11 aktif kategoride soru içerir. Kalan 7 kategori (general, entertainment, science, history, art, nature, other) şimdilik boş — admin panelden ileride eklenebilir. Boş kategoriye istek gelirse boş array döner.

| Kategori | Adet |
|----------|------|
| personality | 80 |
| travel | 55 |
| lifestyle | 55 |
| fun | 50 |
| food | 45 |
| music | 40 |
| film | 40 |
| sports | 35 |
| humor | 35 |
| hobby | 35 |
| technology | 30 |
| **Toplam** | **500** |

### Ton Dagilimi

- `fun` (eglenceli): %50
- `flirty` (flortoze): %30
- `deep` (derin): %20

### Hedef Kitle Dagilimi

- `target_gender: null` (herkes): %80
- `target_gender: 'male'`: %10
- `target_gender: 'female'`: %10
- Yas filtreli sorular: %20 (18-25 genc, 25+ olgun)

### Icerik Kurallari

- Kisisel tercih soruları — bilgi testi DEGIL
- Google'da aranamaz, cevap kisinin kisiligini yansitir
- Kulturel adaptasyon: her dil icin o kultüre uygun secenekler (Tokyo vs Istanbul)
- Birebir ceviri degil, anlam ve ruh korunarak adapte edilir
- `correct_answer` alani seed'de yok, response'ta sabit `1` donuyor

---

## 5. Validator Degisiklikleri

### Kategori genisletme

Backend `QUESTION_CATEGORIES`'i client ile uyumlu hale getir:

```typescript
// Mevcut: 9 kategori
// Yeni: 18 kategori (client ile esit)
QUESTION_CATEGORIES = [
  'personality', 'music', 'film', 'sports', 'travel',
  'food', 'technology', 'general', 'other',
  'fun', 'entertainment', 'lifestyle', 'humor',
  'hobby', 'science', 'history', 'art', 'nature'
]
```

### Locale genisletme

Mevcut `src/constants/locales.ts`'deki `SUPPORTED_LOCALES`'a `hi` eklenir. ai-suggest validator bu listeyi referans alır:

```typescript
// Mevcut SUPPORTED_LOCALES: tr, en, de, fr, es, ar, ru, pt, it, ja, ko, zh, nl, pl, sv
// Eklenen: hi
// ai-suggest validator bu listeden import eder
```

---

## 6. Silinecek / Degisecek Dosyalar

| Dosya | Islem |
|-------|-------|
| `src/services/ai-suggest.service.ts` | Tamamen yeniden yaz (Gemini kaldir, DB sorgulari) |
| `src/validators/ai-suggest.validator.ts` | Locale enum → SUPPORTED_LOCALES import |
| `src/validators/question.validator.ts` | QUESTION_CATEGORIES genislet |
| `src/constants/locales.ts` | `hi` ekle |
| `src/controllers/ai-suggest.controller.ts` | Minimal degisiklik (service API ayni) |
| `src/controllers/question.controller.ts` | Tracking hook ekle (selected_count++) |
| `src/routes/question.routes.ts` | Degismez |
| `src/routes/admin.routes.ts` | Yeni question-bank route'lari ekle |
| Yeni: `src/controllers/admin/question-bank.controller.ts` | Admin CRUD handler'lari |
| Yeni: `src/validators/question-bank.validator.ts` | Admin CRUD validation |
| Yeni: `src/migrations/012_ai_question_bank.sql` | Tablo olusturma + ai_question_suggestions truncate |
| Yeni: `src/data/seed/questions_*.json` | 10 dil x 500 soru seed dosyalari |
| Yeni: `scripts/seed-question-bank.ts` | Seed script |

---

## 7. Client Etki Analizi

**Degisen:** Hicbir sey. Ayni endpoint, ayni request, ayni response.

**Fark:** Kullanici artik anlik Gemini cevabi yerine onceden hazirlanmis, kaliteli, kulturel olarak uygun sorular gorecek. Cevap suresi ~50ms (Gemini ~2-5s idi).
