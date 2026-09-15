import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "../helpers/fake-supabase.js";
import {
  buildDetailsRow,
  buildPhotoPrompt,
  buildUserRow,
  deleteSeedProfiles,
  locationSentence,
  parseBank,
  parseSelection,
  photoMetaSchema,
  photoTag,
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
import { parseArgs } from "../../scripts/seed/seed-tr-test-profiles.js";

/** tools/seed_prepare.py'nin ürettiği biçim: konum cümlesi + yaş etiketi + gerçekçilik + sha1. */
const PROMPT = "Amateur close-up selfie. Location: Bornova, İzmir, Türkiye. A 26-year-old Turkish woman, natural skin texture. Real amateur smartphone photo look.";

const entry = (over: Partial<SelectionEntry> = {}): SelectionEntry => {
  const base = {
    seed_id: "seed_0015",
    gender: "WOMAN" as const,
    age: 26,
    prompt: PROMPT,
    prompt_sha1: sha1(PROMPT),
    relationship_goal: "NOT_SURE" as const,
    bio: "Bornova'da yaşıyorum, akşamları Kordon'da yürüyüş yapıyorum.",
    interests: ["music", "travel", "food"] as SelectionEntry["interests"],
    height: 165,
    province: "İzmir",
    district: "Bornova",
    lat: 38.3989,
    lng: 27.1173,
    job: "Hemşire",
    personality: "Ambivert" as const,
    pets: null,
    music_type: "Türkçe pop",
    smoking: "NO" as const,
    alcohol: "SOMETIMES" as const,
    selected: true as const,
  };
  const merged = { ...base, ...over };
  // prompt override edildiyse sha1'i testin kendisi verir; edilmediyse tutarlı kalsın
  if (over.prompt !== undefined && over.prompt_sha1 === undefined) merged.prompt_sha1 = sha1(over.prompt);
  return merged;
};

const meta: PhotoMeta = { model: "black-forest-labs/flux-2-klein-4b", prompt_sha1: sha1(PROMPT), generated_at: "2026-09-15T10:00:00Z", replicate_id: "pred_1", input: { aspect_ratio: "3:4" } };
const photo = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: "image/jpeg", meta };
const q = (text: string, target: BankQuestion["target_gender"] = null): BankQuestion => ({
  question_text: text,
  answers: ["A", "B", "C", "D"],
  category: "personality",
  hint: null,
  target_gender: target,
});
/** 12 nötr + 2 kadın + 2 erkek — WOMAN için 14 uygun, shuffle'ın seçimi değiştirmesi için yeterince geniş. */
const bank: BankQuestion[] = [
  ...Array.from({ length: 12 }, (_, i) => q(`Nötr soru ${i + 1}`)),
  q("Kadın sorusu 1", "female"), q("Kadın sorusu 2", "female"),
  q("Erkek sorusu 1", "male"), q("Erkek sorusu 2", "male"),
];
const NOW = new Date("2026-09-15T10:00:00Z");
const head200 = async () => 200;

