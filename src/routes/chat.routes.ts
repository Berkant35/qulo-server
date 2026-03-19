import { Router } from "express";
import multer from "multer";
import { chatLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { authMiddleware } from "../middleware/auth.js";
import { sendMessageSchema, chatQuerySchema, reactionSchema } from "../validators/chat.validator.js";
import { createChatQuestionSchema, answerChatQuestionSchema, usePowerSchema, saveDraftSchema } from "../validators/chat-question.validator.js";
import {
  getMessagesHandler,
  sendMessageHandler,
  markAsReadHandler,
  deleteMessageHandler,
  addReactionHandler,
  uploadMediaHandler,
} from "../controllers/chat.controller.js";
import {
  createChatQuestionHandler,
  getChatQuestionHandler,
  answerChatQuestionHandler,
  usePowerHandler,
  timeoutHandler,
  saveDraftHandler,
  getDraftsHandler,
  deleteDraftHandler,
  getHistoryHandler,
} from "../controllers/chat-question.controller.js";
import {
  requestMediaHandler,
  respondToMediaRequestHandler,
  disableMediaHandler,
  getMediaStatusHandler,
} from "../controllers/media.controller.js";
import { respondMediaRequestSchema } from "../validators/media.validator.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// All routes require authentication
router.use(authMiddleware);
router.use(chatLimiter);

router.get("/:match_id/messages", validate(chatQuerySchema, "query"), getMessagesHandler);
router.post("/:match_id/messages", validate(sendMessageSchema), sendMessageHandler);
router.post("/:match_id/upload", upload.single("file"), uploadMediaHandler);
router.post("/:match_id/read", markAsReadHandler);
router.delete("/:match_id/messages/:message_id", deleteMessageHandler);
router.post("/:match_id/messages/:message_id/reactions", validate(reactionSchema), addReactionHandler);

// Chat question routes — static paths BEFORE parameterized paths
router.get("/questions/drafts", getDraftsHandler);
router.post("/questions/drafts", validate(saveDraftSchema), saveDraftHandler);
router.delete("/questions/drafts/:id", deleteDraftHandler);
router.get("/questions/history", getHistoryHandler);
router.post("/:match_id/questions", validate(createChatQuestionSchema), createChatQuestionHandler);
router.get("/questions/:id", getChatQuestionHandler);
router.post("/questions/:id/answer", validate(answerChatQuestionSchema), answerChatQuestionHandler);
router.post("/questions/:id/use-power", validate(usePowerSchema), usePowerHandler);
router.post("/questions/:id/timeout", timeoutHandler);

// Media sharing routes
router.post("/:match_id/media-request", requestMediaHandler);
router.post("/:match_id/media-request/:id/respond", validate(respondMediaRequestSchema), respondToMediaRequestHandler);
router.post("/:match_id/media-disable", disableMediaHandler);
router.get("/:match_id/media-status", getMediaStatusHandler);

export default router;
