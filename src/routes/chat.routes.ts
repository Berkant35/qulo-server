import { Router } from "express";
import { chatLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { authMiddleware } from "../middleware/auth.js";
import { sendMessageSchema, chatQuerySchema, reactionSchema } from "../validators/chat.validator.js";
import { createChatQuestionSchema, answerChatQuestionSchema } from "../validators/chat-question.validator.js";
import {
  getMessagesHandler,
  sendMessageHandler,
  markAsReadHandler,
  deleteMessageHandler,
  addReactionHandler,
} from "../controllers/chat.controller.js";
import {
  createChatQuestionHandler,
  answerChatQuestionHandler,
} from "../controllers/chat-question.controller.js";

const router = Router();

// All routes require authentication
router.use(authMiddleware);
router.use(chatLimiter);

router.get("/:match_id/messages", validate(chatQuerySchema, "query"), getMessagesHandler);
router.post("/:match_id/messages", validate(sendMessageSchema), sendMessageHandler);
router.post("/:match_id/read", markAsReadHandler);
router.delete("/:match_id/messages/:message_id", deleteMessageHandler);
router.post("/:match_id/messages/:message_id/reactions", validate(reactionSchema), addReactionHandler);
router.post("/:match_id/questions", validate(createChatQuestionSchema), createChatQuestionHandler);
router.post("/questions/:id/answer", validate(answerChatQuestionSchema), answerChatQuestionHandler);

export default router;
