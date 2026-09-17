import { describe, it, expect } from 'vitest';
import { styleFor, responderTypeFor, buildPersonaCard, mesafeFor } from '../../src/services/seed-persona.js';
import type { SeedPersona, PersonaCardInput } from '../../src/types/seed-persona.js';

const persona: SeedPersona = {
  responder_type: 'normal',
  work_pattern: 'serbest',
  sleep_window: { start_min: 30, end_min: 450 },
  style: { uzunluk: 'kisa', emoji: 'nadiren', yazim: 'kucuk_harf', enerji: 'kisa_kesen' },
  derived_at: '2026-09-16T00:00:00Z',
  model: 'test',
};

const input = (over: Partial<PersonaCardInput> = {}): PersonaCardInput => ({
  seedKey: 'u-elif-0001', gender: 'WOMAN',
  name: 'Elif', age: 31, district: 'Fethiye', province: 'Muğla',
  bio: "Çalış'ta küçük bir atölyem var.", job: 'Takı tasarımcısı', personality: 'Ambivert',
  pets: 'Kedi', musicType: 'Türkçe pop', smoking: 'NO', alcohol: 'SOMETIMES',
  relationshipGoal: 'FRIENDSHIP', persona, phase: 1, busyNow: false, ...over,
});

describe('styleFor', () => {
  it('ayni seed_id icin her zaman ayni stili verir', () => {
    expect(styleFor('seed_0582')).toEqual(styleFor('seed_0582'));
  });

  it('farkli profilleri farkli seslere dagitir', () => {
    const hepsi = Array.from({ length: 60 }, (_, i) => styleFor(`seed_${String(i).padStart(4, '0')}`));
    // Dort eksenin her birinde en az iki farkli deger gorunmeli; tek sese cokme olmamali.
    for (const eksen of ['uzunluk', 'emoji', 'yazim', 'enerji'] as const) {
      expect(new Set(hepsi.map((s) => s[eksen])).size).toBeGreaterThan(1);
    }
  });
});

describe('mesafeFor', () => {
  it('deterministiktir', () => {
    expect(mesafeFor('u-1', 'WOMAN')).toBe(mesafeFor('u-1', 'WOMAN'));
  });

  it('kadin profillerde dagilim mesafeliye kayar, "sicak" azinliktir', () => {
    // Kullanici geri bildirimi: "turk kizi pek istekli degildir" — surekli istekli bot
    // en hizli ele veren sey.
    const hepsi = Array.from({ length: 120 }, (_, i) => mesafeFor(`u-${i}`, 'WOMAN'));
    const say = (m: string) => hepsi.filter((x) => x === m).length;
    // Siralama iddiasi: mesafeli en yaygin, sicak en seyrek. (Kesin oran degil — sha1
    // kovalamasinda orneklem sapmasi var; iddia dagilimin YONU.)
    expect(say('mesafeli')).toBeGreaterThan(say('olculu'));
    expect(say('olculu')).toBeGreaterThan(say('sicak'));
    expect(new Set(hepsi).size).toBe(3);   // uc ton da temsil edilir
  });

  it('karta mesafe tavri olarak girer', () => {
    const kart = buildPersonaCard(input({ seedKey: 'u-1', gender: 'WOMAN' }));
    expect(kart).toContain('TAVRIN');
    expect(kart).toMatch(/Mesafelisin|Ölçülüsün|Sıcaksın/);
  });
});

describe('responderTypeFor', () => {
  it('disa donuk profilleri asla en yavas tipe koymaz', () => {
    const tipler = Array.from({ length: 40 }, (_, i) => responderTypeFor(`seed_${i}`, 'Dışa dönük'));
    expect(tipler).not.toContain('gec');
  });

  it('deterministiktir', () => {
    expect(responderTypeFor('seed_0582', 'Ambivert')).toBe(responderTypeFor('seed_0582', 'Ambivert'));
  });
});

