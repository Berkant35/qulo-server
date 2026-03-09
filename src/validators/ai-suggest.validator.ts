import { z } from 'zod';
import { QUESTION_CATEGORIES } from './question.validator.js';

export const aiSuggestSchema = z.object({
  category: z.enum(QUESTION_CATEGORIES).optional(),
  profile_based: z.boolean().optional().default(false),
  locale: z.enum(['tr', 'en']).optional().default('tr'),
  count: z.number().int().min(1).max(10).optional().default(5),
});

export type AiSuggestInput = z.infer<typeof aiSuggestSchema>;
