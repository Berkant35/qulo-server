import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * İstemci abonelik yolu (`POST /subscriptions/activate`): aylık bonusun "ödenmiş" payı yalnız
 * RevenueCat'in doğruladığı gerçek, tam fiyatlı, kendi satın alması için (F4). Uygunluk
 * RevenueCat abone verisinden gelir; bilinmiyorsa uygun değil.
 */
async function loadHandler(verification: Record<string, unknown>) {
  const verifySubscription = vi.fn().mockResolvedValue(verification);
  const activateFromClient = vi.fn().mockResolvedValue(undefined);
  const getStatus = vi.fn().mockResolvedValue({ plan: "plus", status: "active", expiresAt: "x", isActive: true });
  const getLimits = vi.fn().mockResolvedValue({});

  vi.doMock("../../src/services/revenuecat.service.js", () => ({ revenueCatService: { verifySubscription } }));
  vi.doMock("../../src/services/subscription.service.js", () => ({
    subscriptionService: { activateFromClient, getStatus, getLimits },
  }));

  const { activateSubscriptionHandler } = await import("../../src/controllers/subscription.controller.js");
  return { activateSubscriptionHandler, activateFromClient };
}

const req = (): any => ({ user: { userId: "u1" }, body: { product_id: "quloplusmonthly2", transaction_id: "tx-1" } });
const res = (): any => ({ json: vi.fn(), status: vi.fn(() => ({ json: vi.fn() })) });
const EXPIRES = "2026-10-27T12:00:00Z";

describe("activateSubscriptionHandler — ödenmiş pay uygunluğu", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("RevenueCat uygun derse istemci yoluna (activateFromClient) true geçer", async () => {
    const { activateSubscriptionHandler, activateFromClient } = await loadHandler({
      valid: true, expiresAt: EXPIRES, isSandbox: false, periodType: "normal", ownershipType: "PURCHASED", paidEligible: true,
    });
    const next = vi.fn();

    await activateSubscriptionHandler(req(), res(), next);

    expect(next).not.toHaveBeenCalled();
    expect(activateFromClient).toHaveBeenCalledWith("u1", "plus", "client_u1", "tx-1", EXPIRES, { paidEligible: true, sandbox: false }, "monthly");
  });

  it("deneme dönemi (trial) → false", async () => {
    const { activateSubscriptionHandler, activateFromClient } = await loadHandler({
      valid: true, expiresAt: EXPIRES, isSandbox: false, periodType: "trial", ownershipType: "PURCHASED", paidEligible: false,
    });

    await activateSubscriptionHandler(req(), res(), vi.fn());

    expect(activateFromClient).toHaveBeenCalledWith("u1", "plus", "client_u1", "tx-1", EXPIRES, { paidEligible: false, sandbox: false }, "monthly");
  });

  it("uygunluk alanı yoksa false (fail-safe)", async () => {
    const { activateSubscriptionHandler, activateFromClient } = await loadHandler({ valid: true, expiresAt: EXPIRES });

    await activateSubscriptionHandler(req(), res(), vi.fn());

    expect(activateFromClient).toHaveBeenCalledWith("u1", "plus", "client_u1", "tx-1", EXPIRES, { paidEligible: false, sandbox: false }, "monthly");
  });

  it("haftalık ürün (quloplusweekly) plus planı + weekly dönemle aktive edilir", async () => {
    const { activateSubscriptionHandler, activateFromClient } = await loadHandler({
      valid: true, expiresAt: EXPIRES, paidEligible: true,
    });
    const r = req();
    r.body.product_id = "quloplusweekly";

    await activateSubscriptionHandler(r, res(), vi.fn());

    expect(activateFromClient).toHaveBeenCalledWith("u1", "plus", "client_u1", "tx-1", EXPIRES, { paidEligible: true, sandbox: false }, "weekly");
  });
});

/** Sandbox gerçeği servise iner (30 günde bir bonus kuralı orada); bilinmiyorsa üretim sayılır. */
describe("activateSubscriptionHandler — sandbox", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("RevenueCat sandbox derse sandbox: true geçer", async () => {
    const { activateSubscriptionHandler, activateFromClient } = await loadHandler({
      valid: true, expiresAt: EXPIRES, isSandbox: true, paidEligible: false,
    });

    await activateSubscriptionHandler(req(), res(), vi.fn());

    expect(activateFromClient).toHaveBeenCalledWith(
      "u1", "plus", "client_u1", "tx-1", EXPIRES, { paidEligible: false, sandbox: true }, "monthly",
    );
  });
});
