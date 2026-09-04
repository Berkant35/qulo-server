import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';

/**
 * Profil detayindaki mesafe: iki tarafin da koordinati varsa km (1 ondalik),
 * yoksa NULL. Eskiden bilinmeyen mesafe 0 (hatta NaN) donuyor, istemci bunu
 * "yakinda" diye gosteriyordu — yanlis bilgi.
 */

const ME = '11111111-1111-4111-8111-111111111111';
const HER = '22222222-2222-4222-8222-222222222222';

const user = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: 'Ada', age: 27, bio: null, city: null, country: null, photos: [],
  relationship_goal: null, is_online: false, last_seen_at: null, profile_completion: 50,
  boost_until: null, lat: 41.0, lng: 29.0, passport_lat: null, passport_lng: null,
  is_deleted: false, ...over,
});

async function setup(seed: Tables) {
  const fake = createFakeSupabase({
    users: [], blocks: [], user_details: [], matches: [], questions: [], ...seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { userService } = await import('../../src/services/user.service.js');
  return { fake, userService };
}

beforeEach(() => {
  vi.resetModules();
});

describe('userService.getPublicProfile — distance_km', () => {
  it('iki tarafin da konumu varsa km hesaplar, 1 ondalik', async () => {
    const { userService } = await setup({ users: [user(ME), user(HER, { lng: 29.1 })] });

    const profile = await userService.getPublicProfile(ME, HER);

    // 41° enleminde 0.1° boylam farki ≈ 8.4 km (haversine).
    expect(profile.distance_km).toBe(8.4);
  });

  it('hedefin konumu yoksa null — "yakinda" yanilgisi olmasin', async () => {
    const { userService } = await setup({ users: [user(ME), user(HER, { lat: null, lng: null })] });

    const profile = await userService.getPublicProfile(ME, HER);

    expect(profile.distance_km).toBeNull();
  });

  it('istekcinin konumu yoksa null', async () => {
    const { userService } = await setup({ users: [user(ME, { lat: null, lng: null }), user(HER)] });

    const profile = await userService.getPublicProfile(ME, HER);

    expect(profile.distance_km).toBeNull();
  });

  it('pasaport yarim kayitliysa (sadece lat) gercek konumdan olcer — melez nokta yok', async () => {
    const { userService } = await setup({
      users: [user(ME, { passport_lat: 52.0, passport_lng: null }), user(HER, { lng: 29.1 })],
    });

    const profile = await userService.getPublicProfile(ME, HER);

    expect(profile.distance_km).toBe(8.4);
  });

  it('pasaport konumu varsa oradan olcer', async () => {
    const { userService } = await setup({
      users: [user(ME, { passport_lat: 41.0, passport_lng: 29.1 }), user(HER)],
    });

    const profile = await userService.getPublicProfile(ME, HER);

    expect(profile.distance_km).toBe(8.4);
  });
});
