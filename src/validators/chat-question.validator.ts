import { z } from "zod";

export const createChatQuestionSchema = z.object({
  question_text: z.string().min(3).max(200),
  option_a: z.string().min(1).max(100),
  option_b: z.string().min(1).max(100),
  correct_option: z.enum(["A", "B"]),
  has_unmatch_risk: z.boolean().default(false),
});

export const answerChatQuestionSchema = z.object({
  selected_option: z.enum(["A", "B"]),
});

export type CreateChatQuestionInput = z.infer<typeof createChatQuestionSchema>;
export type AnswerChatQuestionInput = z.infer<typeof answerChatQuestionSchema>;
