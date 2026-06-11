import { describe, it, expect } from 'vitest';
import { rand, jitter, pickRandom, weightedPick, sample } from '../../scripts/seed/lib/random.js';

describe('rand', () => {
  it('returns integer in [min, max] inclusive', () => {
    for (let i = 0; i < 100; i++) {
      const r = rand(1, 4);
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(4);
    }
  });

  it('returns the only value when min==max', () => {
    expect(rand(7, 7)).toBe(7);
  });
});

describe('jitter', () => {
  it('returns value in [-magnitude, magnitude]', () => {
    for (let i = 0; i < 100; i++) {
      const j = jitter(0.05);
      expect(j).toBeGreaterThanOrEqual(-0.05);
      expect(j).toBeLessThanOrEqual(0.05);
    }
  });
});

describe('pickRandom', () => {
  it('returns an element from the array', () => {
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) {
      expect(arr).toContain(pickRandom(arr));
    }
  });

  it('throws on empty array', () => {
    expect(() => pickRandom([])).toThrow();
  });
});

describe('weightedPick', () => {
  it('respects weights statistically', () => {
    const weights = { A: 90, B: 10 };
    const counts = { A: 0, B: 0 };
    for (let i = 0; i < 10000; i++) {
      counts[weightedPick(weights)]++;
    }
    expect(counts.A).toBeGreaterThan(8500);
    expect(counts.A).toBeLessThan(9500);
  });

  it('throws when weights sum to 0', () => {
    expect(() => weightedPick({ A: 0, B: 0 })).toThrow();
  });
});

describe('sample', () => {
  it('returns N unique elements', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const picked = sample(arr, 5);
    expect(picked.length).toBe(5);
    expect(new Set(picked).size).toBe(5);
    for (const p of picked) expect(arr).toContain(p);
  });

  it('throws when N > arr.length', () => {
    expect(() => sample([1, 2], 5)).toThrow();
  });
});
