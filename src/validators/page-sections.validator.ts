import { z } from "zod";
import { SUPPORTED_LOCALES } from "../constants/locales.js";
import {
  ACTION_TYPES,
  APP_ROUTES,
  SECTION_LIMITS,
  SECTION_STATUSES,
  SECTION_TYPES,
  TARGET_PLATFORMS,
} from "../utils/page-sections.js";

/**
 * Backoffice "Sayfa bölümleri" form şemaları (spec 2026-09-28 §6). HTML formu düz alanlar gönderir:
 * dil başına `heading_tr`, `title_en`, `subtitle_en`, `cta_en`…; çoklu seçim tek değerse string, çoksa
 * dizi, hiç işaretlenmezse alan hiç gelmez.
 */

const COUNTRY_CODE = /^[A-Z]{2}$/;

type BannerTextInput = { title: string; subtitle?: string; cta_label?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const formText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
/** HTML checkbox: işaretliyse "on" gelir, işaretsizse alan hiç gelmez. */
const checkbox = z.preprocess((value) => value === "on" || value === "true" || value === true, z.boolean());

/** Çoklu seçim → tekrarsız liste; hiç seçilmediyse NULL (= hepsi). */
const multi = <T extends z.ZodTypeAny>(item: T) =>
  z
    .preprocess(
      (value) => (value === undefined || value === "" ? [] : Array.isArray(value) ? value : [value]),
      z.array(item),
    )
    .transform((list) => (list.length > 0 ? [...new Set(list)] : null));

const targeting = {
  countries: multi(z.string().regex(COUNTRY_CODE)),
  platforms: multi(z.enum(TARGET_PLATFORMS)),
  locales: multi(z.enum(SUPPORTED_LOCALES)),
};

/** `heading_tr`, `heading_en`… → `{ tr, en }`; boş alan atlanır. */
export function localizedFromForm(body: Record<string, unknown>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of SUPPORTED_LOCALES) {
    const value = formText(body[`${prefix}${locale}`]);
    if (value) out[locale] = value;
  }
  return out;
}

/**
 * `title_tr`, `subtitle_tr`, `cta_tr`… → `{ tr: { title, subtitle?, cta_label? } }`. Üçü de boşsa dil
 * atlanır; alt başlık ya da buton var ama başlık yoksa dil yine eklenir ve başlık `min(1)` ile reddedilir.
 */
export function bannerContentFromForm(body: Record<string, unknown>): Record<string, BannerTextInput> {
  const out: Record<string, BannerTextInput> = {};
  for (const locale of SUPPORTED_LOCALES) {
    const title = formText(body[`title_${locale}`]);
    const subtitle = formText(body[`subtitle_${locale}`]);
    const cta = formText(body[`cta_${locale}`]);
    if (!title && !subtitle && !cta) continue;
    out[locale] = { title, ...(subtitle ? { subtitle } : {}), ...(cta ? { cta_label: cta } : {}) };
  }
  return out;
}

export const sectionFormSchema = z
  .preprocess(
    (body) => (isRecord(body) ? { ...body, heading: localizedFromForm(body, "heading_") } : body),
    z.object({
      section_type: z.enum(SECTION_TYPES),
      heading: z.record(z.string().max(SECTION_LIMITS.headingLength)),
      ...targeting,
      autoplay_seconds: z.preprocess(
        emptyToUndefined,
        z.coerce
          .number()
          .int()
          .refine((n) => n === 0 || (n >= 3 && n <= 10), { message: "0 ya da 3–10 sn" })
          .default(5),
      ),
    }),
  )
  .transform((v) => ({ ...v, heading: Object.keys(v.heading).length > 0 ? v.heading : null }));

const bannerText = z.object({
  title: z.string().min(1, "başlık zorunlu").max(SECTION_LIMITS.titleLength),
  subtitle: z.string().max(SECTION_LIMITS.subtitleLength).optional(),
  cta_label: z.string().max(SECTION_LIMITS.ctaLength).optional(),
});

export const bannerItemFormSchema = z
  .preprocess(
    (body) => (isRecord(body) ? { ...body, content: bannerContentFromForm(body) } : body),
    z
      .object({
        content: z
          .record(bannerText)
          .refine((content) => Object.keys(content).length > 0, { message: "en az bir dilde başlık gerekli" }),
        action_type: z.enum(ACTION_TYPES),
        action_catalog_item_id: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
        action_route: z.preprocess(emptyToUndefined, z.enum(APP_ROUTES).optional()),
        ...targeting,
        is_active: checkbox,
      })
      .superRefine((v, ctx) => {
        if (v.action_type === "catalog_item" && !v.action_catalog_item_id) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action_catalog_item_id"], message: "hedef ürün seç" });
        }
        if (v.action_type === "app_route" && !v.action_route) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action_route"], message: "hedef sayfa seç" });
        }
      }),
  )
  // Türe ait olmayan hedef temizlenir: DB CHECK'i (071) `none` iken iki hedefin de NULL olmasını ister.
  .transform((v) => ({
    ...v,
    action_catalog_item_id: v.action_type === "catalog_item" ? (v.action_catalog_item_id ?? null) : null,
    action_route: v.action_type === "app_route" ? (v.action_route ?? null) : null,
  }));

export const featuredItemFormSchema = z.object({
  catalog_item_id: z.string().uuid(),
  ...targeting,
  is_active: checkbox,
});

export const sectionStatusSchema = z.object({ status: z.enum(SECTION_STATUSES) });
export const moveSchema = z.object({ direction: z.enum(["up", "down"]) });
/** Ölçüm tablosu penceresi; bozuk değer sayfayı patlatmaz, 7 güne düşer. */
export const sectionStatsQuerySchema = z.object({ days: z.enum(["7", "30"]).catch("7").transform(Number) });

export type SectionInput = z.infer<typeof sectionFormSchema>;
export type BannerItemInput = z.infer<typeof bannerItemFormSchema>;
export type FeaturedItemInput = z.infer<typeof featuredItemFormSchema>;
