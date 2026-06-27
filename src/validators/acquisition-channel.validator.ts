import { z } from "zod";

export const createChannelSchema = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/, "lowercase, digit, underscore"),
  label: z.record(z.string()),
  emoji: z.string().max(8).optional(),
  icon_url: z.string().url().max(500).optional(),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
  is_freeform: z.boolean().default(false),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
