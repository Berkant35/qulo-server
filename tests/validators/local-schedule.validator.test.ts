import { describe, it, expect } from 'vitest';
import { localScheduleSchema, LOCAL_SCHEDULE_MAX_AHEAD_MS } from '../../src/validators/local-schedule.validator.js';

const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('localScheduleSchema', () => {
  it('bilinen kurallar + gelecekteki until geçerli', () => {
    const r = localScheduleSchema.safeParse({ localScheduled: ['quiz_unfinished', 'return_7d'], until: inMs(7 * 24 * 3600e3) });
    expect(r.success).toBe(true);
  });

  it('bilinmeyen kural adı reddedilir', () => {
    const r = localScheduleSchema.safeParse({ localScheduled: ['quiz_unfinished', 'unread_message'], until: inMs(3600e3) });
    expect(r.success).toBe(false);
  });

  it('until şimdi+8 günü aşarsa reddedilir; sınırın hemen içi kabul', () => {
    expect(localScheduleSchema.safeParse({ localScheduled: ['new_people'], until: inMs(LOCAL_SCHEDULE_MAX_AHEAD_MS + 60_000) }).success).toBe(false);
    expect(localScheduleSchema.safeParse({ localScheduled: ['new_people'], until: inMs(LOCAL_SCHEDULE_MAX_AHEAD_MS - 60_000) }).success).toBe(true);
  });

  it('dolu liste until olmadan veya ISO olmayan until ile reddedilir', () => {
    expect(localScheduleSchema.safeParse({ localScheduled: ['new_people'] }).success).toBe(false);
    expect(localScheduleSchema.safeParse({ localScheduled: ['new_people'], until: 'yarin' }).success).toBe(false);
  });

  it('boş liste (temizle) until olmadan da geçerli', () => {
    expect(localScheduleSchema.safeParse({ localScheduled: [] }).success).toBe(true);
  });

  it('localScheduled dizi değilse reddedilir', () => {
    expect(localScheduleSchema.safeParse({ localScheduled: 'quiz_unfinished', until: inMs(1000) }).success).toBe(false);
  });
});
