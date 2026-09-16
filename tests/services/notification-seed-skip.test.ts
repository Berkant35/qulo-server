import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

const SEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GERCEK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function setup() {
  const fake = createFakeSupabase({
    users: [
      { id: SEED, is_seed_profile: true, push_token: null, locale: 'tr', notification_preferences: null },
      { id: GERCEK, is_seed_profile: false, push_token: null, locale: 'tr', notification_preferences: null },
    ],
    notifications: [],
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { NotificationService } = await import('../../src/services/notification.service.js');
  return { fake, NotificationService };
}

beforeEach(() => vi.resetModules());

describe('sendPushDetailed — seed profil kisa devresi', () => {
  it('seed profile inbox satiri YAZMAZ', async () => {
    const { fake, NotificationService } = await setup();
    const r = await NotificationService.sendPushDetailed(SEED, 'new_message', { name: 'Berkant' });
    expect(r).toMatchObject({ sent: false, reason: 'seed_profile', notificationId: null });
    expect(fake.table('notifications')).toHaveLength(0);
  });

  it('gercek kullaniciya satir yazmaya devam eder', async () => {
    const { fake, NotificationService } = await setup();
    await NotificationService.sendPushDetailed(GERCEK, 'new_message', { name: 'Elif' });
    expect(fake.table('notifications').length).toBeGreaterThan(0);
  });
});
