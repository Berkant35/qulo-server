import type { Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";

export async function profileGuard(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    return next(Errors.INVALID_TOKEN());
  }

  const { data: user, error } = await supabase
    .from("users")
    .select("age")
    .eq("id", userId)
    .single();

  if (error) {
    return next(Errors.SERVER_ERROR());
  }

  if (!user || user.age == null) {
    return next(Errors.PROFILE_NOT_COMPLETE());
  }

  next();
}
