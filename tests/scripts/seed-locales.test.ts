/**
 * Seed hattı locale genelleştirmesi (scripts/seed/locales.ts + tr-seed-lib.ts `cfg` parametreleri).
 * - TR ALTIN: genelleştirme öncesi koddan donmuş TR değerleri (isim/soyisim/referral/tercih/soru seçimi) aynen.
 * - Kimlik ad alanı: aynı seed_NNNN iki locale'de çakışmaz (e-posta, storage, referral, RNG).
 * - Silme / yetim temizliği locale kapsamlı ve 1.000 satırı aşınca sayfalı (canlı dosya "yetim" sanılmaz).
 * CI qulo-server'ı tek başına klonlar: seed-profiles/locales/*.json yoksa dosya testleri atlanır, geri kalanı gömülü/
 * satır içi yapılandırmayla koşar.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "../helpers/fake-supabase.js";
import {
  REPO_ROOT,
  TR_SEED_LOCALE,
  formatLocation,
  loadSeedLocale,
  localeConfigPath,
  parseSeedEmail,
  parseSeedLocale,
  personaSeedKey,
  personalityLabels,
  resolveSeedLocale,
  seedDataPaths,
  seedEmailLike,
  seedRngKey,
} from "../../scripts/seed/locales.js";
import { parseFlags, parseSeedIdList } from "../../scripts/seed/cli-args.js";
import { buildSeedPersona, localeForSeedRow } from "../../scripts/seed/persona-derive-lib.js";
import { parseDeleteArgs } from "../../scripts/seed/delete-tr-test-profiles.js";
import { parseSplitArgs } from "../../scripts/seed/split-lgbt-seeds.js";
import {
  buildDetailsRow,
  buildUserRow,
  cleanupSeedOrphans,
  deleteSeedProfiles,
  makeSelectionEntrySchema,
  parseSelection,
  pickQuestions,
  referralCode,
  replaceSeedPhoto,
  seedEmail,
  seedProfile,
  sha1,
  storagePath,
  verifySeedProfile,
  type BankQuestion,
  type PhotoMeta,
  type SelectionEntry,
} from "../../scripts/seed/tr-seed-lib.js";
import { loadSeedCandidates, mentionsGender } from "../../scripts/seed/lgbt-seed-split-lib.js";

/** Satır içi İtalya yapılandırması (CI'da dosya yok) — seed-profiles/locales/it.json'un TS alt kümesiyle aynı biçim. */
const IT_RAW = {
  locale: "it", key_prefix: "it", rng_namespace: "it", country_iso2: "IT", country_name_prompt: "Italy", tz: "Europe/Rome",
  bbox: { latMin: 35.4, latMax: 47.1, lngMin: 6.6, lngMax: 18.6 },
  location_template: "Location: {district}, {province}, {country}.", user_city_from: "province",
  data_dir: "seed-profiles/it", question_locale: "it",
  names: { female: ["Giulia", "Chiara", "Sara"], male: ["Marco", "Luca", "Matteo"], surname: ["Rossi", "Russo", "Ferrari"] },
  personality: {
    introvert: { WOMAN: "Introversa", MAN: "Introverso" },
    extrovert: { WOMAN: "Estroversa", MAN: "Estroverso" },
    ambivert: { WOMAN: "Ambiversa", MAN: "Ambiverso" },
  },
};
const IT = parseSeedLocale(IT_RAW);

const TR_PROMPT = "Amateur close-up selfie. Location: Bornova, İzmir, Türkiye. A 26-year-old Turkish woman, natural skin texture. Real amateur smartphone photo look.";
const IT_PROMPT = "Casual selfie. Location: Isola, Milano, Italy. A 28-year-old Italian woman, natural skin texture. Real amateur smartphone photo look.";
const NOW = new Date("2026-09-15T10:00:00Z");
const bank: BankQuestion[] = Array.from({ length: 10 }, (_, i) => ({ question_text: `Q${i}`, answers: ["a", "b", "c", "d"], category: null, hint: null, target_gender: null }));

