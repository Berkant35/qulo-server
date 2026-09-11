import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Kalici hesap silme: soft-delete edilmis hesap yeniden kayitta tamamen temizlenir.
 *
 * En kritik iddia IZOLASYON — filtre bozulursa bu servis BASKA kullanicilarin
 * verisini siler. Her test silinecek kullanicinin yanina baska birinin verisini de
 * tohumlar ve onun dokunulmadan kaldigini dogrular. Onceden bu yol yalnizca kayit
 * ve sosyal giris uzerinden dolayli test ediliyordu; izolasyon hic sinanmiyordu.
 */

const UID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';

/**
 * Silinmesi ZORUNLU tablo girdileri (KVKK silme hakki). Servisteki listenin bir
 * kopyasi degil, beklenen sonucun sartnamesi: bir girdi servisten dusurulurse
 * bu test kirmiziya doner. Yeni tablo eklenince buraya da eklenmeli.
 */
const PURGED: ReadonlyArray<readonly [table: string, column: string]> = [
  ['campaign_events', 'user_id'], ['notifications', 'user_id'], ['message_reactions', 'user_id'],
  ['messages', 'sender_id'], ['chat_questions', 'sender_id'], ['media_requests', 'requester_id'],
  ['matches', 'user1_id'], ['matches', 'user2_id'], ['swipes', 'swiper_id'], ['swipes', 'target_id'],
  ['diamond_transactions', 'user_id'], ['power_purchase_transactions', 'user_id'],
  ['user_power_inventory', 'user_id'], ['iap_transactions', 'user_id'], ['user_subscriptions', 'user_id'],
  ['questions', 'user_id'], ['reports', 'reporter_id'], ['reports', 'reported_id'],
  ['referrals', 'referrer_id'], ['referrals', 'referee_id'], ['user_languages', 'user_id'],
  ['user_details', 'user_id'], ['user_consents', 'user_id'], ['refresh_tokens', 'user_id'],
];

/** Her girdi icin silinecek kullanicinin bir satiri ve baska birinin bir satiri. */
function seedEveryTable(): Tables {
  const seed: Tables = {};
  for (const [table, column] of PURGED) {
    (seed[table] ??= []).push(
      { id: `${table}.${column}.mine`, [column]: UID },
      { id: `${table}.${column}.other`, [column]: OTHER },
    );
  }
  return seed;
}

async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(
    { users: [{ id: UID, is_deleted: true }, { id: OTHER, is_deleted: false }], ...seed },
    options,
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { accountPurgeService } = await import('../../src/services/account-purge.service.js');
  return { fake, accountPurgeService };
}

beforeEach(() => {
  vi.resetModules();
});

