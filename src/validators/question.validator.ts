import { z } from "zod";
import { SUPPORTED_LOCALES } from '../constants/locales.js';

import { QUESTION_CATEGORIES } from '../constants/question-categories.js';
export { QUESTION_CATEGORIES };

// NOT (2026-09-09): Bu liste artik DOGRULAMA KAPISI DEGIL.
//
// Soru suresi secenekleri economy config'te (`timing.timePresets`,
// economy-config.schema.ts:74) ve backoffice'ten degistirilebiliyor; mobil de
// onlari oradan okuyup kullaniciya gosteriyor
// (question_create_screen.dart:100). Burada sabit bir liste dogrulamak,
// admin `[20,45,60,90]` yazdiginda kullanicinin gordugu 20'yi 400 ile
// reddetmek demekti — donusum oranindaki hatanin aynisi
// (bkz. exchange.validator.ts).
//
// Uyelik kontrolu artik `question.service.ts`'te, config'ten okunan listeye
// karsi yapiliyor. Liste yalnizca varsayilan uretmek icin duruyor.
export const TIME_PRESETS = [15, 30, 60, 90] as const;

/**
 * Sik kalite kontrolu — 4 sikkin hepsi birbirinden farkli olmali.
 *
 * Ayni sik iki kez girildiginde soru ya cozulemez hale geliyor ya da tahmin
 * edilebilirligi bozuluyor. Client'ta da inline hata var; burasi guvenlik hatti.
 * Karsilastirma trim + case-insensitive; bos/eksik siklar (update'te opsiyonel)
 * kontrol disi birakilir, onlari min(1) zaten yakaliyor.
 */
function answersMustDiffer(data: Record<string, unknown>): boolean {
  const answers = [data.answer_1, data.answer_2, data.answer_3, data.answer_4]
    .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    .map((a) => a.trim().toLocaleLowerCase());

  return new Set(answers).size === answers.length;
}

const answersMustDifferIssue = {
  message: "All answer options must be different",
  path: ["answers"] as (string | number)[],
};

export const createQuestionSchema = z.object({
  // Tavan 20: `tierLimitsSchema.maxQuestions` (economy-config.schema.ts:50) bu
  // kadarina izin veriyor ve gercek kapi `question.service.ts:81`'de plana gore
  // config'ten okunuyor. Burada 10 sabitti; bir plan 11'e cikarilsaydi servis
  // 11. soruyu kabul eder, bu validator 400 dondururdu. Ayni sinif:
  // exchange convertSchema ve time_limit preset'i.
  order_num: z.number().int().min(1).max(20),
  question_text: z.string().min(5).max(500),
  correct_answer: z.number().int().min(1).max(4),
  answer_1: z.string().min(1).max(200),
  answer_2: z.string().min(1).max(200),
  answer_3: z.string().min(1).max(200),
  answer_4: z.string().min(1).max(200),
  hint_text: z.string().max(300).optional(),
  category: z.enum(QUESTION_CATEGORIES).optional(),
  time_limit: z.number().int().min(5).max(300).optional().default(30),
  locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]).optional(),
}).refine(answersMustDiffer, answersMustDifferIssue);

export const updateQuestionSchema = z.object({
  question_text: z.string().min(5).max(500).optional(),
  correct_answer: z.number().int().min(1).max(4).optional(),
  answer_1: z.string().min(1).max(200).optional(),
  answer_2: z.string().min(1).max(200).optional(),
  answer_3: z.string().min(1).max(200).optional(),
  answer_4: z.string().min(1).max(200).optional(),
  hint_text: z.string().max(300).optional(),
  category: z.enum(QUESTION_CATEGORIES).optional(),
  time_limit: z.number().int().min(5).max(300).optional(),
  locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]).optional(),
}).refine(answersMustDiffer, answersMustDifferIssue);

export const reorderQuestionsSchema = z.object({
  order: z.array(z.string().uuid()).min(1).max(20),
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type ReorderQuestionsInput = z.infer<typeof reorderQuestionsSchema>;
