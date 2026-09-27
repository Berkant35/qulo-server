import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Ödenmiş mor sayacı + Rainbow. Para güvenliği: bedava mor asla rainbow üretmemeli,
 * sayaç asla bakiyeyi aşmamalı, eşzamanlı yazımda güncelleme kaybolmamalı.
 */
async function setup(seed: Tables, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(seed, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { diamondService } = await import('../../src/services/diamond.service.js');
  return { fake, diamondService };
}

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', green_diamonds: 0, purple_diamonds: 100, purple_paid: 0, rainbow_diamonds: 0, ...over,
});

beforeEach(() => {
  vi.resetModules();
});

describe('spendPurple — önce ödenmiş', () => {
  it('ödenmiş sayaçtan önce düşer ve paidUsed döner', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_paid: 30 })] });
    await expect(diamondService.spendPurple('u1', 20, 'POWER_USED:HALF', 's1'))
      .resolves.toEqual({ purple: 80, paidUsed: 20 });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 80, purple_paid: 10 });
    expect(fake.table('diamond_transactions')[0]).toMatchObject({ type: 'PURPLE', amount: -20, paid_amount: 20 });
  });

  it('ödenmiş sayaç yetmezse kalanı bedavadan düşer', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_paid: 5 })] });
    await expect(diamondService.spendPurple('u1', 20, 'x')).resolves.toEqual({ purple: 80, paidUsed: 5 });
    expect(fake.table('users')[0].purple_paid).toBe(0);
  });

  it('ödenmiş yoksa paidUsed 0 ve defter satırında paid_amount yazılmaz', async () => {
    const { fake, diamondService } = await setup({ users: [user()] });
    await expect(diamondService.spendPurple('u1', 20, 'x')).resolves.toEqual({ purple: 80, paidUsed: 0 });
    expect(fake.table('diamond_transactions')[0].paid_amount).toBeUndefined();
  });

  it('yetersiz bakiye hiçbir şeye dokunmaz', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 10, purple_paid: 10 })] });
    await expect(diamondService.spendPurple('u1', 20, 'x')).rejects.toMatchObject({ code: 'INSUFFICIENT_DIAMONDS' });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 10, purple_paid: 10 });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('okuma ile yazma arasına giren kredi kaybolmaz (CAS yeniden dener)', async () => {
    const { fake, diamondService } = await setup(
      { users: [user({ purple_paid: 0 })] },
      { interleave: [{ table: 'users', mutate: (rows) => { rows[0].purple_diamonds += 50; rows[0].purple_paid += 50; } }] },
    );
    await expect(diamondService.spendPurple('u1', 20, 'x')).resolves.toEqual({ purple: 130, paidUsed: 20 });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 130, purple_paid: 30 });
  });

  it('ABA: araya giren ödenmiş harcama + bedava kredi ödenmiş sayacı şişiremez', async () => {
    const { fake, diamondService } = await setup(
      { users: [user({ purple_diamonds: 100, purple_paid: 30 })] },
      { interleave: [{ table: 'users', mutate: (rows) => { rows[0].purple_diamonds = 100; rows[0].purple_paid = 0; } }] },
    );
    await expect(diamondService.spendPurple('u1', 10, 'x')).resolves.toEqual({ purple: 90, paidUsed: 0 });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 90, purple_paid: 0 });
  });
});

describe('addPurple — ödenmiş pay', () => {
  it('paidAmount sayaca eklenir ve defter satırına yazılır', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 0 })] });
    await expect(diamondService.addPurple('u1', 50, 'IAP_PURCHASE', 'tx-1', 50))
      .resolves.toEqual({ purple: 50, credited: 50 });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 50, purple_paid: 50 });
    expect(fake.table('diamond_transactions')[0]).toMatchObject({ amount: 50, paid_amount: 50 });
  });

  it('paidAmount verilmezse bedava (sayaç değişmez)', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 0 })] });
    await diamondService.addPurple('u1', 100, 'PROFILE_COMPLETION', 'milestone_100');
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 100, purple_paid: 0 });
  });

  it('paidAmount tutarı aşamaz', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 0 })] });
    await diamondService.addPurple('u1', 10, 'IAP_PURCHASE', 'tx-2', 999);
    expect(fake.table('users')[0].purple_paid).toBe(10);
  });

  it('duplicate referans ikinci kez ne bakiye ne sayaç yazar', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 0 })] });
    await diamondService.addPurple('u1', 50, 'IAP_PURCHASE', 'tx-3', 50);
    await expect(diamondService.addPurple('u1', 50, 'IAP_PURCHASE', 'tx-3', 50))
      .resolves.toEqual({ purple: 50, credited: 0 });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 50, purple_paid: 50 });
  });
});

