import type { Request, Response, NextFunction } from "express";
import { diamondService } from "../services/diamond.service.js";
import { revenueCatService } from "../services/revenuecat.service.js";
import { IAP_PRODUCT_MAP } from "../types/index.js";
import type { HistoryQuery, PurchaseInput } from "../validators/diamond.validator.js";

export async function getBalanceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const result = await diamondService.getBalance(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getHistoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { page, limit } = req.query as unknown as HistoryQuery;
    const result = await diamondService.getHistory(userId, page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function purchaseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { product_id, transaction_id } = req.body as PurchaseInput;

    const purpleAmount = IAP_PRODUCT_MAP[product_id];
    if (!purpleAmount) {
      res.status(400).json({ error: "UNKNOWN_PRODUCT", message: `Unknown product: ${product_id}` });
      return;
    }

    // Verify purchase with RevenueCat
    const verification = await revenueCatService.verifyPurchase(userId, product_id, transaction_id);
    if (!verification.valid) {
      res.status(403).json({ error: "INVALID_PURCHASE", message: verification.error });
      return;
    }

    const result = await diamondService.addPurple(
      userId,
      purpleAmount,
      "IAP_PURCHASE",
      transaction_id ?? product_id,
    );

    res.json({
      message: "Purchase successful",
      purple_credited: purpleAmount,
      new_balance: result.purple,
    });
  } catch (err) {
    next(err);
  }
}