const trEntry = (seed_id: string, gender: "WOMAN" | "MAN", age: number): SelectionEntry => ({
  seed_id, gender, age, prompt: TR_PROMPT, prompt_sha1: sha1(TR_PROMPT), relationship_goal: "NOT_SURE", bio: "x".repeat(30),
  interests: ["music", "travel", "food"], height: null, province: "İzmir", district: "Bornova", lat: 38.4, lng: 27.1, job: "Hemşire",
  personality: "Ambivert", pets: null, music_type: null, smoking: "NO", alcohol: "NO", selected: true,
});
const itEntry = (over: Partial<SelectionEntry> = {}): SelectionEntry => ({
  seed_id: "seed_0015", gender: "WOMAN", age: 28, prompt: IT_PROMPT, prompt_sha1: sha1(IT_PROMPT), relationship_goal: "SERIOUS",
  bio: "La domenica giro il mercato di Isola e poi colazione lunga.", interests: ["food", "music", "travel"], height: 166,
  province: "Milano", district: "Isola", lat: 45.487, lng: 9.189, job: "Barista", personality: "Estroversa", pets: null,
  music_type: "Indie italiano", smoking: "NO", alcohol: "SOMETIMES", selected: true, ...over,
});
const meta = (prompt: string): PhotoMeta => ({ model: "m", prompt_sha1: sha1(prompt), generated_at: "2026-10-13T10:00:00Z", replicate_id: "pred_1" });

describe("locales — gömülü TR = tr.json, it.json geçerli (dosya varsa)", () => {
  const trPath = localeConfigPath("tr");
  const itPath = localeConfigPath("it");

  it.skipIf(!existsSync(trPath))("tr.json ↔ TR_SEED_LOCALE birebir (isim sırası dahil)", () => {
    expect(parseSeedLocale(JSON.parse(readFileSync(trPath, "utf8")))).toEqual(TR_SEED_LOCALE);
  });

  it.skipIf(!existsSync(itPath))("it.json: ad alanı it, Europe/Rome, comune, cinsiyetli kişilik, 40+ isim", () => {
    const it_ = parseSeedLocale(JSON.parse(readFileSync(itPath, "utf8")));
    expect([it_.keyPrefix, it_.rngNamespace, it_.tz, it_.userCityFrom, it_.questionLocale, it_.countryIso2]).toEqual(["it", "it", "Europe/Rome", "province", "it", "IT"]);
    expect(personalityLabels(it_, "MAN")).toEqual(["Introverso", "Estroverso", "Ambiverso"]);
    expect(it_.names.female.length).toBeGreaterThanOrEqual(40);
    expect(seedDataPaths(it_).selection).toBe(resolve(REPO_ROOT, "seed-profiles/it/it-selection.json"));
  });

  it("TR veri yolları tarihî (seed-profiles/tr-selection.json); geçersiz locale kodu reddedilir", () => {
    expect(seedDataPaths(TR_SEED_LOCALE)).toEqual({
      selection: resolve(REPO_ROOT, "seed-profiles/tr-selection.json"), manifest: resolve(REPO_ROOT, "seed-profiles/photos-manifest.json"),
    });
    expect(() => localeConfigPath("ITA")).toThrow(/iki küçük harf/);
    expect(resolveSeedLocale("tr")).toBe(TR_SEED_LOCALE);   // CLI'lar TR'de kütüphane varsayılanıyla AYNI nesneyi kullanır
    expect(resolveSeedLocale()).toBe(TR_SEED_LOCALE);
  });

  it("şema: öneki unutulmuş kopya, boş rng ad alanı, bozuk saat dilimi, eksik yer tutucu, ters kutu, dış veri dizini reddedilir", () => {
    const bad = (over: object) => () => parseSeedLocale({ ...IT_RAW, ...over });
    expect(bad({ key_prefix: "tr" })).toThrow(/key_prefix/);                 // tr.json'dan kopyalanan es.json TR'yi silerdi
    expect(bad({ rng_namespace: "" })).toThrow(/rng_namespace/);              // referral_code UNIQUE çakışması
    expect(bad({ rng_namespace: "es" })).toThrow(/rng_namespace/);
    expect(bad({ tz: "Europe/Roma" })).toThrow(/IANA/);                       // sessizce İstanbul'a düşerdi
    expect(bad({ location_template: "Location: {country}." })).toThrow(/district/);
    expect(bad({ bbox: { latMin: 47.1, latMax: 35.4, lngMin: 6.6, lngMax: 18.6 } })).toThrow(/bbox/);
    expect(bad({ data_dir: "../../etc" })).toThrow();
    expect(() => parseSeedLocale({ ...IT_RAW, locale: "tr", key_prefix: "tr" })).toThrow(/rng_namespace/);  // TR ad alanı boş olmalı
  });

  it("loadSeedLocale: dosya adı = locale, hata mesajı yolu taşır", () => {
    const root = mkdtempSync(join(tmpdir(), "seed-loc-"));
    mkdirSync(join(root, "seed-profiles/locales"), { recursive: true });
    writeFileSync(join(root, "seed-profiles/locales/it.json"), JSON.stringify(IT_RAW));
    writeFileSync(join(root, "seed-profiles/locales/es.json"), JSON.stringify(IT_RAW));       // içi İtalya
    writeFileSync(join(root, "seed-profiles/locales/fr.json"), "{bozuk");
    expect(loadSeedLocale("it", root)).toEqual(IT);
    expect(() => loadSeedLocale("es", root)).toThrow(/es\.json: locale alanı \(it\)/);
    expect(() => loadSeedLocale("fr", root)).toThrow(/fr\.json/);
    expect(() => loadSeedLocale("de", root)).toThrow(/ENOENT/);
  });
});

