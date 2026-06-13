import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    })),
  },
}));

import { setInterests } from '../services/user-interests.service.js';

describe('user-interests service', () => {
  it('persists empty interests as sen-sec fallback', async () => {
    const result = await setInterests('user-1', []);
    expect(result.interests).toEqual([]);
  });

  it('persists provided interests', async () => {
    const result = await setInterests('user-1', ['music', 'travel']);
    expect(result.interests).toEqual(['music', 'travel']);
  });
});
