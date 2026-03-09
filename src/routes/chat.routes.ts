import { Router } from "express";
import { chatLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { authMiddleware } from "../middleware/auth.js";
import { sendMessageSchema, chatQuerySchema } from "../validators/chat.validator.js";
import {
  getMessagesHandler,
  sendMessageHandler,
  markAsReadHandler,
} from "../controllers/chat.controller.js";

const router = Router();

// All routes require authentication
router.use(authMiddleware);
router.use(chatLimiter);

router.get("/:match_id/messages", validate(chatQuerySchema, "query"), getMessagesHandler);
router.post("/:match_id/messages", validate(sendMessageSchema), sendMessageHandler);
router.post("/:match_id/read", markAsReadHandler);

export default router;
