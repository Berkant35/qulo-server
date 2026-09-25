import { describe, it, expect } from 'vitest';
import { parseCampaignForm, parseVariantLines, formatZodIssues } from '../../src/admin/campaign-form.js';

describe('parseVariantLines', () => {
  it('"Baslik | Govde" satirlari; ayrac yoksa baslik push_title', () => {
    expect(parseVariantLines('A | b1\r\n\n  B|b2 \nsadece govde', 'PT')).toEqual([
      { title: 'A', body: 'b1' },
      { title: 'B', body: 'b2' },
      { title: 'PT', body: 'sadece govde' },
    ]);
    expect(parseVariantLines(undefined, 'PT')).toEqual([]);
  });
});

describe('parseCampaignForm (backoffice urlencoded)', () => {
  it('tekrarlayan form → tipli girdi; gun checkbox tek/çoklu; locales kucuk harf', () => {
    const r = parseCampaignForm({
      title: 'Gunluk TR', push_title: 'PT', push_body: 'PB', segment_locales: 'TR, en',
      recurrence: 'daily', recurrence_days: ['2', '4'], window_start_hour: '12', window_end_hour: '21',
      variants: 'A | a\nB | b', segment_gender: 'WOMAN', segment_age_min: '', scheduled_at: '',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toMatchObject({
      recurrence: 'daily', recurrence_days: [2, 4], window_start_hour: 12, window_end_hour: 21,
      variants: [{ title: 'A', body: 'a' }, { title: 'B', body: 'b' }],
      segment: { locales: ['tr', 'en'], gender: 'WOMAN' },
    });
    expect(r.data.scheduled_at).toBeUndefined();

    const single = parseCampaignForm({ title: 'x', push_title: 'y', push_body: 'z', recurrence: 'daily', recurrence_days: '6', window_start_hour: '9', window_end_hour: '10' });
    expect(single.success && single.data.recurrence_days).toEqual([6]);
  });

  it('tekrarlayan formda hic gun secilmemisse reddedilir; tek seferlikte gun listesi gonderilmez', () => {
    const none = parseCampaignForm({ title: 'x', push_title: 'y', push_body: 'z', recurrence: 'daily', window_start_hour: '9', window_end_hour: '10' });
    expect(none.success).toBe(false);
    if (!none.success) expect(formatZodIssues(none.error.issues)).toContain('recurrence_days');
    const once = parseCampaignForm({ title: 'x', push_title: 'y', push_body: 'z', recurrence: 'none', recurrence_days: ['2'] });
    expect(once.success && once.data.recurrence_days).toBeUndefined();
  });

  it('sayi alaninda "abc" → anlasilir hata (NaN zod\'da durur)', () => {
    const r = parseCampaignForm({ title: 'x', push_title: 'y', push_body: 'z', segment_age_min: 'abc' });
    expect(r.success).toBe(false);
    if (!r.success) expect(formatZodIssues(r.error.issues)).toMatch(/segment\.age_min/);
  });

  it('gecersiz gender (kucuk harf) reddedilir — DB enum MAN/WOMAN', () => {
    const r = parseCampaignForm({ title: 'x', push_title: 'y', push_body: 'z', segment_gender: 'man' });
    expect(r.success).toBe(false);
  });
});
