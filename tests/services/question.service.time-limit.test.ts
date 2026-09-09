import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';

/**
 * Soru suresi kontrolu — sabit liste yerine economy config.
 *
 * ONCEDEN: `question.validator.ts` sabit `TIME_PRESETS = [15,30,60,90]`
 * dogruluyordu. Ama secenekler config'te (`timing.timePresets`) ve
 * backoffice'ten degistirilebiliyor; mobil de onlari oradan okuyup kullaniciya
 * gosteriyor (question_create_screen.dart:100). Admin `[20,45,60,90]` yazsaydi
 * kullanici 20'yi secerdi ve sunucu 400 dondururdu — soru olusturma kirilirdi.
 *
 * SIMDI: validator yalnizca tip + makul aralik (5-300, config semasiyla ayni),
 * uyelik kontrolu serviste config'ten okunan listeye karsi.
 * Ayni desen: `exchange.service.ts` donusum orani.
 */

const USER = '11111111-1111-4111-8111-111111111111';

const baseInput = {
  order_num: 1,
  question_text: 'Favori rengim?',
  correct_answer: 1,
  answer_1: 'Mavi',
  answer_2: 'Yesil',
  answer_3: 'Kirmizi',
  answer_4: 'Sari',
  locale: 'tr',
};

async function setup(presets: number[], seed: Tables = {}) {
  const fake = createFakeSupabase({
    economy_config_versions: [activeConfigRow({
      timing: { ...activeConfigRow().config.timing, timePresets: presets },
    })],
    users: [{ id: USER, subscription_plan: null }],
    questions: [],
    ...seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { questionService } = await import('../../src/services/question.service.js');
  return { fake, questionService };
}

beforeEach(() => {
  vi.resetModules();
});

describe('createQuestion — time_limit config listesinden dogrulanir', () => {
  it('config listesindeki deger kabul edilir', async () => {
    const { fake, questionService } = await setup([15, 30, 60]);

    await questionService.createQuestion(USER, { ...baseInput, time_limit: 60 } as never);

    expect(fake.table('questions')[0].time_limit).toBe(60);
  });

  it('ESKI sabit listede olmayan ama config\'te olan deger kabul edilir', async () => {
    // Asil duzeltme bu: 20 eski `TIME_PRESETS`te yoktu, sabit kapi onu 400
    // ile reddederdi. Admin listeyi degistirdiginde mobil 20'yi gosteriyor.
    const { fake, questionService } = await setup([20, 45, 90]);

    await questionService.createQuestion(USER, { ...baseInput, time_limit: 20 } as never);

    expect(fake.table('questions')[0].time_limit).toBe(20);
  });

  it('config listesinde OLMAYAN deger reddedilir ve hicbir satir yazilmaz', async () => {
    const { fake, questionService } = await setup([15, 30, 60]);

    await expect(
      questionService.createQuestion(USER, { ...baseInput, time_limit: 90 } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(fake.table('questions')).toHaveLength(0);
  });

  it('hata mesaji gecerli secenekleri sayar — istemci ne yapacagini bilsin', async () => {
    const { questionService } = await setup([20, 45]);

    await expect(
      questionService.createQuestion(USER, { ...baseInput, time_limit: 30 } as never),
    ).rejects.toMatchObject({
      // AppError detaylari `params` altinda tasiniyor (errors.ts:96 →
      // `new AppError(..., { details })`).
      params: { details: { time_limit: expect.stringContaining('20, 45') } },
    });
  });

  it('time_limit verilmezse kontrol atlanir ve varsayilan yazilir', async () => {
    // Varsayilan (30) config listesinde olmasa bile eski davranis korunuyor:
    // istemci alani gondermediyse sunucu kendi varsayilanini kullanir.
    const { fake, questionService } = await setup([20, 45]);

    await questionService.createQuestion(USER, { ...baseInput } as never);

    expect(fake.table('questions')).toHaveLength(1);
  });
});

describe('updateQuestion — ayni kural', () => {
  it('config disi deger guncellemede de reddedilir', async () => {
    const { questionService } = await setup([15, 30], {
      questions: [{ user_id: USER, order_num: 1, time_limit: 30, question_text: 'x' }],
    });

    await expect(
      questionService.updateQuestion(USER, 1, { time_limit: 90 } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