describe("locales — yardımcılar", () => {
  it("konum cümlesi, RNG anahtarı, e-posta deseni ve ayrıştırma", () => {
    expect(formatLocation(TR_SEED_LOCALE, "Kadıköy", "İstanbul")).toBe("Location: Kadıköy, İstanbul, Türkiye.");
    expect(formatLocation(IT, "Isola", "Milano")).toBe("Location: Isola, Milano, Italy.");
    expect(seedRngKey(TR_SEED_LOCALE, "referral", "seed_0001")).toBe("referral:seed_0001");   // TR tohumu değişmedi
    expect(seedRngKey(IT, "referral", "seed_0001")).toBe("referral:it:seed_0001");
    expect(seedEmailLike(IT)).toBe("seed-it\\_%@qulo.seed");
    expect(parseSeedEmail("seed-it_0012@qulo.seed")).toEqual({ prefix: "it", seedId: "seed_0012" });
    expect(parseSeedEmail("seed-itx0012@qulo.seed")).toBeNull();                                // LIKE `_` jokerinin yakaladığı sahte
    expect(parseSeedEmail("gercek@gmail.com")).toBeNull();
  });

  it("persona: TR kova anahtarı seed_NNNN (mevcut 416 persona), IT it_NNNN; tz locale'den; uyku penceresi 7 saat", () => {
    expect(personaSeedKey("seed-tr_0582@qulo.seed", "uid")).toBe("seed_0582");
    expect(personaSeedKey("seed-it_0582@qulo.seed", "uid")).toBe("it_0582");
    expect(personaSeedKey("biri@gmail.com", "uid")).toBe("uid");
    const now = new Date("2026-10-13T10:00:00Z");
    const tr = buildSeedPersona({ email: "seed-tr_0582@qulo.seed", userId: "u", personality: "Dışa dönük", pattern: "ofis", cfg: TR_SEED_LOCALE, model: "m", now });
    const it_ = buildSeedPersona({ email: "seed-it_0582@qulo.seed", userId: "u", personality: "Estroversa", pattern: "vardiya_gece", cfg: IT, model: "m", now });
    expect([tr.seedKey, tr.persona.tz, it_.seedKey, it_.persona.tz]).toEqual(["seed_0582", "Europe/Istanbul", "it_0582", "Europe/Rome"]);
    // 582 % 181 = 39 → kayma -51: ofis 00:30-51 = 23:39 (1419), vardiya_gece 08:00-51 = 07:09 (429)
    expect(tr.persona.sleep_window).toEqual({ start_min: 1419, end_min: (1419 + 420) % 1440 });
    expect(it_.persona.sleep_window).toEqual({ start_min: 429, end_min: 849 });
    expect(tr.persona.derived_at).toBe(now.toISOString());
  });

  it("persona kapsamı: --locale it yalnız tam seed-it_NNNN; kapsamsızda önekten, desen dışı eski satır TR, dosyası yok → atla", () => {
    const resolve_ = (prefix: string) => (prefix === "it" ? IT : null);
    expect(localeForSeedRow("seed-it_0001@qulo.seed", IT, resolve_)).toBe(IT);
    expect(localeForSeedRow("seed-it_elle@qulo.seed", IT, resolve_)).toBeNull();   // LIKE'a uyar; TR'ye düşüp İstanbul saati almaz
    expect(localeForSeedRow("seed-tr_0001@qulo.seed", IT, resolve_)).toBeNull();
    expect(localeForSeedRow("seed-it_0001@qulo.seed", null, resolve_)).toBe(IT);
    expect(localeForSeedRow("eski@qulo.seed", null, resolve_)).toBe(TR_SEED_LOCALE);
    expect(localeForSeedRow("seed-es_0001@qulo.seed", null, resolve_)).toBeNull();
  });
});

