import { z } from "zod";
import { SUPPORTED_LOCALES } from '../constants/locales.js';

export const QUESTION_CATEGORIES = [
  'personality', 'music', 'film', 'sports', 'travel',
  'food', 'technology', 'general', 'other'
] as const;

export const TIME_PRESETS = [15, 30, 60, 90] as const;

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
});

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
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
