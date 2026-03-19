import { z } from "zod";

export const createBlockSchema = z.object({
  blocked_id: z.string().uuid(),
});

export type CreateBlockInput = z.infer<typeof createBlockSchema>;
