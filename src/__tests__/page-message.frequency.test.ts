import { describe, it, expect } from "vitest";
import { passesFrequency } from "../services/page-message.service.js";

const today = new Date().toISOString();
const yesterday = new Date(Date.now() - 86_400_000).toISOString();

describe("passesFrequency", () => {
  it("once: hiç shown yoksa geçer", () => {
    expect(passesFrequency("once", [])).toBe(true);
  });
  it("once: shown varsa geçmez", () => {
    expect(passesFrequency("once", [{ event: "shown", created_at: yesterday }])).toBe(false);
  });
  it("until_dismissed: dismissed varsa geçmez", () => {
    expect(passesFrequency("until_dismissed", [{ event: "shown", created_at: yesterday }])).toBe(true);
    expect(passesFrequency("until_dismissed", [{ event: "dismissed", created_at: yesterday }])).toBe(false);
  });
  it("daily: bugün shown varsa geçmez, dünkü shown geçer", () => {
    expect(passesFrequency("daily", [{ event: "shown", created_at: today }])).toBe(false);
    expect(passesFrequency("daily", [{ event: "shown", created_at: yesterday }])).toBe(true);
  });
  it("every_visit: her zaman geçer", () => {
    expect(passesFrequency("every_visit", [{ event: "shown", created_at: today }])).toBe(true);
  });
});
