/**
 * Seed locale yapılandırması — `seed-profiles/locales/<locale>.json` (tools/seed_locale.py ile ORTAK tek kaynak).
 *
 * CLI'lar `--locale` ile dosyayı okur (`loadSeedLocale`); kütüphane fonksiyonları `cfg` alır, verilmezse `TR_SEED_LOCALE`.
 * TR_SEED_LOCALE gömülü kopyadır: CI qulo-server'ı TEK BAŞINA klonlar, `seed-profiles/` orada yoktur. tr.json ile birebir
 * eşitliğini tests/scripts/seed-locales.test.ts doğrular (dosya varsa). Bu dosya yalnız TS'in kullandığı alanları okur;
 * Python tarafının coğrafya/filtre alanları `passthrough` ile görmezden gelinir.
 *
 * Kimlik ad alanı (global anahtar `<key_prefix>_NNNN`, seçim içindeki yerel kimlik `seed_NNNN`):
 *   e-posta `seed-<prefix>_NNNN@qulo.seed` · storage `seed/<prefix>_NNNN[_tag].jpg` · referral/RNG tohumu
 *   `<tür>:seed_NNNN` (TR, rng_namespace boş — mevcut 417 profil aynı kalır) ya da `<tür>:<ns>:seed_NNNN`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { FEMALE_NAMES, MALE_NAMES, SURNAMES } from "./data/tr-names.js";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const SEED_EMAIL_DOMAIN = "@qulo.seed";
const CODE = /^[a-z]{2}$/;

export type Gender = "WOMAN" | "MAN";
export type PersonalityKey = "introvert" | "extrovert" | "ambivert";
type Label = string | Readonly<Record<Gender, string>>;

const label = z.union([z.string().min(1), z.object({ WOMAN: z.string().min(1), MAN: z.string().min(1) })]);
const nameList = z.array(z.string().min(1)).min(1);

const rawSchema = z
  .object({
    locale: z.string().regex(CODE),
    key_prefix: z.string().regex(CODE),
    rng_namespace: z.string().regex(/^[a-z]{0,8}$/),
    country_iso2: z.string().regex(/^[A-Z]{2}$/),
    country_name_prompt: z.string().min(1),
    tz: z.string().min(1),
    bbox: z.object({ latMin: z.number(), latMax: z.number(), lngMin: z.number(), lngMax: z.number() }),
    location_template: z.string().startsWith("Location: ").endsWith("{country}."),
    user_city_from: z.enum(["district", "province"]),
    data_dir: z.string().regex(/^seed-profiles(?:\/[a-z]{2})?$/), // repo içi sabit kalıp: mutlak yol / `..` yok
    question_locale: z.string().regex(CODE),
    names: z.object({ female: nameList, male: nameList, surname: nameList }),
    personality: z.object({ introvert: label, extrovert: label, ambivert: label }),
  })
  .passthrough()
  .superRefine((r, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    // Silme kapsamı key_prefix'ten gelir: tr.json'dan kopyalanıp öneki unutulan locale TR seed'lerini silerdi.
    if (r.key_prefix !== r.locale) issue("key_prefix", "key_prefix locale ile aynı olmalı");
    // Boş namespace = TR'nin tarihî referral tohumları; başka locale boş bırakırsa referral_code UNIQUE çakışır.
    if ((r.rng_namespace === "") !== (r.locale === "tr") || (r.rng_namespace !== "" && r.rng_namespace !== r.locale)) {
      issue("rng_namespace", "rng_namespace yalnız TR'de boş, diğerlerinde locale kodu olmalı");
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: r.tz }); // yazım hatası zamanlamayı sessizce İstanbul'a düşürürdü
    } catch {
      issue("tz", `geçersiz IANA saat dilimi: ${r.tz}`);
    }
    if (!r.location_template.includes("{district}") || !r.location_template.includes("{province}")) {
      issue("location_template", "şablon {district} ve {province} içermeli (konum kontrolü anlamsızlaşır)");
    }
    if (!(r.bbox.latMin < r.bbox.latMax && r.bbox.lngMin < r.bbox.lngMax)) issue("bbox", "bbox min < max olmalı");
  });

export interface SeedLocale {
  locale: string;
  keyPrefix: string;
  /** Boş = TR tarihî RNG anahtarları (`referral:seed_0001`); dolu = `referral:<ns>:seed_0001`. */
  rngNamespace: string;
  countryIso2: string;
  countryNamePrompt: string;
  /** IANA saat dilimi — seed_persona.tz (bot uyku/mesai penceresi). */
  tz: string;
  bbox: { latMin: number; latMax: number; lngMin: number; lngMax: number };
  locationTemplate: string;
  /** users.city kaynağı: TR ilçe (gerçek kullanıcılar da ilçe taşır), IT comune. */
  userCityFrom: "district" | "province";
  /** Repo köküne göre veri dizini (TR `seed-profiles`, IT `seed-profiles/it`). */
  dataDir: string;
  questionLocale: string;
  names: { female: readonly string[]; male: readonly string[]; surname: readonly string[] };
  personality: Readonly<Record<PersonalityKey, Label>>;
}

export function parseSeedLocale(raw: unknown): SeedLocale {
  const r = rawSchema.parse(raw);
  return {
    locale: r.locale,
    keyPrefix: r.key_prefix,
    rngNamespace: r.rng_namespace,
    countryIso2: r.country_iso2,
    countryNamePrompt: r.country_name_prompt,
    tz: r.tz,
    bbox: r.bbox,
    locationTemplate: r.location_template,
    userCityFrom: r.user_city_from,
    dataDir: r.data_dir,
    questionLocale: r.question_locale,
    names: r.names,
    personality: r.personality,
  };
}

