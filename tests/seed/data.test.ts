import { describe, it, expect } from 'vitest';
import { TR_CITIES, TOTAL_QUOTA } from '../../scripts/seed/data/tr-cities.js';
import { TR_FEMALE_FIRST_NAMES, TR_SURNAMES } from '../../scripts/seed/data/tr-female-names.js';

describe('TR_CITIES', () => {
  it('quotas sum to 350', () => {
    const sum = TR_CITIES.reduce((acc, c) => acc + c.count, 0);
    expect(sum).toBe(350);
    expect(TOTAL_QUOTA).toBe(350);
  });

  it('all cities have valid lat/lng in Turkey bounds', () => {
    for (const c of TR_CITIES) {
      expect(c.lat).toBeGreaterThan(35);   // Turkey south ≈ 36.0
      expect(c.lat).toBeLessThan(43);      // Turkey north ≈ 42.1
      expect(c.lng).toBeGreaterThan(25);   // Turkey west ≈ 26.0
      expect(c.lng).toBeLessThan(45);      // Turkey east ≈ 44.8
    }
  });

  it('all city names are unique non-empty strings', () => {
    const names = TR_CITIES.map(c => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n.length).toBeGreaterThan(0);
  });

  it('all counts are positive integers', () => {
    for (const c of TR_CITIES) {
      expect(Number.isInteger(c.count)).toBe(true);
      expect(c.count).toBeGreaterThan(0);
    }
  });
});

describe('TR_FEMALE_FIRST_NAMES', () => {
  it('has at least 60 unique entries', () => {
    expect(TR_FEMALE_FIRST_NAMES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(TR_FEMALE_FIRST_NAMES).size).toBe(TR_FEMALE_FIRST_NAMES.length);
  });

  it('all entries are non-empty trimmed strings', () => {
    for (const n of TR_FEMALE_FIRST_NAMES) {
      expect(n.length).toBeGreaterThan(0);
      expect(n).toBe(n.trim());
    }
  });
});

describe('TR_SURNAMES', () => {
  it('has at least 80 unique entries', () => {
    expect(TR_SURNAMES.length).toBeGreaterThanOrEqual(80);
    expect(new Set(TR_SURNAMES).size).toBe(TR_SURNAMES.length);
  });

  it('combinatorial space supports 350 unique pairs', () => {
    expect(TR_FEMALE_FIRST_NAMES.length * TR_SURNAMES.length).toBeGreaterThan(350 * 10);
  });
});
