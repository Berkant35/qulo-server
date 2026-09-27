import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { generalLimiter, rewardRedeemLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { redeemSchema, redemptionsQuerySchema } from "../validators/rewards.validator.js";
import {
  getMarketHandler,
  redeemHandler,
  listRedemptionsHandler,
} from "../controllers/rewards.controller.js";

const router = Router();

// Auth limiter'dan ÖNCE: itfa limiter'ı kullanıcı anahtarlı (userKey req.user'ı okur).
router.use(authMiddleware);

router.get("/market", generalLimiter, getMarketHandler);
router.post("/redeem", rewardRedeemLimiter, validate(redeemSchema), redeemHandler);
router.get("/redemptions", generalLimiter, validate(redemptionsQuerySchema, "query"), listRedemptionsHandler);

export default router;
