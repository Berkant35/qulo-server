import { z } from "zod";
import { segmentSchema, type SegmentInput } from "./segment.validator.js";

export { segmentSchema };
export type { SegmentInput };

export const RECURRENCES = ["none", "daily"] as const;
export type Recurrence = (typeof RECURRENCES)[number];
export const MAX_VARIANTS = 10;

export const campaignVariantSchema = z.object({
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(500),
});
export type CampaignVariant = z.infer<typeof campaignVariantSchema>;

const isoDate = z.string().refine((v) => !isNaN(Date.parse(v)), { message: "Must be a valid date string" });
/** Admin girdisi diger adminlerin tarayicisinda href olur: javascript:/data: semasi yasak. */
const httpsUrl = z.string().url().max(500).refine((u) => /^https?:\/\//i.test(u), { message: "Only http(s) URLs are allowed" });
/** Mobil deep link (/discover), https veya qulo:// — baska sema yok. */
const actionUrl = z.string().max(200).refine((u) => /^(\/[^\s]*|https:\/\/[^\s]+|qulo:\/\/[^\s]+)$/i.test(u), { message: "action_url must be a /path, https:// or qulo:// link" });

export function isRecurring(campaign: { recurrence: string | null | undefined }): boolean {
  return !!campaign.recurrence && campaign.recurrence !== "none";
}

export const createCampaignSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    push_title: z.string().trim().min(1).max(100),
    push_body: z.string().trim().min(1).max(500),
    image_url: httpsUrl.optional(),
    action_url: actionUrl.optional(),
    action_label: z.string().trim().max(50).optional(),
    segment: segmentSchema,
    scheduled_at: isoDate.optional(),
    /** 'none' = tek seferlik (mevcut davranis); 'daily' = her gun pencere icinde rastgele dakikada. */
    recurrence: z.enum(RECURRENCES).default("none"),
    /** ISO haftanin gunleri 1..7; verilmezse her gun. Bos dizi KABUL EDILMEZ ("hicbir gun" = duraklat). */
    recurrence_days: z
      .array(z.number().int().min(1).max(7))
      .min(1, "Select at least one day")
      .max(7)
      .transform((days) => [...new Set(days)].sort((a, b) => a - b))
      .optional(),
    window_start_hour: z.number().int().min(0).max(23).optional(),
    window_end_hour: z.number().int().min(1).max(24).optional(),
    /** Gunluk rotasyonla giden metinler; bos ise push_title/push_body. */
    variants: z.array(campaignVariantSchema).max(MAX_VARIANTS).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.recurrence !== "daily") return;
    if (data.window_start_hour === undefined || data.window_end_hour === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["window_start_hour"], message: "Tekrarlayan kampanya icin gonderim penceresi (baslangic/bitis saati) zorunlu" });
      return;
    }
    if (data.window_end_hour <= data.window_start_hour) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["window_end_hour"], message: "Pencere bitisi baslangictan buyuk olmali" });
    }
    if (data.scheduled_at) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scheduled_at"], message: "Tekrarlayan kampanyada planli tarih kullanilmaz" });
    }
  });

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

