import { Router } from "express";
import { generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { authMiddleware } from "../middleware/auth.js";
import { createQuestionSchema, updateQuestionSchema } from "../validators/question.validator.js";
import {
  getMyQuestionsHandler,
  createQuestionHandler,
  updateQuestionHandler,
  deleteQuestionHandler,
  getQuestionCountHandler,
  getQuestionAnalyticsHandler,
  getWeeklyReportHandler,
} from "../controllers/question.controller.js";
import { aiSuggestHandler } from "../controllers/ai-suggest.controller.js";
import { aiSuggestSchema } from "../validators/ai-suggest.validator.js";
import { weeklyReportService } from "../services/weekly-report.service.js";
import { supabase } from "../config/supabase.js";
import { AppError } from "../utils/errors.js";

const router = Router();

// All routes require authentication + general rate limit
router.use(authMiddleware, generalLimiter);

router.get("/me", getMyQuestionsHandler);
router.post("/me", validate(createQuestionSchema), createQuestionHandler);
router.put("/me/:order", validate(updateQuestionSchema), updateQuestionHandler);
router.delete("/me/:order", deleteQuestionHandler);
router.get("/count/me", getQuestionCountHandler);
router.get("/me/analytics", getQuestionAnalyticsHandler);
router.get("/me/weekly-report", getWeeklyReportHandler);
router.post("/ai-suggest", validate(aiSuggestSchema), aiSuggestHandler);

// Admin: Manual weekly report trigger (requires admin_users membership)
router.post("/admin/send-weekly-reports", async (req, res, next) => {
  try {
    // Verify the authenticated user is an admin
    const { data: admin } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", req.user!.email)
      .single();

    if (!admin) {
      throw new AppError("FORBIDDEN", 403, "Admin access required");
    }

    const result = await weeklyReportService.sendWeeklyReports();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
