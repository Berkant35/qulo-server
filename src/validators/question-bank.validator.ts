import { z } from 'zod';
import { QUESTION_CATEGORIES } from './question.validator.js';
import { SUPPORTED_LOCALES } from '../constants/locales.js';

const TONES = ['flirty', 'fun', 'deep'] as const;

export const createQuestionBankSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]),
  category: z.enum(QUESTION_CATEGORIES),
  question_text: z.string().min(5).max(500),
  answers: z.array(z.string().min(1).max(200)).length(4),
  hint: z.string().max(300).optional(),
  target_gender: z.enum(['male', 'female']).optional(),
  target_age_min: z.number().int().min(13).max(100).optional(),
  target_age_max: z.number().int().min(13).max(100).optional(),
  tone: z.enum(TONES).optional().default('fun'),
});

export const bulkCreateQuestionBankSchema = z.object({
  questions: z.array(createQuestionBankSchema).min(1).max(500),
});

export const updateQuestionBankSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]).optional(),
  category: z.enum(QUESTION_CATEGORIES).optional(),
  question_text: z.string().min(5).max(500).optional(),
  answers: z.array(z.string().min(1).max(200)).length(4).optional(),
  hint: z.string().max(300).optional().nullable(),
  target_gender: z.enum(['male', 'female']).optional().nullable(),
  target_age_min: z.number().int().min(13).max(100).optional().nullable(),
  target_age_max: z.number().int().min(13).max(100).optional().nullable(),
  tone: z.enum(TONES).optional(),
  is_active: z.boolean().optional(),
});

export const listQuestionBankSchema = z.object({
  locale: z.string().optional(),
  category: z.string().optional(),
  tone: z.string().optional(),
  is_active: z.string().optional(),
  sort: z.enum(['created_at', 'updated_at', 'shown_count', 'selected_count', 'acceptance_rate']).optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export type CreateQuestionBankInput = z.infer<typeof createQuestionBankSchema>;
export type BulkCreateQuestionBankInput = z.infer<typeof bulkCreateQuestionBankSchema>;
export type UpdateQuestionBankInput = z.infer<typeof updateQuestionBankSchema>;
export type ListQuestionBankInput = z.infer<typeof listQuestionBankSchema>;