describe('accountPurgeService.hardDeleteUser', () => {
  it('24 girdinin hepsinde yalnizca silinen kullanicinin satiri gider, baskasininki kalir', async () => {
    const { fake, accountPurgeService } = await setup(seedEveryTable());

    await accountPurgeService.hardDeleteUser(UID);

    expect(fake.table('users').map((u) => u.id)).toEqual([OTHER]);
    for (const [table, column] of PURGED) {
      const ids = fake.table(table).map((r) => r.id);
      expect(ids, `${table}.${column}`).not.toContain(`${table}.${column}.mine`);
      expect(ids, `${table}.${column}`).toContain(`${table}.${column}.other`);
    }
  });

  it('eslesme ve kaydirmalar iki yonde de silinir, baskalarininki kalir', async () => {
    const { fake, accountPurgeService } = await setup({
      matches: [
        { id: 'a', user1_id: UID, user2_id: OTHER },
        { id: 'b', user1_id: THIRD, user2_id: UID },
        { id: 'c', user1_id: OTHER, user2_id: THIRD },
      ],
      swipes: [
        { id: 's1', swiper_id: UID, target_id: OTHER },
        { id: 's2', swiper_id: OTHER, target_id: UID },
        { id: 's3', swiper_id: OTHER, target_id: THIRD },
      ],
    });

    await accountPurgeService.hardDeleteUser(UID);

    expect(fake.table('matches').map((m) => m.id)).toEqual(['c']);
    expect(fake.table('swipes').map((s) => s.id)).toEqual(['s3']);
  });

  it('cozen ya da hedef oldugu quiz oturumlari cevaplariyla silinir, baskalarininki kalir', async () => {
    const { fake, accountPurgeService } = await setup({
      quiz_sessions: [
        { id: 'qs1', solver_id: UID, target_id: OTHER },
        { id: 'qs2', solver_id: OTHER, target_id: UID },
        { id: 'qs3', solver_id: OTHER, target_id: THIRD },
      ],
      quiz_answers: [
        { id: 'qa1', session_id: 'qs1' },
        { id: 'qa2', session_id: 'qs2' },
        { id: 'qa3', session_id: 'qs3' },
      ],
    });

    await accountPurgeService.hardDeleteUser(UID);

    expect(fake.table('quiz_sessions').map((s) => s.id)).toEqual(['qs3']);
    expect(fake.table('quiz_answers').map((a) => a.id)).toEqual(['qa3']);
  });

  it('yalnizca kullanicinin fotograf klasoru silinir', async () => {
    const { fake, accountPurgeService } = await setup({}, {
      storage: { photos: [`${UID}/a.jpg`, `${UID}/b.jpg`, `${OTHER}/c.jpg`] },
    });

    await accountPurgeService.hardDeleteUser(UID);

    expect(fake.storageFiles('photos')).toEqual([`${OTHER}/c.jpg`]);
  });

  /**
   * Sohbet medyasi `chat-media/${matchId}/` altinda. Eslesme silinince mesajlari da
   * CASCADE ile gidiyor (prod semasi dogrulandi); klasor temizlenmezse dosyalar
   * herkese acik bucket'ta sahipsiz kalir — gizlilik politikasi mesajlarin kalici
   * silindigini vaat ediyor.
   */
  it('kullanicinin eslesmelerinin sohbet medyasi silinir, baska eslesmelerinki kalir', async () => {
    const { fake, accountPurgeService } = await setup({
      matches: [
        { id: 'm-a', user1_id: UID, user2_id: OTHER },
        { id: 'm-b', user1_id: THIRD, user2_id: UID },
        { id: 'm-c', user1_id: OTHER, user2_id: THIRD },
      ],
    }, {
      storage: { 'chat-media': ['m-a/1.jpg', 'm-a/2.m4a', 'm-b/3.jpg', 'm-c/4.jpg'] },
    });

    await accountPurgeService.hardDeleteUser(UID);

    expect(fake.storageFiles('chat-media')).toEqual(['m-c/4.jpg']);
  });

  it('kalabalik sohbet klasoru sayfa sayfa tamamen bosaltilir (Storage list sayfali)', async () => {
    // Gercek Storage `list` varsayilan 100, en fazla sayfa boyu kadar dosya doner;
    // tek seferlik liste buyuk sohbetin medyasinin bir kismini geride birakirdi.
    const many = Array.from({ length: 1001 }, (_, i) => `m-a/${i}.jpg`);
    const { fake, accountPurgeService } = await setup({
      matches: [{ id: 'm-a', user1_id: UID, user2_id: OTHER }],
    }, { storage: { 'chat-media': [...many, 'm-z/keep.jpg'] } });

    await accountPurgeService.hardDeleteUser(UID);

    expect(fake.storageFiles('chat-media')).toEqual(['m-z/keep.jpg']);
  });

  it.each(['list', 'remove'] as const)(
    'bir sohbet klasorunde %s hatasi digerlerini durdurmaz',
    async (op) => {
      // Hata aninda `break` yerine `return` yazilirsa sonraki eslesmelerin medyasi kalir.
      const { fake, accountPurgeService } = await setup({
        matches: [
          { id: 'm-a', user1_id: UID, user2_id: OTHER },
          { id: 'm-b', user1_id: THIRD, user2_id: UID },
        ],
      }, {
        storage: { 'chat-media': ['m-a/1.jpg', 'm-b/2.jpg'] },
        storageFailOn: [{ bucket: 'chat-media', op, times: 1 }],
      });

      await accountPurgeService.hardDeleteUser(UID);

      expect(fake.storageFiles('chat-media')).toEqual(['m-a/1.jpg']);
    },
  );

  it('eslesmeler okunamazsa hicbir sey silinmeden durur — medya sahipsiz kalmasin', async () => {
    const { fake, accountPurgeService } = await setup({
      matches: [{ id: 'm-a', user1_id: UID, user2_id: OTHER }],
      questions: [{ id: 'q1', user_id: UID }],
    }, {
      failOn: [{ table: 'matches', op: 'select' }],
      storage: { 'chat-media': ['m-a/1.jpg'] },
    });

    await expect(accountPurgeService.hardDeleteUser(UID)).rejects.toMatchObject({ code: 'SERVER_ERROR' });

    expect(fake.table('users')).toHaveLength(2);
    expect(fake.table('questions')).toHaveLength(1);
    expect(fake.table('matches')).toHaveLength(1);
    expect(fake.storageFiles('chat-media')).toEqual(['m-a/1.jpg']);
  });

  it('kullanici satiri silinemezse sohbet medyasina dokunulmaz — sohbet hala duruyor olabilir', async () => {
    // Medya ancak kullanici satiri silindikten sonra temizlenir: CASCADE o noktada
    // eslesmenin ve mesajlarin gittigini garanti eder.
    const { fake, accountPurgeService } = await setup({
      matches: [{ id: 'm-a', user1_id: UID, user2_id: OTHER }],
    }, {
      failOn: [{ table: 'users', op: 'delete' }],
      storage: { 'chat-media': ['m-a/1.jpg'] },
    });

    await expect(accountPurgeService.hardDeleteUser(UID)).rejects.toMatchObject({ code: 'SERVER_ERROR' });

    expect(fake.storageFiles('chat-media')).toEqual(['m-a/1.jpg']);
  });

  it('bir cocuk tablo silinemezse akis durmaz — sonraki tablolar ve kullanici yine silinir', async () => {
    // notifications listede ikinci, refresh_tokens son: hata `break`'e donerse
    // aradaki 22 tablo atlanir. Son tabloyu dogrulamak bunu yakalar.
    const { fake, accountPurgeService } = await setup(
      {
        notifications: [{ id: 'n1', user_id: UID }],
        refresh_tokens: [{ id: 'r1', user_id: UID }, { id: 'r2', user_id: OTHER }],
      },
      { failOn: [{ table: 'notifications', op: 'delete' }] },
    );

    await accountPurgeService.hardDeleteUser(UID);

    expect(fake.table('refresh_tokens').map((r) => r.id)).toEqual(['r2']);
    expect(fake.table('users').map((u) => u.id)).toEqual([OTHER]);
  });

  it('aktif (soft-delete edilmemis) hesap reddedilir — hicbir sey silinmez', async () => {
    // Servis public: yanlis bir cagiran aktif bir hesabi geri donussuz silemesin.
    const { fake, accountPurgeService } = await setup({
      users: [{ id: UID, is_deleted: false }, { id: OTHER, is_deleted: false }],
      questions: [{ id: 'q1', user_id: UID }],
    }, { storage: { photos: [`${UID}/a.jpg`] } });

    await expect(accountPurgeService.hardDeleteUser(UID)).rejects.toMatchObject({ code: 'SERVER_ERROR' });

    expect(fake.table('users')).toHaveLength(2);
    expect(fake.table('questions')).toHaveLength(1);
    expect(fake.storageFiles('photos')).toHaveLength(1);
  });

  it('kullanici satiri silinemezse SERVER_ERROR firlatir', async () => {
    const { accountPurgeService } = await setup({}, { failOn: [{ table: 'users', op: 'delete' }] });

    await expect(accountPurgeService.hardDeleteUser(UID)).rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('gecersiz UUID reddedilir — PostgREST .or() filtresine ham string girmesin', async () => {
    const { fake, accountPurgeService } = await setup({
      quiz_sessions: [{ id: 'qs1', solver_id: OTHER, target_id: THIRD }],
    });

    await expect(accountPurgeService.hardDeleteUser(`${UID},target_id.neq.x`)).rejects.toThrow();
    expect(fake.table('users')).toHaveLength(2);
    expect(fake.table('quiz_sessions')).toHaveLength(1);
  });
});
