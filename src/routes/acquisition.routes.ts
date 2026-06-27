import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { submitAnswerSchema } from "../validators/acquisition.validator.js";
import { acquisitionService } from "../services/acquisition.service.js";

const router = Router();
router.use(authMiddleware);
router.use(generalLimiter);

router.get("/channels", async (req, res, next) => {
  try {
    const locale = (req.user as { locale?: string } | undefined)?.locale
      ?? (req.query.locale as string | undefined)
      ?? "en";
    const channels = await acquisitionService.getChannels(locale);
    res.json({ channels });
  } catch (err) {
    next(err);
  }
});

router.post("/answer", validate(submitAnswerSchema), async (req, res, next) => {
  try {
    const result = await acquisitionService.submitAnswer(req.user!.userId, {
      channelId: req.body.channel_id,
      skipped: req.body.skipped,
      freeformText: req.body.freeform_text,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
