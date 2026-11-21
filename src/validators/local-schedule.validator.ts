import { z } from 'zod';

/**
 * Istemcinin yerel planladigi bildirim kurallari — mobil `LocalScheduleRule.wireName` ile birebir.
 * Bu adlar DEGISMEZ (sozlesme: docs/local-schedule-api.md).
 */
export const LOCAL_SCHEDULE_RULES = ['quiz_unfinished', 'limit_refreshed', 'new_people', 'return_3d', 'return_7d'] as const;
export type LocalScheduleRule = (typeof LOCAL_SCHEDULE_RULES)[number];

/** Yerel plan en fazla bu kadar ileriye bildirilebilir (en uzun yerel kural return_7d + sessiz saat payi). */
export const LOCAL_SCHEDULE_MAX_AHEAD_MS = 8 * 24 * 60 * 60 * 1000;

export const localScheduleSchema = z
  .object({
    localScheduled: z.array(z.enum(LOCAL_SCHEDULE_RULES)).max(LOCAL_SCHEDULE_RULES.length),
    until: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.localScheduled.length === 0) return; // temizleme: until anlamsiz
    if (!body.until) {
      ctx.addIssue({ code: 'custom', path: ['until'], message: 'until is required when localScheduled is not empty' });
      return;
    }
    if (Date.parse(body.until) > Date.now() + LOCAL_SCHEDULE_MAX_AHEAD_MS) {
      ctx.addIssue({ code: 'custom', path: ['until'], message: 'until must be at most 8 days ahead' });
    }
  });

export type LocalScheduleInput = z.infer<typeof localScheduleSchema>;