describe("seed CLI'ları — katı argüman ayrıştırma (yazım hatası TR'ye düşüp silmesin)", () => {
  it("parseFlags: bilinmeyen bayrak, `--locale=it` biçimi ve değersiz değer bayrağı fırlatır", () => {
    const known = { bool: ["--confirm"], value: ["--locale"] };
    expect(() => parseFlags(["--loacle", "it", "--confirm"], known)).toThrow(/bilinmeyen argüman: --loacle/);
    expect(() => parseFlags(["--locale=it", "--confirm"], known)).toThrow(/bilinmeyen argüman: --locale=it/);
    expect(() => parseFlags(["--locale", "--confirm"], known)).toThrow(/--locale değer ister/);
    expect(() => parseFlags(["--locale"], known)).toThrow(/--locale değer ister/);
    const f = parseFlags(["--confirm", "--locale", "it"], known);
    expect([f.has("--confirm"), f.get("--locale"), f.has("--locale")]).toEqual([true, "it", true]);
  });

  it("--only yalnız seed_NNNN listesi kabul eder", () => {
    expect(parseSeedIdList("seed_0015, seed_0064")).toEqual(["seed_0015", "seed_0064"]);
    expect(() => parseSeedIdList("15,tr_0015")).toThrow(/seed_NNNN/);
    expect(() => parseSeedIdList(" , ")).toThrow(/seed_id listesi/);
  });

  it("silme CLI'ı: TR varsayılanı gömülü yapılandırma; yazım hataları ve bozuk --only reddedilir", () => {
    const a = parseDeleteArgs(["--confirm", "--only", "seed_0015"]);
    expect([a.confirm, a.orphans, a.only, a.locale]).toEqual([true, false, ["seed_0015"], TR_SEED_LOCALE]);
    expect(() => parseDeleteArgs(["--confirm", "--loacle", "it"])).toThrow(/bilinmeyen argüman/);
    expect(() => parseDeleteArgs(["--confirm", "--locale=it"])).toThrow(/bilinmeyen argüman/);
    expect(() => parseDeleteArgs(["--locale", "ITA"])).toThrow(/iki küçük harf/);
    expect(() => parseDeleteArgs(["--only", "15", "--confirm"])).toThrow(/seed_NNNN/);
    expect(parseDeleteArgs(["--orphans"]).orphans).toBe(true);
  });

  it("LGBT ayrım CLI'ı: hedef sayılar ve katı bayraklar", () => {
    expect(parseSplitArgs([])).toEqual({ confirm: false, target: { men: 30, women: 15 }, locale: TR_SEED_LOCALE });
    expect(parseSplitArgs(["--men", "8", "--women", "4", "--confirm"]).target).toEqual({ men: 8, women: 4 });
    expect(() => parseSplitArgs(["--locale=it", "--confirm"])).toThrow(/bilinmeyen argüman/);
    expect(() => parseSplitArgs(["--men", "-1"])).toThrow(/pozitif/);
  });

  it.skipIf(!existsSync(localeConfigPath("it")))("--locale it gerçek it.json'u yükler", () => {
    expect(parseDeleteArgs(["--locale", "it"]).locale.keyPrefix).toBe("it");
  });
});

