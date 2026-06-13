import { describe, it, expect } from 'vitest';

describe('discover photo filter', () => {
  it('filters out users with empty photos', () => {
    const candidates = [
      { id: 'a', photos: ['url1'], questionCount: 3 },
      { id: 'b', photos: [], questionCount: 3 },
      { id: 'c', photos: null, questionCount: 3 },
    ];
    const filtered = candidates.filter((c) => (c.photos?.length ?? 0) >= 1);
    expect(filtered.map((c) => c.id)).toEqual(['a']);
  });

  it('keeps users with at least 1 photo', () => {
    const candidates = [
      { id: 'a', photos: ['url1'] },
      { id: 'b', photos: ['url1', 'url2', 'url3'] },
    ];
    const filtered = candidates.filter((c) => (c.photos?.length ?? 0) >= 1);
    expect(filtered.length).toBe(2);
  });
});
