import { z } from "zod";

export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const purchaseSchema = z.object({
  product_id: z.string().min(1),
  transaction_id: z.string().optional(),
  platform: z.enum(["android", "ios"]),
});

export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type PurchaseInput = z.infer<typeof purchaseSchema>;