describe("tr-seed-lib — TR ALTIN (genelleştirme öncesi koddan donmuş değerler)", () => {
  // scratchpad/ts_golden.ts ile 2026-10-13'te DEĞİŞİKLİKTEN ÖNCE üretildi. Kırmızı = TR seed'in yeniden basımında farklı kişi.
  const GOLDEN = {
    seed_0015: { name: "Ayşe", surname: "Ateş", referral: "S3P6QG5S", prefMin: 21, prefMax: 31, radius: 82, completion: 78, diamonds: 28, last_seen: "2026-09-14T23:17:06.869Z", height: 161, zodiac: "gemini", questions: ["Q3:1", "Q7:3", "Q5:4"] },
    seed_0897: { name: "Murat", surname: "Çakır", referral: "SBWNMQP2", prefMin: 28, prefMax: 35, radius: 56, completion: 91, diamonds: 13, last_seen: "2026-09-13T12:30:07.745Z", height: 182, zodiac: "cancer", questions: ["Q0:2", "Q5:4", "Q7:1"] },
    seed_0001: { name: "Tuba", surname: "Işık", referral: "SVHIOEJI", prefMin: 18, prefMax: 25, radius: 41, completion: 90, diamonds: 36, last_seen: "2026-09-14T17:19:28.116Z", height: 164, zodiac: "leo", questions: ["Q9:4", "Q3:1", "Q0:3"] },
  } as const;
  const cases: Array<[keyof typeof GOLDEN, "WOMAN" | "MAN", number]> = [["seed_0015", "WOMAN", 26], ["seed_0897", "MAN", 31], ["seed_0001", "WOMAN", 19]];

  it.each(cases)("%s: isim/soyisim/referral/tercih/boy/burç/soru seçimi aynı", (sid, gender, age) => {
    const e = trEntry(sid, gender, age);
    const u = buildUserRow(e, "u", meta(TR_PROMPT), "h", NOW);
    const d = buildDetailsRow(e, "uid");
    const qs = pickQuestions(bank, e, "uid");
    expect({
      name: u.name, surname: u.surname, referral: u.referral_code, prefMin: u.age_pref_min, prefMax: u.age_pref_max, radius: u.match_radius_km,
      completion: u.profile_completion, diamonds: u.green_diamonds, last_seen: u.last_seen_at, height: d.height, zodiac: d.zodiac,
      questions: qs.map((q) => `${q.question_text}:${q.correct_answer}`),
    }).toEqual(GOLDEN[sid]);
    expect([u.email, u.country, u.locale, u.city]).toEqual([`seed-tr_${sid.slice(5)}@qulo.seed`, "TR", "tr", "Bornova"]);
  });
});

