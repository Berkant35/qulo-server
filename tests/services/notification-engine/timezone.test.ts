import { describe, it, expect } from 'vitest';
import { utcOffsetHours, localHour, localClock } from '../../../src/services/notification-engine/timezone.js';

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

describe('localClock', () => {
  it('UTC+3: saat/dakika/tarih/ISO gun kayar; gece yarisi gecisi tarihi ilerletir', () => {
    // 2026-09-25 Cuma 22:30 UTC → tr 2026-09-26 Cumartesi 01:30
    const c = localClock(new Date('2026-09-25T22:30:00.000Z'), 3);
    expect(c).toMatchObject({ hour: 1, minuteOfDay: 90, date: '2026-09-26', isoWeekday: 6 });
    const utc = localClock(new Date('2026-09-25T22:30:00.000Z'), 0);
    expect(utc).toMatchObject({ hour: 22, date: '2026-09-25', isoWeekday: 5 });
    expect(c.dayIndex).toBe(utc.dayIndex + 1);
  });

  it('localHour ile tutarli', () => {
    const now = new Date('2026-09-25T16:00:00.000Z');
    for (const off of [-12, -5, 0, 3, 9, 14]) expect(localClock(now, off).hour).toBe(localHour(now, off));
  });
});
