import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type FailureSpec } from '../helpers/fake-supabase.js';

type Satir = { id: string; kind: string };

async function setup(enabled: boolean, satirlar: Satir[] = [], failOn?: FailureSpec[]) {
  const fake = createFakeSupabase(
    { app_config: [{ id: 'cfg', seed_reply_enabled: enabled, seed_reply_fast_mode: false }] },
    { failOn },
  );
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
  const markCancelled = vi.fn(async () => undefined);
  const { respondMediaRequest, ...servisIsleyicileri } = isleyiciler;
  vi.doMock('../../src/services/seed-reply.service.js', () => ({
    scanAndEnqueue, claimDue, recoverStale, markCancelled, ...servisIsleyicileri,
  }));
  vi.doMock('../../src/services/seed-reply-media.service.js', () => ({ respondMediaRequest }));
  const mod = await import('../../src/cron/seed-reply.cron.js');
  return { mod, fake, scanAndEnqueue, claimDue, recoverStale, markCancelled, ...isleyiciler };
}

const configOkumalari = (fake: { queries: Array<{ table: string; op: string }> }) =>
  fake.queries.filter((q) => q.table === 'app_config' && q.op === 'select').length;

beforeEach(() => vi.resetModules());

describe('seedReplyTick', () => {
  it('kill-switch kapaliyken HICBIR tarama yapmaz', async () => {
    const { mod, scanAndEnqueue, claimDue } = await setup(false);
    await mod.seedReplyTick();
    expect(scanAndEnqueue).not.toHaveBeenCalled();
    expect(claimDue).not.toHaveBeenCalled();
  });

  it('config OKUNAMAZSA kapali sayilir: tarama/claim yok (fail-closed)', async () => {
    // `if (cfg && !cfg.seed_reply_enabled)` gibi bir "iyilestirme" kesintide botu calistirirdi.
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { mod, scanAndEnqueue, claimDue } = await setup(true, [], [{ table: 'app_config', op: 'select' }]);
    await mod.seedReplyTick();
    expect(scanAndEnqueue).not.toHaveBeenCalled();
    expect(claimDue).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('kill-switch acikken kurtarma, tarama ve claim calisir', async () => {
    const { mod, scanAndEnqueue, claimDue, recoverStale } = await setup(true);
    await mod.seedReplyTick();
    expect(recoverStale).toHaveBeenCalled();
    expect(scanAndEnqueue).toHaveBeenCalled();
    expect(claimDue).toHaveBeenCalledWith(expect.any(Number));
  });

  it('tarama hata verse de vakti gelmis satirlar claim edilip islenir', async () => {
    // Tarama (yeni is bulma) ile claim (zaten kuyrukta bekleyen isi teslim) bagimsiz: RPC
    // eksik/bozuksa bile bekleyen medya reddi ve soru cevaplari susmamali (medya kilitlenmesi).
    const { mod, scanAndEnqueue, claimDue, processRow } = await setup(true, [{ id: 'r1', kind: 'message' }]);
    scanAndEnqueue.mockRejectedValueOnce(new Error('function seed_reply_candidates does not exist'));

    await mod.seedReplyTick();

    expect(claimDue).toHaveBeenCalledTimes(1);
    expect(processRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
  });

  it('kurtarma 5 dk\'da bir calisir — her tikte PATCH atilmaz', async () => {
    // recoverStale 5 dk'dan eski `claimed` satirlari toplar; her tikte cagrilmasi gunde
    // binlerce bos PATCH demekti (2026-09-27 istek patlamasi). Tarama ve claim her tikte kalir.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const T0 = new Date('2026-09-27T10:00:00Z').getTime();
      const { mod, recoverStale, claimDue } = await setup(true);

      vi.setSystemTime(T0);
      await mod.seedReplyTick();
      vi.setSystemTime(T0 + 30_000);
      await mod.seedReplyTick();
      vi.setSystemTime(T0 + 299_000);
      await mod.seedReplyTick();
      expect(recoverStale).toHaveBeenCalledTimes(1);
      expect(claimDue).toHaveBeenCalledTimes(3);

      vi.setSystemTime(T0 + 300_000);
      await mod.seedReplyTick();
      expect(recoverStale).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('kill-switch okumasi 60 sn onbellekli — her tikte app_config istegi atilmaz', async () => {
    // 10 sn'lik tikte her seferinde okunan tek satirlik config gunde 8.640 istek demekti
    // (2026-09-28 maliyet incelemesi: kalan isteklerin %69'u seed nabzi).
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const T0 = new Date('2026-09-28T10:00:00Z').getTime();
      const { mod, fake, scanAndEnqueue } = await setup(true);

      vi.setSystemTime(T0);
      await mod.seedReplyTick();
      vi.setSystemTime(T0 + 30_000);
      await mod.seedReplyTick();
      expect(configOkumalari(fake)).toBe(1);
      expect(scanAndEnqueue).toHaveBeenCalledTimes(2);

      vi.setSystemTime(T0 + 60_000);
      await mod.seedReplyTick();
      expect(configOkumalari(fake)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('admin panelinden kapatma bir sonraki tikte etkili — onbellek beklenmez', async () => {
    // Kill-switch acil durum anahtari: admin kapatinca bot 60 sn daha yazmaya devam etmemeli.
    const { mod, scanAndEnqueue } = await setup(true);
    await mod.seedReplyTick();
    expect(scanAndEnqueue).toHaveBeenCalledTimes(1);

    const { appConfigService } = await import('../../src/services/app-config.service.js');
    await appConfigService.updateConfig({ seed_reply_enabled: false });
    await mod.seedReplyTick();

    expect(scanAndEnqueue).toHaveBeenCalledTimes(1);
  });

  it('SQL ile kapatma en gec 60 sn icinde etkili', async () => {
    // Panel disi degisiklik (dogrudan SQL) bu surecin onbellegini temizleyemez; ust sinir TTL.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const T0 = new Date('2026-09-28T10:00:00Z').getTime();
      const { mod, fake, scanAndEnqueue } = await setup(true);

      vi.setSystemTime(T0);
      await mod.seedReplyTick();
      fake.table('app_config')[0].seed_reply_enabled = false;
      vi.setSystemTime(T0 + 30_000);
      await mod.seedReplyTick();
      expect(scanAndEnqueue).toHaveBeenCalledTimes(2);

      vi.setSystemTime(T0 + 60_000);
      await mod.seedReplyTick();
      expect(scanAndEnqueue).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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

  it('bilinmeyen tur IPTAL edilir — metin cevabina DUSMEZ', async () => {
    // Railway rolling deploy'unda eski instance yeni turleri gorur. 2026-09-21'de
    // tam bu oldu: bir `media_request` satiri metin cevabi yoluna dustu, bot sohbete
    // yazmaya calisti ve medya istegi `pending` kaldi. Yanlis eylem, eylemsizlikten kotu.
    const { mod, processRow, markCancelled } = await setup(true, [{ id: 'r9', kind: 'gelecekteki_tur' }]);

    await mod.seedReplyTick();

    expect(processRow).not.toHaveBeenCalled();
    expect(markCancelled).toHaveBeenCalledWith('r9', expect.stringContaining('gelecekteki_tur'));
  });

  it('is tanimi 30 saniyelik zamanlamayi korur', async () => {
    // Tek kapi app_config.seed_reply_enabled (yukaridaki testler); cron her deploy'da baslar,
    // bu yuzden zamanlamanin kaymasi dogrudan istek hacmini degistirir: 10 sn'de bos tikler gunde
    // ~27 bin istekti, 30 sn'de ~7,5 bin (2026-09-28). Kisaltmadan once supabase-cost-guard hesabi.
    const { mod } = await setup(true);
    expect(mod.seedReplyCron.schedule).toBe('*/30 * * * * *');
  });
});
