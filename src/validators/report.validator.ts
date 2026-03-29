import { z } from "zod";

export const createReportSchema = z.object({
  reported_id: z.string().uuid(),
  reason: z.string().min(5).max(1000),
  category: z.enum([
    "INAPPROPRIATE_CONTENT",
    "FAKE_PROFILE",
    "SPAM",
    "HARASSMENT",
    "UNDERAGE",
    "SCAM",
    "OFFENSIVE_PHOTOS",
    "THREATENING",
    "IMPERSONATION",
    "OTHER",
  ]),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
