import { z } from "zod";

export const segmentSchema = z.object({
  // Demografik (mevcut)
  gender: z.enum(["MAN", "WOMAN"]).optional(),
  age_min: z.number().int().min(18).max(99).optional(),
  age_max: z.number().int().min(18).max(99).optional(),
  cities: z.array(z.string()).optional(),
  subscription_plan: z.string().optional(),
  last_active_days: z.number().int().min(1).optional(),
  profile_completion_min: z.number().int().min(0).max(100).optional(),
  profile_completion_max: z.number().int().min(0).max(100).optional(),
  registered_after: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), { message: "Must be a valid date string" })
    .optional(),
  // Faz 1 davranışsal (users tablosunda DOĞRULANMIŞ hazır kolonlar)
  question_count_max: z.number().int().min(0).optional(), // örn. 0 = hiç soru eklememiş
  question_count_min: z.number().int().min(0).optional(),
  green_diamonds_max: z.number().int().min(0).optional(),
  is_premium: z.boolean().optional(),
  // NOT (pre-flight): photo_count (photos JSONB array, kolon değil) ve has_match
  // (matches JOIN gerektirir) Faz 2'ye ertelendi — users tablosunda kolon yok.
}).refine(
  (data) => !(data.subscription_plan !== undefined && data.is_premium !== undefined),
  { message: "subscription_plan ve is_premium birlikte kullanılamaz" },
);

export type SegmentInput = z.infer<typeof segmentSchema>;