describe("tr-seed-lib — girdi şemaları", () => {
  it("parseSelection: yalnız selected=true ve şemaya uyanlar; bozuk kayıt seed_id + sebep ile raporlanır", () => {
    const raw = { profiles: [
      entry(),
      { ...entry({ seed_id: "seed_0002" }), selected: false, district: null },   // yedek: atlanır, hata değil
      { ...entry({ seed_id: "seed_0003" }), age: null },                        // yaş yok → geçersiz
      { ...entry({ seed_id: "seed_0004" }), gender: "FEMALE" },                 // enum dışı → geçersiz
      { ...entry({ seed_id: "seed_0005" }), lat: null },                        // konum yok → geçersiz
      { ...entry({ seed_id: "seed_0006" }), bio: null, job: null },             // zenginleştirme birleşmemiş → geçersiz
    ] };
    const { entries, invalid } = parseSelection(raw);
    expect(entries.map((e) => e.seed_id)).toEqual(["seed_0015"]);
    expect(invalid.map((x) => x.seed_id)).toEqual(["seed_0003", "seed_0004", "seed_0005", "seed_0006"]);
    expect(invalid[0].reason).toContain("age");
  });

  it("kontrol listesi şemada: prompt'taki ilçe/il, yaş etiketi ve sha1 profille eşleşmeli", () => {
    const parse = (e: SelectionEntry) => parseSelection({ profiles: [e] });
    expect(parse(entry({ district: "Konak" })).invalid[0].reason).toContain("konum");                       // prompt Bornova diyor
    expect(parse(entry({ age: 27 })).invalid[0].reason).toContain("yaş");                                   // prompt 26 diyor
    expect(parse(entry({ prompt_sha1: "0".repeat(40) })).invalid[0].reason).toContain("prompt_sha1");
    expect(parse(entry({ prompt: PROMPT.replace("Bornova, İzmir", "Konak, İzmir"), district: "Konak" })).entries).toHaveLength(1);
    expect(locationSentence("Kadıköy", "İstanbul")).toBe("Location: Kadıköy, İstanbul, Türkiye.");
  });

  it("ilgi alanları uygulamanın 12 anahtarıyla sınırlı; kişilik ve sigara/alkol enum", () => {
    const parse = (e: object) => parseSelection({ profiles: [e] }).invalid.length;
    expect(parse({ ...entry(), interests: ["music", "yoga"] })).toBe(1);
    expect(parse({ ...entry(), personality: "Sakin" })).toBe(1);
    expect(parse({ ...entry(), alcohol: "RARELY" })).toBe(1);
    expect(parse({ ...entry(), interests: ["gaming"] })).toBe(1);                      // 3-5 sözleşmesi (seed_prepare ile aynı)
    expect(parse({ ...entry(), lat: 27.1173, lng: 38.3989 })).toBe(1);                // ters yazım Türkiye kutusu dışında
    expect(parse({ ...entry(), pets: "" })).toBe(1);                                   // boş string yerine null
    expect(parse(entry({ interests: ["gaming", "art", "books"] as SelectionEntry["interests"] }))).toBe(0);
  });

  it("photoMetaSchema: bozuk sha1 / model yok reddedilir, replicate_id ve input opsiyonel", () => {
    expect(photoMetaSchema.safeParse(meta).success).toBe(true);
    expect(photoMetaSchema.safeParse({ ...meta, prompt_sha1: "kısa" }).success).toBe(false);
    expect(photoMetaSchema.safeParse({ ...meta, model: "" }).success).toBe(false);
    expect(photoMetaSchema.safeParse({ model: "m", prompt_sha1: sha1("x"), generated_at: "t" }).success).toBe(true);
    expect(photoMetaSchema.safeParse({ error: "HTTP 402", model: "m" }).success).toBe(false); // manifest hata kaydı
  });

  it("parseSelection: profiles anahtarı yoksa fırlatır", () => {
    expect(() => parseSelection({})).toThrow();
  });

  it("parseBank: 4 metin cevaplı olmayan sorular sayılıp atılır", () => {
    const { bank: parsed, dropped } = parseBank([
      q("iyi"),
      { ...q("üç cevap"), answers: ["a", "b", "c"] },
      { ...q("nesne cevap"), answers: [{ text: "a" }, "b", "c", "d"] },
      { ...q("bilinmeyen hedef"), target_gender: "other" },
    ]);
    expect(parsed.map((x) => x.question_text)).toEqual(["iyi"]);
    expect(dropped).toBe(3);
  });
});

