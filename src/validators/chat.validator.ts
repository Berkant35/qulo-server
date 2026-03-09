import { z } from "zod";

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(2000),
  is_image: z.boolean().default(false),
});

export const chatQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ChatQuery = z.infer<typeof chatQuerySchema>;
