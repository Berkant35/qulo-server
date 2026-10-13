import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';
import { krizSinyali, yasAltiBeyani, krizCevabi, guvenlikVaryantlari } from '../../src/services/seed-locale/guvenlik.js';
import { TUM_PAKETLER } from '../../src/services/seed-locale/paketler.js';
import { IT_PAKETI, TR_PAKETI } from '../../src/services/seed-locale/index.js';
import { validateReply } from '../../src/services/seed-reply-guard.js';

/**
 * Guvenlik incelemesi (bcf5812, 2026-10-13): kriz / 18 yas alti kapilari yalniz seed'in dil
 * paketiyle calisiyordu — Italyan seed'e Turkce yazilan kriz mesaji, TR seed'e Italyanca yazilan
 * yas beyani kaciyordu (eskiden TR deseni herkese uygulanirdi = gerileme). Ilke: kapilar dilden
 * bagimsiz ve fail-closed (tum paketlerin + temel Ingilizce desenlerin birlesimi, normalize metin);
 * giden mesaj guard'inda telefon/yasak kelime de birlesimle.
 */

describe('kapilar dilden bagimsiz (birlesim)', () => {
  it('her dil paketi kriz + yas alti ifadeleri ve kriz cevabi tasir (paketsiz guvenlik yok)', () => {
    for (const p of TUM_PAKETLER) {
      expect(p.guvenlik.krizIfadeleri.length, p.locale).toBeGreaterThan(0);
      expect(p.guvenlik.yasAltiDesenleri.length, p.locale).toBeGreaterThan(0);
      expect(p.guvenlik.krizCevabi, p.locale).toMatch(/112/);
    }
  });

  it('hicbir paket deseni g/y bayragi tasimaz (.test() durum tutup araliksiz kacirirdi)', () => {
    const desenler = TUM_PAKETLER.flatMap((p) => [
      p.kapanis, p.guard.telefon, p.guard.yabanciDil, ...p.guard.yasak,
      ...(p.guvenlik.ham ? [p.guvenlik.ham.kriz, p.guvenlik.ham.yasAlti] : []),
    ]);
    for (const d of desenler) expect(d.flags, d.source.slice(0, 40)).not.toMatch(/[gy]/);
  });

  it.each([
    ['TR kriz', 'artık yaşamak istemiyorum'],
    ['IT kriz', 'voglio morire'],
    ['EN kriz', 'i want to kill myself'],
    ['EN kriz 2', 'thinking about suicide'],
  ])('%s her durumda kriz', (_ad, metin) => expect(krizSinyali(metin)).toBe(true));

  it.each([
    ['TR yas', '16 yaşındayım'],
    ['IT yas', 'ho 16 anni'],
    ['EN yas', "I'm 16"],
    ['EN yas 2', 'im 15 years old'],
    ['EN underage', 'i am underage'],
  ])('%s her durumda 18 yas alti', (_ad, metin) => expect(yasAltiBeyani(metin)).toBe(true));
});

describe('normalizasyon: aksan, bitisik, tekrar, gorunmez karakter, yaziyla sayi', () => {
  it.each([
    'vogliomorire', 'VOGLIO MORIREEEE', 'voglio   morire!!!', 'non voglio piu vivere', 'non voglio più vivere',
    'i\u200Bntihar', 'İNTİHAR', 'olmek istiyorum', 'yasamak istemiyorum', 'canima kiyacagim',
    'voglio m o r i r e', 'kill   myself',
  ])('kriz: %s', (metin) => expect(krizSinyali(metin)).toBe(true));

  it.each([
    'ho 1 6 anni', 'ho16anni', 'ho sedici anni', 'ho SEDICI anni', 'ho 16 annnni', 'on altı yaşındayım', 'onyedi yasindayim',
    '15yaş', 'yaşım 16', 'resit degilim', 'reşit değilim', 'sono minorènne', 'i am sixteen', "i'm 16, you?",
    'h\u200Bo 16 anni', 'h o 1 6 anni',
  ])('yas alti: %s', (metin) => expect(yasAltiBeyani(metin)).toBe(true));

  it.each([
    // Not: "bölmek istiyorum" TR ham deseninde (\b'siz "ölmek istiyorum") 2026-10-13 oncesinden beri
    // yanlis pozitif; ham desenler bilerek korunur (eski her "true" true kalir).
    'muoio dal ridere', 'mi ammazzo dalle risate', 'ölümüne güldüm', 'ciao come stai', 'killer queen',
    'a e i o u sono le vocali', 'vado a e torno',
  ])('kriz DEGIL: %s', (metin) => expect(krizSinyali(metin)).toBe(false));

  it.each([
    'ho 25 anni', 'ho 15 anni di esperienza', 'h o 2 5 anni', 'non sono minorenne', '25 yaşındayım', '18 yaşındayım', "i'm 16 minutes late",
    'i am 25', 'ho 116 anni', 'onların yaşı 30',
  ])('yas alti DEGIL: %s', (metin) => expect(yasAltiBeyani(metin)).toBe(false));

  it('varyantlar: kucuk harf + TR i esleme + aksan sokme + gorunmez karakter + rakam birlestirme', () => {
    expect(guvenlikVaryantlari('İntihar\u200B ŞİMDİ 1 6')).toContain('intihar simdi 16');
  });
});

