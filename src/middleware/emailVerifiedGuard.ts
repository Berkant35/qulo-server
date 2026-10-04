import type { Request, Response, NextFunction } from "express";
import { Errors } from "../utils/errors.js";
import { emailVerificationService } from "../services/email-verification.service.js";

/**
 * Eşleşmeye yazan uçların kapısı: doğrulanmamış e-posta → 403 EMAIL_VERIFICATION_REQUIRED.
 * Mobil bu kodla "e-postanı doğrula" ekranını açar (yeniden gönderim: POST /auth/resend-verification).
 * Sosyal girişler kayıtta `email_verified=true` yazıldığı için kapıdan etkilenmez.
 * `authMiddleware`'den SONRA bağlanır.
 */
export async function emailVerifiedGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) return next(Errors.INVALID_TOKEN());

  try {
    if (!(await emailVerificationService.isVerified(userId))) {
      return next(Errors.EMAIL_VERIFICATION_REQUIRED());
    }
  } catch (err) {
    console.error("[emailVerifiedGuard]", err instanceof Error ? err.message : err);
    return next(Errors.SERVER_ERROR());
  }
  next();
}
