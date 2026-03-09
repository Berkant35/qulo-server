import { z } from "zod";

export const createReportSchema = z.object({
  reported_id: z.string().uuid(),
  reason: z.string().min(5).max(1000),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
