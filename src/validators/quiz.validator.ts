import { z } from "zod";

export const startQuizSchema = z.object({
  target_id: z.string().uuid(),
});

export const answerQuizSchema = z.object({
  selected_answer: z.number().int().min(1).max(4),
  power_used: z
    .enum(["COPY", "HALF", "SKIP", "SKIP_ALL", "TIME_EXTEND", "HINT"])
    .optional(),
  time_spent: z.number().int().min(0).max(120).optional(),
});

export type StartQuizInput = z.infer<typeof startQuizSchema>;
export type AnswerQuizInput = z.infer<typeof answerQuizSchema>;