describe('kriz cevabinin dili', () => {
  it('mesaj seed dilinde ise seed dilinde', () => {
    expect(krizCevabi('voglio morire', IT_PAKETI)).toBe(IT_PAKETI.guvenlik.krizCevabi);
    expect(krizCevabi('intihar edeceğim', TR_PAKETI)).toBe(TR_PAKETI.guvenlik.krizCevabi);
  });
  it('Italyan seed\'e Turkce kriz: Turkce cevap (Turkiye 112), TR seed\'e Italyanca: Italyanca', () => {
    expect(krizCevabi('yaşamak istemiyorum', IT_PAKETI)).toBe(TR_PAKETI.guvenlik.krizCevabi);
    expect(krizCevabi('voglio farla finita', TR_PAKETI)).toBe(IT_PAKETI.guvenlik.krizCevabi);
  });
  it('yalniz Ingilizce eslesme: seed dilinde', () => {
    expect(krizCevabi('kill myself', IT_PAKETI)).toBe(IT_PAKETI.guvenlik.krizCevabi);
  });
});

describe('giden mesaj guard: telefon ve yasak kelime tum paketlerle', () => {
  const sonuc = (t: string, paket = TR_PAKETI) => {
    const r = validateReply(t, 'Sen Elif\'sin.', paket);
    return r.ok ? 'ok' : r.reason;
  };
  it.each([
    '+39 333 123 4567', '0039 333-123-4567', '333 123 4567', '347.123.4567', '02 1234 5678', '333\u200B1234567',
  ])('TR seed Italyan numara yazamaz: %s', (t) => expect(sonuc(t)).toBe('iletisim'));

  it.each(['0532 111 22 33', '+90 532 111 22 33', '0532.111.22.33', '5321112233', '+90 (532) 111-22-33'])(
    'IT seed Turk numarasi yazamaz: %s', (t) => expect(sonuc(t, IT_PAKETI)).toBe('iletisim'),
  );

  it("TR seed Italyanca ele veren kelimeyi yazamaz, IT seed Turkcesini", () => {
    expect(sonuc("sono un'intelligenza artificiale")).toBe('yasak_kelime');
    expect(sonuc('ben bir yapay zekayım', IT_PAKETI)).toBe('yasak_kelime');
  });

  it('IT seed Turkce cumle kuramaz (Turkceye ozgu harfler yabanci dil isareti)', () => {
    expect(sonuc('bugün çok yoğundu ışık gibi', IT_PAKETI)).toBe('ingilizce');
  });
});

describe('processRow uc uca — capraz dil', () => {
  const SEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const INSAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const MATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const row = { id: 'q1', match_id: MATCH, seed_user_id: SEED, trigger_message_id: 'm1', question_id: null,
    media_request_id: null, kind: 'message', reply_due_at: '2026-10-13T10:01:00Z', status: 'claimed', attempts: 1 };

  beforeEach(() => vi.resetModules());

  async function setup(locale: string | null, insanMetni: string) {
    const fake = createFakeSupabase({
      users: [
        { id: SEED, is_seed_profile: true, is_test_account: true, name: 'Giulia', age: 29, city: 'Milano', seed_persona: null, locale },
        { id: INSAN, is_seed_profile: false },
      ],
      user_details: [],
      matches: [{ id: MATCH, user1_id: SEED, user2_id: INSAN, is_active: true }],
      messages: [{ id: 'm1', match_id: MATCH, sender_id: INSAN, content: insanMetni, deleted_at: null, created_at: '2026-10-13T10:00:00Z' }],
      seed_reply_queue: [row],
    });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const generateSeedReply = vi.fn(async () => ({ text: 'ok dai', inputTokens: 1, outputTokens: 1 }));
    vi.doMock('../../src/services/seed-llm.service.js', () => ({
      generateSeedReply, SEED_LLM_MODEL: 'test', SeedLlmError: class extends Error {},
    }));
    const sendMessage = vi.fn(async (_u: string, _m: string, _c: string) => ({ id: 'x' }));
    vi.doMock('../../src/services/chat.service.js', () => ({ chatService: { sendMessage } }));
    const svc = await import('../../src/services/seed-reply.service.js');
    return { svc, fake, sendMessage, generateSeedReply };
  }

  it('Italyan seed + Turkce kriz mesaji: LLM yok, Turkce kriz cevabi', async () => {
    const { svc, sendMessage, generateSeedReply } = await setup('it', 'artık yaşamak istemiyorum');
    expect(await svc.processRow(row as never)).toBe('sent');
    expect(generateSeedReply).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0]![2]).toBe(TR_PAKETI.guvenlik.krizCevabi);
  });

  it('TR seed + Italyanca 18 yas alti beyani: iptal, hicbir sey gonderilmez', async () => {
    const { svc, sendMessage } = await setup('tr', 'ho sedici anni');
    expect(await svc.processRow(row as never)).toBe('cancelled');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('paketi olmayan dil (es) + Ingilizce yas beyani: iptal (fail-closed)', async () => {
    const { svc, sendMessage } = await setup('es', "i'm 15");
    expect(await svc.processRow(row as never)).toBe('cancelled');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('Italyan seed + bitisik/aksansiz kriz: kriz cevabi', async () => {
    const { svc, sendMessage, generateSeedReply } = await setup('it', 'non voglio piu vivere');
    expect(await svc.processRow(row as never)).toBe('sent');
    expect(generateSeedReply).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0]![2]).toBe(IT_PAKETI.guvenlik.krizCevabi);
  });
});

