import { describe, it, expect, beforeEach, vi } from "vitest";
import type { IdentityInput } from "../../src/validators/identity.validator.js";
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from "../helpers/fake-supabase.js";

const ME = "11111111-1111-4111-8111-111111111111";
const HER = "22222222-2222-4222-8222-222222222222";

async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase({ users: [{ id: ME, is_deleted: false }], user_identity: [], user_consents: [], ...seed }, options);
  vi.doMock("../../src/config/supabase.js", () => ({ supabase: fake.client }));
  const { identityService } = await import("../../src/services/identity.service.js");
  return { fake, identityService };
}

const input = (over: Record<string, unknown> = {}): IdentityInput => ({
  gender_labels: [], orientation_labels: ["bisexual"],
  show_gender_labels: false, show_orientation_labels: false, consent: true, version: "2026-10-v1", ...over,
}) as IdentityInput;

beforeEach(() => vi.resetModules());

describe("identityService.getMine", () => {
  it("satır yoksa boş durum", async () => {
    const { identityService } = await setup();
    expect(await identityService.getMine(ME)).toEqual({
      gender_labels: [], orientation_labels: [], show_gender_labels: false, show_orientation_labels: false,
    });
  });
});

describe("identityService.save", () => {
  it("rızalı kayıt: önce ispat (identity_labels, sürüm), sonra satır", async () => {
    const { fake, identityService } = await setup();
    const state = await identityService.save(ME, input(), { platform: "ios", appVersion: "2.0.15" });
    expect(state).toMatchObject({ orientation_labels: ["bisexual"], show_orientation_labels: false });
    expect(fake.table("user_consents")).toEqual([
      expect.objectContaining({ user_id: ME, consent_type: "identity_labels", version: "2026-10-v1", platform: "ios" }),
    ]);
    expect(fake.table("user_identity")).toHaveLength(1);
  });

  it("rızasız boş olmayan kayıt: IDENTITY_CONSENT_REQUIRED, hiçbir şey yazılmaz", async () => {
    const { fake, identityService } = await setup();
    await expect(identityService.save(ME, input({ consent: undefined })))
      .rejects.toMatchObject({ code: "IDENTITY_CONSENT_REQUIRED", statusCode: 400 });
    expect(fake.table("user_identity")).toHaveLength(0);
    expect(fake.table("user_consents")).toHaveLength(0);
  });

  it("silinmiş hesap (süren erişim jetonu): USER_NOT_FOUND, ne rıza ne etiket yazılır", async () => {
    const { fake, identityService } = await setup({ users: [{ id: ME, is_deleted: true }] });
    await expect(identityService.save(ME, input())).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect(fake.table("user_identity")).toHaveLength(0);
    expect(fake.table("user_consents")).toHaveLength(0);
  });

  it("olmayan kullanıcı: USER_NOT_FOUND", async () => {
    const { fake, identityService } = await setup({ users: [] });
    await expect(identityService.save(ME, input())).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect(fake.table("user_identity")).toHaveLength(0);
  });

  it("silinmiş hesap boş listelerle (silme yolu) yine temizleyebilir", async () => {
    const { fake, identityService } = await setup({
      users: [{ id: ME, is_deleted: true }],
      user_identity: [{ user_id: ME, gender_labels: [], orientation_labels: ["gay"], show_gender_labels: false, show_orientation_labels: false }],
    });
    await identityService.save(ME, input({ orientation_labels: [], consent: undefined }));
    expect(fake.table("user_identity")).toHaveLength(0);
  });

  it("ispat yazılamazsa etiket yazılmaz", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fake, identityService } = await setup({}, { failOn: [{ table: "user_consents", op: "insert" }] });
    await expect(identityService.save(ME, input())).rejects.toThrow();
    expect(fake.table("user_identity")).toHaveLength(0);
  });

  it("iki liste boş: satır silinir, rıza gerekmez", async () => {
    const { fake, identityService } = await setup({
      user_identity: [{ user_id: ME, gender_labels: ["trans_woman"], orientation_labels: [], show_gender_labels: true, show_orientation_labels: false }],
    });
    const state = await identityService.save(ME, input({ orientation_labels: [], consent: undefined }));
    expect(state.gender_labels).toEqual([]);
    expect(fake.table("user_identity")).toHaveLength(0);
  });

  it("mevcut satırı günceller (upsert), tek satır kalır", async () => {
    const { fake, identityService } = await setup({
      user_identity: [{ user_id: ME, gender_labels: [], orientation_labels: ["gay"], show_gender_labels: false, show_orientation_labels: false }],
    });
    await identityService.save(ME, input({ orientation_labels: ["queer"], show_orientation_labels: true }));
    expect(fake.table("user_identity")).toEqual([
      expect.objectContaining({ user_id: ME, orientation_labels: ["queer"], show_orientation_labels: true }),
    ]);
  });
});