describe("tr-seed-lib — İtalya ad alanı ve satırlar", () => {
  it("e-posta / storage / referral aynı seed_NNNN için TR ile çakışmaz; 1.000 + 1.000 kod benzersiz", () => {
    expect(seedEmail("seed_0001", IT)).toBe("seed-it_0001@qulo.seed");
    expect(storagePath("seed_0001", "abc", IT)).toBe("seed/it_0001_abc.jpg");
    expect(referralCode("seed_0001", IT)).not.toBe(referralCode("seed_0001"));
    const ids = Array.from({ length: 1000 }, (_, i) => `seed_${String(i + 1).padStart(4, "0")}`);
    const all = new Set([...ids.map((s) => referralCode(s)), ...ids.map((s) => referralCode(s, IT))]);
    expect(all.size).toBe(2000);
  });

  it("users satırı: comune city'de, IT ülke/dil, İtalyan isim havuzu; RNG TR'den bağımsız", () => {
    const e = itEntry();
    const row = buildUserRow(e, "https://x/seed/it_0015.jpg", meta(IT_PROMPT), "h", NOW, null, IT);
    expect([row.email, row.city, row.country, row.locale]).toEqual(["seed-it_0015@qulo.seed", "Milano", "IT", "it"]);
    expect(row.preferred_languages).toEqual(["it"]);
    expect(IT.names.female).toContain(row.name);
    expect(IT.names.surname).toContain(row.surname);
    expect(row.photo_prompt).toMatchObject({ seed_id: "seed_0015", province: "Milano", district: "Isola" });
    expect(pickQuestions(bank, e, "uid", IT).every((q) => q.locale === "it")).toBe(true);
    // aynı numaralı TR seed'iyle tercih/zaman ilişkisi yok (rng_namespace): en az bir alan farklı
    const tr = buildUserRow({ ...e, prompt: TR_PROMPT, prompt_sha1: sha1(TR_PROMPT) }, "u", meta(TR_PROMPT), "h", NOW);
    expect([row.age_pref_min, row.age_pref_max, row.match_radius_km, row.last_seen_at]).not.toEqual([tr.age_pref_min, tr.age_pref_max, tr.match_radius_km, tr.last_seen_at]);
  });

  it("seçim şeması fabrikası: ülke kutusu, cinsiyetli kişilik etiketi, İtalyanca konum cümlesi", () => {
    const parse = (e: object) => parseSelection({ profiles: [e] }, IT);
    expect(parse(itEntry()).entries).toHaveLength(1);
    expect(parse({ ...itEntry(), lat: 41.0, lng: 28.98 }).invalid).toHaveLength(1);                 // İstanbul koordinatı İtalya kutusu dışında
    expect(parse(itEntry({ personality: "Estroverso" })).invalid[0].reason).toContain("kişilik");   // erkek formu kadın profilde
    expect(parse(itEntry({ personality: "Ambivert" })).invalid[0].reason).toContain("kişilik");     // TR etiketi İtalya'da geçersiz
    expect(parse(itEntry({ district: "NoLo" })).invalid[0].reason).toContain("konum");
    expect(parseSelection({ profiles: [itEntry()] }).invalid).toHaveLength(1);                      // TR şemasıyla İtalyan kaydı geçmez
    expect(makeSelectionEntrySchema(IT).safeParse(itEntry({ gender: "MAN", personality: "Estroverso" })).success).toBe(true);
  });

  it("seedProfile (it): it_ storage yolu, comune, dil RPC ['it'], İtalyanca sorular; doğrulama dil_it + comune", async () => {
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] });
    const photo = { bytes: new Uint8Array([0xff]), contentType: "image/jpeg", meta: meta(IT_PROMPT) };
    const res = await seedProfile(fake.client, itEntry(), photo, bank, { passwordHash: "h", now: NOW, locale: IT });
    expect(res.status).toBe("created");
    if (res.status !== "created") return;
    expect(fake.storageFiles("photos")).toEqual(["seed/it_0015_pred1.jpg"]);
    expect(fake.table("users")[0]).toMatchObject({ email: "seed-it_0015@qulo.seed", city: "Milano", locale: "it", country: "IT" });
    expect(fake.rpcCalls).toEqual([{ name: "set_user_languages", args: { p_user_id: res.id, p_languages: ["it"] } }]);
    expect(fake.table("questions").map((q) => q.locale)).toEqual(["it", "it", "it"]);
    // set_user_languages fake'te preferred_languages'i yazmaz; insert satırı zaten ['it'] taşır
    const report = await verifySeedProfile(fake.client, itEntry(), async () => 200, { replicate_id: "pred_1", locale: IT });
    expect(report.checks.map((c) => c.name)).toContain("dil_it");
    expect(report.checks.find((c) => c.name === "ilce_il")).toMatchObject({ ok: true });
    expect(report.ok).toBe(true);
    // TR yapılandırmasıyla doğrulama aynı kaydı bulamaz (e-posta öneki farklı) — locale'ler birbirinin kaydını "doğrulamaz"
    expect((await verifySeedProfile(fake.client, itEntry(), async () => 200)).ok).toBe(false);
  });

  it("replaceSeedPhoto (it): kendi eski dosyası silinir, aynı numaralı TR dosyasına dokunulmaz", async () => {
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] }, { storage: { photos: ["seed/tr_0015_pred1.jpg"] } });
    const photo = { bytes: new Uint8Array([0xff]), contentType: "image/jpeg", meta: meta(IT_PROMPT) };
    await seedProfile(fake.client, itEntry(), photo, bank, { passwordHash: "h", now: NOW, locale: IT });
    const res = await replaceSeedPhoto(fake.client, itEntry(), { ...photo, meta: { ...photo.meta, replicate_id: "pred_2" } }, IT);
    expect(res.status).toBe("replaced");
    expect(fake.storageFiles("photos").sort()).toEqual(["seed/it_0015_pred2.jpg", "seed/tr_0015_pred1.jpg"]);
  });
});

