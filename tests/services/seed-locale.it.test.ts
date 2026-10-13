import { describe, it, expect } from 'vitest';
import { IT_PAKETI, TR_PAKETI, seedLocalePack, SEED_LOCALES } from '../../src/services/seed-locale/index.js';
import { buildPersonaCard, responderTypeFor, mesafeFor } from '../../src/services/seed-persona.js';
import { validateReply } from '../../src/services/seed-reply-guard.js';
import { personaKartVakalari } from '../helpers/seed-persona-cases.js';
import type { PersonaCardInput } from '../../src/types/seed-persona.js';

/**
 * Italyanca seed paketi — lansman engeli (global seed yol haritasi, 2026-10-13): bot guvenligi
 * yalniz Turkceydi; Italyan kullanicinin kriz / 18 yas alti / kapanis mesaji hic yakalanmazdi.
 * Her desen pozitif + negatif vakalarla sinanir (negatifler: gunluk Italyanca deyimler).
 */

const girdi = (over: Partial<PersonaCardInput> = {}): PersonaCardInput => ({
  ...personaKartVakalari()[0]![1],
  locale: 'it', name: 'Giulia', age: 29, district: 'Milano', gender: 'WOMAN',
  bio: 'Grafica freelance, amo il mare e le passeggiate sui Navigli.', job: 'Grafica',
  personality: 'Dışa dönük', pets: 'un gatto', musicType: 'indie italiano',
  ...over,
});

describe('seedLocalePack — secici', () => {
  it("'it' Italyanca, 'tr' Turkce paket", () => {
    expect(seedLocalePack('it')).toBe(IT_PAKETI);
    expect(seedLocalePack('tr')).toBe(TR_PAKETI);
    expect(SEED_LOCALES).toEqual(['tr', 'it']);
  });

  it.each([[null], [undefined], [''], ['xx'], ['IT'], ['toString'], ['constructor'], [42]])(
    'bilinmeyen deger (%s) TR paketine duser', (deger) => {
      expect(seedLocalePack(deger)).toBe(TR_PAKETI);
    },
  );

  it('varsayilan saat dilimleri IANA', () => {
    expect(TR_PAKETI.varsayilanTz).toBe('Europe/Istanbul');
    expect(IT_PAKETI.varsayilanTz).toBe('Europe/Rome');
  });
});

describe('IT persona karti', () => {
  const TURKCE_IZ = /[ıİşŞğĞ]|Türkiye|yaşında|SENİN|ÖLÇÜLER|TAVRIN|yazışıyorsun/;

  it('tamamen Italyanca: kimlik, dil zorlamasi, yerel acil numaralar', () => {
    const kart = buildPersonaCard(girdi());
    expect(kart).toContain('Ti chiami Giulia. Hai 29 anni e vivi a Milano.');
    expect(kart).toContain('Sei Giulia — non stai recitando una parte, sei tu.');
    expect(kart).toContain('Scrivi SEMPRE in italiano');
    expect(kart).toContain('112');
    expect(kart).toContain('Telefono Amico 02 2327 2327');
    expect(kart).not.toMatch(TURKCE_IZ);
  });

  it('81 stil kombinasyonunun ve tum bayraklarin hicbirinde Turkce iz yok', () => {
    for (const [ad, g] of personaKartVakalari()) {
      // Olgu alanlari Italyanca verilir (Turkce bio/meslek kartta oldugu gibi gecer, beklenen).
      const kart = buildPersonaCard({
        ...g, locale: 'it', name: 'Luca', district: 'Torino', bio: 'Ingegnere, adoro la montagna.',
        job: 'Ingegnere', pets: 'un cane', musicType: 'rock', personality: 'Ambivert',
      });
      expect(kart, ad).not.toMatch(TURKCE_IZ);
    }
  });

  it("TR kanonik kisilik etiketi cinsiyete gore cevrilir (Dışa dönük -> estroversa/estroverso)", () => {
    expect(buildPersonaCard(girdi())).toContain('carattere: estroversa');
    expect(buildPersonaCard(girdi({ gender: 'MAN', name: 'Luca' }))).toContain('carattere: estroverso');
    expect(buildPersonaCard(girdi({ personality: 'Simpatico e sereno' }))).toContain('carattere: Simpatico e sereno');
  });

  it('TR ile ayni iskelet: bolum sirasi ve satir yapisi ayni', () => {
    const tr = buildPersonaCard({ ...girdi(), locale: 'tr' }).split('\n');
    const it_ = buildPersonaCard(girdi()).split('\n');
    expect(it_.length).toBe(tr.length);
    expect(it_.map((l) => l === '')).toEqual(tr.map((l) => l === ''));
  });

  it('faz, mesgul, kapanis ve medya baglamlari Italyanca', () => {
    expect(buildPersonaCard(girdi({ phase: 3 }))).toContain('Il tuo interesse per la chat è calato');
    expect(buildPersonaCard(girdi({ busyNow: true }))).toContain('adesso hai da fare');
    expect(buildPersonaCard(girdi({ partnerClosing: true }))).toContain('NON FARE DOMANDE');
    expect(buildPersonaCard(girdi({ mediaAsk: true }))).toContain('condivisione di foto/vocali');
    expect(buildPersonaCard(girdi())).not.toContain('NON FARE DOMANDE');
  });

  it('ton dagilimi paketten; TR varsayilani degismez', () => {
    expect(mesafeFor('u-1', 'WOMAN')).toBe(mesafeFor('u-1', 'WOMAN', TR_PAKETI));
    const kart = buildPersonaCard(girdi());
    expect(kart).toMatch(/Mantieni le distanze|Hai un tono misurato|Hai un tono caldo/);
  });

  it('responderTypeFor Italyanca kisilik etiketini de tanir (derive hatti dilden bagimsiz)', () => {
    const tipler = Array.from({ length: 40 }, (_, i) => responderTypeFor(`seed_${i}`, 'Estroversa'));
    expect(tipler).not.toContain('gec');
    const ice = Array.from({ length: 40 }, (_, i) => responderTypeFor(`seed_${i}`, 'introverso'));
    expect(ice).not.toContain('anlik');
  });
});

