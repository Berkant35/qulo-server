import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { createReportSchema } from "../validators/report.validator.js";
import { createReportHandler } from "../controllers/report.controller.js";

const router = Router();

router.use(authMiddleware, generalLimiter);

router.post("/", validate(createReportSchema), createReportHandler);

export default router;
