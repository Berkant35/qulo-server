import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { whatsNewQuerySchema } from "../validators/whats-new.validator.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { getAppConfigHandler, getEconomyConfigHandler, getWhatsNewHandler } from "../controllers/app.controller.js";

const router = Router();

// No auth required — must be accessible before login
router.use(generalLimiter);

router.get("/config", getAppConfigHandler);
router.get("/economy", getEconomyConfigHandler);
router.get("/whats-new", validate(whatsNewQuerySchema, "query"), getWhatsNewHandler);

export default router;
