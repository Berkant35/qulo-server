import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type FailureSpec } from '../helpers/fake-supabase.js';

/**
 * emailVerifiedGuard + önbelleği: doğrulanmış sonuç süreç içinde tutulur (mesaj başına +1 Supabase
 * isteği olmasın, bkz. supabase-cost-guard), doğrulanmamış sonuç tutulmaz (doğrulayınca kapı açılsın).
 */
const U1 = '11111111-1111-4111-8111-111111111111';

async function setup(opts: { verified: boolean | null; failOn?: FailureSpec[] }) {
  const fake = createFakeSupabase(
    { users: [{ id: U1, email: 'a@qulo.test', email_verified: opts.verified, is_deleted: false }] },
    { failOn: opts.failOn },
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { emailVerifiedGuard } = await import('../../src/middleware/emailVerifiedGuard.js');

  const istek = async (userId: string | null = U1) => {
    const req = { user: userId ? { userId, email: 'a@qulo.test' } : undefined } as unknown as Parameters<typeof emailVerifiedGuard>[0];
    const next = vi.fn();
    await emailVerifiedGuard(req, {} as Parameters<typeof emailVerifiedGuard>[1], next);
    const hata = next.mock.calls[0]?.[0] as { code?: string; statusCode?: number } | undefined;
    return { gecti: next.mock.calls.length === 1 && hata === undefined, kod: hata?.code, status: hata?.statusCode };
  };
  const okumalar = () => fake.queries.filter((q) => q.table === 'users' && q.op === 'select').length;
  return { fake, istek, okumalar };
}

beforeEach(() => vi.resetModules());

describe('emailVerifiedGuard', () => {
  it('doğrulanmış kullanıcı geçer', async () => {
    const { istek } = await setup({ verified: true });
    expect((await istek()).gecti).toBe(true);
  });

  it('doğrulanmamış kullanıcı 403 EMAIL_VERIFICATION_REQUIRED alır', async () => {
    const { istek } = await setup({ verified: false });
    expect(await istek()).toEqual({ gecti: false, kod: 'EMAIL_VERIFICATION_REQUIRED', status: 403 });
  });

  it('email_verified NULL (eski satır) doğrulanmamış sayılır', async () => {
    const { istek } = await setup({ verified: null });
    expect((await istek()).kod).toBe('EMAIL_VERIFICATION_REQUIRED');
  });

  it('kimliksiz istek INVALID_TOKEN (authMiddleware atlanmışsa bile kapı açılmaz)', async () => {
    const { istek } = await setup({ verified: true });
    expect((await istek(null)).kod).toBe('INVALID_TOKEN');
  });

  it('doğrulanmış kullanıcının ardışık istekleri tek users okuması yapar', async () => {
    const { istek, okumalar } = await setup({ verified: true });
    await istek();
    await istek();
    await istek();
    expect(okumalar()).toBe(1);
  });

  it('olumlu sonuç 1 saat (EMAIL_VERIFIED_TTL_MS) tutulur, sonra yeniden okunur', async () => {
    vi.useFakeTimers();
    try {
      const { istek, okumalar } = await setup({ verified: true });
      const { EMAIL_VERIFIED_TTL_MS } = await import('../../src/services/email-verification.service.js');
      expect(EMAIL_VERIFIED_TTL_MS).toBe(60 * 60_000);
      await istek();
      vi.advanceTimersByTime(EMAIL_VERIFIED_TTL_MS - 1);
      await istek();
      expect(okumalar()).toBe(1);
      vi.advanceTimersByTime(1);
      await istek();
      expect(okumalar()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('doğrulanmamış sonuç önbelleğe yazılmaz: doğrulayınca bir sonraki istek geçer', async () => {
    const { istek, fake, okumalar } = await setup({ verified: false });
    expect((await istek()).gecti).toBe(false);
    fake.table('users')[0].email_verified = true;
    expect((await istek()).gecti).toBe(true);
    expect(okumalar()).toBe(2);
  });

  it('okuma hatası fail-closed: SERVER_ERROR; kesinti geçince bir sonraki istek yeniden okuyup geçer', async () => {
    const { istek } = await setup({ verified: true, failOn: [{ table: 'users', op: 'select', times: 1 }] });
    expect((await istek()).kod).toBe('SERVER_ERROR');
    // Kesinti geçince ilk istek yeniden okur ve geçer.
    expect((await istek()).gecti).toBe(true);
  });
});