describe("tr-seed-lib — saf builder'lar", () => {
  it("users satırı: gizli test hesabı, ilçe city'de, bio/ilgi zenginleştirmeden, foto URL'i ve 8 karakterlik referral", () => {
    const row = buildUserRow(entry(), "https://x/seed/tr_0015.jpg", meta, "hash", NOW);
    expect(row.email).toBe("seed-tr_0015@qulo.seed");
    expect(row.is_test_account).toBe(true);
    expect(row.is_seed_profile).toBe(true);
    expect(row.email_verified).toBe(true);
    expect(row.gender).toBe("WOMAN");
    expect(row.gender_pref).toBe("MAN");
    expect(row.city).toBe("Bornova");
    expect(row.country).toBe("Türkiye");
    expect(row.bio).toBe(entry().bio);
    expect(row.interests).toEqual(["music", "travel", "food"]);
    expect(row.relationship_goal).toBe("NOT_SURE");
    expect(row.photos).toEqual(["https://x/seed/tr_0015.jpg"]);
    expect(row.referral_code).toMatch(/^S[A-Z0-9]{7}$/);
    expect(row.preferred_languages).toEqual(["tr"]);
    expect(row.age_pref_min).toBeGreaterThanOrEqual(18);
    expect(row.age_pref_min).toBeLessThan(row.age);
    expect(row.age_pref_max).toBeGreaterThan(row.age);
    expect(new Date(row.last_seen_at).getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(NOW.getTime() - new Date(row.last_seen_at).getTime()).toBeLessThanOrEqual(72 * 3600 * 1000);
  });

  it("photo_prompt klonu (058): prompt birebir + sha1 + model/replicate/girdi/ilçe/il", () => {
    const clone = buildPhotoPrompt(entry(), meta);
    expect(clone).toEqual({
      prompt: PROMPT, prompt_sha1: sha1(PROMPT), model: meta.model, replicate_id: "pred_1", input: { aspect_ratio: "3:4" },
      generated_at: meta.generated_at, edit: null, seed_id: "seed_0015", province: "İzmir", district: "Bornova",
    });
    expect(buildUserRow(entry(), "u", meta, "h", NOW).photo_prompt).toEqual(clone);
    expect(buildPhotoPrompt(entry(), { ...meta, replicate_id: undefined, input: undefined }).replicate_id).toBeNull();
  });

  it("gerçekçilik düzenlemesi klonda zincir olarak durur: taban prompt + düzenleme prompt'u + referans görsel", () => {
    const edit = { kind: "realism" as const, version: 3, prompt: "Keep this exact photo…", reference_replicate_id: "pred_1" };
    const clone = buildPhotoPrompt(entry(), { ...meta, replicate_id: "pred_2", edit }, "seed/tr_0015_pred1.jpg");
    expect(clone.prompt).toBe(PROMPT);                 // taban (kişi) prompt'u değişmez
    expect(clone.replicate_id).toBe("pred_2");         // DB'deki görsel = düzenlenmiş görsel
    expect(clone.edit).toEqual({ ...edit, reference_path: "seed/tr_0015_pred1.jpg" }); // referans Storage'da kalır
    expect(buildPhotoPrompt(entry(), { ...meta, edit }).edit?.reference_path).toBeNull();
    expect(photoMetaSchema.safeParse({ ...meta, edit: { ...edit, kind: "beauty" } }).success).toBe(false);
  });

  it("yaş sınırlarında tercih aralığı tutarlı kalır (18 ve 55)", () => {
    for (const age of [18, 55]) {
      const p = PROMPT.replace("26-year-old", `${age}-year-old`);
      const row = buildUserRow(entry({ age, prompt: p }), "u", meta, "h", NOW);
      expect(row.age_pref_min).toBeGreaterThanOrEqual(18);
      expect(row.age_pref_min).toBeLessThanOrEqual(age);
      expect(row.age_pref_max).toBeGreaterThan(age);
    }
  });

  it("erkek profilde tercih kadın", () => {
    const row = buildUserRow(entry({ seed_id: "seed_0897", gender: "MAN" }), "u", meta, "h", NOW);
    expect(row.gender_pref).toBe("WOMAN");
  });

  it("deterministik: aynı seed_id → aynı isim, referral ve detaylar", () => {
    const a = buildUserRow(entry(), "u", meta, "h", NOW);
    const b = buildUserRow(entry(), "u", meta, "h", NOW);
    expect([a.name, a.surname, a.referral_code]).toEqual([b.name, b.surname, b.referral_code]);
    expect(buildDetailsRow(entry(), "uid")).toEqual(buildDetailsRow(entry(), "uid"));
  });

  it("farklı `now` kimliği değiştirmez: isim/soyisim/referral aynı, yalnız last_seen_at kayar", () => {
    const a = buildUserRow(entry(), "u", meta, "h", NOW);
    const b = buildUserRow(entry(), "u", meta, "h", new Date("2026-10-01T00:00:00Z"));
    expect([b.name, b.surname, b.referral_code]).toEqual([a.name, a.surname, a.referral_code]);
    expect(b.last_seen_at).not.toBe(a.last_seen_at);
  });

  it("sorular banka sırasından bağımsız: aynı banka ters sırayla gelse de aynı 3 soru", () => {
    const forward = pickQuestions(bank, entry(), "uid").map((x) => x.question_text);
    const reversed = pickQuestions([...bank].reverse(), entry(), "uid").map((x) => x.question_text);
    expect(reversed).toEqual(forward);
  });

  it("referral kodları 1000 profilde çakışmaz", () => {
    const codes = new Set(Array.from({ length: 1000 }, (_, i) => referralCode(`seed_${String(i + 1).padStart(4, "0")}`)));
    expect(codes.size).toBe(1000);
  });

  it("user_details: meslek/kişilik/evcil/sigara/alkol zenginleştirmeden, İngilizce burç anahtarı, boy prompt'tan yoksa aralıktan", () => {
    const withHeight = buildDetailsRow(entry(), "uid");
    expect(withHeight).toMatchObject({ height: 165, job: "Hemşire", personality: "Ambivert", pets: null, music_type: "Türkçe pop", smoking: "NO", alcohol: "SOMETIMES" });
    expect(withHeight.zodiac).toMatch(/^[a-z]+$/);
    const noHeight = buildDetailsRow(entry({ seed_id: "seed_0897", gender: "MAN", height: null, pets: "Köpek" }), "uid");
    expect(noHeight.height).toBeGreaterThanOrEqual(168);
    expect(noHeight.height).toBeLessThanOrEqual(192);
    expect(noHeight.pets).toBe("Köpek");
  });

  it("sorular: cinsiyete uygun 3 farklı soru, doğru cevap 1-4, tr, sıra 1..3", () => {
    const qs = pickQuestions(bank, entry(), "uid");
    expect(qs).toHaveLength(3);
    expect(new Set(qs.map((x) => x.question_text)).size).toBe(3);
    expect(qs.map((x) => x.question_text).some((t) => t.startsWith("Erkek"))).toBe(false);
    for (const x of qs) {
      expect(x.correct_answer).toBeGreaterThanOrEqual(1);
      expect(x.correct_answer).toBeLessThanOrEqual(4);
      expect(x.locale).toBe("tr");
      expect(x.time_limit).toBe(30);
      expect(x.user_id).toBe("uid");
    }
    expect(qs.map((x) => x.order_num)).toEqual([1, 2, 3]);
  });

  it("sorular karıştırılır: aynı seed aynı kümeyi, farklı seed'ler farklı kümeleri seçer", () => {
    const pickSet = (seedId: string) => pickQuestions(bank, entry({ seed_id: seedId }), "uid").map((x) => x.question_text);
    expect(pickSet("seed_0015")).toEqual(pickSet("seed_0015"));
    const sets = new Set(Array.from({ length: 8 }, (_, i) => pickSet(`seed_00${20 + i}`).join("|")));
    expect(sets.size).toBeGreaterThan(1);
    expect(pickSet("seed_0015")).not.toEqual(bank.slice(0, 3).map((x) => x.question_text)); // ilk 3 değil
  });

  it("banka yetersizse olan kadarını döner (uyarı seedProfile'da)", () => {
    const qs = pickQuestions([q("tek"), q("iki")], entry(), "uid");
    expect(qs).toHaveLength(2);
  });

  it("yollar: e-posta ve storage yolu seed_id'den; görsel etiketi replicate_id'den (yeni görsel = yeni yol)", () => {
    expect(seedEmail("seed_0001")).toBe("seed-tr_0001@qulo.seed");
    expect(storagePath("seed_0001")).toBe("seed/tr_0001.jpg");
    expect(storagePath("seed_0001", "abc123")).toBe("seed/tr_0001_abc123.jpg");
    expect(photoTag("Dea2P2rkd5-rp40d0mm2sgm16nc")).toBe("dea2p2rkd5rp");
    expect(photoTag(null)).toBeUndefined();
    expect(photoTag("---")).toBeUndefined();
  });
});

describe("tr-seed-lib — seedProfile akışı (fake-supabase)", () => {
  it("foto yükler, users (+photo_prompt) + user_details + 3 soru yazar, dilleri RPC ile kurar", async () => {
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] });
    const res = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    expect(res.status).toBe("created");
    if (res.status !== "created") return;
    expect(res.warnings).toEqual([]);
    expect(fake.storageFiles("photos")).toEqual(["seed/tr_0015_pred1.jpg"]);
    const user = fake.table("users")[0];
    expect(user.is_test_account).toBe(true);
    expect(user.is_seed_profile).toBe(true);
    expect(user.city).toBe("Bornova");
    expect(user.photo_prompt.prompt).toBe(PROMPT);
    expect(user.photo_prompt.prompt_sha1).toBe(sha1(PROMPT));
    expect(user.photos[0]).toContain("/photos/seed/tr_0015_pred1.jpg");
    expect(fake.table("user_details")[0]).toMatchObject({ job: "Hemşire", personality: "Ambivert" });
    expect(fake.table("questions")).toHaveLength(3);
    expect(fake.rpcCalls).toEqual([{ name: "set_user_languages", args: { p_user_id: res.id, p_languages: ["tr"] } }]);
  });

  it("fotoğraf başka bir prompt'tan üretilmişse (sha1 farklı) hiçbir şey yazılmaz — klon alanı yalan olmasın", async () => {
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] });
    const stale = { ...photo, meta: { ...meta, prompt_sha1: "a".repeat(40) } };
    const res = await seedProfile(fake.client, entry(), stale, bank, { passwordHash: "h", now: NOW });
    expect(res).toMatchObject({ status: "error", step: "photo" });
    expect(fake.table("users")).toHaveLength(0);
    expect(fake.storageFiles("photos")).toHaveLength(0);
  });

  it("düzenlenmiş görsel: referans da etiketli yola yüklenir, klonda edit.reference_path olur; referanssız düzenleme basılmaz", async () => {
    const edit = { kind: "realism" as const, version: 3, prompt: "Keep this exact photo…", reference_replicate_id: "pred_1", seed: 42, reference_input: { aspect_ratio: "3:4" } };
    const edited = { ...photo, meta: { ...meta, replicate_id: "pred_2", edit }, reference: { bytes: new Uint8Array([1]), contentType: "image/jpeg" } };
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] });
    const res = await seedProfile(fake.client, entry(), edited, bank, { passwordHash: "h", now: NOW });
    expect(res.status).toBe("created");
    expect(fake.storageFiles("photos").sort()).toEqual(["seed/tr_0015_pred1.jpg", "seed/tr_0015_pred2.jpg"]);
    const user = fake.table("users")[0];
    expect(user.photos[0]).toContain("tr_0015_pred2.jpg");
    expect(user.photo_prompt.edit).toEqual({ ...edit, reference_path: "seed/tr_0015_pred1.jpg" });

    const noRef = createFakeSupabase({ users: [], user_details: [], questions: [] });
    const bad = await seedProfile(noRef.client, entry(), { ...edited, reference: null }, bank, { passwordHash: "h", now: NOW });
    expect(bad).toMatchObject({ status: "error", step: "photo" });
    expect(noRef.table("users")).toHaveLength(0);
    expect(noRef.storageFiles("photos")).toEqual([]);
  });

  it("idempotent: aynı profil ikinci kez → skipped, ikinci satır ve ikinci yükleme yok", async () => {
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] });
    await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    const again = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    expect(again.status).toBe("skipped");
    expect(fake.table("users")).toHaveLength(1);
    expect(fake.storageFiles("photos")).toHaveLength(1);
  });

  it("önceki yarım koşudan kalan aynı görsel (kullanıcısız) engel değil — dosya üzerine yazılır", async () => {
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] }, { storage: { photos: ["seed/tr_0015_pred1.jpg"] } });
    const res = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    expect(res.status).toBe("created");
    expect(fake.storageFiles("photos")).toEqual(["seed/tr_0015_pred1.jpg"]);
  });

  it("varlık kontrolü hata verirse insert'e geçilmez (unique-violation maskesi yok)", async () => {
    const fake = createFakeSupabase({ users: [] }, { failOn: [{ table: "users", op: "select" }] });
    const res = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    expect(res).toMatchObject({ status: "error", step: "exists" });
    expect(fake.table("users")).toHaveLength(0);
    expect(fake.storageFiles("photos")).toHaveLength(0);
  });

  it("foto yüklenemezse kullanıcı hiç yaratılmaz", async () => {
    const fake = createFakeSupabase({ users: [] }, { storageFailOn: [{ bucket: "photos", op: "upload" }] });
    const res = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    expect(res).toMatchObject({ status: "error", step: "upload" });
    expect(fake.table("users")).toHaveLength(0);
  });

  it("users insert hatası → step users; foto yüklenmiş olsa da RPC/soru/detay hiç çağrılmaz", async () => {
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] }, { failOn: [{ table: "users", op: "insert" }] });
    const res = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    expect(res).toMatchObject({ status: "error", step: "users" });
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.table("questions")).toHaveLength(0);
    expect(fake.table("user_details")).toHaveLength(0);
  });

  it("set_user_languages RPC ve user_details hataları kullanıcıyı silmez, uyarı olarak döner", async () => {
    const fake = createFakeSupabase(
      { users: [], user_details: [], questions: [] },
      { rpc: { set_user_languages: { error: { message: "rpc patladı" } } }, failOn: [{ table: "user_details", op: "insert" }] },
    );
    const res = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    expect(res.status).toBe("created");
    if (res.status !== "created") return;
    expect(res.warnings).toEqual([expect.stringMatching(/^user_details: .+/), "set_user_languages: rpc patladı"]);
    expect(fake.table("users")).toHaveLength(1);
    expect(fake.table("questions")).toHaveLength(3);
  });

  it("sorular yazılamazsa kullanıcı kalır, hata uyarı olarak döner (atomik değil — belgelenmiş sınır)", async () => {
    const fake = createFakeSupabase(
      { users: [], user_details: [], questions: [] },
      { failOn: [{ table: "questions", op: "insert" }] },
    );
    const res = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    expect(res.status).toBe("created");
    if (res.status !== "created") return;
    expect(res.warnings.some((w) => w.startsWith("questions:"))).toBe(true);
    expect(fake.table("users")).toHaveLength(1);
    expect(fake.table("questions")).toHaveLength(0);
  });

  it("banka yetersizse uyarı döner ve boş insert yapılmaz", async () => {
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] }, { failOn: [{ table: "questions", op: "insert" }] });
    const res = await seedProfile(fake.client, entry(), photo, [], { passwordHash: "h", now: NOW });
    expect(res.status).toBe("created");
    if (res.status !== "created") return;
    expect(res.warnings).toEqual(["soru bankası yetersiz: 0"]); // insert çağrılsaydı 'questions:' uyarısı da olurdu
  });
});