describe("identityService.visibleFor", () => {
  it("yalnız show_* true olan ve dolu gruplar döner; gizli grup ve görünür ama boş grup dönmez", async () => {
    const { identityService } = await setup({
      user_identity: [
        { user_id: ME, gender_labels: ["trans_woman"], orientation_labels: ["lesbian"], show_gender_labels: false, show_orientation_labels: true },
        { user_id: HER, gender_labels: [], orientation_labels: ["gay"], show_gender_labels: true, show_orientation_labels: false },
      ],
    });
    const map = await identityService.visibleFor([ME, HER]);
    expect(map.get(ME)).toEqual({ orientation_labels: ["lesbian"] });
    expect(map.has(HER)).toBe(false);
  });

  it("boş id listesi: sorgu atmaz", async () => {
    const { fake, identityService } = await setup();
    expect((await identityService.visibleFor([])).size).toBe(0);
    expect(fake.queries.filter((q) => q.table === "user_identity")).toHaveLength(0);
  });
});

describe("identityService.visibleFor — 100'lük parçalar", () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("101 id: iki sorgu, sonuçlar birleşir (her `.in()` ≤100 id)", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => uuid(i + 1));
    const row = (id: string) => ({ user_id: id, gender_labels: [], orientation_labels: ["gay"], show_gender_labels: false, show_orientation_labels: true });
    const { fake, identityService } = await setup({ user_identity: [row(ids[0]), row(ids[100])] });
    const map = await identityService.visibleFor(ids);
    expect(fake.queries.filter((q) => q.table === "user_identity")).toHaveLength(2);
    // İlk parçadan (id #1) ve ikinci parçadan (id #101, parça sınırının ötesi) satır geldi.
    expect([...map.keys()].sort()).toEqual([ids[0], ids[100]].sort());
  });

  it("100 id: tek sorgu", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => uuid(i + 1));
    const { fake, identityService } = await setup();
    await identityService.visibleFor(ids);
    expect(fake.queries.filter((q) => q.table === "user_identity")).toHaveLength(1);
  });
});

describe("identityService — hata günlüğü yalnız kod taşır", () => {
  const SIR = "gizli-etiket-degeri";
  const error = { code: "XX000", message: `leaks ${SIR}` };

  it.each([
    ["getMine", "select", (s: any) => s.getMine(ME)],
    ["removeFor", "delete", (s: any) => s.removeFor(ME)],
    ["visibleFor", "select", (s: any) => s.visibleFor([ME])],
    ["save", "insert", (s: any) => s.save(ME, input({ orientation_labels: ["gay"] }))],
  ] as const)("%s: SERVER_ERROR, günlükte yalnız hata kodu (%s hatası)", async (op, failOp, run) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // save: ispat (user_consents.insert) geçer, user_identity upsert (insert) patlar.
    const { identityService } = await setup({}, { failOn: [{ table: "user_identity", op: failOp, error }] });
    await expect(run(identityService)).rejects.toMatchObject({ code: "SERVER_ERROR" });
    expect(log).toHaveBeenCalledWith(`[identity] ${op} failed:`, "XX000");
    expect(JSON.stringify(log.mock.calls)).not.toContain(SIR);
    log.mockRestore();
  });
});

describe("identityService.visibleForSafe — süs arama akışı bozmaz", () => {
  const SIR = "gizli-etiket-degeri";

  it("hata: boş Map döner, atmaz; günlükte yalnız kod", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { identityService } = await setup({}, {
      failOn: [{ table: "user_identity", op: "select", error: { code: "XX000", message: `leaks ${SIR}` } }],
    });
    const map = await identityService.visibleForSafe([ME]);
    expect(map.size).toBe(0);
    expect(log).toHaveBeenCalledWith("[identity] visibleFor failed:", "XX000"); // kaynak hata (DB kodu)
    expect(log).toHaveBeenCalledWith("[identity] visible lookup failed:", "SERVER_ERROR"); // sarmal (AppError kodu)
    expect(JSON.stringify(log.mock.calls)).not.toContain(SIR);
    log.mockRestore();
  });

  it("başarı: visibleFor ile aynı sonuç", async () => {
    const { identityService } = await setup({
      user_identity: [{ user_id: ME, gender_labels: [], orientation_labels: ["gay"], show_gender_labels: false, show_orientation_labels: true }],
    });
    expect((await identityService.visibleForSafe([ME])).get(ME)).toEqual({ orientation_labels: ["gay"] });
  });
});

describe("identityService.removeFor", () => {
  it("kullanıcının satırını siler", async () => {
    const { fake, identityService } = await setup({
      user_identity: [{ user_id: ME, gender_labels: [], orientation_labels: ["gay"], show_gender_labels: false, show_orientation_labels: false }],
    });
    await identityService.removeFor(ME);
    expect(fake.table("user_identity")).toHaveLength(0);
  });
});
