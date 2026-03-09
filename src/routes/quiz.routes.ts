import { Router } from "express";
import { generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { authMiddleware } from "../middleware/auth.js";
import { startQuizSchema, answerQuizSchema } from "../validators/quiz.validator.js";
import {
  startQuizHandler,
  getCurrentQuestionHandler,
  answerQuestionHandler,
  rescueQuizHandler,
  failQuizHandler,
  getSessionResultHandler,
  getMatchQuizSummaryHandler,
} from "../controllers/quiz.controller.js";

const router = Router();

// All routes require authentication + general rate limit
router.use(authMiddleware, generalLimiter);

router.post("/start", validate(startQuizSchema), startQuizHandler);
router.get("/match/:match_id/summary", getMatchQuizSummaryHandler);
router.get("/:session_id", getCurrentQuestionHandler);
router.post("/:session_id/answer", validate(answerQuizSchema), answerQuestionHandler);
router.post("/:session_id/rescue", rescueQuizHandler);
router.post("/:session_id/fail", failQuizHandler);
router.get("/:session_id/result", getSessionResultHandler);

export default router;
