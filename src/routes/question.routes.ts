import { Router } from "express";
import multer from "multer";
import { generalLimiter, uploadLimiter } from "../middleware/rateLimit.js";
import { mediaQuestionsGuard } from "../middleware/mediaQuestionsGuard.js";
import { validate } from "../middleware/validate.js";
import { authMiddleware } from "../middleware/auth.js";
import { createQuestionSchema, updateQuestionSchema, reorderQuestionsSchema } from "../validators/question.validator.js";
import {
  questionOrderParamsSchema,
  questionMediaParamsSchema,
  uploadVoiceBodySchema,
} from "../validators/question-media.validator.js";
import { IMAGE_MAX_BYTES, IMAGE_MIME_TYPES, VOICE_MAX_BYTES, VOICE_MIME_TYPES } from "../constants/question-media.js";
import {
  getMyQuestionsHandler,
  createQuestionHandler,
  updateQuestionHandler,
  deleteQuestionHandler,
  getQuestionCountHandler,
  getQuestionAnalyticsHandler,
  getWeeklyReportHandler,
  reorderQuestionsHandler,
  uploadQuestionVoiceHandler,
  uploadQuestionImageHandler,
  deleteQuestionMediaHandler,
} from "../controllers/question.controller.js";
import { aiSuggestHandler } from "../controllers/ai-suggest.controller.js";
import { aiSuggestSchema } from "../validators/ai-suggest.validator.js";
import { weeklyReportService } from "../services/weekly-report.service.js";
import { supabase } from "../config/supabase.js";
import { AppError, Errors } from "../utils/errors.js";

const router = Router();

/** Soru medyasi: tek dosya (`file`), uca gore tur listesi ve boyut siniri. Belirlenen tur disi = 400. */
function mediaUpload(maxBytes: number, mimeTypes: readonly string[]) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 4 },
    fileFilter: (_req, file, cb) => {
      if (mimeTypes.includes(file.mimetype)) cb(null, true);
      else cb(Errors.INVALID_FILE_TYPE());
    },
  }).single("file");
}
const voiceUpload = mediaUpload(VOICE_MAX_BYTES, VOICE_MIME_TYPES);
const imageUpload = mediaUpload(IMAGE_MAX_BYTES, IMAGE_MIME_TYPES);

// All routes require authentication + general rate limit
router.use(authMiddleware, generalLimiter);

router.get("/me", getMyQuestionsHandler);
router.post("/me", validate(createQuestionSchema), createQuestionHandler);
router.patch("/me/reorder", validate(reorderQuestionsSchema), reorderQuestionsHandler);
router.patch("/me/:order", validate(updateQuestionSchema), updateQuestionHandler);
router.delete("/me/:order", deleteQuestionHandler);
// Sesli/gorselli soru (2.0.19): kapi multer'dan ONCE — kapali/eski istemci dosyayi bellege almadan 403.
// Silme kapisiz: kullanici kendi medyasini ozellik kapatilsa da kaldirabilir.
router.post("/me/:order/voice", uploadLimiter, validate(questionOrderParamsSchema, "params"), mediaQuestionsGuard,
  voiceUpload, validate(uploadVoiceBodySchema), uploadQuestionVoiceHandler);
router.post("/me/:order/image", uploadLimiter, validate(questionOrderParamsSchema, "params"), mediaQuestionsGuard,
  imageUpload, uploadQuestionImageHandler);
router.delete("/me/:order/media/:kind", validate(questionMediaParamsSchema, "params"), deleteQuestionMediaHandler);
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
