import { describe, it, expect, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';
import type { Row } from '../helpers/fake-supabase.js';

async function boot(users: Row[], opts: { send?: ReturnType<typeof vi.fn>; fcmNull?: boolean } = {}) {
  vi.resetModules();
  const fake = createFakeSupabase({ users, notifications: [], push_messages: [] });
  const send = opts.send ?? vi.fn().mockResolvedValue('msg-1');
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client, ensureStorageBuckets: async () => {} }));
  vi.doMock('../../src/config/firebase.js', () => ({ getFcm: () => (opts.fcmNull ? null : { send }), isFcmAvailable: () => !opts.fcmNull, firebaseAdmin: {} }));
  const { NotificationService } = await import('../../src/services/notification.service.js');
  return { fake, send, NotificationService };
}

const U1: Row = { id: 'u1', push_token: 'tok-1', locale: 'tr', notification_preferences: null };

describe('NotificationService.sendPushDetailed', () => {
  it('basarili gonderim: sent=true, inbox satiri + notification_id, 16-dil sablonu {count} ile dolar', async () => {
    const { fake, send, NotificationService } = await boot([U1]);
    const r = await NotificationService.sendPushDetailed('u1', 'lifecycle_likes_waiting', { count: '3' }, undefined, { actionUrl: '/discover' });
    expect(r.sent).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.title).toBe('Seni beğenenler var 👀');
    expect(r.body).toBe('Sen yokken 3 kişi seni beğendi. Gel bir bak!');
    const inbox = fake.table('notifications');
    expect(inbox).toHaveLength(1);
    expect(r.notificationId).toBe(inbox[0]!.id);
    expect(send.mock.calls[0]![0].data).toMatchObject({ type: 'lifecycle_likes_waiting', action_url: '/discover', notification_id: inbox[0]!.id });
  });

  it('kategori tercihi kapali → pref_disabled, inbox satiri yine yazilir (mevcut davranis), FCM cagrilmaz', async () => {
    const { fake, send, NotificationService } = await boot([{ ...U1, notification_preferences: { campaigns: false } }]);
    const r = await NotificationService.sendPushDetailed('u1', 'lifecycle_winback');
    expect(r).toMatchObject({ sent: false, reason: 'pref_disabled' });
    expect(r.notificationId).toBe(fake.table('notifications')[0]!.id);
    expect(send).not.toHaveBeenCalled();
  });

  it('token yok → no_token; FCM yok → fcm_unavailable; kullanici yok → user_not_found', async () => {
    const a = await boot([{ ...U1, push_token: null }]);
    expect((await a.NotificationService.sendPushDetailed('u1', 'lifecycle_winback')).reason).toBe('no_token');

    const b = await boot([U1], { fcmNull: true });
    expect((await b.NotificationService.sendPushDetailed('u1', 'lifecycle_winback')).reason).toBe('fcm_unavailable');

    const c = await boot([U1]);
    const r = await c.NotificationService.sendPushDetailed('ghost', 'lifecycle_winback');
    expect(r).toMatchObject({ sent: false, reason: 'user_not_found', notificationId: null });
    expect(c.fake.table('notifications')).toHaveLength(0);
  });

  it('{name} bos gelirse dile gore "Birisi" yedegi kullanilir; sendPush sarmalayicisi boolean doner', async () => {
    const { NotificationService } = await boot([U1]);
    const r = await NotificationService.sendPushDetailed('u1', 'lifecycle_match_waiting', { name: '' });
    expect(r.body).toContain('Birisi ile eşleştin');
    expect(await NotificationService.sendPush('u1', 'lifecycle_match_waiting', { name: 'Ayşe' })).toBe(true);
  });

  it('renderPush gondermez ve DB satiri yazmaz; bilinmeyen locale en\'e duser', async () => {
    const { fake, send, NotificationService } = await boot([U1]);
    const r = await NotificationService.renderPush('lifecycle_new_people', 'en', { count: '5' });
    expect(r).toEqual({ title: 'New faces around', body: '5 new people joined this week. Take a look at Discover!' });
    expect(fake.table('notifications')).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });
});