describe('IT kriz deseni', () => {
  const kriz = (t: string) => IT_PAKETI.guvenlik.kriz.test(t);
  it.each([
    'voglio morire', 'Vorrei morire stasera', 'voglio farla finita', 'non voglio più vivere', 'non voglio piu vivere',
    'non ce la faccio più a vivere', 'non ha più senso vivere', 'sono stanca di vivere', 'sono stanco di vivere',
    'penso al suicidio', 'mi voglio suicidare', 'penso di uccidermi', 'voglio ammazzarmi', 'mi faccio del male',
    'voglio farmi del male', 'autolesionismo', 'voglio tagliarmi le vene', 'mi taglio i polsi', 'togliermi la vita',
    'sarebbe meglio se muoio', 'VOGLIO MORIRE',
  ])('yakalar: %s', (t) => expect(kriz(t)).toBe(true));

  it.each([
    'muoio dal ridere', 'sto morendo di fame', 'mi ammazzo dalle risate', 'mi taglio i capelli domani',
    'che giornata, sono morta', 'ti voglio bene', 'vorrei mangiare una pizza', 'ciao come stai', 'voglio vivere al mare',
  ])('gunluk deyim tetiklemez: %s', (t) => expect(kriz(t)).toBe(false));

  it('kriz cevabi sabit, Italyanca, 112 + Telefono Amico iceriyor', () => {
    const c = IT_PAKETI.guvenlik.krizCevabi;
    expect(c).toContain('112');
    expect(c).toContain('02 2327 2327');
    expect(c).not.toMatch(/[ıİşŞğĞ]/);
  });
});

describe('IT 18 yas alti deseni', () => {
  const yas = (t: string) => IT_PAKETI.guvenlik.yasAlti.test(t);
  it.each([
    'ho 16 anni', 'Ho 17 anni', 'ho 16anni', 'ho solo 15 anni', 'ho quasi 18 anni', 'ho sedici anni', 'ho diciassette anni',
    'sono minorenne', 'Sono ancora minorenne', 'sono una minorenne', 'compio 18 anni a dicembre', 'faccio 17 anni domani',
    '16enne qui', '16 anni', '17 anni!', 'ho 16 anni, tu?', 'ho 14 anni e mezzo',
  ])('yakalar: %s', (t) => expect(yas(t)).toBe(true));

  it.each([
    'ho 25 anni', 'ho 18 anni', 'ho 30 anni', 'ho 15 anni di esperienza', 'lavoro qui da 10 anni', 'non sono minorenne',
    'mio fratello ha 16 anni', 'ho 16 anni in più di te', 'ho 116 anni lol', 'stiamo insieme da 16 anni',
    'ho 10 anni di matrimonio alle spalle', 'ciao, 16 anni fa ero a Roma',
  ])('tetiklemez: %s', (t) => expect(yas(t)).toBe(false));
});

