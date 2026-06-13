import { describe, it, expect } from 'vitest';
import { setInterestsSchema } from '../validators/user.validator.js';

describe('setInterestsSchema', () => {
  it('accepts valid interests', () => {
    const result = setInterestsSchema.safeParse({ interests: ['music', 'travel'] });
    expect(result.success).toBe(true);
  });

  it('accepts empty array (sen-sec scenario)', () => {
    const result = setInterestsSchema.safeParse({ interests: [] });
    expect(result.success).toBe(true);
  });

  it('rejects invalid tag', () => {
    const result = setInterestsSchema.safeParse({ interests: ['foo'] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 12', () => {
    const tags = new Array(13).fill('music');
    const result = setInterestsSchema.safeParse({ interests: tags });
    expect(result.success).toBe(false);
  });
});
