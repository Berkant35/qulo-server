import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/**
 * Ban tek yol: bayraklar + eslesmeler kapanir + kullaniciya dilinde e-posta (itiraz token'li).
 * E-posta hatasi ban'i geri almaz; itiraz gonderimi token'i bir kez kullanir ve admin'e e-posta duser.
 */
async function setup(opts: { user?: Record<string, unknown>; sendFails?: boolean; appeals?: Record<string, unknown>[] } = {}) {
  const fake = createFakeSupabase({
    users: [opts.user ?? { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.co', name: 'Ali', locale: 'tr', is_deleted: false, is_banned: false }],
    matches: [
      { id: 'm1', user1_id: '11111111-1111-4111-8111-111111111111', user2_id: 'u2', is_active: true },
      { id: 'm2', user1_id: 'u3', user2_id: '11111111-1111-4111-8111-111111111111', is_active: true },
      { id: 'm3', user1_id: 'u3', user2_id: 'u2', is_active: true },
    ],
    ban_appeals: opts.appeals ?? [],
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const sendEmail = vi.fn(async () => (opts.sendFails ? Promise.reject(new Error('smtp down')) : 'msg-1'));
  vi.doMock('../../src/utils/gmail.js', () => ({ sendEmail }));
  vi.doMock('../../src/config/env.js', () => ({
    env: { API_BASE_URL: 'https://api.test', EMAIL_FROM: 'info@test', BAN_APPEAL_NOTIFY_EMAIL: 'admin@test' },
  }));
  const mod = await import('../../src/services/ban.service.js');
  return { mod, fake, sendEmail };
}

beforeEach(() => vi.resetModules());

describe('banService.banUser', () => {
  it('bayraklari yazar, yalniz kullanicinin eslesmelerini kapatir, itiraz token\'i olusturur, dilinde e-posta gonderir', async () => {
    const { mod, fake, sendEmail } = await setup();
    await mod.banService.banUser('11111111-1111-4111-8111-111111111111', 'sexual_content', 'photo_moderation: x');

    const u = fake.table('users')[0];
    expect(u).toMatchObject({ is_banned: true, ban_reason: 'photo_moderation: x' });
    expect(u.banned_at).toBeTruthy();
    expect(fake.table('matches').map((m) => m.is_active)).toEqual([false, false, true]);

    const appeal = fake.table('ban_appeals')[0];
    expect(appeal).toMatchObject({ user_id: '11111111-1111-4111-8111-111111111111', ban_reason: 'photo_moderation: x' });
    expect(appeal.token).toMatch(/^[0-9a-f]{64}$/);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = (sendEmail.mock.calls as unknown as unknown[][])[0]![0] as { to: string; subject: string; html: string; text: string };
    expect(arg.to).toBe('a@b.co');
    expect(arg.subject).toBe('Qulo hesabın askıya alındı');
    expect(arg.html).toContain(`https://api.test/ban-appeal?token=${appeal.token}`);
    expect(arg.html).toContain('Çıplaklık veya cinsel içerik');
    expect(arg.text).toContain(appeal.token);
  });

  it('guidelines gerekcesi e-postada genel ihlal metnini kullanir; bilinmeyen locale -> en', async () => {
    const { mod, sendEmail } = await setup({ user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.co', locale: 'xx', is_deleted: false, is_banned: false } });
    await mod.banService.banUser('11111111-1111-4111-8111-111111111111', 'guidelines', 'Banned by admin');
    const arg = (sendEmail.mock.calls as unknown as unknown[][])[0]![0] as { subject: string; html: string };
    expect(arg.subject).toBe('Your Qulo account has been suspended');
    expect(arg.html).toContain('Violation of the community guidelines.');
  });

  it('e-posta gonderimi patlasa da ban kalir ve true doner', async () => {
    const { mod, fake } = await setup({ sendFails: true });
    await expect(mod.banService.banUser('11111111-1111-4111-8111-111111111111', 'guidelines', 'r')).resolves.toBe(true);
    expect(fake.table('users')[0].is_banned).toBe(true);
  });

  it('idempotent: zaten banli kullanicida false doner, e-posta/token/eslesme islemi YOK', async () => {
    const { mod, fake, sendEmail } = await setup({ user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.co', locale: 'tr', is_deleted: false, is_banned: true, ban_reason: 'eski' } });
    expect(await mod.banService.banUser('11111111-1111-4111-8111-111111111111', 'guidelines', 'yeni')).toBe(false);
    expect(fake.table('users')[0].ban_reason).toBe('eski');
    expect(fake.table('matches').every((m) => m.is_active)).toBe(true);
    expect(fake.table('ban_appeals')).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('test hesabina (sahte adres) e-posta ve token yok, ban yazilir', async () => {
    const { mod, fake, sendEmail } = await setup({ user: { id: '11111111-1111-4111-8111-111111111111', email: 'x@qulo.test', locale: 'tr', is_deleted: false, is_banned: false, is_test_account: true } });
    await mod.banService.banUser('11111111-1111-4111-8111-111111111111', 'guidelines', 'r');
    expect(fake.table('users')[0].is_banned).toBe(true);
    expect(fake.table('ban_appeals')).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('silinmis veya e-postasiz kullaniciya e-posta ve token yok, ban yine yazilir', async () => {
    const { mod, fake, sendEmail } = await setup({ user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.co', locale: 'tr', is_deleted: true, is_banned: false } });
    await mod.banService.banUser('11111111-1111-4111-8111-111111111111', 'guidelines', 'r');
    expect(fake.table('users')[0].is_banned).toBe(true);
    expect(fake.table('ban_appeals')).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('users.update hatasi firlatir (cagiran SERVER_ERROR\'a cevirir)', async () => {
    vi.doMock('../../src/utils/gmail.js', () => ({ sendEmail: vi.fn() }));
    const kirik = createFakeSupabase({ users: [{ id: '11111111-1111-4111-8111-111111111111' }] }, { failOn: [{ table: 'users', op: 'update' }] });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: kirik.client }));
    const { banService } = await import('../../src/services/ban.service.js');
    await expect(banService.banUser('11111111-1111-4111-8111-111111111111', 'guidelines', 'r')).rejects.toThrow(/ban update failed/);
  });
});

describe('banService.unbanUser', () => {
  it('bayraklari temizler ve acik itirazlari resolved yapar', async () => {
    const { mod, fake } = await setup({
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.co', is_banned: true, banned_at: 'x', ban_reason: 'r', is_deleted: false },
      appeals: [{ id: 'a1', user_id: '11111111-1111-4111-8111-111111111111', token: 't', created_at: new Date().toISOString(), status: 'submitted' }, { id: 'a2', user_id: 'u9', token: 't9', created_at: new Date().toISOString(), status: 'pending' }],
    });
    await mod.banService.unbanUser('11111111-1111-4111-8111-111111111111');
    expect(fake.table('users')[0]).toMatchObject({ is_banned: false, banned_at: null, ban_reason: null });
    expect(fake.table('ban_appeals').map((a) => a.status)).toEqual(['resolved', 'pending']);
  });
});

describe('banService.findAppeal', () => {
  it('30 gunden eski token gecersiz (null), yeni token doner', async () => {
    const eski = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const { mod } = await setup({ appeals: [
      { id: 'a1', user_id: 'x', token: 'eski', ban_reason: 'r', status: 'pending', created_at: eski },
      { id: 'a2', user_id: 'x', token: 'yeni', ban_reason: 'r', status: 'pending', created_at: new Date().toISOString() },
    ] });
    expect(await mod.banService.findAppeal('eski')).toBeNull();
    expect((await mod.banService.findAppeal('yeni'))?.id).toBe('a2');
    expect(await mod.banService.submitAppeal('eski', 'm')).toBe(false);
  });

  it('gecersiz userId (UUID degil) ban yazmadan firlatir', async () => {
    const { mod, fake } = await setup();
    await expect(mod.banService.banUser('u1', 'guidelines', 'r')).rejects.toThrow(/gecersiz userId/);
    expect(fake.table('users')[0].is_banned).toBe(false);
  });
});

describe('banService.submitAppeal', () => {
  it('pending token: submitted olur, mesaj kirpilir, admin\'e e-posta gider', async () => {
    const { mod, fake, sendEmail } = await setup({
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.co', name: 'Ali', banned_at: '2026-09-25', is_deleted: false },
      appeals: [{ id: 'a1', user_id: '11111111-1111-4111-8111-111111111111', token: 'tok', created_at: new Date().toISOString(), ban_reason: 'photo', status: 'pending' }],
    });
    const uzun = 'x'.repeat(mod.APPEAL_MESSAGE_MAX + 50);
    expect(await mod.banService.submitAppeal('tok', `  ${uzun}`)).toBe(true);
    const row = fake.table('ban_appeals')[0];
    expect(row.status).toBe('submitted');
    expect(row.message).toHaveLength(mod.APPEAL_MESSAGE_MAX);
    expect(row.submitted_at).toBeTruthy();
    const arg = (sendEmail.mock.calls as unknown as unknown[][])[0]![0] as { to: string; subject: string; html: string; text: string };
    expect(arg.to).toBe('admin@test');
    expect(arg.subject).toContain('a@b.co');
    expect(arg.html).toContain('https://api.test/admin/users/11111111-1111-4111-8111-111111111111');
    expect(arg.text).toContain('photo');
  });

  it('bos mesaj null yazilir', async () => {
    const { mod, fake } = await setup({ appeals: [{ id: 'a1', user_id: '11111111-1111-4111-8111-111111111111', token: 'tok', created_at: new Date().toISOString(), ban_reason: 'r', status: 'pending' }] });
    await mod.banService.submitAppeal('tok', '   ');
    expect(fake.table('ban_appeals')[0].message).toBeNull();
  });

  it('zaten gonderilmis token ikinci kez kabul edilmez, admin e-postasi gitmez', async () => {
    const { mod, sendEmail } = await setup({ appeals: [{ id: 'a1', user_id: '11111111-1111-4111-8111-111111111111', token: 'tok', created_at: new Date().toISOString(), ban_reason: 'r', status: 'submitted' }] });
    expect(await mod.banService.submitAppeal('tok', 'tekrar')).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('admin e-postasi patlasa da itiraz kaydi kalir ve true doner', async () => {
    const { mod, fake } = await setup({ sendFails: true, appeals: [{ id: 'a1', user_id: '11111111-1111-4111-8111-111111111111', token: 'tok', created_at: new Date().toISOString(), ban_reason: 'r', status: 'pending' }] });
    expect(await mod.banService.submitAppeal('tok', 'm')).toBe(true);
    expect(fake.table('ban_appeals')[0].status).toBe('submitted');
  });
});
