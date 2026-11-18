import { z } from "zod";
import { SUPPORTED_LOCALES } from "../constants/locales.js";
import { localeFromTag } from "../utils/locales.js";

/** Metin sınırları — mobil pop-up'ın sığdırabileceği uzunluk (spec 2026-11-18 A5). */
export const WHATS_NEW_LIMITS = { title: 60, body: 400, cta: 24, imageUrl: 300 } as const;

export const WHATS_NEW_PLATFORMS = ["all", "ios", "android"] as const;

/** Depodaki sürüm: yalnız x.y.z. */
const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

const versionSchema = z.string().trim().regex(SEMVER, "Sürüm x.y.z biçiminde olmalı (ör. 2.2.0)");

/**
 * GET /app/whats-new sorgusu. İstemci `2.2.0+112` gönderirse `+build` kısmı atılır;
 * locale bilinmiyorsa/yoksa 'en' (etiketler `tr-TR` gibi de gelebilir).
 */
export const whatsNewQuerySchema = z.object({
  version: z
    .string()
    .trim()
    .transform((v) => v.replace(/\+\d+$/, ""))
    .pipe(versionSchema),
  platform: z.enum(["ios", "android"]),
  locale: z
    .string()
    .max(35)
    .optional()
    .transform((l) => localeFromTag(l)),
});
export type WhatsNewQuery = z.infer<typeof whatsNewQuerySchema>;

const localeEntrySchema = z.object({
  title: z.string().min(1, "Başlık boş olamaz").max(WHATS_NEW_LIMITS.title, `Başlık en fazla ${WHATS_NEW_LIMITS.title} karakter`),
  body: z.string().min(1, "Metin boş olamaz").max(WHATS_NEW_LIMITS.body, `Metin en fazla ${WHATS_NEW_LIMITS.body} karakter`),
  cta_label: z.string().max(WHATS_NEW_LIMITS.cta, `Düğme en fazla ${WHATS_NEW_LIMITS.cta} karakter`).optional().default(""),
});

const contentSchema = z
  .record(z.string(), localeEntrySchema)
  .refine((c) => Object.keys(c).every((k) => (SUPPORTED_LOCALES as readonly string[]).includes(k)), {
    message: "Bilinmeyen dil kodu",
  })
  .refine((c) => "en" in c, { message: "İngilizce (en) başlık ve metin zorunlu" });

export const whatsNewInputSchema = z.object({
  app_version: versionSchema,
  platform: z.enum(WHATS_NEW_PLATFORMS),
  content: contentSchema,
  image_url: z
    .string()
    .max(WHATS_NEW_LIMITS.imageUrl)
    .refine((v) => v.startsWith("https://"), { message: "Görsel URL'si https olmalı" })
    .nullable(),
  is_active: z.boolean(),
});
export type WhatsNewInput = z.infer<typeof whatsNewInputSchema>;
