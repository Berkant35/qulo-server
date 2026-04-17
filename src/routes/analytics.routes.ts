import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { analyticsTrackLimiter } from "../middleware/rateLimit.js";
import { supabase } from "../config/supabase.js";
import type { Request, Response, NextFunction } from "express";

const router = Router();

// ── Validation schema ──
const MAX_METADATA_BYTES = 4096;

const eventSchema = z.object({
  event_name: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.:/ -]+$/),
  category: z.string().min(1).max(30).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  metadata: z.record(z.any()).optional().refine(
    (v) => v === undefined || JSON.stringify(v).length <= MAX_METADATA_BYTES,
    { message: `metadata must be ≤ ${MAX_METADATA_BYTES} bytes` },
  ),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(50), // Max 50 events per batch
});

// POST /api/v1/analytics/track — batch event ingestion
router.post(
  "/track",
  authMiddleware,
  analyticsTrackLimiter,
  validate(batchSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const sessionId = (req.headers["x-session-id"] as string) || null;
      const body = req.body as z.infer<typeof batchSchema>;

      const rows = body.events.map((e) => ({
        user_id: userId,
        session_id: sessionId,
        event_category: e.category || "mobile_event",
        event_name: e.event_name,
        endpoint: null,
        method: null,
        status_code: 200,
        response_time_ms: 0,
        metadata: {
          ...(e.metadata ?? {}),
          source: "mobile_client",
        },
      }));

      // Fire-and-forget insert — don't block the response, catch all errors
      void (async () => {
        try {
          const { error } = await supabase.from("flow_events").insert(rows);
          if (error) {
            console.error("[analytics/track] Insert error:", error.message);
          }
        } catch (err) {
          console.error("[analytics/track] Unexpected error:", err instanceof Error ? err.message : err);
        }
      })();

      res.status(202).json({ ok: true, accepted: rows.length });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
