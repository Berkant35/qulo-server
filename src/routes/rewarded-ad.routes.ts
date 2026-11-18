import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { rewardReadLimiter, rewardedAdSsvLimiter } from "../middleware/rateLimit.js";
import { rewardedAdSsvHandler, rewardedAdStatusHandler } from "../controllers/rewarded-ad.controller.js";

/**
 * `/api/v1/rewards/rewarded-ad` — rewards.routes'tan ÖNCE bağlanır: o router tüm rotalara
 * authMiddleware uygular, oysa SSV'yi Google (kimliksiz) çağırır.
 */
const router = Router();

router.get("/status", authMiddleware, rewardReadLimiter, rewardedAdStatusHandler);
router.get("/ssv", rewardedAdSsvLimiter, rewardedAdSsvHandler);

export default router;
