import type { PersonaCardInput, SeedPersona, SeedStyle } from '../../src/types/seed-persona.js';

/**
 * Persona karti karakterizasyon vakalari (TR altin test, 2026-10-13). Locale paketlerine
 * gecerken TR kartinin BAYT BAYT ayni kalmasi icin: her vaka bir girdi, beklenen cikti
 * `tests/fixtures/persona-card-tr.golden.json` (refactor ONCESI koddan uretildi, sha1).
 * Vaka listesini degistirirsen altin dosya da yeniden uretilmeli — bilerek, gerekcesiyle.
 */
const STIL_EKSENLERI = {
  uzunluk: ['tek_cumle', 'kisa', 'orta'],
  emoji: ['yok', 'nadiren', 'sik'],
  yazim: ['gevsek', 'kucuk_harf', 'ozenli'],
  enerji: ['soru_soran', 'kisa_kesen', 'dagitan'],
} as const;

const temelPersona = (style: SeedStyle): SeedPersona => ({
  responder_type: 'normal', work_pattern: 'serbest',
  sleep_window: { start_min: 30, end_min: 450 }, style,
  derived_at: '2026-09-16T00:00:00Z', model: 'test',
});

const temelGirdi = (over: Partial<PersonaCardInput> = {}): PersonaCardInput => ({
  seedKey: 'u-elif-0001', gender: 'WOMAN',
  name: 'Elif', age: 31, district: 'Fethiye', province: 'Muğla',
  bio: "Çalış'ta küçük bir atölyem var.", job: 'Takı tasarımcısı', personality: 'Ambivert',
  pets: 'Kedi', musicType: 'Türkçe pop', smoking: 'NO', alcohol: 'SOMETIMES',
  relationshipGoal: 'FRIENDSHIP',
  persona: temelPersona({ uzunluk: 'kisa', emoji: 'nadiren', yazim: 'kucuk_harf', enerji: 'kisa_kesen' }),
  phase: 1, busyNow: false, ...over,
});

export function personaKartVakalari(): Array<[string, PersonaCardInput]> {
  const vakalar: Array<[string, PersonaCardInput]> = [];
  // 81 stil kombinasyonu (ornek + emoji suslemesi + tavan + soru metni).
  for (const uzunluk of STIL_EKSENLERI.uzunluk)
    for (const emoji of STIL_EKSENLERI.emoji)
      for (const yazim of STIL_EKSENLERI.yazim)
        for (const enerji of STIL_EKSENLERI.enerji)
          vakalar.push([`stil:${uzunluk}/${emoji}/${yazim}/${enerji}`,
            temelGirdi({ persona: temelPersona({ uzunluk, emoji, yazim, enerji }) })]);

  for (const phase of [1, 2, 3, 4] as const) vakalar.push([`faz:${phase}`, temelGirdi({ phase })]);
  vakalar.push(['mesgul', temelGirdi({ busyNow: true })]);
  vakalar.push(['kapanis', temelGirdi({ partnerClosing: true })]);
  vakalar.push(['medya', temelGirdi({ mediaAsk: true })]);
  vakalar.push(['hepsi', temelGirdi({ busyNow: true, partnerClosing: true, mediaAsk: true, phase: 4 })]);

  // Mesafe kovasi: farkli anahtar + cinsiyet.
  for (let i = 0; i < 12; i++) {
    for (const gender of ['WOMAN', 'MAN', null] as const) {
      vakalar.push([`mesafe:${i}:${gender}`, temelGirdi({ seedKey: `u-${i}`, gender })]);
    }
  }

  // Isim cekimi (sensinEki) ve semt.
  for (const name of ['Elif', 'Cansu', 'Burcu', 'Emre', 'Ilgın', 'Gökçe', 'Onur', 'Ümit', 'Aslı', 'Mert']) {
    vakalar.push([`isim:${name}`, temelGirdi({ name })]);
  }
  vakalar.push(['semtsiz', temelGirdi({ district: null })]);

  // Olgu dallari: bos alanlar, tum sigara/alkol/hedef degerleri, bilinmeyen deger.
  vakalar.push(['olgusuz', temelGirdi({
    job: null, pets: null, musicType: null, personality: null, smoking: null, alcohol: null,
    relationshipGoal: null, bio: null,
  })]);
  for (const v of ['YES', 'NO', 'SOMETIMES', 'BILINMEZ']) {
    vakalar.push([`sigara-alkol:${v}`, temelGirdi({ smoking: v, alcohol: v })]);
  }
  for (const v of ['SERIOUS', 'FRIENDSHIP', 'CASUAL', 'BILINMEZ']) {
    vakalar.push([`hedef:${v}`, temelGirdi({ relationshipGoal: v })]);
  }
  vakalar.push(['kisilik:disa', temelGirdi({ personality: 'Dışa dönük' })]);
  return vakalar;
}

/**
 * Guvenlik ve guard karakterizasyon korpusu: her metin icin TR kriz / kapanis / yas alti
 * kararlari ve validateReply sonucu altin dosyada. TR karar tablosu locale refactor'unda
 * degismemeli; IT metinleri burada TR paketinin (bugunku) davranisini dondurur.
 */
export const GUVENLIK_KORPUSU: readonly string[] = [
  // kriz
  'artık yaşamak istemiyorum', 'intihar etmeyi düşünüyorum', 'kendime zarar veriyorum', 'canıma kıyacağım',
  'ölmek istiyorum bazen', 'yaşamaktan bıktım', 'bugün çok yoruldum ölüyorum', 'ölümüne güldüm',
  // kapanis
  'iyi geceler', 'görüşürüz', 'gorusuruz', 'hoşça kal', 'hoscakal', 'kapatıyorum ben', 'uyuyayım ben biraz',
  'uyuyorum artık', 'uyuycam', 'uyucam', 'yatıyorum', 'yatıyom', 'yatacağım', 'yatcam', 'sonra konuşuruz',
  'sonra yazarım', 'ben kaçtım', 'kaçtım ben', 'çıkmam lazım', 'gitmem lazım', 'uyumak istemiyorum ama', 'yatırım yaptım',
  'günün nasıl geçti', 'bu akşam ne yapıyorsun',
  // yas
  '16 yaşındayım', '17 yaşında', '15yaş', '18 yaşındayım', '10 yaşında', '25 yaşındayım', 'yaşım 16',
  // guard
  'valla bugün atölye yoğundu', 'tabii numaram 0532 111 22 33', '+90 532 111 22 33', '05321112233',
  'instagramım @elif.taki', 'https://x.com', 'whatsapp yaz', 'telegramdan yaz bana', 'insta at', 'instalasyon güzel',
  'ben bir yapay zeka değilim', 'asistan değilim', 'GPT mi', 'algoritma', 'öyle programlandım',
  'sorry, i cannot do that as an assistant', 'the end', 'tarzım:\n- kısa', 'a'.repeat(301), 'bak <script>x</script>',
  // IT (TR paketinin bugunku davranisi)
  'voglio morire', 'ho 16 anni', 'buonanotte', 'il mio numero è 333 123 4567', 'sono un\'intelligenza artificiale',
  'ciao come stai', 'devo andare', 'sono minorenne',
];
