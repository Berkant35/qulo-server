import { Router } from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import {
  updateProfileSchema,
  updateDetailsSchema,
  updateLocationSchema,
  updatePushTokenSchema,
} from "../validators/user.validator.js";
import { userLanguageService } from "../services/user-language.service.js";
import { setUserLanguagesSchema } from "../validators/user-language.validator.js";
import {
  getMeHandler,
  updateProfileHandler,
  updateDetailsHandler,
  updateLocationHandler,
  updatePushTokenHandler,
  uploadPhotoHandler,
  deletePhotoHandler,
  boostHandler,
  claimBadgeRewardHandler,
  deleteAccountHandler,
} from "../controllers/user.controller.js";
import { AppError } from "../utils/errors.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "image/jpeg" || file.mimetype === "image/png") {
      cb(null, true);
    } else {
      cb(new AppError("INVALID_FILE_TYPE", 400, "Only jpg and png files are allowed"));
    }
  },
});

const router = Router();

// All routes require authentication and general rate limiting
router.use(authMiddleware, generalLimiter);

router.get("/me", getMeHandler);
router.patch("/me", validate(updateProfileSchema), updateProfileHandler);
router.patch("/me/details", validate(updateDetailsSchema), updateDetailsHandler);
router.patch("/me/location", validate(updateLocationSchema), updateLocationHandler);
router.patch("/me/push-token", validate(updatePushTokenSchema), updatePushTokenHandler);
router.post("/me/photos", upload.single("photo"), uploadPhotoHandler);
router.post("/me/boost", boostHandler);
router.post("/me/claim-badge-reward", claimBadgeRewardHandler);
router.delete("/me/photos/:index", deletePhotoHandler);

// GET /me/languages — Get user's language preferences
router.get("/me/languages", async (req, res, next) => {
  try {
    const languages = await userLanguageService.getUserLanguages(req.user!.userId);
    res.json({ languages });
  } catch (err) {
    next(err);
  }
});

// PUT /me/languages — Set user's language preferences (full replace)
router.put("/me/languages", validate(setUserLanguagesSchema), async (req, res, next) => {
  try {
    const { languages } = req.body;
    const result = await userLanguageService.setUserLanguages(req.user!.userId, languages);
    res.json({ languages: result });
  } catch (err) {
    next(err);
  }
});

router.delete("/me", deleteAccountHandler);

export default router;
