import type { Request, Response, NextFunction } from "express";
import { rewardedAdService } from "../services/rewarded-ad.service.js";

export async function rewardedAdStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await rewardedAdService.getStatus(req.user!.userId));
  } catch (err) {
    next(err);
  }
}

/**
 * Google çağırır (kimliksiz). Gövde sabit/ayrıntısız; imza dışı hiçbir koşulda 4xx yok.
 * İmza `req.originalUrl`'deki HAM sorguyla doğrulanır (Express'in decode ettiği req.query ile DEĞİL).
 */
export async function rewardedAdSsvHandler(req: Request, res: Response) {
  try {
    const qIndex = req.originalUrl.indexOf("?");
    const rawQuery = qIndex === -1 ? "" : req.originalUrl.slice(qIndex + 1);
    const { httpStatus } = await rewardedAdService.handleCallback(rawQuery);
    res.status(httpStatus).json(httpStatus === 200 ? { ok: true } : { error: { code: "INVALID_SSV" } });
  } catch (err) {
    console.error("[RewardedAd] SSV handler error", { name: err instanceof Error ? err.name : "unknown" });
    res.status(500).json({ error: { code: "SERVER_ERROR" } });
  }
}
