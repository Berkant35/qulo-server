// src/__tests__/page-message.validator.test.ts
import { describe, it, expect } from "vitest";
import { createPageMessageSchema } from "../validators/page-message.validator.js";
import { SUPPORTED_LOCALES } from "../constants/locales.js";

const fullContent = Object.fromEntries(
  SUPPORTED_LOCALES.map((l) => [l, { title: "T", body: "B", cta_label: "C" }]),
);
const valid = {
  title: "Onboarding ipucu", page: "discover", display_type: "banner",
  content: fullContent, frequency: "once", priority: 0,
  action_url: "/discover", is_active: true,
};

describe("createPageMessageSchema", () => {
  it("16 dil tam → geçerli", () => {
    expect(createPageMessageSchema.safeParse(valid).success).toBe(true);
  });
  it("bir dil eksik → reddedilir", () => {
    const { tr, ...missing } = fullContent;
    expect(createPageMessageSchema.safeParse({ ...valid, content: missing }).success).toBe(false);
  });
  it("javascript: action_url → reddedilir", () => {
    expect(createPageMessageSchema.safeParse({ ...valid, action_url: "javascript:alert(1)" }).success).toBe(false);
  });
  it("harici http action_url → reddedilir", () => {
    expect(createPageMessageSchema.safeParse({ ...valid, action_url: "https://attacker.com" }).success).toBe(false);
  });
  it("quloapp.com action_url → geçerli", () => {
    expect(createPageMessageSchema.safeParse({ ...valid, action_url: "https://quloapp.com/discover" }).success).toBe(true);
  });
  it("http image_url → reddedilir (https zorunlu)", () => {
    expect(createPageMessageSchema.safeParse({ ...valid, image_url: "http://x.com/a.png" }).success).toBe(false);
  });
  it("geçersiz display_type → reddedilir", () => {
    expect(createPageMessageSchema.safeParse({ ...valid, display_type: "popup" }).success).toBe(false);
  });
});