describe("tr-seed-lib — replaceSeedPhoto (basılmış profilde fotoğrafı yerinde değiştir)", () => {
  const edited = {
    ...photo,
    meta: { ...meta, replicate_id: "pred_2", edit: { kind: "realism" as const, version: 3, prompt: "Keep this exact photo…", reference_replicate_id: "pred_1" } },
  };
  const seeded = async () => {
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] });
    const res = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    if (res.status !== "created") throw new Error("fixture");
    return { fake, id: res.id };
  };

  it("düzenleme DB'deki görselin üzerine: yeni görsel yeni yola, eski dosya REFERANS olarak kalır; id ve sorular korunur", async () => {
    const { fake, id } = await seeded();
    const res = await replaceSeedPhoto(fake.client, entry(), edited);
    expect(res).toMatchObject({ status: "replaced", id, warnings: [], orphans: [] });
    const user = fake.table("users")[0];
    expect(user.id).toBe(id);
    expect(user.photos).toEqual([expect.stringContaining("/photos/seed/tr_0015_pred2.jpg")]);
    expect(user.photo_prompt).toMatchObject({ prompt: PROMPT, replicate_id: "pred_2", edit: { reference_replicate_id: "pred_1", reference_path: "seed/tr_0015_pred1.jpg" } });
    expect(fake.storageFiles("photos").sort()).toEqual(["seed/tr_0015_pred1.jpg", "seed/tr_0015_pred2.jpg"]); // referans silinmedi
    expect(fake.table("questions")).toHaveLength(3);
  });

  it("yeniden üretilmiş (düzenlemesiz) görsel: eski kendi dosyası silinir", async () => {
    const { fake } = await seeded();
    const regenerated = { ...photo, meta: { ...meta, replicate_id: "pred_3" } };
    const res = await replaceSeedPhoto(fake.client, entry(), regenerated);
    expect(res).toMatchObject({ status: "replaced", orphans: [] });
    expect(fake.storageFiles("photos")).toEqual(["seed/tr_0015_pred3.jpg"]);
    expect(fake.table("users")[0].photo_prompt.edit).toBeNull();
  });

  it("düzenlemenin referansı DB'deki görsel değilse referans baytları yüklenir; yoksa hiçbir şey değişmez", async () => {
    const { fake } = await seeded(); // DB: pred_1
    const otherRef = { ...edited, meta: { ...edited.meta, edit: { ...edited.meta.edit, reference_replicate_id: "pred_0" } } };
    expect(await replaceSeedPhoto(fake.client, entry(), otherRef)).toMatchObject({ status: "error", step: "photo" });
    expect(fake.table("users")[0].photo_prompt.replicate_id).toBe("pred_1");
    const withRef = { ...otherRef, reference: { bytes: new Uint8Array([1]), contentType: "image/jpeg" } };
    expect(await replaceSeedPhoto(fake.client, entry(), withRef)).toMatchObject({ status: "replaced" });
    expect(fake.storageFiles("photos").sort()).toEqual(["seed/tr_0015_pred0.jpg", "seed/tr_0015_pred2.jpg"]); // pred1 (kendi, referans değil) silindi
    expect(fake.table("users")[0].photo_prompt.edit.reference_path).toBe("seed/tr_0015_pred0.jpg");
  });

  it("klondaki görsel zaten aynıysa dokunmaz (unchanged, yükleme yok)", async () => {
    const { fake } = await seeded();
    const res = await replaceSeedPhoto(fake.client, entry(), photo);
    expect(res.status).toBe("unchanged");
    expect(fake.storageFiles("photos")).toEqual(["seed/tr_0015_pred1.jpg"]);
  });

  it("profil yoksa ya da sha1 uyuşmuyorsa hiçbir şey değişmez", async () => {
    const empty = createFakeSupabase({ users: [] });
    expect(await replaceSeedPhoto(empty.client, entry(), edited)).toMatchObject({ status: "error", step: "exists" });
    expect(empty.storageFiles("photos")).toEqual([]);
    const { fake } = await seeded();
    const stale = { ...edited, meta: { ...edited.meta, prompt_sha1: "b".repeat(40) } };
    expect(await replaceSeedPhoto(fake.client, entry(), stale)).toMatchObject({ status: "error", step: "photo" });
    expect(fake.table("users")[0].photo_prompt.replicate_id).toBe("pred_1");
  });

  it("users update hatasında eski fotoğraf ve dosya yerinde kalır", async () => {
    const { fake } = await seeded();
    const failing = createFakeSupabase(
      { users: fake.table("users"), user_details: [], questions: [] },
      { storage: { photos: ["seed/tr_0015_pred1.jpg"] }, failOn: [{ table: "users", op: "update" }] },
    );
    const res = await replaceSeedPhoto(failing.client, entry(), edited);
    expect(res).toMatchObject({ status: "error", step: "update" });
    expect(failing.table("users")[0].photos[0]).toContain("tr_0015_pred1.jpg");
    expect(failing.storageFiles("photos")).toContain("seed/tr_0015_pred1.jpg");
    expect(failing.storageFiles("photos")).toContain("seed/tr_0015_pred2.jpg"); // bilinçli: yeni dosya yetim kalır (yol deterministik, tekrar koşu aynı yere yazar)
  });

  it("upload hatasında DB ve dosyalar değişmez", async () => {
    const { fake } = await seeded();
    const failing = createFakeSupabase(
      { users: fake.table("users"), user_details: [], questions: [] },
      { storage: { photos: ["seed/tr_0015_pred1.jpg"] }, storageFailOn: [{ bucket: "photos", op: "upload" }] },
    );
    expect(await replaceSeedPhoto(failing.client, entry(), { ...photo, meta: { ...meta, replicate_id: "pred_3" } })).toMatchObject({ status: "error", step: "upload" });
    expect(failing.table("users")[0].photo_prompt.replicate_id).toBe("pred_1");
    expect(failing.storageFiles("photos")).toEqual(["seed/tr_0015_pred1.jpg"]);
  });

  it("eski dosya silinemezse kayıt yine 'replaced', temizlik hatası orphans'ta (uyarı değil)", async () => {
    const { fake } = await seeded();
    const failing = createFakeSupabase(
      { users: fake.table("users"), user_details: [], questions: [] },
      { storage: { photos: ["seed/tr_0015_pred1.jpg"] }, storageFailOn: [{ bucket: "photos", op: "remove" }] },
    );
    const res = await replaceSeedPhoto(failing.client, entry(), { ...photo, meta: { ...meta, replicate_id: "pred_3" } });
    expect(res).toMatchObject({ status: "replaced", warnings: [] });
    if (res.status !== "replaced") return;
    expect(res.orphans).toHaveLength(1);
    expect(failing.table("users")[0].photo_prompt.replicate_id).toBe("pred_3");
  });

  it("eski fotoğraf gerçek kullanıcı dosyası ya da BAŞKA profilin seed dosyasıysa asla silinmez", async () => {
    const REAL_FILE = "3f2a1b0c/1700000000.jpg";
    const OTHER_SEED = "seed/tr_0016_abc.jpg";
    for (const target of [REAL_FILE, OTHER_SEED]) {
      const fake = createFakeSupabase({ users: [], user_details: [], questions: [] }, { storage: { photos: [REAL_FILE, OTHER_SEED] } });
      const res0 = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
      if (res0.status !== "created") throw new Error("fixture");
      fake.table("users")[0].photos = [`https://fake.supabase.co/storage/v1/object/public/photos/${target}`];
      const res = await replaceSeedPhoto(fake.client, entry(), { ...photo, meta: { ...meta, replicate_id: "pred_3" } });
      expect(res.status).toBe("replaced");
      expect(fake.storageFiles("photos")).toContain(target);
    }
  });
});

