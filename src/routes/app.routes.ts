import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { whatsNewQuerySchema } from "../validators/whats-new.validator.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { citySearchQuerySchema } from "../validators/city.validator.js";
import { getAppConfigHandler, getCitiesHandler, getEconomyConfigHandler, getWhatsNewHandler } from "../controllers/app.controller.js";

const router = Router();

// No auth required — must be accessible before login
router.use(generalLimiter);

router.get("/config", getAppConfigHandler);
router.get("/economy", getEconomyConfigHandler);
router.get("/whats-new", validate(whatsNewQuerySchema, "query"), getWhatsNewHandler);
// Statik sehir listesi (konumsuz yedek yol, data/cities.ts) — auth yok: kurulum adiminda da okunur, DB yok.
router.get("/cities", validate(citySearchQuerySchema, "query"), getCitiesHandler);

export default router;