export function localeConfigPath(locale: string, root = REPO_ROOT): string {
  if (!CODE.test(locale)) throw new Error(`--locale iki küçük harf olmalı: ${locale}`);
  return resolve(root, "seed-profiles/locales", `${locale}.json`);
}

/**
 * `seed-profiles/locales/<locale>.json` → doğrulanmış yapılandırma; dosya adı = `locale` (= `key_prefix`, şema kuralı).
 * Hata mesajı dosya yolunu taşır.
 */
export function loadSeedLocale(locale: string, root = REPO_ROOT): SeedLocale {
  const path = localeConfigPath(locale, root);
  let cfg: SeedLocale;
  try {
    cfg = parseSeedLocale(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (cfg.locale !== locale) throw new Error(`${path}: locale alanı (${cfg.locale}) dosya adıyla aynı olmalı`);
  return cfg;
}

/**
 * CLI'ların locale çözümü: TR → gömülü `TR_SEED_LOCALE` (kütüphane varsayılanı + TR altın testiyle AYNI nesne; dosyasız klonda da
 * çalışır; tr.json eşitliği seed-locales.test.ts'de), diğerleri → `loadSeedLocale`.
 */
export function resolveSeedLocale(locale = "tr", root = REPO_ROOT): SeedLocale {
  localeConfigPath(locale, root); // biçim doğrulaması (iki küçük harf)
  return locale === TR_SEED_LOCALE.locale ? TR_SEED_LOCALE : loadSeedLocale(locale, root);
}


/** Gömülü TR — tr.json ile birebir (tests/scripts/seed-locales.test.ts). İsimler data/tr-names.ts'den (aynı sıra). */
export const TR_SEED_LOCALE: SeedLocale = parseSeedLocale({
  locale: "tr",
  key_prefix: "tr",
  rng_namespace: "",
  country_iso2: "TR",
  country_name_prompt: "Türkiye",
  tz: "Europe/Istanbul",
  bbox: { latMin: 35.8, latMax: 42.2, lngMin: 25.6, lngMax: 45.0 },
  location_template: "Location: {district}, {province}, {country}.",
  user_city_from: "district",
  data_dir: "seed-profiles",
  question_locale: "tr",
  names: { female: FEMALE_NAMES, male: MALE_NAMES, surname: SURNAMES },
  personality: { introvert: "İçe dönük", extrovert: "Dışa dönük", ambivert: "Ambivert" },
});

const KEYS: readonly PersonalityKey[] = ["introvert", "extrovert", "ambivert"];

/** Kişilik etiketleri; cinsiyet verilirse yalnız o cinsiyetin formu (İtalyanca "Estroversa/Estroverso"). */
export function personalityLabels(cfg: SeedLocale, gender?: Gender): string[] {
  return KEYS.flatMap((k) => {
    const v = cfg.personality[k];
    if (typeof v === "string") return [v];
    return gender ? [v[gender]] : [v.WOMAN, v.MAN];
  });
}

/** tools/seed_prepare.py `location_sentence` ile birebir: `Location: <ilçe>, <il>, <ülke>.` */
export function formatLocation(cfg: SeedLocale, district: string, province: string): string {
  return cfg.locationTemplate.replace("{district}", district).replace("{province}", province).replace("{country}", cfg.countryNamePrompt);
}

/** Deterministik RNG tohumu: TR `user:seed_0001` (mevcut kayıtlar), diğerleri `user:it:seed_0001` (locale'ler arası bağımsız). */
export function seedRngKey(cfg: SeedLocale, kind: string, seedId: string): string {
  return cfg.rngNamespace ? `${kind}:${cfg.rngNamespace}:${seedId}` : `${kind}:${seedId}`;
}

/** PostgREST LIKE deseni (alt çizgi kaçışlı) — yalnız bu locale'in seed e-postaları. JS tarafı ayrıca SEED_EMAIL_RE ile süzer. */
export function seedEmailLike(cfg: SeedLocale): string {
  return `seed-${cfg.keyPrefix}\\_%${SEED_EMAIL_DOMAIN}`;
}

export const SEED_EMAIL_RE = new RegExp(`^seed-([a-z]{2})_(\\d{4})${SEED_EMAIL_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** `seed-it_0012@qulo.seed` → { prefix: "it", seedId: "seed_0012" }; seed deseni değilse null. */
export function parseSeedEmail(email: string | null | undefined): { prefix: string; seedId: string } | null {
  const m = SEED_EMAIL_RE.exec(email ?? "");
  return m ? { prefix: m[1], seedId: `seed_${m[2]}` } : null;
}

/** Locale veri dosyaları (repo köküne göre): seçim `<prefix>-selection.json` (TR seed-profiles/tr-selection.json), manifest. */
export function seedDataPaths(cfg: SeedLocale, root = REPO_ROOT) {
  const dir = resolve(root, cfg.dataDir);
  return { selection: resolve(dir, `${cfg.keyPrefix}-selection.json`), manifest: resolve(dir, "photos-manifest.json") };
}

/**
 * Persona türetimi (derive-seed-persona.ts) için kararlı kova anahtarı: TR `seed_0582` (mevcut 416 persona aynı kovada kalır),
 * diğer locale'ler `it_0001` (aynı numaralı TR seed'iyle kova paylaşmaz). Seed e-postası değilse `fallback` (users.id).
 */
export function personaSeedKey(email: string | null | undefined, fallback: string): string {
  const parsed = parseSeedEmail(email);
  if (!parsed) return fallback;
  return parsed.prefix === TR_SEED_LOCALE.keyPrefix ? parsed.seedId : `${parsed.prefix}_${parsed.seedId.slice("seed_".length)}`;
}
