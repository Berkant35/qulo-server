import { z } from "zod";
import { segmentSchema } from "./segment.validator.js";
import { SUPPORTED_LOCALES } from "../constants/locales.js";
import { PAGE_KEYS } from "../constants/page-keys.js";

const localeContentSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  cta_label: z.string().max(40).optional().default(""),
});

// 16 dilin HEPSİ dolu olmalı
const contentSchema = z
  .record(z.string(), localeContentSchema)
  .refine(
    (c) => SUPPORTED_LOCALES.every((l) => c[l] && c[l].title && c[l].body),
    { message: "Tüm 16 dil (title+body) dolu olmalı" },
  );

// action_url: internal path (/...) veya quloapp.com host'lu URL; başka her şey reddedilir
const actionUrlSchema = z
  .string()
  .max(200)
  .refine((v) => {
    if (/^\/[a-zA-Z0-9_\/-]*$/.test(v)) return true; // internal path
    try {
      const u = new URL(v);
      return u.protocol === "https:" && (u.hostname === "quloapp.com" || u.hostname === "www.quloapp.com");
    } catch {
      return false;
    }
  }, { message: "action_url internal path veya quloapp.com https URL olmalı" })
  .optional();

const imageUrlSchema = z
  .string()
  .max(300)
  .refine((v) => v.startsWith("https://"), { message: "image_url https olmalı" })
  .optional();

export const createPageMessageSchema = z.object({
  title: z.string().min(1).max(200),
  page: z.enum(PAGE_KEYS as unknown as [string, ...string[]]),
  display_type: z.enum(["banner", "bottom_sheet", "modal", "inline_card"]),
  content: contentSchema,
  image_url: imageUrlSchema,
  action_url: actionUrlSchema,
  frequency: z.enum(["once", "every_visit", "until_dismissed", "daily"]).default("once"),
  priority: z.number().int().default(0),
  segment: segmentSchema.optional(),
  start_at: z.string().refine((v) => !isNaN(Date.parse(v)), { message: "geçersiz tarih" }).optional(),
  end_at: z.string().refine((v) => !isNaN(Date.parse(v)), { message: "geçersiz tarih" }).optional(),
  is_active: z.boolean().default(true),
});
export type CreatePageMessageInput = z.infer<typeof createPageMessageSchema>;

export const eventSchema = z.object({
  event: z.enum(["shown", "clicked", "dismissed"]),
});
