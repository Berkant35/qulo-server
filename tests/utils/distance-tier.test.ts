import { describe, it, expect } from "vitest";
import { resolveDistanceTier } from "../../src/utils/distance-tier.js";

describe("resolveDistanceTier", () => {
  it("radius icindeki aday tier 0, sinir radius", () => {
    expect(resolveDistanceTier(30, 50)).toEqual({ tier: 0, boundaryKm: 50 });
  });

  it("radius sinirindaki aday hala tier 0 (kapsayici)", () => {
    expect(resolveDistanceTier(50, 50)).toEqual({ tier: 0, boundaryKm: 50 });
  });

  it("radius x3 icindeki aday tier 1", () => {
    expect(resolveDistanceTier(120, 50)).toEqual({ tier: 1, boundaryKm: 150 });
  });

  it("1000 km icindeki aday tier 2", () => {
    expect(resolveDistanceTier(400, 50)).toEqual({ tier: 2, boundaryKm: 1000 });
  });

  it("1000 km ustundeki aday tier 3", () => {
    expect(resolveDistanceTier(3000, 50)).toEqual({ tier: 3, boundaryKm: 20000 });
  });

  // Buyuk radius'ta sinirlar monotonik kalmali: radius=500 icin tier 1 siniri 1500,
  // yani sabit 1000'lik tier 2 araya giremez -- aksi halde tier 2'nin siniri
  // tier 1'inkinden kucuk olur ve "uzak olan daha yakin skorlanir" sacmaligi cikar.
  it("buyuk radius'ta tier sinirlari monotonik", () => {
    expect(resolveDistanceTier(1200, 500)).toEqual({ tier: 1, boundaryKm: 1500 });
    expect(resolveDistanceTier(1800, 500)).toEqual({ tier: 3, boundaryKm: 20000 });
  });
});
