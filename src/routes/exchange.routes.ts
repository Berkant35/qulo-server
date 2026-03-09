import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { convertSchema, buyPowerSchema } from "../validators/exchange.validator.js";
import {
  convertHandler,
  buyPowerHandler,
  getInventoryHandler,
  getRatesHandler,
} from "../controllers/exchange.controller.js";

const router = Router();

router.use(authMiddleware);
router.use(generalLimiter);

router.post("/convert", validate(convertSchema), convertHandler);
router.post("/buy-power", validate(buyPowerSchema), buyPowerHandler);
router.get("/inventory", getInventoryHandler);
router.get("/rates", getRatesHandler);

export default router;
