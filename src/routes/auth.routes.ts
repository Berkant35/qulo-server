import { Router } from "express";
import { authLimiter, socialAuthLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  socialLoginSchema,
} from "../validators/auth.validator.js";
import {
  registerHandler,
  verifyEmailHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
  socialLoginHandler,
} from "../controllers/auth.controller.js";

const router = Router();

router.post("/register", authLimiter, validate(registerSchema), registerHandler);
router.get("/verify-email", validate(verifyEmailSchema, "query"), verifyEmailHandler);
router.post("/login", authLimiter, validate(loginSchema), loginHandler);
router.post("/social-login", socialAuthLimiter, validate(socialLoginSchema), socialLoginHandler);
router.post("/refresh", validate(refreshSchema), refreshHandler);
router.post("/logout", authMiddleware, logoutHandler);
router.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), forgotPasswordHandler);
router.post("/reset-password", authLimiter, validate(resetPasswordSchema), resetPasswordHandler);

export default router;
