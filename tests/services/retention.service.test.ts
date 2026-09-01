import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';
import { RETENTION_BONUS_REASON } from '../../src/constants/deletion-reasons.js';

/**
 * Hesap silme öncesi win-back teklifi. Uygunluk SADECE server'da belirlenir —
 * client'ın "ben uygunum" demesi yetmez, `claim` uygunluğu yeniden doğruluyor.
 *
 * Fixture: deletionDiamondAmount 15, minAccountAgeDays 7.
 */
async function setup(seed: Tables = {}) {
  const fake = createFakeSupabase({
    economy_config_versions: [activeConfigRow()],
    users: [{ id: 'u1', green_diamonds: 0, purple_diamonds: 0, created_at: OLD_ACCOUNT }],
    ...seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { retentionService } = await import('../../src/services/retention.service.js');
  return { fake, retentionService };
}

const NOW = new Date('2026-09-01T12:00:00Z');
/** 30 günlük hesap — yaş kapısını geçer. */
const OLD_ACCOUNT = '2026-08-02T12:00:00Z';
/** 2 günlük hesap — yaş kapısına takılır. */
const NEW_ACCOUNT = '2026-08-30T12:00:00Z';

const ELIGIBLE_REASON = 'few_matches';

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkEligibility — kapılar', () => {
  it('tüm kapılar açıkken uygun ve tutar config\'ten gelir', async () => {
    const { retentionService } = await setup();
    await expect(retentionService.checkEligibility('u1', ELIGIBLE_REASON)).resolves.toEqual({
      eligible: true, amount: 15,
    });
  });

  it('adreslenemeyen nedenler teklif almaz', async () => {
    const { retentionService } = await setup();

    // found_someone pozitif churn; privacy/technical PD'nin çözemeyeceği;
    // other/skipped belirsiz — hiçbiri win-back adayı değil.
    for (const reason of ['found_someone', 'privacy_concerns', 'technical_issues', 'other', 'skipped']) {
      await expect(retentionService.checkEligibility('u1', reason), reason)
        .resolves.toMatchObject({ eligible: false });
    }
  });

  it('adreslenebilir nedenlerin hepsi uygun', async () => {
    const { retentionService } = await setup();

    for (const reason of ['few_matches', 'few_users_nearby', 'app_confusing', 'too_expensive', 'taking_a_break']) {
      await expect(retentionService.checkEligibility('u1', reason), reason)
        .resolves.toMatchObject({ eligible: true });
    }
  });

  it('bilinmeyen neden kodu uygun değil', async () => {
    const { retentionService } = await setup();
    await expect(retentionService.checkEligibility('u1', 'uydurma_kod')).resolves.toMatchObject({
      eligible: false,
    });
  });

  it('daha önce bu bonusu almış kullanıcı tekrar alamaz', async () => {
    const { retentionService } = await setup({
      diamond_transactions: [{ id: 't1', user_id: 'u1', reason: RETENTION_BONUS_REASON }],
    });
    await expect(retentionService.checkEligibility('u1', ELIGIBLE_REASON)).resolves.toMatchObject({
      eligible: false,
    });
  });

  it('başka kullanıcının bonusu kendi uygunluğunu etkilemez', async () => {
    const { retentionService } = await setup({
      diamond_transactions: [{ id: 't1', user_id: 'u2', reason: RETENTION_BONUS_REASON }],
    });
    await expect(retentionService.checkEligibility('u1', ELIGIBLE_REASON)).resolves.toMatchObject({
      eligible: true,
    });
  });

  it('başka sebeple alınmış elmas bonusu engellemez', async () => {
    const { retentionService } = await setup({
      diamond_transactions: [{ id: 't1', user_id: 'u1', reason: 'IAP_PURCHASE' }],
    });
    await expect(retentionService.checkEligibility('u1', ELIGIBLE_REASON)).resolves.toMatchObject({
      eligible: true,
    });
  });

  // Aktif eşleşmesi olan kullanıcı ürünün çekirdek değerini zaten almış.
  it('aktif eşleşmesi olan kullanıcı uygun değil (user1 tarafı)', async () => {
    const { retentionService } = await setup({
      matches: [{ id: 'm1', user1_id: 'u1', user2_id: 'u2', is_active: true }],
    });
    await expect(retentionService.checkEligibility('u1', ELIGIBLE_REASON)).resolves.toMatchObject({
      eligible: false,
    });
  });

  it('aktif eşleşmesi olan kullanıcı uygun değil (user2 tarafı)', async () => {
    const { retentionService } = await setup({
      matches: [{ id: 'm1', user1_id: 'u2', user2_id: 'u1', is_active: true }],
    });
    await expect(retentionService.checkEligibility('u1', ELIGIBLE_REASON)).resolves.toMatchObject({
      eligible: false,
    });
  });

  it('pasif eşleşme engellemez', async () => {
    const { retentionService } = await setup({
      matches: [{ id: 'm1', user1_id: 'u1', user2_id: 'u2', is_active: false }],
    });
    await expect(retentionService.checkEligibility('u1', ELIGIBLE_REASON)).resolves.toMatchObject({
      eligible: true,
    });
  });

  it('başkalarının eşleşmesi engellemez', async () => {
    const { retentionService } = await setup({
      matches: [{ id: 'm1', user1_id: 'u2', user2_id: 'u3', is_active: true }],
    });
    await expect(retentionService.checkEligibility('u1', ELIGIBLE_REASON)).resolves.toMatchObject({
      eligible: true,
    });
  });

  // Farming önleme: aç-sil-elmas-al döngüsü.
  it('minAccountAgeDays\'ten yeni hesap uygun değil', async () => {
    const { retentionService } = await setup({
      users: [{ id: 'u1', green_diamonds: 0, purple_diamonds: 0, created_at: NEW_ACCOUNT }],
    });
    await expect(retentionService.checkEligibility('u1', ELIGIBLE_REASON)).resolves.toMatchObject({
      eligible: false,
    });
  });

  it('tam sınırdaki hesap (7 gün + biraz) uygun', async () => {
    const sevenDaysAndABit = new Date(NOW.getTime() - 7.1 * 86_400_000).toISOString();
    const { retentionService } = await setup({
      users: [{ id: 'u1', green_diamonds: 0, purple_diamonds: 0, created_at: sevenDaysAndABit }],
    });
    await expect(retentionService.checkEligibility('u1', ELIGIBLE_REASON)).resolves.toMatchObject({
      eligible: true,
    });
  });

  it('tutar uygun olmasa bile döner (UI teklifi gösterirken kullanabilsin)', async () => {
    const { retentionService } = await setup();
    await expect(retentionService.checkEligibility('u1', 'found_someone')).resolves.toEqual({
      eligible: false, amount: 15,
    });
  });
});

