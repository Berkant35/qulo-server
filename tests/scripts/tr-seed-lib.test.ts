import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "../helpers/fake-supabase.js";
import {
  buildDetailsRow,
  buildUserRow,
  deleteSeedProfiles,
  parseBank,
  parseSelection,
  pickQuestions,
  referralCode,
  seedEmail,
  seedProfile,
  storagePath,
  type BankQuestion,
  type SelectionEntry,
} from "../../scripts/seed/tr-seed-lib.js";

const entry = (over: Partial<SelectionEntry> = {}): SelectionEntry => ({
  seed_id: "seed_0015",
  gender: "WOMAN",
  age: 26,
  prompt: "Amateur close-up selfie …",
  relationship_goal: "NOT_SURE",
  bio: null,
  interests: [],
  height: 165,
  city: "İzmir",
  lat: 38.3989,
  lng: 27.1173,
  selected: true,
  ...over,
});

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

const photo = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: "image/jpeg" };
const NOW = new Date("2026-09-15T10:00:00Z");

describe("tr-seed-lib — girdi şemaları", () => {
  it("parseSelection: yalnız selected=true ve şemaya uyanlar; bozuk kayıt seed_id ile raporlanır", () => {
    const raw = { profiles: [
      entry(),
      { ...entry({ seed_id: "seed_0002" }), selected: false, city: null },   // yedek: atlanır, hata değil
      { ...entry({ seed_id: "seed_0003" }), age: null },                    // yaş yok → geçersiz
      { ...entry({ seed_id: "seed_0004" }), gender: "FEMALE" },             // enum dışı → geçersiz
      { ...entry({ seed_id: "seed_0005" }), lat: null },                    // konum yok → geçersiz
    ] };
    const { entries, invalid } = parseSelection(raw);
    expect(entries.map((e) => e.seed_id)).toEqual(["seed_0015"]);
    expect(invalid).toEqual(["seed_0003", "seed_0004", "seed_0005"]);
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
  it("users satırı: gizli test hesabı, enum'lar geçerli, foto URL'i ve 8 karakterlik referral", () => {
    const row = buildUserRow(entry(), "https://x/seed/tr_0015.jpg", "hash", NOW);
    expect(row.email).toBe("seed-tr_0015@qulo.seed");
    expect(row.is_test_account).toBe(true);
    expect(row.is_seed_profile).toBe(true);
    expect(row.email_verified).toBe(true);
    expect(row.gender).toBe("WOMAN");
    expect(row.gender_pref).toBe("MAN");
    expect(["SERIOUS", "FRIENDSHIP", "NOT_SURE"]).toContain(row.relationship_goal);
    expect(row.photos).toEqual(["https://x/seed/tr_0015.jpg"]);
    expect(row.referral_code).toMatch(/^S[A-Z0-9]{7}$/);
    expect(row.preferred_languages).toEqual(["tr"]);
    expect(row.age_pref_min).toBeGreaterThanOrEqual(18);
    expect(row.age_pref_min).toBeLessThan(row.age);
    expect(row.age_pref_max).toBeGreaterThan(row.age);
    expect(new Date(row.last_seen_at).getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(NOW.getTime() - new Date(row.last_seen_at).getTime()).toBeLessThanOrEqual(72 * 3600 * 1000);
  });

  it("yaş sınırlarında tercih aralığı tutarlı kalır (18 ve 55)", () => {
    for (const age of [18, 55]) {
      const row = buildUserRow(entry({ age }), "u", "h", NOW);
      expect(row.age_pref_min).toBeGreaterThanOrEqual(18);
      expect(row.age_pref_min).toBeLessThanOrEqual(age);
      expect(row.age_pref_max).toBeGreaterThan(age);
    }
  });

  it("erkek profilde tercih kadın; korpus bio'su varsa havuzdan seçilmez", () => {
    const row = buildUserRow(entry({ seed_id: "seed_0897", gender: "MAN", bio: "Balat'ta yaşıyorum." }), "u", "h", NOW);
    expect(row.gender_pref).toBe("WOMAN");
    expect(row.bio).toBe("Balat'ta yaşıyorum.");
  });

  it("deterministik: aynı seed_id → aynı isim, referral ve detaylar", () => {
    const a = buildUserRow(entry(), "u", "h", NOW);
    const b = buildUserRow(entry(), "u", "h", NOW);
    expect([a.name, a.surname, a.referral_code]).toEqual([b.name, b.surname, b.referral_code]);
    expect(buildDetailsRow(entry(), "uid")).toEqual(buildDetailsRow(entry(), "uid"));
  });

  it("referral kodları 1000 profilde çakışmaz", () => {
    const codes = new Set(Array.from({ length: 1000 }, (_, i) => referralCode(`seed_${String(i + 1).padStart(4, "0")}`)));
    expect(codes.size).toBe(1000);
  });

  it("user_details: enum değerleri, İngilizce burç anahtarı, korpus boyu korunur, yoksa aralıktan", () => {
    const withHeight = buildDetailsRow(entry(), "uid");
    expect(withHeight.height).toBe(165);
    expect(["YES", "NO", "SOMETIMES"]).toContain(withHeight.smoking);
    expect(["YES", "NO", "SOMETIMES"]).toContain(withHeight.alcohol);
    expect(withHeight.zodiac).toMatch(/^[a-z]+$/);
    const noHeight = buildDetailsRow(entry({ seed_id: "seed_0897", gender: "MAN", height: null }), "uid");
    expect(noHeight.height).toBeGreaterThanOrEqual(168);
    expect(noHeight.height).toBeLessThanOrEqual(192);
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

  it("yollar: e-posta ve storage yolu seed_id'den", () => {
    expect(seedEmail("seed_0001")).toBe("seed-tr_0001@qulo.seed");
    expect(storagePath("seed_0001")).toBe("seed/tr_0001.jpg");
  });
});

describe("tr-seed-lib — seedProfile akışı (fake-supabase)", () => {
  it("foto yükler, users + user_details + 3 soru yazar, dilleri RPC ile kurar", async () => {
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] });
    const res = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    expect(res.status).toBe("created");
    if (res.status !== "created") return;
    expect(res.warnings).toEqual([]);
    expect(fake.storageFiles("photos")).toEqual(["seed/tr_0015.jpg"]);
    const user = fake.table("users")[0];
    expect(user.is_test_account).toBe(true);
    expect(user.is_seed_profile).toBe(true);
    expect(user.photos[0]).toContain("/photos/seed/tr_0015.jpg");
    expect(fake.table("user_details")).toHaveLength(1);
    expect(fake.table("questions")).toHaveLength(3);
    expect(fake.rpcCalls).toEqual([{ name: "set_user_languages", args: { p_user_id: res.id, p_languages: ["tr"] } }]);
  });

  it("idempotent: aynı profil ikinci kez → skipped, ikinci satır ve ikinci yükleme yok", async () => {
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] });
    await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    const again = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    expect(again.status).toBe("skipped");
    expect(fake.table("users")).toHaveLength(1);
    expect(fake.storageFiles("photos")).toHaveLength(1);
  });

  it("önceki yarım koşudan kalan dosya (kullanıcısız) engel değil — mevcut dosya kullanılır", async () => {
    const fake = createFakeSupabase({ users: [], user_details: [], questions: [] }, { storage: { photos: ["seed/tr_0015.jpg"] } });
    const res = await seedProfile(fake.client, entry(), photo, bank, { passwordHash: "h", now: NOW });
    expect(res.status).toBe("created");
    expect(fake.storageFiles("photos")).toEqual(["seed/tr_0015.jpg"]);
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

describe("tr-seed-lib — deleteSeedProfiles", () => {
  const REAL = "3f2a1b0c-1111-4111-8111-000000000001";
  const seedUsers = () => [
    { id: "s1", email: "seed-tr_0001@qulo.seed", is_seed_profile: true },
    { id: "s2", email: "seed-tr_0002@qulo.seed", is_seed_profile: true },
    { id: REAL, email: "gercek@gmail.com", is_seed_profile: false },
    { id: "t1", email: "tester_001@qulo.test", is_seed_profile: false },
    { id: "x1", email: "bayrakli-ama-baska-domain@gmail.com", is_seed_profile: true }, // çift koşul: silinmez
  ];
  const storage = { photos: ["seed/tr_0001.jpg", "seed/tr_0002.jpg", "seed/notlar.txt", `${REAL}/1700000000.jpg`] };

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

  it("100'den fazla dosyada sayfalama tamamını bulur", async () => {
    const files = Array.from({ length: 230 }, (_, i) => `seed/tr_${String(i + 1).padStart(4, "0")}.jpg`);
    const fake = createFakeSupabase({ users: [] }, { storage: { photos: files } });
    const report = await deleteSeedProfiles(fake.client, { confirm: true });
    expect(report.files).toBe(230);
    expect(report.removedFiles).toBe(230);
    expect(fake.storageFiles("photos")).toHaveLength(0);
  });

  it("storage silme hatası kullanıcı silmeyi geri almaz, uyarı olarak döner", async () => {
    const fake = createFakeSupabase({ users: seedUsers() }, { storage, storageFailOn: [{ bucket: "photos", op: "remove" }] });
    const report = await deleteSeedProfiles(fake.client, { confirm: true });
    expect(report.deletedUsers).toBe(2);
    expect(report.removedFiles).toBe(0);
    expect(report.warnings).toHaveLength(1);
  });
});
