import { z } from "zod";

/** Marka anahtarları — `reward_catalog_items.brand_key` CHECK'i (067) ile aynı liste. */
export const REWARD_BRANDS = [
  "GRAB", "GOPAY", "DANA", "OVO", "SHOPEEPAY", "TRUEMONEY", "LINEMAN", "TNG", "FOODPANDA", "OTHER",
] as const;
export type RewardBrand = (typeof REWARD_BRANDS)[number];

export const REDEMPTION_STATUSES = ["PENDING", "FULFILLED", "REJECTED"] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];

const COUNTRY_CODE = /^[A-Z]{2}$/;

/** Form alanı: boş ya da yalnız boşluk = verilmedi. */
const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const trimmed = (value: unknown) => (typeof value === "string" ? value.trim() : value);
const optionalText = (max: number) =>
  z.preprocess((value) => emptyToUndefined(trimmed(value)), z.string().max(max).optional());
const httpsUrl = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().url().max(max).startsWith("https://").optional());
/** HTML checkbox: işaretliyse "on" gelir, işaretsizse alan hiç gelmez. */
const checkbox = z.preprocess((value) => value === "on" || value === "true" || value === true, z.boolean());
const optionalCountry = z
  .preprocess(emptyToUndefined, z.string().regex(COUNTRY_CODE).optional())
  .catch(undefined);
const pageParam = z.coerce.number().int().min(1).catch(1);

// ── Mobil ────────────────────────────────────────────────────────────

export const redeemSchema = z.object({
  item_id: z.string().uuid(),
  /** İstemci onay ekranı açılınca BİR kez üretir; aynı anahtarla tekrar = aynı talep, ikinci düşüm yok. */
  idempotency_key: z.string().uuid(),
});

export const redemptionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ── Backoffice (form gövdeleri string gelir) ─────────────────────────

export const countrySwitchSchema = z.object({
  enabled: checkbox,
  android_enabled: checkbox,
  ios_enabled: checkbox,
});

/** Para birimi formda yok: ülkenin para birimidir (servis `reward_market_countries`'ten okur). */
export const catalogItemSchema = z.object({
  brand_key: z.enum(REWARD_BRANDS),
  country_code: z.string().regex(COUNTRY_CODE),
  face_value: z.coerce.number().positive().max(100_000_000),
  cost_usd: z.preprocess(emptyToUndefined, z.coerce.number().positive().max(1000).optional()),
  rainbow_price: z.coerce.number().int().min(1).max(100_000),
  sort_order: z.preprocess(emptyToUndefined, z.coerce.number().int().min(-1000).max(1000).default(0)),
  logo_url: httpsUrl(500),
  is_active: checkbox,
});

export const fulfillSchema = z
  .object({
    delivery_code: optionalText(500),
    delivery_url: httpsUrl(1000),
    admin_note: optionalText(500),
  })
  .refine((v) => v.delivery_code !== undefined || v.delivery_url !== undefined, {
    message: "Teslim kodu ya da link gerekli",
    path: ["delivery_code"],
  });

export const rejectSchema = z.object({
  reject_reason: z.preprocess(trimmed, z.string().min(1).max(500)),
});

/** Admin liste filtreleri: bozuk değer sayfayı patlatmaz, varsayılana düşer. */
export const adminRedemptionsQuerySchema = z.object({
  status: z.enum(["PENDING", "FULFILLED", "REJECTED", "ALL"]).catch("PENDING"),
  q: optionalText(100).catch(undefined),
  country: optionalCountry,
  page: pageParam,
});

export const adminCatalogQuerySchema = z.object({
  brand: z.preprocess(emptyToUndefined, z.enum(REWARD_BRANDS).optional()).catch(undefined),
  country: optionalCountry,
  status: z.enum(["active", "inactive", "all"]).catch("all"),
  page: pageParam,
});

export type RedeemInput = z.infer<typeof redeemSchema>;
export type RedemptionsQuery = z.infer<typeof redemptionsQuerySchema>;
export type CountrySwitchInput = z.infer<typeof countrySwitchSchema>;
export type CatalogItemInput = z.infer<typeof catalogItemSchema>;
export type FulfillInput = z.infer<typeof fulfillSchema>;
export type AdminRedemptionsQuery = z.infer<typeof adminRedemptionsQuerySchema>;
export type AdminCatalogQuery = z.infer<typeof adminCatalogQuerySchema>;
