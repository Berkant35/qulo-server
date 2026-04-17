import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifyAccessToken } from "../utils/jwt.js";
import type { JwtPayload } from "../types/index.js";
import { Errors } from "../utils/errors.js";
import { supabase } from "../config/supabase.js";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return next(Errors.INVALID_TOKEN());
  }

  const token = header.slice(7);

  let decoded: JwtPayload;
  try {
    decoded = verifyAccessToken(token);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(Errors.TOKEN_EXPIRED());
    }
    console.warn('[auth] JWT verification failed:', error instanceof Error ? error.message : 'Unknown JWT error');
    return next(Errors.INVALID_TOKEN());
  }

  try {
    // Check if user is banned
    const { data: userRow } = await supabase
      .from("users")
      .select("is_banned")
      .eq("id", decoded.userId)
      .single();

    if (userRow?.is_banned) {
      return next(Errors.ACCOUNT_BANNED());
    }

    req.user = decoded;
    next();
  } catch {
    return next(Errors.SERVER_ERROR());
  }
}
