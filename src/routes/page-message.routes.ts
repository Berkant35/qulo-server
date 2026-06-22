import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { eventSchema } from "../validators/page-message.validator.js";
import { getPageMessagesHandler, postPageMessageEventHandler } from "../controllers/page-message.controller.js";

const router = Router();
router.use(authMiddleware, generalLimiter);

router.get("/", getPageMessagesHandler);
router.post("/:id/event", validate(eventSchema), postPageMessageEventHandler);

export default router;
