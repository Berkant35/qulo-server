import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';
import { ReferralService } from '../../src/services/referral.service.js';

/**
 * Davet sistemi — ödül dağıtan yer, yani para.
 * Fixture: referralPurple 20, maxCompletedReferrals 10.
 */
async function setup(seed: Tables = {}) {
  const fake = createFakeSupabase({
    economy_config_versions: [activeConfigRow()],
    ...seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { referralService } = await import('../../src/services/referral.service.js');
  return { fake, referralService };
}

const NOW = new Date('2026-09-01T12:00:00Z');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', name: 'Ada', green_diamonds: 0, purple_diamonds: 0,
  referral_code: 'AAAA2222', is_deleted: false, ...over,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// generateCode saf — supabase gerekmiyor.
describe('generateCode', () => {
  const service = new ReferralService();

  it('8 karakterli kod üretir', () => {
    expect(service.generateCode()).toHaveLength(8);
  });

  it('sadece izin verilen karakterleri kullanır', () => {
    for (let i = 0; i < 50; i++) {
      for (const char of service.generateCode()) {
        expect(CODE_CHARS).toContain(char);
      }
    }
  });

  // Elle okunup yazılan bir kod — I/O/0/1 karışıklığı destek talebi demek.
  it('karıştırılabilir karakterleri (I, O, 0, 1) içermez', () => {
    for (let i = 0; i < 50; i++) {
      const code = service.generateCode();
      for (const char of ['I', 'O', '0', '1']) {
        expect(code).not.toContain(char);
      }
    }
  });

  it('ardışık çağrılarda farklı kodlar üretir', () => {
    const codes = new Set(Array.from({ length: 20 }, () => service.generateCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('generateUniqueCode', () => {
  /** Math.random'ı sabitleyip üretilen kodu deterministik hale getirir. */
  function stubCodes(...codes: string[]) {
    const sequence = codes.flatMap((code) =>
      [...code].map((char) => CODE_CHARS.indexOf(char) / CODE_CHARS.length),
    );
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => sequence[i++] ?? 0);
  }

  it('kullanılmayan kodu döner', async () => {
    const { referralService } = await setup({ users: [] });
    stubCodes('ABCDEFGH');
    await expect(referralService.generateUniqueCode()).resolves.toBe('ABCDEFGH');
  });

  it('kod çakışırsa yeniden üretir', async () => {
    const { referralService } = await setup({
      users: [user({ id: 'u9', referral_code: 'ABCDEFGH' })],
    });
    stubCodes('ABCDEFGH', 'JKLMNPQR');

    await expect(referralService.generateUniqueCode()).resolves.toBe('JKLMNPQR');
  });
});

describe('applyReferralCode', () => {
  it('bekleyen davet kaydı açar ve davet edeni döner', async () => {
    const { fake, referralService } = await setup({
      users: [user({ id: 'ref', name: 'Ada', referral_code: 'AAAA2222' })],
    });

    await expect(referralService.applyReferralCode('yeni', 'AAAA2222')).resolves.toEqual({
      referrerId: 'ref', referrerName: 'Ada',
    });
    expect(fake.table('referrals')[0]).toMatchObject({
      referrer_id: 'ref', referee_id: 'yeni', status: 'pending',
    });
  });

  it('kod büyük/küçük harf duyarsız', async () => {
    const { referralService } = await setup({
      users: [user({ id: 'ref', referral_code: 'AAAA2222' })],
    });
    await expect(referralService.applyReferralCode('yeni', 'aaaa2222')).resolves.toMatchObject({
      referrerId: 'ref',
    });
  });

  it('geçersiz kod reddedilir', async () => {
    const { fake, referralService } = await setup({ users: [user({ id: 'ref' })] });

    await expect(referralService.applyReferralCode('yeni', 'YOKKOD11')).rejects.toMatchObject({
      code: 'INVALID_REFERRAL_CODE',
    });
    expect(fake.table('referrals')).toHaveLength(0);
  });

  it('silinmiş kullanıcının kodu çalışmaz', async () => {
    const { referralService } = await setup({
      users: [user({ id: 'ref', referral_code: 'AAAA2222', is_deleted: true })],
    });
    await expect(referralService.applyReferralCode('yeni', 'AAAA2222')).rejects.toMatchObject({
      code: 'INVALID_REFERRAL_CODE',
    });
  });

  it('kendi kodunu uygulayamaz', async () => {
    const { fake, referralService } = await setup({
      users: [user({ id: 'u1', referral_code: 'AAAA2222' })],
    });

    await expect(referralService.applyReferralCode('u1', 'AAAA2222')).rejects.toMatchObject({
      code: 'SELF_REFERRAL',
    });
    expect(fake.table('referrals')).toHaveLength(0);
  });

  it('zaten daveti olan kullanıcı ikinci kez uygulayamaz', async () => {
    const { fake, referralService } = await setup({
      users: [user({ id: 'ref', referral_code: 'AAAA2222' })],
      referrals: [{ id: 'r1', referrer_id: 'baska', referee_id: 'yeni', status: 'pending' }],
    });

    await expect(referralService.applyReferralCode('yeni', 'AAAA2222')).rejects.toMatchObject({
      code: 'ALREADY_REFERRED',
    });
    expect(fake.table('referrals')).toHaveLength(1);
  });
});

describe('checkAndReward', () => {
  const pending = { id: 'r1', referrer_id: 'ref', referee_id: 'yeni', status: 'pending' };
  const twoUsers = [user({ id: 'ref' }), user({ id: 'yeni', referral_code: 'BBBB3333' })];

  it('profil tamamlanma %60 altındaysa ödül vermez', async () => {
    const { fake, referralService } = await setup({ users: twoUsers, referrals: [{ ...pending }] });

    await referralService.checkAndReward('yeni', 59);

    expect(fake.table('referrals')[0].status).toBe('pending');
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('%60\'ta iki tarafa da ödül verir ve daveti tamamlar', async () => {
    const { fake, referralService } = await setup({ users: twoUsers, referrals: [{ ...pending }] });

    await referralService.checkAndReward('yeni', 60);

    const rows = fake.table('users');
    expect(rows.find((r) => r.id === 'yeni')!.purple_diamonds).toBe(20);
    expect(rows.find((r) => r.id === 'ref')!.purple_diamonds).toBe(20);
    expect(fake.table('referrals')[0]).toMatchObject({
      status: 'completed', referee_rewarded: true, referrer_rewarded: true,
    });
  });

  it('bekleyen davet yoksa hiçbir şey yapmaz', async () => {
    const { fake, referralService } = await setup({ users: twoUsers, referrals: [] });

    await referralService.checkAndReward('yeni', 100);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('zaten tamamlanmış daveti tekrar ödüllendirmez', async () => {
    const { fake, referralService } = await setup({
      users: twoUsers,
      referrals: [{ ...pending, status: 'completed' }],
    });

    await referralService.checkAndReward('yeni', 100);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  /** Aynı anda iki istek gelirse ikisi de ödül vermemeli. */
  it('ikinci çağrı ödülü tekrarlamaz', async () => {
    const { fake, referralService } = await setup({ users: twoUsers, referrals: [{ ...pending }] });

    await referralService.checkAndReward('yeni', 100);
    await referralService.checkAndReward('yeni', 100);

    expect(fake.table('users').find((r) => r.id === 'yeni')!.purple_diamonds).toBe(20);
    expect(fake.table('diamond_transactions')).toHaveLength(2); // referee + referrer, birer kez
  });

  it('davet eden limitine ulaşınca ödül almaz ama davet edilen alır', async () => {
    // Fixture maxCompletedReferrals = 10. Bu tamamlanınca sayaç 11 olacak → limit aşıldı.
    const completed = Array.from({ length: 10 }, (_, i) => ({
      id: `done-${i}`, referrer_id: 'ref', referee_id: `eski-${i}`, status: 'completed',
    }));
    const { fake, referralService } = await setup({
      users: twoUsers,
      referrals: [...completed, { ...pending }],
    });

    await referralService.checkAndReward('yeni', 100);

    const rows = fake.table('users');
    expect(rows.find((r) => r.id === 'yeni')!.purple_diamonds).toBe(20); // davet edilen alır
    expect(rows.find((r) => r.id === 'ref')!.purple_diamonds).toBe(0);   // davet eden almaz
  });

  it('limitin tam sınırında davet eden hâlâ ödül alır', async () => {
    // 9 tamamlanmış + bu → sayaç 10, maxCompleted 10 ile eşit → ödül var.
    const completed = Array.from({ length: 9 }, (_, i) => ({
      id: `done-${i}`, referrer_id: 'ref', referee_id: `eski-${i}`, status: 'completed',
    }));
    const { fake, referralService } = await setup({
      users: twoUsers,
      referrals: [...completed, { ...pending }],
    });

    await referralService.checkAndReward('yeni', 100);
    expect(fake.table('users').find((r) => r.id === 'ref')!.purple_diamonds).toBe(20);
  });

  it('başka davet edenin tamamlanmışları limiti etkilemez', async () => {
    const otherPeoples = Array.from({ length: 20 }, (_, i) => ({
      id: `x-${i}`, referrer_id: 'baskasi', referee_id: `y-${i}`, status: 'completed',
    }));
    const { fake, referralService } = await setup({
      users: twoUsers,
      referrals: [...otherPeoples, { ...pending }],
    });

    await referralService.checkAndReward('yeni', 100);
    expect(fake.table('users').find((r) => r.id === 'ref')!.purple_diamonds).toBe(20);
  });

  it('ödül tutarı config\'ten okunur', async () => {
    const base = activeConfigRow().config;
    const fake = createFakeSupabase({
      economy_config_versions: [activeConfigRow({
        rewards: { ...base.rewards, referralPurple: 55 },
      })],
      users: twoUsers,
      referrals: [{ ...pending }],
    });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { referralService } = await import('../../src/services/referral.service.js');

    await referralService.checkAndReward('yeni', 100);
    expect(fake.table('users').find((r) => r.id === 'yeni')!.purple_diamonds).toBe(55);
  });
});

describe('getStats', () => {
  const mixed = [
    { id: 'a', referrer_id: 'u1', referee_id: 'x1', status: 'completed' },
    { id: 'b', referrer_id: 'u1', referee_id: 'x2', status: 'completed' },
    { id: 'c', referrer_id: 'u1', referee_id: 'x3', status: 'completed' },
    { id: 'd', referrer_id: 'u1', referee_id: 'x4', status: 'pending' },
    { id: 'e', referrer_id: 'baskasi', referee_id: 'x5', status: 'completed' },
  ];

  it('kendi davetlerini sayar, başkasınınkini saymaz', async () => {
    const { referralService } = await setup({ referrals: mixed });

    await expect(referralService.getStats('u1')).resolves.toEqual({
      total: 4, pending: 1, completed: 3, remaining: 7,
    });
  });

  it('hiç daveti olmayan kullanıcı için sıfır ve tam kalan', async () => {
    const { referralService } = await setup({ referrals: [] });
    await expect(referralService.getStats('u1')).resolves.toEqual({
      total: 0, pending: 0, completed: 0, remaining: 10,
    });
  });

  it('limit aşıldığında kalan negatife inmez', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `m${i}`, referrer_id: 'u1', referee_id: `z${i}`, status: 'completed',
    }));
    const { referralService } = await setup({ referrals: many });

    await expect(referralService.getStats('u1')).resolves.toMatchObject({
      completed: 15, remaining: 0,
    });
  });

  it('tam limitte kalan sıfır', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`, referrer_id: 'u1', referee_id: `z${i}`, status: 'completed',
    }));
    const { referralService } = await setup({ referrals: ten });

    await expect(referralService.getStats('u1')).resolves.toMatchObject({ remaining: 0 });
  });
});

describe('getHistory', () => {
  it('davet edilenlerin adlarıyla birlikte döner, en yeni başta', async () => {
    const { referralService } = await setup({
      referrals: [
        { id: 'r1', referrer_id: 'u1', referee_id: 'a', status: 'completed', created_at: '2026-01-01', completed_at: '2026-01-02' },
        { id: 'r2', referrer_id: 'u1', referee_id: 'b', status: 'pending', created_at: '2026-02-01', completed_at: null },
      ],
      users: [user({ id: 'a', name: 'Ali' }), user({ id: 'b', name: 'Ayşe' })],
    });

    const history = await referralService.getHistory('u1');

    expect(history.map((h) => h.refereeName)).toEqual(['Ayşe', 'Ali']);
    expect(history[0]).toMatchObject({ id: 'r2', status: 'pending', completedAt: null });
  });

  it('adı bulunamayan davet edilen için Unknown yazar', async () => {
    const { referralService } = await setup({
      referrals: [{ id: 'r1', referrer_id: 'u1', referee_id: 'silinmis', status: 'pending', created_at: '2026-01-01' }],
      users: [],
    });

    await expect(referralService.getHistory('u1')).resolves.toMatchObject([
      { refereeName: 'Unknown' },
    ]);
  });

  it('daveti yoksa boş liste', async () => {
    const { referralService } = await setup({ referrals: [] });
    await expect(referralService.getHistory('u1')).resolves.toEqual([]);
  });

  it('başkasının geçmişini sızdırmaz', async () => {
    const { referralService } = await setup({
      referrals: [{ id: 'r1', referrer_id: 'baskasi', referee_id: 'a', status: 'pending', created_at: '2026-01-01' }],
      users: [user({ id: 'a', name: 'Ali' })],
    });

    await expect(referralService.getHistory('u1')).resolves.toEqual([]);
  });
});

describe('validateCode', () => {
  it('geçerli kod için davet edenin adını döner', async () => {
    const { referralService } = await setup({
      users: [user({ id: 'ref', name: 'Ada', referral_code: 'AAAA2222' })],
    });
    await expect(referralService.validateCode('AAAA2222')).resolves.toEqual({
      valid: true, referrerName: 'Ada',
    });
  });

  it('küçük harfle de doğrular', async () => {
    const { referralService } = await setup({
      users: [user({ id: 'ref', name: 'Ada', referral_code: 'AAAA2222' })],
    });
    await expect(referralService.validateCode('aaaa2222')).resolves.toMatchObject({ valid: true });
  });

  it('olmayan kod geçersiz', async () => {
    const { referralService } = await setup({ users: [] });
    await expect(referralService.validateCode('YOKKOD11')).resolves.toEqual({ valid: false });
  });

  it('silinmiş kullanıcının kodu geçersiz', async () => {
    const { referralService } = await setup({
      users: [user({ id: 'ref', referral_code: 'AAAA2222', is_deleted: true })],
    });
    await expect(referralService.validateCode('AAAA2222')).resolves.toEqual({ valid: false });
  });
});

describe('getMyReferrer', () => {
  it('davet eden varsa adını ve durumu döner', async () => {
    const { referralService } = await setup({
      referrals: [{ id: 'r1', referrer_id: 'ref', referee_id: 'u1', status: 'completed' }],
      users: [user({ id: 'ref', name: 'Ada' })],
    });

    await expect(referralService.getMyReferrer('u1')).resolves.toEqual({
      referrerName: 'Ada', status: 'completed',
    });
  });

  it('davet eden yoksa null döner', async () => {
    const { referralService } = await setup({ referrals: [] });
    await expect(referralService.getMyReferrer('u1')).resolves.toEqual({
      referrerName: null, status: null,
    });
  });

  it('davet eden silinmişse Unknown döner', async () => {
    const { referralService } = await setup({
      referrals: [{ id: 'r1', referrer_id: 'yok', referee_id: 'u1', status: 'pending' }],
      users: [],
    });

    await expect(referralService.getMyReferrer('u1')).resolves.toMatchObject({
      referrerName: 'Unknown',
    });
  });
});
