import { z } from "zod";

export const createTicketSchema = z.object({
  subject: z.string().min(5).max(200),
  message: z.string().min(10).max(2000),
  category: z.enum(["ACCOUNT", "TECHNICAL", "BILLING", "MATCH", "OTHER"]),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
