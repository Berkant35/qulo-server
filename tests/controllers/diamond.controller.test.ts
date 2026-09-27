import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AddPurpleResult } from "../../src/services/diamond.service.js";

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

async function loadHandler(
  verification: Record<string, unknown>,
  // Mock TIPLI: alan adi degisirse tsc yakalasin. Eskiden `vi.fn()` `any`
  // donuyordu ve `credited` eksikligi sessizce `purple_credited: undefined`
  // uretiyordu — JSON.stringify anahtari tamamen dusuruyor, test de gormuyordu.
  addPurpleResult: AddPurpleResult = { purple: 999, credited: 50 },
) {
  const verifyPurchase = vi.fn().mockResolvedValue(verification);
  const addPurple = vi.fn().mockResolvedValue(addPurpleResult);

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
      paidEligible: true,
    });
    const { res } = makeRes();

    await purchaseHandler(req({ product_id: "qulopurple50" }), res, vi.fn());

    expect(addPurple).toHaveBeenCalledWith("u1", expect.any(Number), "IAP_PURCHASE", "rc-authoritative-1", 50);
  });

  it("istemci FARKLI bir değer gönderse de sunucununki kazanır", async () => {
    const { purchaseHandler, addPurple } = await loadHandler({
      valid: true,
      transactionId: "rc-authoritative-1",
      paidEligible: true,
    });
    const { res } = makeRes();

    await purchaseHandler(
      req({ product_id: "qulopurple50", transaction_id: "istemcinin-uydurdugu" }),
      res,
      vi.fn(),
    );

    expect(addPurple).toHaveBeenCalledWith("u1", expect.any(Number), "IAP_PURCHASE", "rc-authoritative-1", 50);
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

describe("purchaseHandler — ödenmiş mor", () => {
  // IAP tamamen ödenmiş mor sayılır (spec 2026-09-27, Task 9): addPurple'ın 5.
  // argümanı (paidAmount) yatırılan miktarın tamamına eşit olmalı.
  beforeEach(() => {
    vi.resetModules();
  });

  it("IAP satın alması addPurple'a 5. argüman olarak yatırılan miktarın tamamını yollar", async () => {
    const { purchaseHandler, addPurple } = await loadHandler({
      valid: true,
      transactionId: "rc-paid-1",
      isSandbox: false,
      paidEligible: true,
    });
    const { res } = makeRes();

    await purchaseHandler(req({ product_id: "qulopurple400" }), res, vi.fn());

    expect(addPurple).toHaveBeenCalledWith("u1", 400, "IAP_PURCHASE", "rc-paid-1", 400);
  });

  // Sandbox (TestFlight / lisans testçisi) satın alması 0 TL: mor yatar, ödenmiş sayılmaz (F4).
  it("sandbox satın alması mor yatırır ama ödenmiş 0", async () => {
    const { purchaseHandler, addPurple } = await loadHandler({
      valid: true,
      transactionId: "rc-sandbox-1",
      isSandbox: true,
      paidEligible: false,
    });
    const { res } = makeRes();

    await purchaseHandler(req({ product_id: "qulopurple400" }), res, vi.fn());

    expect(addPurple).toHaveBeenCalledWith("u1", 400, "IAP_PURCHASE", "rc-sandbox-1", 0);
  });

  it("uygunluk bilgisi yoksa ödenmiş 0 (fail-safe)", async () => {
    const { purchaseHandler, addPurple } = await loadHandler({ valid: true, transactionId: "rc-x" });
    const { res } = makeRes();

    await purchaseHandler(req({ product_id: "qulopurple400" }), res, vi.fn());

    expect(addPurple).toHaveBeenCalledWith("u1", 400, "IAP_PURCHASE", "rc-x", 0);
  });
});

describe("purchaseHandler — yanit govdesi", () => {
  // resetModules ZORUNLU: `loadHandler` doMock + dinamik import kullaniyor,
  // sifirlanmazsa bir onceki testin mock'u (orn. `{valid:false}`) miras kaliyor
  // ve handler dogrulamada erken donuyor.
  beforeEach(() => {
    vi.resetModules();
  });

  it("purple_credited GERCEKLESEN miktari doner, beklenen degil", async () => {
    // Bu satirin (purple_credited: result.credited) sifir kapsamasi vardi:
    // mock `credited` dondurmedigi icin JSON.stringify anahtari tamamen
    // dusuruyordu ve hicbir test govdeyi okumuyordu.
    const { purchaseHandler } = await loadHandler(
      { valid: true, transactionId: "rc-1" },
      { purple: 1200, credited: 400 },
    );
    const { res, json } = makeRes();

    await purchaseHandler(req({ product_id: "qulopurple400" }), res, vi.fn());

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ purple_credited: 400, new_balance: 1200 }),
    );
  });

  it("duplicate durumunda purple_credited 0, new_balance GERCEK bakiye", async () => {
    // Para yolunda dogru olmasi gereken ayrim: hicbir sey yatmadi (0) ama
    // kullanicinin bakiyesi 730 ve yanit bunu dogru soylemeli.
    const { purchaseHandler } = await loadHandler(
      { valid: true, transactionId: "rc-tekrar" },
      { purple: 730, credited: 0 },
    );
    const { res, json } = makeRes();

    await purchaseHandler(req({ product_id: "qulopurple400" }), res, vi.fn());

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ purple_credited: 0, new_balance: 730 }),
    );
  });

  it("credited 0 ise anomali loglanir — sessiz para kaybi olmasin", async () => {
    // Bayat RC referansi senaryosu: kullaniciya "basarili" denir ama elmas
    // gelmez. Tek erken uyari bu log.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { purchaseHandler } = await loadHandler(
      { valid: true, transactionId: "rc-bayat" },
      { purple: 730, credited: 0 },
    );
    const { res } = makeRes();

    await purchaseHandler(req({ product_id: "qulopurple400" }), res, vi.fn());

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("credited 0"),
      expect.objectContaining({ product_id: "qulopurple400" }),
    );
    spy.mockRestore();
  });

  it("normal durumda anomali logu YAZILMAZ — gurultu yapmasin", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { purchaseHandler } = await loadHandler(
      { valid: true, transactionId: "rc-2" },
      { purple: 1200, credited: 400 },
    );
    const { res } = makeRes();

    await purchaseHandler(req({ product_id: "qulopurple400" }), res, vi.fn());

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("getHistoryHandler — platform", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("x-app-platform başlığını servise geçirir (rainbow görünürlüğü buna bağlı)", async () => {
    const getHistory = vi.fn().mockResolvedValue({ items: [], total: 0, page: 2, limit: 10 });
    vi.doMock("../../src/services/diamond.service.js", () => ({ diamondService: { getHistory } }));
    vi.doMock("../../src/services/revenuecat.service.js", () => ({ revenueCatService: {} }));
    const { getHistoryHandler } = await import("../../src/controllers/diamond.controller.js");
    const { res, json } = makeRes();
    const next = vi.fn();

    await getHistoryHandler(
      { user: { userId: "u1" }, query: { page: 2, limit: 10 }, headers: { "x-app-platform": "Android" } } as any,
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(getHistory).toHaveBeenCalledWith("u1", 2, 10, "android");
    expect(json).toHaveBeenCalledWith({ items: [], total: 0, page: 2, limit: 10 });
  });
});
