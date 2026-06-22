import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { eventSchema } from "../validators/page-message.validator.js";
import { getPageMessagesHandler, postPageMessageEventHandler } from "../controllers/page-message.controller.js";

const router = Router();
router.use(authMiddleware, generalLimiter);

const idParamsSchema = z.object({ id: z.string().uuid() });

router.get("/", getPageMessagesHandler);
router.post("/:id/event", validate(idParamsSchema, "params"), validate(eventSchema), postPageMessageEventHandler);

export default router;
