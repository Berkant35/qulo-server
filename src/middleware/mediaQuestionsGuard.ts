import type { Request, Response, NextFunction } from "express";
import { mediaQuestionsActive } from "../services/media-questions-gate.js";
import { Errors } from "../utils/errors.js";

/**
 * Sesli/gorselli soru yukleme kapisi: istemci >= 2.0.19 VE `media_questions_enabled`.
 * Dosyali uclarda multer'dan ONCE takilir — kapali istek 8 MB'i bellege almadan 403 doner.
 */
export async function mediaQuestionsGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    next((await mediaQuestionsActive(req.headers)) ? undefined : Errors.FEATURE_DISABLED());
  } catch (err) {
    next(err);
  }
}
