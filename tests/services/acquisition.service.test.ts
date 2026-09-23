import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Edinim anketi cevabı (2026-09-23). Mobil 2.0.12 "Atla" butonunu kaldırdı; kaçış yolu
 * artık `dont_remember` kanalı (migration 061) — skip yerine veri. Sunucu davranışı
 * değişmedi ama hiç test edilmemişti: cevap satırı + users.acquisition_answered
 * bayrağı + idempotency (UNIQUE user_id).
 */
const ME = '11111111-1111-4111-8111-111111111111';
const TIKTOK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DONT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OLD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const GHOST = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase({
    users: [{ id: ME, locale: 'tr', acquisition_answered: false }],
    acquisition_channels: [
      { id: TIKTOK, key: 'tiktok', label: { en: 'TikTok' }, sort_order: 10, is_active: true, is_freeform: false },
      { id: OTHER, key: 'other', label: { en: 'Other', tr: 'Diğer' }, sort_order: 70, is_active: true, is_freeform: true },
      { id: DONT, key: 'dont_remember', label: { en: "I don't remember", tr: 'Hatırlamıyorum' }, sort_order: 80, is_active: true, is_freeform: false },
      { id: OLD, key: 'old_channel', label: { en: 'Old' }, sort_order: 90, is_active: false, is_freeform: false },
    ],
    user_acquisition: [],
    ...seed,
  }, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { acquisitionService } = await import('../../src/services/acquisition.service.js');
  return { fake, acquisitionService };
}

beforeEach(() => {
  vi.resetModules();
});

describe('acquisitionService.submitAnswer', () => {
  it('"Hatırlamıyorum" normal kanal gibi kaydedilir: channel_key anlık kopyası, skipped=false, bayrak true', async () => {
    const { fake, acquisitionService } = await setup();

    const result = await acquisitionService.submitAnswer(ME, { channelId: DONT });

    expect(result).toEqual({ answered: true });
    expect(fake.table('user_acquisition')).toHaveLength(1);
    expect(fake.table('user_acquisition')[0]).toMatchObject({
      user_id: ME, channel_id: DONT, channel_key: 'dont_remember', skipped: false, freeform_text: null,
    });
    expect(fake.table('users')[0].acquisition_answered).toBe(true);
  });

  it('eski istemcinin skipped=true cevabı kanalsız satır yazar, bayrak yine true (bir daha sorulmaz)', async () => {
    const { fake, acquisitionService } = await setup();

    await acquisitionService.submitAnswer(ME, { skipped: true });

    expect(fake.table('user_acquisition')[0]).toMatchObject({ user_id: ME, channel_id: null, channel_key: null, skipped: true });
    expect(fake.table('users')[0].acquisition_answered).toBe(true);
  });

  it('ikinci cevap yok sayılır — ilk satır korunur (idempotent)', async () => {
    const { fake, acquisitionService } = await setup();
    await acquisitionService.submitAnswer(ME, { channelId: TIKTOK });

    const again = await acquisitionService.submitAnswer(ME, { channelId: DONT });

    expect(again).toEqual({ answered: true });
    expect(fake.table('user_acquisition')).toHaveLength(1);
    expect(fake.table('user_acquisition')[0].channel_key).toBe('tiktok');
  });

  it('serbest metin yalnız is_freeform kanalda saklanır', async () => {
    const { fake, acquisitionService } = await setup();

    await acquisitionService.submitAnswer(ME, { channelId: TIKTOK, freeformText: 'reklamda gördüm' });
    expect(fake.table('user_acquisition')[0].freeform_text).toBeNull();
  });

  it('pasif kanal (rollback sonrası) reddedilir — 400, satır yazılmaz', async () => {
    const { fake, acquisitionService } = await setup();

    await expect(acquisitionService.submitAnswer(ME, { channelId: OLD }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.table('user_acquisition')).toHaveLength(0);
    expect(fake.table('users')[0].acquisition_answered).toBe(false);
  });

  it('bilinmeyen kanal kimliği FK 500 yerine 400', async () => {
    const { acquisitionService } = await setup();

    await expect(acquisitionService.submitAnswer(ME, { channelId: GHOST }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('yarışta ikinci insert 23505 dönse de kabul edilir, bayrak yine yazılır', async () => {
    // Fake UNIQUE uygulamaz; asıl idempotency savunması bu dal.
    const { fake, acquisitionService } = await setup({}, {
      failOn: [{ table: 'user_acquisition', op: 'insert', error: { message: 'duplicate key', code: '23505' } }],
    });

    const result = await acquisitionService.submitAnswer(ME, { channelId: DONT });

    expect(result).toEqual({ answered: true });
    expect(fake.table('users')[0].acquisition_answered).toBe(true);
  });

  it('is_freeform kanalda serbest metin yazılır', async () => {
    const { fake, acquisitionService } = await setup();

    await acquisitionService.submitAnswer(ME, { channelId: OTHER, freeformText: 'podcast' });

    expect(fake.table('user_acquisition')[0]).toMatchObject({ channel_key: 'other', freeform_text: 'podcast' });
  });
});
