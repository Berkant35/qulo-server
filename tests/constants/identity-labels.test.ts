import { describe, it, expect } from "vitest";
import { GENDER_LABELS, ORIENTATION_LABELS, MAX_LABELS_PER_GROUP, IDENTITY_CONSENT_VERSION } from "../../src/constants/identity-labels.js";

describe("identity-labels kataloğu (spec §1 kanonik liste, sıra dahil)", () => {
  it("kimlik", () => {
    expect([...GENDER_LABELS]).toEqual([
      "cis_woman", "cis_man", "trans_woman", "trans_man", "non_binary", "genderqueer", "genderfluid",
      "agender", "bigender", "intersex", "transfeminine", "transmasculine", "questioning",
    ]);
  });
  it("yönelim", () => {
    expect([...ORIENTATION_LABELS]).toEqual([
      "straight", "gay", "lesbian", "bisexual", "pansexual", "asexual", "demisexual", "queer",
      "questioning", "heteroflexible", "homoflexible",
    ]);
  });
  it("sınır ve rıza sürümü", () => {
    expect(MAX_LABELS_PER_GROUP).toBe(3);
    expect(IDENTITY_CONSENT_VERSION).toBe("2026-10-v1");
  });
});
