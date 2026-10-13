export type ResponderType = 'anlik' | 'normal' | 'gec' | 'duzensiz';

export type WorkPattern =
  | 'ofis' | 'vardiya_aksam' | 'vardiya_gece' | 'okul' | 'hafta_sonu_yogun' | 'serbest' | 'esnek';

export interface SeedStyle {
  uzunluk: 'tek_cumle' | 'kisa' | 'orta';
  emoji: 'yok' | 'nadiren' | 'sik';
  yazim: 'gevsek' | 'kucuk_harf' | 'ozenli';
  enerji: 'soru_soran' | 'kisa_kesen' | 'dagitan';
}

export interface SeedPersona {
  responder_type: ResponderType;
  work_pattern: WorkPattern;
  /** `tz` yerel dakikasi (0-1439). Gece yarisini asabilir: start 30, end 450. */
  sleep_window: { start_min: number; end_min: number };
  /**
   * IANA saat dilimi (ör. 'Europe/Rome'); uyku/mesai/cevrimici ritmi bu yerel saate gore,
   * yaz saati dahil. Yoksa 'Europe/Istanbul' (mevcut TR seed'ler alansiz turetildi).
   * Paket varsayilani: seedLocalePack(locale).varsayilanTz.
   */
  tz?: string;
  style: SeedStyle;
  derived_at: string;
  model: string;
}

/** Mesafe ekseni: botun en hizli ele veren ozelligi "her zaman istekli" olmasi. */
export type Mesafe = 'mesafeli' | 'olculu' | 'sicak';

export interface PersonaCardInput {
  /** Kova hesabi icin kararli anahtar (users.id). Mesafe ekseni buradan turetilir. */
  seedKey: string;
  gender: 'WOMAN' | 'MAN' | null;
  name: string;
  age: number;
  district: string | null;
  province: string | null;
  bio: string | null;
  job: string | null;
  personality: string | null;
  pets: string | null;
  musicType: string | null;
  smoking: string | null;
  alcohol: string | null;
  relationshipGoal: string | null;
  /** `users.locale` — persona kartinin dili (seedLocalePack; bos/bilinmeyen = tr). */
  locale?: string | null;
  persona: SeedPersona;
  /** Sohbet fazi (1-4) ve mesguliyet baglami prompt'a eklenir. */
  phase: 1 | 2 | 3 | 4;
  busyNow: boolean;
  /** Karsi taraf konusmayi kapatiyor (uyuyacak, isi var, "gorusuruz"): kapanis yaz, soru sorma. */
  partnerClosing?: boolean;
  /** Karsi taraf foto/ses paylasimi acmak istedi: nazikce gecistir (bot medya GONDEREMEZ). */
  mediaAsk?: boolean;
}
