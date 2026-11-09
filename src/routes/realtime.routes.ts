import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { realtimeTokenLimiter } from "../middleware/rateLimit.js";
import { realtimeTokenService } from "../services/realtime-token.service.js";

const router = Router();

// POST /api/v1/realtime/token: Supabase Realtime için kısa ömürlü kullanıcı JWT'si.
// Sözleşme: tasks/surum-2.0.18-sozlesmeler.md "Realtime token".
router.post("/token", authMiddleware, realtimeTokenLimiter, (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(realtimeTokenService.issue(req.user!.userId));
  } catch (err) {
    next(err);
  }
});

export default router;
