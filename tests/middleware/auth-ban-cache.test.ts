import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type FailureSpec, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Kimlikli her istek `users.is_banned` okuyordu: API cagrisi basina +1 Supabase istegi
 * (2026-09-28 maliyet incelemesi). Artik 60 sn surec ici onbellek; ban/unban tek yoldan
 * (`banService`) gecer ve onbellegi aninda temizler.
 */
const U1 = '11111111-1111-4111-8111-111111111111';

async function setup(opts: { banned?: boolean; failOn?: FailureSpec[]; holdRead?: FakeSupabaseOptions['holdRead'] } = {}) {
  const fake = createFakeSupabase(
    {
      users: [{
        id: U1, email: 'a@b.co', name: 'Ali', locale: 'tr',
        is_deleted: false, is_banned: opts.banned ?? false,
        // Test hesabi: banUser e-posta gondermez (sendBanNotice erken doner).
        is_test_account: true,
      }],
      matches: [],
      ban_appeals: [],
    },
    { failOn: opts.failOn, holdRead: opts.holdRead },
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  vi.doMock('../../src/utils/gmail.js', () => ({ sendEmail: vi.fn(async () => 'msg-1') }));
  const { authMiddleware } = await import('../../src/middleware/auth.js');
  const { banService } = await import('../../src/services/ban.service.js');
  const { signAccessToken } = await import('../../src/utils/jwt.js');
  const { banStatusService } = await import('../../src/services/ban-status.service.js');
  const token = signAccessToken({ userId: U1, email: 'a@b.co' });

  const istek = async () => {
    const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Parameters<typeof authMiddleware>[0];
    const next = vi.fn();
    await authMiddleware(req, {} as Parameters<typeof authMiddleware>[1], next);
    const hata = next.mock.calls[0]?.[0] as { code?: string } | undefined;
    return { gecti: next.mock.calls.length === 1 && hata === undefined, kod: hata?.code };
  };
  const banOkumalari = () => fake.queries.filter((q) => q.table === 'users' && q.op === 'select').length;
  return { fake, istek, banOkumalari, banService, banStatusService };
}

beforeEach(() => vi.resetModules());

describe('authMiddleware ban kontrolu onbellegi', () => {
  it('ayni kullanicinin ardisik istekleri tek ban okumasi yapar', async () => {
    const { istek, banOkumalari } = await setup();
    expect((await istek()).gecti).toBe(true);
    expect((await istek()).gecti).toBe(true);
    expect((await istek()).gecti).toBe(true);
    expect(banOkumalari()).toBe(1);
  });

  it('banli kullanici ACCOUNT_BANNED alir', async () => {
    const { istek } = await setup({ banned: true });
    expect(await istek()).toEqual({ gecti: false, kod: 'ACCOUNT_BANNED' });
  });

  it('banUser sonrasi bir sonraki istek aninda reddedilir — onbellek beklenmez', async () => {
    const { istek, banService } = await setup();
    expect((await istek()).gecti).toBe(true);

    await banService.banUser(U1, 'guidelines', 'admin: test');

    expect(await istek()).toEqual({ gecti: false, kod: 'ACCOUNT_BANNED' });
  });

  it('unbanUser sonrasi bir sonraki istek aninda kabul edilir', async () => {
    const { istek, banService } = await setup({ banned: true });
    expect((await istek()).kod).toBe('ACCOUNT_BANNED');

    await banService.unbanUser(U1);

    expect((await istek()).gecti).toBe(true);
  });

  it('panel disi (SQL) ban en gec 60 sn icinde isler', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const T0 = new Date('2026-09-28T10:00:00Z').getTime();
      // Saat token imzalanmadan ONCE kurulur: 15 dk'lik access token sahte saate gore gecerli olsun.
      vi.setSystemTime(T0);
      const { fake, istek } = await setup();

      expect((await istek()).gecti).toBe(true);
      fake.table('users')[0].is_banned = true;

      vi.setSystemTime(T0 + 30_000);
      expect((await istek()).gecti).toBe(true);

      vi.setSystemTime(T0 + 60_000);
      expect((await istek()).kod).toBe('ACCOUNT_BANNED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('okuma hatasi istegi durdurmaz ve onbellege YAZILMAZ — sonraki istek yeniden okur', async () => {
    // Mevcut davranis korunur (okuma hatasinda istek gecer); hata sonucu 60 sn boyunca
    // "banli degil" diye sabitlenmemeli.
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { istek, banOkumalari } = await setup({ failOn: [{ table: 'users', op: 'select' }] });
    expect((await istek()).gecti).toBe(true);
    expect((await istek()).gecti).toBe(true);
    expect(banOkumalari()).toBe(2);
    // Kesinti sessiz degil: ban kontrolu fiilen devre disiyken log dusmeli.
    expect(log).toHaveBeenCalledWith('[auth] ban durumu okunamadi:', expect.any(String));
    log.mockRestore();
  });
  it('ban aninda suren okuma eski "banli degil" degerini onbellege GERI YAZAMAZ (yaris)', async () => {
    // Review 2026-09-28'de yeniden uretildi: banlanan kullanicinin o anki istegi ban'dan once
    // okumaya baslamis, cevabi ban + temizlikten sonra gelmisti; eski deger 60 sn geri yaziliyordu.
    let ac: () => void = () => undefined;
    const kapi = new Promise<void>((r) => { ac = r; });
    const { fake, banService, banStatusService, istek } = await setup({ holdRead: { table: 'users', until: kapi } });

    const surenOkuma = banStatusService.isBanned(U1);      // anlik goruntu: banli degil
    await banService.banUser(U1, 'guidelines', 'admin: test');
    ac();
    expect(await surenOkuma).toBe(false);                   // o istek eski degeri gorur (kacinilmaz)
    expect(fake.table('users')[0].is_banned).toBe(true);

    expect(await istek()).toEqual({ gecti: false, kod: 'ACCOUNT_BANNED' });
  });
});
