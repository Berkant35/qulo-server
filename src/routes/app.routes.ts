import { Router } from "express";
import { generalLimiter } from "../middleware/rateLimit.js";
import { getAppConfigHandler } from "../controllers/app.controller.js";

const router = Router();

// No auth required — must be accessible before login
router.use(generalLimiter);

router.get("/config", getAppConfigHandler);

export default router;
