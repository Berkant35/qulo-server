import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Foto/ses paylasim istegi — seed profilin cevabi.
 *
 * Oncesinde bu yol HIC yoktu: `media_requests` taranmiyordu, istek sonsuza dek
 * `pending` kaliyordu. Bu tek basina bir gorsel kusur degil, KALICI kilitlenme —
 * `MediaService.requestMedia` bekleyen istek varken MEDIA_REQUEST_PENDING firlatir
 * ve isteklerin timeout'u yoktur, yani kullanici o eslesmede bir daha foto/ses
 * gonderemez. Canli kanit: 2026-09-17'den 09-21'e kadar bekleyen bir istek.
 *
 * Secilen davranis RET: bot medya GONDEREMEZ (chatService.sendMessage yalniz metin
 * alir), kabul etseydi verdigi sozu tutamazdi.
 */

const SEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ISTEK = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'q1', match_id: MATCH, seed_user_id: SEED, trigger_message_id: null,
  question_id: null, media_request_id: ISTEK, kind: 'media_request',
  reply_due_at: '2026-09-16T10:01:00Z', status: 'claimed', attempts: 1, ...over,
});

async function setup(opts: {
  seed?: Tables; llm?: string; llmThrows?: Error; fail?: FakeSupabaseOptions['failOn'];
} = {}) {
  const fake = createFakeSupabase({
    users: [
      { id: SEED, is_seed_profile: true, is_test_account: true, name: 'Elif', age: 31, city: 'Fethiye', bio: 'atölye', seed_persona: null },
      { id: INSAN, is_seed_profile: false, name: 'Berkant' },
    ],
    user_details: [{ user_id: SEED, job: 'Takı tasarımcısı', personality: 'Ambivert' }],
    matches: [{
      id: MATCH, user1_id: SEED, user2_id: INSAN, is_active: true,
      media_enabled_by_user1: false, media_enabled_by_user2: true,   // isteyen insan: bayragi acik
    }],
    messages: [{ id: 'm1', match_id: MATCH, sender_id: INSAN, content: 'selam', deleted_at: null, created_at: '2026-09-16T10:00:00Z' }],
    media_requests: [{ id: ISTEK, match_id: MATCH, requester_id: INSAN, status: 'pending', created_at: '2026-09-16T10:00:30Z' }],
    seed_reply_queue: [row()],
    app_config: [{ id: 'cfg', seed_reply_enabled: true, seed_reply_fast_mode: false }],
    ...opts.seed,
  }, opts.fail ? { failOn: opts.fail } : undefined);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));

  const generateSeedReply = vi.fn(async () => {
    if (opts.llmThrows) throw opts.llmThrows;
    return { text: opts.llm ?? 'yok şimdilik, öyle kalsın', inputTokens: 80, outputTokens: 12 };
  });
  vi.doMock('../../src/services/seed-llm.service.js', () => ({
    generateSeedReply, SEED_LLM_MODEL: 'test-model',
    SeedLlmError: class extends Error { constructor(public code: string, m: string) { super(m); } },
  }));

  const sendMessage = vi.fn(async () => ({ id: 'yeni' }));
  vi.doMock('../../src/services/chat.service.js', () => ({ chatService: { sendMessage } }));

  const svc = await import('../../src/services/seed-reply.service.js');
  return { fake, svc, sendMessage, generateSeedReply };
}

const istek = (fake: { table: (t: string) => Record<string, unknown>[] }) => fake.table('media_requests')[0]!;

beforeEach(() => vi.resetModules());

