import { z } from "zod";

export const validateCodeSchema = z.object({
  code: z.string().min(1).max(10).transform((v) => v.toUpperCase()),
});

export type ValidateCodeInput = z.infer<typeof validateCodeSchema>;

export const applyCodeSchema = z.object({
  code: z.string().min(1).max(10).transform((v) => v.toUpperCase()),
});

export type ApplyCodeInput = z.infer<typeof applyCodeSchema>;
