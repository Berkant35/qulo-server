import { z } from "zod";

export const createChatQuestionSchema = z.object({
  question_text: z.string().min(3).max(200),
  option_count: z.number().int().refine((v) => v === 2 || v === 4, { message: "option_count must be 2 or 4" }),
  option_a: z.string().min(1).max(100),
  option_b: z.string().min(1).max(100),
  option_c: z.string().min(1).max(100).optional(),
  option_d: z.string().min(1).max(100).optional(),
  correct_option: z.enum(["A", "B", "C", "D"]),
  time_limit_seconds: z.number().int().refine((v) => [15, 30, 45, 60, 90].includes(v), { message: "time_limit must be 15, 30, 45, 60, or 90" }),
  hint_text: z.string().max(200).optional(),
  reward_media_url: z.string().url().optional(),
  reward_media_type: z.enum(["image", "audio"]).optional(),
  has_unmatch_risk: z.boolean().default(false),
  has_chat_lock: z.boolean().default(false),
  use_power_block: z.boolean().default(false),
}).refine(
  (data) => {
    if (data.option_count === 4) return !!data.option_c && !!data.option_d;
    return true;
  },
  { message: "4-option questions require option_c and option_d" },
).refine(
  (data) => {
    if (data.option_count === 2) return data.correct_option === "A" || data.correct_option === "B";
    return true;
  },
  { message: "2-option questions only allow A or B as correct_option" },
);

export const answerChatQuestionSchema = z.object({
  selected_option: z.enum(["A", "B", "C", "D"]).nullable(),
  power_used: z.enum(["ORACLE", "SKIP", "HALF", "HINT", "TIME_EXTEND"]).optional(),
  time_spent: z.number().int().min(0).optional(),
});

export const usePowerSchema = z.object({
  power_name: z.enum(["ORACLE", "HALF", "HINT", "TIME_EXTEND", "SKIP", "POWER_UNBLOCK"]),
});

export const saveDraftSchema = z.object({
  question_text: z.string().min(3).max(200),
  option_count: z.number().int().refine((v) => v === 2 || v === 4),
  option_a: z.string().min(1).max(100),
  option_b: z.string().min(1).max(100),
  option_c: z.string().max(100).optional(),
  option_d: z.string().max(100).optional(),
  correct_option: z.enum(["A", "B", "C", "D"]),
  time_limit_seconds: z.number().int().default(30),
  hint_text: z.string().max(200).optional(),
  has_unmatch_risk: z.boolean().default(false),
  has_chat_lock: z.boolean().default(false),
});

export type CreateChatQuestionInput = z.infer<typeof createChatQuestionSchema>;
export type AnswerChatQuestionInput = z.infer<typeof answerChatQuestionSchema>;
export type UsePowerInput = z.infer<typeof usePowerSchema>;
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;
