import { z } from "zod";
import { SUPPORTED_LOCALES } from '../constants/locales.js';

export const QUESTION_CATEGORIES = [
  'personality', 'music', 'film', 'sports', 'travel',
  'food', 'technology', 'general', 'other',
  'fun', 'entertainment', 'lifestyle', 'humor',
  'hobby', 'science', 'history', 'art', 'nature',
] as const;

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
  order_num: z.number().int().min(1).max(10),
  question_text: z.string().min(5).max(500),
  correct_answer: z.number().int().min(1).max(4),
  answer_1: z.string().min(1).max(200),
  answer_2: z.string().min(1).max(200),
  answer_3: z.string().min(1).max(200),
  answer_4: z.string().min(1).max(200),
  hint_text: z.string().max(300).optional(),
  category: z.enum(QUESTION_CATEGORIES).optional(),
  time_limit: z.number().int().refine(v => (TIME_PRESETS as readonly number[]).includes(v), { message: 'time_limit must be 15, 30, 60, or 90' }).optional().default(30),
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
  time_limit: z.number().int().refine(v => (TIME_PRESETS as readonly number[]).includes(v), { message: 'time_limit must be 15, 30, 60, or 90' }).optional(),
  locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]).optional(),
}).refine(answersMustDiffer, answersMustDifferIssue);

export const reorderQuestionsSchema = z.object({
  order: z.array(z.string().uuid()).min(1).max(10),
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type ReorderQuestionsInput = z.infer<typeof reorderQuestionsSchema>;
