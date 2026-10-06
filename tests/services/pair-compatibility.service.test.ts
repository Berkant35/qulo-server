import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeSupabase, type Tables } from "../helpers/fake-supabase.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

async function setup(users: Tables["users"], mutual: boolean) {
  const fake = createFakeSupabase({ users });
  vi.doMock("../../src/config/supabase.js", () => ({ supabase: fake.client }));
  vi.doMock("../../src/services/app-config.service.js", () => ({
    appConfigService: { getMutualMatchEnabled: async () => mutual },
  }));
  const { pairCompatibilityService } = await import("../../src/services/pair-compatibility.service.js");
  return { fake, pairCompatibilityService };
}

const u = (id: string, gender: string | null, gender_pref: string | null) => ({ id, gender, gender_pref, is_deleted: false });

beforeEach(() => vi.resetModules());

describe("pairCompatibilityService.assertCompatible", () => {
  it("anahtar kapalı: hiç sorgu atmaz, geçer", async () => {
    const { fake, pairCompatibilityService } = await setup([u(A, "MAN", "MAN"), u(B, "MAN", "WOMAN")], false);
    await expect(pairCompatibilityService.assertCompatible(A, B)).resolves.toBeUndefined();
    expect(fake.queries.filter((q) => q.table === "users")).toHaveLength(0);
  });

  it("anahtar açık + uyumlu (gey × gey): geçer", async () => {
    const { pairCompatibilityService } = await setup([u(A, "MAN", "MAN"), u(B, "MAN", "MAN")], true);
    await expect(pairCompatibilityService.assertCompatible(A, B)).resolves.toBeUndefined();
  });

  // Kehanet açığı (spec 2026-10-06): uyumsuzluk var olmayan hedefle AYNI yanıtı verir; 403/404
  // farkından hedefin cinsiyet tercihi okunamaz.
  it("anahtar açık + uyumsuz (gey × hetero erkek): USER_NOT_FOUND 404 (NOT_COMPATIBLE değil)", async () => {
    const { pairCompatibilityService } = await setup([u(A, "MAN", "MAN"), u(B, "MAN", "WOMAN")], true);
    await expect(pairCompatibilityService.assertCompatible(A, B))
      .rejects.toMatchObject({ code: "USER_NOT_FOUND", statusCode: 404 });
  });

  it("hedef silinmiş/yok: USER_NOT_FOUND 404", async () => {
    const { pairCompatibilityService } = await setup([u(A, "MAN", "MAN"), { ...u(B, "MAN", "MAN"), is_deleted: true }], true);
    await expect(pairCompatibilityService.assertCompatible(A, B))
      .rejects.toMatchObject({ code: "USER_NOT_FOUND", statusCode: 404 });
  });
});
