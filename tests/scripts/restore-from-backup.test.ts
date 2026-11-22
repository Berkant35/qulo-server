import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "../helpers/fake-supabase.js";
import {
  BACKUP_TABLE,
  buildRestoreUserRow,
  parseIdList,
  parseRestoreArgs,
  restoreFromBackup,
} from "../../scripts/seed/restore-from-backup.js";
import { pickQuestions, sha1, type BankQuestion, type SelectionEntry } from "../../scripts/seed/tr-seed-lib.js";

const PROMPT = "Amateur close-up selfie. Location: Bornova, İzmir, Türkiye. A 26-year-old Turkish woman, natural skin texture.";
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const PHOTO = (n: string) => `https://x.supabase.co/storage/v1/object/public/photos/seed/tr_${n}_abc.jpg`;

const entry = (seedId: string): SelectionEntry => ({
  seed_id: seedId,
  gender: "WOMAN",
  age: 26,
  prompt: PROMPT,
  prompt_sha1: sha1(PROMPT),
  relationship_goal: "NOT_SURE",
  bio: "Bornova'da yaşıyorum, akşamları Kordon'da yürüyüş yapıyorum.",
  interests: ["music", "travel", "food"],
  height: 165,
  province: "İzmir",
  district: "Bornova",
  lat: 38.4,
  lng: 27.1,
  job: "Hemşire",
  personality: "Ambivert",
  pets: null,
  music_type: null,
  smoking: "NO",
  alcohol: "SOMETIMES",
  selected: true,
});

/** Yedek satırı: canlıdaki son hâl. Null alanlar (location_source yok, push_token null) bilerek var. */
const backupRow = (id: string, n: string, over: Record<string, unknown> = {}) => ({
  id,
  email: `seed-tr_${n}@qulo.seed`,
  password_hash: "$2a$12$hash",
  name: "Elif",
  surname: "Kaya",
  age: 26,
  gender: "WOMAN",
  gender_pref: "MAN",
  bio: "Bornova'da yaşıyorum, akşamları Kordon'da yürüyüş yapıyorum.",
  city: "Bornova",
  country: "TR",
  lat: 38.4,
  lng: 27.1,
  locale: "tr",
  interests: ["music", "travel", "food"],
  photos: [PHOTO(n)],
  photo_prompt: { prompt: PROMPT, prompt_sha1: sha1(PROMPT), replicate_id: `rep_${n}` },
  preferred_languages: ["tr"],
  seed_persona: { calisma: "ofis", tip: "anlik" },
  email_verified: true,
  email_notifications_enabled: true,
  question_count: 3,
  like_received_count: 7,
  push_token: null,
  relationship_goal: null,
  is_seed_profile: true,
  is_test_account: true,
  is_test_admin: false,
  ...over,
});

const q = (text: string, target: BankQuestion["target_gender"] = null): BankQuestion => ({
  question_text: text, answers: ["A", "B", "C", "D"], category: "personality", hint: null, target_gender: target,
});
const bank: BankQuestion[] = [...Array.from({ length: 8 }, (_, i) => q(`Nötr ${i + 1}`)), q("Kadın 1", "female"), q("Erkek 1", "male")];
const selection = new Map([["seed_0015", entry("seed_0015")], ["seed_0016", entry("seed_0016")], ["seed_0017", entry("seed_0017")]]);
const head200 = async () => 200;

function setup(users: Record<string, unknown>[] = [], backup = [backupRow(ID_A, "0015"), backupRow(ID_B, "0016"), backupRow(ID_C, "0017")]) {
  return createFakeSupabase(
    { [BACKUP_TABLE]: backup, users, user_details: [], questions: [] },
    { rpc: { set_user_languages: { data: null } } },
  );
}

describe("restore-from-backup — argümanlar", () => {
  it("varsayılan KURU çalıştırma; bilinmeyen ya da değersiz bayrak hata verir", () => {
    expect(parseRestoreArgs([])).toEqual({ apply: false, json: false, only: undefined, exclude: undefined });
    expect(parseRestoreArgs(["--apply", "--only", "a.json", "--exclude", "b.json"])).toMatchObject({ apply: true, only: "a.json", exclude: "b.json" });
    expect(() => parseRestoreArgs(["--aply"])).toThrow(/bilinmeyen argüman/);
    expect(() => parseRestoreArgs(["--apply=true"])).toThrow(/bilinmeyen argüman/);
    expect(() => parseRestoreArgs(["--only"])).toThrow(/değer ister/);
    expect(() => parseRestoreArgs(["--only", "--apply"])).toThrow(/değer ister/);
    // listesiz --apply yedeğin tamamını (erkekler + karıncalılar) geri getirirdi
    expect(() => parseRestoreArgs(["--apply"])).toThrow(/--only/);
    expect(() => parseRestoreArgs(["--apply", "--exclude", "b.json"])).toThrow(/--only/);
  });

  it("id listesi: {items}, nesne dizisi, düz dizi; biçim dışı id hata", () => {
    expect([...parseIdList({ items: [{ id: ID_A, seed_id: "seed_0015" }] }, "x")]).toEqual([ID_A]);
    expect([...parseIdList([{ id: ID_B }], "x")]).toEqual([ID_B]);
    expect([...parseIdList([ID_C], "x")]).toEqual([ID_C]);
    expect(() => parseIdList({ items: [{ seed_id: "seed_0015" }] }, "--only")).toThrow(/geçersiz id/);
    expect(() => parseIdList({ foo: [] }, "--only")).toThrow(/dizi/);
  });
});

