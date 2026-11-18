import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/**
 * 2.2.0 B2: profil tamamlama ödülleri 5/15/30/50 → 2/3/5/10. Miktarlar ekonomi config'ten
 * (`rewards.milestones`), config okunamazsa `DEFAULT_PROFILE_MILESTONES`. Her eşik kişi başı tek sefer
 * (`completion_rewards_claimed` + `milestone_<eşik>` referansı) — yeni değerler geriye dönük ödül açmaz.
 */

// 16/16 alan dolu → %100 (tüm eşikler geçilir)
const fullUser = (over: Record<string, unknown> = {}) => ({
  id: 'u1', name: 'A', surname: 'B', bio: 'x', city: 'İzmir', lat: 1, lng: 2,
  photos: ['a', 'b', 'c'], relationship_goal: 'SERIOUS', preferred_languages: ['tr'],
  completion_rewards_claimed: {}, ...over,
});
const fullDetails = { user_id: 'u1', height: 1, weight: 1, zodiac: 'a', job: 'a', school: 'a', smoking: 'a', alcohol: 'a' };

async function run(opts: {
  user?: Record<string, unknown>;
  milestones?: Record<string, number> | 'throw';
}) {
  vi.resetModules();
  const fake = createFakeSupabase({ users: [fullUser(opts.user)], user_details: [fullDetails] });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const addPurple = vi.fn(async (_u: string, _a: number, _r: string, _ref?: string): Promise<void> => undefined);
  vi.doMock('../../src/services/diamond.service.js', () => ({ diamondService: { addPurple } }));
  vi.doMock('../../src/services/referral.service.js', () => ({ referralService: { checkAndReward: async () => undefined } }));
  vi.doMock('../../src/services/economy-config.service.js', () => ({
    economyConfigService: {
      getConfig: async () => {
        if (opts.milestones === 'throw') throw new Error('No active economy config found');
        return { rewards: { milestones: opts.milestones } };
      },
    },
  }));
  const { userService } = await import('../../src/services/user.service.js');
  await (userService as any).recalculateProfileCompletion('u1');
  return { fake, addPurple };
}

beforeEach(() => vi.clearAllMocks());

describe('profil tamamlama kilometre taşları (2.2.0: 2/3/5/10)', () => {
  it('config 2/3/5/10 iken %100 profil dört eşiği yeni miktarlarla öder (toplam 20) ve referans anahtarları milestone_<eşik>', async () => {
    const { addPurple, fake } = await run({ milestones: { '25': 2, '50': 3, '75': 5, '100': 10 } });

    expect(addPurple.mock.calls).toEqual([
      ['u1', 2, 'PROFILE_COMPLETION', 'milestone_25'],
      ['u1', 3, 'PROFILE_COMPLETION', 'milestone_50'],
      ['u1', 5, 'PROFILE_COMPLETION', 'milestone_75'],
      ['u1', 10, 'PROFILE_COMPLETION', 'milestone_100'],
    ]);
    expect(fake.table('users')[0].completion_rewards_claimed).toEqual({ '25': true, '50': true, '75': true, '100': true });
    expect(fake.table('users')[0].boost_until).toBeTruthy(); // %100 boost'u değişmedi
  });

  it('config okunamazsa yedek sabitler de 2/3/5/10', async () => {
    const { addPurple } = await run({ milestones: 'throw' });
    expect(addPurple.mock.calls.map((c) => c[1])).toEqual([2, 3, 5, 10]);
  });

  it('canlı config hâlâ eski 5/15/30/50 ise onu uygular (değer kaynağı config; 087 yayında devreye girer, K4)', async () => {
    const { addPurple } = await run({ milestones: { '25': 5, '50': 15, '75': 30, '100': 50 } });
    expect(addPurple.mock.calls.map((c) => c[1])).toEqual([5, 15, 30, 50]);
  });

  it('daha önce tüm ödülleri almış kullanıcıya yeni değerlerle TEKRAR ödül yok', async () => {
    const { addPurple } = await run({
      milestones: { '25': 2, '50': 3, '75': 5, '100': 10 },
      user: { completion_rewards_claimed: { '25': true, '50': true, '75': true, '100': true } },
    });
    expect(addPurple).not.toHaveBeenCalled();
  });

  it('kısmen almış kullanıcı yalnız kalan eşikleri yeni miktarla alır (eskiden alınan 25/50 geri alınmaz, tekrar verilmez)', async () => {
    const { addPurple, fake } = await run({
      milestones: { '25': 2, '50': 3, '75': 5, '100': 10 },
      user: { completion_rewards_claimed: { '25': true, '50': true } },
    });
    expect(addPurple.mock.calls.map((c) => [c[1], c[3]])).toEqual([[5, 'milestone_75'], [10, 'milestone_100']]);
    expect(fake.table('users')[0].completion_rewards_claimed).toEqual({ '25': true, '50': true, '75': true, '100': true });
  });

  it('bir eşiğin ödülü hata verirse o eşik işaretlenmez (sonraki hesaplamada yeniden denenir), diğerleri etkilenmez', async () => {
    vi.resetModules();
    const fake = createFakeSupabase({ users: [fullUser()], user_details: [fullDetails] });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const addPurple = vi.fn(async (_u: string, _a: number, _r: string, ref?: string) => {
      if (ref === 'milestone_50') throw new Error('boom');
    });
    vi.doMock('../../src/services/diamond.service.js', () => ({ diamondService: { addPurple } }));
    vi.doMock('../../src/services/referral.service.js', () => ({ referralService: { checkAndReward: async () => undefined } }));
    vi.doMock('../../src/services/economy-config.service.js', () => ({
      economyConfigService: { getConfig: async () => ({ rewards: { milestones: { '25': 2, '50': 3, '75': 5, '100': 10 } } }) },
    }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { userService } = await import('../../src/services/user.service.js');
    await (userService as any).recalculateProfileCompletion('u1');

    expect(fake.table('users')[0].completion_rewards_claimed).toEqual({ '25': true, '75': true, '100': true });
  });
});
