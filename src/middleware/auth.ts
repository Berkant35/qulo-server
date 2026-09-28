import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifyAccessToken } from "../utils/jwt.js";
import type { JwtPayload } from "../types/index.js";
import { Errors } from "../utils/errors.js";
import { banStatusService } from "../services/ban-status.service.js";

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
    // 60 sn önbellekli; ban/unban anında temizlenir (bkz. ban-status.service).
    if (await banStatusService.isBanned(decoded.userId)) {
      return next(Errors.ACCOUNT_BANNED());
    }

    req.user = decoded;
    next();
  } catch {
    return next(Errors.SERVER_ERROR());
  }
}
