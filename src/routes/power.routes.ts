import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { generalLimiter } from "../middleware/rateLimit.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";

const router = Router();

router.use(authMiddleware, generalLimiter);

router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase
      .from("powers")
      .select("*")
      .eq("is_active", true);

    if (error) throw Errors.SERVER_ERROR();

    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

export default router;
