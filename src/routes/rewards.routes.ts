import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { rewardReadLimiter, rewardRedeemLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { marketQuerySchema, redeemSchema, redemptionsQuerySchema } from "../validators/rewards.validator.js";
import {
  getMarketHandler,
  redeemHandler,
  listRedemptionsHandler,
} from "../controllers/rewards.controller.js";

const router = Router();

// Auth limiter'lardan ÖNCE: hepsi kullanıcı anahtarlı (userKey req.user'ı okur).
router.use(authMiddleware);

router.get("/market", rewardReadLimiter, validate(marketQuerySchema, "query"), getMarketHandler);
router.post("/redeem", rewardRedeemLimiter, validate(redeemSchema), redeemHandler);
router.get("/redemptions", rewardReadLimiter, validate(redemptionsQuerySchema, "query"), listRedemptionsHandler);

export default router;
