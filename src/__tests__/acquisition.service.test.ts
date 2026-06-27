import { describe, it, expect } from "vitest";
import { pickLabel } from "../utils/locales.js";

describe("pickLabel", () => {
  it("returns the requested locale when present", () => {
    expect(pickLabel({ tr: "Merhaba", en: "Hello" }, "tr")).toBe("Merhaba");
  });

  it("falls back to en when locale missing", () => {
    expect(pickLabel({ en: "Hello" }, "de")).toBe("Hello");
  });

  it("falls back to first non-empty when en missing", () => {
    expect(pickLabel({ fr: "Bonjour" }, "de")).toBe("Bonjour");
  });

  it("returns empty string for null label", () => {
    expect(pickLabel(null, "tr")).toBe("");
  });
});
