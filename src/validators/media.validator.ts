import { z } from "zod";

export const respondMediaRequestSchema = z.object({
  action: z.enum(["accept", "reject"]),
});

export type RespondMediaRequestInput = z.infer<typeof respondMediaRequestSchema>;
