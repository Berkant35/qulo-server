import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Kontrolör dikişi: elmas paketi satın almasında TEKİLLEŞTİRME ANAHTARININ
 * nereden geldiği burada belirleniyor — para değen tek satır.
 *
 * Eskiden anahtar `transaction_id ?? product_id` idi ve `transaction_id` zod'da
 * opsiyonel. Yani bir kez gerçekten satın alan kullanıcı, aynı isteği alanı BOŞ
 * göndererek tekrarlayabiliyordu: RevenueCat doğrulaması geçiyordu (satın alma
 * gerçekten var), ama anahtar `product_id`'ye düştüğü için farklı oluyor ve
 * elmas ikinci kez yatıyordu. Artık anahtar sunucunun RevenueCat'ten okuduğu
 * yetkili işlem numarası.
 *
 * Mobil tarafta alan gerçekten boş kalabiliyor (`lastOrNull` null dönebiliyor),
 * bu yüzden alanı zorunlu yapmak yerine anahtar sunucuya taşındı.
 */

function makeRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json: vi.fn() }));
  const res: any = { json, status };
  return { res, json };
}

async function loadHandler(verification: Record<string, unknown>) {
  const verifyPurchase = vi.fn().mockResolvedValue(verification);
  const addPurple = vi.fn().mockResolvedValue({ purple: 999 });

  vi.doMock("../../src/services/revenuecat.service.js", () => ({
    revenueCatService: { verifyPurchase },
  }));
  vi.doMock("../../src/services/diamond.service.js", () => ({
    diamondService: { addPurple },
  }));

  const { purchaseHandler } = await import("../../src/controllers/diamond.controller.js");
  return { purchaseHandler, verifyPurchase, addPurple };
}

const req = (body: Record<string, unknown>): any => ({
  user: { userId: "u1" },
  body,
});

describe("purchaseHandler — tekilleştirme anahtarı", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("istemci transaction_id GÖNDERMESE bile sunucunun yetkili numarası anahtar olur", async () => {
    const { purchaseHandler, addPurple } = await loadHandler({
      valid: true,
      transactionId: "rc-authoritative-1",
    });
    const { res } = makeRes();

    await purchaseHandler(req({ product_id: "qulopurple50" }), res, vi.fn());

    expect(addPurple).toHaveBeenCalledWith("u1", expect.any(Number), "IAP_PURCHASE", "rc-authoritative-1");
  });

  it("istemci FARKLI bir değer gönderse de sunucununki kazanır", async () => {
    const { purchaseHandler, addPurple } = await loadHandler({
      valid: true,
      transactionId: "rc-authoritative-1",
    });
    const { res } = makeRes();

    await purchaseHandler(
      req({ product_id: "qulopurple50", transaction_id: "istemcinin-uydurdugu" }),
      res,
      vi.fn(),
    );

    expect(addPurple).toHaveBeenCalledWith("u1", expect.any(Number), "IAP_PURCHASE", "rc-authoritative-1");
  });

  it("doğrulama başarısızsa elmas yatmaz", async () => {
    const { purchaseHandler, addPurple } = await loadHandler({
      valid: false,
      error: "Purchase not found for this product",
    });
    const { res } = makeRes();

    await purchaseHandler(req({ product_id: "qulopurple50" }), res, vi.fn());

    expect(addPurple).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
