import { describe, expect, it } from "vitest";
import { DiscoverGroup, discoverGroupRank, passesLanguageGate } from "../../src/utils/discover-rank.js";

describe("discoverGroupRank (K3)", () => {
  it("sira: aktif kendi < aktif yabanci < seed < uyuyan kendi < uyuyan yabanci", () => {
    const sirali = [
      discoverGroupRank(false, false, true),
      discoverGroupRank(false, false, false),
      discoverGroupRank(true, false, true),
      discoverGroupRank(false, true, true),
      discoverGroupRank(false, true, false),
    ];
    expect(sirali).toEqual([...sirali].sort((a, b) => a - b));
    expect(new Set(sirali).size).toBe(5);
  });

  it("seed kendi aktifligine ve diline bakmaz", () => {
    for (const dormant of [true, false]) for (const own of [true, false]) {
      expect(discoverGroupRank(true, dormant, own)).toBe(DiscoverGroup.SEED);
    }
  });
});

describe("passesLanguageGate", () => {
  it("izleyici dillerinde TOPLAM >= 2 soru gerekir (dil basina degil)", () => {
    expect(passesLanguageGate(["tr", "en"], ["tr", "en"])).toBe(true);
    expect(passesLanguageGate(["tr", "de"], ["tr", "en"])).toBe(false);
    expect(passesLanguageGate(["tr", "tr"], ["tr"])).toBe(true);
  });
  it("izleyici dil listesi bossa herkes kendi dili sayilir", () => {
    expect(passesLanguageGate([], [])).toBe(true);
  });
});
