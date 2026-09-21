import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';

/**
 * Chat servisi — VERI IZOLASYONU yolu.
 *
 * Tum public metotlar `verifyMatchAccess`'ten geciyor (alti giris noktasinin
 * hepsi kontrol edildi). O kapi uc katmanli:
 *   1. `assertUuid` — degerler `.or()` ifadesine string olarak gomuldugu icin
 *      bu bir guvenlik kontrolu, kozmetik degil
 *   2. eslesme var VE kullanici taraflarindan biri
 *   3. `is_active` — engelleme eslesmeyi pasiflestiriyor (bkz. block.service),
 *      yani engelledikten sonra sohbet de kapaniyor. Iki servis birbirini
 *      tamamliyor.
 *
 * `getMessages` burada test EDILMIYOR: ilişkili tablo join'i kullaniyor
 * (`reactions:message_reactions(...)`) ve fake bunu modellemiyor. Yetki kapisi
 * zaten digerleri uzerinden dogrulaniyor.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const YABANCI = '33333333-3333-4333-8333-333333333333';
const MATCH = '44444444-4444-4444-8444-444444444444';
const MSG_A = '55555555-5555-4555-8555-555555555555';
const MSG_B = '66666666-6666-4666-8666-666666666666';

const activeMatch = (over: Record<string, unknown> = {}) => ({
  id: MATCH, user1_id: A, user2_id: B, is_active: true,
  media_enabled_by_user1: false, media_enabled_by_user2: false, ...over,
});

async function setup(seed: Tables = {}) {
  const fake = createFakeSupabase({
    matches: [activeMatch()],
    messages: [],
    ...seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));

  // Push fire-and-forget: gercek servis cagrilsaydi Firebase'e uzanirdi.
  const sendPush = vi.fn<(userId: string, type: string, ...rest: unknown[]) => Promise<void>>(async () => undefined);
  vi.doMock('../../src/services/notification.service.js', () => ({
    NotificationService: { sendPush, getUserDisplayName: vi.fn(async () => 'Berkant') },
  }));

  const { chatService } = await import('../../src/services/chat.service.js');
  return { fake, chatService, sendPush };
}

beforeEach(() => {
  vi.resetModules();
});

describe('verifyMatchAccess — yetki kapisi', () => {
  it('YABANCI kullanici sohbete erisemez', async () => {
    // IDOR'un ta kendisi: eslesmenin tarafi olmayan biri mesajlari okuyamamali.
    const { chatService } = await setup();

    await expect(chatService.markAsRead(YABANCI, MATCH)).rejects.toMatchObject({
      code: 'NOT_MATCHED',
    });
  });

  it('her iki taraf da erisebilir', async () => {
    const { chatService } = await setup();

    await expect(chatService.markAsRead(A, MATCH)).resolves.toMatchObject({ success: true });

    vi.resetModules();
    const second = await setup();
    await expect(second.chatService.markAsRead(B, MATCH)).resolves.toMatchObject({ success: true });
  });

  it('PASIF eslesmede erisim yok — engelledikten sonra sohbet kapali', async () => {
    // `block.service` engellemede `is_active = false` yapiyor; kapinin bu
    // kontrolu olmasaydi engelleme sohbeti kesmezdi.
    const { chatService } = await setup({ matches: [activeMatch({ is_active: false })] });

    await expect(chatService.markAsRead(A, MATCH)).rejects.toMatchObject({
      code: 'MATCH_INACTIVE',
    });
  });

  it('var olmayan eslesme NOT_MATCHED', async () => {
    const { chatService } = await setup({ matches: [] });

    await expect(chatService.markAsRead(A, MATCH)).rejects.toMatchObject({
      code: 'NOT_MATCHED',
    });
  });

  it('gecersiz uuid reddedilir — enjeksiyon yuzeyi kapali', async () => {
    // userId ve matchId `.or()` ifadesine string olarak gomuluyor (satir 52).
    const { chatService } = await setup();

    await expect(chatService.markAsRead("' OR 1=1--", MATCH)).rejects.toBeTruthy();
    await expect(chatService.markAsRead(A, 'not-a-uuid')).rejects.toBeTruthy();
  });
});

describe('deleteMessage — uc katmanli yetki', () => {
  const seedMessages = () => ({
    messages: [
      { id: MSG_A, match_id: MATCH, sender_id: A, content: 'benim', deleted_at: null },
      { id: MSG_B, match_id: MATCH, sender_id: B, content: 'karsi taraf', deleted_at: null },
    ],
  });

  it('kendi mesajini siler — soft delete', async () => {
    const { fake, chatService } = await setup(seedMessages());

    await chatService.deleteMessage(A, MATCH, MSG_A);

    const row = fake.table('messages').find((m) => m.id === MSG_A)!;
    expect(row.deleted_at).not.toBeNull();
    // Satir DURUYOR: sert silme degil, gecmis korunuyor.
    expect(fake.table('messages')).toHaveLength(2);
  });

  it('KARSI TARAFIN mesajini silemez', async () => {
    // Eslesmeye erisimi var ama mesajin sahibi degil — ikinci seviye yetki.
    const { fake, chatService } = await setup(seedMessages());

    await expect(chatService.deleteMessage(A, MATCH, MSG_B)).rejects.toMatchObject({
      code: 'MESSAGE_NOT_OWNER',
    });
    expect(fake.table('messages').find((m) => m.id === MSG_B)!.deleted_at).toBeNull();
  });

  it('BASKA sohbetteki mesaji silemez', async () => {
    // `.eq('match_id', match.id)` olmasaydi, kendi eslesmesine erisimi olan biri
    // baska bir sohbetin mesajini id ile silebilirdi.
    const BASKA_MSG = '77777777-7777-4777-8777-777777777777';
    const { fake, chatService } = await setup({
      messages: [
        { id: BASKA_MSG, match_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sender_id: A, deleted_at: null },
      ],
    });

    await expect(chatService.deleteMessage(A, MATCH, BASKA_MSG)).rejects.toMatchObject({
      code: 'MESSAGE_NOT_FOUND',
    });
    expect(fake.table('messages')[0].deleted_at).toBeNull();
  });

  it('zaten silinmis mesaj NOT_FOUND — iki kez silinmez', async () => {
    const { chatService } = await setup({
      messages: [
        { id: MSG_A, match_id: MATCH, sender_id: A, deleted_at: '2026-09-01T00:00:00Z' },
      ],
    });

    await expect(chatService.deleteMessage(A, MATCH, MSG_A)).rejects.toMatchObject({
      code: 'MESSAGE_NOT_FOUND',
    });
  });

  it('yabanci, yetki kapisinda durur — mesaja hic bakilmaz', async () => {
    const { fake, chatService } = await setup(seedMessages());

    await expect(chatService.deleteMessage(YABANCI, MATCH, MSG_A)).rejects.toMatchObject({
      code: 'NOT_MATCHED',
    });
    expect(fake.table('messages').find((m) => m.id === MSG_A)!.deleted_at).toBeNull();
  });
});

describe('markAsRead', () => {
  it('yalnizca KARSI TARAFIN okunmamis mesajlarini isaretler', async () => {
    // Kendi mesajini okundu isaretlemek anlamsiz; `neq('sender_id', userId)`.
    const { fake, chatService } = await setup({
      messages: [
        { id: MSG_A, match_id: MATCH, sender_id: A, read_at: null },
        { id: MSG_B, match_id: MATCH, sender_id: B, read_at: null },
      ],
    });

    await chatService.markAsRead(A, MATCH);

    const byId = Object.fromEntries(fake.table('messages').map((m) => [m.id, m.read_at]));
    expect(byId[MSG_A]).toBeNull();
    expect(byId[MSG_B]).not.toBeNull();
  });

  it('zaten okunmus mesajin damgasini DEGISTIRMEZ', async () => {
    // `.is('read_at', null)` — yoksa her acilista zaman damgasi ezilirdi.
    const { fake, chatService } = await setup({
      messages: [
        { id: MSG_B, match_id: MATCH, sender_id: B, read_at: '2026-09-01T00:00:00Z' },
      ],
    });

    await chatService.markAsRead(A, MATCH);

    expect(fake.table('messages')[0].read_at).toBe('2026-09-01T00:00:00Z');
  });

  it('BASKA sohbetin mesajlarina dokunmaz', async () => {
    const { fake, chatService } = await setup({
      messages: [
        { id: MSG_B, match_id: MATCH, sender_id: B, read_at: null },
        { id: '88888888-8888-4888-8888-888888888888', match_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sender_id: B, read_at: null },
      ],
    });

    await chatService.markAsRead(A, MATCH);

    const other = fake.table('messages').find((m) => m.match_id !== MATCH)!;
    expect(other.read_at).toBeNull();
  });
});

describe('sendMessage — bildirim sablonu medya turune gore', () => {
  // Fotografin ozel sablonu vardi ama sesli mesaj "size mesaj gonderdi" diyordu:
  // alici bildirimden neyin geldigini anlayamiyordu. Sablon 18 dilde de eklendi.
  // Medya URL'si kendi storage'imizi gostermek zorunda (chat.service domain kapisi).
  const MEDYA = 'https://test.supabase.co/storage/v1/object/public/chat-media/';

  const gonder = async (over: { isImage?: boolean; audioUrl?: string }) => {
    // Medya gonderimi iki tarafin da iznini ister (chat.service sendMessage kapisi).
    const { chatService, sendPush } = await setup({
      matches: [activeMatch({ media_enabled_by_user1: true, media_enabled_by_user2: true })],
    });
    const icerik = over.isImage ? `${MEDYA}a.jpg` : 'selam';
    await chatService.sendMessage(
      A, MATCH, icerik, over.isImage ?? false, over.audioUrl, over.audioUrl ? 7 : undefined,
    );
    await vi.waitFor(() => expect(sendPush).toHaveBeenCalled());
    return sendPush.mock.calls[0]!;
  };

  it('sesli mesaj -> new_message_voice', async () => {
    const [, tip] = await gonder({ audioUrl: `${MEDYA}a.m4a` });
    expect(tip).toBe('new_message_voice');
  });

  it('fotograf -> new_message_image', async () => {
    const [, tip] = await gonder({ isImage: true });
    expect(tip).toBe('new_message_image');
  });

  it('duz metin -> new_message', async () => {
    const [, tip] = await gonder({});
    expect(tip).toBe('new_message');
  });
});
