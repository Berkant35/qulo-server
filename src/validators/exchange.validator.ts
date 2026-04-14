import { z } from "zod";

export const convertSchema = z.object({
  green_amount: z.number().int().min(3).refine((v) => v % 3 === 0, {
    message: "green_amount must be a multiple of 3",
  }),
});

export const buyPowerSchema = z.object({
  power_name: z.enum(["ORACLE", "HALF", "SKIP", "SKIP_ALL", "TIME_EXTEND", "HINT", "POWER_BLOCK", "POWER_UNBLOCK"]),
  diamond_type: z.enum(["GREEN", "PURPLE"]),
  quantity: z.number().int().min(1).max(50),
});

export type ConvertInput = z.infer<typeof convertSchema>;
export type BuyPowerInput = z.infer<typeof buyPowerSchema>;
