import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Supabase chain mocks ----------------------------------------------------
// update chain: from('users').update(...).eq('id', userId).select('id').maybeSingle()
const maybeSingleMock = vi.fn(() => Promise.resolve({ data: { id: 'user-1' }, error: null }));
const selectMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const eqMock = vi.fn(() => ({ select: selectMock }));
const updateMock = vi.fn(() => ({ eq: eqMock }));

vi.mock('../config/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({ update: updateMock })),
  },
}));

import { userInterestsService } from '../services/user-interests.service.js';

beforeEach(() => {
  updateMock.mockClear();
  eqMock.mockClear();
  selectMock.mockClear();
  maybeSingleMock.mockReset();
  // Default: user row exists
  maybeSingleMock.mockResolvedValue({ data: { id: 'user-1' }, error: null });
});

describe('user-interests service', () => {
  it('persists empty interests as empty array', async () => {
    const result = await userInterestsService.setInterests('user-1', []);
    expect(result.interests).toEqual([]);
    expect(updateMock).toHaveBeenCalledWith({ interests: [] });
    expect(eqMock).toHaveBeenCalledWith('id', 'user-1');
  });

  it('persists provided interests', async () => {
    const result = await userInterestsService.setInterests('user-1', ['music', 'travel']);
    expect(result.interests).toEqual(['music', 'travel']);
    expect(updateMock).toHaveBeenCalledWith({ interests: ['music', 'travel'] });
  });

  it('deduplicates repeated tags', async () => {
    const result = await userInterestsService.setInterests('user-1', ['music', 'music', 'travel', 'travel', 'music']);
    expect(result.interests).toEqual(['music', 'travel']);
    expect(updateMock).toHaveBeenCalledWith({ interests: ['music', 'travel'] });
  });

  it('propagates DB errors instead of masking them', async () => {
    const dbError = new Error('connection refused');
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: dbError } as never);
    await expect(userInterestsService.setInterests('user-1', ['music'])).rejects.toBe(dbError);
  });

  it('throws USER_NOT_FOUND when user row is missing', async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null } as never);
    await expect(userInterestsService.setInterests('u-9', ['music'])).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });
});
