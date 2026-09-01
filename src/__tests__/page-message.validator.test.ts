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
  describe("content", () => {
    it("tüm diller dolu → geçerli", () => {
      expect(createPageMessageSchema.safeParse(valid).success).toBe(true);
    });

    // Kural bilinçli olarak gevşetildi: eksik diller mobile'da localized() ile
    // fallback'e düşüyor, o yüzden tek dil yeterli.
    it("sadece bir dil dolu → geçerli (diğerleri fallback'e düşer)", () => {
      const onlyTr = { tr: { title: "T", body: "B", cta_label: "C" } };
      expect(createPageMessageSchema.safeParse({ ...valid, content: onlyTr }).success).toBe(true);
    });

    it("bir dil eksik → geçerli", () => {
      const { tr, ...missing } = fullContent;
      expect(createPageMessageSchema.safeParse({ ...valid, content: missing }).success).toBe(true);
    });

    it("hiç dil yok → reddedilir", () => {
      expect(createPageMessageSchema.safeParse({ ...valid, content: {} }).success).toBe(false);
    });

    it("başlığı boş dil → reddedilir", () => {
      const emptyTitle = { tr: { title: "", body: "B", cta_label: "C" } };
      expect(createPageMessageSchema.safeParse({ ...valid, content: emptyTitle }).success).toBe(false);
    });

    it("body ve cta_label opsiyonel → sadece başlık yeterli", () => {
      const titleOnly = { tr: { title: "Sadece başlık" } };
      expect(createPageMessageSchema.safeParse({ ...valid, content: titleOnly }).success).toBe(true);
    });
  });

  describe("action_url", () => {
    it("javascript: → reddedilir", () => {
      expect(createPageMessageSchema.safeParse({ ...valid, action_url: "javascript:alert(1)" }).success).toBe(false);
    });
    it("harici http → reddedilir", () => {
      expect(createPageMessageSchema.safeParse({ ...valid, action_url: "https://attacker.com" }).success).toBe(false);
    });
    it("quloapp.com → geçerli", () => {
      expect(createPageMessageSchema.safeParse({ ...valid, action_url: "https://quloapp.com/discover" }).success).toBe(true);
    });
    it("internal path → geçerli", () => {
      expect(createPageMessageSchema.safeParse({ ...valid, action_url: "/profile/settings" }).success).toBe(true);
    });
    it("null → geçerli (PATCH'te kolonu temizler)", () => {
      expect(createPageMessageSchema.safeParse({ ...valid, action_url: null }).success).toBe(true);
    });
  });

  describe("image_url", () => {
    it("http → reddedilir (https zorunlu)", () => {
      expect(createPageMessageSchema.safeParse({ ...valid, image_url: "http://x.com/a.png" }).success).toBe(false);
    });
    it("https → geçerli", () => {
      expect(createPageMessageSchema.safeParse({ ...valid, image_url: "https://x.com/a.png" }).success).toBe(true);
    });
  });

  it("geçersiz display_type → reddedilir", () => {
    expect(createPageMessageSchema.safeParse({ ...valid, display_type: "popup" }).success).toBe(false);
  });

  it("geçersiz page → reddedilir", () => {
    expect(createPageMessageSchema.safeParse({ ...valid, page: "olmayan_sayfa" }).success).toBe(false);
  });
});