describe('respondMediaRequest', () => {
  it('istegi REDDEDER ve sohbete kisa bir gecistirme yazar', async () => {
    const { svc, fake, sendMessage } = await setup();

    expect(await svc.respondMediaRequest(row() as never)).toBe('sent');

    expect(istek(fake).status).toBe('rejected');
    expect(sendMessage).toHaveBeenCalledWith(SEED, MATCH, 'yok şimdilik, öyle kalsın');
    expect(fake.table('seed_reply_queue')[0]!.status).toBe('sent');
  });

  it('ret, isteyenin medya bayragini geri alir — kullanici tekrar isteyebilsin', async () => {
    const { svc, fake } = await setup();
    await svc.respondMediaRequest(row() as never);
    const m = fake.table('matches')[0]!;
    expect(m.media_enabled_by_user2).toBe(false);
    expect(m.media_enabled_by_user1).toBe(false);
  });

  it('bot yazarken cevrimici gorunur (is_online + last_seen birlikte)', async () => {
    const { svc, fake } = await setup();
    await svc.respondMediaRequest(row() as never);
    const u = fake.table('users').find((r) => r.id === SEED)!;
    expect(u.is_online).toBe(true);
    expect(Date.now() - new Date(u.last_seen_at as string).getTime()).toBeLessThan(5_000);
  });

  it('LLM patlasa bile istek REDDEDILMIS kalir — kilitlenme her halukarda acilir', async () => {
    // Sessizlik, hazir kalip cevaptan iyidir (processRow'daki ayni karar); ama asil is
    // olan ret yapilmis olmali, yoksa kullanici o eslesmede bir daha medya isteyemez.
    const { svc, fake, sendMessage } = await setup({ llmThrows: new Error('gemini down') });

    expect(await svc.respondMediaRequest(row() as never)).toBe('sent');

    expect(istek(fake).status).toBe('rejected');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('cikti denetimi elenirse de ret ayakta kalir, mesaj yazilmaz', async () => {
    const { svc, fake, sendMessage } = await setup({ llm: 'instagramdan yazsana bana' });

    expect(await svc.respondMediaRequest(row() as never)).toBe('sent');

    expect(istek(fake).status).toBe('rejected');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('ret YAZILAMAZSA mesaj da gonderilmez — sira garantisi', async () => {
    // Ters sirada bot "istemiyorum" yazip istegi pending birakirdi: hem celiski
    // hem kilitlenme. Yalniz media_requests.update bozulur, akisin hedeflenen adimi.
    const { svc, fake, sendMessage } = await setup({ fail: [{ table: 'media_requests', op: 'update' }] });

    expect(await svc.respondMediaRequest(row() as never)).toBe('deferred');

    expect(istek(fake).status).toBe('pending');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('18 yas alti beyaninda RET yapilir ama flort dilinde gecistirme YAZILMAZ', async () => {
    // Metin satiri bu sebeple iptal edilse bile medya istegi AYRI bir tetikleyici
    // (farkli id) oldugu icin iptal filtresine takilmiyordu: kapi bu yolda da lazim.
    const { svc, fake, sendMessage, generateSeedReply } = await setup({
      seed: {
        messages: [{
          id: 'm1', match_id: MATCH, sender_id: INSAN, deleted_at: null,
          content: 'ben 16 yaşındayım bu arada', created_at: '2026-09-16T10:00:00Z',
        }],
      },
    });

    expect(await svc.respondMediaRequest(row() as never)).toBe('sent');

    expect(istek(fake).status).toBe('rejected');      // guvenli taraf: medya ACILMAZ
    expect(sendMessage).not.toHaveBeenCalled();
    expect(generateSeedReply).not.toHaveBeenCalled(); // LLM'e hic gidilmez
  });

  it('kriz beyaninda da ret yapilir, gecistirme yazilmaz', async () => {
    const { svc, fake, sendMessage, generateSeedReply } = await setup({
      seed: {
        messages: [{
          id: 'm1', match_id: MATCH, sender_id: INSAN, deleted_at: null,
          content: 'artık yaşamak istemiyorum', created_at: '2026-09-16T10:00:00Z',
        }],
      },
    });

    expect(await svc.respondMediaRequest(row() as never)).toBe('sent');

    expect(istek(fake).status).toBe('rejected');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(generateSeedReply).not.toHaveBeenCalled();
  });

  it('istek BASKA bir eslesmeye aitse islemez — tarama sorgusu tek savunma degil', async () => {
    const { svc, fake, sendMessage } = await setup({
      seed: {
        media_requests: [{
          id: ISTEK, match_id: '99999999-9999-4999-8999-999999999999',
          requester_id: INSAN, status: 'pending',
        }],
      },
    });

    expect(await svc.respondMediaRequest(row() as never)).toBe('cancelled');

    expect(istek(fake).status).toBe('pending');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('botun KENDI actigi istege cevap yazmaz', async () => {
    const { svc, sendMessage } = await setup({
      seed: { media_requests: [{ id: ISTEK, match_id: MATCH, requester_id: SEED, status: 'pending' }] },
    });
    expect(await svc.respondMediaRequest(row() as never)).toBe('cancelled');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('zaten cevaplanmis istegi tekrar islemez', async () => {
    const { svc, sendMessage } = await setup({
      seed: { media_requests: [{ id: ISTEK, match_id: MATCH, requester_id: INSAN, status: 'accepted' }] },
    });
    expect(await svc.respondMediaRequest(row() as never)).toBe('cancelled');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('is_test_account=false olan profil adina medya istegi CEVAPLAMAZ', async () => {
    // Diger yazma yollariyla ayni kimlik kapisi: ret de gercek bir kullaniciya
    // gorunen bir eylem (bildirim + bayrak degisikligi).
    const { svc, fake, sendMessage } = await setup({
      seed: {
        users: [
          { id: SEED, is_seed_profile: true, is_test_account: false, name: 'Elif', seed_persona: null },
          { id: INSAN, is_seed_profile: false, name: 'Berkant' },
        ],
      },
    });
    expect(await svc.respondMediaRequest(row() as never)).toBe('cancelled');
    expect(istek(fake).status).toBe('pending');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('scanAndEnqueue — medya istegi onceligi', () => {
  it('bekleyen medya istegi varsa METIN satiri degil media_request satiri acar', async () => {
    const { svc, fake } = await setup({ seed: { seed_reply_queue: [] } });

    expect(await svc.scanAndEnqueue(new Date('2026-09-16T17:00:00Z'), () => 0.5)).toBe(1);

    const satir = fake.table('seed_reply_queue')[0]!;
    expect(satir.kind).toBe('media_request');
    expect(satir.media_request_id).toBe(ISTEK);
    expect(satir.trigger_message_id).toBeFalsy();
  });

  it('botun kendi actigi istek satir acmaz — sirdaki insan mesajina doner', async () => {
    const { svc, fake } = await setup({
      seed: {
        seed_reply_queue: [],
        media_requests: [{ id: ISTEK, match_id: MATCH, requester_id: SEED, status: 'pending' }],
      },
    });

    expect(await svc.scanAndEnqueue(new Date('2026-09-16T17:00:00Z'), () => 0.5)).toBe(1);

    expect(fake.table('seed_reply_queue')[0]!.kind).toBe('message');
  });
});

describe('scanAndEnqueue — medya sorgusu hatayi yutmaz', () => {
  it('media_requests okunamazsa FIRLATIR — sessizce metin cevabina dusmez', async () => {
    // Sessiz yutma tam da kapatmaya calistigimiz kilitlenmeyi uretirdi: bot metin
    // yazar, istek sonsuza dek pending kalir. (Discover olayi 2026-09-17: sessizce
    // yutulan hata havuzu herkes icin bosaltmisti.)
    const { svc } = await setup({
      seed: { seed_reply_queue: [] },
      fail: [{ table: 'media_requests', op: 'select' }],
    });

    await expect(svc.scanAndEnqueue(new Date('2026-09-16T17:00:00Z'), () => 0.5)).rejects.toBeTruthy();
  });
});

describe('mesajMetni — bot medyayi goremez', () => {
  it('foto ve sesli mesaj ETIKET olarak gecer, ham URL/sabit metin olarak degil', async () => {
    // Foto mesajinda content ham storage URL'si, seste sabit "Sesli mesaj" metni.
    // Ham gecerse model bunlari karsi tarafin YAZDIGI metin sanip alakasiz cevap yazar.
    const { svc } = await setup();
    expect(svc.mesajMetni({ content: 'https://x.supabase.co/storage/v1/a.jpg', is_image: true }))
      .toBe('(fotoğraf gönderdi)');
    expect(svc.mesajMetni({ content: 'Sesli mesaj', audio_url: 'https://x.supabase.co/storage/v1/a.m4a' }))
      .toBe('(sesli mesaj gönderdi)');
  });

  it('soru karti isareti ve duz metin eskisi gibi davranir', async () => {
    const { svc } = await setup();
    expect(svc.mesajMetni({ content: '__QUESTION__:abc' })).toBe('(soru kartı)');
    expect(svc.mesajMetni({ content: 'günün nasıl geçti' })).toBe('günün nasıl geçti');
    expect(svc.mesajMetni({})).toBe('');
  });
});