describe("tr-seed-lib — verifySeedProfile (kayıt sonrası kontrol listesi)", () => {
  const seeded = async () => {
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] });
    const res = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    if (res.status !== "created") throw new Error("fixture");
    return { fake, id: res.id };
  };

  it("temiz basımda 10 madde de geçer; foto URL'sine HEAD atılır", async () => {
    const { fake, id } = await seeded();
    const urls: string[] = [];
    const report = await verifySeedProfile(fake.client, entry(), async (u) => { urls.push(u); return 200; });
    expect(report.ok).toBe(true);
    expect(report.id).toBe(id);
    expect(report.checks.map((c) => c.name)).toEqual(["kayit_var", "is_seed", "ilce_il", "yas_cinsiyet", "bio_ilgi", "foto_url_200", "prompt_klonu", "dil_tr", "soru_3", "detay_meslek"]);
    expect(urls).toEqual([fake.table("users")[0].photos[0]]);
  });

  it("beklenen görsel kimliği verilirse DB klonundaki replicate_id ile karşılaştırılır", async () => {
    const { fake } = await seeded();
    const same = await verifySeedProfile(fake.client, entry(), head200, { replicate_id: "pred_1" });
    expect(same.ok).toBe(true);
    expect(same.checks.find((c) => c.name === "foto_kimligi")).toMatchObject({ ok: true });
    const other = await verifySeedProfile(fake.client, entry(), head200, { replicate_id: "pred_2" });
    expect(other.ok).toBe(false);
    expect(other.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["foto_kimligi"]);
  });

  it("kayıt yoksa tek maddeyle düşer", async () => {
    const fake = createFakeSupabase({ users: [] });
    const report = await verifySeedProfile(fake.client, entry(), head200);
    expect(report).toMatchObject({ ok: false, id: null });
    expect(report.checks).toEqual([{ name: "kayit_var", ok: false, detail: "users satırı yok" }]);
  });

  it("foto servis edilmiyorsa (HEAD 404) düşer; HEAD fırlatırsa hata maddesi olur", async () => {
    const { fake } = await seeded();
    const r404 = await verifySeedProfile(fake.client, entry(), async () => 404);
    expect(r404.ok).toBe(false);
    expect(r404.checks.find((c) => c.name === "foto_url_200")).toMatchObject({ ok: false });
    const rThrow = await verifySeedProfile(fake.client, entry(), async () => { throw new Error("timeout"); });
    expect(rThrow.checks.find((c) => c.name === "foto_head")).toMatchObject({ ok: false, detail: "timeout" });
  });

  it("bayrak, yaş/cinsiyet, bio/ilgi, dil ve foto yokluğu ayrı ayrı düşer", async () => {
    const { fake } = await seeded();
    const user = fake.table("users")[0];
    user.is_test_account = false;
    user.age = 27;
    user.interests = ["gaming"];
    user.preferred_languages = ["en"];
    user.photos = [];
    const report = await verifySeedProfile(fake.client, entry(), head200);
    expect(report.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["is_seed", "yas_cinsiyet", "bio_ilgi", "foto_url_200", "dil_tr"]);
    expect(report.checks.find((c) => c.name === "foto_url_200")?.detail).toContain("(foto yok)");
  });

  it("canlı kayıt seçimden saparsa (prompt klonu, ilçe, soru sayısı, meslek) ilgili madde düşer", async () => {
    const { fake } = await seeded();
    const user = fake.table("users")[0];
    user.photo_prompt = { ...user.photo_prompt, prompt: "başka prompt" };
    user.city = "Konak";
    fake.table("questions").pop();
    fake.table("user_details")[0].job = "Avukat";
    const report = await verifySeedProfile(fake.client, entry(), head200);
    expect(report.ok).toBe(false);
    expect(report.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["ilce_il", "prompt_klonu", "soru_3", "detay_meslek"]);
  });
});