describe("tr-seed-lib — silme ve yetim temizliği locale kapsamlı + sayfalı", () => {
  const url = (p: string) => `https://fake.supabase.co/storage/v1/object/public/photos/${p}`;
  const users = () => [
    { id: "t1", email: "seed-tr_0001@qulo.seed", is_seed_profile: true, photos: [url("seed/tr_0001.jpg")], photo_prompt: null },
    { id: "i1", email: "seed-it_0001@qulo.seed", is_seed_profile: true, photos: [url("seed/it_0001.jpg")], photo_prompt: null },
    { id: "i2", email: "seed-it_0002@qulo.seed", is_seed_profile: true, photos: [url("seed/it_0002.jpg")], photo_prompt: null },
    { id: "x1", email: "seed-itx0003@qulo.seed", is_seed_profile: true, photos: [], photo_prompt: null },        // `_` jokerine yakalanan sahte
    { id: "x2", email: "seed-it_0004@qulo.seed", is_seed_profile: false, photos: [], photo_prompt: null },       // bayraksız: asla
    { id: "x3", email: "seed-it_elle@qulo.seed", is_seed_profile: true, photos: [], photo_prompt: null },        // LIKE'a uyar, desene uymaz
  ];
  const storage = { photos: ["seed/tr_0001.jpg", "seed/tr_0009_old.jpg", "seed/it_0001.jpg", "seed/it_0002.jpg", "seed/it_0005_old.jpg"] };

  it("varsayılan (TR) silme İtalyan seed'lere ve it_ dosyalarına dokunmaz", async () => {
    const fake = createFakeSupabase({ users: users() }, { storage });
    const r = await deleteSeedProfiles(fake.client, { confirm: true });
    expect(r).toMatchObject({ users: 1, deletedUsers: 1, files: 2, removedFiles: 2 });
    expect(fake.table("users").map((u) => u.id).sort()).toEqual(["i1", "i2", "x1", "x2", "x3"]);
    expect(fake.storageFiles("photos").sort()).toEqual(["seed/it_0001.jpg", "seed/it_0002.jpg", "seed/it_0005_old.jpg"]);
  });

  it("--locale it: yalnız tam seed-it_NNNN + bayraklı kullanıcılar ve it_ dosyaları; --only o numaralar", async () => {
    const fake = createFakeSupabase({ users: users() }, { storage });
    const dry = await deleteSeedProfiles(fake.client, { confirm: false, locale: IT });
    expect(dry).toMatchObject({ dryRun: true, users: 2, files: 3 });
    const only = await deleteSeedProfiles(fake.client, { confirm: true, only: ["seed_0002"], locale: IT });
    expect(only).toMatchObject({ users: 1, deletedUsers: 1, files: 1, removedFiles: 1 });
    expect(fake.table("users").map((u) => u.id).sort()).toEqual(["i1", "t1", "x1", "x2", "x3"]);
    const rest = await deleteSeedProfiles(fake.client, { confirm: true, locale: IT });
    expect(rest).toMatchObject({ deletedUsers: 1 });
    expect(fake.table("users").map((u) => u.id).sort()).toEqual(["t1", "x1", "x2", "x3"]);
    expect(fake.storageFiles("photos").sort()).toEqual(["seed/tr_0001.jpg", "seed/tr_0009_old.jpg"]);
  });

  it("silinmeyecek bir satırın (desen dışı e-posta / bayrağı kaldırılmış) hâlâ kullandığı dosya korunur", async () => {
    const rows = [
      ...users(),
      { id: "x4", email: "seed-it_elle@qulo.seed", is_seed_profile: true, photos: [url("seed/it_0005_old.jpg")], photo_prompt: null },
    ];
    const fake = createFakeSupabase({ users: rows }, { storage });
    const r = await deleteSeedProfiles(fake.client, { confirm: true, locale: IT });
    expect(r).toMatchObject({ deletedUsers: 2, files: 2, removedFiles: 2 });
    expect(fake.storageFiles("photos")).toContain("seed/it_0005_old.jpg");   // x4 hâlâ gösteriyor
  });

  it("1.000'den fazla İtalyan seed sayfalanarak silinir; ortadaki parça patlarsa hata fırlar, dosyalara dokunulmaz", async () => {
    const pad = (n: number) => String(n).padStart(4, "0");
    const many = Array.from({ length: 1150 }, (_, i) => ({ id: `u${pad(i)}`, email: `seed-it_${pad(i)}@qulo.seed`, is_seed_profile: true, photos: [], photo_prompt: null }));
    const files = { photos: many.map((u) => `seed/it_${u.id.slice(1)}.jpg`) };
    const ok = createFakeSupabase({ users: many }, { storage: files, maxRows: 1000 });
    const r = await deleteSeedProfiles(ok.client, { confirm: true, locale: IT });
    expect([r.users, r.deletedUsers, r.removedFiles]).toEqual([1150, 1150, 1150]);
    expect(ok.table("users")).toHaveLength(0);
    const failing = createFakeSupabase({ users: many }, { storage: files, maxRows: 1000, failOn: [{ table: "users", op: "delete", failAfter: 1 }] });
    await expect(deleteSeedProfiles(failing.client, { confirm: true, locale: IT })).rejects.toThrow(/users delete/);
    expect(failing.table("users")).toHaveLength(1050);                        // ilk parça (100) silindi, gerisi duruyor
    expect(failing.storageFiles("photos")).toHaveLength(1150);                // dosyalar kullanıcı silmesi bitmeden silinmez
  });

  it("yetim taraması: 1.000+ seed'de (max-rows 1000) sondaki profilin CANLI fotoğrafı yetim sayılmaz; aday yalnız locale öneki", async () => {
    const pad = (n: number) => String(n).padStart(4, "0");
    const many = Array.from({ length: 1005 }, (_, i) => ({
      id: `u${pad(i)}`, email: `seed-tr_${pad(i)}@qulo.seed`, is_seed_profile: true, photos: [url(`seed/tr_${pad(i)}_live.jpg`)], photo_prompt: null,
    }));
    const files = [...many.map((u) => `seed/tr_${u.id.slice(1)}_live.jpg`), "seed/tr_9999_old.jpg", "seed/it_0001_old.jpg"];
    const fake = createFakeSupabase({ users: many }, { storage: { photos: files }, maxRows: 1000 });
    const r = await cleanupSeedOrphans(fake.client, { confirm: true });
    expect(r.orphans).toEqual(["seed/tr_9999_old.jpg"]);                 // sayfasız okuma 5 canlı dosyayı da silerdi
    expect(fake.storageFiles("photos")).toContain("seed/tr_1004_live.jpg");
    expect(fake.storageFiles("photos")).toContain("seed/it_0001_old.jpg");  // TR temizliği it_ dosyasına dokunmaz
    const it_ = await cleanupSeedOrphans(fake.client, { confirm: false, locale: IT });
    expect(it_.orphans).toEqual(["seed/it_0001_old.jpg"]);
  });

  it("yetim taramasında users okuma hatası fırlatır (sessiz boş küme = her dosya yetim olurdu)", async () => {
    const fake = createFakeSupabase({ users: users() }, { storage, failOn: [{ table: "users", op: "select" }] });
    await expect(cleanupSeedOrphans(fake.client, { confirm: true })).rejects.toThrow(/users select/);
    expect(fake.storageFiles("photos")).toHaveLength(5);
  });
});

