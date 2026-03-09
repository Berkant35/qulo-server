import { z } from "zod";

export const swipeSchema = z.object({
  target_id: z.string().uuid(),
  action: z.enum(["LIKE", "REJECT"]),
});

export const discoverQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export type SwipeInput = z.infer<typeof swipeSchema>;
export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;
