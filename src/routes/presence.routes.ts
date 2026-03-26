import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { PresenceService } from "../services/presence.service.js";

const router = Router();

// POST /api/v1/users/me/presence — heartbeat
router.post("/", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await PresenceService.heartbeat(req.user!.userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/me/presence/offline — explicit offline
router.post("/offline", authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await PresenceService.setOffline(req.user!.userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