describe("lgbt-seed-split-lib — İtalyanca sözlük + locale kapsamı", () => {
  const table: Array<[string, boolean]> = [
    ["Cerco una ragazza simpatica", true],
    ["Sto con un uomo da anni", true],
    ["Mio marito dice che cucino bene", true],
    ["Il mio tipo di serata: cinema", false],          // "tipo" dolgu kelime
    ["Un posto bellissimo sul lago", false],
    ["Il caffè la mattina è sacro", false],            // tr-TR küçültmesi "Il"i "ıl" yapardı
    ["Looking for a girlfriend", true],
  ];
  it.each(table)("%s → %s", (text, expected) => expect(mentionsGender(text, "it")).toBe(expected));

  it("TR varsayılanı değişmedi; locale verilince yalnız o locale'in seed'leri okunur", async () => {
    expect(mentionsGender("Kadınlar hakkında konuşalım")).toBe(true);
    expect(mentionsGender("Beyaz kahve severim")).toBe(false);
    const row = (id: string, email: string) => ({ id, email, gender: "MAN", gender_pref: "WOMAN", age: 30, city: "Milano", bio: "Caffè", is_seed_profile: true, is_deleted: false });
    const fake = createFakeSupabase({ users: [row("a", "seed-it_0001@qulo.seed"), row("b", "seed-tr_0001@qulo.seed")], questions: [], matches: [], swipes: [] });
    expect((await loadSeedCandidates(fake.client, { locale: IT })).map((c) => c.id)).toEqual(["a"]);
    expect((await loadSeedCandidates(fake.client)).map((c) => c.id).sort()).toEqual(["a", "b"]);
    const decoy = createFakeSupabase({ users: [row("a", "seed-it_0001@qulo.seed"), row("c", "seed-it_elle@qulo.seed")], questions: [], matches: [], swipes: [] });
    expect((await loadSeedCandidates(decoy.client, { locale: IT })).map((c) => c.id)).toEqual(["a"]);  // LIKE'a uyan desen dışı satır
  });

  it("sözlüğü olmayan locale TR'ye düşmez, durur", () => {
    expect(() => mentionsGender("Busco una chica", "es")).toThrow(/cinsiyet sözlüğü yok/);
  });
});
