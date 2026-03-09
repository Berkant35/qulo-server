import { z } from 'zod';
import { QUESTION_CATEGORIES, TIME_PRESETS } from './question.validator.js';

export const queueChangeSchema = z.object({
  change_type: z.enum(['UPDATE', 'DELETE']),
  payload: z.object({
    question_text: z.string().min(5).max(500).optional(),
    correct_answer: z.number().int().min(1).max(4).optional(),
    answer_1: z.string().min(1).max(200).optional(),
    answer_2: z.string().min(1).max(200).optional(),
    answer_3: z.string().min(1).max(200).optional(),
    answer_4: z.string().min(1).max(200).optional(),
    hint_text: z.string().max(300).optional(),
    category: z.enum(QUESTION_CATEGORIES).optional(),
    time_limit: z.number().int().refine(
      (v) => (TIME_PRESETS as readonly number[]).includes(v),
      { message: 'time_limit must be 15, 30, 60, or 90' }
    ).optional(),
  }).optional(),
});

export type QueueChangeInput = z.infer<typeof queueChangeSchema>;
