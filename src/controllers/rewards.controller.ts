import type { Request, Response, NextFunction } from "express";
import { rewardsMarketService } from "../services/rewards-market.service.js";
import type { RedeemInput, RedemptionsQuery } from "../validators/rewards.validator.js";
import { clientMetaFromHeaders } from "../utils/client-meta.js";

export async function getMarketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // Platform erişimi belirler (ülkenin iOS/Android anahtarı).
    const { platform } = clientMetaFromHeaders(req.headers);
    res.json(await rewardsMarketService.getMarket(req.user!.userId, platform));
  } catch (err) {
    next(err);
  }
}

export async function redeemHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { item_id, idempotency_key } = req.body as RedeemInput;
    const { platform } = clientMetaFromHeaders(req.headers);
    const result = await rewardsMarketService.redeem(
      req.user!.userId,
      { itemId: item_id, idempotencyKey: idempotency_key },
      platform,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listRedemptionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit } = req.query as unknown as RedemptionsQuery;
    res.json(await rewardsMarketService.listMyRedemptions(req.user!.userId, page, limit));
  } catch (err) {
    next(err);
  }
}