describe("restore-from-backup — kullanıcı satırı", () => {
  it("bot kapısı bayrakları zorlanır, e-posta kapanır, null alanlar gönderilmez, türev sayaçlar sıfırlanır", () => {
    const row = buildRestoreUserRow(backupRow(ID_A, "0015", { is_test_account: false, is_test_admin: true, push_token: "tok", verify_token: "v" }));
    expect(row).toMatchObject({ id: ID_A, is_seed_profile: true, is_test_account: true, is_test_admin: false, email_notifications_enabled: false, question_count: 0 });
    expect(row).not.toHaveProperty("push_token");
    expect(row).not.toHaveProperty("verify_token");
    expect(row).not.toHaveProperty("like_received_count");
    expect(row).not.toHaveProperty("relationship_goal"); // null → kolonun varsayılanı
    expect(row).not.toHaveProperty("location_source"); // yedekte olmayan yeni kolon → varsayılan
    expect(row.photos).toEqual([PHOTO("0015")]); // fotoğraf URL'si aynen
  });
});

describe("restore-from-backup — akış", () => {
  it("kuru çalıştırma hiçbir şey yazmaz (users/detay/soru/RPC boş kalır)", async () => {
    const fake = setup();
    const report = await restoreFromBackup(fake.client, { apply: false, selection, bank, head: head200 });
    expect(report.tally).toMatchObject({ planned: 3, created: 0, error: 0 });
    expect(fake.table("users")).toHaveLength(0);
    expect(fake.table("user_details")).toHaveLength(0);
    expect(fake.table("questions")).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("--only + --exclude: yalnız seçilenler, dışlama listesindeki atlanır ve sayılır", async () => {
    const fake = setup();
    const report = await restoreFromBackup(fake.client, {
      apply: true, only: new Set([ID_A, ID_B]), exclude: new Set([ID_B]), selection, bank, head: head200,
    });
    expect(report.excluded).toBe(1);
    expect(report.items.map((i) => i.id)).toEqual([ID_A]);
    expect(fake.table("users").map((u) => u.id)).toEqual([ID_A]);
  });

  it("uygula: AYNI id, bayraklar, deterministik 3 soru (pickQuestions ile aynı), detay, diller RPC; doğrulama geçer", async () => {
    const fake = setup();
    const report = await restoreFromBackup(fake.client, { apply: true, only: new Set([ID_A]), selection, bank, head: head200 });
    expect(report.tally).toMatchObject({ created: 1, error: 0, verified: 1, verify_failed: 0 });
    const user = fake.table("users")[0];
    expect(user).toMatchObject({ id: ID_A, is_seed_profile: true, is_test_account: true, email_notifications_enabled: false, question_count: 3 });
    const expected = pickQuestions(bank, entry("seed_0015"), ID_A).map((x) => x.question_text);
    expect(fake.table("questions").map((x) => x.question_text)).toEqual(expected);
    expect(fake.table("user_details")[0]).toMatchObject({ user_id: ID_A, job: "Hemşire" });
    expect(fake.rpcCalls).toEqual([{ name: "set_user_languages", args: { p_user_id: ID_A, p_languages: ["tr"] } }]);
  });

  it("idempotent: users'ta olan id atlanır, yeniden yazılmaz (yine doğrulanır)", async () => {
    const fake = setup([{ id: ID_A, email: "seed-tr_0015@qulo.seed", name: "MEVCUT" }]);
    const report = await restoreFromBackup(fake.client, { apply: true, only: new Set([ID_A, ID_B]), selection, bank, head: head200 });
    expect(report.items.find((i) => i.id === ID_A)?.status).toBe("skipped");
    expect(report.items.find((i) => i.id === ID_B)?.status).toBe("created");
    expect(fake.table("users").filter((u) => u.id === ID_A)).toHaveLength(1);
    expect(fake.table("users").find((u) => u.id === ID_A)?.name).toBe("MEVCUT");
    expect(fake.table("questions").every((x) => x.user_id === ID_B)).toBe(true);
  });

  it("yedekte olmayan id ve personası boş seed hata olarak raporlanır, yazılmaz", async () => {
    const fake = setup([], [backupRow(ID_A, "0015", { seed_persona: null })]);
    const report = await restoreFromBackup(fake.client, { apply: true, only: new Set([ID_A, ID_C]), selection, bank, head: head200 });
    expect(report.items.find((i) => i.id === ID_C)).toMatchObject({ status: "error", message: "yedekte yok" });
    expect(report.items.find((i) => i.id === ID_A)).toMatchObject({ status: "error", message: expect.stringMatching(/persona/) });
    expect(fake.table("users")).toHaveLength(0);
  });

  it("fotoğraf HEAD 200 değilse doğrulama düşer (foto_url_200)", async () => {
    const fake = setup();
    const report = await restoreFromBackup(fake.client, { apply: true, only: new Set([ID_A]), selection, bank, head: async () => 404 });
    expect(report.tally.verify_failed).toBe(1);
    expect(report.items[0].verify?.failed.map((c) => c.name)).toEqual(["foto_url_200"]);
  });
});