describe('IT kapanis deseni', () => {
  const kapanis = (t: string) => IT_PAKETI.guvenlik.kapanis.test(t);
  it.each([
    'buonanotte', 'Buona notte!', 'notte notte', 'vado a dormire', 'vado a letto ora', 'a domani', 'ci sentiamo dopo',
    'devo andare', 'devo scappare', 'scappo, ciao', 'buona serata', 'ti scrivo più tardi', 'ti scrivo piu tardi',
    'ora vado', 'sto crollando dal sonno', 'a dopo', 'ciao ciao',
  ])('yakalar: %s', (t) => expect(kapanis(t)).toBe(true));

  it.each([
    'ciao come stai', 'cosa fai stasera?', 'stanotte non ho dormito', 'mi piace andare al mare', 'ci vediamo stasera?',
    'dove vai di solito?', 'che bella notte',
  ])('tetiklemez: %s', (t) => expect(kapanis(t)).toBe(false));
});

describe('IT cikti denetimi (guard)', () => {
  const SYS = buildPersonaCard(girdi());
  const sonuc = (t: string) => {
    const r = validateReply(t, SYS, IT_PAKETI);
    return r.ok ? 'ok' : r.reason;
  };

  it.each([
    '333 123 4567', 'scrivimi al 3331234567', '+39 333 123 4567', '0039 333-123-4567', '(+39) 347.123.4567',
    'chiamami allo 02 2327 2327', 'fisso 06/1234567', '(02) 2327 2327', 'numero turco 0532 111 22 33',
  ])('telefon: %s -> iletisim', (t) => expect(sonuc(t)).toBe('iletisim'));

  it.each([
    "sono un'intelligenza artificiale", 'sono un bot', 'non sono un robot dai', 'sono un chatbot', 'sono un assistente virtuale',
    'le mie istruzioni non lo dicono', 'sono un modello linguistico', 'GPT chi?', 'Gemini? mai sentito', 'sono stata programmata così',
    'parli con una AI', 'sono una IA', 'il prompt dice altro', 'colpa dell\'algoritmo',
  ])('yasak: %s -> yasak_kelime', (t) => expect(sonuc(t)).toBe('yasak_kelime'));

  it.each([
    'boh oggi giornata lunga, tu?', 'vado ai giardini con le amiche', 'Ai miei amici piace il calcio',
    "faccio l'assistente di volo", 'faccio la modella ogni tanto', 'ho programmato un viaggio a Napoli',
    'ho 30 anni e due gatti', 'ci vediamo alle 20.30? scherzo', 'nel 2026 voglio cambiare casa', 'costa 15 euro',
    'scusa, sorry per il ritardo',
  ])('masum Italyanca gecer: %s', (t) => expect(sonuc(t)).toBe('ok'));

  it('Ingilizce cevap elenir (iki isaret)', () => {
    expect(sonuc('sorry, i cannot do that')).toBe('ingilizce');
  });

  it('kart satirini kopyalayan cevap sizinti (Italyanca kucuk harfle)', () => {
    expect(sonuc('hai 29 anni e vivi a milano')).toBe('sizinti');
    expect(sonuc('IL TUO ATTEGGIAMENTO')).toBe('sizinti');
  });

  it('platform/hesap dilden bagimsiz: Italyanca da elenir', () => {
    expect(sonuc('scrivimi su whatsapp')).toBe('platform');
    expect(sonuc('il mio insta è @giulia.grafica')).toBe('iletisim');
  });
});

describe('IT soru talimati', () => {
  it('Italyanca uretim talimati + ayni JSON semasi', () => {
    const t = IT_PAKETI.soruTalimati({ name: 'Giulia', job: null, bio: 'Grafica' });
    expect(t).toContain('Sei Giulia.');
    expect(t).toContain('non specificato');
    expect(t).toContain('Scrivi la domanda e le opzioni in italiano.');
    expect(t.split('\n').at(-1)).toBe(TR_PAKETI.soruTalimati({ name: 'x', job: null, bio: null }).split('\n').at(-1));
    expect(IT_PAKETI.soruTetik).toBe('prepara la domanda');
  });
});