describe("tr-seed-lib — deleteSeedProfiles", () => {
  const REAL = "3f2a1b0c-1111-4111-8111-000000000001";
  const seedUsers = () => [
    { id: "s1", email: "seed-tr_0001@qulo.seed", is_seed_profile: true },
    { id: "s2", email: "seed-tr_0002@qulo.seed", is_seed_profile: true },
    { id: REAL, email: "gercek@gmail.com", is_seed_profile: false },
    { id: "t1", email: "tester_001@qulo.test", is_seed_profile: false },
    { id: "x1", email: "bayrakli-ama-baska-domain@gmail.com", is_seed_profile: true }, // çift koşul: silinmez
  ];
  const storage = { photos: ["seed/tr_0001.jpg", "seed/tr_0002_dea2p2rkd5rp.jpg", "seed/notlar.txt", `${REAL}/1700000000.jpg`] };

  it("dry-run yalnız sayar", async () => {
    const fake = createFakeSupabase({ users: seedUsers() }, { storage });
    const report = await deleteSeedProfiles(fake.client, { confirm: false });
    expect(report).toMatchObject({ dryRun: true, users: 2, files: 2, deletedUsers: 0, removedFiles: 0 });
    expect(fake.table("users")).toHaveLength(5);
    expect(fake.storageFiles("photos")).toHaveLength(4);
  });

  it("confirm: yalnız is_seed_profile + @qulo.seed kullanıcıları ve tr_NNNN.jpg dosyaları silinir", async () => {
    const fake = createFakeSupabase({ users: seedUsers() }, { storage });
    const report = await deleteSeedProfiles(fake.client, { confirm: true });
    expect(report).toMatchObject({ dryRun: false, deletedUsers: 2, removedFiles: 2, warnings: [] });
    expect(fake.table("users").map((u) => u.id).sort()).toEqual([REAL, "t1", "x1"]);
    expect(fake.storageFiles("photos").sort()).toEqual([`${REAL}/1700000000.jpg`, "seed/notlar.txt"]);
  });

  it("--only: yalnız verilen seed_id'ler ve onların dosyaları silinir, diğer seed'ler kalır", async () => {
    const fake = createFakeSupabase({ users: seedUsers() }, { storage });
    const report = await deleteSeedProfiles(fake.client, { confirm: true, only: ["seed_0002"] });
    expect(report).toMatchObject({ users: 1, files: 1, deletedUsers: 1, removedFiles: 1 });
    expect(fake.table("users").map((u) => u.id).sort()).toEqual([REAL, "s1", "t1", "x1"]);
    expect(fake.storageFiles("photos").sort()).toEqual([`${REAL}/1700000000.jpg`, "seed/notlar.txt", "seed/tr_0001.jpg"]);
  });

  it("100'den fazla dosyada sayfalama tamamını bulur", async () => {
    const files = Array.from({ length: 230 }, (_, i) => `seed/tr_${String(i + 1).padStart(4, "0")}.jpg`);
    const fake = createFakeSupabase({ users: [] }, { storage: { photos: files } });
    const report = await deleteSeedProfiles(fake.client, { confirm: true });
    expect(report.files).toBe(230);
    expect(report.removedFiles).toBe(230);
    expect(fake.storageFiles("photos")).toHaveLength(0);
  });

  it("users select / delete ve storage list hataları fırlatır (sessiz kısmi silme yok)", async () => {
    await expect(deleteSeedProfiles(createFakeSupabase({ users: seedUsers() }, { storage, failOn: [{ table: "users", op: "select" }] }).client, { confirm: false }))
      .rejects.toThrow(/users select/);
    await expect(deleteSeedProfiles(createFakeSupabase({ users: seedUsers() }, { storage, failOn: [{ table: "users", op: "delete" }] }).client, { confirm: true }))
      .rejects.toThrow(/users delete/);
    await expect(deleteSeedProfiles(createFakeSupabase({ users: seedUsers() }, { storage, storageFailOn: [{ bucket: "photos", op: "list" }] }).client, { confirm: false }))
      .rejects.toThrow(/storage list/);
  });

  it("storage silme hatası kullanıcı silmeyi geri almaz, uyarı olarak döner", async () => {
    const fake = createFakeSupabase({ users: seedUsers() }, { storage, storageFailOn: [{ bucket: "photos", op: "remove" }] });
    const report = await deleteSeedProfiles(fake.client, { confirm: true });
    expect(report.deletedUsers).toBe(2);
    expect(report.removedFiles).toBe(0);
    expect(report.warnings).toHaveLength(1);
  });
});

