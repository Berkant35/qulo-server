import { describe, it, expect, vi } from 'vitest';

const eqMock = vi.fn(() => Promise.resolve({ data: null, error: null }));
const updateMock = vi.fn(() => ({ eq: eqMock }));

vi.mock('../config/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({ update: updateMock })),
  },
}));

import { setInterests } from '../services/user-interests.service.js';

describe('user-interests service', () => {
  it('persists empty interests as empty array', async () => {
    const result = await setInterests('user-1', []);
    expect(result.interests).toEqual([]);
    expect(updateMock).toHaveBeenCalledWith({ interests: [] });
    expect(eqMock).toHaveBeenCalledWith('id', 'user-1');
  });

  it('persists provided interests', async () => {
    const result = await setInterests('user-1', ['music', 'travel']);
    expect(result.interests).toEqual(['music', 'travel']);
    expect(updateMock).toHaveBeenCalledWith({ interests: ['music', 'travel'] });
  });

  it('deduplicates repeated tags', async () => {
    const result = await setInterests('user-1', ['music', 'music', 'travel', 'travel', 'music']);
    expect(result.interests).toEqual(['music', 'travel']);
    expect(updateMock).toHaveBeenCalledWith({ interests: ['music', 'travel'] });
  });

  it('propagates DB errors instead of masking them', async () => {
    const dbError = new Error('connection refused');
    eqMock.mockResolvedValueOnce({ data: null, error: dbError } as never);
    await expect(setInterests('user-1', ['music'])).rejects.toBe(dbError);
  });
});
