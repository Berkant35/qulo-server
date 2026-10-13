import type { Mesafe, PersonaCardInput, SeedStyle } from '../../types/seed-persona.js';

/** Seed sohbet botunun konustugu diller. Yeni dil = yeni paket dosyasi + `index.ts` kaydi. */
export type SeedLocale = 'tr' | 'it';

/**
 * Persona karti metinleri. Karti kuran iskelet (`buildPersonaCard`) dilden bagimsizdir;
 * dilbilgisine bagli parcalar (isim cekimi, olgu cumleleri) paket fonksiyonudur.
 * Cinsiyete gore cekilen sifatlardan kacinilir: kart ikinci tekil sahisla yazilir ve
 * sifat yerine fiil/isim kullanilir (Italyancada "curioso/curiosa" yerine "ti piace...").
 */
export interface PersonaKartMetni {
  /** Ilk uc satir: ad + yas + semt, uygulama baglami, "rol yapmiyorsun". */
  kimlik(i: Pick<PersonaCardInput, 'name' | 'age' | 'district'>): string[];
  ornekBaslik: string;
  /** Yazim stiline gore ornek mesajlar — en az 6 (1. ve 5. sira emoji suslemesi alir). */
  ornekler: Record<SeedStyle['yazim'], readonly string[]>;
  kotuBaslik: string;
  /** Canli dokumden (ya da o dilin eval'inden) alinmis yapay duran ornekler. */
  kotuOrnekler: readonly string[];
  olculerBaslik: string;
  /** Kelime tavani cumlesi; ardindan `bicimYasagi` ayni satira eklenir. */
  tavan: Record<SeedStyle['uzunluk'], string>;
  bicimYasagi: string;
  uzunlukKurali: string;
  emoji: Record<SeedStyle['emoji'], string>;
  soru: Record<SeedStyle['enerji'], string>;
  /** Soru cumlesinin sonuna eklenir. */
  soruArdArda: string;
  /** Olculer blogunun kalan satirlari (`- ` onekiyle). */
  olcuSonu: readonly string[];
  tavirBaslik: string;
  mesafe: Record<Mesafe, readonly string[]>;
  hakkindaBaslik: string;
  /** "Senin hakkinda" maddeleri (onek yok); bos alanlar atlanir. */
  olgular(i: PersonaCardInput): string[];
  yapmadiklarinBaslik: string;
  /** Hazir satirlar (`- ` ve devam satiri girintisi dahil). */
  yapmadiklarin: readonly string[];
  suAnBaslik: string;
  faz: Record<1 | 2 | 3 | 4, string>;
  mesgul: string;
  kapanis: string;
  medya: readonly string[];
  /** Kriz istisnasi (iki satir) — yerel acil numara burada. */
  kriz: readonly string[];
  sonHatirlatma: string;
}

export interface SeedLocalePack {
  locale: SeedLocale;
  /** `toLocaleLowerCase` dili: Turkcede noktali/noktasiz i ayrimi, Italyancada standart. */
  buyukKucukHarf: string;
  /**
   * derive-seed-persona'nin `seed_persona.tz` icin yazacagi IANA saat dilimi. Zamanlama tek
   * kural kullanir: `persona.tz ?? 'Europe/Istanbul'` (bkz. seed-reply-timing).
   */
  varsayilanTz: string;
  kart: PersonaKartMetni;
  /** Kadin / diger profillerde ton dagilimi (sha1 kovasiyla secilir). */
  mesafeHavuzu: { kadin: readonly Mesafe[]; diger: readonly Mesafe[] };
  /** responderTypeFor'un tanidigi kisilik etiketleri (user_details.personality serbest metin). */
  kisilik: { disaDonuk: readonly string[]; iceDonuk: readonly string[] };
  /**
   * Ham desenler. Kriz ve yas alti kapilari TUM paketlerin birlesimiyle + normalize ifadelerle
   * calisir (guvenlik.ts) — bir paketin deseni yalniz o dilin seed'ine uygulanmaz.
   */
  guvenlik: {
    /** Kendine zarar / intihar: rol birakilir, LLM'siz sabit cevap gider. */
    kriz: RegExp;
    /** 18 yas alti beyani: satir iptal, bot susar. */
    yasAlti: RegExp;
    /** Karsi taraf konusmayi kapatiyor: kapanis yazilir, soru sorulmaz. */
    kapanis: RegExp;
    /** LLM'den GECMEYEN kriz cevabi. */
    krizCevabi: string;
  };
  /** Bot medyayi goremez: medya/soru mesajlari LLM'e bu etiketlerle girer. */
  etiket: { sesli: string; foto: string; soruKarti: string; medyaIstegi: string };
  guard: {
    /** Iletisim: yerel telefon bicimleri — guard TUM paketlerinkini uygular (capraz numara). */
    telefon: RegExp;
    /**
     * Ele veren kelimeler (yapay zeka, model adlari...) — guard TUM paketlerinkini uygular. Dizi:
     * buyuk/kucuk harf duyarli bir desen gerekebilir (Italyancada "ai" edat, yalniz buyuk "AI" yasak).
     */
    yasak: readonly RegExp[];
    /** Yabanci dil isareti: bu desenden en az 2 eslesme cevabi eler (sebep `ingilizce`). */
    yabanciDil: RegExp;
  };
  /** Ilk cikti denetime takilinca ikinci denemede sisteme eklenen uyari. */
  uyariProbe: string;
  /** Botun kendisi hakkinda 4 sikli soru uretme talimati ve tetik mesaji. */
  soruTalimati(i: { name: string; job: string | null; bio: string | null }): string;
  soruTetik: string;
}
