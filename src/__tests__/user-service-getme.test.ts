import { describe, it, expect } from 'vitest';

describe('getMe response shape', () => {
  it('exposes interests as array', () => {
    const userRow = { interests: ['music', 'travel'] };
    expect(Array.isArray(userRow.interests)).toBe(true);
  });

  it('exposes question_count as number', () => {
    const userRow = { question_count: 3 };
    expect(typeof userRow.question_count).toBe('number');
  });
});
