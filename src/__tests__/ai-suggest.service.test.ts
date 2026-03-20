import { describe, it, expect } from 'vitest';

function calculateScore(selectedCount: number, shownCount: number): number {
  return (selectedCount + 1) / (shownCount + 2);
}

describe('AI Question Bank Scoring', () => {
  it('new questions get ~0.5 score', () => {
    expect(calculateScore(0, 0)).toBe(0.5);
  });

  it('popular questions score higher', () => {
    const popular = calculateScore(50, 100);
    const veryPopular = calculateScore(80, 100);
    expect(veryPopular).toBeGreaterThan(popular);
  });

  it('unpopular questions score lower', () => {
    const unpopular = calculateScore(5, 100);
    const newQ = calculateScore(0, 0);
    expect(unpopular).toBeLessThan(newQ);
  });

  it('score is always between 0 and 1', () => {
    const cases = [[0, 0], [0, 1000], [1000, 1000], [50, 100]];
    for (const [sel, shown] of cases) {
      const score = calculateScore(sel, shown);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
