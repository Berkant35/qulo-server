import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Cevrimici durum — gizlilik ve dogruluk.
 *
 * Canli veride dogrulandi (2026-09-10): "takili kalmis cevrimici" kullanici yok
 * (eski son gorulme 0, bos son gorulme 0), yani cron calisiyor. `is_online:true`
 * yazan her yol (heartbeat + iki giris yolu) `last_seen_at`'i de birlikte yaziyor;
 * dolayisiyla `expireInactiveUsers` herkesi yakaliyor. Bu testler o sozlesmeyi
 * donduruyor. Cevrimici durumun KIME gosterildigi ayri dosyada
 * (user.service getPublicProfile: yalnizca eslesilene).
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function setup(seed: Tables = {}, opts?: FakeSupabaseOptions) {
  const fake = createFakeSupabase({ users: [], ...seed }, opts);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { PresenceService } = await import('../../src/services/presence.service.js');
  return { fake, PresenceService };
}

beforeEach(() => {
  vi.resetModules();
});

describe('heartbeat / setOffline', () => {
  it('heartbeat is_online ve last_seen_at alanlarini BIRLIKTE yazar', async () => {
    // Birlikte yazilmasi sart: yalniz is_online yazilsaydi, expire cron'u
    // (`lt last_seen_at`) o kullaniciyi hic yakalayamaz, sonsuza kadar cevrimici kalirdi.
    const { fake, PresenceService } = await setup({
      users: [{ id: A, is_online: false, last_seen_at: minsAgo(60) }],
    });

    await PresenceService.heartbeat(A);

    const u = fake.table('users')[0];
    expect(u.is_online).toBe(true);
    expect(Date.now() - new Date(u.last_seen_at as string).getTime()).toBeLessThan(5_000);
  });

  it('heartbeat yalnizca o kullaniciya dokunur', async () => {
    const { fake, PresenceService } = await setup({
      users: [
        { id: A, is_online: false, last_seen_at: minsAgo(60) },
        { id: B, is_online: false, last_seen_at: minsAgo(60) },
      ],
    });

    await PresenceService.heartbeat(A);

    expect(fake.table('users').find((u) => u.id === B)!.is_online).toBe(false);
  });

  it('setOffline yalnizca o kullaniciyi cevrimdisi yapar', async () => {
    const { fake, PresenceService } = await setup({
      users: [
        { id: A, is_online: true, last_seen_at: minsAgo(1) },
        { id: B, is_online: true, last_seen_at: minsAgo(1) },
      ],
    });

    await PresenceService.setOffline(A);

    const byId = Object.fromEntries(fake.table('users').map((u) => [u.id, u.is_online]));
    expect(byId).toEqual({ [A]: false, [B]: true });
  });

  it('heartbeat DB hatasini yukseltir — route hatayi gorsun', async () => {
    const { PresenceService } = await setup(
      { users: [{ id: A, is_online: false }] },
      { failOn: [{ table: 'users', op: 'update' }] },
    );

    await expect(PresenceService.heartbeat(A)).rejects.toBeTruthy();
  });
});

describe('expireInactiveUsers — cron', () => {
  it('esigi asan cevrimici kullanicilari cevrimdisi yapar, sayisini doner', async () => {
    const { fake, PresenceService } = await setup({
      users: [
        { id: A, is_online: true, last_seen_at: minsAgo(10) }, // eski -> dusmeli
        { id: B, is_online: true, last_seen_at: minsAgo(1) },  // taze -> kalmali
        { id: C, is_online: false, last_seen_at: minsAgo(60) }, // zaten cevrimdisi
      ],
    });

    const expired = await PresenceService.expireInactiveUsers(3);

    expect(expired).toBe(1);
    const byId = Object.fromEntries(fake.table('users').map((u) => [u.id, u.is_online]));
    expect(byId).toEqual({ [A]: false, [B]: true, [C]: false });
  });

  it('esik parametresi uygulanir', async () => {
    const { fake, PresenceService } = await setup({
      users: [{ id: A, is_online: true, last_seen_at: minsAgo(5) }],
    });

    expect(await PresenceService.expireInactiveUsers(10)).toBe(0);
    expect(fake.table('users')[0].is_online).toBe(true);
  });

  it('DB hatasinda 0 doner ve PATLAMAZ — cron durmasin', async () => {
    // Firlatsaydi zamanlanmis gorev her tikte hata verir; kullanicilar o sure
    // boyunca cevrimici gorunmeye devam ederdi.
    const { PresenceService } = await setup(
      { users: [{ id: A, is_online: true, last_seen_at: minsAgo(10) }] },
      { failOn: [{ table: 'users', op: 'update' }] },
    );

    await expect(PresenceService.expireInactiveUsers(3)).resolves.toBe(0);
  });
});
