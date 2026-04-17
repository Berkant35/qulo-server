import { z } from "zod";

const htmlTagPattern = /<\s*\/?\s*(script|iframe|object|embed|form|input|link|meta|style|svg|base)[^>]*>/i;

export const createTicketSchema = z.object({
  subject: z.string().min(5).max(200)
    .refine(v => !htmlTagPattern.test(v), { message: "HTML tags are not allowed" }),
  message: z.string().min(10).max(2000)
    .refine(v => !htmlTagPattern.test(v), { message: "HTML tags are not allowed" }),
  category: z.enum(["ACCOUNT", "TECHNICAL", "BILLING", "MATCH", "OTHER"]),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