describe('inceleme sertlestirmesi (2026-10-13): yas / kriz ifadeleri', () => {
  it.each([
    '16 anni e tu?', 'ne ho 16', 'ho compiuto 16 anni', 'ho 16 anni in realtà', 'ho 16 anni di età', 'ho 16 anni da poco',
    'sedicenne', 'sono minorenne', 'minorenne', 'ho diciasette anni', "ho diciassett'anni",
    '16yım', 'ben 16yım', '16 yaşımdayım', '13üm', "15'im",
    'under 18', "i'm a minor", 'im not 18', 'sono del 2010', 'classe 2011', '2009 doğumluyum', 'born in 2012',
    'ho １６ anni',
  ])('yas alti: %s', (metin) => expect(yasAltiBeyani(metin, new Date('2026-10-13T00:00:00Z'))).toBe(true));

  it.each([
    'sono del 1995', '1998 doğumluyum', 'born in 2001', 'ho 15 anni di esperienza', 'non sono minorenne', 'ho 22 anni',
  ])('yas alti DEGIL: %s', (metin) => expect(yasAltiBeyani(metin, new Date('2026-10-13T00:00:00Z'))).toBe(false));

  it.each([
    'mi uccido', 'mi voglio uccidere', 'mi tolgo la vita', 'la faccio finita', 'non voglio vivere più', 'mi ammazzo stasera',
    'ölmek istiyom', 'yaşamak istemiyom', 'kendimi asacağım', 'kendimi kesiyorum', 'keşke ölsem',
    "i don't want to live", 'kms', 'unalive myself', 'i want to end it all', 'ｉｎｔｉｈａｒ',
  ])('kriz: %s', (metin) => expect(krizSinyali(metin)).toBe(true));

  it.each(['mi ammazzo dal ridere', 'mi ammazzo di lavoro', 'abito a 5 kms da qui', 'mi taglio i capelli'])(
    'kriz DEGIL: %s', (metin) => expect(krizSinyali(metin)).toBe(false),
  );
});

describe('inceleme sertlestirmesi: giden guard', () => {
  const sonuc = (t: string, paket = IT_PAKETI) => {
    const r = validateReply(t, 'Ti chiami Giulia.', paket);
    return r.ok ? 'ok' : r.reason;
  };
  it.each([
    '３３３１２３４５６７', '𝟑𝟑𝟑𝟏𝟐𝟑𝟒𝟓𝟔𝟕', '3\uFE0F\u20E33\uFE0F\u20E33\uFE0F\u20E31\uFE0F\u20E32\uFE0F\u20E33\uFE0F\u20E34\uFE0F\u20E35\uFE0F\u20E36\uFE0F\u20E37\uFE0F\u20E3', '333/1234567', '333,123,4567', 'scrivimi su t.me/giulia', 'ig: giulia.grafica',
  ])('iletisim: %s', (t) => expect(sonuc(t)).toBe('iletisim'));

  it('yardim hatti (Telefono Amico) iletisim sayilmaz: kriz kapisi kacsa da yardim engellenmez', () => {
    expect(sonuc('per favore chiama Telefono Amico allo 02 2327 2327 o il 112')).toBe('ok');
    expect(sonuc('chiama il 02 2327 2327', TR_PAKETI)).toBe('ok');
    // Yardim hatti yaninda baska bir numara yine yakalanir.
    expect(sonuc('02 2327 2327 oppure il mio 333 123 4567')).toBe('iletisim');
  });

  it.each(['sono un modello', 'sono un assistente', 'sono una I.A. lo ammetto'])('IT yasak: %s', (t) => expect(sonuc(t)).toBe('yasak_kelime'));
  it("TR yasak: 'ben bir botum'", () => expect(sonuc('ben bir botum', TR_PAKETI)).toBe('yasak_kelime'));
  it("meslek olarak asistan serbest: \"sono un'assistente di volo\"", () => expect(sonuc("sono un'assistente di volo")).toBe('ok'));
  it('karsi tarafin Turkce adi (Işıl) tek basina yabanci dil sayilmaz; Turkce cumle sayilir', () => {
    expect(sonuc('ciao Işıl, tutto bene?')).toBe('ok');
    expect(sonuc('bugün çok yoğundu ışık')).toBe('ingilizce');
  });
  it('gonderilen metin degismez (emoji varyasyon secicisi korunur)', () => {
    const r = validateReply('ciao ❤\uFE0F', 'x', IT_PAKETI);
    expect(r.ok && r.text).toBe('ciao ❤\uFE0F');
  });
});
