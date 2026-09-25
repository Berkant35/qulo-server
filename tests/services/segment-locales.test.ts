import { describe, it, expect } from 'vitest';
import { segmentService, type SegmentUser } from '../../src/services/segment.service.js';

const user: SegmentUser = {
  locale: 'tr', gender: 'WOMAN', age: 25, city: 'Istanbul', subscription_plan: 'free',
  last_seen_at: null, profile_completion: 80, created_at: null, question_count: 2, green_diamonds: 5,
};

describe('segment.locales', () => {
  it('locales listesi: kullanicinin dili listede degilse eslesmez; bos liste = herkes', () => {
    expect(segmentService.matchesSegment(user, { locales: ['tr'] })).toBe(true);
    expect(segmentService.matchesSegment(user, { locales: ['en', 'de'] })).toBe(false);
    expect(segmentService.matchesSegment({ ...user, locale: null }, { locales: ['tr'] })).toBe(false);
    expect(segmentService.matchesSegment(user, { locales: [] })).toBe(true);
    expect(segmentService.matchesSegment({ ...user, locale: undefined }, {})).toBe(true);
  });
});
