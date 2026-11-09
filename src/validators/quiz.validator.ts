import { z } from "zod";

export const startQuizSchema = z.object({
  target_id: z.string().uuid(),
});

export const answerQuizSchema = z.object({
  selected_answer: z.number().int().min(1).max(4).optional(),
  power_used: z
    .enum(["ORACLE", "HALF", "SKIP", "SKIP_ALL", "TIME_EXTEND", "HINT"])
    .optional(),
  // Ust sinir YOK: yalniz istatistik; sure 300 sn + medya ek suresi + TIME_EXTEND olabilir, durust
  // yavas cevap 400 almasin. Servis `clampTimeSpent` ile kirpar (review fix 3).
  time_spent: z.number().int().min(0).optional(),
}).refine(
  (data) => data.selected_answer != null || data.power_used != null,
  { message: "Either selected_answer or power_used is required" }
);

export type StartQuizInput = z.infer<typeof startQuizSchema>;
export type AnswerQuizInput = z.infer<typeof answerQuizSchema>;