describe('claim', () => {
  it('uygunsa elmas yatırır ve tutarı döner', async () => {
    const { fake, retentionService } = await setup();

    await expect(retentionService.claim('u1', ELIGIBLE_REASON)).resolves.toEqual({ granted: 15 });
    expect(fake.table('users')[0].purple_diamonds).toBe(15);
    expect(fake.table('diamond_transactions')[0]).toMatchObject({
      user_id: 'u1', type: 'PURPLE', amount: 15, reason: RETENTION_BONUS_REASON,
    });
  });

  it('uygun olmayan neden için reddedilir ve elmas yatmaz', async () => {
    const { fake, retentionService } = await setup();

    await expect(retentionService.claim('u1', 'found_someone')).rejects.toMatchObject({
      code: 'RETENTION_NOT_ELIGIBLE',
    });
    expect(fake.table('users')[0].purple_diamonds).toBe(0);
  });

  /** Client "uygunum" diye ısrar etse bile ikinci grant çıkmamalı. */
  it('ikinci claim reddedilir', async () => {
    const { fake, retentionService } = await setup();

    await retentionService.claim('u1', ELIGIBLE_REASON);
    await expect(retentionService.claim('u1', ELIGIBLE_REASON)).rejects.toMatchObject({
      code: 'RETENTION_NOT_ELIGIBLE',
    });

    expect(fake.table('users')[0].purple_diamonds).toBe(15);
    expect(fake.table('diamond_transactions')).toHaveLength(1);
  });

  it('aktif eşleşmesi olan kullanıcı claim edemez', async () => {
    const { fake, retentionService } = await setup({
      matches: [{ id: 'm1', user1_id: 'u1', user2_id: 'u2', is_active: true }],
    });

    await expect(retentionService.claim('u1', ELIGIBLE_REASON)).rejects.toMatchObject({
      code: 'RETENTION_NOT_ELIGIBLE',
    });
    expect(fake.table('users')[0].purple_diamonds).toBe(0);
  });

  it('yeni hesap claim edemez', async () => {
    const { fake, retentionService } = await setup({
      users: [{ id: 'u1', green_diamonds: 0, purple_diamonds: 0, created_at: NEW_ACCOUNT }],
    });

    await expect(retentionService.claim('u1', ELIGIBLE_REASON)).rejects.toMatchObject({
      code: 'RETENTION_NOT_ELIGIBLE',
    });
    expect(fake.table('users')[0].purple_diamonds).toBe(0);
  });

  it('tutar config\'ten okunur, sabit değil', async () => {
    const base = activeConfigRow().config;
    const fake = createFakeSupabase({
      economy_config_versions: [activeConfigRow({
        retention: { ...base.retention, deletionDiamondAmount: 40 },
      })],
      users: [{ id: 'u1', green_diamonds: 0, purple_diamonds: 0, created_at: OLD_ACCOUNT }],
    });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { retentionService } = await import('../../src/services/retention.service.js');

    await expect(retentionService.claim('u1', ELIGIBLE_REASON)).resolves.toEqual({ granted: 40 });
    expect(fake.table('users')[0].purple_diamonds).toBe(40);
  });
});