/**
 * Gerçek bir satın alma CAS tükenmesinde kaybolmamalı: önce kayıt (claim) satırı yazılıyor,
 * bakiye 3 denemede de yazılamazsa kayıt kalırsa tekrar deneme duplicate guard'a takılıp
 * `credited: 0` döner — webhook yolunda SESSİZCE. Telafi: claim satırı silinir, hata döner.
 */
describe('addPurple — CAS tükenmesi ve dayanıklılık', () => {
  const iapRows = (fake: { table: (n: string) => Array<Record<string, unknown>> }) =>
    fake.table('diamond_transactions').filter((t) => t.reason === 'IAP_PURCHASE');

  it('3 çakışmada da yazamazsa SERVER_ERROR; claim satırı kalmaz; aynı referansla tekrar tam yatar', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, diamondService } = await setup(
      { users: [user({ purple_diamonds: 0, purple_paid: 0 })] },
      { interleave: [{ table: 'users', times: 3, mutate: (rows) => { rows[0].purple_diamonds += 1; } }] },
    );

    await expect(diamondService.addPurple('u1', 50, 'IAP_PURCHASE', 'tx-cas', 50))
      .rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(iapRows(fake)).toHaveLength(0);
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 3, purple_paid: 0 });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CAS'),
      expect.objectContaining({ userId: 'u1', referenceId: 'tx-cas' }),
    );

    await expect(diamondService.addPurple('u1', 50, 'IAP_PURCHASE', 'tx-cas', 50))
      .resolves.toEqual({ purple: 53, credited: 50 });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 53, purple_paid: 50 });
    expect(iapRows(fake)).toHaveLength(1);
    errorSpy.mockRestore();
  });

  it('claim satırı silinemezse de SERVER_ERROR ve yüksek sesle loglar', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { diamondService } = await setup(
      { users: [user({ purple_diamonds: 0 })] },
      {
        interleave: [{ table: 'users', times: 3, mutate: (rows) => { rows[0].purple_diamonds += 1; } }],
        failOn: [{ table: 'diamond_transactions', op: 'delete' }],
      },
    );

    await expect(diamondService.addPurple('u1', 50, 'IAP_PURCHASE', 'tx-del', 50))
      .rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CAS'),
      expect.objectContaining({ userId: 'u1', referenceId: 'tx-del', deleteError: expect.any(String) }),
    );
    errorSpy.mockRestore();
  });

  it('tek çakışmada bir kez yeniden dener; iki artırım da korunur', async () => {
    const { fake, diamondService } = await setup(
      { users: [user({ purple_diamonds: 0, purple_paid: 0 })] },
      { interleave: [{ table: 'users', mutate: (rows) => { rows[0].purple_diamonds += 7; rows[0].purple_paid += 7; } }] },
    );

    await expect(diamondService.addPurple('u1', 50, 'IAP_PURCHASE', 'tx-once', 50))
      .resolves.toEqual({ purple: 57, credited: 50 });
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 57, purple_paid: 57 });
  });

  it('paidAmount NaN/sonsuz ise 0 sayılır (sayaç bozulmaz)', async () => {
    const { fake, diamondService } = await setup({ users: [user({ purple_diamonds: 0, purple_paid: 0 })] });
    await diamondService.addPurple('u1', 10, 'IAP_PURCHASE', 'tx-nan', Number.NaN);
    await diamondService.addPurple('u1', 10, 'IAP_PURCHASE', 'tx-inf', Number.POSITIVE_INFINITY);
    expect(fake.table('users')[0]).toMatchObject({ purple_diamonds: 20, purple_paid: 0 });
    expect(fake.table('diamond_transactions').every((t) => t.paid_amount === undefined)).toBe(true);
  });

  it('duplicate guard okunamazsa SERVER_ERROR ve hiçbir şey yazılmaz', async () => {
    const { fake, diamondService } = await setup(
      { users: [user({ purple_diamonds: 0 })] },
      { failOn: [{ table: 'diamond_transactions', op: 'select' }] },
    );

    await expect(diamondService.addPurple('u1', 50, 'IAP_PURCHASE', 'tx-guard', 50))
      .rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(fake.table('users')[0].purple_diamonds).toBe(0);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('harcama: araya giren düşüş bakiyeyi yetersiz bırakırsa yeniden denemede INSUFFICIENT, defter satırı yok', async () => {
    const { fake, diamondService } = await setup(
      { users: [user({ purple_diamonds: 100, purple_paid: 0 })] },
      { interleave: [{ table: 'users', mutate: (rows) => { rows[0].purple_diamonds = 10; } }] },
    );

    await expect(diamondService.spendPurple('u1', 50, 'x'))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_DIAMONDS' });
    expect(fake.table('users')[0].purple_diamonds).toBe(10);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });
});

