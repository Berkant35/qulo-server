import { describe, it, expect } from 'vitest';
import { createCampaignSchema, isRecurring } from '../../src/validators/campaign.validator.js';

const base = { title: 'T', push_title: 'PT', push_body: 'PB', segment: {} };

describe('createCampaignSchema — tekrarlayan kampanya', () => {
  it('varsayilan: recurrence none, variants bos', () => {
    const r = createCampaignSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ recurrence: 'none', variants: [] });
  });

  it('daily → pencere zorunlu; bitis baslangictan buyuk; scheduled_at ile birlikte olmaz', () => {
    expect(createCampaignSchema.safeParse({ ...base, recurrence: 'daily' }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...base, recurrence: 'daily', window_start_hour: 12, window_end_hour: 12 }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...base, recurrence: 'daily', window_start_hour: 12, window_end_hour: 21, scheduled_at: '2026-09-25T10:00:00Z' }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...base, recurrence: 'daily', window_start_hour: 12, window_end_hour: 21 }).success).toBe(true);
  });

  it('en fazla 50 varyant (dil basina ~5 × 10 dil); gun listesi 1-7', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ title: `t${i}`, body: `b${i}` }));
    expect(createCampaignSchema.safeParse({ ...base, variants: many }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...base, recurrence_days: [0] }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...base, recurrence_days: [8] }).success).toBe(false);
  });

  it('recurrence_days: bos dizi reddedilir (hicbir gun = duraklat, her gun degil); tekrarlar tekillestirilir ve siralanir; verilmezse her gun', () => {
    const daily = { ...base, recurrence: 'daily', window_start_hour: 12, window_end_hour: 21 };
    expect(createCampaignSchema.safeParse({ ...daily, recurrence_days: [] }).success).toBe(false);
    const r = createCampaignSchema.safeParse({ ...daily, recurrence_days: [6, 2, 6, 4] });
    expect(r.success && r.data.recurrence_days).toEqual([2, 4, 6]);
    const all = createCampaignSchema.safeParse(daily);
    expect(all.success && all.data.recurrence_days).toBeUndefined();
  });

  it('pencere bitisi 24 kabul; NaN saat reddedilir (form "abc")', () => {
    expect(createCampaignSchema.safeParse({ ...base, recurrence: 'daily', window_start_hour: 20, window_end_hour: 24 }).success).toBe(true);
    expect(createCampaignSchema.safeParse({ ...base, recurrence: 'daily', window_start_hour: Number.NaN, window_end_hour: 24 }).success).toBe(false);
  });

  it('URL semalari: image_url yalniz http(s); action_url /path, https:// veya qulo://', () => {
    expect(createCampaignSchema.safeParse({ ...base, image_url: 'javascript:alert(1)' }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...base, image_url: 'https://cdn.qulo.app/a.png' }).success).toBe(true);
    expect(createCampaignSchema.safeParse({ ...base, action_url: 'javascript:alert(1)' }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...base, action_url: 'http://evil' }).success).toBe(false);
    for (const ok of ['/discover', 'https://quloapp.com/x', 'qulo://chat/1']) {
      expect(createCampaignSchema.safeParse({ ...base, action_url: ok }).success).toBe(true);
    }
  });

  it('varyant ve basliklar trim: bosluk-only reddedilir', () => {
    expect(createCampaignSchema.safeParse({ ...base, variants: [{ title: '   ', body: 'b' }] }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ ...base, push_title: '  ' }).success).toBe(false);
    const r = createCampaignSchema.safeParse({ ...base, variants: [{ title: ' A ', body: ' b ' }] });
    expect(r.success && r.data.variants).toEqual([{ title: 'A', body: 'b' }]);
  });

  it('isRecurring: none/null/undefined degil, daily evet', () => {
    expect(isRecurring({ recurrence: 'daily' })).toBe(true);
    expect(isRecurring({ recurrence: 'none' })).toBe(false);
    expect(isRecurring({ recurrence: null })).toBe(false);
  });
});
