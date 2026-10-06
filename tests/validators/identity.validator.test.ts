import { describe, it, expect } from "vitest";
import { identitySchema } from "../../src/validators/identity.validator.js";

const base = { gender_labels: [], orientation_labels: [], show_gender_labels: false, show_orientation_labels: false };

describe("identitySchema", () => {
  it("geçerli: katalogdan ≤3, rıza + sürüm", () => {
    expect(identitySchema.safeParse({ ...base, orientation_labels: ["bisexual", "queer"], consent: true, version: "2026-10-v1" }).success).toBe(true);
  });
  it("boş listeler (silme) rızasız geçer", () => {
    expect(identitySchema.safeParse(base).success).toBe(true);
  });
  it("katalog dışı etiket reddedilir", () => {
    expect(identitySchema.safeParse({ ...base, orientation_labels: ["heterosexual"] }).success).toBe(false);
  });
  it("3'ten fazla reddedilir", () => {
    expect(identitySchema.safeParse({ ...base, gender_labels: ["cis_woman", "trans_woman", "non_binary", "agender"] }).success).toBe(false);
  });
  it("tekrar reddedilir", () => {
    expect(identitySchema.safeParse({ ...base, orientation_labels: ["gay", "gay"] }).success).toBe(false);
  });
  it("bilinmeyen rıza sürümü reddedilir (ispat defterine keyfi metin yazılmaz)", () => {
    const withVersion = (version: string) => identitySchema.safeParse({ ...base, orientation_labels: ["gay"], consent: true, version });
    expect(withVersion("2026-10-v2").success).toBe(false);
    expect(withVersion("whatever").success).toBe(false);
    expect(withVersion("2026-10-v1").success).toBe(true);
  });
  it("sürüm gönderilmeyebilir (sunucu varsayılanı kullanır)", () => {
    expect(identitySchema.safeParse({ ...base, orientation_labels: ["gay"], consent: true }).success).toBe(true);
  });
  it("show_* boolean zorunlu", () => {
    expect(identitySchema.safeParse({ gender_labels: [], orientation_labels: [] }).success).toBe(false);
  });
  it.each(["show_gender_labels", "show_orientation_labels"])("%s tek başına eksikse reddedilir", (key) => {
    const { [key as keyof typeof base]: _omit, ...rest } = base;
    expect(identitySchema.safeParse(rest).success).toBe(false);
  });
  it.each(["show_gender_labels", "show_orientation_labels"])("%s boolean değilse reddedilir", (key) => {
    for (const bad of ["true", 1, null]) {
      expect(identitySchema.safeParse({ ...base, [key]: bad }).success).toBe(false);
    }
  });
  it('consent: "yes" (boolean değil) reddedilir', () => {
    expect(identitySchema.safeParse({ ...base, orientation_labels: ["gay"], consent: "yes" }).success).toBe(false);
  });
});
