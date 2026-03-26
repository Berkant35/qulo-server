import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { validateCodeSchema, applyCodeSchema } from "../validators/referral.validator.js";
import { referralService } from "../services/referral.service.js";
import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";

const router = Router();

router.use(authMiddleware);
router.use(generalLimiter);

// GET /my-code — returns user's referral_code from users table
router.get("/my-code", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const { data, error } = await supabase
      .from("users")
      .select("referral_code")
      .eq("id", userId)
      .single();

    if (error || !data) {
      throw Errors.USER_NOT_FOUND();
    }

    res.json({ code: data.referral_code });
  } catch (err) {
    next(err);
  }
});

// GET /stats — referral stats for current user
router.get("/stats", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await referralService.getStats(req.user!.userId);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// GET /history — referral history for current user
router.get("/history", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const history = await referralService.getHistory(req.user!.userId);
    res.json(history);
  } catch (err) {
    next(err);
  }
});

// POST /validate-code — validate a referral code
router.post("/validate-code", validate(validateCodeSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.body;
    const result = await referralService.validateCode(code);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /apply — apply a referral code (post-login, one-time)
router.post("/apply", validate(applyCodeSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.body;
    const result = await referralService.applyReferralCode(req.user!.userId, code);
    res.json({ referrerName: result.referrerName });
  } catch (err) {
    next(err);
  }
});

// GET /my-referrer — get who referred the current user
router.get("/my-referrer", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await referralService.getMyReferrer(req.user!.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
