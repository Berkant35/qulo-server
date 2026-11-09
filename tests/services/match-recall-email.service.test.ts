import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase, type FailureSpec, type Tables } from '../helpers/fake-supabase.js';

const NOW = new Date('2026-11-09T16:00:00.000Z');
const H = 3600 * 1000;
const TEXT = { title: 'Biri sorularını çözdü', body: 'Selin sorularının hepsini doğru bildi.' };

function tables(user: Record<string, unknown> = {}, tokens: Array<Record<string, unknown>> = []): Tables {
  return {
    users: [{ id: 'T', email: 't@example.com', locale: 'tr', email_notifications_enabled: true, email_verified: true, is_deleted: false, ...user }],
    email_unsubscribe_tokens: tokens,
  };
}

async function setup(t: Tables, opts: { sendResult?: string | null; sendThrows?: boolean; failOn?: FailureSpec[] } = {}) {
  const fake = createFakeSupabase(t, { failOn: opts.failOn });
  const sendEmail = opts.sendThrows ? vi.fn().mockRejectedValue(new Error('gmail down')) : vi.fn().mockResolvedValue(opts.sendResult === undefined ? 'mid' : opts.sendResult);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  vi.doMock('../../src/utils/gmail.js', () => ({ sendEmail }));
  const { matchRecallEmailService, MATCH_RECALL_EMAIL_TYPE } = await import('../../src/services/match-recall-email.service.js');
  return { fake, sendEmail, svc: matchRecallEmailService, MATCH_RECALL_EMAIL_TYPE };
}

beforeEach(() => vi.resetModules());

/** prepare + deliver — motorun kullandigi sira. */
async function send(svc: Awaited<ReturnType<typeof setup>>['svc'], userId = 'T') {
  const p = await svc.prepare(userId, NOW);
  if (!p.ok) return { sent: false, reason: p.reason };
  return (await svc.deliver(p.target, TEXT)) ? { sent: true } : { sent: false, reason: 'send_failed' };
}

describe('matchRecallEmailService ("seni cozduler" e-posta yedegi)', () => {
  it('gonderir: push metni konu/govde, kullanicinin dilinde, match_recall token\'i', async () => {
    const { svc, sendEmail, fake, MATCH_RECALL_EMAIL_TYPE } = await setup(tables());
    expect(await send(svc)).toEqual({ sent: true });
    const mail = sendEmail.mock.calls[0]![0];
    expect(mail.subject).toBe(TEXT.title);
    expect(mail.text).toContain(TEXT.body);
    expect(mail.html).toContain('lang="tr"');
    expect(fake.table('email_unsubscribe_tokens')[0]).toMatchObject({ user_id: 'T', email_type: MATCH_RECALL_EMAIL_TYPE });
  });

  it('e-posta tercihi kapali (false ya da null) → email_opt_out, token uretilmez', async () => {
    const { svc, sendEmail, fake } = await setup(tables({ email_notifications_enabled: false }));
    expect(await svc.prepare('T', NOW)).toEqual({ ok: false, reason: 'email_opt_out' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(fake.table('email_unsubscribe_tokens')).toHaveLength(0);
    vi.resetModules();
    expect(await (await setup(tables({ email_notifications_enabled: null }))).svc.prepare('T', NOW)).toEqual({ ok: false, reason: 'email_opt_out' });
  });

  it('dogrulanmamis adres → email_unverified (baskasinin adresiyle acilan hesap)', async () => {
    const { svc } = await setup(tables({ email_verified: false }));
    expect(await svc.prepare('T', NOW)).toEqual({ ok: false, reason: 'email_unverified' });
  });

  it('adres yok → no_email; silinmis hesap → user_not_found', async () => {
    expect(await (await setup(tables({ email: null }))).svc.prepare('T', NOW)).toEqual({ ok: false, reason: 'no_email' });
    vi.resetModules();
    expect(await (await setup(tables({ is_deleted: true }))).svc.prepare('T', NOW)).toEqual({ ok: false, reason: 'user_not_found' });
  });

  it('hedef okunamazsa lookup_failed (sessiz "bulunamadi" degil) ve loglanir', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { svc } = await setup(tables(), { failOn: [{ table: 'users', op: 'select' }] });
    expect(await svc.prepare('T', NOW)).toEqual({ ok: false, reason: 'lookup_failed' });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('son 20 saatte e-posta gittiyse → email_recent; 21 saat once gittiyse gonderir', async () => {
    const recent = [{ token: 'a', user_id: 'T', email_type: 'match_new', created_at: new Date(NOW.getTime() - 19 * H).toISOString(), used_at: null }];
    expect(await (await setup(tables({}, recent))).svc.prepare('T', NOW)).toEqual({ ok: false, reason: 'email_recent' });
    vi.resetModules();
    const old = [{ token: 'a', user_id: 'T', email_type: 'match_new', created_at: new Date(NOW.getTime() - 21 * H).toISOString(), used_at: null }];
    expect(await send((await setup(tables({}, old))).svc)).toEqual({ sent: true });
  });

  it('gecmis okunamazsa (DB hatasi) fail-closed: gondermez', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { svc, sendEmail } = await setup(tables(), { failOn: [{ table: 'email_unsubscribe_tokens', op: 'select' }] });
    expect(await svc.prepare('T', NOW)).toEqual({ ok: false, reason: 'email_recent' });
    expect(sendEmail).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('Gmail yapilandirilmamis (null) ya da hata → deliver false (basari sayilmaz)', async () => {
    expect(await send((await setup(tables(), { sendResult: null })).svc)).toEqual({ sent: false, reason: 'send_failed' });
    vi.resetModules();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await send((await setup(tables(), { sendThrows: true })).svc)).toEqual({ sent: false, reason: 'send_failed' });
    err.mockRestore();
  });
});