describe("seed-tr-test-profiles CLI — parseArgs", () => {
  it("varsayılanlar ve bayraklar", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, verifyOnly: false, json: false, replacePhoto: false, only: new Set(), gender: undefined, limit: 0 });
    expect(parseArgs(["--only", "seed_0001,seed_0002", "--gender", "MAN", "--limit", "5", "--dry-run", "--json", "--verify-only", "--replace-photo"]))
      .toEqual({ dryRun: true, verifyOnly: true, json: true, replacePhoto: true, only: new Set(["seed_0001", "seed_0002"]), gender: "MAN", limit: 5 });
  });

  it("geçersiz cinsiyet ve limit net mesajla reddedilir; 0 = sınırsız", () => {
    expect(() => parseArgs(["--gender", "FEMALE"])).toThrow(/WOMAN\|MAN/);
    expect(() => parseArgs(["--limit", "-1"])).toThrow(/sınırsız/);
    expect(() => parseArgs(["--limit", "abc"])).toThrow(/sınırsız/);
    expect(parseArgs(["--limit", "0"]).limit).toBe(0);
  });

  it("bilinmeyen bayrak ve değersiz bayrak reddedilir (yazım hatası gerçek koşuya dönüşmez)", () => {
    expect(() => parseArgs(["--dryrun"])).toThrow(/bilinmeyen argüman: --dryrun/);
    expect(() => parseArgs(["--only", "--json"])).toThrow(/--only değer ister/);
    expect(() => parseArgs(["--limit"])).toThrow(/--limit değer ister/);
  });
});
