import { Router } from "express";
import { discoverLimiter, generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { authMiddleware } from "../middleware/auth.js";
import { swipeSchema, discoverQuerySchema } from "../validators/match.validator.js";
import {
  discoverHandler,
  swipeHandler,
  undoSwipeHandler,
  getMatchesHandler,
  unmatchHandler,
} from "../controllers/match.controller.js";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

router.get("/discover", discoverLimiter, validate(discoverQuerySchema, "query"), discoverHandler);
router.post("/swipe", generalLimiter, validate(swipeSchema), swipeHandler);
router.delete("/swipe/:target_id", generalLimiter, undoSwipeHandler);
router.get("/list", generalLimiter, getMatchesHandler);
router.delete("/:match_id", generalLimiter, unmatchHandler);

export default router;
