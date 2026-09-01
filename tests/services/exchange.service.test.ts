import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * Exchange, elmasın gerçekten harcandığı yer: yeşil→mor dönüşümü ve güç satın alma.
 * Fiyatlar economy config'ten okunuyor, o yüzden config de gerçek tablodan (fixture) geliyor —
 * zod parse dahil tüm zincir çalışıyor.
 */
async function setup(seed: Tables, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(
    { economy_config_versions: [activeConfigRow()], ...seed },
    options,
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { exchangeService } = await import('../../src/services/exchange.service.js');
  return { fake, exchangeService };
}

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', green_diamonds: 100, purple_diamonds: 50, ...over,
});

const power = (over: Record<string, unknown> = {}) => ({
  id: 'p-oracle', name: 'ORACLE', is_active: true,
  green_cost: 45, purple_cost: 15, base_cost: 15, accuracy_rate: 0.7, ...over,
});

beforeEach(() => {
  vi.resetModules();
});

describe('ExchangeService.convertGreenToPurple', () => {
  // Fixture'da oran 3:1.
  it('oran kadar yeşili mora çevirir', async () => {
    const { fake, exchangeService } = await setup({ users: [user({ green_diamonds: 30, purple_diamonds: 0 })] });

    await expect(exchangeService.convertGreenToPurple('u1', 30)).resolves.toEqual({
      purple_received: 10,
      new_balance: { green: 0, purple: 10 },
    });

    const row = fake.table('users')[0];
    expect(row.green_diamonds).toBe(0);
    expect(row.purple_diamonds).toBe(10);
  });

  it('iki ayrı işlem kaydı yazar (harcama + kazanç)', async () => {
    const { fake, exchangeService } = await setup({ users: [user({ green_diamonds: 30, purple_diamonds: 0 })] });
    await exchangeService.convertGreenToPurple('u1', 30);

    expect(fake.table('diamond_transactions')).toEqual([
      expect.objectContaining({ type: 'GREEN', amount: -30, reason: 'exchange_green_to_purple' }),
      expect.objectContaining({ type: 'PURPLE', amount: 10, reason: 'exchange_green_to_purple' }),
    ]);
  });

  it('oranın katı olmayan miktarı reddeder', async () => {
    const { fake, exchangeService } = await setup({ users: [user()] });

    await expect(exchangeService.convertGreenToPurple('u1', 7)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(fake.table('users')[0].green_diamonds).toBe(100);
  });

  it('sıfır ve negatif miktarı reddeder', async () => {
    const { exchangeService } = await setup({ users: [user()] });

    await expect(exchangeService.convertGreenToPurple('u1', 0)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(exchangeService.convertGreenToPurple('u1', -3)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('yetersiz bakiyeyi reddeder ve hiçbir şeye dokunmaz', async () => {
    const { fake, exchangeService } = await setup({ users: [user({ green_diamonds: 3, purple_diamonds: 0 })] });

    await expect(exchangeService.convertGreenToPurple('u1', 30)).rejects.toMatchObject({
      code: 'INSUFFICIENT_DIAMONDS',
    });
    expect(fake.table('users')[0]).toMatchObject({ green_diamonds: 3, purple_diamonds: 0 });
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('oran config\'ten okunur, sabit değil', async () => {
    const fake = createFakeSupabase({
      economy_config_versions: [activeConfigRow({
        core: { ...activeConfigRow().config.core, greenToPurpleRatio: 5 },
      })],
      users: [user({ green_diamonds: 50, purple_diamonds: 0 })],
    });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { exchangeService } = await import('../../src/services/exchange.service.js');

    await expect(exchangeService.convertGreenToPurple('u1', 50)).resolves.toMatchObject({
      purple_received: 10,
    });
    // 3'ün katı ama 5'in katı değil → yeni oranla reddedilmeli
    await expect(exchangeService.convertGreenToPurple('u1', 3)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('ExchangeService.buyPower', () => {
  it('yeşil elmasla satın alır, envantere ekler, satın alma kaydı yazar', async () => {
    const { fake, exchangeService } = await setup({
      users: [user({ green_diamonds: 100 })],
      powers: [power()],
    });

    await expect(exchangeService.buyPower('u1', 'ORACLE', 'GREEN', 2)).resolves.toMatchObject({
      new_count: 2,
      new_balance: { green: 10, purple: 50 },
    });

    expect(fake.table('user_power_inventory')[0]).toMatchObject({
      user_id: 'u1', power_name: 'ORACLE', count: 2,
    });
    expect(fake.table('power_purchase_transactions')[0]).toMatchObject({
      user_id: 'u1', power_name: 'ORACLE', diamond_type: 'GREEN', quantity: 2, total_cost: 90,
    });
  });

  it('mor elmasla satın alır', async () => {
    const { fake, exchangeService } = await setup({
      users: [user({ purple_diamonds: 50 })],
      powers: [power()],
    });

    await exchangeService.buyPower('u1', 'ORACLE', 'PURPLE', 3);

    expect(fake.table('users')[0].purple_diamonds).toBe(5); // 50 - 3*15
    expect(fake.table('users')[0].green_diamonds).toBe(100);
  });

  it('fiyatı config\'ten alır, powers tablosundaki kolondan değil', async () => {
    const { fake, exchangeService } = await setup({
      users: [user({ green_diamonds: 100 })],
      // Tablo 999 diyor, config 45 diyor → config kazanmalı.
      powers: [power({ green_cost: 999 })],
    });

    await exchangeService.buyPower('u1', 'ORACLE', 'GREEN', 1);
    expect(fake.table('users')[0].green_diamonds).toBe(55);
  });

  it('config\'te olmayan güç için powers tablosundaki fiyata düşer', async () => {
    const { fake, exchangeService } = await setup({
      users: [user({ green_diamonds: 100 })],
      powers: [power({ id: 'p-x', name: 'LEGACY_POWER', green_cost: 40 })],
    });

    await exchangeService.buyPower('u1', 'LEGACY_POWER', 'GREEN', 1);
    expect(fake.table('users')[0].green_diamonds).toBe(60);
  });

  it('mevcut envanteri artırır, ikinci satır açmaz', async () => {
    const { fake, exchangeService } = await setup({
      users: [user({ green_diamonds: 200 })],
      powers: [power()],
      user_power_inventory: [{ id: 'inv-1', user_id: 'u1', power_name: 'ORACLE', count: 3 }],
    });

    await expect(exchangeService.buyPower('u1', 'ORACLE', 'GREEN', 2)).resolves.toMatchObject({
      new_count: 5,
    });
    expect(fake.table('user_power_inventory')).toHaveLength(1);
    expect(fake.table('user_power_inventory')[0].count).toBe(5);
  });

  it('başka kullanıcının envanterine karışmaz', async () => {
    const { fake, exchangeService } = await setup({
      users: [user({ green_diamonds: 200 })],
      powers: [power()],
      user_power_inventory: [{ id: 'inv-2', user_id: 'u2', power_name: 'ORACLE', count: 9 }],
    });

    await exchangeService.buyPower('u1', 'ORACLE', 'GREEN', 1);

    expect(fake.table('user_power_inventory')).toHaveLength(2);
    expect(fake.table('user_power_inventory').find((r) => r.user_id === 'u2')!.count).toBe(9);
  });

  it('sıfır ve negatif adedi reddeder', async () => {
    const { exchangeService } = await setup({ users: [user()], powers: [power()] });

    await expect(exchangeService.buyPower('u1', 'ORACLE', 'GREEN', 0)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(exchangeService.buyPower('u1', 'ORACLE', 'GREEN', -1)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('olmayan gücü reddeder', async () => {
    const { exchangeService } = await setup({ users: [user()], powers: [power()] });

    await expect(exchangeService.buyPower('u1', 'YOK', 'GREEN', 1)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('pasif gücü satmaz', async () => {
    const { exchangeService } = await setup({
      users: [user()],
      powers: [power({ is_active: false })],
    });

    await expect(exchangeService.buyPower('u1', 'ORACLE', 'GREEN', 1)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('bakiye yetersizse envantere hiçbir şey eklemez', async () => {
    const { fake, exchangeService } = await setup({
      users: [user({ green_diamonds: 10 })],
      powers: [power()],
    });

    await expect(exchangeService.buyPower('u1', 'ORACLE', 'GREEN', 1)).rejects.toMatchObject({
      code: 'INSUFFICIENT_DIAMONDS',
    });
    expect(fake.table('user_power_inventory')).toHaveLength(0);
    expect(fake.table('power_purchase_transactions')).toHaveLength(0);
    expect(fake.table('users')[0].green_diamonds).toBe(10);
  });
});

describe('ExchangeService.tryUseInventory', () => {
  it('envanterde güç varsa bir azaltıp true döner', async () => {
    const { fake, exchangeService } = await setup({
      user_power_inventory: [{ id: 'inv-1', user_id: 'u1', power_name: 'ORACLE', count: 2 }],
    });

    await expect(exchangeService.tryUseInventory('u1', 'ORACLE')).resolves.toBe(true);
    expect(fake.table('user_power_inventory')[0].count).toBe(1);
  });

  it('sayaç sıfırsa kullanmaz ve negatife düşürmez', async () => {
    const { fake, exchangeService } = await setup({
      user_power_inventory: [{ id: 'inv-1', user_id: 'u1', power_name: 'ORACLE', count: 0 }],
    });

    await expect(exchangeService.tryUseInventory('u1', 'ORACLE')).resolves.toBe(false);
    expect(fake.table('user_power_inventory')[0].count).toBe(0);
  });

  it('envanterde hiç yoksa false döner', async () => {
    const { exchangeService } = await setup({ user_power_inventory: [] });
    await expect(exchangeService.tryUseInventory('u1', 'ORACLE')).resolves.toBe(false);
  });

  it('başka kullanıcının gücünü kullanmaz', async () => {
    const { fake, exchangeService } = await setup({
      user_power_inventory: [{ id: 'inv-1', user_id: 'u2', power_name: 'ORACLE', count: 5 }],
    });

    await expect(exchangeService.tryUseInventory('u1', 'ORACLE')).resolves.toBe(false);
    expect(fake.table('user_power_inventory')[0].count).toBe(5);
  });

  it('başka gücün sayacına dokunmaz', async () => {
    const { fake, exchangeService } = await setup({
      user_power_inventory: [
        { id: 'inv-1', user_id: 'u1', power_name: 'ORACLE', count: 2 },
        { id: 'inv-2', user_id: 'u1', power_name: 'HINT', count: 4 },
      ],
    });

    await exchangeService.tryUseInventory('u1', 'ORACLE');
    expect(fake.table('user_power_inventory').find((r) => r.power_name === 'HINT')!.count).toBe(4);
  });
});

describe('ExchangeService.getInventory', () => {
  it('sadece kendi güçlerini döner', async () => {
    const { exchangeService } = await setup({
      user_power_inventory: [
        { id: 'i1', user_id: 'u1', power_name: 'ORACLE', count: 2 },
        { id: 'i2', user_id: 'u1', power_name: 'HINT', count: 1 },
        { id: 'i3', user_id: 'u2', power_name: 'SKIP', count: 9 },
      ],
    });

    const { inventory } = await exchangeService.getInventory('u1');
    expect(inventory).toEqual([
      { power_name: 'ORACLE', count: 2 },
      { power_name: 'HINT', count: 1 },
    ]);
  });

  it('envanter boşsa boş liste döner', async () => {
    const { exchangeService } = await setup({ user_power_inventory: [] });
    await expect(exchangeService.getInventory('u1')).resolves.toEqual({ inventory: [] });
  });
});

describe('ExchangeService — atomiklik sınırı', () => {
  /**
   * Bilinen davranış; test onu dondurmak için var. Elmas düşümü, envanter kaydı ve
   * satın alma logu ayrı çağrılar — transaction yok. Ara adım patlarsa kullanıcı
   * elmasını kaybeder, gücü almaz. Postgres fonksiyonuna alınırsa bu testler güncellenmeli.
   * (Repo'da örnek var: migration 037 quiz_session_mark_power.)
   */
  it('envanter yazımı patlarsa elmas geri verilmez', async () => {
    const { fake, exchangeService } = await setup(
      { users: [user({ green_diamonds: 100 })], powers: [power()] },
      { failOn: [{ table: 'user_power_inventory', op: 'insert' }] },
    );

    await expect(exchangeService.buyPower('u1', 'ORACLE', 'GREEN', 1)).rejects.toMatchObject({
      code: 'SERVER_ERROR',
    });

    expect(fake.table('users')[0].green_diamonds).toBe(55); // düştü
    expect(fake.table('user_power_inventory')).toHaveLength(0); // güç yok
  });

  it('mor elmas eklenemezse yeşil elmas geri verilmez', async () => {
    // İlk users.update = yeşil düşümü (başarılı), ikincisi = mor ekleme (patlar).
    const { fake, exchangeService } = await setup(
      { users: [user({ green_diamonds: 30, purple_diamonds: 0 })] },
      { failOn: [{ table: 'users', op: 'update', failAfter: 1 }] },
    );

    await expect(exchangeService.convertGreenToPurple('u1', 30)).rejects.toMatchObject({
      code: 'SERVER_ERROR',
    });

    const row = fake.table('users')[0];
    expect(row.green_diamonds).toBe(0);   // gitti
    expect(row.purple_diamonds).toBe(0);  // gelmedi
  });
});
