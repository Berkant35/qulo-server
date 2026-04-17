import { z } from "zod";

const htmlScriptPattern = /<\s*\/?\s*(script|iframe|object|embed|form|input|link|meta|style|svg|base)[^>]*>/i;

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(2000)
    .refine(v => !htmlScriptPattern.test(v), {
      message: "HTML tags are not allowed in messages",
    }),
  is_image: z.boolean().default(false),
  audio_url: z.string().url().optional(),
  audio_duration_seconds: z.number().int().min(1).max(60).optional(),
});

export const chatQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(4)
    .refine(v => /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u.test(v), {
      message: "Must contain only emoji characters",
    }),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ChatQuery = z.infer<typeof chatQuerySchema>;
export type ReactionInput = z.infer<typeof reactionSchema>;
