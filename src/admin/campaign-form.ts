import type { ZodIssue } from "zod";
import { createCampaignSchema, type CampaignVariant } from "../validators/campaign.validator.js";

/**
 * Backoffice kampanya formu (urlencoded) → CreateCampaignInput. Sunum katmani bilgisi
 * (alan adlari, checkbox dizisi, "Baslik | Govde" satir formati) burada; dogrulama validator'da.
 */
type FormBody = Record<string, unknown>;

function text(body: FormBody, key: string): string | undefined {
  const raw = body[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Bos → undefined; sayi degilse NaN (zod "expected number, received nan" ile reddeder). */
function int(body: FormBody, key: string): number | undefined {
  const raw = text(body, key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

function csv(body: FormBody, key: string): string[] | undefined {
  const raw = text(body, key);
  if (raw === undefined) return undefined;
  const list = raw.split(",").map((v) => v.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

/** Checkbox grubu: tek secimde string, cok secimde dizi gelir; hic secilmemisse bos dizi. */
function intList(body: FormBody, key: string): number[] {
  const raw = body[key];
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return values.map((v) => Number(v)).filter((n) => Number.isFinite(n));
}

/** Textarea, satir basina "Baslik | Govde". Ayrac yoksa satir govde, baslik push_title'dan gelir. */
export function parseVariantLines(raw: string | undefined, fallbackTitle: string | undefined): CampaignVariant[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const sep = line.indexOf("|");
      if (sep === -1) return { title: fallbackTitle ?? "", body: line };
      return { title: line.slice(0, sep).trim(), body: line.slice(sep + 1).trim() };
    });
}

export function parseCampaignForm(body: FormBody): ReturnType<typeof createCampaignSchema.safeParse> {
  const segment: Record<string, unknown> = {};
  const gender = text(body, "segment_gender");
  if (gender) segment.gender = gender;
  const ageMin = int(body, "segment_age_min");
  if (ageMin !== undefined) segment.age_min = ageMin;
  const ageMax = int(body, "segment_age_max");
  if (ageMax !== undefined) segment.age_max = ageMax;
  const cities = csv(body, "segment_cities");
  if (cities) segment.cities = cities;
  const sub = text(body, "segment_subscription");
  if (sub) segment.subscription_plan = sub;
  const lastActive = int(body, "segment_last_active");
  if (lastActive !== undefined) segment.last_active_days = lastActive;
  const compMin = int(body, "segment_completion_min");
  if (compMin !== undefined) segment.profile_completion_min = compMin;
  const compMax = int(body, "segment_completion_max");
  if (compMax !== undefined) segment.profile_completion_max = compMax;
  const registeredAfter = text(body, "segment_registered_after");
  if (registeredAfter) segment.registered_after = registeredAfter;
  const locales = csv(body, "segment_locales");
  if (locales) segment.locales = locales.map((l) => l.toLowerCase());

  const pushTitle = text(body, "push_title");
  const recurrence = text(body, "recurrence") ?? "none";
  const candidate = {
    title: text(body, "title"),
    push_title: pushTitle,
    push_body: text(body, "push_body"),
    image_url: text(body, "image_url"),
    action_url: text(body, "action_url"),
    action_label: text(body, "action_label"),
    segment,
    scheduled_at: text(body, "scheduled_at"),
    recurrence,
    // Tekrarlayan formda gun listesi her zaman gonderilir; hic secilmemisse [] → validator reddeder.
    recurrence_days: recurrence === "daily" ? intList(body, "recurrence_days") : undefined,
    window_start_hour: int(body, "window_start_hour"),
    window_end_hour: int(body, "window_end_hour"),
    variants: parseVariantLines(text(body, "variants"), pushTitle),
  };
  return createCampaignSchema.safeParse(candidate);
}

export function formatZodIssues(issues: ZodIssue[]): string {
  return issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`).join(" · ");
}
