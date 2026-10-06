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
  it("show_* boolean zorunlu", () => {
    expect(identitySchema.safeParse({ gender_labels: [], orientation_labels: [] }).success).toBe(false);
  });
});
