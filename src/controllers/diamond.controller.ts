import type { Request, Response, NextFunction } from "express";
import { diamondService } from "../services/diamond.service.js";
import { revenueCatService } from "../services/revenuecat.service.js";
import { IAP_PRODUCT_MAP, storeProductKey } from "../types/index.js";
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

    const purpleAmount = IAP_PRODUCT_MAP[storeProductKey(product_id)];
    if (!purpleAmount) {
      res.status(400).json({ error: "UNKNOWN_PRODUCT", message: "Unknown product identifier" });
      return;
    }

    // Verify purchase with RevenueCat
    const verification = await revenueCatService.verifyPurchase(userId, product_id, transaction_id);
    if (!verification.valid) {
      console.warn("[diamond] Purchase verification failed:", verification.error);
      res.status(403).json({ error: "INVALID_PURCHASE", message: "Purchase verification failed" });
      return;
    }

    // Tekilleştirme anahtarı SUNUCUDAN gelir, istemciden değil. Eskiden
    // `transaction_id ?? product_id` kullanılıyordu ve alan opsiyonel olduğu
    // için istemci onu boş göndererek anahtarı değiştirip aynı satın almayı
    // ikinci kez kredilendirebiliyordu. RevenueCat doğrulaması zaten yetkili
    // numarayı biliyor; onu kullanıyoruz.
    const result = await diamondService.addPurple(
      userId,
      purpleAmount,
      "IAP_PURCHASE",
      verification.transactionId ?? transaction_id ?? product_id,
    );

    // credited === 0 => kayit zaten vardi, yani BU istek hicbir sey yatirmadi.
    // En olasi sebep bayat bir RevenueCat referansi: istemci transaction_id
    // gondermediginde revenuecat.service o urunun RC'deki EN SON satin almasini
    // yetkili sayiyor; RC henuz senkron degilse bu bir ONCEKI islemdir ve
    // dedup'a takilir. Sonuc: kullaniciya "basarili" denir, elmas gelmez —
    // 2026-09-05 cift kredi olayinin ters yonu. Sessiz kalmamali.
    if (result.credited === 0) {
      console.error("[diamond] IAP credited 0 — muhtemel bayat RC referansi", {
        userId,
        product_id,
        referenceId: verification.transactionId ?? transaction_id ?? product_id,
      });
    }

    // purple_credited artik BEKLENEN degil GERCEKLESEN miktar. Mevcut mobil
    // istemci bu govdeyi OKUMUYOR (`Future<void> purchase`), yani bu sahada
    // gorunen bir bug duzeltmesi DEGIL — sozlesme yalan soylemesin diye.
    res.json({
      message: "Purchase successful",
      purple_credited: result.credited,
      new_balance: result.purple,
    });
  } catch (err) {
    next(err);
  }
}