describe('buildPersonaCard', () => {
  it('degismez olgulari karta yazar', () => {
    const card = buildPersonaCard(input());
    expect(card).toContain('Elif');
    expect(card).toContain('31');
    expect(card).toContain('Fethiye');
    expect(card).toContain('Takı tasarımcısı');
    expect(card).toContain("Çalış'ta küçük bir atölyem var.");
  });

  it('yasak kelime ve platform kurallarini iceren savunma bolumlerini tasir', () => {
    const card = buildPersonaCard(input());
    expect(card).toContain('yapay zeka');   // "bu kelimeleri kullanma" talimati
    expect(card).toContain('numara');       // platform disina cikma yasagi
    expect(card).toContain('112');          // kriz istisnasi
  });

  it('mesgulken kisa yazma baglamini ekler', () => {
    expect(buildPersonaCard(input({ busyNow: true }))).toContain('şu an meşgulsün');
    expect(buildPersonaCard(input({ busyNow: false }))).not.toContain('şu an meşgulsün');
  });

  it('faz 3te soguma baglamini ekler, faz 1de eklemez', () => {
    expect(buildPersonaCard(input({ phase: 3 }))).toContain('ilgin azaldı');
    expect(buildPersonaCard(input({ phase: 1 }))).not.toContain('ilgin azaldı');
  });

  it('sohbet ritmi kurallarini tasir: zorunlu soru ve kalip tekrari yasagi', () => {
    // Canli kusur (2026-09-16): iki ayri bot "gunun nasil gecti peki" kalibini birebir
    // kullandi ve ucu de her mesaji soruyla bitirdi.
    const card = buildPersonaCard(input());
    expect(card).toContain('Arka arkaya iki mesajında soru sorma');
    expect(card).toContain('Aynı kalıbı iki kez kullanma');
    expect(card).toContain('uydurma');
  });

  it('kurallardan ONCE ornek gosterir: pozitif ve negatif ornek bloklari', () => {
    // v1 altmis satir kuraldi ve model "kurallara uyan" bir ses uretiyordu ("cok fake
    // kokuyor"). Ornekler kartin en guclu parcasi; negatifler canli dokumden alindi.
    const card = buildPersonaCard(input());
    expect(card).toContain('SENİN MESAJLARIN BÖYLE GÖRÜNÜR');
    expect(card).toContain('BÖYLE YAZMAZSIN');
    expect(card).toContain('koşturmacalı bir günün ardından');   // gercek kotu cikti
    expect(card.indexOf('SENİN MESAJLARIN')).toBeLessThan(card.indexOf('ÖLÇÜLER'));
  });

  it('somut kelime tavani verir — "kisa yaz" demek yetmiyordu', () => {
    expect(buildPersonaCard(input())).toContain('En fazla 12 kelime yaz.');
    expect(buildPersonaCard(input({
      persona: { ...persona, style: { ...persona.style, uzunluk: 'tek_cumle' } },
    }))).toContain('En fazla 6 kelime yaz.');
  });

  it('ismi dogru cekimler: Elif\'sin, Cansu\'sun, Burcu\'sun', () => {
    expect(buildPersonaCard(input())).toContain("Sen Elif'sin");
    expect(buildPersonaCard(input({ name: 'Cansu' }))).toContain("Sen Cansu'sun");
    expect(buildPersonaCard(input({ name: 'Burcu' }))).toContain("Sen Burcu'sun");
    expect(buildPersonaCard(input({ name: 'Emre' }))).toContain("Sen Emre'sin");
  });

  it('faz 1 metni mesafe ile CELISMEZ', () => {
    // v1'de faz 1 "ilgilisin ve meraklisin" diyordu, mesafe blogu tersini; model
    // celiskili talimat aliyordu.
    const card = buildPersonaCard(input({ phase: 1 }));
    expect(card).toContain('Sohbet yeni');
    expect(card).not.toContain('meraklısın.');
  });

  it('stile gore soru sikligi verir: kisa_kesen nadiren sorar, soru_soran yarisinda', () => {
    const kisaKesen = buildPersonaCard(input());
    expect(kisaKesen).toContain('nadiren soru sorarsın');

    const meraklı = buildPersonaCard(input({
      persona: { ...persona, style: { ...persona.style, enerji: 'soru_soran' } },
    }));
    expect(meraklı).toContain('yaklaşık yarısında soru sorarsın');
  });

  it('karsi taraf kapatiyorsa soru sormama baglamini ekler', () => {
    expect(buildPersonaCard(input({ partnerClosing: true }))).toContain('SORU SORMA');
    expect(buildPersonaCard(input({ partnerClosing: false }))).not.toContain('SORU SORMA');
    expect(buildPersonaCard(input())).not.toContain('SORU SORMA');
  });

  it('zodiac gibi rastgele alanlari tasimaz', () => {
    expect(buildPersonaCard(input()).toLowerCase()).not.toContain('burc');
  });
});
