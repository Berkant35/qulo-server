import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { historyQuerySchema, purchaseSchema } from "../validators/diamond.validator.js";
import {
  getBalanceHandler,
  getHistoryHandler,
  purchaseHandler,
} from "../controllers/diamond.controller.js";

const router = Router();

router.use(authMiddleware);
router.use(generalLimiter);

router.get("/balance", getBalanceHandler);
router.get("/history", validate(historyQuerySchema, "query"), getHistoryHandler);
router.post("/purchase", validate(purchaseSchema), purchaseHandler);

export default router;
