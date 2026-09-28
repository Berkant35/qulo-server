import type { ZodError } from "zod";
import { adminIdParamSchema } from "../validators/rewards.validator.js";

/**
 * Backoffice form/flash yardımcıları — Rainbow Market ekranlarının ortak kalıbı
 * (`?error=` / `?notice=` kodu, uuid `:id`, zod hata özeti).
 */

/** Yalnız haritanın KENDİ anahtarı: `?error=constructor` prototip üyesine düşmesin. */
export function flashMessage(map: Record<string, string>, key: unknown): string | null {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

/** Admin `:id` uuid değilse null: servis (ve PostgREST'in uuid dönüşüm hatası → 500) hiç çağrılmaz. */
export function uuidParam(value: unknown): string | null {
  const parsed = adminIdParamSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function zodIssues(error: ZodError): string {
  return error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(" · ");
}
