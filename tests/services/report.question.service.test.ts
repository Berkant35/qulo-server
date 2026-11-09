import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => vi.resetModules());

describe('reportService.create — question_id', () => {
  const QID = '22222222-2222-4222-8222-222222222222';

  async function setupFake(questions: Record<string, unknown>[]) {
    const { createFakeSupabase } = await import('../helpers/fake-supabase.js');
    const fake = createFakeSupabase({ reports: [], questions });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { reportService } = await import('../../src/services/report.service.js');
    return { fake, reportService };
  }

  it('baskasinin sorusu -> 400, satir yazilmaz', async () => {
    const { fake, reportService } = await setupFake([{ id: QID, user_id: 'u-other' }]);
    await expect(reportService.create('u-a', 'u-b', undefined, 'INAPPROPRIATE_MEDIA', QID)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(fake.table('reports')).toHaveLength(0);
  });

  it('olmayan soru -> 400', async () => {
    const { reportService } = await setupFake([]);
    await expect(reportService.create('u-a', 'u-b', undefined, 'OTHER', QID)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('raporlananin sorusu -> question_id ile yazilir', async () => {
    const { fake, reportService } = await setupFake([{ id: QID, user_id: 'u-b' }]);
    await reportService.create('u-a', 'u-b', undefined, 'INAPPROPRIATE_MEDIA', QID);
    expect(fake.table('reports')[0]).toMatchObject({ reported_id: 'u-b', category: 'INAPPROPRIATE_MEDIA', question_id: QID });
  });

  it('question_id yoksa eski yol: question_id kolonu yazilmaz, sorgu atilmaz', async () => {
    const { fake, reportService } = await setupFake([]);
    await reportService.create('u-a', 'u-b', 'neden', 'SPAM');
    expect(fake.table('reports')[0]).not.toHaveProperty('question_id');
  });
});

