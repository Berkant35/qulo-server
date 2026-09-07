import { describe, it, expect } from 'vitest';
import { utcOffsetHours, localHour } from '../../../src/services/notification-engine/timezone.js';

describe('notification-engine/timezone', () => {
  it("locale 'tr' her zaman UTC+3 (boylam Istanbul icin +2 verirdi)", () => {
    expect(utcOffsetHours({ locale: 'tr', lng: 29 })).toBe(3);
    expect(utcOffsetHours({ locale: 'tr', lng: null })).toBe(3);
  });

  it('tr degilse boylamdan tahmin: round(lng/15)', () => {
    expect(utcOffsetHours({ locale: 'de', lng: 13.4 })).toBe(1);
    expect(utcOffsetHours({ locale: 'en', lng: -74 })).toBe(-5);
    expect(utcOffsetHours({ locale: 'ja', lng: 139.7 })).toBe(9);
  });

  it('boylam yoksa UTC', () => {
    expect(utcOffsetHours({ locale: 'en', lng: null })).toBe(0);
    expect(utcOffsetHours({ locale: 'ar' })).toBe(0);
  });

  it('asiri boylam [-12, 14] araligina kirpilir', () => {
    expect(utcOffsetHours({ locale: 'en', lng: 250 })).toBe(14);
    expect(utcOffsetHours({ locale: 'en', lng: -250 })).toBe(-12);
  });

  it('localHour gun sinirini sarar', () => {
    expect(localHour(new Date('2026-09-07T16:00:00Z'), 3)).toBe(19);
    expect(localHour(new Date('2026-09-07T23:00:00Z'), 3)).toBe(2);
    expect(localHour(new Date('2026-09-07T01:00:00Z'), -5)).toBe(20);
  });
});
