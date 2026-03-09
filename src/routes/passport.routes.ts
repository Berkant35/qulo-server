import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { activatePassportSchema } from "../validators/passport.validator.js";
import {
  activatePassportHandler,
  deactivatePassportHandler,
} from "../controllers/passport.controller.js";

const router = Router();

router.use(authMiddleware, generalLimiter);

router.post("/activate", validate(activatePassportSchema), activatePassportHandler);
router.post("/deactivate", deactivatePassportHandler);

export default router;
