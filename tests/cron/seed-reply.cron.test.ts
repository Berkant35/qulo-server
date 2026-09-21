import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

type Satir = { id: string; kind: string };

async function setup(enabled: boolean, satirlar: Satir[] = []) {
  const fake = createFakeSupabase({ app_config: [{ id: 'cfg', seed_reply_enabled: enabled, seed_reply_fast_mode: false }] });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const scanAndEnqueue = vi.fn(async () => 0);
  const claimDue = vi.fn(async () => satirlar);
  const recoverStale = vi.fn(async () => 0);
  const isleyiciler = {
    processRow: vi.fn(async () => 'sent' as const),
    askQuestion: vi.fn(async () => 'sent' as const),
    answerQuestionRow: vi.fn(async () => 'sent' as const),
    respondMediaRequest: vi.fn(async () => 'sent' as const),
  };
  vi.doMock('../../src/services/seed-reply.service.js', () => ({
    scanAndEnqueue, claimDue, recoverStale, ...isleyiciler,
  }));
  const mod = await import('../../src/cron/seed-reply.cron.js');
  return { mod, scanAndEnqueue, claimDue, recoverStale, ...isleyiciler };
}

beforeEach(() => vi.resetModules());

describe('seedReplyTick', () => {
  it('kill-switch kapaliyken HICBIR tarama yapmaz', async () => {
    const { mod, scanAndEnqueue, claimDue } = await setup(false);
    await mod.seedReplyTick();
    expect(scanAndEnqueue).not.toHaveBeenCalled();
    expect(claimDue).not.toHaveBeenCalled();
  });

  it('kill-switch acikken kurtarma, tarama ve claim calisir', async () => {
    const { mod, scanAndEnqueue, claimDue, recoverStale } = await setup(true);
    await mod.seedReplyTick();
    expect(recoverStale).toHaveBeenCalled();
    expect(scanAndEnqueue).toHaveBeenCalled();
    expect(claimDue).toHaveBeenCalledWith(expect.any(Number));
  });

  it('her kuyruk turu KENDI isleyicisine gider', async () => {
    // Yonlendirme tek satirlik bir tablo araması; yanlis eslesirse bot ornegin bir
    // medya istegine metin cevabi yazar ve istek pending kalir (kalici kilitlenme).
    const { mod, processRow, askQuestion, answerQuestionRow, respondMediaRequest } = await setup(true, [
      { id: 'r1', kind: 'message' },
      { id: 'r2', kind: 'question' },
      { id: 'r3', kind: 'question_answer' },
      { id: 'r4', kind: 'media_request' },
    ]);

    await mod.seedReplyTick();

    expect(processRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    expect(askQuestion).toHaveBeenCalledWith(expect.objectContaining({ id: 'r2' }));
    expect(answerQuestionRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'r3' }));
    expect(respondMediaRequest).toHaveBeenCalledWith(expect.objectContaining({ id: 'r4' }));
    for (const fn of [processRow, askQuestion, answerQuestionRow, respondMediaRequest]) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it('bilinmeyen tur metin cevabina duser — eski satirlar patlatmaz', async () => {
    const { mod, processRow } = await setup(true, [{ id: 'r9', kind: 'gelecekteki_tur' }]);
    await mod.seedReplyTick();
    expect(processRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'r9' }));
  });

  it('is tanimi 10 saniyelik zamanlamayi korur', async () => {
    // Tek kapi app_config.seed_reply_enabled (yukaridaki iki test); cron her deploy'da
    // baslar, bu yuzden zamanlamanin kaymasi dogrudan LLM cagri hacmini degistirir.
    const { mod } = await setup(true);
    expect(mod.seedReplyCron.schedule).toBe('*/10 * * * * *');
  });
});