/** Okuma hatası "kullanıcı yok" değildir: şema/bağlantı hatası 404 diye gizlenmemeli. */
describe('casUpdate okuma hatası', () => {
  it('satır yoksa (PGRST116) USER_NOT_FOUND', async () => {
    const { diamondService } = await setup({ users: [] });
    await expect(diamondService.earnGreen('yok', 5, 'x')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('başka bir okuma hatası SERVER_ERROR, hiçbir şey yazılmaz', async () => {
    const { fake, diamondService } = await setup(
      { users: [user({ green_diamonds: 3 })] },
      { failOn: [{ table: 'users', op: 'select', error: { message: 'column does not exist', code: '42703' } }] },
    );
    await expect(diamondService.earnGreen('u1', 5, 'x')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    await expect(diamondService.spendPurple('u1', 5, 'x')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(fake.table('users')[0]).toMatchObject({ green_diamonds: 3, purple_diamonds: 100 });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });
});

describe('Rainbow bakiyesi', () => {
  it('earnRainbow artırır ve RAINBOW satırı yazar', async () => {
    const { fake, diamondService } = await setup({ users: [user()] });
    await expect(diamondService.earnRainbow('u1', 6, 'POWER_REWARD:HALF', 's1')).resolves.toEqual({ rainbow: 6 });
    expect(fake.table('diamond_transactions')[0]).toMatchObject({ type: 'RAINBOW', amount: 6, reason: 'POWER_REWARD:HALF' });
  });

  it('spendRainbow düşer; yetersizse reddeder', async () => {
    const { fake, diamondService } = await setup({ users: [user({ rainbow_diamonds: 10 })] });
    await expect(diamondService.spendRainbow('u1', 4, 'buy_power_HALF')).resolves.toEqual({ rainbow: 6 });
    await expect(diamondService.spendRainbow('u1', 7, 'x')).rejects.toMatchObject({ code: 'INSUFFICIENT_DIAMONDS' });
    expect(fake.table('users')[0].rainbow_diamonds).toBe(6);
  });

  it('eşzamanlı iki kazanım: ikincisi kaybolmaz', async () => {
    const { fake, diamondService } = await setup(
      { users: [user({ rainbow_diamonds: 0 })] },
      { interleave: [{ table: 'users', mutate: (rows) => { rows[0].rainbow_diamonds += 3; } }] },
    );
    await diamondService.earnRainbow('u1', 6, 'x');
    expect(fake.table('users')[0].rainbow_diamonds).toBe(9);
  });

  it('getBalance üç bakiyeyi döner', async () => {
    const { diamondService } = await setup({ users: [user({ green_diamonds: 7, rainbow_diamonds: 3 })] });
    await expect(diamondService.getBalance('u1')).resolves.toEqual({ green: 7, purple: 100, rainbow: 3 });
  });
});

describe('creditReward — bölünmüş ödül', () => {
  it('iki pay da varsa iki satır yazar', async () => {
    const { fake, diamondService } = await setup({ users: [user()] });
    await diamondService.creditReward('u1', { green: 30, rainbow: 6 }, 'POWER_REWARD:SKIP', 's1');
    expect(fake.table('users')[0]).toMatchObject({ green_diamonds: 30, rainbow_diamonds: 6 });
    expect(fake.table('diamond_transactions').map((t) => [t.type, t.amount])).toEqual([['GREEN', 30], ['RAINBOW', 6]]);
  });

  it('sıfır olan pay için satır yazmaz', async () => {
    const { fake, diamondService } = await setup({ users: [user()] });
    await diamondService.creditReward('u1', { green: 3, rainbow: 0 }, 'x');
    expect(fake.table('diamond_transactions')).toHaveLength(1);
    expect(fake.table('diamond_transactions')[0].type).toBe('GREEN');
  });
});

/**
 * Yayındaki mobil sürümler GREEN dışı her geçmiş satırını "mor" etiketliyor: erişimi kapalı
 * kullanıcıya RAINBOW satırı "+N mor" hayaleti olarak görünürdü (spec §2.4). Filtre sayfalama
 * ve toplam sayımdan ÖNCE uygulanmalı — yoksa sayfalar eksik, toplam yanlış olur.
 */
describe('getHistory — rainbow erişimi', () => {
  const rows = (userId: string) => [
    { id: `${userId}-g1`, user_id: userId, type: 'GREEN', amount: 5, reason: 'x', reference_id: null, created_at: '2026-09-01T00:00:00Z' },
    { id: `${userId}-r1`, user_id: userId, type: 'RAINBOW', amount: 3, reason: 'x', reference_id: null, created_at: '2026-09-02T00:00:00Z' },
    { id: `${userId}-p1`, user_id: userId, type: 'PURPLE', amount: 10, reason: 'x', reference_id: null, created_at: '2026-09-03T00:00:00Z' },
    { id: `${userId}-r2`, user_id: userId, type: 'RAINBOW', amount: 4, reason: 'x', reference_id: null, created_at: '2026-09-04T00:00:00Z' },
  ];
  const seed = () => ({
    users: [
      user({ id: 'tr', country: 'TR', is_test_admin: false, is_seed_profile: false, is_test_account: false }),
      user({ id: 'th', country: 'TH', is_test_admin: false, is_seed_profile: false, is_test_account: false }),
      user({ id: 'adm', country: 'TR', is_test_admin: true, is_seed_profile: false, is_test_account: false }),
    ],
    reward_market_countries: [{ country_code: 'TH', enabled: true, android_enabled: true, ios_enabled: false }],
    diamond_transactions: [...rows('tr'), ...rows('th'), ...rows('adm')],
  });

  it('erişimi kapalı kullanıcı (TR, android) RAINBOW satırı görmez; toplam da saymaz', async () => {
    const { diamondService } = await setup(seed());
    const result = await diamondService.getHistory('tr', 1, 20, 'android');
    expect(result.items.map((i: { type: string }) => i.type)).toEqual(['PURPLE', 'GREEN']);
    expect(result.total).toBe(2);
  });

  it('sayfalama filtrelenmiş listeye göre: 1 kayıtlık 2. sayfa GREEN satırıdır', async () => {
    const { diamondService } = await setup(seed());
    const result = await diamondService.getHistory('tr', 2, 1, 'android');
    expect(result.items.map((i: { id: string }) => i.id)).toEqual(['tr-g1']);
  });

  it('platform bilinmiyorsa (başlık yok) açık ülkede bile RAINBOW gizlenir', async () => {
    const { diamondService } = await setup(seed());
    const result = await diamondService.getHistory('th', 1, 20);
    expect(result.items.every((i: { type: string }) => i.type !== 'RAINBOW')).toBe(true);
    expect(result.total).toBe(2);
  });

  it('açık ülke + açık platform (TH, android) hepsini görür', async () => {
    const { diamondService } = await setup(seed());
    const result = await diamondService.getHistory('th', 1, 20, 'android');
    expect(result.total).toBe(4);
  });

  it('test admin hepsini görür', async () => {
    const { diamondService } = await setup(seed());
    const result = await diamondService.getHistory('adm', 1, 20, 'ios');
    expect(result.items.map((i: { type: string }) => i.type)).toEqual(['RAINBOW', 'PURPLE', 'RAINBOW', 'GREEN']);
    expect(result.total).toBe(4);
  });
});

/**
 * 068 `uniq_diamond_iap_reference_global`: bir IAP referansı (mağaza işlem numarası) HESAPLAR
 * ARASI tek kez yatar. Uygulama guard'ı kullanıcı başına; ikinci hesaba aynı referansla gelen
 * kredi DB kısıtında (23505) durur ve addPurple bunu `credited: 0` olarak döner.
 */
describe('addPurple — IAP referansı hesaplar arası tek (068)', () => {
  it('A\'ya yatan referans B\'ye yatmaz: credited 0, B\'nin bakiyesi değişmez', async () => {
    const { fake, diamondService } = await setup(
      { users: [user({ id: 'a', purple_diamonds: 0 }), user({ id: 'b', purple_diamonds: 5, purple_paid: 0 })] },
      { unique: { diamond_transactions: ['reference_id'] } },
    );

    await expect(diamondService.addPurple('a', 400, 'IAP_PURCHASE', 'GPA.1', 400))
      .resolves.toEqual({ purple: 400, credited: 400 });
    await expect(diamondService.addPurple('b', 400, 'IAP_PURCHASE', 'GPA.1', 400))
      .resolves.toEqual({ purple: 5, credited: 0 });

    expect(fake.table('users').find((u) => u.id === 'b')).toMatchObject({ purple_diamonds: 5, purple_paid: 0 });
    expect(fake.table('diamond_transactions')).toHaveLength(1);
  });
});
